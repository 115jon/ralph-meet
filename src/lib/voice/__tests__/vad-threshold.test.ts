import { describe, expect, it } from "vitest";
import { getVoiceActivityThreshold } from "../vad";

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
});
