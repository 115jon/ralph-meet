export const OPEN_PROFILE_EDITOR_EVENT = "open-profile-editor";

export function dispatchOpenProfileEditorEvent() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPEN_PROFILE_EDITOR_EVENT));
}
