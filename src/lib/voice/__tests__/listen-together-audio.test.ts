// @vitest-environment jsdom

import {
  getListenTogetherLoudnessPreset,
  ListenTogetherAudioProcessor,
  LISTEN_TOGETHER_LOUDNESS_PRESET_OPTIONS,
  type ListenTogetherLoudnessPreset,
} from "../listen-together-audio";
import { describe, expect, it, vi } from "vitest";

describe("Listen Together loudness presets", () => {
  it("exposes every supported preset through one shared registry", () => {
    expect(
      LISTEN_TOGETHER_LOUDNESS_PRESET_OPTIONS.map(([preset]) => preset),
    ).toEqual(["peak-protection", "balanced", "night"]);
  });
  it.each<
    [
      ListenTogetherLoudnessPreset,
      {
        compressorThresholdDb: number;
        compressorRatio: number;
        limiterCeilingDb: number;
      },
    ]
  >([
    [
      "peak-protection",
      { compressorThresholdDb: 0, compressorRatio: 1, limiterCeilingDb: -1 },
    ],
    [
      "balanced",
      {
        compressorThresholdDb: -18,
        compressorRatio: 2.5,
        limiterCeilingDb: -1,
      },
    ],
    [
      "night",
      { compressorThresholdDb: -30, compressorRatio: 6, limiterCeilingDb: -2 },
    ],
  ])("uses the expected %s dynamics targets", (preset, expected) => {
    expect(getListenTogetherLoudnessPreset(preset)).toMatchObject(expected);
  });

  it("rebuilds the media graph when the shared audio context changes", () => {
    const makeContext = () => {
      const makeCompressor = () => ({
        attack: {},
        connect: vi.fn(),
        disconnect: vi.fn(),
        knee: {},
        release: {},
        ratio: { value: 0 },
        threshold: { value: 0 },
      });
      return {
        createDynamicsCompressor: vi.fn(makeCompressor),
        createGain: vi.fn(() => ({
          connect: vi.fn(),
          disconnect: vi.fn(),
          gain: { value: 0 },
        })),
        createMediaElementSource: vi.fn(() => ({
          connect: vi.fn(),
          disconnect: vi.fn(),
        })),
        destination: {},
      } as unknown as AudioContext;
    };

    const processor = new ListenTogetherAudioProcessor();
    const audio = document.createElement("audio");
    const firstContext = makeContext();
    const secondContext = makeContext();

    expect(processor.connect(audio, firstContext)).toBe(true);
    expect(processor.connect(audio, secondContext)).toBe(true);
    expect(firstContext.createMediaElementSource).toHaveBeenCalledTimes(1);
    expect(secondContext.createMediaElementSource).toHaveBeenCalledTimes(1);
  });
});
