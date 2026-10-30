#!/usr/bin/env node
// Idle-cost probe for Ralph Meet fixture surfaces (performance-motion §5.3,
// rule 9; talk-tree-spec §6 "Idle budget").
//
// Opens /ui-fixtures?surface=<name> on a running app (dev server or a
// preview), lets each surface settle, then records an idle window and
// reports, per second: requestAnimationFrame callbacks, compositor frames,
// style recalcs, layouts, main-thread time, timer callbacks, plus how many
// animations are running (only the infinite ones are listed by name).
//
// No dependencies: it launches Chromium itself and speaks the DevTools
// protocol over Node's built-in WebSocket (Node 22+).
//
//   pnpm idle-probe http://localhost:5181
//   pnpm idle-probe http://localhost:5181 voice-live voice-many --json out.json
//   node scripts/idle-probe.mjs <baseUrl> [surface[:theme] ...]
//        [--chrome <path>] [--window <ms>] [--settle <ms>] [--json <file>]
//        [--no-budget]
//
// Chromium: --chrome, else $CHROME_PATH, else Playwright's cache, else an
// installed Chrome / Edge / Chromium.
//
// Budget (exit code 1 when exceeded, unless --no-budget):
//   rAF callbacks 0/s, compositor frames <= 2/s, style recalcs <= 1/s, and
//   no running infinite animation. Ringing surfaces (dm-call-ringing-*) are
//   exempt: their ring is the one allowed loop.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_SURFACES = [
  "voice-live",
  "voice-many",
  "dm-call-active",
  "shell",
];
const BUDGET = { rafPerSecond: 0, framesPerSecond: 2, stylePerSecond: 1 };
const EXEMPT = /^dm-call-ringing/;

// ── Arguments ──────────────────────────────────────────────────────────
function parseArgs(argv) {
  const opts = {
    base: null,
    surfaces: [],
    chrome: process.env.CHROME_PATH || null,
    windowMs: 10_000,
    settleMs: 8_000,
    json: null,
    budget: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--chrome") opts.chrome = argv[++i];
    else if (arg === "--window") opts.windowMs = Number(argv[++i]);
    else if (arg === "--settle") opts.settleMs = Number(argv[++i]);
    else if (arg === "--json") opts.json = argv[++i];
    else if (arg === "--no-budget") opts.budget = false;
    else if (arg === "--help" || arg === "-h") opts.help = true;
    else if (!opts.base && /^https?:\/\//.test(arg)) opts.base = arg;
    else opts.surfaces.push(arg);
  }
  if (opts.surfaces.length === 0) opts.surfaces = DEFAULT_SURFACES;
  return opts;
}

// ── Chromium discovery ─────────────────────────────────────────────────
function findChrome(explicit) {
  if (explicit) {
    if (fs.existsSync(explicit)) return explicit;
    throw new Error(`Chromium not found at ${explicit}`);
  }
  const candidates = [];
  const home = os.homedir();
  const pwRoots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    process.env.LOCALAPPDATA &&
      path.join(process.env.LOCALAPPDATA, "ms-playwright"),
    path.join(home, ".cache", "ms-playwright"),
    path.join(home, "Library", "Caches", "ms-playwright"),
  ].filter(Boolean);
  for (const root of pwRoots) {
    if (!fs.existsSync(root)) continue;
    const dirs = fs
      .readdirSync(root)
      .filter((d) => /^chromium-\d+$/.test(d))
      .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
    for (const d of dirs) {
      candidates.push(
        path.join(root, d, "chrome-win64", "chrome.exe"),
        path.join(root, d, "chrome-win", "chrome.exe"),
        path.join(root, d, "chrome-linux64", "chrome"),
        path.join(root, d, "chrome-linux", "chrome"),
        path.join(
          root,
          d,
          "chrome-mac",
          "Chromium.app",
          "Contents",
          "MacOS",
          "Chromium",
        ),
      );
    }
  }
  const pf = [
    process.env.PROGRAMFILES,
    process.env["PROGRAMFILES(X86)"],
    process.env.LOCALAPPDATA,
  ].filter(Boolean);
  for (const root of pf) {
    candidates.push(
      path.join(root, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(root, "Chromium", "Application", "chrome.exe"),
      path.join(root, "Microsoft", "Edge", "Application", "msedge.exe"),
    );
  }
  candidates.push(
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  );
  const found = candidates.find((c) => fs.existsSync(c));
  if (!found) {
    throw new Error(
      "No Chromium found. Pass --chrome <path> or set CHROME_PATH.",
    );
  }
  return found;
}

// ── Minimal CDP client ─────────────────────────────────────────────────
function launch(chromePath) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "rm-idle-probe-"));
  const child = spawn(
    chromePath,
    [
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--hide-scrollbars",
      "--mute-audio",
      "--window-size=1440,900",
      // Same scheduling as an automated browser, so numbers compare with
      // the audit's runs (performance-motion §2).
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  const ready = new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(
      () => reject(new Error("Chromium did not start")),
      30_000,
    );
    child.stderr.on("data", (chunk) => {
      buf += chunk.toString();
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) {
        clearTimeout(timer);
        resolve(m[1]);
      }
    });
    child.on("exit", (code) => reject(new Error(`Chromium exited (${code})`)));
  });
  const dispose = () => {
    try {
      child.kill();
    } catch {
      /* already gone */
    }
    setTimeout(
      () => fs.rmSync(profile, { recursive: true, force: true }),
      500,
    ).unref?.();
  };
  return { ready, dispose };
}

