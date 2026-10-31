import { normalizeListenTogetherAudioSettings } from "./useListenTogetherAudioSettingsStore";
import { describe, expect, it } from "vitest";

describe("Listen Together audio settings", () => {
  it("defaults new listeners to balanced loudness control", () => {
    // Spelled out, not read back from the exported default, so changing the
    // default is a deliberate test change.
    expect(normalizeListenTogetherAudioSettings()).toEqual({
      enabled: true,
      preset: "balanced",
    });
  });

  it("keeps a valid persisted choice", () => {
    expect(
      normalizeListenTogetherAudioSettings({ enabled: false, preset: "night" }),
    ).toEqual({ enabled: false, preset: "night" });
  });

  it("fills only the missing field from the defaults", () => {
    expect(normalizeListenTogetherAudioSettings({ enabled: false })).toEqual({
      enabled: false,
      preset: "balanced",
    });
    expect(
      normalizeListenTogetherAudioSettings({ preset: "peak-protection" }),
    ).toEqual({ enabled: true, preset: "peak-protection" });
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
