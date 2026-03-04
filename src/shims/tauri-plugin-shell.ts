/**
 * Client-side shim for `@tauri-apps/plugin-shell`.
 * Only used in the web dev server — the real module is available on desktop.
 */
export async function open(url: string) {
  window.open(url, "_blank");
}
