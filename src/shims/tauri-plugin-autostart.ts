/**
 * Client-side shim for `@tauri-apps/plugin-autostart`.
 * Only used in the web dev server — the real module is available on desktop.
 */
export async function enable() { }
export async function disable() { }
export async function isEnabled(): Promise<boolean> {
  return false;
}
