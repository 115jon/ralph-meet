import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface MediaPlaybackSettings {
  videoVolume: number;
  videoMuted: boolean;
}

interface MediaPlaybackSettingsState extends MediaPlaybackSettings {
  updateSettings: (updates: Partial<MediaPlaybackSettings>) => void;
}

export const DEFAULT_MEDIA_PLAYBACK_SETTINGS: MediaPlaybackSettings = {
  videoVolume: 1,
  videoMuted: false,
};

export function normalizeMediaPlaybackSettings(
  settings?: Partial<MediaPlaybackSettings>,
): MediaPlaybackSettings {
  const rawVolume = settings?.videoVolume;
  const videoVolume =
    typeof rawVolume === "number" && Number.isFinite(rawVolume)
      ? Math.min(1, Math.max(0, rawVolume))
      : DEFAULT_MEDIA_PLAYBACK_SETTINGS.videoVolume;
  const videoMuted = Boolean(settings?.videoMuted) || videoVolume === 0;

  return {
    videoVolume,
    videoMuted,
  };
}

export const useMediaPlaybackSettingsStore =
  create<MediaPlaybackSettingsState>()(
    persist(
      (set) => ({
        ...DEFAULT_MEDIA_PLAYBACK_SETTINGS,

        updateSettings: (updates) =>
          set((state) =>
            normalizeMediaPlaybackSettings({
              videoVolume: updates.videoVolume ?? state.videoVolume,
              videoMuted: updates.videoMuted ?? state.videoMuted,
            }),
          ),
      }),
      {
        name: "media-playback-settings-storage",
        version: 1,
        partialize: (state) => ({
          videoVolume: state.videoVolume,
          videoMuted: state.videoMuted,
        }),
        merge: (persistedState, currentState) => ({
          ...currentState,
          ...normalizeMediaPlaybackSettings(
            persistedState as Partial<MediaPlaybackSettings> | undefined,
          ),
        }),
      },
    ),
  );
