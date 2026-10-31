import type { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { safeParse } from "@/lib/schema";
import {
  InstagramGraphqlResponse,
  InstagramMediaInfoResponse,
  InstagramOEmbedResponse,
  InstagramVideoApiResponse,
} from "../instagram";
import {
  OEmbedResponse,
  YouTubePbjResponse,
  YouTubePlayerResponse,
  readYouTubePbjPlayerResponse,
} from "../oembed";
import { TikTokPlayerApiResponse, TikwmResponse } from "../tiktok";

function decode<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  input: unknown,
): S["Type"] {
  const result = safeParse(schema, input);
  if (!result.success) throw new Error("expected the decode to succeed");
  return result.data;
}

const ROOTS_THAT_ARE_NOT_OBJECTS = [null, undefined, 7, "text", []];

describe.each([
  ["TikTok player API", TikTokPlayerApiResponse],
  ["tikwm", TikwmResponse],
  ["Instagram oEmbed", InstagramOEmbedResponse],
  ["Instagram video API", InstagramVideoApiResponse],
  ["Instagram media info", InstagramMediaInfoResponse],
  ["Instagram GraphQL", InstagramGraphqlResponse],
  ["oEmbed", OEmbedResponse],
  ["YouTube player", YouTubePlayerResponse],
])("%s root", (_name, schema) => {
  it("accepts an empty object", () => {
    expect(decode(schema, {})).toEqual({});
  });

  it("rejects a root that is not an object, so callers take their no-data path", () => {
    for (const root of ROOTS_THAT_ARE_NOT_OBJECTS) {
      expect(safeParse(schema, root).success).toBe(false);
    }
  });

  it("keeps keys it does not declare", () => {
    expect(decode(schema, { vendor_added_this: { a: 1 } })).toMatchObject({
      vendor_added_this: { a: 1 },
    });
  });
});

describe("TikTok player API", () => {
  const item = {
    id_str: "7644940658603592973",
    desc: "  LMAO  ",
    author_info: {
      unique_id: "irlquandale",
      nickname: "Quandale Dingle",
      avatar_url_list: ["https://cdn.test/avatar.jpeg"],
    },
    statistics_info: { digg_count: 17284, comment_count: "103" },
    video_info: {
      cover: { url_list: ["https://cdn.test/cover.jpeg"] },
      origin_cover: { url_list: ["https://cdn.test/origin.webp"] },
      meta: { duration: 51, width: 576, height: 1024 },
      url_list: ["https://cdn.test/video.mp4?mime_type=video_mp4"],
      profiles: [{ play_addr: { url_list: ["https://cdn.test/p.mp4"] } }],
    },
    music_info: { title: "original sound", author: "Quandale" },
    new_vendor_field: true,
  };

  it("decodes a real-shaped item and normalizes url references", () => {
    const [first] = decode(TikTokPlayerApiResponse, { items: [item] }).items!;

    expect(first.id_str).toBe("7644940658603592973");
    expect(first.desc).toBe("LMAO");
    expect(first.author_info?.avatar_url_list).toEqual({
      urls: ["https://cdn.test/avatar.jpeg"],
    });
    expect(first.video_info?.origin_cover?.urls).toEqual([
      "https://cdn.test/origin.webp",
    ]);
    expect(first.video_info?.url_list?.urls).toEqual([
      "https://cdn.test/video.mp4?mime_type=video_mp4",
    ]);
    expect(first.video_info?.profiles?.[0].play_addr?.urls).toEqual([
      "https://cdn.test/p.mp4",
    ]);
    expect(first.statistics_info).toMatchObject({
      digg_count: 17284,
      comment_count: 103,
    });
    expect(first.video_info?.meta).toMatchObject({ duration: 51, width: 576 });
    expect(first.new_vendor_field).toBe(true);
  });

  it("passes with every optional field missing", () => {
    expect(decode(TikTokPlayerApiResponse, { items: [{}] }).items).toEqual([
      {},
    ]);
  });

  it("drops wrong-typed fields without failing the item", () => {
    const [first] = decode(TikTokPlayerApiResponse, {
      items: [
        {
          id_str: 5,
          desc: ["x"],
          author_info: "someone",
          statistics_info: { digg_count: "many", comment_count: -4 },
          video_info: { meta: { duration: "soon" }, url_list: 3 },
        },
      ],
    }).items!;

    expect(first.id_str).toBeUndefined();
    expect(first.desc).toBeUndefined();
    expect(first.author_info).toBeUndefined();
    expect(first.statistics_info).toEqual({});
    expect(first.video_info?.meta).toEqual({});
    expect(first.video_info?.url_list).toBeUndefined();
  });

  it("drops items that are not objects and keeps the rest", () => {
    expect(
      decode(TikTokPlayerApiResponse, { items: [null, "x", { id_str: "1" }] })
        .items,
    ).toEqual([{ id_str: "1" }]);
  });

  it("reads the gone markers", () => {
    const decoded = decode(TikTokPlayerApiResponse, {
      extra: { fatal_item_ids: [123456789, "9"] },
      results: [{ code: "nil_core_data", id_str: "1" }, { code: 4 }, 3],
    });

    expect(decoded.extra?.fatal_item_ids).toEqual(["123456789", "9"]);
    expect(decoded.results).toEqual([
      { code: "nil_core_data", id_str: "1" },
      {},
    ]);
  });
});

