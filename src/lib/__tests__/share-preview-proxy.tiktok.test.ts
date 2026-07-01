import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchTikTokProxyMetadata } from "../share-preview-proxy";

const TIKTOK_AUDIO_URL = "https://v16-ies-music.tiktokcdn-us.com/example/audio-track/?mime_type=audio_mpeg";
const TIKTOK_COVER_URL = "https://p16-common-sign.tiktokcdn-us.com/example/cover.webp";
const TIKTOK_ARTWORK_URL = "https://p19-common-sign.tiktokcdn-us.com/example/music-cover.jpeg";
const TIKTOK_AVATAR_URL = "https://p19-common-sign.tiktokcdn-us.com/example/avatar.jpeg";
const TIKTOK_IMAGE_URLS = [
  "https://p19-common-sign.tiktokcdn-us.com/example/photo-1.jpeg",
  "https://p16-common-sign.tiktokcdn-us.com/example/photo-2.jpeg",
  "https://p19-common-sign.tiktokcdn-us.com/example/photo-3.jpeg",
];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fetchTikTokProxyMetadata", () => {
  it("maps slideshow posts into image media and audio without mistaking the soundtrack for a video", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = input.toString();
      expect(url).toContain("https://www.tikwm.com/api/?url=");

      return Response.json({
        code: 0,
        data: {
          id: "7649484991986027806",
          title: "",
          content_desc: [],
          cover: TIKTOK_COVER_URL,
          origin_cover: TIKTOK_COVER_URL,
          ai_dynamic_cover: TIKTOK_COVER_URL,
          duration: 0,
          play: TIKTOK_AUDIO_URL,
          wmplay: TIKTOK_AUDIO_URL,
          music: TIKTOK_AUDIO_URL,
          music_info: {
            title: "original sound - realtonyay",
            author: "Tonya",
            play: TIKTOK_AUDIO_URL,
            cover: TIKTOK_ARTWORK_URL,
          },
          play_count: 12416,
          digg_count: 2311,
          comment_count: 19,
          share_count: 210,
          create_time: 1781034537,
          author: {
            unique_id: "feetlattee",
            nickname: "natalia",
            avatar: TIKTOK_AVATAR_URL,
          },
          images: TIKTOK_IMAGE_URLS,
        },
      });
    }) as unknown as typeof fetch);

    const result = await fetchTikTokProxyMetadata("https://www.tiktok.com/t/ZTSBAR6M7/");

    expect(result).toMatchObject({
      id: "7649484991986027806",
      canonicalUrl: "https://www.tiktok.com/@feetlattee/photo/7649484991986027806",
      postType: "slideshow",
      coverUrl: TIKTOK_COVER_URL,
      authorName: "natalia",
      authorHandle: "feetlattee",
      authorAvatarUrl: TIKTOK_AVATAR_URL,
      audio: {
        title: "original sound - realtonyay",
        artist: "Tonya",
        url: TIKTOK_AUDIO_URL,
        artworkUrl: TIKTOK_ARTWORK_URL,
      },
      likeCount: 2311,
      commentCount: 19,
      viewCount: 12416,
      shareCount: 210,
      timestamp: new Date(1781034537 * 1000).toISOString(),
    });
    expect(result?.videoUrl).toBeUndefined();
    expect(result?.media).toHaveLength(3);
    expect(result?.media?.every((item) => item.type === "image")).toBe(true);
    expect(result?.media?.map((item) => item.url)).toEqual(TIKTOK_IMAGE_URLS);
  });
});
