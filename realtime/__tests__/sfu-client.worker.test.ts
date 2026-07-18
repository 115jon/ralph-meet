import { describe, expect, it, vi } from "vitest";
import { SfuClient } from "../voice-room/sfu-client";

const log = { warn: vi.fn(), error: vi.fn() };

describe("SfuClient", () => {
  it("issues a GET without a body or content-type header", async () => {
    const fetch = vi.fn(async () => Response.json({ sessionId: "session-1" }));
    const client = new SfuClient({
      appId: "app-1",
      secret: "secret-1",
      fetch,
      log,
    });

    await expect(client.fetch("GET", "sessions/session-1")).resolves.toEqual({
      sessionId: "session-1",
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://rtc.live.cloudflare.com/v1/apps/app-1/sessions/session-1",
      {
        method: "GET",
        signal: expect.any(AbortSignal),
        headers: { Authorization: "Bearer secret-1" },
      },
    );
  });

  it("sends JSON bodies for POST and PUT requests", async () => {
    const fetch = vi.fn(async () => Response.json({ ok: true }));
    const client = new SfuClient({
      appId: "app-1",
      secret: "secret-1",
      fetch,
      log,
    });

    await client.request("POST", "sessions/new", { tracks: [] });
    expect(fetch).toHaveBeenCalledWith(
      "https://rtc.live.cloudflare.com/v1/apps/app-1/sessions/new",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer secret-1",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ tracks: [] }),
      }),
    );
  });

  it("retries one 5xx response and returns the second JSON response", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(Response.json({ sessionId: "session-2" }));
    const client = new SfuClient({
      appId: "app-1",
      secret: "secret-1",
      fetch,
      log,
    });

    await expect(client.fetch("GET", "sessions/new")).resolves.toEqual({
      sessionId: "session-2",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not retry a non-5xx response", async () => {
    const fetch = vi.fn(
      async () => new Response("bad request", { status: 400 }),
    );
    const client = new SfuClient({
      appId: "app-1",
      secret: "secret-1",
      fetch,
      log,
    });

    await expect(client.fetch("GET", "sessions/new")).rejects.toThrow(
      "SFU GET sessions/new failed (400)",
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
