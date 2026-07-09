export async function restartDesktopApp() {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("restart_app");
}
