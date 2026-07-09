import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "@/lib/platform";

export const DESKTOP_THUMBNAIL_TOOLBAR_ACTION_EVENT =
  "desktop-thumbnail-toolbar-action";

export type DesktopThumbnailToolbarAction =
  | "toggle-camera"
  | "toggle-mic"
  | "toggle-deafen"
  | "disconnect"
  | "toggle-media-playback"
  | "skip-media";

export interface DesktopThumbnailToolbarState {
  visible: boolean;
  hasCamera: boolean;
  isCameraOn: boolean;
  hasMicrophone: boolean;
  isMuted: boolean;
  isDeafened: boolean;
  hasMediaControls: boolean;
  isMediaPaused: boolean;
}

export interface DesktopThumbnailToolbarActionEvent {
  action: DesktopThumbnailToolbarAction;
}

export const HIDDEN_DESKTOP_THUMBNAIL_TOOLBAR_STATE: DesktopThumbnailToolbarState =
  {
    visible: false,
    hasCamera: false,
    isCameraOn: false,
    hasMicrophone: false,
    isMuted: false,
    isDeafened: false,
    hasMediaControls: false,
    isMediaPaused: false,
  };

export async function syncDesktopThumbnailToolbar(
  state: DesktopThumbnailToolbarState,
) {
  if (!isTauri()) return;

  await invoke("sync_taskbar_thumbnail_toolbar", { state }).catch((error) => {
    console.warn(
      "[DesktopThumbnailToolbar] Failed to sync native thumbnail toolbar state",
      { state, error },
    );
  });
}

export async function clearDesktopThumbnailToolbar() {
  await syncDesktopThumbnailToolbar(HIDDEN_DESKTOP_THUMBNAIL_TOOLBAR_STATE);
}

export async function listenForDesktopThumbnailToolbarActions(
  handler: (event: DesktopThumbnailToolbarActionEvent) => void | Promise<void>,
): Promise<UnlistenFn | undefined> {
  if (!isTauri()) return undefined;

  return listen<DesktopThumbnailToolbarActionEvent>(
    DESKTOP_THUMBNAIL_TOOLBAR_ACTION_EVENT,
    (event) => handler(event.payload),
  );
}
