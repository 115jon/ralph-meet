import { create } from "zustand";

import type { SettingsLocation } from "@/components/chat/settings/settings-links";

/**
 * The one owner of the user settings dialog. `openSettings()` in
 * settings-links writes here; the single `SettingsHost` reads it. Opening while
 * the dialog is already up moves it to the new location (`requestId` bumps so
 * the dialog can tell a repeat request from the one it opened with).
 */
interface SettingsDialogState {
  open: boolean;
  /** True once the dialog has been asked for, so its chunk loads lazily. */
  requested: boolean;
  location: SettingsLocation;
  requestId: number;
  openSettings: (location?: SettingsLocation) => void;
  close: () => void;
}

export const useSettingsDialogStore = create<SettingsDialogState>((set) => ({
  open: false,
  requested: false,
  location: {},
  requestId: 0,
  openSettings: (location = {}) =>
    set((state) => ({
      open: true,
      requested: true,
      location,
      requestId: state.requestId + 1,
    })),
  close: () => set({ open: false }),
}));
