#!/usr/bin/env node
// Privacy and cleanup checks for warm voice standby (PR #73), against a
// running dev server with the bench accounts (see bench.mjs --help).
//
// The listener sits in voice channel 1. The joiner opens channel 1 without
// joining, so it warms a standby session, and the script checks:
//   - no getUserMedia before the Join click (no mic indicator),
//   - the joiner receives no audio RTP before joining,
//   - the joiner sends no audio RTP while idle in standby,
//   - the listener never pulls the standby's track, and the joiner's name
//     never shows in the listener's voice UI while it is only in standby,
//   - the voice room never sees the standby identify (dev server log),
//   - a hidden tab drops standby after the grace period, offline drops it
//     at once, leaving the server (to DMs) drops it.
// Prints PASS/FAIL per check with the evidence; exit code 1 on any FAIL.
//
//   pnpm bench:voice:verify [--config <file>] [--server-log <file>]
//
// --server-log: the dev server's stdout log, to count VoiceIdentify lines
// (for oxmgr: %LOCALAPPDATA%/oxmgr/logs/<app>.out.log).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { launch, log, openClient, sleep } from "./clients.mjs";

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
};
const opts = {
  config: argValue(
    "--config",
    path.join(os.homedir(), ".cache", "ralph-voice-bench", "config.json"),
  ),
  serverLog: argValue("--server-log", null),
  hiddenGraceMs: Number(argValue("--hidden-grace", "15000")),
  verbose: args.includes("--verbose"),
  login: args.includes("--login"),
};

