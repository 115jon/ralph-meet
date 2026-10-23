import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  store: new Map<string, { value: unknown; ttl: number }>(),
  lookupMock: vi.fn(),
}));

vi.mock("@/lib/cache", () => ({
  cacheGet: vi.fn(async (key: string) => hoisted.store.get(key)?.value ?? null),
  cacheSet: vi.fn(async (key: string, value: unknown, ttl: number) => {
    hoisted.store.set(key, { value, ttl });
  }),
}));

vi.mock("@/lib/share-preview-proxy", () => ({
  fetchTikTokProxyLookup: hoisted.lookupMock,
}));

import {
  GET,
  TIKTOK_GONE_TTL,
  isTikTokVideoResultFresh,
  tiktokGoneCacheKey,
  tiktokVideoCacheControl,
  tiktokVideoCacheKey,
  tiktokVideoKvTtl,
  type TikTokVideoResult,
} from "../tiktok-video";

const POST_URL = "https://www.tiktok.com/@killa_cop_/video/7646427256587308308";

function request(videoUrl = POST_URL) {
  return GET({
    request: new Request(
      `https://meet.test/api/tiktok-video?videoUrl=${encodeURIComponent(videoUrl)}`,
    ),
  });
}

function signed(path: string, expiresAt: number) {
  return `https://v19.tiktokcdn-us.com/${path}?x-expires=${expiresAt}`;
}

beforeEach(() => {
  hoisted.store.clear();
  hoisted.lookupMock.mockReset();
});

describe("tiktok video signatures", () => {
  // From the user's work in progress.
  it("treats a cached TikTok result as stale once its signature is inside the safety window", () => {
    const now = 1_800_000_000;
    const fresh: TikTokVideoResult = {
      videoUrl: `https://v19.tiktokcdn-us.com/example/video.mp4?x-expires=${now + 3600}`,
      coverUrl: `https://p16-common-sign.tiktokcdn-us.com/example/cover.jpeg?x-expires=${now + 3600}`,
    };
    const expiring: TikTokVideoResult = {
      videoUrl: `https://v19.tiktokcdn-us.com/example/video.mp4?x-expires=${now + 60}`,
      coverUrl: null,
    };

    expect(isTikTokVideoResultFresh(fresh, now)).toBe(true);
    expect(isTikTokVideoResultFresh(expiring, now)).toBe(false);
    expect(tiktokVideoCacheControl(fresh, now)).toBe("private, max-age=2700");
    expect(tiktokVideoCacheControl(expiring, now)).toBe("no-store");
  });

  it("caps the KV lifetime at the earliest signature minus the safety window", () => {
    const now = 1_800_000_000;
    expect(
      tiktokVideoKvTtl(
        {
          videoUrl: signed("v.mp4", now + 20 * 60),
          coverUrl: signed("c.jpg", now + 3600),
        },
        now,
      ),
    ).toBe(15 * 60);
    expect(tiktokVideoKvTtl({ videoUrl: null, coverUrl: null }, now)).toBe(
      50 * 60,
    );
  });
});

describe("GET /api/tiktok-video", () => {
  it("resolves, caches and then serves the result from KV", async () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    hoisted.lookupMock.mockResolvedValue({
      metadata: {
        videoUrl: signed("video.mp4", future),
        coverUrl: signed("cover.jpg", future),
        title: "What's up",
      },
      unavailable: false,
      transient: false,
    });

    const first = await request();
    const second = await request();

    expect(first.status).toBe(200);
    expect(first.headers.get("Cache-Control")).toMatch(/^private, max-age=/);
    expect(second.status).toBe(200);
    expect(hoisted.lookupMock).toHaveBeenCalledTimes(1);
    expect(hoisted.store.has(tiktokVideoCacheKey(POST_URL))).toBe(true);
  });

  it("refetches when the cached signatures are about to expire", async () => {
    const now = Math.floor(Date.now() / 1000);
    hoisted.store.set(tiktokVideoCacheKey(POST_URL), {
      ttl: 60,
      value: { videoUrl: signed("old.mp4", now + 30), coverUrl: null },
    });
    hoisted.lookupMock.mockResolvedValue({
      metadata: { videoUrl: signed("new.mp4", now + 3600), coverUrl: null },
      unavailable: false,
      transient: false,
    });

    const response = await request();
    const body = (await response.json()) as TikTokVideoResult;

    expect(body.videoUrl).toContain("new.mp4");
  });

  it("answers a confirmed-gone post with 404 and negative-caches it", async () => {
    hoisted.lookupMock.mockResolvedValue({
      metadata: null,
      unavailable: true,
      transient: false,
    });

    const first = await request();
    const second = await request();

    expect(first.status).toBe(404);
    await expect(first.json()).resolves.toMatchObject({ unavailable: true });
    expect(first.headers.get("Cache-Control")).toBe(
      `private, max-age=${TIKTOK_GONE_TTL}`,
    );
    expect(second.status).toBe(404);
    expect(hoisted.lookupMock).toHaveBeenCalledTimes(1);
    expect(hoisted.store.get(tiktokGoneCacheKey(POST_URL))?.ttl).toBe(
      TIKTOK_GONE_TTL,
    );
  });

  it("does not call an upstream outage a missing post", async () => {
    hoisted.lookupMock.mockResolvedValue({
      metadata: null,
      unavailable: false,
      transient: true,
    });

    const response = await request();

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(hoisted.store.size).toBe(0);
  });

  it("rejects non-TikTok URLs", async () => {
    const response = await request("https://example.com/video/1");
    expect(response.status).toBe(400);
  });
});
