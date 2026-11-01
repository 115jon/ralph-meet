import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchTikTokProxyLookup } from "../share-preview-proxy";
import { upstreamGuard } from "../upstream-guard";
import {
  CLASSIFIED_ID,
  CLASSIFIED_SHORT_URL,
  CLASSIFIED_URL,
  GONE_ID,
  GONE_URL,
  LIVE_URL,
  TIKTOK_FIXTURES,
  htmlResponse,
  jsonResponse,
} from "../vendor-payloads/__tests__/fixtures/tiktok";

// One route table per test: each upstream answers from the captured fixtures,
// and every request is recorded so a test can assert what was (not) asked.
type Route = (url: string, init?: RequestInit) => Response | Promise<Response>;

function stubUpstreams(routes: {
  shortLink?: Route;
  player?: Route;
  page?: Route;
  tikwm?: Route;
}) {
  const calls: string[] = [];
  const fetchMock = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = input.toString();
      calls.push(url);
      if (url.includes("/t/") && routes.shortLink) {
        return routes.shortLink(url, init);
      }
      if (url.includes("/player/api/v1/items") && routes.player) {
        return routes.player(url, init);
      }
      if (url.includes("tikwm.com/api/") && routes.tikwm) {
        return routes.tikwm(url, init);
      }
      if (/tiktok\.com\/@[^/]+\/(video|photo)\//.test(url) && routes.page) {
        return routes.page(url, init);
      }
      return new Response("unexpected", { status: 418 });
    },
  );
  vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
  return {
    calls,
    count: (fragment: string) =>
      calls.filter((url) => url.includes(fragment)).length,
  };
}

