// /api/voice/admission on the Effect edge: the real route with a D1 stand-in
// and test layers for Kova and the rate limiter. No module mocks.

import { Effect, Layer } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMockD1, type MockD1 } from "@/lib/__tests__/mock-d1";
import { PERMISSIONS } from "@/lib/permissions";
import { verifySocketTicket } from "@/lib/voice/socket-ticket";
import { issueVoiceMoveGrant } from "@/lib/voice/voice-move-grant";
import type { WorkerBindings } from "@/server/bindings";
import { Unauthenticated } from "@/server/errors";
import { KovaAuth } from "@/server/kova-auth";
import { voiceAdmissionRoutes } from "@/server/routes/voice-admission";
import { testServices } from "@/server/testing";
import { verifyVoiceToken } from "../../../../realtime/voice-token";

const ticketSecret = "test-realtime-ticket-secret";
const callsSecret = "test-calls-secret";
const TOKEN = "Bearer good-token";
const ROOM = "voice-server-1-channel-1";

let env: Partial<WorkerBindings>;
let db: MockD1;
let kovaLookups = 0;

/** Kova that knows TOKEN as user-123, counting every session lookup. */
const countingAuth = Layer.succeed(
  KovaAuth,
  KovaAuth.of({
    // Counted when run, not when built: authenticate() builds its fallback
    // lookup up front and runs it only if the first finds no session.
    lookup: (headers) =>
      Effect.suspend(() => {
        kovaLookups += 1;
        return headers.authorization === TOKEN
          ? Effect.succeed({
              user: { id: "user-123" },
              session: { id: "session-user-123" },
            })
          : Effect.fail(new Unauthenticated());
      }),
  }),
);

function admit(body: unknown, headers: Record<string, string> = {}) {
  return voiceAdmissionRoutes(
    testServices({ auth: countingAuth, db, env }),
  ).POST({
    request: new Request("https://meet.test/api/voice/admission", {
      method: "POST",
      headers: { authorization: TOKEN, ...headers },
      body: JSON.stringify(body),
    }),
  });
}

const join = {
  channelId: "channel-1",
  serverId: "server-1",
  roomSlug: ROOM,
};

/** channel-1: a voice channel in server-1 that user-123 may see and join. */
function voiceChannel(
  permissions = PERMISSIONS.VIEW_CHANNELS | PERMISSIONS.CONNECT,
) {
  db.mockQuery("SELECT id, server_id, channel_type FROM channels", {
    id: "channel-1",
    server_id: "server-1",
    channel_type: "voice",
  });
  db.mockQuery("SELECT 1 FROM server_members", { 1: 1 });
  db.mockQuery("JOIN member_roles", {
    results: [{ id: "role-everyone", permissions, position: 0, is_default: 1 }],
  });
}

type AdmissionBody = {
  access_mode: string;
  room_slug: string;
  expires_at: number;
  participant_id?: string;
  room_ticket?: string;
  voice_ticket?: string;
  media?: {
    participant_id: string;
    voice_token: string;
    ice_servers: Array<{ urls: string[] }>;
  };
};

async function verify(
  ticket: string | undefined,
  audience: "room" | "voice",
  now: number,
) {
  if (!ticket) throw new Error(`Expected a ${audience} ticket`);
  return verifySocketTicket(ticket, ticketSecret, {
    accessMode: "authenticated",
    audience,
    now,
    roomSlug: ROOM,
  });
}

