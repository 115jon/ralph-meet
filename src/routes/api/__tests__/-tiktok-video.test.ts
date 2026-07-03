import { describe, expect, it } from "vitest";

import {
  canonicalizeTikTokLookupUrl,
  hasTikTokVideoResultContent,
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