describe("tikwm", () => {
  it("decodes a real-shaped payload", () => {
    const decoded = decode(TikwmResponse, {
      code: 0,
      msg: "success",
      data: {
        id: "7649484991986027806",
        title: "",
        content_desc: ["a", "", 5, "b"],
        images: ["https://cdn.test/1.jpeg", 4],
        cover: "https://cdn.test/cover.webp",
        duration: 12,
        play_count: 12416,
        digg_count: "2311",
        create_time: 1781034537,
        music_info: { title: "original sound", author: "Tonya" },
        author: { unique_id: "feetlattee", nickname: "natalia" },
        brand_new_field: [1],
      },
    });

    expect(decoded.code).toBe(0);
    expect(decoded.data).toMatchObject({
      id: "7649484991986027806",
      content_desc: ["a", "b"],
      images: ["https://cdn.test/1.jpeg"],
      digg_count: 2311,
      create_time: new Date(1781034537 * 1000).toISOString(),
      author: { unique_id: "feetlattee" },
      brand_new_field: [1],
    });
    expect(decoded.data).not.toHaveProperty("title");
  });

  it("turns create_time into an ISO timestamp from seconds, numeric strings or dates", () => {
    const at = (create_time: unknown) =>
      decode(TikwmResponse, { code: 0, data: { create_time } }).data
        ?.create_time;

    expect(at("1781034537")).toBe(new Date(1781034537 * 1000).toISOString());
    expect(at("2026-06-09T12:00:00Z")).toBe("2026-06-09T12:00:00.000Z");
    expect(at("yesterday")).toBeUndefined();
    expect(at(1e20)).toBeUndefined();
    expect(at({})).toBeUndefined();
  });

  it("treats a non-object data as absent", () => {
    expect(decode(TikwmResponse, { code: 0, data: "oops" })).toEqual({
      code: 0,
    });
  });
});

