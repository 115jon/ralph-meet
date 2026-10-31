// /api/voice/socket-ticket on the Effect edge: the real route with a D1
// stand-in and test layers for Kova and the rate limiter. No module mocks.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMockD1, type MockD1 } from "@/lib/__tests__/mock-d1";
import { PERMISSIONS } from "@/lib/permissions";
import type { WorkerBindings } from "@/server/bindings";
import { brokenAuth, memoryAuth, testServices } from "@/server/testing";
import { verifySocketTicket } from "@/lib/voice/socket-ticket";
import { verifyVoiceToken } from "../../../../realtime/voice-token";
import { socketTicketRoutes } from "@/server/routes/socket-ticket";

const ticketSecret = "test-realtime-ticket-secret";
const callsSecret = "test-calls-secret";

const TOKEN = "Bearer good-token";

let env: Partial<WorkerBindings>;
let db: MockD1;
let auth = memoryAuth({ [TOKEN]: "user-123" });

function routes() {
  return socketTicketRoutes(testServices({ auth, db, env }));
}

function socketTicketPost(args: { request: Request }) {
  return routes().POST(args);
}

function socketTicketOptions(args: { request: Request }) {
  return routes().OPTIONS(args);
}

/** channel-1: a voice channel in server-1 that user-123 may see and join. */
function voiceChannelInServer1() {
  db.mockQuery("SELECT id, server_id, channel_type FROM channels", {
    id: "channel-1",
    server_id: "server-1",
    channel_type: "voice",
  });
  db.mockQuery("SELECT 1 FROM server_members", { 1: 1 });
  db.mockQuery("JOIN member_roles", {
    results: [
      {
        id: "role-everyone",
        permissions: PERMISSIONS.VIEW_CHANNELS | PERMISSIONS.CONNECT,
        position: 0,
        is_default: 1,
      },
    ],
  });
  db.mockQuery("SELECT channel_type FROM channels WHERE id = ? AND server_id", {
    channel_type: "voice",
  });
}

