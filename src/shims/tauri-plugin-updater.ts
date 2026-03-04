/**
 * Client-side shim for `@tauri-apps/plugin-updater`.
 * Only used in the web dev server — the real module is available on desktop.
 */
export async function check() {
  return null;
}
