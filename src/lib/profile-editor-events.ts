export const OPEN_PROFILE_EDITOR_EVENT = "open-profile-editor";

export interface OpenProfileEditorEventDetail {
  trigger: HTMLElement | null;
}

export function dispatchOpenProfileEditorEvent(
  trigger: HTMLElement | null = null,
) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<OpenProfileEditorEventDetail>(OPEN_PROFILE_EDITOR_EVENT, {
      detail: { trigger },
    }),
  );
}
