// Lighthouse CI puppeteer script: signs the browser in before a /chat run.
//
// lighthouserc.cjs only loads this when LHCI_KOVA_SESSION_TOKEN is set. The
// token is never stored in the repo; pass it through the environment:
//
//   LHCI_KOVA_SESSION_TOKEN=<token> pnpm run perf
//
// How the web client reads a session (src/lib/desktop-auth.ts): the token lives
// in localStorage under `kova-auth:<publishable key>:session-token`. The key
// is the build's VITE_KOVA_AUTH_PUBLISHABLE_KEY; set LHCI_KOVA_PUBLISHABLE_KEY
// (or VITE_KOVA_AUTH_PUBLISHABLE_KEY) to write that exact key. Without either,
// the token goes under `kova-auth:lhci:session-token`, which the app adopts
// and moves under its own key on first read (getStoredKovaAuthSessionToken).
//
// Known limit: /chat is guarded on the server by the session cookie, which a
// localStorage token cannot satisfy, so the document request redirects to
// /sign-in?redirect_url=/chat and the client bridge then returns to /chat.
// The first real run should confirm which page Lighthouse ends up scoring.

const TOKEN_ENV = "LHCI_KOVA_SESSION_TOKEN";

/** @param {string} pathname */
function isSignedInPath(pathname) {
  return pathname === "/chat" || pathname.startsWith("/chat/");
}

/**
 * @param {import("puppeteer-core").Browser} browser
 * @param {{ url: string }} context
 */
module.exports = async (browser, context) => {
  const token = process.env[TOKEN_ENV];
  if (!token) return;

  const { origin, pathname } = new URL(context.url);
  // Public pages are scored signed out.
  if (!isSignedInPath(pathname)) return;

  const publishableKey =
    process.env.LHCI_KOVA_PUBLISHABLE_KEY ??
    process.env.VITE_KOVA_AUTH_PUBLISHABLE_KEY ??
    "lhci";
  const storageKey = `kova-auth:${publishableKey}:session-token`;

  const page = await browser.newPage();
  try {
    // localStorage is per origin, so load any cheap public page of the app.
    await page.goto(`${origin}/activate`, { waitUntil: "domcontentloaded" });
    await page.evaluate(
      (key, value) => window.localStorage.setItem(key, value),
      storageKey,
      token,
    );
  } finally {
    await page.close();
  }
};
