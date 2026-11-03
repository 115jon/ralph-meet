// ── Host interface ──────────────────────────────────────────────────────────
// What the shared web UI needs from the shell it runs in, grouped by
// capability. `web.ts` implements it with browser behavior and no-ops,
// `desktop.ts` with Tauri commands and events. See docs/desktop/web-host.md.

import type { NotificationOptions } from "@tauri-apps/plugin-notification";
import type { NativeDevice } from "@/lib/media-device-snapshot";
import type {
  DesktopSettings,
  DesktopSettingsSnapshot,
} from "@/stores/useDesktopSettingsStore";

export type HostKind = "web" | "desktop";

// ── Updates ─────────────────────────────────────────────────────────────────

/** `fetch_update`'s answer when an update exists (app_updates.rs). */
export interface UpdateMetadata {
  version: string;
  currentVersion: string;
  notes: string | null;
}

/** Progress events of `install_update` (app_updates.rs `DownloadEvent`). */
export type UpdateDownloadEvent =
  | { event: "started"; data: { contentLength: number | null } }
  | { event: "progress"; data: { chunkLength: number } }
  | { event: "finished" };

export interface HostUpdates {
  /** Ask for an update. Rust keeps the answer as its one pending update. */
  check(): Promise<UpdateMetadata | null>;
  /** Download and install the pending update, streaming progress. */
  install(onEvent: (event: UpdateDownloadEvent) => void): Promise<void>;
  /** The running app's version, or null when the host has none. */
  getAppVersion(): Promise<string | null>;
}

// ── Window ──────────────────────────────────────────────────────────────────

export type ThumbnailToolbarAction =
  | "toggle-camera"
  | "toggle-mic"
  | "toggle-deafen"
  | "disconnect"
  | "toggle-media-playback"
  | "skip-media";

export interface ThumbnailToolbarState {
  visible: boolean;
  hasCamera: boolean;
  isCameraOn: boolean;
  hasMicrophone: boolean;
  isMuted: boolean;
  isDeafened: boolean;
  hasMediaControls: boolean;
  isMediaPaused: boolean;
}

export const HIDDEN_THUMBNAIL_TOOLBAR_STATE: ThumbnailToolbarState = {
  visible: false,
  hasCamera: false,
  isCameraOn: false,
  hasMicrophone: false,
  isMuted: false,
  isDeafened: false,
  hasMediaControls: false,
  isMediaPaused: false,
};

export interface ThumbnailToolbarActionEvent {
  action: ThumbnailToolbarAction;
}

export type Unsubscribe = () => void;

export interface HostWindow {
  /** Relaunch the app. */
  restart(): Promise<void>;
  /** Open a URL outside the app (desktop: the system browser). */
  openExternal(url: string): Promise<void>;
  /** Unminimize, show and focus this window. Best effort. */
  focus(): Promise<void>;
  /** Match the native title bar to the app theme. */
  setTitleBarDarkMode(dark: boolean): Promise<void>;
  toggleDevtools(): Promise<void>;
  /** Updater window: hand off to the main window (Rust shows it or trays it). */
  launchMainWindow(): Promise<void>;
  /** Updater window: close it from the JS side. */
  closeCurrentWindow(): Promise<void>;
  /** Updater window: close it from Rust when the JS close fails. */
  closeUpdaterWindow(): Promise<void>;
  /** Windows taskbar thumbnail buttons. */
  syncThumbnailToolbar(state: ThumbnailToolbarState): Promise<void>;
  onThumbnailToolbarAction(
    handler: (event: ThumbnailToolbarActionEvent) => void | Promise<void>,
  ): Promise<Unsubscribe>;
}

// ── Notifications (tray badge, taskbar attention, toasts) ───────────────────

export interface BadgeState {
  count: number;
  showDot: boolean;
  tooltip: string;
}

/** The action type id native toasts register for reply / mark read. */
export const MESSAGE_ACTION_TYPE_ID = "messages";

export interface HostNotifications {
  /** Draw the unread badge on the tray icon. Only changes cross IPC. */
  setBadge(state: BadgeState): Promise<void>;
  /** Show a native toast and flash the taskbar. */
  showToast(options: NotificationOptions): Promise<void>;
}

// ── Settings ────────────────────────────────────────────────────────────────

export interface HostSettings {
  /** Rust's settings, or null when the host does not persist any. */
  load(): Promise<DesktopSettingsSnapshot | null>;
  /**
   * Persist the changed keys. Resolves with what the host stored (unvalidated
   * JSON, the caller reads it), or null when the host does not persist any.
   */
  save(patch: Partial<DesktopSettings>): Promise<unknown>;
}

// ── Deep links ──────────────────────────────────────────────────────────────

export interface DeepLinkSubscription {
  unsubscribe: Unsubscribe;
  /** Settles once the listener is attached and queued links were collected. */
  ready: Promise<void>;
}

export interface HostDeepLinks {
  /** Receive `ralphmeet://` links. One handler at a time (the latest wins). */
  subscribe(handler: (url: string) => void): DeepLinkSubscription;
}

// ── Media devices ───────────────────────────────────────────────────────────

export interface HostMedia {
  /** OS audio devices, to tell when the browser list is complete. */
  listNativeAudioDevices(): Promise<NativeDevice[]>;
  listNativeVideoDevices(): Promise<NativeDevice[]>;
  /** The native encoder probe (null without one). Rejects on IPC failure. */
  probeHardwareVideoEncoders(): Promise<unknown>;
  /** `native-screen-share-ended` from the native share session. */
  onNativeScreenShareEnded(
    handler: (payload: unknown) => void,
  ): Promise<Unsubscribe>;
}

// ── The host ────────────────────────────────────────────────────────────────

export interface Host {
  kind: HostKind;
  updates: HostUpdates;
  window: HostWindow;
  notifications: HostNotifications;
  settings: HostSettings;
  deepLinks: HostDeepLinks;
  media: HostMedia;
}