const results = [];
function check(name, pass, evidence) {
  results.push({ name, pass, evidence });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}\n      ${evidence}`);
}

function serverLogSize() {
  if (!opts.serverLog || !fs.existsSync(opts.serverLog)) return null;
  return fs.statSync(opts.serverLog).size;
}
function serverLogSince(offset) {
  if (offset == null) return null;
  const fd = fs.openSync(opts.serverLog, "r");
  const size = fs.fstatSync(fd).size;
  const buffer = Buffer.alloc(Math.max(0, size - offset));
  fs.readSync(fd, buffer, 0, buffer.length, offset);
  fs.closeSync(fd);
  return buffer.toString("utf8");
}

const outboundPackets = (snapshot) =>
  Object.values(snapshot.rtp.outbound ?? {}).reduce(
    (sum, entry) => sum + (entry.packets - entry.packetsAtFirstSeen),
    0,
  );
const inboundPackets = (snapshot) =>
  Object.values(snapshot.rtp.inbound ?? {}).reduce(
    (sum, entry) => sum + entry.packets,
    0,
  );
const livePcs = (snapshot) =>
  snapshot.pcStates.filter((state) => state.connection !== "closed").length;

async function main() {
  const cfg = JSON.parse(fs.readFileSync(opts.config, "utf8"));
  const browser = await launch({ chrome: process.env.CHROME_PATH });
  const joiner = await openClient(browser, cfg, "joiner", opts);
  const listener = await openClient(browser, cfg, "listener", opts);
  try {
    log("listener joining channel 1");
    await listener.open(0, { standby: false });
    let since = await listener.now();
    await listener.clickJoin();
    await listener.waitForMark("ui-joined", since, {}, 60_000);
    await listener.waitForMark("peerConnection:connected", since, {}, 60_000);
    const joinerName = cfg.users.joiner.name ?? "Latency A";
    const nameCount = () =>
      listener.page.evaluate(
        (name) => document.body.innerText.split(name).length - 1,
        joinerName,
      );
    await sleep(2_000);
    const namesBefore = await nameCount();

    // ── Warm standby, idle ───────────────────────────────────────────
    const logOffset = serverLogSize();
    await listener.startSampler();
    const listenerSince = await listener.now();
    await joiner.open(0, { standby: true });
    const opened = await joiner.now();
    await joiner
      .waitForMark(
        "peerConnection:connected",
        opened - 30_000,
        { standby: true },
        20_000,
      )
      .catch(() => undefined);
    await joiner.startSampler();
    await sleep(4_000);
    const idleA = await joiner.snapshot(0);
    await sleep(4_000);
    const idleB = await joiner.snapshot(0);
    const listenerSnap = await listener.snapshot(listenerSince);
    const namesDuring = await nameCount();
    const warmed = idleB.marks.some(
      (mark) =>
        mark.name === "peerConnection:connected" && mark.detail?.standby,
    );
    check(
      "standby warmed (precondition)",
      warmed,
      `standby peer connection connected: ${warmed}; live PCs ${livePcs(idleB)}`,
    );
    const gumBeforeJoin = idleB.gum.filter((entry) => entry.audio);
    check(
      "no microphone capture before Join",
      gumBeforeJoin.length === 0,
      `getUserMedia(audio) calls while browsing: ${gumBeforeJoin.length}`,
    );
    check(
      "standby receives no audio",
      inboundPackets(idleB) === 0,
      `inbound audio RTP packets on the joiner: ${inboundPackets(idleB)}`,
    );
    const idleSent = outboundPackets(idleB) - outboundPackets(idleA);
    check(
      "standby sends no audio while idle",
      idleSent === 0,
      `outbound audio packets over 4 s of idle standby: ${idleSent}`,
    );
    const listenerPulls = listenerSnap.marks.filter(
      (mark) => mark.name === "pullRequestedAt",
    );
    check(
      "listener never pulls the standby track",
      listenerPulls.length === 0,
      `listener pull requests while joiner in standby: ${listenerPulls.length}`,
    );
    check(
      "standby not shown in the listener's UI",
      namesDuring === namesBefore,
      `"${joinerName}" occurrences on the listener page: before ${namesBefore}, during standby ${namesDuring}`,
    );
    const serverText = serverLogSince(logOffset);
    if (serverText != null) {
      const identifies = (
        serverText.match(/VoiceIdentify: participant=/g) ?? []
      ).length;
      const roomIdentify = (serverText.match(/Identify: name=/g) ?? []).length;
      check(
        "voice room never sees the standby",
        identifies === 0,
        `VoiceIdentify lines in the server log during standby: ${identifies} (hidden room identifies: ${roomIdentify})`,
      );
    }

    // ── Join after standby: capture starts at the click ──────────────
    since = await joiner.now();
    await joiner.clickJoin();
    await listener.waitForAudible(since, 20_000).catch(() => undefined);
    await sleep(1_500);
    const namesJoined = await nameCount();
    check(
      "control: the listener's UI does show the joiner once joined",
      namesJoined > namesDuring,
      `"${joinerName}" occurrences on the listener page after the join: ${namesJoined}`,
    );
    const joined = await joiner.snapshot(0);
    const firstGum = joined.gum.find((entry) => entry.audio);
    check(
      "microphone opens only after the click, and the listener hears it",
      !!firstGum &&
        firstGum.start >= since - 5 &&
        Object.values((await listener.snapshot(since)).rtp.inbound).some(
          (entry) => entry.firstAudible && entry.firstAudible >= since,
        ),
      `first getUserMedia ${firstGum ? Math.round(firstGum.start - since) : "none"} ms after the click`,
    );
    await joiner.leave();
    await sleep(2_000);
    const afterLeave = await joiner.snapshot(0);
    const liveMics = afterLeave.gum
      .flatMap((entry) => entry.tracks)
      .filter((track) => track.kind === "audio" && track.live).length;
    check(
      "leave stops the microphone",
      liveMics === 0,
      `live microphone tracks after leave: ${liveMics}`,
    );

    // ── Cleanup: hidden tab ──────────────────────────────────────────
    await joiner.open(0, { standby: true });
    let mark = await joiner.now();
    await joiner
      .waitForMark(
        "peerConnection:connected",
        mark - 30_000,
        { standby: true },
        20_000,
      )
      .catch(() => undefined);
    await joiner.page.evaluate(() => window.__vb.setHidden(true));
    await sleep(opts.hiddenGraceMs / 2);
    const hiddenEarly = livePcs(await joiner.snapshot(0));
    await sleep(opts.hiddenGraceMs / 2 + 2_000);
    const hiddenLate = livePcs(await joiner.snapshot(0));
    check(
      "hidden tab drops standby after the grace period",
      hiddenEarly > 0 && hiddenLate === 0,
      `live PCs: ${hiddenEarly} at half the grace period, ${hiddenLate} after it`,
    );
    mark = await joiner.now();
    await joiner.page.evaluate(() => window.__vb.setHidden(false));
    const rewarmed = await joiner
      .waitForMark("peerConnection:connected", mark, { standby: true }, 20_000)
      .then(() => true)
      .catch(() => false);
    check(
      "visible again rewarms standby",
      rewarmed,
      `standby reconnected: ${rewarmed}`,
    );

    // ── Cleanup: offline ─────────────────────────────────────────────
    await joiner.context.setOffline(true);
    await sleep(1_500);
    const offlinePcs = livePcs(await joiner.snapshot(0));
    await joiner.context.setOffline(false);
    check(
      "offline drops standby at once",
      offlinePcs === 0,
      `live PCs 1.5 s after going offline: ${offlinePcs}`,
    );

    // ── Cleanup: leave the server ────────────────────────────────────
    mark = await joiner.now();
    await joiner
      .waitForMark("peerConnection:connected", mark, { standby: true }, 20_000)
      .catch(() => undefined);
    await joiner.page
      .getByRole("button", { name: "Direct messages", exact: true })
      .first()
      .click({ timeout: 10_000 });
    await sleep(3_000);
    const afterSwitch = livePcs(await joiner.snapshot(0));
    check(
      "leaving the server drops standby",
      afterSwitch === 0,
      `live PCs after switching to DMs: ${afterSwitch}`,
    );
  } finally {
    await listener.leave().catch(() => undefined);
    await browser.close();
  }
  const failed = results.filter((result) => !result.pass).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
