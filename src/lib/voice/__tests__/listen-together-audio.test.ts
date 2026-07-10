import {
  getListenTogetherLoudnessPreset,
  LISTEN_TOGETHER_LOUDNESS_PRESET_OPTIONS,
  type ListenTogetherLoudnessPreset,
} from "../listen-together-audio";
import { describe, expect, it } from "vitest";

describe("Listen Together loudness presets", () => {
  it("exposes every supported preset through one shared registry", () => {
    expect(LISTEN_TOGETHER_LOUDNESS_PRESET_OPTIONS.map(([preset]) => preset)).toEqual([
      "peak-protection",
      "balanced",
      "night",
    ]);
  });
  it.each<[
    ListenTogetherLoudnessPreset,
    { compressorThresholdDb: number; compressorRatio: number; limiterCeilingDb: number }
  ]>([
    ["peak-protection", { compressorThresholdDb: 0, compressorRatio: 1, limiterCeilingDb: -1 }],
    ["balanced", { compressorThresholdDb: -18, compressorRatio: 2.5, limiterCeilingDb: -1 }],
    ["night", { compressorThresholdDb: -30, compressorRatio: 6, limiterCeilingDb: -2 }],
  ])("uses the expected %s dynamics targets", (preset, expected) => {
    expect(getListenTogetherLoudnessPreset(preset)).toMatchObject(expected);
  });
});
