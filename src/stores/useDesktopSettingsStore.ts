// ============================================================================
// Desktop Settings Store — Zustand + persist
//
// OS-level preferences for the desktop app (Tauri).
// Controls autostart, close-to-tray, and start-minimized behavior.
// Persisted to localStorage and synced to the Rust backend on change.
// ============================================================================

import { isDesktop } from "@/lib/platform";
import { clog } from "@/lib/console-logger";
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
}

interface DesktopSettingsState extends DesktopSettings {
  /** Update one or more settings and sync to the Rust backend */
  updateSettings: (updates: Partial<DesktopSettings>) => void;
  /** Sync all current settings to the Rust backend (call on app startup) */
  syncToBackend: () => Promise<void>;
}

const defaults: DesktopSettings = {
  openOnStartup: false,
  startMinimized: false,
  closeToTray: true,
  hardwareAcceleration: true,
};

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

/**
 * Dynamically import the Tauri autostart plugin (only available on desktop).
 * Returns null on web to avoid import errors.
 */
async function getAutostart() {
  if (!isDesktop()) return null;
  try {
    return await import("@tauri-apps/plugin-autostart");
  } catch {
    log.warn("autostart plugin not available");
    return null;
  }
}

/**
 * Invoke a Tauri command. Returns silently on web.
 */
async function tauriInvoke<T = unknown>(cmd: string, args: Record<string, unknown> = {}) {
  if (!isDesktop()) return undefined;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<T>(cmd, args);
  } catch (e) {
    log.warn(`Failed to invoke ${cmd}:`, e);
    return undefined;
  }
}

export const useDesktopSettingsStore = create<DesktopSettingsState>()(
  persist(
    (set, get) => ({
      ...defaults,

      updateSettings: (updates) => {
        set(updates);
        // Fire-and-forget sync to Rust backend
        const state = { ...get(), ...updates };
        syncSettingsToRust(state);
      },

      syncToBackend: async () => {
        const state = get();
        await syncSettingsToRust(state);
      },
    }),
    {
      name: "desktop-settings-storage",
      version: 1,
    },
  ),
);

/**
 * Push all settings to the Rust backend.
 * This ensures the Rust close-interceptor and other native
 * event handlers are aware of the current preferences.
 */
async function syncSettingsToRust(settings: DesktopSettings) {
  if (!isDesktop()) return;

  // Sync autostart
  const autostart = await getAutostart();
  if (autostart) {
    try {
      const currentlyEnabled = await autostart.isEnabled();
      if (settings.openOnStartup && !currentlyEnabled) {
        await autostart.enable();
      } else if (!settings.openOnStartup && currentlyEnabled) {
        await autostart.disable();
      }
    } catch (e) {
      log.warn("autostart sync failed:", e);
    }
  }

  // Sync close-to-tray preference to Rust AtomicBool
  await tauriInvoke("set_close_to_tray", { enabled: settings.closeToTray });

  // Sync start-minimized preference to Rust AtomicBool
  await tauriInvoke("set_start_minimized", { enabled: settings.startMinimized });

  // Persist renderer acceleration preference for the next desktop launch.
  await tauriInvoke("set_hardware_acceleration", { enabled: settings.hardwareAcceleration });
}