class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    this.opened = new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
    this.ws.addEventListener("message", (event) => {
      const msg = JSON.parse(
        typeof event.data === "string" ? event.data : event.data.toString(),
      );
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error)
          reject(new Error(`${msg.error.message} (${msg.error.code})`));
        else resolve(msg.result);
      } else if (msg.method) {
        for (const listener of this.listeners) listener(msg);
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) =>
      this.pending.set(id, { resolve, reject }),
    );
  }
  on(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  waitFor(predicate, timeoutMs = 60_000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new Error("CDP wait timed out"));
      }, timeoutMs);
      const off = this.on((msg) => {
        if (predicate(msg)) {
          clearTimeout(timer);
          off();
          resolve(msg);
        }
      });
    });
  }
  close() {
    this.ws.close();
  }
}

// ── In-page counters (installed before any app script runs) ────────────
const PAGE_COUNTERS = `(() => {
  const c = (window.__idle = { raf: 0, rafSources: {}, timeout: 0, interval: 0 });
  const where = () => {
    const line = (new Error().stack || "").split("\\n")[3] || "";
    const m = line.match(/\\/([^/?:)]+\\.(?:[jt]sx?|mjs))/);
    return m ? m[1] : "?";
  };
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (fn) => {
    const w = where();
    return raf((t) => { c.raf++; c.rafSources[w] = (c.rafSources[w] || 0) + 1; fn(t); });
  };
  const st = window.setTimeout.bind(window);
  window.setTimeout = (fn, ms, ...a) =>
    st(typeof fn === "function" ? (...x) => { c.timeout++; fn(...x); } : fn, ms, ...a);
  const si = window.setInterval.bind(window);
  window.setInterval = (fn, ms, ...a) =>
    si(typeof fn === "function" ? (...x) => { c.interval++; fn(...x); } : fn, ms, ...a);
})();`;

const RUNNING_ANIMATIONS = `JSON.stringify(document.getAnimations()
  .filter((a) => a.playState === "running")
  .map((a) => {
    const t = a.effect && a.effect.target;
    const timing = a.effect && a.effect.getTiming ? a.effect.getTiming() : {};
    const cls = t ? String((t.className && t.className.baseVal) ?? t.className ?? "").split(" ").slice(0, 3).join(".") : "";
    return {
      name: a.animationName || a.transitionProperty || a.constructor.name,
      iterations: timing.iterations === Infinity ? "infinite" : timing.iterations,
      el: t ? t.tagName.toLowerCase() + (cls ? "." + cls : "") : "?",
    };
  }))`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function evaluate(cdp, sessionId, expression) {
  const res = await cdp.send(
    "Runtime.evaluate",
    { expression, returnByValue: true, awaitPromise: true },
    sessionId,
  );
  return res.result?.value;
}