describe("socket ticket route", () => {
  beforeEach(() => {
    env = {
      CALLS_APP_SECRET: callsSecret,
      REALTIME_TICKET_SECRET: ticketSecret,
    };
    db = createMockD1();
    auth = memoryAuth({ [TOKEN]: "user-123" });
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("allows credentialed Tauri preflight requests", async () => {
    const response = await socketTicketOptions({
      request: new Request("http://localhost:5173/api/voice/socket-ticket", {
        method: "OPTIONS",
        headers: {
          origin: "http://tauri.localhost",
          "access-control-request-headers":
            "authorization,content-type,x-publishable-key",
          "access-control-request-method": "POST",
        },
      }),
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "http://tauri.localhost",
    );
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBe(
      "true",
    );
  });

  it("issues a no-store, audience-bound ticket for an authenticated global gateway", async () => {
    const response = await socketTicketPost({
      request: new Request("https://meet.test/api/voice/socket-ticket", {
        method: "POST",
        headers: { authorization: TOKEN },
        body: JSON.stringify({ audience: "global" }),
      }),
    });
    const body = (await response.json()) as {
      expires_at: number;
      media_bootstrap?: unknown;
      ticket: string;
    };

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(body.media_bootstrap).toBeUndefined();
    await expect(
      verifySocketTicket(body.ticket, ticketSecret, {
        accessMode: "authenticated",
        audience: "global",
        now: body.expires_at - 1,
        roomSlug: "global-gateway",
      }),
    ).resolves.toMatchObject({
      ok: true,
      claims: { subject: "user-123" },
    });
  });

  it("returns a room-only media bootstrap bound to the signed ticket nonce", async () => {
    voiceChannelInServer1();

    const response = await socketTicketPost({
      request: new Request("https://meet.test/api/voice/socket-ticket", {
        method: "POST",
        headers: { authorization: TOKEN },
        body: JSON.stringify({
          audience: "room",
          channelId: "channel-1",
          roomSlug: "voice-server-1-channel-1",
          serverId: "server-1",
        }),
      }),
    });
    const body = (await response.json()) as {
      expires_at: number;
      media_bootstrap?: {
        participant_id: string;
        voice_token: string;
        ice_servers: Array<{ urls: string[] }>;
      };
      ticket: string;
    };

    expect(response.status).toBe(200);
    expect(body.media_bootstrap).toBeDefined();
    const verification = await verifySocketTicket(body.ticket, ticketSecret, {
      accessMode: "authenticated",
      audience: "room",
      now: body.expires_at - 1,
      roomSlug: "voice-server-1-channel-1",
    });
    expect(verification).toMatchObject({ ok: true });
    if (!verification.ok || !body.media_bootstrap) {
      throw new Error("Expected a verified room bootstrap");
    }
    expect(body.media_bootstrap.participant_id).toBe(verification.claims.nonce);
    expect(body.media_bootstrap.ice_servers).toEqual([
      { urls: ["stun:stun.cloudflare.com:3478"] },
    ]);
    await expect(
      verifyVoiceToken({
        token: body.media_bootstrap.voice_token,
        participantId: body.media_bootstrap.participant_id,
        roomSlug: verification.claims.roomSlug,
        secret: callsSecret,
      }),
    ).resolves.toMatchObject({ ok: true, subject: "user-123" });

    // The bootstrap token proves identity only: it is bound to this ticket's
    // participant, room and subject, and joining is enforced separately.
    const token = body.media_bootstrap.voice_token;
    const participantId = body.media_bootstrap.participant_id;
    await expect(
      verifyVoiceToken({
        token,
        participantId: "other-participant",
        roomSlug: verification.claims.roomSlug,
        secret: callsSecret,
      }),
    ).resolves.toEqual({ ok: false, reason: "identity" });
    await expect(
      verifyVoiceToken({
        token,
        participantId,
        roomSlug: "voice-server-1-other-channel",
        secret: callsSecret,
      }),
    ).resolves.toEqual({ ok: false, reason: "identity" });
    await expect(
      verifyVoiceToken({
        token,
        participantId,
        roomSlug: verification.claims.roomSlug,
        secret: callsSecret,
        expectedSubject: "user-456",
      }),
    ).resolves.toEqual({ ok: false, reason: "subject" });
    await expect(
      verifyVoiceToken({
        token,
        participantId,
        roomSlug: verification.claims.roomSlug,
        secret: callsSecret,
        now: Date.now() + 60 * 60 * 1000 + 1_000,
      }),
    ).resolves.toEqual({ ok: false, reason: "expired" });
  });

  it("fails closed when a room bootstrap cannot be signed", async () => {
    env = { REALTIME_TICKET_SECRET: ticketSecret };
    voiceChannelInServer1();

    const response = await socketTicketPost({
      request: new Request("https://meet.test/api/voice/socket-ticket", {
        method: "POST",
        headers: { authorization: TOKEN },
        body: JSON.stringify({
          audience: "room",
          channelId: "channel-1",
          roomSlug: "voice-server-1-channel-1",
          serverId: "server-1",
        }),
      }),
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "CALLS_APP_SECRET_MISSING",
    });
  });

  it("fails closed when deployment ticket configuration is incomplete", async () => {
    env = {};
    const response = await socketTicketPost({
      request: new Request("https://meet.test/api/voice/socket-ticket", {
        method: "POST",
        headers: { authorization: TOKEN },
        body: JSON.stringify({ audience: "global" }),
      }),
    });

    await expect(response.json()).resolves.toMatchObject({
      code: "REALTIME_TICKET_SECRET_MISSING",
    });
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("includes the canonical serverId in production voice ticket claims", async () => {
    voiceChannelInServer1();

    const response = await socketTicketPost({
      request: new Request("https://meet.test/api/voice/socket-ticket", {
        method: "POST",
        headers: { authorization: TOKEN },
        body: JSON.stringify({
          audience: "voice",
          channelId: "channel-1",
          serverId: "server-1",
        }),
      }),
    });
    const body = (await response.json()) as {
      expires_at: number;
      media_bootstrap?: unknown;
      ticket: string;
    };

    expect(response.status).toBe(200);
    expect(body.media_bootstrap).toBeUndefined();
    await expect(
      verifySocketTicket(body.ticket, ticketSecret, {
        accessMode: "authenticated",
        audience: "voice",
        now: body.expires_at - 1,
        roomSlug: "voice-server-1-channel-1",
      }),
    ).resolves.toMatchObject({
      ok: true,
      claims: { serverId: "server-1", subject: "user-123" },
    });
  });

  it("rejects a production voice ticket when body serverId mismatches the channel", async () => {
    voiceChannelInServer1();

    const response = await socketTicketPost({
      request: new Request("https://meet.test/api/voice/socket-ticket", {
        method: "POST",
        headers: { authorization: TOKEN },
        body: JSON.stringify({
          audience: "voice",
          channelId: "channel-1",
          serverId: "spoofed-server",
        }),
      }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "SERVER_MISMATCH",
    });
  });

  it("uses a stable anonymous subject for configured public-demo rooms", async () => {
    env = {
      CALLS_APP_SECRET: callsSecret,
      REALTIME_TICKET_SECRET: ticketSecret,
    };
    const createRequest = (cookie?: string) =>
      new Request("https://meet.test/api/voice/socket-ticket", {
        method: "POST",
        headers: {
          origin: "https://meet.test",
          ...(cookie ? { cookie } : {}),
        },
        body: JSON.stringify({ audience: "room", roomSlug: "demo-room" }),
      });

    const firstResponse = await socketTicketPost({ request: createRequest() });
    const firstBody = (await firstResponse.json()) as {
      expires_at: number;
      ticket: string;
    };
    const cookie = firstResponse.headers.get("Set-Cookie")?.split(";", 1)[0];
    if (!cookie) throw new Error("Expected demo session cookie");

    const secondResponse = await socketTicketPost({
      request: createRequest(cookie),
    });
    const secondBody = (await secondResponse.json()) as {
      expires_at: number;
      ticket: string;
    };
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
    if (!first.ok || !second.ok)
      throw new Error("Expected demo tickets to verify");
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
        body: JSON.stringify({
          audience: "room",
          roomSlug: "voice-server-channel",
        }),
      }),
    });

    await expect(crossOrigin.json()).resolves.toMatchObject({
      code: "DEMO_ORIGIN_NOT_ALLOWED",
    });
    await expect(reservedSlug.json()).resolves.toMatchObject({
      code: "DEMO_ROOM_NOT_ALLOWED",
    });
  });
  it("answers 401 with no-store when Kova finds no session", async () => {
    const response = await socketTicketPost({
      request: new Request("https://meet.test/api/voice/socket-ticket", {
        method: "POST",
        headers: { authorization: "Bearer expired-token" },
        body: JSON.stringify({ audience: "global" }),
      }),
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("answers 503 AUTH_UNAVAILABLE, not 401, when Kova cannot answer", async () => {
    auth = brokenAuth("HTTP 502");
    const response = await socketTicketPost({
      request: new Request("https://meet.test/api/voice/socket-ticket", {
        method: "POST",
        headers: { authorization: TOKEN, origin: "http://tauri.localhost" },
        body: JSON.stringify({ audience: "global" }),
      }),
    });

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Retry-After")).toBe("5");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "http://tauri.localhost",
    );
    await expect(response.json()).resolves.toMatchObject({
      code: "AUTH_UNAVAILABLE",
    });
  });

  it("refuses a voice ticket without CONNECT", async () => {
    voiceChannelInServer1();
    db.mockQuery("JOIN member_roles", {
      results: [
        {
          id: "role-everyone",
          permissions: PERMISSIONS.VIEW_CHANNELS,
          position: 0,
          is_default: 1,
        },
      ],
    });

    const response = await socketTicketPost({
      request: new Request("https://meet.test/api/voice/socket-ticket", {
        method: "POST",
        headers: { authorization: TOKEN },
        body: JSON.stringify({ audience: "voice", channelId: "channel-1" }),
      }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "CONNECT_DENIED",
    });
  });
});
