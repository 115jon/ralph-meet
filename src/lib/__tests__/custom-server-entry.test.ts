import { describe, expect, it, vi } from "vitest";

const consumeBackgroundTaskBatch = vi.hoisted(() =>
  vi.fn(async () => undefined),
);
const retryR2Cleanup = vi.hoisted(() => vi.fn(async () => undefined));
const retryMessagePostprocessing = vi.hoisted(() =>
  vi.fn(async () => undefined),
);
const syncCollectiblesCatalog = vi.hoisted(() =>
  vi.fn(async () => ({
    source: "yapper" as const,
    categories: [],
    items: [],
    syncedAt: "2026-07-22T00:00:00.000Z",
  })),
);
const tanStackHandler = vi.hoisted(() =>
  vi.fn(
    async () =>
      new Response("<html><body>fallback</body></html>", {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }),
  ),
);
const handlePartyTracksProxyRequest = vi.hoisted(() =>
  vi.fn(async () => Response.json({ proxied: true })),
);

vi.mock("@tanstack/react-start/server", () => ({
  createStartHandler: vi.fn(() => tanStackHandler),
  defaultStreamHandler: vi.fn(),
}));

vi.mock("@/lib/ytdlp/http", () => ({
  handleYtDlpRequest: vi.fn(async () => null),
}));

vi.mock("@/lib/ytdlp/upstream", () => ({
  syncYtDlpUpstream: vi.fn(async () => undefined),
}));

vi.mock("../../../realtime/meeting-room", () => ({
  MeetingRoom: class {},
}));

vi.mock("../../../realtime/rate-limiter-do", () => ({
  RateLimiterDO: class {},
}));

vi.mock("../../../realtime/voice-room", () => ({
  VoiceRoom: class {},
}));

vi.mock("../../../realtime/partytracks-proxy", () => ({
  handlePartyTracksProxyRequest,
}));

vi.mock("../../../src/lib/background-tasks", () => ({
  consumeBackgroundTaskBatch,
  retryMessagePostprocessing,
}));

vi.mock("../../../src/services/r2-cleanup.service", () => ({
  retryR2Cleanup,
}));

vi.mock("../../../src/lib/collectibles-catalog", () => ({
  COLLECTIBLES_SYNC_CRON: "17 * * * *",
  CatalogFetchDeferredError: class CatalogFetchDeferredError extends Error {},
  syncCollectiblesCatalog,
}));

import server from "../../../custom-server-entry";
import { SOUNDBOARD_MEDIA_RATE_LIMIT } from "../../../realtime/rate-limiter";

describe("custom server PartyTracks routing", () => {
  it("routes channel PartyTracks requests before the application handler", async () => {
    handlePartyTracksProxyRequest.mockClear();
    tanStackHandler.mockClear();
    const request = new Request(
      "https://meet.test/api/channels/room-one/partytracks/sessions/new",
      { method: "POST" },
    );
    const env = {
      CALLS_APP_ID: "app",
      CALLS_APP_SECRET: "secret",
    } as Parameters<typeof server.fetch>[1];
    const ctx = { waitUntil: vi.fn() } as unknown as ExecutionContext;

    const response = await server.fetch(request, env, ctx);

    await expect(response.json()).resolves.toEqual({ proxied: true });
    expect(handlePartyTracksProxyRequest).toHaveBeenCalledWith(request, env);
    expect(tanStackHandler).not.toHaveBeenCalled();
  });
});

