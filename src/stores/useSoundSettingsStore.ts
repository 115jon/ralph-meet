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
  /** Play subtle knock when a new message arrives in the current channel */
  messageReceived: boolean;
  /** Play ringing / call connected / call ended sounds */
  calls: boolean;
  /** Volume multiplier for all sound effects (0-100) */
  soundVolume: number;
}

interface SoundSettingsState {
  currentUser: string | null;
  userSettings: Record<string, SoundSettings>;
  /** @internal Cache of merged settings objects to ensure referential stability */
  _cache: Record<string, SoundSettings>;
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
  messageReceived: true,
  calls: true,
  soundVolume: 100,
};

export const useSoundSettingsStore = create<SoundSettingsState>()(
  persist(
    (set, get) => ({
      currentUser: null,
      userSettings: {},
      _cache: {},

      setCurrentUser: (userId) => set({ currentUser: userId }),

      getSettings: (userId) => {
        const uid = userId || get().currentUser;
        if (!uid) return defaultSoundSettings;
        const raw = get().userSettings[uid];
        if (!raw) return defaultSoundSettings;
        // Return cached merged object if the underlying data hasn't changed
        const cached = get()._cache[uid];
        if (cached && Object.keys(defaultSoundSettings).every(
          k => (cached as any)[k] === ((raw as any)[k] ?? (defaultSoundSettings as any)[k])
        )) {
          return cached;
        }
        const merged = { ...defaultSoundSettings, ...raw };
        // Store in cache (mutate to avoid triggering subscribers)
        get()._cache[uid] = merged;
        return merged;
      },

      updateSettings: (updates, userId) => {
        const uid = userId ?? get().currentUser;
        if (!uid) return;
        set((state) => {
          // Invalidate cache for this user
          const newCache = { ...state._cache };
          delete newCache[uid];
          return {
            _cache: newCache,
            userSettings: {
              ...state.userSettings,
              [uid]: { ...defaultSoundSettings, ...state.userSettings[uid], ...updates },
            },
          };
        });
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
