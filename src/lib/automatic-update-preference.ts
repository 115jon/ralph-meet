import { isDesktop } from "@/lib/platform";

export function shouldRunAutomaticUpdateCheck(preference: boolean | null): boolean {
  return preference === true;
}

export async function loadAutomaticUpdateCheckPreference(): Promise<boolean | null> {
  if (!isDesktop()) return null;

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<boolean | null>("get_automatic_update_checks");
  } catch {
    return null;
  }
}