async function probeSurface(cdp, base, spec, opts) {
  const [surface, theme = "dark"] = spec.split(":");
  const { targetId } = await cdp.send("Target.createTarget", {
    url: "about:blank",
  });
  const { sessionId } = await cdp.send("Target.attachToTarget", {
    targetId,
    flatten: true,
  });
  const errors = [];
  const offErrors = cdp.on((msg) => {
    if (
      msg.sessionId === sessionId &&
      msg.method === "Runtime.exceptionThrown"
    ) {
      errors.push(
        String(
          msg.params.exceptionDetails?.exception?.description ??
            msg.params.exceptionDetails?.text,
        ).slice(0, 160),
      );
    }
  });
  try {
    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Runtime.enable", {}, sessionId);
    await cdp.send(
      "Emulation.setDeviceMetricsOverride",
      { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false },
      sessionId,
    );
    await cdp.send(
      "Emulation.setEmulatedMedia",
      {
        features: [
          {
            name: "prefers-color-scheme",
            value: theme.includes("light") ? "light" : "dark",
          },
        ],
      },
      sessionId,
    );
    await cdp.send(
      "Page.addScriptToEvaluateOnNewDocument",
      { source: PAGE_COUNTERS },
      sessionId,
    );
    const url = new URL("/ui-fixtures", base);
    url.searchParams.set("surface", surface);
    url.searchParams.set("theme", theme);
    const loaded = cdp.waitFor(
      (m) => m.sessionId === sessionId && m.method === "Page.loadEventFired",
      120_000,
    );
    await cdp.send("Page.navigate", { url: url.href }, sessionId);
    await loaded;
    for (let i = 0; i < 60; i++) {
      const n = await evaluate(
        cdp,
        sessionId,
        `document.querySelectorAll("body *").length`,
      );
      if (n > 60) break;
      await sleep(300);
    }
    await sleep(opts.settleMs);

    const animations = JSON.parse(
      (await evaluate(cdp, sessionId, RUNNING_ANIMATIONS)) || "[]",
    );
    await cdp.send("Performance.enable", {}, sessionId);
    await evaluate(
      cdp,
      sessionId,
      `(() => { const c = window.__idle; if (c) { c.raf = c.timeout = c.interval = 0; c.rafSources = {}; } })()`,
    );
    const metrics = async () =>
      Object.fromEntries(
        (await cdp.send("Performance.getMetrics", {}, sessionId)).metrics.map(
          (m) => [m.name, m.value],
        ),
      );
    const m0 = await metrics();

    const events = [];
    const offData = cdp.on((msg) => {
      if (msg.method === "Tracing.dataCollected")
        events.push(...msg.params.value);
    });
    await cdp.send("Tracing.start", {
      transferMode: "ReportEvents",
      traceConfig: {
        includedCategories: [
          "devtools.timeline",
          "disabled-by-default-devtools.timeline.frame",
          "toplevel",
          "viz",
          "cc",
        ],
      },
    });
    await sleep(opts.windowMs);
    const done = cdp.waitFor(
      (m) => m.method === "Tracing.tracingComplete",
      60_000,
    );
    await cdp.send("Tracing.end");
    await done;
    offData();
    const m1 = await metrics();
    const counters =
      (await evaluate(cdp, sessionId, `JSON.stringify(window.__idle || {})`)) ??
      "{}";
    const c = JSON.parse(counters);

    // Trace: compositor frames = MainFrame.Draw complete events on the
    // renderer's Compositor thread (one per produced frame).
    const threads = {};
    for (const e of events)
      if (e.ph === "M" && e.name === "thread_name")
        threads[`${e.pid}:${e.tid}`] = e.args?.name;
    let frames = 0;
    let drawFrames = 0;
    for (const e of events) {
      const t = threads[`${e.pid}:${e.tid}`];
      if (e.name === "MainFrame.Draw" && e.ph === "X" && t === "Compositor")
        frames++;
      if (e.name === "DrawFrame" && t === "Compositor") drawFrames++;
    }
    const secs = opts.windowMs / 1000;
    const d = (k) => (m1[k] ?? 0) - (m0[k] ?? 0);
    const infinite = animations.filter((a) => a.iterations === "infinite");
    const result = {
      surface,
      theme,
      rafPerSecond: +(c.raf / secs).toFixed(1),
      framesPerSecond: +((frames || drawFrames) / secs).toFixed(1),
      stylePerSecond: +(d("RecalcStyleCount") / secs).toFixed(1),
      layoutsPerSecond: +(d("LayoutCount") / secs).toFixed(1),
      mainThreadMsPerSecond: +((d("TaskDuration") * 1000) / secs).toFixed(2),
      timeoutsPerSecond: +(c.timeout / secs).toFixed(1),
      intervalsPerSecond: +(c.interval / secs).toFixed(1),
      runningAnimations: animations.length,
      infiniteAnimations: infinite,
      rafSources: c.rafSources,
      errors: errors.slice(0, 3),
    };
    return result;
  } finally {
    offErrors();
    await cdp.send("Target.closeTarget", { targetId }).catch(() => {});
  }
}

