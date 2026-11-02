// ── Runtime detection ───────────────────────────────────────────────────────
// The one place that answers "which shell is this?". It imports nothing, so
// any module (auth included) can use it without an import cycle.
//
// - isDesktop() / isMobile(): build flags. Each Vite config defines
//   `__IS_DESKTOP__` and `__IS_MOBILE__` (web: both false), so in a build the
//   check is a constant and the bundler drops the other platform's branches.
//   Vitest defines neither; the typeof guard makes them false there unless a
//   test stubs the global.
// - isTauri(): runtime check for any Tauri webview (desktop or mobile). Use
//   it only for behavior both native shells share (bearer-token auth, the
//   client-only SPA root). Desktop-only native calls go through
//   `getHost()` (src/lib/host) or check isDesktop().

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

/** True in the desktop build (Tauri on Windows/macOS/Linux). */
export function isDesktop(): boolean {
  return typeof __IS_DESKTOP__ !== "undefined" && __IS_DESKTOP__ === true;
}

/** True in the mobile build (Tauri on iOS/Android). */
export function isMobile(): boolean {
  return typeof __IS_MOBILE__ !== "undefined" && __IS_MOBILE__ === true;
}

/**
 * True inside any Tauri webview. Tauri injects `__TAURI_INTERNALS__` into
 * the window object.
 */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
