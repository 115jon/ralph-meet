import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchInstagramVideoMetadata,
  fetchTikTokProxyMetadata,
  getTikTokShareUrl,
  lookupInstagramOEmbed,
  getTikTokThumbnailUrl,
  proxyImage,
} from "../share-preview-proxy";

describe("share preview proxy", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("finds TikTok thumbnails from the share snapshot", () => {
    const share = {
      snapshot: {
        embeds: [
          {
            url: "https://www.tiktok.com/@johnny/video/123",
            provider: { name: "TikTok" },
            thumbnail: {
              url: "https://p16-common-sign.tiktokcdn-us.com/thumb.jpeg",
            },
          },
        ],
      },
    } as any;

    expect(getTikTokThumbnailUrl(share)).toBe(
      "https://p16-common-sign.tiktokcdn-us.com/thumb.jpeg",
    );
  });

  it("finds TikTok source URLs from the share snapshot", () => {
    const share = {
      snapshot: {
        embeds: [
          {
            url: "https://www.tiktok.com/@johnny/video/123",
            provider: { name: "TikTok" },
          },
        ],
      },
    } as any;

    expect(getTikTokShareUrl(share)).toBe(
      "https://www.tiktok.com/@johnny/video/123",
    );
  });

  it("loads refreshed TikTok proxy metadata", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          code: 0,
          data: {
            title: "hello",
            cover: "https://p16-common-sign.tiktokcdn-us.com/fresh.jpeg",
            play: "https://v19.tiktokcdn-us.com/video.mp4",
            author: { nickname: "Johnny" },
          },
        }),
      ),
    );

    await expect(
      fetchTikTokProxyMetadata("https://www.tiktok.com/@johnny/video/123"),
    ).resolves.toMatchObject({
      title: "hello",
      coverUrl: "https://p16-common-sign.tiktokcdn-us.com/fresh.jpeg",
      videoUrl: "https://v19.tiktokcdn-us.com/video.mp4",
      authorName: "Johnny",
    });
  });

  it("retries the alternate Tikwm host when the primary metadata request fails", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = input.toString();

      if (url === "https://www.tiktok.com/player/api/v1/items?item_ids=123") {
        return new Response("not found", { status: 404 });
      }

      if (url.startsWith("https://www.tikwm.com/api/?url=")) {
        return new Response("forbidden", {
          status: 403,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
          },
        });
      }

      if (url.startsWith("https://tikwm.com/api/?url=")) {
        return Response.json({
          code: 0,
          data: {
            title: "hello",
            cover: "https://p16-common-sign.tiktokcdn-us.com/fresh.jpeg",
            play: "https://v19.tiktokcdn-us.com/video.mp4",
            author: { nickname: "Johnny" },
          },
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    await expect(
      fetchTikTokProxyMetadata("https://www.tiktok.com/@johnny/video/123"),
    ).resolves.toMatchObject({
      title: "hello",
      coverUrl: "https://p16-common-sign.tiktokcdn-us.com/fresh.jpeg",
      videoUrl: "https://v19.tiktokcdn-us.com/video.mp4",
      authorName: "Johnny",
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("proxies fetchable images with safe headers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("image-bytes", {
            status: 200,
            headers: {
              "Content-Type": "image/jpeg",
              "Content-Length": "11",
            },
          }),
      ),
    );

    const response = await proxyImage(
      "https://p16-common-sign.tiktokcdn-us.com/thumb.jpeg",
    );

    expect(response).not.toBeNull();
    expect(response?.headers.get("Content-Type")).toBe("image/jpeg");
    expect(response?.headers.get("Cross-Origin-Resource-Policy")).toBe(
      "cross-origin",
    );
    expect(await response?.text()).toBe("image-bytes");
  });

  it("falls back when the upstream image refuses bot fetches", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Forbidden", { status: 403 })),
    );

    await expect(
      proxyImage("https://p16-common-sign.tiktokcdn-us.com/thumb.jpeg"),
    ).resolves.toBeNull();
  });
});

describe("Instagram payloads", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubJson(body: string, status = 200) {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(body, {
            status,
            headers: { "content-type": "application/json" },
          }),
      ) as unknown as typeof fetch,
    );
  }

  it("oEmbed: maps the public shape and keeps only well-typed fields", async () => {
    stubJson(
      JSON.stringify({
        media_id: "3878972523924185684_1",
        title: "caption",
        author_name: 7,
        thumbnail_url: "https://cdn.test/t.jpg",
        thumbnail_width: 640,
        thumbnail_height: "tall",
        unmodelled: true,
      }),
    );

    const { status, metadata } = await lookupInstagramOEmbed(
      "https://www.instagram.com/p/ABC/",
    );

    expect(status).toBe(200);
    expect(metadata).toEqual({
      mediaId: "3878972523924185684_1",
      title: "caption",
      authorName: undefined,
      authorUrl: undefined,
      providerName: undefined,
      providerUrl: undefined,
      thumbnailUrl: "https://cdn.test/t.jpg",
      thumbnailWidth: 640,
      thumbnailHeight: undefined,
    });
  });

  it.each(["null", "[]", '"text"', "3"])(
    "oEmbed: a body of %s is no metadata",
    async (body) => {
      stubJson(body);

      await expect(
        lookupInstagramOEmbed("https://www.instagram.com/p/ABC/"),
      ).resolves.toEqual({ status: 200, metadata: null });
    },
  );

  it("video API: filters malformed media and retyped fields", async () => {
    stubJson(
      JSON.stringify({
        videoUrl: "https://cdn.test/v.mp4",
        title: 5,
        durationSeconds: 12.5,
        media: [
          { type: "video", url: "https://cdn.test/v.mp4", width: 10 },
          { type: "audio", url: "https://cdn.test/a.mp3" },
          { type: "image", url: 4 },
        ],
        audio: { title: "t", artist: false },
        authorVerified: "yes",
      }),
    );

    const metadata = await fetchInstagramVideoMetadata(
      "https://www.instagram.com/reel/ABC/",
    );

    expect(metadata).toMatchObject({
      videoUrl: "https://cdn.test/v.mp4",
      durationSeconds: 12.5,
      media: [{ type: "video", url: "https://cdn.test/v.mp4", width: 10 }],
      audio: { title: "t" },
    });
    expect(metadata?.title).toBeUndefined();
    expect(metadata?.authorVerified).toBeUndefined();
    expect(metadata?.audio?.artist).toBeUndefined();
  });

  it.each(["null", "[]", '"text"'])(
    "video API: a body of %s is no metadata",
    async (body) => {
      stubJson(body);

      await expect(
        fetchInstagramVideoMetadata("https://www.instagram.com/reel/ABC/"),
      ).resolves.toBeNull();
    },
  );
});
