import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLASSIFIED_ID,
  CLASSIFIED_SHORT_URL,
  CLASSIFIED_URL,
  GONE_URL,
  LIVE_URL,
  TIKTOK_FIXTURES,
  htmlResponse,
  jsonResponse,
} from "@/lib/vendor-payloads/__tests__/fixtures/tiktok";

const hoisted = vi.hoisted(() => ({
  store: new Map<string, { value: unknown; ttl: number }>(),
}));

vi.mock("@/lib/cache", () => ({
  cacheGet: vi.fn(async (key: string) => hoisted.store.get(key)?.value ?? null),
  cacheSet: vi.fn(async (key: string, value: unknown, ttl: number) => {
    hoisted.store.set(key, { value: JSON.parse(JSON.stringify(value)), ttl });
  }),
}));

import { extractAndProcessEmbedsWithStatus } from "../embed-fetcher";

type Route = () => Response | Promise<Response>;

/** oEmbed answers like it does today: 200 with a bare player for any id. */
function oembedFor(id: string): Response {
  return jsonResponse({
    ...TIKTOK_FIXTURES.oembed,
    embed_product_id: id,
    html: TIKTOK_FIXTURES.oembed.html.replaceAll(CLASSIFIED_ID, id),
  });
}

function stubTikTok(routes: {
  oembed?: Route;
  shortLink?: Route;
  player?: Route;
  page?: Route;
  tikwm?: Route;
}) {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = input.toString();
    const route = url.startsWith("https://www.tiktok.com/oembed")
      ? routes.oembed
      : url.includes("/player/api/v1/items")
        ? routes.player
        : url.includes("tikwm.com/api/")
          ? routes.tikwm
          : url.includes("/t/")
            ? routes.shortLink
            : /tiktok\.com\/@[^/]+\/(video|photo)\//.test(url)
              ? routes.page
              : undefined;
    return route ? route() : new Response("unexpected", { status: 418 });
  });
  vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
  return fetchMock;
}

beforeEach(() => {
  hoisted.store.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("TikTok embeds from the provider chain", () => {
  it("renders the reported short link with author, caption, cover and a playable video", async () => {
    stubTikTok({
      oembed: () => oembedFor(CLASSIFIED_ID),
      shortLink: () => {
        const response = new Response(null);
        Object.defineProperty(response, "url", {
          value: `${CLASSIFIED_URL}?_r=1`,
        });
        return response;
      },
      player: () => jsonResponse(TIKTOK_FIXTURES.playerNilCoreData),
      page: () => htmlResponse(TIKTOK_FIXTURES.pageContentClassified),
      tikwm: () => jsonResponse(TIKTOK_FIXTURES.tikwmContentClassified),
    });

    const { embeds, hadFailures } =
      await extractAndProcessEmbedsWithStatus(CLASSIFIED_SHORT_URL);

    expect(hadFailures).toBe(false);
    expect(embeds[0]).toMatchObject({
      url: CLASSIFIED_SHORT_URL,
      type: "video",
      provider: { name: "TikTok" },
      author: {
        name: "ugnewwave",
        url: "https://www.tiktok.com/@ugnewwave",
        iconURL: expect.stringMatching(/^https:/),
      },
      rawTitle: expect.stringContaining("#dirtbike"),
      thumbnail: { url: expect.stringMatching(/^https:/) },
      media: [
        expect.objectContaining({ type: "video", contentType: "video/mp4" }),
      ],
    });
    expect(embeds[0].unavailable).toBeUndefined();
    expect(embeds[0].restricted).toBeUndefined();
  });

  it("still renders when oEmbed is fine but the player API, page and tikwm all fail", async () => {
    stubTikTok({
      oembed: () => oembedFor(CLASSIFIED_ID),
      player: () => new Response("Not Found", { status: 404 }),
      page: () => new Response("busy", { status: 503 }),
      tikwm: () => new Response("Not Found", { status: 404 }),
    });

    const { embeds, hadFailures } =
      await extractAndProcessEmbedsWithStatus(CLASSIFIED_URL);

    expect(hadFailures).toBe(false);
    expect(embeds[0]).toMatchObject({
      type: "video",
      author: { name: "ugnewwave", url: "https://www.tiktok.com/@ugnewwave" },
      rawTitle: "TikTok · @ugnewwave",
      video: {
        kind: "player",
        url: `https://www.tiktok.com/player/v1/${CLASSIFIED_ID}`,
      },
    });
    expect(embeds[0].unavailable).toBeUndefined();
  });

  it("links out instead of TikTok's player for an age-gated post with no direct video", async () => {
    stubTikTok({
      oembed: () => oembedFor(CLASSIFIED_ID),
      player: () => jsonResponse(TIKTOK_FIXTURES.playerNilCoreData),
      page: () => htmlResponse(TIKTOK_FIXTURES.pageContentClassified),
      tikwm: () => new Response("Not Found", { status: 404 }),
    });

    const { embeds } = await extractAndProcessEmbedsWithStatus(CLASSIFIED_URL);

    expect(embeds[0]).toMatchObject({
      restricted: true,
      author: { name: "ugnewwave" },
      audio: { title: "nothing left" },
    });
    expect(embeds[0].video).toBeUndefined();
    expect(embeds[0].unavailable).toBeUndefined();
  });

  it("tombstones a post TikTok's page says does not exist, keeping its author", async () => {
    stubTikTok({
      oembed: () => oembedFor("6718335390845095999"),
      player: () => jsonResponse(TIKTOK_FIXTURES.playerNilCoreData),
      page: () => htmlResponse(TIKTOK_FIXTURES.pageGone),
    });

    const { embeds } = await extractAndProcessEmbedsWithStatus(GONE_URL);

    expect(embeds[0]).toMatchObject({
      unavailable: true,
      checkedAt: expect.any(String),
      author: { name: "scout2015" },
    });
  });

  it("tombstones on an oEmbed 404 for the post when no source has it", async () => {
    stubTikTok({
      oembed: () => new Response("not found", { status: 404 }),
      player: () => new Response("Not Found", { status: 404 }),
      page: () => htmlResponse("<html></html>"),
      tikwm: () => jsonResponse({ code: -1, msg: "Url parsing is failed!" }),
    });

    const { embeds } = await extractAndProcessEmbedsWithStatus(GONE_URL);

    expect(embeds[0]).toMatchObject({ unavailable: true });
  });

  it("does not tombstone on an oEmbed 403 (a bot wall says nothing about the post)", async () => {
    stubTikTok({
      oembed: () => new Response("forbidden", { status: 403 }),
      player: () => new Response("Not Found", { status: 404 }),
      page: () => htmlResponse("<html></html>"),
      tikwm: () => jsonResponse({ code: -1, msg: "Url parsing is failed!" }),
    });

    const { embeds } = await extractAndProcessEmbedsWithStatus(LIVE_URL);

    expect(embeds[0]?.unavailable).toBeUndefined();
    expect(embeds[0]).toMatchObject({
      author: { name: "scout2015" },
      video: { kind: "player" },
    });
  });

  it("retries later when every source is down", async () => {
    stubTikTok({
      oembed: () => new Response("busy", { status: 503 }),
      player: () => new Response("busy", { status: 503 }),
      page: () => new Response("busy", { status: 503 }),
      tikwm: () => new Response("busy", { status: 503 }),
    });

    const { embeds, hadFailures } =
      await extractAndProcessEmbedsWithStatus(LIVE_URL);

    expect(hadFailures).toBe(true);
    expect(embeds).toHaveLength(0);
  });
});
