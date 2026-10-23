import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  gifHeader,
  mp4Header,
  pngHeader,
} from "../../lib/__tests__/media-header-fixtures";

const hoisted = vi.hoisted(() => ({
  store: new Map<string, { value: unknown; ttl: number }>(),
  resolveInstagramVideoMetadataMock: vi.fn(),
}));

vi.mock("@/lib/cache", () => ({
  cacheGet: vi.fn(async (key: string) => hoisted.store.get(key)?.value ?? null),
  cacheSet: vi.fn(async (key: string, value: unknown, ttl: number) => {
    hoisted.store.set(key, { value: JSON.parse(JSON.stringify(value)), ttl });
  }),
}));

vi.mock("@/lib/instagram-video-resolver", () => ({
  resolveInstagramVideoMetadata: hoisted.resolveInstagramVideoMetadataMock,
}));

import {
  EMBED_NEGATIVE_CACHE_SECONDS,
  buildOpenGraphEmbed,
  embedCacheKey,
  extractAndProcessEmbedsWithStatus,
  extractEmbedUrls,
  extractYouTubeVideoId,
  getLinkPreviewUserAgent,
  normalizeSpotifyUrl,
  type EmbedCacheEntry,
} from "../embed-fetcher";

type Handler = (
  url: string,
  init?: RequestInit,
) => Response | Promise<Response>;

function stubFetch(handler: Handler) {
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init),
  );
  vi.stubGlobal("fetch", mock);
  return mock;
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

beforeEach(() => {
  hoisted.store.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  hoisted.resolveInstagramVideoMetadataMock.mockReset();
});

describe("extractEmbedUrls", () => {
  it("drops trailing punctuation and unbalanced closing brackets", () => {
    expect(
      extractEmbedUrls(
        "(see https://github.com/cloudflare/workers-sdk). Also https://a.test/x, and https://en.wikipedia.org/wiki/Foo_(bar)!",
      ),
    ).toEqual([
      "https://github.com/cloudflare/workers-sdk",
      "https://a.test/x",
      "https://en.wikipedia.org/wiki/Foo_(bar)",
    ]);
  });

  it("takes the URL out of a markdown link", () => {
    expect(extractEmbedUrls("[docs](https://docs.test/page)")).toEqual([
      "https://docs.test/page",
    ]);
  });

  it("skips URLs inside inline code and code blocks", () => {
    expect(
      extractEmbedUrls(
        "`https://code.test/a` and\n```\nhttps://code.test/b\n```\nhttps://real.test/c",
      ),
    ).toEqual(["https://real.test/c"]);
  });

  it("dedupes and caps at three URLs", () => {
    expect(
      extractEmbedUrls(
        "https://a.test https://a.test https://b.test https://c.test https://d.test",
      ),
    ).toEqual(["https://a.test", "https://b.test", "https://c.test"]);
  });
});

describe("outcome classification", () => {
  it("treats a 404 page as no embed, not a failure", async () => {
    stubFetch(() => html("not found", 404));

    const result = await extractAndProcessEmbedsWithStatus(
      "https://news.test/missing",
    );

    expect(result).toMatchObject({ embeds: [], hadFailures: false });
    expect(result.outcomes[0]).toMatchObject({ status: "none" });
  });

  it("retries 5xx, 429 and network errors", async () => {
    stubFetch((url) => {
      if (url.includes("five")) return html("down", 503);
      if (url.includes("rate")) return html("slow down", 429);
      throw new TypeError("fetch failed");
    });

    const result = await extractAndProcessEmbedsWithStatus(
      "https://five.test https://rate.test https://dns.test",
    );

    expect(result.hadFailures).toBe(true);
    expect(result.outcomes.map((outcome) => outcome.status)).toEqual([
      "retry",
      "retry",
      "retry",
    ]);
  });

  it("returns the URLs that resolved and keeps the stored embed for the one that failed", async () => {
    stubFetch((url) => {
      if (url.startsWith("https://ok.test")) {
        return html(`<meta property="og:title" content="OK page">`);
      }
      return html("down", 502);
    });
    const previous = {
      id: "old",
      url: "https://flaky.test/post",
      type: "link" as const,
      rawTitle: "Stored",
      fields: [],
    };

    const result = await extractAndProcessEmbedsWithStatus(
      "https://ok.test/a https://flaky.test/post",
      { previous: [previous] },
    );

    expect(result.hadFailures).toBe(true);
    expect(result.embeds.map((embed) => embed.rawTitle)).toEqual([
      "OK page",
      "Stored",
    ]);
  });
});

