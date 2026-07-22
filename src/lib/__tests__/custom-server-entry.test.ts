import { describe, expect, it, vi } from "vitest";

const consumeBackgroundTaskBatch = vi.hoisted(() =>
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

vi.mock("@tanstack/react-start/server", () => ({
  createStartHandler: vi.fn(() => vi.fn(async () => new Response("fallback"))),
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

vi.mock("../../../src/lib/background-tasks", () => ({
  consumeBackgroundTaskBatch,
}));

vi.mock("../../../src/lib/collectibles-catalog", () => ({
  syncCollectiblesCatalog,
}));

import server from "../../../custom-server-entry";
import { SOUNDBOARD_MEDIA_RATE_LIMIT } from "../../../realtime/rate-limiter";

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
    const env = { CACHE: {} } as Parameters<typeof server.queue>[1];

    await server.queue(batch, env, {} as ExecutionContext);

    expect(consumeBackgroundTaskBatch).toHaveBeenCalledWith(batch, {
      CACHE: env.CACHE,
    });
  });

  it("syncs the collectibles catalog from the scheduled handler", async () => {
    syncCollectiblesCatalog.mockClear();
    const waitUntil = vi.fn();
    const env = { DB: {} } as Parameters<typeof server.scheduled>[1];

    await server.scheduled(
      { cron: "0 */6 * * *" } as ScheduledController,
      env,
      { waitUntil } as unknown as ExecutionContext,
    );

    expect(syncCollectiblesCatalog).toHaveBeenCalledWith(env.DB);
    expect(waitUntil).toHaveBeenCalledTimes(1);
    await waitUntil.mock.calls[0][0];
  });
});
