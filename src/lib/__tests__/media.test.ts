import { describe, expect, it } from "vitest";
import { isAnimatedImage, isAnimatedMedia, isPlayableVideo, isVideo } from "../media";

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

  it("recognizes animated image mime types", () => {
    expect(isAnimatedImage("image/gif")).toBe(true);
    expect(isAnimatedImage("image/apng")).toBe(true);
    expect(isAnimatedImage("image/webp")).toBe(false);
    expect(isAnimatedImage("image/png")).toBe(false);
  });

  it("treats provider gif videos as animated media", () => {
    expect(isAnimatedMedia("video/mp4", true)).toBe(true);
    expect(isAnimatedMedia("image/gif", false)).toBe(true);
    expect(isAnimatedMedia("video/mp4", false, "attachments/channel/attachment/gifs/tenor/test.mp4")).toBe(true);
    expect(isAnimatedMedia("video/mp4", false, "/api/proxy-media?url=https%3A%2F%2Fvideo.twimg.com%2Ftweet_video%2Ftest.mp4")).toBe(true);
    expect(isAnimatedMedia("image/webp", false, "https://gif.fxtwitter.com/tweet_video/test.webp")).toBe(true);
    expect(isAnimatedMedia("image/webp", false, "https://cdn.example.com/test.webp")).toBe(false);
    expect(isAnimatedMedia("video/mp4", false)).toBe(false);
  });
});
