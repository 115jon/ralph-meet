// ── Host accessor ───────────────────────────────────────────────────────────
// getHost() is the one way UI code reaches the shell it runs in. The adapter
// is chosen by the `__IS_DESKTOP__` build flag. Each Vite config defines it,
// so the condition below is a constant and the bundler drops the adapter it
// does not pick: the web build carries no desktop adapter and no
// `@tauri-apps/api`. See docs/desktop/web-host.md.

import { createDesktopHost } from "./desktop";
import type { Host } from "./types";
import { webHost } from "./web";

export type * from "./types";
export {
  HIDDEN_THUMBNAIL_TOOLBAR_STATE,
  MESSAGE_ACTION_TYPE_ID,
} from "./types";

let selected: Host | null = null;
let injected: Host | null = null;

export function getHost(): Host {
  if (injected) return injected;
  // Inline flag check (not isDesktop()) so the branch folds at build time.
  selected ??=
    typeof __IS_DESKTOP__ !== "undefined" && __IS_DESKTOP__
      ? createDesktopHost()
      : webHost;
  return selected;
}

/**
 * Tests and fixtures: use this host instead (null restores the build's
 * own). Pass a full fake, or spread `webHost` and override a capability.
 */
export function setHostForTests(host: Host | null) {
  injected = host;
}
