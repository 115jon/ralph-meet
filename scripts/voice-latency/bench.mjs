#!/usr/bin/env node
// Voice-join latency bench for Ralph Meet.
//
// Drives real signed-in browsers (Playwright + Chromium with a fake
// microphone that plays a speech-like loop) against a running dev server and
// times every stage of a voice join, from the "Join voice" click to the other
// side hearing you:
//
//   click → room ticket → room socket → media-ready/Ready → voice socket →
//   VoiceReady → SFU session → ICE → DTLS (pc connected) → getUserMedia →
//   push offer → track announced → UI joined / "Connected" → first outbound
//   RTP → listener's first packet → listener hears you; and you hear them.
//
// Scenarios (--scenario, comma separated):
//   cold     join an occupied channel with warm standby turned off
//   warm     the same join, after the standby session has warmed up
//   warm-idle  warm, but the landing sits idle for --idle-ms (45 s) first:
//            longer than the SFU keeps a track that sends no media (30 s)
//   switch   connected in channel 1, click channel 2 (occupied by "other")
//            in the sidebar, standby off; switch-warm: the same, standby on
//   drop     connected, go offline for --drop-ms, measure the recovery
//   hidden   connected, hide + freeze the tab for --hidden-ms, then resume
//
// Network profiles (--profile, comma separated; the joiner's page only, via
// CDP Network.emulateNetworkConditions, so HTTP and WebSocket signalling are
// throttled but WebRTC media is not): none, rtt300 (300 ms RTT),
// slow3g (400 ms RTT, 400/400 kbit/s), fast3g (150 ms RTT, 1.6 Mbit/s).
//
// Setup (once): three dev accounts that share a server with two voice
// channels, described by a JSON file kept OUTSIDE the repo
// (default ~/.cache/ralph-voice-bench/config.json):
//   { "baseUrl": "http://localhost:5198", "serverId": "...",
//     "channels": ["<voice channel 1>", "<voice channel 2>"],
//     "users": { "joiner":   { "email": "...", "password": "..." },
//                "listener": { "email": "...", "password": "..." },
//                "other":    { "email": "...", "password": "..." } } }
// Signed-in sessions are cached beside it as state-<role>.json; --login
// refreshes them. The dev server's Kova app must allow the bench origin.
//
//   pnpm bench:voice --scenario cold,warm --runs 10
//   pnpm bench:voice --scenario warm --profile none,rtt300 --json out.json
//   pnpm bench:voice --scenario warm-idle --runs 5
//   node scripts/voice-latency/bench.mjs --help
//
// Output: a p50/p95 table per scenario × profile on stdout, and every raw run
// (marks, peer-connection events, getUserMedia calls, RTP firsts) with --json.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { STAGES, summarize, formatTable } from "./summary.mjs";
import { PROFILES, launch, log, openClient, sleep } from "./clients.mjs";

// ── Arguments ──────────────────────────────────────────────────────────
function parseArgs(argv) {
  const opts = {
    config: path.join(
      os.homedir(),
      ".cache",
      "ralph-voice-bench",
      "config.json",
    ),
    scenarios: ["cold", "warm"],
    profiles: ["none"],
    runs: 10,
    json: null,
    headed: false,
    login: false,
    chrome: process.env.CHROME_PATH || null,
    timeoutMs: 25_000,
    dropMs: 5_000,
    hiddenMs: 15_000,
    settleMs: 2_500,
    idleMs: 45_000,
    verbose: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === "--config") opts.config = next();
    else if (arg === "--scenario" || arg === "--scenarios")
      opts.scenarios = next().split(",");
    else if (arg === "--profile" || arg === "--profiles")
      opts.profiles = next().split(",");
    else if (arg === "--runs") opts.runs = Number(next());
    else if (arg === "--json") opts.json = next();
    else if (arg === "--headed") opts.headed = true;
    else if (arg === "--login") opts.login = true;
    else if (arg === "--chrome") opts.chrome = next();
    else if (arg === "--timeout") opts.timeoutMs = Number(next());
    else if (arg === "--drop-ms") opts.dropMs = Number(next());
    else if (arg === "--hidden-ms") opts.hiddenMs = Number(next());
    else if (arg === "--settle") opts.settleMs = Number(next());
    else if (arg === "--idle-ms") opts.idleMs = Number(next());
    else if (arg === "--verbose" || arg === "-v") opts.verbose = true;
    else if (arg === "--trace-sfu") opts.traceSfu = true;
    else if (arg === "--help" || arg === "-h") opts.help = true;
    else throw new Error(`Unknown argument ${arg}`);
  }
  return opts;
}