describe("OpenGraph pages", () => {
  it("parses tolerant meta, resolves relative images and reads image size", () => {
    const embed = buildOpenGraphEmbed(
      "https://news.test/story",
      "https://www.news.test/story",
      `<head>
        <meta content="Big &amp; bold" property="og:title">
        <meta property="og:description" content="Something happened">
        <meta property="og:image" content="/img/hero.jpg">
        <meta property="og:image:width" content="1200">
        <meta property="og:image:height" content="630">
        <meta name="twitter:card" content="summary_large_image">
      </head>`,
    );

    expect(embed).toMatchObject({
      url: "https://news.test/story",
      type: "link",
      rawTitle: "Big & bold",
      rawDescription: "Something happened",
      provider: { name: "news.test", url: "https://www.news.test" },
      thumbnail: {
        url: "https://www.news.test/img/hero.jpg",
        width: 1200,
        height: 630,
      },
      imageLayout: "large",
    });
  });

  it("uses a small thumbnail for summary cards and square or unsized images", () => {
    const summary = buildOpenGraphEmbed(
      "https://a.test",
      "https://a.test",
      `<meta property="og:title" content="A"><meta property="og:image" content="https://a.test/logo.png"><meta name="twitter:card" content="summary">`,
    );
    const unsized = buildOpenGraphEmbed(
      "https://b.test",
      "https://b.test",
      `<meta property="og:title" content="B"><meta property="og:image" content="https://b.test/x.png">`,
    );
    expect(summary?.imageLayout).toBe("thumbnail");
    expect(unsized?.imageLayout).toBe("thumbnail");
  });

  it("falls back to <title> and returns nothing without any title", () => {
    expect(
      buildOpenGraphEmbed(
        "https://a.test",
        "https://a.test",
        "<title>Hi</title>",
      )?.rawTitle,
    ).toBe("Hi");
    expect(
      buildOpenGraphEmbed("https://a.test", "https://a.test", "<p>no head</p>"),
    ).toBeNull();
  });

  it("identifies as a link-preview crawler so bot walls serve OpenGraph", async () => {
    const fetchMock = stubFetch(() =>
      html(`<meta property="og:title" content="r/programming">`),
    );

    await extractAndProcessEmbedsWithStatus(
      "https://www.reddit.com/r/programming/",
    );

    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<
      string,
      string
    >;
    expect(headers["User-Agent"]).toContain("Discordbot/2.0");
    expect(getLinkPreviewUserAgent()).toContain("RalphMeetBot/1.0");
  });
});

