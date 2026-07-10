import { describe, expect, it } from "vitest";
import {
  resolveCaptureAudioProcessing,
  resolveLocalAudioProcessingMode,
  type VoiceAudioProcessingSettings,
} from "./noise-reduction";

function makeSettings(
  overrides: Partial<VoiceAudioProcessingSettings> = {},
): VoiceAudioProcessingSettings {
  return {
    noiseSuppression: true,
    echoCancellation: true,
    autoSensitivity: true,
    streamHighFidelity: false,
    noiseReductionEnabled: false,
    noiseReductionProvider: "rnnoise",
    ...overrides,
  };
}

describe("noise reduction helpers", () => {
  it("prefers rnnoise mode over high-fidelity pass-through when cleanup is enabled", () => {
    expect(
      resolveLocalAudioProcessingMode(
        makeSettings({
          noiseReductionEnabled: true,
          streamHighFidelity: true,
        }),
      ),
    ).toBe("rnnoise");
  });

  it("disables browser noise suppression while keeping capture echo cancellation and agc", () => {
    expect(
      resolveCaptureAudioProcessing(
        makeSettings({
          noiseReductionEnabled: true,
        }),
      ),
    ).toEqual({
      noiseSuppression: false,
      echoCancellation: true,
      autoGainControl: true,
    });
  });

  it("turns off all browser capture processing in high-fidelity mode", () => {
    expect(
      resolveCaptureAudioProcessing(
        makeSettings({
          streamHighFidelity: true,
          noiseReductionEnabled: false,
        }),
      ),
    ).toEqual({
      noiseSuppression: false,
      echoCancellation: false,
      autoGainControl: false,
    });
  });
});