// ── Stage extraction ───────────────────────────────────────────────────
function firstMark(snapshot, name, since, filter = () => true) {
  const mark = snapshot.marks.find(
    (entry) => entry.name === name && entry.t >= since && filter(entry),
  );
  return mark?.t ?? null;
}

function stagesFor({ t0, joiner, listener, joinerPeers }) {
  const rel = (t) => (t == null ? null : Math.round(t - t0));
  const pre = (name) => {
    // A stage that happened before the click (warm standby) counts as 0.
    const before = joiner.marks.find(
      (entry) => entry.name === name && entry.t < t0,
    );
    return before ? t0 : null;
  };
  const mark = (name, filter) =>
    firstMark(joiner, name, t0, filter) ?? pre(name);
  const pcEvent = (kind, state) =>
    joiner.pcEvents.find(
      (event) => event.kind === kind && event.state === state && event.t >= t0,
    )?.t ?? null;
  const gumAudio = joiner.gum.find(
    (entry) => entry.audio && entry.start >= t0 - 1,
  );
  const gumBefore = joiner.gum.some(
    (entry) => entry.audio && entry.end && entry.end < t0,
  );
  const freshInbound = (snapshot) =>
    Object.values(snapshot.rtp.inbound ?? {}).filter(
      (entry) => entry.firstAudible && entry.firstAudible >= t0,
    );
  const earliest = (values) => {
    const list = values.filter((value) => value != null);
    return list.length ? Math.min(...list) : null;
  };
  const listenerStreams = Object.values(listener.rtp.inbound ?? {});
  const listenerNewStream = listenerStreams.filter(
    (entry) => entry.firstSeen >= t0 && entry.packetsAtFirstSeen === 0,
  );
  const outbound = Object.values(joiner.rtp.outbound ?? {}).filter(
    (entry) => entry.firstSeen >= t0 && entry.packetsAtFirstSeen === 0,
  );
  const stages = {
    ticket: mark("RoomGW:ticket-done"),
    roomSocket: mark("RoomGW:ws-open"),
    mediaReady: mark("mediaReadyAt"),
    roomReady: mark("roomGatewayReadyAt"),
    voiceSocket: mark("VoiceGW:ws-open"),
    voiceReady: mark("voiceReadyAt"),
    sfuSession: mark("partyTracksSessionCreatedAt"),
    iceConnected:
      pcEvent("ice", "connected") ??
      (joiner.pcEvents.length && pre("peerConnection:connected")),
    pcConnected: mark("peerConnection:connected"),
    getUserMedia: gumAudio?.end ?? (gumBefore ? t0 : null),
    pushOffer: mark("pushOfferAt", (entry) =>
      String(entry.detail?.trackName ?? "").startsWith("cam-audio"),
    ),
    trackAnnounced: mark("tracksReadySentAt", (entry) =>
      String(entry.detail?.trackName ?? "").startsWith("cam-audio"),
    ),
    uiJoined: firstMark(joiner, "ui-joined", t0),
    uiConnected:
      joiner.connectedText.find((event) => event.visible && event.t >= t0)?.t ??
      null,
    outboundRtp: earliest(outbound.map((entry) => entry.firstPacket)),
    peerFirstPacket: earliest(
      listenerNewStream.map((entry) => entry.firstPacket),
    ),
    peerHears: earliest(
      freshInbound(listener).map((entry) => entry.firstAudible),
    ),
    selfHears: earliest(
      freshInbound(joiner).map((entry) => entry.firstAudible),
    ),
  };
  const result = {};
  for (const stage of STAGES) result[stage] = rel(stages[stage]);
  // Server-side split of the room ticket (Server-Timing on socket-ticket).
  const tickets = (joiner.resources ?? []).filter(
    (entry) =>
      /\/api\/voice\/socket-ticket$/.test(entry.name) && entry.start >= t0 - 5,
  );
  const timingOf = (entry, name) =>
    entry?.serverTiming?.find((timing) => timing.name === name)?.dur ?? null;
  const roomTicket = tickets.find((entry) => timingOf(entry, "media") !== null);
  if (roomTicket) {
    result.ticketAdmission = Math.round(timingOf(roomTicket, "admission"));
    result.ticketMedia = Math.round(timingOf(roomTicket, "media"));
    result.ticketServer = Math.round(timingOf(roomTicket, "total"));
  }
  result.listenerPrejoinStreams = listenerStreams.filter(
    (entry) => entry.firstSeen < t0 || entry.packetsAtFirstSeen > 0,
  ).length;
  result.listenerPullRequests = (listener.resources ?? []).filter((entry) =>
    /\/tracks\/new$/.test(entry.name),
  ).length;
  if (joinerPeers) result.peers = joinerPeers;
  return result;
}

