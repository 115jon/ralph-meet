// ── Tauri gateway ───────────────────────────────────────────────────────────
// The desktop adapter's one door to Rust: typed `invoke` and `listen` over
// the commands and events the host uses. Only desktop code imports this
// module, so the web build drops it. `@tauri-apps/api` is loaded on first
// use: a static import would pull it into the web entry chunk (other lazy
// importers share it), even though nothing there calls it.

import type { Channel } from "@tauri-apps/api/core";
import type { NativeDevice } from "@/lib/media-device-snapshot";
import type {
  DesktopSettings,
  DesktopSettingsSnapshot,
} from "@/stores/useDesktopSettingsStore";
import type {
  ThumbnailToolbarActionEvent,
  ThumbnailToolbarState,
  UpdateDownloadEvent,
  UpdateMetadata,
} from "./types";

/** Command name → its arguments (`undefined`: none) and its result. */
export interface DesktopCommands {
  fetch_update: { args: undefined; result: UpdateMetadata | null };
  install_update: {
    args: { onEvent: Channel<UpdateDownloadEvent> };
    result: void;
  };
  restart_app: { args: undefined; result: void };
  launch_main_window: { args: undefined; result: void };
  close_updater_window: { args: undefined; result: void };
  set_title_bar_dark_mode: { args: { dark: boolean }; result: void };
  "plugin:webview|internal_toggle_devtools": { args: undefined; result: void };
  sync_taskbar_thumbnail_toolbar: {
    args: { state: ThumbnailToolbarState };
    result: void;
  };
  set_taskbar_notification_attention: {
    args: { active: boolean };
    result: void;
  };
  get_desktop_settings: { args: undefined; result: DesktopSettingsSnapshot };
  set_desktop_settings: {
    args: { patch: Partial<DesktopSettings> };
    result: unknown;
  };
  take_pending_deep_links: { args: undefined; result: string[] };
  get_native_audio_devices: { args: undefined; result: NativeDevice[] };
  get_native_video_devices: { args: undefined; result: NativeDevice[] };
  probe_hardware_video_encoders: { args: undefined; result: unknown };
}

/** Event name → payload. Payloads typed `unknown` are validated by callers. */
export interface DesktopEvents {
  "rm://deep-link": unknown;
  "desktop-thumbnail-toolbar-action": ThumbnailToolbarActionEvent;
  "native-screen-share-ended": unknown;
}

type CommandArgs<K extends keyof DesktopCommands> =
  DesktopCommands[K]["args"] extends undefined
    ? []
    : [args: DesktopCommands[K]["args"]];

export async function invokeCommand<K extends keyof DesktopCommands>(
  command: K,
  ...args: CommandArgs<K>
): Promise<DesktopCommands[K]["result"]> {
  type Result = DesktopCommands[K]["result"];
  const { invoke } = await import("@tauri-apps/api/core");
  return args.length === 0
    ? invoke<Result>(command)
    : invoke<Result>(command, args[0]);
}

export async function listenEvent<K extends keyof DesktopEvents>(
  event: K,
  handler: (payload: DesktopEvents[K]) => void,
): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  return listen<DesktopEvents[K]>(event, (message) => handler(message.payload));
}

export async function createChannel<T>(
  onMessage: (message: T) => void,
): Promise<Channel<T>> {
  const { Channel } = await import("@tauri-apps/api/core");
  return new Channel<T>(onMessage);
}