describe("Instagram", () => {
  it("oEmbed: decodes the public shape and drops retyped fields", () => {
    expect(
      decode(InstagramOEmbedResponse, {
        media_id: "3878972523924185684_1",
        title: "caption",
        author_name: "someone",
        thumbnail_url: "https://cdn.test/t.jpg",
        thumbnail_width: 640,
        thumbnail_height: "tall",
        version: "1.0",
      }),
    ).toEqual({
      media_id: "3878972523924185684_1",
      title: "caption",
      author_name: "someone",
      thumbnail_url: "https://cdn.test/t.jpg",
      thumbnail_width: 640,
      version: "1.0",
    });
    expect(decode(InstagramOEmbedResponse, { media_id: 5 })).toEqual({});
  });

  it("video API: keeps only well-formed media entries", () => {
    const decoded = decode(InstagramVideoApiResponse, {
      videoUrl: "https://cdn.test/v.mp4",
      durationSeconds: "7",
      authorVerified: "true",
      media: [
        { type: "video", url: "https://cdn.test/v.mp4", width: 10, altText: 3 },
        { type: "gif", url: "https://cdn.test/x" },
        { type: "image" },
        { type: "image", url: "https://cdn.test/i.jpg" },
      ],
      audio: { title: "t", url: 1 },
    });

    expect(decoded.videoUrl).toBe("https://cdn.test/v.mp4");
    expect(decoded.durationSeconds).toBeUndefined();
    expect(decoded.authorVerified).toBeUndefined();
    expect(decoded.media).toEqual([
      { type: "video", url: "https://cdn.test/v.mp4", width: 10 },
      { type: "image", url: "https://cdn.test/i.jpg" },
    ]);
    expect(decoded.audio).toEqual({ title: "t" });
  });

  it("media info: decodes a post with a carousel, caption and music", () => {
    const [first] = decode(InstagramMediaInfoResponse, {
      items: [
        {
          caption: { text: "rukia!" },
          like_count: 1073,
          taken_at: 1782190800,
          user: { username: "tas", is_verified: true },
          video_versions: [
            { url: "https://cdn.test/low.mp4", width: 100, height: 100 },
            { url: "https://cdn.test/high.mp4", width: 400, height: 400 },
          ],
          image_versions2: {
            candidates: [{ url: "https://cdn.test/a.jpg", width: 10 }],
          },
          carousel_media: [{ image_versions2: { candidates: [] } }, 4],
          clips_metadata: {
            music_info: { music_asset_info: { title: "song" } },
          },
          unmodelled_field: 1,
        },
      ],
    }).items!;

    expect(first.caption?.text).toBe("rukia!");
    expect(first.user).toEqual({ username: "tas", is_verified: true });
    expect(first.video_versions).toHaveLength(2);
    expect(first.carousel_media).toHaveLength(1);
    expect(first.clips_metadata?.music_info?.music_asset_info?.title).toBe(
      "song",
    );
    expect(first.unmodelled_field).toBe(1);
  });

  it("media info: missing and wrong-typed fields are absent, not fatal", () => {
    expect(decode(InstagramMediaInfoResponse, { items: [{}] }).items).toEqual([
      {},
    ]);
    const [first] = decode(InstagramMediaInfoResponse, {
      items: [
        {
          like_count: "1073",
          caption: "text",
          user: 5,
          video_versions: [{ url: 3 }, { url: "https://cdn.test/v.mp4" }],
        },
      ],
    }).items!;
    expect(first.like_count).toBeUndefined();
    expect(first.caption).toBeUndefined();
    expect(first.user).toBeUndefined();
    expect(first.video_versions).toEqual([{ url: "https://cdn.test/v.mp4" }]);
  });

  it("GraphQL: reaches the first caption edge", () => {
    expect(
      decode(InstagramGraphqlResponse, {
        data: {
          xdt_shortcode_media: {
            video_url: "https://cdn.test/v.mp4",
            edge_media_to_caption: { edges: [{ node: { text: "hi" } }, 3] },
          },
        },
      }).data?.xdt_shortcode_media?.edge_media_to_caption?.edges,
    ).toEqual([{ node: { text: "hi" } }]);
    expect(
      decode(InstagramGraphqlResponse, { data: { xdt_shortcode_media: null } }),
    ).toEqual({ data: {} });
  });
});

describe("oEmbed", () => {
  it("decodes a YouTube oEmbed response and keeps blank strings", () => {
    expect(
      decode(OEmbedResponse, {
        title: "",
        author_name: "72hrs",
        thumbnail_url: "https://i.ytimg.com/vi/x/hqdefault.jpg",
        thumbnail_width: 480,
        thumbnail_height: "360",
        html: "<iframe></iframe>",
        type: "video",
      }),
    ).toEqual({
      title: "",
      author_name: "72hrs",
      thumbnail_url: "https://i.ytimg.com/vi/x/hqdefault.jpg",
      thumbnail_width: 480,
      html: "<iframe></iframe>",
      type: "video",
    });
  });
});

describe("YouTube player response", () => {
  it("keeps formats that have usable positive dimensions", () => {
    const decoded = decode(YouTubePlayerResponse, {
      playabilityStatus: { status: "OK" },
      streamingData: {
        formats: [{ itag: 18, width: 640, height: 360 }, { itag: 17 }],
        adaptiveFormats: [
          { width: "1080", height: 1920 },
          { width: 0, height: 5 },
          { width: "wide", height: 5 },
        ],
      },
    });

    expect(decoded.streamingData?.formats).toEqual([
      { itag: 18, width: 640, height: 360 },
      { itag: 17 },
    ]);
    expect(decoded.streamingData?.adaptiveFormats).toEqual([
      { width: 1080, height: 1920 },
      { height: 5 },
      { height: 5 },
    ]);
    expect(decoded.playabilityStatus).toEqual({ status: "OK" });
  });

  it("treats a retyped streamingData as absent", () => {
    expect(decode(YouTubePlayerResponse, { streamingData: "gone" })).toEqual(
      {},
    );
  });

  it("finds the player response in a single object or a list of objects", () => {
    const playerResponse = {
      streamingData: { formats: [{ width: 1, height: 2 }] },
    };

    for (const body of [
      { playerResponse },
      [{ page: "watch" }, { playerResponse }],
    ]) {
      const parsed = safeParse(YouTubePbjResponse, body);
      expect(parsed.success).toBe(true);
      if (!parsed.success) continue;
      expect(readYouTubePbjPlayerResponse(parsed.data)).toEqual(playerResponse);
    }

    const none = safeParse(YouTubePbjResponse, [{ page: "watch" }, 3]);
    expect(none.success && readYouTubePbjPlayerResponse(none.data)).toBe(
      undefined,
    );
  });
});
