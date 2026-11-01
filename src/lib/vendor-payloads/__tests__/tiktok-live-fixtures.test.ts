import type { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { safeParse } from "@/lib/schema";
import {
  isTikTokPageGone,
  readTikTokPageVideoDetail,
  TikTokPlayerApiResponse,
  TikwmResponse,
} from "../tiktok";
import { OEmbedResponse } from "../oembed";
import { CLASSIFIED_ID, LIVE_ID, TIKTOK_FIXTURES } from "./fixtures/tiktok";

function decode<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  value: unknown,
): S["Type"] {
  const result = safeParse(schema, value);
  if (!result.success) throw new Error("expected the decode to succeed");
  return result.data;
}

describe("TikTok decoders against live responses (2026-11-01)", () => {
  it("player API: a public post decodes to an item with author, video and stats", () => {
    const payload = decode(
      TikTokPlayerApiResponse,
      TIKTOK_FIXTURES.playerItems,
    );
    const item = payload.items?.[0];

    expect(item?.id_str).toBe(LIVE_ID);
    expect(item?.author_info?.unique_id).toBe("scout2015");
    expect(item?.author_info?.avatar_url_list?.urls[0]).toMatch(/^https:/);
    expect(item?.video_info?.url_list?.urls.length).toBeGreaterThan(0);
    expect(item?.statistics_info?.digg_count).toBeGreaterThan(0);
  });

  it("player API: an age-gated post comes back as nil_core_data, no item", () => {
    const payload = decode(
      TikTokPlayerApiResponse,
      TIKTOK_FIXTURES.playerNilCoreData,
    );

    expect(payload.items).toBeUndefined();
    expect(payload.results?.[0]).toMatchObject({
      code: "nil_core_data",
      id_str: CLASSIFIED_ID,
    });
  });

  it("oEmbed: the 2026-11 shape has the player id but no title, author or thumbnail", () => {
    const payload = decode(OEmbedResponse, TIKTOK_FIXTURES.oembed);

    expect(payload.embed_product_id).toBe(CLASSIFIED_ID);
    expect(payload.html).toContain(`/player/v1/${CLASSIFIED_ID}`);
    expect(payload.author_name).toBeUndefined();
    expect(payload.title).toBeUndefined();
    expect(payload.thumbnail_url).toBeUndefined();
  });

  it("page: a public post has a full item", () => {
    const detail = readTikTokPageVideoDetail(TIKTOK_FIXTURES.pageLive);
    const item = detail?.itemInfo?.itemStruct;

    expect(detail?.statusCode).toBe(0);
    expect(isTikTokPageGone(detail)).toBe(false);
    expect(item?.id).toBe(LIVE_ID);
    expect(item?.author?.uniqueId).toBe("scout2015");
    expect(item?.video?.originCover).toMatch(/^https:/);
    expect(item?.stats?.diggCount).toBeGreaterThan(0);
    expect(item?.createTime).toBe(new Date(1564234358 * 1000).toISOString());
  });

  it("page: an age-gated post is an item stripped to its id, not a missing one", () => {
    const detail = readTikTokPageVideoDetail(
      TIKTOK_FIXTURES.pageContentClassified,
    );
    const item = detail?.itemInfo?.itemStruct;

    expect(detail?.statusCode).toBe(0);
    expect(isTikTokPageGone(detail)).toBe(false);
    expect(item).toMatchObject({
      id: CLASSIFIED_ID,
      isContentClassified: true,
    });
    expect(item?.author).toBeUndefined();
    // createTime "0" is a placeholder, not 1970.
    expect(item?.createTime).toBeUndefined();
    expect(detail?.shareMeta?.desc).toContain("♬ nothing left");
  });

  it("page: a post that never existed reports status 10204", () => {
    const detail = readTikTokPageVideoDetail(TIKTOK_FIXTURES.pageGone);

    expect(detail?.statusCode).toBe(10204);
    expect(isTikTokPageGone(detail)).toBe(true);
  });

  it("page: a bot wall or redesign without the script reads as no answer", () => {
    expect(readTikTokPageVideoDetail("<html><body>captcha</body></html>")).toBe(
      undefined,
    );
    expect(isTikTokPageGone(undefined)).toBe(false);
  });

  it("tikwm: still serves the age-gated post with a direct video", () => {
    const payload = decode(
      TikwmResponse,
      TIKTOK_FIXTURES.tikwmContentClassified,
    );

    expect(payload.code).toBe(0);
    expect(payload.data?.id).toBe(CLASSIFIED_ID);
    expect(payload.data?.author?.unique_id).toBe("ugnewwave");
    expect(payload.data?.play).toMatch(/^https:\/\/v16m\.tiktokcdn-us\.com\//);
    expect(payload.data?.music_info?.title).toBe("nothing left");
  });
});
