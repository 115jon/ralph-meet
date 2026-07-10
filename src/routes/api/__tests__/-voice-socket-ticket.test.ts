import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/api-helpers", () => ({
  apiError: (error: string, status = 400, code?: string) => Response.json({ error, code }, { status }),
  buildVoiceChannelRoomSlug: (serverId: string, channelId: string) => `voice-${serverId}-${channelId}`,
  getDB: vi.fn(),
  getEnv: () => mocks.env,
  requireAuth: mocks.requireAuth,
}));

vi.mock("@/lib/require-channel-access", () => ({ requireChannelAccess: vi.fn() }));
vi.mock("@/lib/require-permission", () => ({ getUserChannelPermissions: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimitDOFailClosed: vi.fn().mockResolvedValue(null) }));

import { verifySocketTicket } from "@/lib/voice/socket-ticket";
import { socketTicketPost } from "../voice/socket-ticket";

const ticketSecret = "test-realtime-ticket-secret";

describe("socket ticket route", () => {
  beforeEach(() => {
    mocks.env = {
      REALTIME_TICKET_SECRET: ticketSecret,
    };
    mocks.requireAuth.mockReset();
    mocks.requireAuth.mockResolvedValue({ userId: "user-123" });
  });

  it("issues a no-store, audience-bound ticket for an authenticated global gateway", async () => {
    const response = await socketTicketPost({
      request: new Request("https://meet.test/api/voice/socket-ticket", {
        method: "POST",
        body: JSON.stringify({ audience: "global" }),
      }),
    });
    const body = await response.json() as { expires_at: number; ticket: string };

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(verifySocketTicket(body.ticket, ticketSecret, {
      accessMode: "authenticated",
      audience: "global",
      now: body.expires_at - 1,
      roomSlug: "global-gateway",
    })).resolves.toMatchObject({
      ok: true,
      claims: { subject: "user-123" },
    });
  });

  it("fails closed when deployment ticket configuration is incomplete", async () => {
    mocks.env = {};
    const response = await socketTicketPost({
      request: new Request("https://meet.test/api/voice/socket-ticket", {
        method: "POST",
        body: JSON.stringify({ audience: "global" }),
      }),
    });

    await expect(response.json()).resolves.toMatchObject({ code: "REALTIME_TICKET_SECRET_MISSING" });
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("uses a stable anonymous subject for configured public-demo rooms", async () => {
    mocks.env = {
      REALTIME_TICKET_SECRET: ticketSecret,
    };
    const createRequest = (cookie?: string) => new Request("https://meet.test/api/voice/socket-ticket", {
      method: "POST",
      headers: {
        origin: "https://meet.test",
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify({ audience: "room", roomSlug: "demo-room" }),
    });

    const firstResponse = await socketTicketPost({ request: createRequest() });
    const firstBody = await firstResponse.json() as { expires_at: number; ticket: string };
    const cookie = firstResponse.headers.get("Set-Cookie")?.split(";", 1)[0];
    if (!cookie) throw new Error("Expected demo session cookie");

    const secondResponse = await socketTicketPost({ request: createRequest(cookie) });
    const secondBody = await secondResponse.json() as { expires_at: number; ticket: string };
    const [first, second] = await Promise.all([
      verifySocketTicket(firstBody.ticket, ticketSecret, {
        accessMode: "public-demo",
        audience: "room",
        now: firstBody.expires_at - 1,
        roomSlug: "demo-room",
      }),
      verifySocketTicket(secondBody.ticket, ticketSecret, {
        accessMode: "public-demo",
        audience: "room",
        now: secondBody.expires_at - 1,
        roomSlug: "demo-room",
      }),
    ]);

    expect(first).toMatchObject({ ok: true });
    expect(second).toMatchObject({ ok: true });
    if (!first.ok || !second.ok) throw new Error("Expected demo tickets to verify");
    expect(first.claims.subject).toBe(second.claims.subject);
  });

  it("rejects cross-origin and reserved-slug public-demo requests", async () => {
    const crossOrigin = await socketTicketPost({
      request: new Request("https://meet.test/api/voice/socket-ticket", {
        method: "POST",
        headers: { origin: "https://attacker.test" },
        body: JSON.stringify({ audience: "room", roomSlug: "public-room" }),
      }),
    });
    const reservedSlug = await socketTicketPost({
      request: new Request("https://meet.test/api/voice/socket-ticket", {
        method: "POST",
        headers: { origin: "https://meet.test" },
        body: JSON.stringify({ audience: "room", roomSlug: "voice-server-channel" }),
      }),
    });

    await expect(crossOrigin.json()).resolves.toMatchObject({ code: "DEMO_ORIGIN_NOT_ALLOWED" });
    await expect(reservedSlug.json()).resolves.toMatchObject({ code: "DEMO_ROOM_NOT_ALLOWED" });
  });
});
