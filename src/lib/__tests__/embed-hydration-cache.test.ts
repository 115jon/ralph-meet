import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ERROR_DEFAULT_TTL_MS,
  MISSING_TTL_MS,
  clearEmbedHydrationCache,
  earliestSignedUrlExpiry,
  hydrationKey,
  loadEmbedHydration,
  peekEmbedHydration,
  retryEmbedHydration,
} from "../embed-hydration-cache";

const KEY = hydrationKey(
  "/api/tiktok-video",
  "https://www.tiktok.com/@a/video/1",
);

afterEach(() => {
  clearEmbedHydrationCache();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("earliestSignedUrlExpiry", () => {
  it("reads TikTok x-expires and Instagram hex oe stamps", () => {
    expect(
      earliestSignedUrlExpiry({
        a: "https://v.tiktokcdn.com/x?x-expires=1800000600&s=1",
        b: "https://scontent.cdninstagram.com/y?oe=6B49D3C0",
      }),
    ).toBe(Math.min(1_800_000_600, 0x6b49d3c0) * 1000);
    expect(earliestSignedUrlExpiry({ a: "https://plain.test/x" })).toBeNull();
  });
});

describe("loadEmbedHydration", () => {
  it("shares one request between concurrent callers and caches the answer", async () => {
    const fetchMock = vi.fn(async () => Response.json({ title: "hi" }));
    vi.stubGlobal("fetch", fetchMock);

    const [a, b] = await Promise.all([
      loadEmbedHydration(KEY, "/api/x"),
      loadEmbedHydration(KEY, "/api/x"),
    ]);
    const c = await loadEmbedHydration(KEY, "/api/x");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a).toEqual({ status: "ok", payload: { title: "hi" } });
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it("never keeps a payload past its signatures", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2027-01-01T00:00:00Z"));
    const now = Math.floor(Date.now() / 1000);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          videoUrl: `https://v.test/v.mp4?x-expires=${now + 20 * 60}`,
        }),
      ),
    );

    await loadEmbedHydration(KEY, "/api/x");
    expect(peekEmbedHydration(KEY)?.status).toBe("ok");

    // 20 minutes of validity minus the 5 minute safety window.
    vi.setSystemTime(Date.now() + 15 * 60 * 1000 + 1);
    expect(peekEmbedHydration(KEY)).toBeNull();
  });

  it("remembers a confirmed 404 for ten minutes", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () =>
      Response.json(
        { error: "This TikTok is no longer available", unavailable: true },
        { status: 404 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadEmbedHydration(KEY, "/api/x")).resolves.toEqual({
      status: "missing",
    });
    await expect(loadEmbedHydration(KEY, "/api/x")).resolves.toEqual({
      status: "missing",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + MISSING_TTL_MS + 1);
    expect(peekEmbedHydration(KEY)).toBeNull();
  });

  it("does not call a stray 404 (not our route's verdict) a missing post", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response("<html>Not Found</html>", { status: 404 }),
      ),
    );

    await expect(loadEmbedHydration(KEY, "/api/x")).resolves.toMatchObject({
      status: "error",
      transient: false,
    });
  });

  it("remembers an error until Retry-After, so remounts do not refetch", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("busy", { status: 503, headers: { "Retry-After": "60" } }),
      )
      .mockResolvedValueOnce(Response.json({ title: "back" }));
    vi.stubGlobal("fetch", fetchMock);

    const first = await loadEmbedHydration(KEY, "/api/x");
    expect(first).toMatchObject({ status: "error", transient: true });
    // Seven remounts in a minute (the reported session): one request.
    for (let mount = 0; mount < 7; mount += 1) {
      await loadEmbedHydration(KEY, "/api/x");
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + 60_001);
    await expect(loadEmbedHydration(KEY, "/api/x")).resolves.toEqual({
      status: "ok",
      payload: { title: "back" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("backs off 30 seconds after a network error without Retry-After", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => {
      throw new TypeError("offline");
    });
    vi.stubGlobal("fetch", fetchMock);

    await loadEmbedHydration(KEY, "/api/x");
    vi.setSystemTime(Date.now() + ERROR_DEFAULT_TTL_MS - 1);
    await loadEmbedHydration(KEY, "/api/x");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 2);
    await loadEmbedHydration(KEY, "/api/x");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("lets an explicit retry past a remembered error", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("busy", {
          status: 503,
          headers: { "Retry-After": "300" },
        }),
      )
      .mockResolvedValueOnce(Response.json({ title: "back" }));
    vi.stubGlobal("fetch", fetchMock);

    await loadEmbedHydration(KEY, "/api/x");
    await expect(retryEmbedHydration(KEY, "/api/x")).resolves.toEqual({
      status: "ok",
      payload: { title: "back" },
    });
  });
});
