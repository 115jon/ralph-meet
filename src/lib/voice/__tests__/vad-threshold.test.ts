import { describe, expect, it } from "vitest";
import {
  calculateTimeDomainRms,
  getVoiceActivityLevelPercent,
  getVoiceActivityThreshold,
} from "../vad";

describe("getVoiceActivityThreshold", () => {
  it("uses the fixed automatic baseline", () => {
    expect(getVoiceActivityThreshold(true, -50)).toBe(3);
  });

  it("converts manual dB sensitivity to the VAD RMS scale", () => {
    expect(getVoiceActivityThreshold(false, -50)).toBeCloseTo(0.316, 2);
  });

  it("clamps manual sensitivity to the supported VAD range", () => {
    expect(getVoiceActivityThreshold(false, 0)).toBe(50);
    expect(getVoiceActivityThreshold(false, -100)).toBeCloseTo(0.1);
  });

  it("maps the VAD RMS value back to the same manual slider scale", () => {
    const threshold = getVoiceActivityThreshold(false, -50);
    expect(getVoiceActivityLevelPercent(threshold)).toBeCloseTo(50, 5);
    expect(getVoiceActivityLevelPercent(threshold / 2)).toBeLessThan(50);
    expect(getVoiceActivityLevelPercent(threshold * 2)).toBeGreaterThan(50);
  });

  it("removes float-domain DC bias before measuring microphone energy", () => {
    expect(calculateTimeDomainRms(new Float32Array([0.02, 0.02, 0.02]))).toBe(
      0,
    );
    expect(
      calculateTimeDomainRms(new Float32Array([0.01, -0.01, 0.01, -0.01])),
    ).toBeCloseTo(1, 5);
  });
});