// ── Scenarios ──────────────────────────────────────────────────────────
async function ensureJoined(client, channelIndex, opts) {
  await client.open(channelIndex, { standby: false });
  const since = await client.now();
  await client.clickJoin();
  await client.waitForMark("ui-joined", since, {}, 60_000);
  await client.waitForMark("peerConnection:connected", since, {}, 60_000);
  await sleep(1_000);
  if (opts.verbose) log(`${client.role} joined channel ${channelIndex + 1}`);
}

async function measureJoin({ joiner, listener, opts, runTimeout, click }) {
  await Promise.all([joiner.startSampler(), listener.startSampler()]);
  if (opts.verbose) log("click");
  const clickAt = await joiner.now();
  await (click ? click() : joiner.clickJoin());
  let timedOut = false;
  await Promise.all([
    listener.waitForAudible(clickAt, runTimeout),
    joiner.waitForAudible(clickAt, runTimeout),
    joiner.waitForMark("ui-joined", clickAt, {}, runTimeout),
  ]).catch(() => {
    timedOut = true;
  });
  if (opts.verbose) log(`heard${timedOut ? " (timed out)" : ""}`);
  await sleep(300);
  const [j, l] = await Promise.all([
    joiner.snapshot(clickAt - 60_000),
    listener.snapshot(clickAt - 60_000),
  ]);
  await Promise.all([joiner.stopSampler(), listener.stopSampler()]);
  if (timedOut) {
    const brief = (snapshot) =>
      JSON.stringify({
        inbound: Object.values(snapshot.rtp.inbound ?? {}).map((entry) => ({
          packets: entry.packets,
          maxLevel: Number(entry.maxLevel.toFixed(3)),
          audible: !!entry.firstAudible,
        })),
        source: snapshot.rtp.source ?? null,
      });
    log(`timed out; joiner ${brief(j)}; listener ${brief(l)}`);
  }
  if (opts.verbose) log("snapshot taken");
  const t0 = firstMark(j, "join-click", clickAt - 50) ?? clickAt;
  const stages = stagesFor({ t0, joiner: j, listener: l });
  const pairs = await joiner.page
    .evaluate(() => window.__vb.candidatePairs())
    .catch(() => []);
  stages.iceRoute =
    pairs
      .map(
        (pair) =>
          `${pair.local}->${pair.remote}@${Math.round(pair.rttMs ?? -1)}ms`,
      )
      .join(",") || null;
  stages.timedOut = timedOut;
  stages.standbyClaimed = j.marks.some(
    (m) => m.name === "standby-claimed" && m.t >= t0 - 5,
  );
  return {
    stages,
    raw: opts.json ? { joiner: j, listener: l, t0 } : undefined,
  };
}

async function waitForStandbyWarm(joiner, since, timeout = 15_000) {
  // The standby session is warm once its peer connection is up.
  await joiner
    .waitForMark("peerConnection:connected", since, { standby: true }, timeout)
    .catch(() =>
      log("standby did not report a connected peer connection in time"),
    );
}