describe("custom server soundboard media rate limiting", () => {
  it("returns 429 after the aggregate requester and route threshold", async () => {
    const ctx = {
      waitUntil: vi.fn(),
    } as unknown as ExecutionContext;
    const env = {} as Parameters<typeof server.fetch>[1];

    for (let i = 0; i < SOUNDBOARD_MEDIA_RATE_LIMIT.limit; i += 1) {
      const response = await server.fetch(
        new Request(
          `https://meet.test/api/soundboard/uploads/rotating-${i}?cap=cap-${i}`,
          { headers: { "CF-Connecting-IP": "1.2.3.4" } },
        ),
        env,
        ctx,
      );
      expect(response.status).toBe(200);
    }

    const response = await server.fetch(
      new Request(
        "https://meet.test/api/soundboard/uploads/rotating-next?cap=cap-next",
        { headers: { "CF-Connecting-IP": "1.2.3.4" } },
      ),
      env,
      ctx,
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBeTruthy();
  });

  it("wires Queue batches to the background task consumer", async () => {
    consumeBackgroundTaskBatch.mockClear();
    const batch = {
      queue: "ralph-meet-background-tasks",
      messages: [],
    } as unknown as MessageBatch<unknown>;
    const env = {
      CACHE: {},
      DB: {},
      BUCKET: {},
      MEETING_ROOM: {},
    } as Parameters<typeof server.queue>[1];

    await server.queue(batch, env, {} as ExecutionContext);

    expect(consumeBackgroundTaskBatch).toHaveBeenCalledWith(batch, {
      DB: env.DB,
      BUCKET: env.BUCKET,
      CACHE: env.CACHE,
      MEETING_ROOM: env.MEETING_ROOM,
    });
  });

  it("runs maintenance jobs, not the catalog, on the 6-hour cron", async () => {
    syncCollectiblesCatalog.mockClear();
    retryR2Cleanup.mockClear();
    retryMessagePostprocessing.mockClear();
    const waitUntil = vi.fn();
    const env = { DB: {} } as Parameters<typeof server.scheduled>[1];

    await server.scheduled(
      { cron: "0 */6 * * *" } as ScheduledController,
      env,
      { waitUntil } as unknown as ExecutionContext,
    );

    expect(syncCollectiblesCatalog).not.toHaveBeenCalled();
    expect(retryR2Cleanup).toHaveBeenCalledWith(env.DB, undefined);
    expect(retryMessagePostprocessing).toHaveBeenCalledWith(env);
    expect(waitUntil).toHaveBeenCalledTimes(3);
  });

  it("syncs the catalog on its hourly cron and isolates its failure", async () => {
    syncCollectiblesCatalog.mockClear();
    retryMessagePostprocessing.mockClear();
    syncCollectiblesCatalog.mockRejectedValueOnce(new Error("upstream 403"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const waitUntil = vi.fn();
    const env = { DB: {} } as Parameters<typeof server.scheduled>[1];

    await expect(
      server.scheduled({ cron: "17 * * * *" } as ScheduledController, env, {
        waitUntil,
      } as unknown as ExecutionContext),
    ).resolves.toBeUndefined();

    expect(syncCollectiblesCatalog).toHaveBeenCalledWith(env.DB, {
      trigger: "cron",
    });
    // The hourly cron also sweeps message postprocessing (embed retries).
    expect(retryMessagePostprocessing).toHaveBeenCalledWith(env);
    expect(waitUntil).toHaveBeenCalledTimes(2);
    const results = await Promise.all(
      waitUntil.mock.calls.map((call) => call[0]),
    );
    expect(results).toContainEqual(
      expect.objectContaining({ ok: false, error: "upstream 403" }),
    );
  });
});

describe("custom server document security headers", () => {
  const env = {} as Parameters<typeof server.fetch>[1];
  const ctx = { waitUntil: vi.fn() } as unknown as ExecutionContext;

  it("adds compatible security headers to HTML fallback responses", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("<html>streamed</html>"));
        controller.close();
      },
    });
    const fallback = new Response(body, {
      status: 201,
      statusText: "Created",
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "X-Preserved": "yes",
      },
    });
    tanStackHandler.mockResolvedValueOnce(fallback);

    const response = await server.fetch(
      new Request("https://meet.test/"),
      env,
      ctx,
    );

    expect(response.status).toBe(201);
    expect(response.statusText).toBe("Created");
    expect(response.headers.get("X-Preserved")).toBe("yes");
    expect(response.headers.get("Content-Security-Policy")).toBe(
      "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' https: data: blob:; media-src 'self' https: blob:; connect-src 'self' https: wss: ws: https://auth.115jon.site https://api.github.com https://cloudflareinsights.com; worker-src 'self' blob:; frame-src 'self' https:",
    );
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Referrer-Policy")).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(response.headers.get("Permissions-Policy")).toBe(
      'camera=(self), microphone=(self), display-capture=(self), fullscreen=(self "https://www.youtube.com" "https://www.youtube-nocookie.com" "https://www.tiktok.com" "https://open.spotify.com"), geolocation=()',
    );
    expect(response.headers.get("Strict-Transport-Security")).toBe(
      "max-age=31536000; includeSubDomains",
    );
    expect(response.body).toBe(fallback.body);
    await expect(response.text()).resolves.toBe("<html>streamed</html>");
  });

  it("omits HSTS from HTTP document responses", async () => {
    const fallback = new Response("<html>http</html>", {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
    tanStackHandler.mockResolvedValueOnce(fallback);

    const response = await server.fetch(
      new Request("http://meet.test/"),
      env,
      ctx,
    );

    expect(response.headers.get("Content-Security-Policy")).toBeTruthy();
    expect(response.headers.get("Strict-Transport-Security")).toBeNull();
  });

  it("does not add document security headers to JSON or non-document responses", async () => {
    const jsonFallback = new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
    tanStackHandler.mockResolvedValueOnce(jsonFallback);

    const jsonResponse = await server.fetch(
      new Request("https://meet.test/api/example"),
      env,
      ctx,
    );

    expect(jsonResponse).toBe(jsonFallback);
    expect(jsonResponse.headers.get("Content-Security-Policy")).toBeNull();
    expect(jsonResponse.headers.get("X-Frame-Options")).toBeNull();
    expect(jsonResponse.headers.get("Strict-Transport-Security")).toBeNull();

    const assetFallback = new Response("console.log('asset')", {
      headers: { "Content-Type": "application/javascript" },
    });
    tanStackHandler.mockResolvedValueOnce(assetFallback);

    const assetResponse = await server.fetch(
      new Request("https://meet.test/assets/app.js"),
      env,
      ctx,
    );

    expect(assetResponse).toBe(assetFallback);
    expect(assetResponse.headers.get("Content-Security-Policy")).toBeNull();
    expect(assetResponse.headers.get("X-Content-Type-Options")).toBeNull();
    expect(assetResponse.headers.get("Permissions-Policy")).toBeNull();
  });

  it("leaves no-body fallback responses unchanged", async () => {
    const fallback = new Response(null, {
      status: 204,
      statusText: "No Content",
      headers: { "Content-Type": "text/html", "X-Preserved": "yes" },
    });
    tanStackHandler.mockResolvedValueOnce(fallback);

    const response = await server.fetch(
      new Request("https://meet.test/empty"),
      env,
      ctx,
    );

    expect(response).toBe(fallback);
    expect(response.status).toBe(204);
    expect(response.statusText).toBe("No Content");
    expect(response.body).toBeNull();
    expect(response.headers.get("X-Preserved")).toBe("yes");
    expect(response.headers.get("Content-Security-Policy")).toBeNull();
  });
});
