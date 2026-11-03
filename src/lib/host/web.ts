// ── Web host adapter ────────────────────────────────────────────────────────
// The Host in a browser: nothing native to call. Reads answer "none"
// (null, empty lists), writes are no-ops, restart reloads the page.

import type { Host } from "./types";

const noop = async () => {};
const noopUnsubscribe = () => {};

export const webHost: Host = {
  kind: "web",

  updates: {
    check: async () => null,
    install: noop,
    getAppVersion: async () => null,
  },

  window: {
    restart: async () => {
      window.location.reload();
    },
    openExternal: async (url) => {
      window.open(url, "_blank", "noopener,noreferrer");
    },
    focus: async () => {
      window.focus();
    },
    setTitleBarDarkMode: noop,
    toggleDevtools: noop,
    launchMainWindow: noop,
    closeCurrentWindow: noop,
    closeUpdaterWindow: noop,
    syncThumbnailToolbar: noop,
    onThumbnailToolbarAction: async () => noopUnsubscribe,
  },

  notifications: {
    setBadge: noop,
    showToast: noop,
  },

  settings: {
    load: async () => null,
    save: async () => null,
  },

  deepLinks: {
    subscribe: () => ({
      unsubscribe: noopUnsubscribe,
      ready: Promise.resolve(),
    }),
  },

  media: {
    listNativeAudioDevices: async () => [],
    listNativeVideoDevices: async () => [],
    probeHardwareVideoEncoders: async () => null,
    onNativeScreenShareEnded: async () => noopUnsubscribe,
  },
};