function overBudget(r) {
  if (EXEMPT.test(r.surface)) return [];
  const fails = [];
  if (r.rafPerSecond > BUDGET.rafPerSecond)
    fails.push(`rAF ${r.rafPerSecond}/s`);
  if (r.framesPerSecond > BUDGET.framesPerSecond)
    fails.push(`frames ${r.framesPerSecond}/s`);
  if (r.stylePerSecond > BUDGET.stylePerSecond)
    fails.push(`style ${r.stylePerSecond}/s`);
  if (r.infiniteAnimations.length > 0)
    fails.push(`${r.infiniteAnimations.length} infinite animation(s)`);
  return fails;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts.base) {
    console.log(
      "usage: node scripts/idle-probe.mjs <baseUrl> [surface[:theme] ...] [--chrome path] [--window ms] [--settle ms] [--json file] [--no-budget]",
    );
    process.exit(opts.help ? 0 : 2);
  }
  if (typeof WebSocket !== "function")
    throw new Error("Node 22+ is required (global WebSocket).");
  const chromePath = findChrome(opts.chrome);
  console.log(`chromium: ${chromePath}`);
  console.log(
    `budget: rAF ${BUDGET.rafPerSecond}/s, frames <= ${BUDGET.framesPerSecond}/s, style <= ${BUDGET.stylePerSecond}/s, no infinite animations (ringing exempt)\n`,
  );
  const browser = launch(chromePath);
  const results = [];
  let failed = false;
  try {
    const cdp = new Cdp(await browser.ready);
    await cdp.opened;
    for (const spec of opts.surfaces) {
      const r = await probeSurface(cdp, opts.base, spec, opts);
      const fails = overBudget(r);
      r.budget = EXEMPT.test(r.surface)
        ? "exempt"
        : fails.length
          ? "over"
          : "ok";
      if (fails.length) failed = true;
      results.push(r);
      const anims = r.infiniteAnimations
        .map((a) => `${a.name}@${a.el}`)
        .join(", ");
      console.log(
        `${(r.surface + ":" + r.theme).padEnd(26)} rAF ${String(r.rafPerSecond).padStart(5)}/s  frames ${String(r.framesPerSecond).padStart(5)}/s  style ${String(r.stylePerSecond).padStart(5)}/s  main ${String(r.mainThreadMsPerSecond).padStart(6)} ms/s  anims ${r.runningAnimations}${anims ? ` [${anims}]` : ""}  ${r.budget}${fails.length ? ` (${fails.join(", ")})` : ""}${r.errors.length ? `  errors: ${r.errors.length}` : ""}`,
      );
    }
    cdp.close();
  } finally {
    browser.dispose();
  }
  if (opts.json) fs.writeFileSync(opts.json, JSON.stringify(results, null, 2));
  if (failed && opts.budget) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(2);
});
