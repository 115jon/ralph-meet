import {
  DEFAULT_LISTEN_TOGETHER_AUDIO_SETTINGS,
  normalizeListenTogetherAudioSettings,
} from "./useListenTogetherAudioSettingsStore";
import { describe, expect, it } from "vitest";

describe("Listen Together audio settings", () => {
  it("defaults new listeners to balanced loudness control", () => {
    expect(normalizeListenTogetherAudioSettings()).toEqual(
      DEFAULT_LISTEN_TOGETHER_AUDIO_SETTINGS,
    );
  });

  it("rejects unsupported persisted presets", () => {
    expect(
      normalizeListenTogetherAudioSettings({
        enabled: false,
        preset: "cinema" as never,
      }),
    ).toEqual({
      enabled: false,
      preset: "balanced",
    });
  });
});
