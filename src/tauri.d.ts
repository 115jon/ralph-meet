// ── Tauri Plugin Shims ──────────────────────────────────────────────────
// These are used by desktop components but might not be installed in the root
// project dependencies if it's primarily a web build environment.

declare module "@tauri-apps/plugin-updater" {
  export interface Update {
    version: string;
    body: string;
    date: string | null;
    downloadAndInstall(): Promise<void>;
  }
  export function check(): Promise<Update | null>;
  export function onUpdaterEvent(cb: (event: any) => void): Promise<() => void>;
}

declare module "@tauri-apps/plugin-process" {
  export function relaunch(): Promise<void>;
  export function exit(code?: number): Promise<void>;
}

declare module "@tauri-apps/plugin-autostart" {
  export function enable(): Promise<void>;
  export function disable(): Promise<void>;
  export function isEnabled(): Promise<boolean>;
}
