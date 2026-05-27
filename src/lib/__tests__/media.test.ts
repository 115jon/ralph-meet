import { describe, expect, it } from "vitest";
import { isPlayableVideo, isVideo } from "../media";

describe("media helpers", () => {
  it("accepts common Chromium-playable video containers", () => {
    expect(isPlayableVideo("video/mp4")).toBe(true);
    expect(isPlayableVideo("video/mp4; codecs=avc1.42E01E, mp4a.40.2")).toBe(true);
    expect(isPlayableVideo("video/webm; codecs=vp9, opus")).toBe(true);
  });

  it("allows HEVC MP4 containers and lets the runtime report playback failures", () => {
    expect(isPlayableVideo("video/mp4; codecs=hev1.1.6.L120.90")).toBe(true);
    expect(isPlayableVideo("video/mp4; codecs=hvc1.1.6.L120.90")).toBe(true);
    expect(isVideo("video/mp4; codecs=hev1.1.6.L120.90")).toBe(true);
  });
});
