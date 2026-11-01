import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchTikTokProxyLookup } from "../share-preview-proxy";
import { resetUpstreamState, upstreamGuard } from "../upstream-guard";
import { EGRESS_PROXY_CIRCUIT } from "../egress-proxy";
import {
  CLASSIFIED_SHORT_URL,
  CLASSIFIED_URL,
  GONE_URL,
  LIVE_URL,
  TIKTOK_FIXTURES,
  htmlResponse,
  jsonResponse,
} from "../vendor-payloads/__tests__/fixtures/tiktok";
import {
  disableEgress,
  enableEgress,
  proxyError,
  redirectedTo,
  stubTikTokNetwork,
} from "./egress-fakes";

const FREE_API_LIMIT = {
  code: -1,
  msg: "Free Api Limit: 10000 request/ 1 day.",
};

beforeEach(() => {
  resetUpstreamState();
  enableEgress();
});

afterEach(() => {
  disableEgress();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("tikwm", () => {
  it("always goes through the proxy when it is enabled, never direct", async () => {
    const net = stubTikTokNetwork({
      direct: {
        player: () => jsonResponse(TIKTOK_FIXTURES.playerNilCoreData),
        page: () => htmlResponse(TIKTOK_FIXTURES.pageContentClassified),
        tikwm: () => jsonResponse(FREE_API_LIMIT),
      },
      egress: {
        tikwm: () => jsonResponse(TIKTOK_FIXTURES.tikwmContentClassified),
      },
    });

    const lookup = await fetchTikTokProxyLookup(CLASSIFIED_URL);

    expect(net.count("direct", "tikwm.com")).toBe(0);
    expect(net.count("egress", "tikwm.com/api/")).toBe(1);
    expect(lookup.metadata?.videoUrl).toMatch(
      /^https:\/\/v16m\.tiktokcdn-us\.com\//,
    );
    // tikwm is asked about the canonical post, with the headers it wants.
    const call = net.calls.find((c) => c.network === "egress")!;
    expect(call.url).toContain(encodeURIComponent(CLASSIFIED_URL));
    expect(call.headers).toMatchObject({
      referer: "https://www.tikwm.com/",
      accept: "application/json",
    });
    expect(call.headers).not.toHaveProperty("origin");
  });

  it("goes direct only when the proxy is disabled (local dev, Previews)", async () => {
    disableEgress();
    const net = stubTikTokNetwork({
      direct: {
        player: () => jsonResponse(TIKTOK_FIXTURES.playerNilCoreData),
        page: () => htmlResponse(TIKTOK_FIXTURES.pageContentClassified),
        tikwm: () => jsonResponse(TIKTOK_FIXTURES.tikwmContentClassified),
      },
    });

    const lookup = await fetchTikTokProxyLookup(CLASSIFIED_URL);

    expect(net.count("egress")).toBe(0);
    expect(net.proxyRequests).toHaveLength(0);
    expect(net.count("direct", "tikwm.com/api/")).toBe(1);
    expect(lookup.metadata?.videoUrl).toBeTruthy();
  });

  it("does not fall back to a direct request when the proxy fails", async () => {
    const net = stubTikTokNetwork({
      direct: {
        player: () => jsonResponse(TIKTOK_FIXTURES.playerNilCoreData),
        page: () => htmlResponse(TIKTOK_FIXTURES.pageContentClassified),
        tikwm: () => jsonResponse(TIKTOK_FIXTURES.tikwmContentClassified),
      },
      proxyOverride: () => proxyError(424, "upstream_timeout").response,
    });

    const lookup = await fetchTikTokProxyLookup(CLASSIFIED_URL);

    expect(net.count("direct", "tikwm.com")).toBe(0);
    expect(lookup.metadata?.videoUrl).toBeUndefined();
    expect(lookup.restricted).toBe(true);
    expect(lookup.transient).toBe(false); // the page still gave the post's card
  });

  it("surfaces tikwm's own daily limit through the proxy as a transient miss and backs off", async () => {
    const net = stubTikTokNetwork({
      direct: {
        player: () => jsonResponse(TIKTOK_FIXTURES.playerNilCoreData),
        page: () => new Response("busy", { status: 503 }),
      },
      egress: {
        tikwm: () => jsonResponse(FREE_API_LIMIT),
        page: () => new Response("busy", { status: 503 }),
        player: () => jsonResponse(TIKTOK_FIXTURES.playerNilCoreData),
      },
    });

    const lookup = await fetchTikTokProxyLookup(CLASSIFIED_URL);
    expect(lookup.transient).toBe(true);
    expect(net.count("egress", "tikwm.com/api/")).toBe(1);
    expect(
      upstreamGuard.remainingMs("tikwm:www.tikwm.com@egress"),
    ).toBeGreaterThan(60_000);
  });
});

describe("player API and page", () => {
  it("retries a refused player API through the proxy and stops there", async () => {
    const net = stubTikTokNetwork({
      direct: { player: () => new Response("Not Found", { status: 404 }) },
      egress: { player: () => jsonResponse(TIKTOK_FIXTURES.playerItems) },
    });

    const lookup = await fetchTikTokProxyLookup(LIVE_URL);

    expect(net.count("direct", "/player/api/v1/items")).toBe(1);
    expect(net.count("egress", "/player/api/v1/items")).toBe(1);
    expect(net.calls).toHaveLength(2); // no page, no tikwm
    expect(lookup.metadata).toMatchObject({
      authorHandle: "scout2015",
      videoUrl: expect.stringMatching(/^https:/),
    });
    expect(lookup.transient).toBe(false);
  });

  it.each([
    ["a 403", () => new Response("no", { status: 403 })],
    ["a 429", () => new Response("slow", { status: 429 })],
    ["a 502", () => new Response("bad gateway", { status: 502 })],
    [
      "a network error",
      () => {
        throw new TypeError("fetch failed");
      },
    ],
  ])(
    "retries through the proxy after %s from the player API",
    async (_, route) => {
      const net = stubTikTokNetwork({
        direct: { player: route },
        egress: { player: () => jsonResponse(TIKTOK_FIXTURES.playerItems) },
      });
      const lookup = await fetchTikTokProxyLookup(LIVE_URL);
      expect(net.count("egress", "/player/api/v1/items")).toBe(1);
      expect(lookup.metadata?.authorHandle).toBe("scout2015");
    },
  );

  it("does not use the proxy for a player API that answered", async () => {
    const net = stubTikTokNetwork({
      direct: { player: () => jsonResponse(TIKTOK_FIXTURES.playerItems) },
    });
    await fetchTikTokProxyLookup(LIVE_URL);
    expect(net.count("egress")).toBe(0);
    expect(net.proxyRequests).toHaveLength(0);
  });

  it("does not double-fetch a page that answered 'gone'", async () => {
    const net = stubTikTokNetwork({
      direct: {
        player: () => jsonResponse(TIKTOK_FIXTURES.playerNilCoreData),
        page: () => htmlResponse(TIKTOK_FIXTURES.pageGone),
      },
    });

    const lookup = await fetchTikTokProxyLookup(GONE_URL);

    expect(lookup.unavailable).toBe(true);
    expect(net.count("egress")).toBe(0);
    expect(net.calls).toHaveLength(2);
  });

  it("does not re-ask the proxy about a page that already showed the post is age-gated", async () => {
    const net = stubTikTokNetwork({
      direct: {
        player: () => jsonResponse(TIKTOK_FIXTURES.playerNilCoreData),
        page: () => htmlResponse(TIKTOK_FIXTURES.pageContentClassified),
      },
      egress: {
        tikwm: () => jsonResponse(TIKTOK_FIXTURES.tikwmContentClassified),
      },
    });
    const lookup = await fetchTikTokProxyLookup(CLASSIFIED_URL);

    expect(lookup.restricted).toBe(true);
    expect(net.count("egress", "/player/api/")).toBe(0);
    expect(net.count("egress", "/@ugnewwave/video/")).toBe(0);
  });

  it("retries a blocked page through the proxy and learns it is gone there", async () => {
    const net = stubTikTokNetwork({
      direct: {
        player: () => jsonResponse(TIKTOK_FIXTURES.playerNilCoreData),
        page: () => new Response("blocked", { status: 403 }),
      },
      egress: { page: () => htmlResponse(TIKTOK_FIXTURES.pageGone) },
    });

    const lookup = await fetchTikTokProxyLookup(GONE_URL);

    expect(lookup.unavailable).toBe(true);
    expect(net.count("direct", "/video/")).toBe(1);
    expect(net.count("egress", "/video/")).toBe(1);
    // Gone is final: not even the player API is asked again.
    expect(net.count("egress", "/player/api/")).toBe(0);
  });

  it("asks the proxy for the player API when direct said nothing and the page gave nothing", async () => {
    const net = stubTikTokNetwork({
      direct: {
        player: () => jsonResponse(TIKTOK_FIXTURES.playerNilCoreData),
        page: () => new Response("busy", { status: 503 }),
      },
      egress: {
        page: () => new Response("busy", { status: 503 }),
        player: () => jsonResponse(TIKTOK_FIXTURES.playerItems),
      },
    });

    const lookup = await fetchTikTokProxyLookup(LIVE_URL);

    expect(net.count("egress", "/video/")).toBe(1);
    expect(net.count("egress", "/player/api/")).toBe(1);
    expect(lookup.metadata?.authorHandle).toBe("scout2015");
  });

  it("falls back to the old behaviour when the proxy is disabled", async () => {
    disableEgress();
    const net = stubTikTokNetwork({
      direct: {
        player: () => new Response("Not Found", { status: 404 }),
        page: () => htmlResponse(TIKTOK_FIXTURES.pageLive),
        tikwm: () => new Response("Not Found", { status: 404 }),
      },
    });

    await fetchTikTokProxyLookup(LIVE_URL);

    expect(net.count("egress")).toBe(0);
    expect(net.proxyRequests).toHaveLength(0);
  });
});

describe("short links", () => {
  it("resolves directly first and does not call /resolve when that works", async () => {
    const net = stubTikTokNetwork({
      direct: {
        shortLink: () => redirectedTo(`${CLASSIFIED_URL}?_r=1`),
        player: () => jsonResponse(TIKTOK_FIXTURES.playerItems),
      },
    });
    await fetchTikTokProxyLookup(CLASSIFIED_SHORT_URL);
    expect(net.proxyRequests).toHaveLength(0);
  });

  it("asks the proxy to resolve a short link the direct request could not", async () => {
    const net = stubTikTokNetwork({
      direct: {
        shortLink: () => new Response("blocked", { status: 403 }),
        player: () => jsonResponse(TIKTOK_FIXTURES.playerNilCoreData),
        page: () => htmlResponse(TIKTOK_FIXTURES.pageContentClassified),
      },
      egress: {
        shortLink: () => redirectedTo(`${CLASSIFIED_URL}?_r=1&_t=x`),
        tikwm: () => jsonResponse(TIKTOK_FIXTURES.tikwmContentClassified),
      },
    });

    const lookup = await fetchTikTokProxyLookup(CLASSIFIED_SHORT_URL);

    const resolve = net.calls.find((c) => c.method === "RESOLVE");
    expect(resolve?.url).toBe(CLASSIFIED_SHORT_URL);
    expect(lookup.metadata).toMatchObject({
      canonicalUrl: CLASSIFIED_URL,
      videoUrl: expect.stringMatching(/^https:/),
    });
    // The player API and page were asked about the resolved id, not the link.
    expect(net.count("direct", "item_ids=7691175039722425630")).toBe(1);
  });

  it("keeps the short link when neither route can resolve it", async () => {
    stubTikTokNetwork({
      direct: { shortLink: () => new Response("blocked", { status: 403 }) },
      egress: { shortLink: () => proxyError(424, "upstream_timeout").response },
    });
    const lookup = await fetchTikTokProxyLookup(CLASSIFIED_SHORT_URL);
    expect(lookup.metadata).toBeNull();
    expect(lookup.unavailable).toBe(false);
  });
});

describe("circuit separation", () => {
  it("keeps asking the proxy while the direct player API is backing off", async () => {
    const net = stubTikTokNetwork({
      direct: { player: () => new Response("Not Found", { status: 404 }) },
      egress: { player: () => jsonResponse(TIKTOK_FIXTURES.playerItems) },
    });

    await fetchTikTokProxyLookup(LIVE_URL);
    await fetchTikTokProxyLookup(`${LIVE_URL.slice(0, -3)}999`);

    // The 404 opened the direct circuit: the second lookup skips direct ...
    expect(net.count("direct", "/player/api/v1/items")).toBe(1);
    expect(upstreamGuard.remainingMs("tiktok-player-api")).toBeGreaterThan(0);
    // ... and still reaches the proxy, whose own circuit stayed closed.
    expect(net.count("egress", "/player/api/v1/items")).toBe(2);
    expect(upstreamGuard.remainingMs("tiktok-player-api@egress")).toBe(0);
    expect(upstreamGuard.remainingMs(EGRESS_PROXY_CIRCUIT)).toBe(0);
  });

  it("stops asking the proxy while it is rejecting requests, instead of looping", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const net = stubTikTokNetwork({
      direct: { player: () => new Response("Not Found", { status: 404 }) },
      proxyOverride: () => proxyError(401, "bad_signature", "no").response,
    });

    const first = await fetchTikTokProxyLookup(LIVE_URL);
    await fetchTikTokProxyLookup(CLASSIFIED_URL);

    expect(first.transient).toBe(true);
    expect(net.proxyRequests.length).toBeLessThanOrEqual(1);
    expect(
      errors.mock.calls.filter((call) =>
        JSON.stringify(call).includes("The egress proxy refused a request"),
      ),
    ).toHaveLength(1);
  });

  it("shares one proxy call between concurrent lookups of the same post", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const net = stubTikTokNetwork({
      direct: { player: () => new Response("Not Found", { status: 404 }) },
      egress: {
        player: async () => {
          await gate;
          return jsonResponse(TIKTOK_FIXTURES.playerItems);
        },
      },
    });

    const lookups = Promise.all([
      fetchTikTokProxyLookup(LIVE_URL),
      fetchTikTokProxyLookup(`${LIVE_URL}?is_from_webapp=1`),
      fetchTikTokProxyLookup(LIVE_URL),
    ]);
    // Let the lookups reach the gated proxy call before releasing it.
    await vi.waitFor(() => expect(net.count("egress")).toBe(1));
    release();
    const [first, second] = await lookups;
    await fetchTikTokProxyLookup(LIVE_URL);

    expect(net.count("egress", "/player/api/v1/items")).toBe(1);
    expect(second).toBe(first);
  });
});