async function runSwitch({ joiner, other, opts, standby }) {
  // The joiner sits in channel 1 (with the listener); "other" sits in
  // channel 2. Switching is a click on channel 2 in the sidebar, which
  // leaves channel 1 and joins channel 2 (with standby on, channel 2 is
  // the one kept warm while connected to channel 1).
  await joiner.open(0, { standby });
  const since = await joiner.now();
  await joiner.clickJoin();
  await joiner.waitForMark("ui-joined", since, {}, 60_000);
  await joiner.waitForMark("peerConnection:connected", since, {}, 60_000);
  if (standby) {
    await joiner
      .waitForMark("peerConnection:connected", since, { standby: true }, 15_000)
      .catch(() => log("channel 2 standby did not warm in time"));
  }
  await sleep(opts.settleMs);
  const channelName = joiner.cfg.channelNames?.[1] ?? "Second";
  const result = await measureJoin({
    joiner,
    listener: other,
    opts,
    runTimeout: opts.timeoutMs,
    // The sidebar click leaves channel 1 and opens channel 2's landing
    // (it does not auto-join while connected elsewhere); then press Join.
    // Stages are timed from the Join press, like the other scenarios.
    click: async () => {
      const at = await joiner.now();
      await joiner.page
        .getByRole("button", { name: `Open voice channel ${channelName}` })
        .first()
        .click({ timeout: 10_000 });
      const autoJoined = await joiner
        .waitForMark("join-click", at, {}, 300)
        .then(() => true)
        .catch(() => false);
      if (!autoJoined) await joiner.clickJoin();
    },
  });
  await joiner.leave();
  await sleep(1_000);
  return result;
}

async function runDisruption(kind, { joiner, listener, opts }) {
  await joiner.open(0, { standby: false });
  const since = await joiner.now();
  await joiner.clickJoin();
  await joiner.waitForMark("ui-joined", since, {}, 60_000);
  await Promise.all([
    listener.waitForAudible(since, 30_000).catch(() => undefined),
    joiner.waitForMark("peerConnection:connected", since, {}, 60_000),
  ]);
  await sleep(2_000);
  await Promise.all([joiner.startSampler(), listener.startSampler()]);
  const before = await joiner.now();
  if (kind === "drop") {
    await joiner.setNetwork("none", { offline: true });
    await sleep(opts.dropMs);
    await joiner.setNetwork("none", { offline: false });
  } else {
    await joiner.page.evaluate(() => window.__vb.setHidden(true));
    await joiner.cdp.send("Page.setWebLifecycleState", { state: "frozen" });
    await sleep(opts.hiddenMs);
    await joiner.cdp.send("Page.setWebLifecycleState", { state: "active" });
    await joiner.page.evaluate(() => window.__vb.setHidden(false));
  }
  const resumedAt = await joiner.now();
  // Recovery: signalling is healthy again (Ready or resumed on both
  // gateways) and the listener hears the joiner after the resume.
  const recovered = await joiner.page
    .waitForFunction(
      (s) => {
        const vb = window.__vb;
        const states = vb.pcs.map((pc) => pc.connectionState);
        return (
          states.includes("connected") &&
          vb.connectedText.at(-1)?.visible !== false &&
          s > 0
        );
      },
      resumedAt,
      { timeout: opts.timeoutMs, polling: 25 },
    )
    .then(() => true)
    .catch(() => false);
  await sleep(3_000);
  const [j, l] = await Promise.all([
    joiner.snapshot(before - 1),
    listener.snapshot(before - 1),
  ]);
  await Promise.all([joiner.stopSampler(), listener.stopSampler()]);
  const rel = (t) => (t == null ? null : Math.round(t - resumedAt));
  const after = (name) =>
    j.marks.find((m) => m.name === name && m.t >= resumedAt)?.t ?? null;
  const gaps = Object.values(l.rtp.inbound ?? {}).map(
    (entry) => entry.maxGap ?? 0,
  );
  const stages = {
    offlineMs: Math.round(resumedAt - before),
    roomSocket: rel(after("RoomGW:ws-open")),
    roomReady: rel(after("roomGatewayReadyAt") ?? after("mediaReadyAt")),
    voiceSocket: rel(after("VoiceGW:ws-open")),
    voiceReady: rel(after("voiceReadyAt")),
    pcConnected: rel(after("peerConnection:connected")),
    uiConnected: rel(
      j.connectedText.find((e) => e.visible && e.t >= resumedAt)?.t ?? null,
    ),
    peerMaxAudioGap: gaps.length ? Math.round(Math.max(...gaps)) : null,
    // First RTP the listener got after a stall that ended after the resume
    // (null when its audio never stalled).
    peerAudioResumed: rel(
      Object.values(l.rtp.inbound ?? {})
        .flatMap((entry) => entry.resumes ?? [])
        .map((resume) => resume.t)
        .filter((t) => t >= resumedAt)
        .sort((a, b) => a - b)[0] ?? null,
    ),
    recovered,
    reconnectedSockets: j.marks.filter(
      (m) => /:ws-open$/.test(m.name) && m.t >= before,
    ).length,
    connectedTextFlaps: j.connectedText.filter((e) => e.t >= before).length,
  };
  await joiner.leave();
  await sleep(1_500);
  return {
    stages,
    raw: opts.json ? { joiner: j, listener: l, before, resumedAt } : undefined,
  };
}