function redirectedTo(url: string): Response {
  const response = new Response(null, { status: 200 });
  Object.defineProperty(response, "url", { value: url });
  return response;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("TikTok provider chain", () => {
  it("resolves the reported age-gated short link instead of calling it gone", async () => {
    const upstream = stubUpstreams({
      shortLink: () => redirectedTo(`${CLASSIFIED_URL}?_r=1&_t=ZT-9AB5yHZYcrW`),
      player: () => jsonResponse(TIKTOK_FIXTURES.playerNilCoreData),
      page: () => htmlResponse(TIKTOK_FIXTURES.pageContentClassified),
      tikwm: () => jsonResponse(TIKTOK_FIXTURES.tikwmContentClassified),
    });

    const lookup = await fetchTikTokProxyLookup(CLASSIFIED_SHORT_URL);

    expect(lookup.unavailable).toBe(false);
    expect(lookup.restricted).toBe(true);
    expect(lookup.metadata).toMatchObject({
      id: CLASSIFIED_ID,
      canonicalUrl: CLASSIFIED_URL,
      authorHandle: "ugnewwave",
      authorName: "ugnewwave",
      title: expect.stringContaining("#dirtbike"),
      videoUrl: expect.stringMatching(/^https:\/\/v16m\.tiktokcdn-us\.com\//),
      authorAvatarUrl: expect.stringMatching(/^https:/),
      coverUrl: expect.stringMatching(/^https:/),
      audio: expect.objectContaining({ title: "nothing left" }),
    });
    // The short link was resolved once, and tikwm got the canonical URL.
    expect(upstream.count("/t/ZTy59e3EJ")).toBe(1);
    expect(upstream.calls.find((url) => url.includes("tikwm"))).toContain(
      encodeURIComponent(CLASSIFIED_URL),
    );
  });

  it("keeps an age-gated post alive with its author when tikwm is blocked too", async () => {
    stubUpstreams({
      player: () => jsonResponse(TIKTOK_FIXTURES.playerNilCoreData),
      page: () => htmlResponse(TIKTOK_FIXTURES.pageContentClassified),
      tikwm: () => new Response("Not Found", { status: 404 }),
    });

    const lookup = await fetchTikTokProxyLookup(CLASSIFIED_URL);

    expect(lookup).toMatchObject({
      unavailable: false,
      restricted: true,
      baseline: { authorHandle: "ugnewwave", canonicalUrl: CLASSIFIED_URL },
    });
    expect(lookup.metadata?.audio?.title).toBe("nothing left");
    expect(lookup.metadata?.videoUrl).toBeUndefined();
  });

  it("does not call a post gone when the player API says nil_core_data and the page is unreachable", async () => {
    stubUpstreams({
      player: () => jsonResponse(TIKTOK_FIXTURES.playerNilCoreData),
      page: () => new Response("busy", { status: 503 }),
      tikwm: () => new Response("Not Found", { status: 404 }),
    });

    const lookup = await fetchTikTokProxyLookup(CLASSIFIED_URL);

    expect(lookup).toMatchObject({
      metadata: null,
      unavailable: false,
      transient: true,
      baseline: { authorHandle: "ugnewwave", id: CLASSIFIED_ID },
    });
  });

  it("tombstones a post only on the page's own 'item doesn't exist', without asking tikwm", async () => {
    const upstream = stubUpstreams({
      player: () => jsonResponse(TIKTOK_FIXTURES.playerNilCoreData),
      page: () => htmlResponse(TIKTOK_FIXTURES.pageGone),
      tikwm: () => jsonResponse({ code: -1, msg: "Url parsing is failed!" }),
    });

    const lookup = await fetchTikTokProxyLookup(GONE_URL);

    expect(lookup).toMatchObject({
      metadata: null,
      unavailable: true,
      baseline: { id: GONE_ID, authorHandle: "scout2015" },
    });
    expect(upstream.count("tikwm")).toBe(0);
  });

  it("costs one request for a public post the player API serves", async () => {
    const upstream = stubUpstreams({
      player: () => jsonResponse(TIKTOK_FIXTURES.playerItems),
      page: () => htmlResponse(TIKTOK_FIXTURES.pageLive),
      tikwm: () => jsonResponse(TIKTOK_FIXTURES.tikwmContentClassified),
    });

    const lookup = await fetchTikTokProxyLookup(LIVE_URL);

    expect(lookup.metadata).toMatchObject({
      authorHandle: "scout2015",
      videoUrl: expect.stringMatching(/^https:/),
    });
    expect(upstream.calls).toHaveLength(1);
  });

  it("shares one chain run between concurrent lookups and remembers the answer", async () => {
    let releasePlayer: () => void = () => {};
    const playerGate = new Promise<void>((resolve) => {
      releasePlayer = resolve;
    });
    const upstream = stubUpstreams({
      player: async () => {
        await playerGate;
        return jsonResponse(TIKTOK_FIXTURES.playerItems);
      },
    });

    const lookups = Promise.all([
      fetchTikTokProxyLookup(LIVE_URL),
      fetchTikTokProxyLookup(`${LIVE_URL}?is_from_webapp=1`),
      fetchTikTokProxyLookup(LIVE_URL),
    ]);
    releasePlayer();
    const [first, second, third] = await lookups;
    await fetchTikTokProxyLookup(LIVE_URL);

    expect(upstream.count("/player/api/v1/items")).toBe(1);
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it("backs off the player API after it refuses us, instead of asking on every lookup", async () => {
    const upstream = stubUpstreams({
      player: () => new Response("Not Found", { status: 404 }),
      page: () => htmlResponse(TIKTOK_FIXTURES.pageLive),
      tikwm: () => new Response("Not Found", { status: 404 }),
    });

    await fetchTikTokProxyLookup(LIVE_URL);
    await fetchTikTokProxyLookup(CLASSIFIED_URL);

    expect(upstream.count("/player/api/v1/items")).toBe(1);
    expect(upstream.count("tikwm.com")).toBe(2); // one per host, then open
    expect(upstreamGuard.remainingMs("tiktok-player-api")).toBeGreaterThan(0);
  });

  it("remembers a transient miss for a minute, then asks again", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const upstream = stubUpstreams({
        player: () => new Response("busy", { status: 503 }),
        page: () => new Response("busy", { status: 503 }),
        tikwm: () => new Response("busy", { status: 503 }),
      });

      await fetchTikTokProxyLookup(LIVE_URL);
      await fetchTikTokProxyLookup(LIVE_URL);
      expect(upstream.count("/player/api/v1/items")).toBe(1);

      vi.setSystemTime(Date.now() + 61_000);
      await fetchTikTokProxyLookup(LIVE_URL);
      expect(upstream.count("/player/api/v1/items")).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
