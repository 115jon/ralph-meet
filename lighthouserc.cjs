// Lighthouse CI: `pnpm run perf` builds, serves the build with `vite preview`,
// runs each page five times as a throttled phone, and reports the median run.
// Reports stay on disk (.lighthouseci/reports), never uploaded.
//
// Public pages always run. The signed-in chat shell only runs when
// LHCI_KOVA_SESSION_TOKEN is set; scripts/lhci-auth.cjs then seeds that token
// into the browser before each /chat run. Without the variable the signed-in
// URL is skipped and no browser script is loaded.
const path = require("node:path");

// LHCI_PORT lets two checkouts measure side by side.
const PORT = process.env.LHCI_PORT ?? "4801";
const BASE = `http://localhost:${PORT}`;

const signedIn = Boolean(process.env.LHCI_KOVA_SESSION_TOKEN);

// puppeteer-core does not find Chrome on its own, so mirror what Lighthouse
// does: CHROME_PATH first, then chrome-launcher's discovery (a dependency of
// @lhci/cli, resolved from there because pnpm does not hoist it).
function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  try {
    const lhciDir = path.dirname(require.resolve("@lhci/cli/package.json"));
    const launcher = require(
      require.resolve("chrome-launcher", { paths: [lhciDir] }),
    );
    return launcher.Launcher.getFirstInstallation();
  } catch {
    return undefined;
  }
}

const settings = {
  onlyCategories: ["performance", "accessibility", "best-practices"],
};

const collect = {
  startServerCommand: `pnpm run preview --port ${PORT} --strictPort`,
  startServerReadyPattern: `localhost:${PORT}`,
  url: [
    // Landing page.
    `${BASE}/`,
    // Kova sign-in page (the auth card is the page).
    `${BASE}/sign-in`,
    // Device activation: signed-out view of the "enter your code" flow.
    `${BASE}/activate`,
    // Guest lobby of a meeting room: name prompt only, no media is opened
    // until a guest joins, so the slug does not need to exist.
    `${BASE}/room/lighthouse`,
  ],
  numberOfRuns: 5,
  settings,
};

if (signedIn) {
  // Signed-in chat shell, last so the public pages run before the token is
  // seeded into the browser.
  collect.url.push(`${BASE}/chat`);
  collect.puppeteerScript = "./scripts/lhci-auth.cjs";
  collect.chromePath = findChrome();
  // chromeFlags are ignored when a puppeteerScript launches the browser.
  collect.puppeteerLaunchOptions = { headless: true, args: ["--no-sandbox"] };
  // Lighthouse clears storage before each run, which would drop the seeded
  // session token. The catch: this also keeps the HTTP cache, so in signed-in
  // mode runs 2-5 of every URL start warm. Compare signed-in numbers only with
  // other signed-in numbers.
  settings.disableStorageReset = true;
} else {
  settings.chromeFlags = "--headless=new --no-sandbox";
}

module.exports = {
  ci: {
    collect,
    assert: {
      // No baseline yet: everything warns. Raise accessibility and
      // best-practices to "error" once the first reports show a stable score.
      assertions: {
        "categories:performance": ["warn", { minScore: 0.9 }],
        "categories:accessibility": ["warn", { minScore: 0.9 }],
        "categories:best-practices": ["warn", { minScore: 0.9 }],
      },
    },
    upload: { target: "filesystem", outputDir: ".lighthouseci/reports" },
  },
};
