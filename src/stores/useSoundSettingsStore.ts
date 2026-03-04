// ============================================================================
// Sound Settings Store — Zustand + persist
//
// Controls which sound effect categories are enabled/disabled.
// Persisted to localStorage and scoped per-user just like voice settings.
// ============================================================================

import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface SoundSettings {
  /** Master switch — disables ALL sounds when false */
  soundsEnabled: boolean;
  /** Play sound when someone joins/leaves a voice channel you're in */
  voiceJoinLeave: boolean;
  /** Play mute/unmute/deafen click sounds */
  muteDeafen: boolean;
  /** Play notification chime on mentions/replies/DMs */
  notifications: boolean;
  /** Play connect/disconnect tones when you join/leave voice */
  selfConnectDisconnect: boolean;
  /** Play screen share start/stop sounds */
  screenShare: boolean;
  /** Volume multiplier for all sound effects (0-100) */
  soundVolume: number;
}

interface SoundSettingsState {
  currentUser: string | null;
  userSettings: Record<string, SoundSettings>;
  setCurrentUser: (userId: string) => void;
  getSettings: (userId?: string | null) => SoundSettings;
  updateSettings: (updater: Partial<SoundSettings>, userId?: string) => void;
}

const defaultSoundSettings: SoundSettings = {
  soundsEnabled: true,
  voiceJoinLeave: true,
  muteDeafen: true,
  notifications: true,
  selfConnectDisconnect: true,
  screenShare: true,
  soundVolume: 100,
};

export const useSoundSettingsStore = create<SoundSettingsState>()(
  persist(
    (set, get) => ({
      currentUser: null,
      userSettings: {},

      setCurrentUser: (userId) => set({ currentUser: userId }),

      getSettings: (userId) => {
        const uid = userId || get().currentUser;
        if (!uid) return defaultSoundSettings;
        return { ...defaultSoundSettings, ...get().userSettings[uid] };
      },

      updateSettings: (updates, userId) => {
        const uid = userId ?? get().currentUser;
        if (!uid) return;
        set((state) => ({
          userSettings: {
            ...state.userSettings,
            [uid]: { ...defaultSoundSettings, ...state.userSettings[uid], ...updates },
          },
        }));
      },
    }),
    {
      name: "sound-settings-storage",
      version: 1,
    }
  )
);

// ── Convenience: check if a specific sound category is enabled ──────────────

export function isSoundEnabled(category: keyof Omit<SoundSettings, "soundsEnabled" | "soundVolume">): boolean {
  const store = useSoundSettingsStore.getState();
  const settings = store.getSettings();
  return settings.soundsEnabled && settings[category];
}
