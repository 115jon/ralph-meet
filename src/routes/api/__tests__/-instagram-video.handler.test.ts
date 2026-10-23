import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  store: new Map<string, { value: unknown; ttl: number }>(),
  resolveMock: vi.fn(),
  oembedMock: vi.fn(),
}));

vi.mock("@/lib/cache", () => ({
  cacheGet: vi.fn(async (key: string) => hoisted.store.get(key)?.value ?? null),
  cacheSet: vi.fn(async (key: string, value: unknown, ttl: number) => {
    hoisted.store.set(key, { value, ttl });
  }),
}));

vi.mock("@/lib/instagram-video-resolver", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/instagram-video-resolver")>();
  return { ...actual, resolveInstagramVideoMetadata: hoisted.resolveMock };
});

vi.mock("@/lib/share-preview-proxy", () => ({
  lookupInstagramOEmbed: hoisted.oembedMock,
}));

import {
  GET,
  INSTAGRAM_GONE_TTL,
  instagramGoneCacheKey,
} from "../instagram-video";

const POST_URL = "https://www.instagram.com/reel/DXU4PV2AGJU/";

function request(videoUrl = POST_URL) {
  return GET({
    request: new Request(
      `https://meet.test/api/instagram-video?videoUrl=${encodeURIComponent(videoUrl)}`,
    ),
  });
}

beforeEach(() => {
  hoisted.store.clear();
  hoisted.resolveMock.mockReset();
  hoisted.oembedMock.mockReset();
});

describe("GET /api/instagram-video", () => {
  it("caches privately and no longer than the signed CDN URLs last", async () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 20 * 60;
    hoisted.resolveMock.mockResolvedValue({
      videoUrl: `https://scontent.cdninstagram.com/v.mp4?oe=${expiresAt.toString(16)}`,
      thumbnailUrl: null,
      title: "reel",
      durationSeconds: 3,
    });

    const response = await request();
    const cacheControl = response.headers.get("Cache-Control") ?? "";
    const maxAge = Number(cacheControl.match(/max-age=(\d+)/)?.[1]);

    expect(response.status).toBe(200);
    expect(cacheControl.startsWith("private")).toBe(true);
    // 20 minutes left minus the 5 minute safety window.
    expect(maxAge).toBeLessThanOrEqual(15 * 60);
    expect(maxAge).toBeGreaterThan(14 * 60);
  });

  it("returns 404 and negative-caches a post oEmbed confirms is gone", async () => {
    hoisted.resolveMock.mockRejectedValue(new Error("media info failed"));
    hoisted.oembedMock.mockResolvedValue({ status: 404, metadata: null });

    const first = await request();
    const second = await request();

    expect(first.status).toBe(404);
    await expect(first.json()).resolves.toMatchObject({ unavailable: true });
    expect(second.status).toBe(404);
    expect(hoisted.resolveMock).toHaveBeenCalledTimes(1);
    expect(hoisted.store.get(instagramGoneCacheKey(POST_URL))?.ttl).toBe(
      INSTAGRAM_GONE_TTL,
    );
  });

  it("keeps a failed scrape of a live post a retryable 502", async () => {
    hoisted.resolveMock.mockRejectedValue(new Error("session expired"));
    hoisted.oembedMock.mockResolvedValue({ status: 200, metadata: {} });

    const response = await request();

    expect(response.status).toBe(502);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(hoisted.store.size).toBe(0);
  });
});