describe("direct media links", () => {
  function media(type: string, body: Uint8Array): Response {
    return new Response(body as unknown as BodyInit, {
      status: 206,
      headers: { "content-type": type },
    });
  }

  it("embeds a PNG with its real size and asks only for the header bytes", async () => {
    const fetchMock = stubFetch(() => media("image/png", pngHeader(544, 184)));

    const { embeds } = await extractAndProcessEmbedsWithStatus(
      "https://cdn.test/logo.png",
    );

    expect(embeds[0]).toMatchObject({
      type: "image",
      direct: true,
      media: [
        {
          type: "image",
          url: "https://cdn.test/logo.png",
          width: 544,
          height: 184,
        },
      ],
    });
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<
      string,
      string
    >;
    expect(headers.Range).toMatch(/^bytes=0-/);
  });

  it("marks GIFs and sizes MP4s from their headers", async () => {
    stubFetch((url) =>
      url.endsWith(".gif")
        ? media("image/gif", gifHeader(400, 400))
        : media("video/mp4", mp4Header(1280, 720)),
    );

    const { embeds } = await extractAndProcessEmbedsWithStatus(
      "https://cdn.test/spin.gif https://cdn.test/clip.mp4",
    );

    expect(embeds[0].media?.[0]).toMatchObject({ isGif: true, width: 400 });
    expect(embeds[1]).toMatchObject({
      type: "video",
      direct: true,
      video: {
        url: "https://cdn.test/clip.mp4",
        kind: "direct",
        width: 1280,
        height: 720,
      },
    });
  });

  it("detects media by content type even without a file extension", async () => {
    stubFetch(() => media("image/png", pngHeader(64, 64)));

    const { embeds } = await extractAndProcessEmbedsWithStatus(
      "https://cdn.test/render?id=1",
    );

    expect(embeds[0]?.direct).toBe(true);
  });

  it("does not embed SVGs or arbitrary files", async () => {
    stubFetch((url) =>
      url.endsWith(".svg")
        ? media("image/svg+xml", new Uint8Array())
        : media("application/zip", new Uint8Array()),
    );

    const result = await extractAndProcessEmbedsWithStatus(
      "https://cdn.test/a.svg https://cdn.test/b.zip",
    );

    expect(result).toMatchObject({ embeds: [], hadFailures: false });
  });
});