// ── Main ───────────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    const header = fs
      .readFileSync(fileURLToPath(import.meta.url), "utf8")
      .split("\n");
    console.log(
      header
        .slice(
          1,
          header.findIndex((line) => line.startsWith("import")),
        )
        .join("\n")
        .replace(/^\/\/ ?/gm, ""),
    );
    return;
  }
  if (!fs.existsSync(opts.config)) {
    throw new Error(
      `No bench config at ${opts.config}; see --help for its shape.`,
    );
  }
  const cfg = JSON.parse(fs.readFileSync(opts.config, "utf8"));
  const browser = await launch(opts);
  const needsOther = opts.scenarios.some((name) => name.startsWith("switch"));
  const joiner = await openClient(browser, cfg, "joiner", opts);
  const listener = await openClient(browser, cfg, "listener", opts);
  const other = needsOther
    ? await openClient(browser, cfg, "other", opts)
    : null;
  const results = [];
  try {
    log("listener joining channel 1");
    await ensureJoined(listener, 0, opts);
    if (other) {
      log("other joining channel 2");
      await ensureJoined(other, 1, opts);
    }
    for (const profile of opts.profiles) {
      if (!(profile in PROFILES)) throw new Error(`Unknown profile ${profile}`);
      for (const scenario of opts.scenarios) {
        for (let run = 1; run <= opts.runs; run++) {
          await joiner.setNetwork("none");
          let result;
          const ctx = { joiner, listener, other, opts };
          // Throttle after the page has loaded: we time the join, not the load.
          const throttle = () => joiner.setNetwork(profile);
          if (
            scenario === "cold" ||
            scenario === "warm" ||
            scenario === "warm-idle"
          ) {
            const t = Date.now();
            await joiner.open(0, { standby: scenario !== "cold" });
            if (opts.verbose) log(`landing ready in ${Date.now() - t} ms`);
            await throttle();
            result = await runColdOrWarmLoaded(scenario, ctx);
          } else if (scenario === "switch" || scenario === "switch-warm") {
            result = await runSwitch({
              ...ctx,
              standby: scenario === "switch-warm",
            });
          } else if (scenario === "drop" || scenario === "hidden") {
            result = await runDisruption(scenario, ctx);
          } else {
            throw new Error(`Unknown scenario ${scenario}`);
          }
          results.push({ scenario, profile, run, ...result });
          const s = result.stages;
          log(
            `${scenario}/${profile} #${run}:`,
            Object.entries(s)
              .filter(([, v]) => v !== null && typeof v !== "object")
              .map(([k, v]) => `${k}=${v}`)
              .join(" "),
          );
        }
      }
    }
  } finally {
    await joiner.leave().catch(() => undefined);
    await listener.leave().catch(() => undefined);
    await other?.leave().catch(() => undefined);
    await browser.close();
  }
  const summary = summarize(results);
  console.log(formatTable(summary));
  if (opts.json) {
    fs.writeFileSync(
      opts.json,
      JSON.stringify({ opts: { ...opts }, summary, results }, null, 2),
    );
    log(`wrote ${opts.json}`);
  }
}

async function runColdOrWarmLoaded(kind, { joiner, listener, opts }) {
  if (kind !== "cold") await waitForStandbyWarm(joiner, 0);
  await sleep(kind === "warm-idle" ? opts.idleMs : opts.settleMs);
  const result = await measureJoin({
    joiner,
    listener,
    opts,
    runTimeout: opts.timeoutMs,
  });
  await joiner.setNetwork("none");
  await joiner.leave();
  joiner.lastLeftAt = await joiner.now();
  await sleep(1_000);
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
