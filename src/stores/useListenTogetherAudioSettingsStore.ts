import {
  isListenTogetherLoudnessPreset,
  type ListenTogetherAudioSettings,
} from "@/lib/voice/listen-together-audio";
import { readBoolean, readGuard, readObject } from "@/lib/persisted-guard";
import { create } from "zustand";
import { persist } from "zustand/middleware";

const DEFAULT_LISTEN_TOGETHER_AUDIO_SETTINGS: ListenTogetherAudioSettings = {
  enabled: true,
  preset: "balanced",
};

/** What localStorage may hold: a boolean and a known preset, or neither. */
const readPersistedAudioSettings = readObject<
  Partial<ListenTogetherAudioSettings>
>({
  enabled: readBoolean,
  preset: readGuard(isListenTogetherLoudnessPreset),
});

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
      settings?.preset && isListenTogetherLoudnessPreset(settings.preset)
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
            readPersistedAudioSettings(persistedState),
          ),
        }),
      },
    ),
  );