describe("URL-level embed cache", () => {
  const PAGE = `<meta property="og:title" content="Cached page">`;

  it("serves a second request for the same URL from the cache", async () => {
    const fetchMock = stubFetch(() => html(PAGE));

    await extractAndProcessEmbedsWithStatus("https://cache.test/a");
    const second = await extractAndProcessEmbedsWithStatus(
      "https://cache.test/a",
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second.embeds[0]?.rawTitle).toBe("Cached page");
    expect(
      hoisted.store.get(embedCacheKey("https://cache.test/a")),
    ).toBeDefined();
  });

  it("negative-caches pages without an embed, briefly", async () => {
    const fetchMock = stubFetch(() => html("gone", 404));

    await extractAndProcessEmbedsWithStatus("https://cache.test/missing");
    await extractAndProcessEmbedsWithStatus("https://cache.test/missing");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const entry = hoisted.store.get(
      embedCacheKey("https://cache.test/missing"),
    );
    expect(entry?.ttl).toBe(EMBED_NEGATIVE_CACHE_SECONDS);
    expect((entry?.value as EmbedCacheEntry).status).toBe("none");
  });

  it("never caches a transient failure", async () => {
    const fetchMock = stubFetch(() => html("down", 503));

    await extractAndProcessEmbedsWithStatus("https://cache.test/flaky");
    await extractAndProcessEmbedsWithStatus("https://cache.test/flaky");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(hoisted.store.has(embedCacheKey("https://cache.test/flaky"))).toBe(
      false,
    );
  });

  it("serves a stale entry when the refresh fails transiently", async () => {
    hoisted.store.set(embedCacheKey("https://cache.test/stale"), {
      ttl: 999,
      value: {
        v: 2,
        status: "ok",
        freshUntil: Date.now() - 1000,
        embed: {
          id: "e",
          url: "https://cache.test/stale",
          type: "link",
          rawTitle: "Stale but fine",
          fields: [],
        },
      } satisfies EmbedCacheEntry,
    });
    const fetchMock = stubFetch(() => html("down", 503));

    const result = await extractAndProcessEmbedsWithStatus(
      "https://cache.test/stale",
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.hadFailures).toBe(false);
    expect(result.embeds[0]?.rawTitle).toBe("Stale but fine");
  });

  it("bypasses the cache when asked", async () => {
    const fetchMock = stubFetch(() => html(PAGE));

    await extractAndProcessEmbedsWithStatus("https://cache.test/b");
    await extractAndProcessEmbedsWithStatus("https://cache.test/b", {
      bypassCache: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("providers", () => {
  it("reads YouTube ids from every URL shape", () => {
    expect(extractYouTubeVideoId("https://youtu.be/oLb96nwOKDg?si=x")).toBe(
      "oLb96nwOKDg",
    );
    expect(
      extractYouTubeVideoId(
        "https://m.youtube.com/watch?feature=x&v=dQw4w9WgXcQ",
      ),
    ).toBe("dQw4w9WgXcQ");
    expect(
      extractYouTubeVideoId("https://www.youtube.com/shorts/tPEE9ZwTmy0"),
    ).toBe("tPEE9ZwTmy0");
    expect(
      extractYouTubeVideoId("https://www.youtube.com/live/abcDEF12345"),
    ).toBe("abcDEF12345");
    expect(
      extractYouTubeVideoId("https://music.youtube.com/watch?v=abcDEF12345"),
    ).toBe("abcDEF12345");
    expect(
      extractYouTubeVideoId("https://www.youtube.com/@channel"),
    ).toBeNull();
  });

  it("tombstones a removed YouTube video", async () => {
    stubFetch((url) =>
      url.startsWith("https://www.youtube.com/oembed")
        ? new Response("Not Found", { status: 404 })
        : html("", 404),
    );

    const { embeds, hadFailures } = await extractAndProcessEmbedsWithStatus(
      "https://www.youtube.com/watch?v=deadVideo01",
    );

    expect(hadFailures).toBe(false);
    expect(embeds[0]).toMatchObject({
      unavailable: true,
      provider: { name: "YouTube" },
    });
  });

  it("retries YouTube when oEmbed is rate limited", async () => {
    stubFetch(() => new Response("slow down", { status: 429 }));

    const { hadFailures } = await extractAndProcessEmbedsWithStatus(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );

    expect(hadFailures).toBe(true);
  });

  it("tombstones a deleted TikTok from the player API even though oEmbed says 200", async () => {
    stubFetch((url) => {
      if (url.startsWith("https://www.tiktok.com/oembed")) {
        return Response.json({
          html: '<iframe src="https://www.tiktok.com/player/v1/7644940658603592973">',
        });
      }
      if (url.includes("tiktok.com/player/api/v1/items")) {
        return Response.json({
          extra: { fatal_item_ids: [] },
          results: [
            {
              code: "nil_core_data",
              id: "7644940658603592973",
              id_str: "7644940658603592973",
            },
          ],
          status_code: 0,
        });
      }
      return new Response("unexpected", { status: 500 });
    });

    const { embeds, hadFailures } = await extractAndProcessEmbedsWithStatus(
      "https://www.tiktok.com/@irlquandale/video/7644940658603592973",
    );

    expect(hadFailures).toBe(false);
    expect(embeds[0]).toMatchObject({
      unavailable: true,
      provider: { name: "TikTok" },
    });
  });

  it("tombstones a deleted tweet even when vxtwitter answers with an HTML page", async () => {
    stubFetch((url) => {
      if (url.startsWith("https://api.fxtwitter.com")) {
        return Response.json(
          { code: 404, message: "NOT_FOUND" },
          { status: 404 },
        );
      }
      if (url.startsWith("https://api.vxtwitter.com")) {
        return html("<title>vxTwitter / fixvx</title>");
      }
      return html("<html></html>");
    });

    const { embeds, hadFailures } = await extractAndProcessEmbedsWithStatus(
      "https://x.com/NASA/status/1801349146546057624",
    );

    expect(hadFailures).toBe(false);
    expect(embeds[0]).toMatchObject({ unavailable: true });
  });

  it("strips the Spotify locale segment", () => {
    expect(
      normalizeSpotifyUrl("https://open.spotify.com/intl-de/track/abc?si=1"),
    ).toBe("https://open.spotify.com/track/abc?si=1");
  });
});
