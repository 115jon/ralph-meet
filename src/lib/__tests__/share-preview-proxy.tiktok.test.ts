import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchTikTokProxyMetadata } from "../share-preview-proxy";

const TIKTOK_AUDIO_URL =
  "https://v16-ies-music.tiktokcdn-us.com/example/audio-track/?mime_type=audio_mpeg";
const TIKTOK_COVER_URL =
  "https://p16-common-sign.tiktokcdn-us.com/example/cover.webp";
const TIKTOK_ARTWORK_URL =
  "https://p19-common-sign.tiktokcdn-us.com/example/music-cover.jpeg";
const TIKTOK_AVATAR_URL =
  "https://p19-common-sign.tiktokcdn-us.com/example/avatar.jpeg";
const TIKTOK_IMAGE_URLS = [
  "https://p19-common-sign.tiktokcdn-us.com/example/photo-1.jpeg",
  "https://p16-common-sign.tiktokcdn-us.com/example/photo-2.jpeg",
  "https://p19-common-sign.tiktokcdn-us.com/example/photo-3.jpeg",
];
const TIKTOK_LIVE_IMAGE_URLS = [
  "https://v16m.tiktokcdn-us.com/example/live-photo-1.mp4?mime_type=video_mp4",
  "https://v16m.tiktokcdn-us.com/example/live-photo-2.mp4?mime_type=video_mp4",
];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fetchTikTokProxyMetadata", () => {
  it("maps slideshow posts into image media and audio without mistaking the soundtrack for a video", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = input.toString();
        if (!url.startsWith("https://www.tikwm.com/api/?url=")) {
          return new Response("not found", { status: 404 });
        }

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
      }) as unknown as typeof fetch,
    );

    const result = await fetchTikTokProxyMetadata(
      "https://www.tiktok.com/t/ZTSBAR6M7/",
    );

    expect(result).toMatchObject({
      id: "7649484991986027806",
      canonicalUrl:
        "https://www.tiktok.com/@feetlattee/photo/7649484991986027806",
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

  it("falls back to TikTok's player api for canonical video posts when tikwm misses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = input.toString();

        if (
          url ===
          "https://www.tiktok.com/player/api/v1/items?item_ids=7644940658603592973"
        ) {
          return Response.json({
            items: [
              {
                id_str: "7644940658603592973",
                desc: "LMAO",
                author_info: {
                  unique_id: "irlquandale",
                  nickname: "Quandale Dingle",
                  avatar_url_list: [TIKTOK_AVATAR_URL],
                },
                statistics_info: {
                  comment_count: 103,
                  digg_count: 17284,
                  share_count: 2211,
                },
                video_info: {
                  cover: {
                    url_list: [
                      "https://p19-common-sign.tiktokcdn-us.com/example/cropped-cover.jpeg",
                    ],
                  },
                  origin_cover: {
                    url_list: [
                      "https://p16-common-sign.tiktokcdn-us.com/example/origin-cover.webp",
                    ],
                  },
                  meta: {
                    duration: 61667,
                    width: 576,
                    height: 1024,
                  },
                  url_list: [
                    "https://v16m.tiktokcdn-us.com/example/video.mp4?mime_type=video_mp4",
                  ],
                },
                music_info: {
                  title: "original sound - irlquandale",
                  author: "Quandale Dingle",
                },
              },
            ],
          });
        }

        if (
          url.startsWith("https://www.tikwm.com/api/?url=") ||
          url.startsWith("https://tikwm.com/api/?url=")
        ) {
          return Response.json({ code: -1 });
        }

        return new Response("not found", { status: 404 });
      }) as unknown as typeof fetch,
    );

    const result = await fetchTikTokProxyMetadata(
      "https://www.tiktok.com/@irlquandale/video/7644940658603592973",
    );

    expect(result).toMatchObject({
      id: "7644940658603592973",
      canonicalUrl:
        "https://www.tiktok.com/@irlquandale/video/7644940658603592973",
      postType: "video",
      coverUrl:
        "https://p16-common-sign.tiktokcdn-us.com/example/origin-cover.webp",
      title: "LMAO",
      authorName: "Quandale Dingle",
      authorHandle: "irlquandale",
      authorAvatarUrl: TIKTOK_AVATAR_URL,
      videoUrl:
        "https://v16m.tiktokcdn-us.com/example/video.mp4?mime_type=video_mp4",
      likeCount: 17284,
      commentCount: 103,
      shareCount: 2211,
      audio: {
        title: "original sound - irlquandale",
        artist: "Quandale Dingle",
      },
    });
    expect(result?.media).toEqual([
      {
        type: "video",
        url: "https://v16m.tiktokcdn-us.com/example/video.mp4?mime_type=video_mp4",
        thumbnailUrl:
          "https://p16-common-sign.tiktokcdn-us.com/example/origin-cover.webp",
        width: 576,
        height: 1024,
        contentType: "video/mp4",
        durationSeconds: 61.667,
      },
    ]);
  });

  it("prefers the uncropped TikTok origin cover for video posters", async () => {
    const croppedCoverUrl =
      "https://p19-common-sign.tiktokcdn-us.com/example/crop-center.jpeg";
    const originCoverUrl =
      "https://p16-common-sign.tiktokcdn-us.com/example/origin-cover.webp";
    const dynamicCoverUrl =
      "https://p19-common-sign.tiktokcdn-us.com/example/dynamic-cover.webp";
    const directVideoUrl =
      "https://v16m.tiktokcdn-us.com/example/video.mp4?mime_type=video_mp4";

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          code: 0,
          data: {
            id: "7657740052608339214",
            title: "Twitch:dre2funtyy",
            cover: croppedCoverUrl,
            origin_cover: originCoverUrl,
            ai_dynamic_cover: dynamicCoverUrl,
            play: directVideoUrl,
            duration: 12,
            author: {
              unique_id: "dre2funtyyy",
              nickname: "dre2funtyyy",
              avatar: TIKTOK_AVATAR_URL,
            },
          },
        }),
      ) as unknown as typeof fetch,
    );

    const result = await fetchTikTokProxyMetadata(
      "https://www.tiktok.com/@dre2funtyyy/video/7657740052608339214",
    );

    expect(result).toMatchObject({
      postType: "video",
      coverUrl: originCoverUrl,
    });
    expect(result?.media).toEqual([
      {
        type: "video",
        url: directVideoUrl,
        thumbnailUrl: originCoverUrl,
        contentType: "video/mp4",
        durationSeconds: 12,
      },
    ]);
  });

  it("maps TikTok live-photo slideshows into video media with still thumbnails", async () => {
    const heicCoverUrl =
      "https://p16-common-sign.tiktokcdn-us.com/example/live-cover.heic";

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          code: 0,
          data: {
            id: "7654964663997730066",
            title: "",
            content_desc: [],
            cover: heicCoverUrl,
            origin_cover: heicCoverUrl,
            ai_dynamic_cover: heicCoverUrl,
            duration: 0,
            play: TIKTOK_AUDIO_URL,
            wmplay: TIKTOK_AUDIO_URL,
            music: TIKTOK_AUDIO_URL,
            music_info: {
              title: "original sound - usahieudang199515",
              author: "Pets.VN",
              play: TIKTOK_AUDIO_URL,
              cover: TIKTOK_ARTWORK_URL,
            },
            play_count: 5660359,
            digg_count: 1304699,
            comment_count: 3315,
            share_count: 947286,
            create_time: 1782310354,
            author: {
              unique_id: "nt_hani",
              nickname: "hani",
              avatar: TIKTOK_AVATAR_URL,
            },
            images: TIKTOK_IMAGE_URLS.slice(0, 2),
            live_images: TIKTOK_LIVE_IMAGE_URLS,
          },
        }),
      ) as unknown as typeof fetch,
    );

    const result = await fetchTikTokProxyMetadata(
      "https://www.tiktok.com/t/ZTSH56wLh/",
    );

    expect(result).toMatchObject({
      id: "7654964663997730066",
      canonicalUrl: "https://www.tiktok.com/@nt_hani/photo/7654964663997730066",
      postType: "slideshow",
      coverUrl: TIKTOK_IMAGE_URLS[0],
    });
    expect(result?.videoUrl).toBeUndefined();
    expect(result?.media).toEqual([
      {
        type: "video",
        url: TIKTOK_LIVE_IMAGE_URLS[0],
        thumbnailUrl: TIKTOK_IMAGE_URLS[0],
        contentType: "video/mp4",
      },
      {
        type: "video",
        url: TIKTOK_LIVE_IMAGE_URLS[1],
        thumbnailUrl: TIKTOK_IMAGE_URLS[1],
        contentType: "video/mp4",
      },
    ]);
  });
});
