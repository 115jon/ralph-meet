// Signed-in browser clients for the voice latency scripts (bench.mjs,
// verify-standby.mjs): Chromium with a fake tone microphone, the probe
// injected before the app loads, CDP for network/lifecycle emulation.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { TONE_FILE_NAME, writeToneWav } from "./tone.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

export const PROFILES = {
  none: null,
  rtt300: { latency: 150, downloadThroughput: -1, uploadThroughput: -1 },
  fast3g: {
    latency: 75,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  },
  slow3g: {
    latency: 200,
    downloadThroughput: (400 * 1024) / 8,
    uploadThroughput: (400 * 1024) / 8,
  },
};
// CDP latency is added per direction-less request round trip; the names
// above give the effective RTT (rtt300 = 150 ms each way on WebSockets).

export function findChromium(explicit) {
  if (explicit) return explicit;
  const roots = [
    process.env.LOCALAPPDATA &&
      path.join(process.env.LOCALAPPDATA, "ms-playwright"),
    path.join(os.homedir(), ".cache", "ms-playwright"),
    path.join(os.homedir(), "Library", "Caches", "ms-playwright"),
  ].filter(Boolean);
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const builds = fs
      .readdirSync(root)
      .filter((name) => /^chromium-\d+$/.test(name))
      .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
    for (const build of builds) {
      for (const rel of [
        ["chrome-win64", "chrome.exe"],
        ["chrome-win", "chrome.exe"],
        ["chrome-linux", "chrome"],
        ["chrome-linux64", "chrome"],
        ["chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"],
      ]) {
        const candidate = path.join(root, build, ...rel);
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  }
  return undefined; // let Playwright try its own default
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const started = Date.now();
export const log = (...args) =>
  console.error(
    `[bench +${((Date.now() - started) / 1000).toFixed(1)}s]`,
    ...args,
  );

// ── Clients ────────────────────────────────────────────────────────────
export class Client {
  constructor(role, context, page, cdp, cfg) {
    this.role = role;
    this.context = context;
    this.page = page;
    this.cdp = cdp;
    this.cfg = cfg;
  }

  channelUrl(index) {
    const { baseUrl, serverId, channels } = this.cfg;
    return `${baseUrl}/chat/${encodeURIComponent(serverId)}/${encodeURIComponent(channels[index])}`;
  }

  now() {
    return this.page.evaluate(() => performance.timeOrigin + performance.now());
  }

  /** Loads a voice channel page fresh, with warm standby on or off. */
  async open(channelIndex, { standby }) {
    if (this.standby !== standby) {
      // The switch is read when standby starts, so set it before the load.
      // Any same-origin static file gives us the origin's localStorage.
      await this.page.goto(`${this.cfg.baseUrl}/favicon.ico`, {
        waitUntil: "load",
        timeout: 120_000,
      });
      await this.page.evaluate((on) => {
        if (on) localStorage.removeItem("ralph:voice-standby");
        else localStorage.setItem("ralph:voice-standby", "off");
      }, standby);
      this.standby = standby;
    }
    await this.page.goto(this.channelUrl(channelIndex), {
      waitUntil: "domcontentloaded",
      timeout: 120_000,
    });
    await this.joinButton().waitFor({ state: "visible", timeout: 90_000 });
  }

  joinButton() {
    return this.page.getByRole("button", { name: "Join voice", exact: true });
  }

  leaveButton() {
    return this.page
      .getByRole("button", { name: /^(Leave call|Disconnect|Leave voice)$/ })
      .first();
  }

  async clickJoin() {
    await this.joinButton().click({ timeout: 30_000 });
  }

  /** Leaves voice (if joined) and waits for the landing to come back. */
  async leave() {
    const button = this.leaveButton();
    if (await button.isVisible().catch(() => false)) {
      // The dock button can sit under a hover layer; press it directly.
      await button
        .evaluate((element) => element.click())
        .catch(() => undefined);
      // Left once every voice peer connection is closed.
      await this.page
        .waitForFunction(
          () => window.__vb.pcs.every((pc) => pc.connectionState === "closed"),
          null,
          { timeout: 5_000, polling: 50 },
        )
        .catch(() => undefined);
    }
  }

  async setNetwork(profileName, { offline = false } = {}) {
    const profile = PROFILES[profileName];
    await this.cdp.send("Network.enable");
    await this.cdp.send("Network.emulateNetworkConditions", {
      offline,
      latency: profile?.latency ?? 0,
      downloadThroughput: profile?.downloadThroughput ?? -1,
      uploadThroughput: profile?.uploadThroughput ?? -1,
    });
  }

  startSampler() {
    return this.page.evaluate(() => window.__vb.startSampler(20, 0.01));
  }

  stopSampler() {
    return this.page.evaluate(() => window.__vb.stopSampler());
  }

  snapshot(since) {
    return this.page.evaluate((s) => window.__vb.snapshot(s), since);
  }

  /** Waits for a `voice:<name>` mark after `since` whose detail matches `detail`. */
  waitForMark(name, since, detail = {}, timeout = 20_000) {
    return this.page.waitForFunction(
      ([n, s, d]) =>
        window.__vb
          .marks(s)
          .some(
            (mark) =>
              mark.name === n &&
              Object.entries(d).every(
                ([key, value]) => mark.detail?.[key] === value,
              ),
          ),
      [name, since, detail],
      { timeout, polling: 25 },
    );
  }

  /** Resolves once this page hears audio on a stream first heard after `since`. */
  waitForAudible(since, timeout) {
    return this.page.waitForFunction(
      (s) =>
        Object.values(window.__vb.rtp.inbound).some(
          (entry) => entry.firstAudible && entry.firstAudible >= s,
        ),
      since,
      { timeout, polling: 25 },
    );
  }
}

export async function launch(opts) {
  const tone = path.join(os.tmpdir(), TONE_FILE_NAME);
  if (!fs.existsSync(tone)) writeToneWav(tone);
  return chromium.launch({
    executablePath: findChromium(opts.chrome),
    headless: !opts.headed,
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-audio-capture=${tone}`,
      "--autoplay-policy=no-user-gesture-required",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
    ],
  });
}

export async function signIn(browser, cfg, role, statePath) {
  const user = cfg.users[role];
  if (!user) throw new Error(`config.users.${role} is missing`);
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${cfg.baseUrl}/sign-in`, {
    waitUntil: "domcontentloaded",
    timeout: 120_000,
  });
  await page.waitForSelector("input[type=email]", { timeout: 90_000 });
  await page.fill("input[type=email]", user.email);
  if (!(await page.$("input[type=password]"))) {
    await page.click("button[type=submit]");
    await page.waitForSelector("input[type=password]");
  }
  await page.fill("input[type=password]", user.password);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/chat/, { timeout: 60_000 });
  await context.storageState({ path: statePath });
  await context.close();
}

export async function openClient(browser, cfg, role, opts) {
  const dir = path.dirname(opts.config);
  const statePath = path.join(dir, `state-${role}.json`);
  if (opts.login || !fs.existsSync(statePath)) {
    log(`signing in ${role}`);
    await signIn(browser, cfg, role, statePath);
  }
  const context = await browser.newContext({
    storageState: statePath,
    viewport: { width: 1440, height: 900 },
    permissions: ["microphone", "camera"],
  });
  await context.addInitScript({ path: path.join(here, "probe-init.js") });
  // The "switch voice channel?" confirmation's own "don't ask again", so a
  // sidebar click into another voice channel switches straight away.
  await context.addInitScript(() => {
    try {
      localStorage.setItem("rm-voice-switch-skip-confirm", "true");
    } catch {
      // Opaque origins (about:blank) have no storage.
    }
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => {
    if (opts.verbose)
      log(`${role} pageerror`, String(error.message).slice(0, 200));
  });
  const cdp = await context.newCDPSession(page);
  const client = new Client(role, context, page, cdp, cfg);
  client.sfuLog = [];
  // SFU errors (errorCode/errorDescription only; no SDP, no tokens).
  page.on("response", async (response) => {
    if (!/\/partytracks\//.test(response.url())) return;
    const at = performance.timeOrigin + performance.now();
    let error = null;
    try {
      const body = await response.json();
      if (body?.errorCode)
        error = `${body.errorCode}: ${body.errorDescription ?? ""}`;
      for (const track of body?.tracks ?? []) {
        if (track.errorCode)
          error = `${track.errorCode}: ${track.errorDescription ?? ""}`;
      }
    } catch {
      // not JSON
    }
    const entry = {
      t: at,
      path: new URL(response.url()).pathname
        .replace(/^.*\/partytracks/, "")
        .replace(/sessions\/[^/]+/, "sessions/S"),
      status: response.status(),
      error,
    };
    client.sfuLog.push(entry);
    if (opts.traceSfu && (error || response.status() >= 400)) {
      log(`${role} SFU ${entry.path} ${entry.status} ${error ?? ""}`);
    }
  });
  return client;
}
