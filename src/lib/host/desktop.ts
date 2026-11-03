// ── Desktop host adapter ────────────────────────────────────────────────────
// The Host over Tauri: commands and events through tauri-gateway, plus the
// tray badge and toast modules. Only reachable from getHost() when
// `__IS_DESKTOP__` is true, so the web build leaves it out. Tauri modules
// are imported on use (see tauri-gateway.ts).

import { subscribeDesktopDeepLinks } from "@/lib/desktop-deep-link";
import {
  showDesktopToast,
  ensureNotificationPluginReady,
} from "./desktop-toasts";
import { applyTrayBadge } from "./desktop-tray";
import { createChannel, invokeCommand, listenEvent } from "./tauri-gateway";
import type { Host } from "./types";

export function createDesktopHost(): Host {
  return {
    kind: "desktop",

    updates: {
      check: () => invokeCommand("fetch_update"),
      install: async (onEvent) =>
        invokeCommand("install_update", {
          onEvent: await createChannel(onEvent),
        }),
      getAppVersion: async () => {
        const { getVersion } = await import("@tauri-apps/api/app");
        return getVersion();
      },
    },

    window: {
      restart: () => invokeCommand("restart_app"),
      openExternal: async (url) => {
        const { openUrl } = await import("@tauri-apps/plugin-opener");
        await openUrl(url);
      },
      focus: async () => {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const current = getCurrentWindow();
        await current.unminimize().catch(() => {
          /* window is already restored */
        });
        await current.show().catch(() => {
          /* window may already be visible */
        });
        await current.setFocus().catch(() => {
          /* focus is best-effort */
        });
      },
      setTitleBarDarkMode: (dark) =>
        invokeCommand("set_title_bar_dark_mode", { dark }),
      toggleDevtools: () =>
        invokeCommand("plugin:webview|internal_toggle_devtools"),
      launchMainWindow: () => invokeCommand("launch_main_window"),
      closeCurrentWindow: async () => {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().close();
      },
      closeUpdaterWindow: () => invokeCommand("close_updater_window"),
      syncThumbnailToolbar: (state) =>
        invokeCommand("sync_taskbar_thumbnail_toolbar", { state }),
      onThumbnailToolbarAction: (handler) =>
        listenEvent("desktop-thumbnail-toolbar-action", (payload) => {
          void handler(payload);
        }),
    },

    notifications: {
      setBadge: async (state) => {
        await ensureNotificationPluginReady();
        await applyTrayBadge(state);
      },
      showToast: showDesktopToast,
    },

    settings: {
      load: () => invokeCommand("get_desktop_settings"),
      save: (patch) => invokeCommand("set_desktop_settings", { patch }),
    },

    deepLinks: {
      subscribe: subscribeDesktopDeepLinks,
    },

    media: {
      listNativeAudioDevices: () => invokeCommand("get_native_audio_devices"),
      listNativeVideoDevices: () => invokeCommand("get_native_video_devices"),
      probeHardwareVideoEncoders: () =>
        invokeCommand("probe_hardware_video_encoders"),
      onNativeScreenShareEnded: (handler) =>
        listenEvent("native-screen-share-ended", handler),
    },
  };
}
