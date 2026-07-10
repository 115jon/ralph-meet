import {
  LISTEN_TOGETHER_LOUDNESS_PRESETS,
  type ListenTogetherAudioSettings,
} from "@/lib/voice/listen-together-audio";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export const DEFAULT_LISTEN_TOGETHER_AUDIO_SETTINGS: ListenTogetherAudioSettings =
  {
    enabled: true,
    preset: "balanced",
  };

interface ListenTogetherAudioSettingsState extends ListenTogetherAudioSettings {
  updateSettings: (updates: Partial<ListenTogetherAudioSettings>) => void;
}

export function normalizeListenTogetherAudioSettings(
  settings?: Partial<ListenTogetherAudioSettings>,
): ListenTogetherAudioSettings {
  return {
    enabled:
      typeof settings?.enabled === "boolean"
        ? settings.enabled
        : DEFAULT_LISTEN_TOGETHER_AUDIO_SETTINGS.enabled,
    preset:
      settings?.preset && settings.preset in LISTEN_TOGETHER_LOUDNESS_PRESETS
        ? settings.preset
        : DEFAULT_LISTEN_TOGETHER_AUDIO_SETTINGS.preset,
  };
}

export const useListenTogetherAudioSettingsStore =
  create<ListenTogetherAudioSettingsState>()(
    persist(
      (set) => ({
        ...DEFAULT_LISTEN_TOGETHER_AUDIO_SETTINGS,
        updateSettings: (updates) =>
          set((state) =>
            normalizeListenTogetherAudioSettings({
              enabled: updates.enabled ?? state.enabled,
              preset: updates.preset ?? state.preset,
            }),
          ),
      }),
      {
        name: "listen-together-audio-settings-storage",
        version: 1,
        partialize: (state) => ({
          enabled: state.enabled,
          preset: state.preset,
        }),
        merge: (persistedState, currentState) => ({
          ...currentState,
          ...normalizeListenTogetherAudioSettings(
            persistedState as Partial<ListenTogetherAudioSettings> | undefined,
          ),
        }),
      },
    ),
  );