describe("voice admission route", () => {
  beforeEach(() => {
    env = {
      CALLS_APP_SECRET: callsSecret,
      REALTIME_TICKET_SECRET: ticketSecret,
    };
    db = createMockD1();
    kovaLookups = 0;
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("proves the user once and returns both tickets, the voice token and TURN", async () => {
    voiceChannel();
    const before = Date.now();
    const response = await admit(join);
    const body = (await response.json()) as AdmissionBody;

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Server-Timing")).toMatch(/admission;dur=/);
    // One Kova session check and one channel-access read for the whole join.
    expect(kovaLookups).toBe(1);
    expect(db.getCalls("FROM channels")).toHaveLength(1);
    expect(db.getCalls("JOIN member_roles")).toHaveLength(1);

    // Short-lived: both tickets expire 60 s after issue.
    expect(body.expires_at).toBeGreaterThanOrEqual(before + 60_000);
    expect(body.expires_at).toBeLessThanOrEqual(Date.now() + 60_000);

    const room = await verify(body.room_ticket, "room", body.expires_at - 1);
    const voice = await verify(body.voice_ticket, "voice", body.expires_at - 1);
    if (!room.ok || !voice.ok) throw new Error("Expected verified tickets");

    // Bound to the user, the room and the participant (the room nonce).
    expect(room.claims).toMatchObject({
      subject: "user-123",
      roomSlug: ROOM,
      serverId: "server-1",
      channelId: "channel-1",
      media: "issued",
    });
    expect(body.participant_id).toBe(room.claims.nonce);
    expect(voice.claims).toMatchObject({
      subject: "user-123",
      roomSlug: ROOM,
      participant: room.claims.nonce,
    });
    // Two single-use nonces: spending one never spends the other.
    expect(voice.claims.nonce).not.toBe(room.claims.nonce);

    expect(body.media?.participant_id).toBe(room.claims.nonce);
    expect(body.media?.ice_servers).toEqual([
      { urls: ["stun:stun.cloudflare.com:3478"] },
    ]);
    await expect(
      verifyVoiceToken({
        token: body.media?.voice_token ?? "",
        participantId: room.claims.nonce,
        roomSlug: ROOM,
        secret: callsSecret,
        expectedSubject: "user-123",
      }),
    ).resolves.toMatchObject({ ok: true });
  });

  it("issues tickets that stop verifying after 60 s", async () => {
    voiceChannel();
    const body = (await (await admit(join)).json()) as AdmissionBody;
    await expect(
      verify(body.room_ticket, "room", body.expires_at),
    ).resolves.toEqual({ ok: false, reason: "expired" });
    await expect(
      verify(body.voice_ticket, "voice", body.expires_at),
    ).resolves.toEqual({ ok: false, reason: "expired" });
    // Each is for its own socket only.
    await expect(
      verify(body.room_ticket, "voice", body.expires_at - 1),
    ).resolves.toEqual({ ok: false, reason: "audience_mismatch" });
  });

  it("gives a reconnect only the ticket it asks for, minting nothing", async () => {
    voiceChannel();
    const room = (await (
      await admit({ ...join, sockets: ["room"], media: false })
    ).json()) as AdmissionBody;
    expect(room.voice_ticket).toBeUndefined();
    expect(room.media).toBeUndefined();
    expect(room.participant_id).toBeUndefined();
    const roomTicket = await verify(
      room.room_ticket,
      "room",
      room.expires_at - 1,
    );
    expect(roomTicket).toMatchObject({ ok: true, claims: { media: "held" } });

    const participantId = "11111111-2222-3333-4444-555555555555";
    const voice = (await (
      await admit({ ...join, sockets: ["voice"], participantId })
    ).json()) as AdmissionBody;
    expect(voice.room_ticket).toBeUndefined();
    expect(voice.media).toBeUndefined();
    expect(voice.participant_id).toBe(participantId);
    await expect(
      verify(voice.voice_ticket, "voice", voice.expires_at - 1),
    ).resolves.toMatchObject({
      ok: true,
      claims: { participant: participantId },
    });
    expect(kovaLookups).toBe(2);
  });

  it.each([
    [{ sockets: [] }],
    [{ sockets: ["room", "room"] }],
    [{ sockets: ["global"] }],
    [{ sockets: "room" }],
    [{ media: "yes" }],
    [{ sockets: ["voice"], media: true }],
    [{ participantId: "11111111-2222-3333-4444-555555555555" }],
    [{ sockets: ["voice"], participantId: "short" }],
    [{ sockets: ["voice"], participantId: "has spaces in it" }],
  ])("refuses an invalid admission request %j", async (extra) => {
    voiceChannel();
    const response = await admit({ ...join, ...extra });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "INVALID_ADMISSION",
    });
    expect(kovaLookups).toBe(0);
  });

  it("refuses without CONNECT", async () => {
    voiceChannel(PERMISSIONS.VIEW_CHANNELS);
    const response = await admit(join);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "CONNECT_DENIED",
    });
  });

  it("refuses a channel the user cannot see", async () => {
    const response = await admit(join);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: "Channel not found or access denied",
    });
  });

  it("refuses a spoofed server and a text channel", async () => {
    voiceChannel();
    const spoofed = await admit({ ...join, serverId: "other-server" });
    expect(spoofed.status).toBe(403);
    await expect(spoofed.json()).resolves.toMatchObject({
      code: "SERVER_MISMATCH",
    });

    db.mockQuery("SELECT id, server_id, channel_type FROM channels", {
      id: "channel-1",
      server_id: "server-1",
      channel_type: "text",
    });
    const text = await admit(join);
    expect(text.status).toBe(400);
    await expect(text.json()).resolves.toMatchObject({
      code: "SERVER_VOICE_REQUIRED",
    });
  });

  it("answers 401 when Kova finds no session", async () => {
    const response = await admit(join, { authorization: "Bearer expired" });
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("fails closed without the ticket or media secret", async () => {
    voiceChannel();
    env = { REALTIME_TICKET_SECRET: ticketSecret };
    const noMedia = await admit(join);
    expect(noMedia.status).toBe(503);
    await expect(noMedia.json()).resolves.toMatchObject({
      code: "CALLS_APP_SECRET_MISSING",
    });
    // A reconnect that mints nothing does not need the media secret.
    const reconnect = await admit({ ...join, sockets: ["room"], media: false });
    expect(reconnect.status).toBe(200);

    env = {};
    const noTickets = await admit(join);
    expect(noTickets.status).toBe(503);
    await expect(noTickets.json()).resolves.toMatchObject({
      code: "REALTIME_TICKET_SECRET_MISSING",
    });
  });

  it("lets a move grant stand in for CONNECT, spent once per use", async () => {
    voiceChannel(PERMISSIONS.VIEW_CHANNELS);
    const live = new Map<string, string>([["user-123", "move-c"]]);
    const spent = new Set<string>();
    const gatewayCalls: Array<{ use: string }> = [];
    env = {
      ...env,
      MEETING_ROOM: {
        idFromName: (name: string) => name,
        get: () => ({
          fetch: async (_url: string, init: RequestInit) => {
            const use = JSON.parse(String(init.body)) as {
              user_id: string;
              jti: string;
              use: string;
            };
            gatewayCalls.push(use);
            const key = `${use.jti}:${use.use}`;
            const ok = live.get(use.user_id) === use.jti && !spent.has(key);
            if (ok) spent.add(key);
            return Response.json({ ok });
          },
        }),
      },
    } as unknown as Partial<WorkerBindings>;
    const moveGrant = await issueVoiceMoveGrant(
      {
        jti: "move-c",
        subject: "user-123",
        serverId: "server-1",
        channelId: "channel-1",
        expiresAt: Date.now() + 60_000,
      },
      ticketSecret,
    );

    // The join: one request, both tickets, one spend.
    const first = await admit({ ...join, moveGrant });
    expect(first.status).toBe(200);
    const body = (await first.json()) as AdmissionBody;
    expect(body.room_ticket).toBeDefined();
    expect(body.voice_ticket).toBeDefined();
    expect(gatewayCalls).toEqual([
      expect.objectContaining({ jti: "move-c", use: "room" }),
    ]);

    // A voice reconnect spends the voice use once; then the grant is spent.
    const voice = await admit({ ...join, sockets: ["voice"], moveGrant });
    expect(voice.status).toBe(200);
    for (const again of [
      { ...join, moveGrant },
      { ...join, sockets: ["voice"], moveGrant },
    ]) {
      const refused = await admit(again);
      expect(refused.status).toBe(403);
      await expect(refused.json()).resolves.toMatchObject({
        code: "CONNECT_DENIED",
      });
    }
  });

  it("admits a public demo room for this browser's demo session", async () => {
    const response = await voiceAdmissionRoutes(
      testServices({ auth: countingAuth, db, env }),
    ).POST({
      request: new Request("https://meet.test/api/voice/admission", {
        method: "POST",
        headers: { origin: "https://meet.test" },
        body: JSON.stringify({ roomSlug: "demo-room" }),
      }),
    });
    const body = (await response.json()) as AdmissionBody;
    expect(response.status).toBe(200);
    expect(response.headers.get("Set-Cookie")).toBeTruthy();
    expect(body.access_mode).toBe("public-demo");
    expect(kovaLookups).toBe(0);
    const room = await verifySocketTicket(
      body.room_ticket ?? "",
      ticketSecret,
      {
        accessMode: "public-demo",
        audience: "room",
        now: body.expires_at - 1,
        roomSlug: "demo-room",
      },
    );
    expect(room).toMatchObject({ ok: true, claims: { media: "issued" } });
    expect(body.media?.participant_id).toBe(room.ok ? room.claims.nonce : "");
  });
});
