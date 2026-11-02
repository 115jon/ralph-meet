// ============================================================================
// Desktop Settings Store — Zustand + persist
//
// OS-level preferences for the desktop app (Tauri): autostart, close-to-tray,
// start-minimized, hardware acceleration, desktop notifications, game capture.
//
// On desktop, Rust owns and persists these (desktop-settings.json), so they
// apply at launch before any webview loads. This store mirrors them: it
// hydrates from `get_desktop_settings` and sends changes with one
// `set_desktop_settings`. localStorage keeps a copy for first paint and for
// the web build, and is the source of the one-time migration to Rust.
// See docs/desktop/window-shell.md.
// ============================================================================

import { isDesktop } from "@/lib/platform";
import { clog } from "@/lib/console-logger";
import { readBoolean, readObject } from "@/lib/persisted-guard";
import { create } from "zustand";
import { persist } from "zustand/middleware";

const log = clog("DesktopSettings");

export interface DesktopSettings {
  /** Open Ralph Meet when you log in to your computer */
  openOnStartup: boolean;
  /** Start the app minimized (hidden in tray) */
  startMinimized: boolean;
  /** Close button minimizes to system tray instead of quitting */
  closeToTray: boolean;
  /** Use GPU acceleration for the desktop CEF renderer */
  hardwareAcceleration: boolean;
  /** Show native OS notifications for desktop chat activity */
  desktopNotifications: boolean;
  /** Capture games with the game capture hook when possible (else WGC only) */
  gameCaptureHook: boolean;
}

/** What `get_desktop_settings` returns. */
export interface DesktopSettingsSnapshot {
  settings: DesktopSettings;
  /** False until Rust has written its settings file once. */
  persisted: boolean;
}

interface DesktopSettingsState extends DesktopSettings {
  /** Change settings; Rust persists them. Failures are logged and reverted. */
  updateSettings: (updates: Partial<DesktopSettings>) => void;
  /**
   * Change settings and wait until Rust has persisted them. On failure the
   * store reverts the changed keys and the promise rejects.
   */
  saveSettings: (updates: Partial<DesktopSettings>) => Promise<void>;
}

const defaults: DesktopSettings = {
  openOnStartup: false,
  startMinimized: false,
  closeToTray: true,
  hardwareAcceleration: true,
  desktopNotifications: true,
  gameCaptureHook: true,
};

/** What localStorage or Rust may hold: each flag is a boolean or is dropped. */
const readDesktopSettings = readObject<Partial<DesktopSettings>>({
  openOnStartup: readBoolean,
  startMinimized: readBoolean,
  closeToTray: readBoolean,
  hardwareAcceleration: readBoolean,
  desktopNotifications: readBoolean,
  gameCaptureHook: readBoolean,
});

const settingKeys = Object.keys(defaults) as Array<keyof DesktopSettings>;

function pickSettings(
  source: DesktopSettings,
  keys: Array<keyof DesktopSettings>,
): Partial<DesktopSettings> {
  const picked: Partial<DesktopSettings> = {};
  for (const key of keys) picked[key] = source[key];
  return picked;
}

/**
 * Detect the user's OS name for the settings tab label.
 * Returns "Windows", "macOS", or "Linux".
 */
export function getOSName(): string {
  if (typeof navigator === "undefined") return "Desktop";
  const ua = navigator.userAgent;
  if (ua.includes("Win")) return "Windows";
  if (ua.includes("Mac")) return "macOS";
  if (ua.includes("Linux")) return "Linux";
  return "Desktop";
}

async function invokeRust<T>(
  cmd: "get_desktop_settings" | "set_desktop_settings",
  args?: Record<string, unknown>,
): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export const useDesktopSettingsStore = create<DesktopSettingsState>()(
  persist(
    (set, get) => ({
      ...defaults,

      updateSettings: (updates) => {
        void get()
          .saveSettings(updates)
          .catch((error: unknown) =>
            log.warn("Failed to save desktop settings:", error),
          );
      },

      saveSettings: async (updates) => {
        const keys = settingKeys.filter((key) =>
          Object.prototype.hasOwnProperty.call(updates, key),
        );
        const previous = pickSettings(get(), keys);
        set(updates);
        if (!isDesktop() || keys.length === 0) return;

        try {
          const saved = await invokeRust<unknown>("set_desktop_settings", {
            patch: pickSettings({ ...get(), ...updates }, keys),
          });
          set(readDesktopSettings(saved) ?? {});
        } catch (error) {
          set(previous);
          throw error;
        }
      },
    }),
    {
      name: "desktop-settings-storage",
      version: 1,
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...readDesktopSettings(persistedState),
      }),
    },
  ),
);

let hydration: Promise<void> | null = null;

/**
 * Load the settings Rust persisted into the store. The first time Rust has
 * no settings file yet, hand it the values localStorage kept, once.
 * Hardware acceleration stays Rust's: it is what this launch's CEF used.
 * Safe to call more than once; later calls share the first result.
 */
export function hydrateDesktopSettings(): Promise<void> {
  if (!isDesktop()) return Promise.resolve();
  hydration ??= runHydration().catch((error: unknown) => {
    log.warn("Failed to load desktop settings:", error);
    hydration = null;
  });
  return hydration;
}

async function runHydration() {
  const snapshot = await invokeRust<DesktopSettingsSnapshot>(
    "get_desktop_settings",
  );
  if (snapshot.persisted) {
    useDesktopSettingsStore.setState(
      readDesktopSettings(snapshot.settings) ?? {},
    );
    return;
  }

  const state = useDesktopSettingsStore.getState();
  log.info("Migrating desktop settings from localStorage to the desktop app");
  const saved = await invokeRust<unknown>("set_desktop_settings", {
    patch: pickSettings(state, [
      "openOnStartup",
      "startMinimized",
      "closeToTray",
      "desktopNotifications",
    ]),
  });
  useDesktopSettingsStore.setState(readDesktopSettings(saved) ?? {});
}

/** Test-only: forget the shared hydration so a test can run it again. */
export function resetDesktopSettingsHydrationForTests() {
  hydration = null;
}
