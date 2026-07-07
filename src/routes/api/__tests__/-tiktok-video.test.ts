import { describe, expect, it } from "vitest";

import {
  buildTikTokMetadataLookupUrls,
  canonicalizeTikTokLookupUrl,
  hasTikTokVideoResultContent,
  isTikTokShortLookupUrl,
  type TikTokVideoResult,
} from "../tiktok-video";

describe("tiktok video route helpers", () => {
  it("canonicalizes supported TikTok lookup URLs", () => {
    expect(canonicalizeTikTokLookupUrl("https://www.tiktok.com/@dj.giggle/photo/7656952653510888717?_r=1")).toBe(
      "https://www.tiktok.com/@dj.giggle/photo/7656952653510888717"
    );
    expect(canonicalizeTikTokLookupUrl("https://www.tiktok.com/t/ZTSSxgwxt/?lang=en")).toBe(
      "https://www.tiktok.com/t/ZTSSxgwxt/"
    );
  });

  it("detects TikTok short lookup URLs", () => {
    expect(isTikTokShortLookupUrl("https://www.tiktok.com/t/ZTSSxgwxt/")).toBe(true);
    expect(isTikTokShortLookupUrl("https://vm.tiktok.com/ZMabc123/")).toBe(true);
    expect(isTikTokShortLookupUrl("https://www.tiktok.com/@dj.giggle/photo/7656952653510888717")).toBe(false);
  });

  it("prefers the original short lookup url before the resolved canonical url", () => {
    expect(buildTikTokMetadataLookupUrls(
      "https://www.tiktok.com/t/ZTS2w6uEa/",
      "https://www.tiktok.com/@_qubo_/video/7656308942951271693",
    )).toEqual([
      "https://www.tiktok.com/t/ZTS2w6uEa/",
      "https://www.tiktok.com/@_qubo_/video/7656308942951271693",
    ]);
  });

  it("deduplicates lookup urls when the resolved url matches the input", () => {
    expect(buildTikTokMetadataLookupUrls(
      "https://www.tiktok.com/@dj.giggle/photo/7656952653510888717",
      "https://www.tiktok.com/@dj.giggle/photo/7656952653510888717",
    )).toEqual([
      "https://www.tiktok.com/@dj.giggle/photo/7656952653510888717",
    ]);
  });

  it("rejects unsupported TikTok lookup URLs", () => {
    expect(canonicalizeTikTokLookupUrl("https://example.com/@dj.giggle/photo/7656952653510888717")).toBeNull();
    expect(canonicalizeTikTokLookupUrl("not-a-url")).toBeNull();
  });

  it("treats empty TikTok results as non-cacheable misses", () => {
    const empty: TikTokVideoResult = {
      videoUrl: null,
      coverUrl: null,
      media: [],
      audio: null,
      title: null,
    };

    expect(hasTikTokVideoResultContent(empty)).toBe(false);
    expect(hasTikTokVideoResultContent({
      ...empty,
      coverUrl: "https://p16-common-sign.tiktokcdn-us.com/example/cover.webp",
    })).toBe(true);
    expect(hasTikTokVideoResultContent({
      ...empty,
      media: [{
        type: "image",
        url: "https://p19-common-sign.tiktokcdn-us.com/example/photo-1.jpeg",
      }],
    })).toBe(true);
    expect(hasTikTokVideoResultContent({
      ...empty,
      audio: {
        title: "original sound - dj.giggle",
        artist: "dj.giggle",
      },
    })).toBe(true);
  });
});
