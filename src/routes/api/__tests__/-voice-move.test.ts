// POST /api/voice/move on the Effect edge: the real route with a D1 stand-in,
// a recording MeetingRoom namespace and test layers. No module mocks.

import { Effect, Layer } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMockD1, type MockD1 } from "@/lib/__tests__/mock-d1";
import { PERMISSIONS } from "@/lib/permissions";
import { openVoiceMoveGrant } from "@/lib/voice/voice-move-grant";
import { RateLimiter, type WorkerBindings } from "@/server/bindings";
import { memoryAuth, testServices } from "@/server/testing";
import { voiceMoveRoutes } from "@/server/routes/voice-move";

const SECRET = "test-realtime-ticket-secret";
const TOKEN = "Bearer mod-token";
const MOD = "mod-1";
const TARGET = "user-2";
const SERVER = "server-1";
const FROM = "voice-a";
const TO = "voice-b";

const MOD_PERMS =
  PERMISSIONS.VIEW_CHANNELS | PERMISSIONS.CONNECT | PERMISSIONS.MOVE_MEMBERS;
const MEMBER_PERMS = PERMISSIONS.VIEW_CHANNELS | PERMISSIONS.CONNECT;

type DoCall = { room: string; path: string; body: unknown };

let db: MockD1;
let doCalls: DoCall[];
let movedSessions: number;
let failGrantRecord: boolean;
let rateLimits: Layer.Layer<RateLimiter> | undefined;

/** MEETING_ROOM that records every call and answers like the real objects. */
function meetingRoomNamespace() {
  return {
    idFromName: (name: string) => name,
    get: (room: string) => ({
      fetch: async (url: string, init: RequestInit) => {
        const path = new URL(url).pathname;
        doCalls.push({ room, path, body: JSON.parse(String(init.body)) });
        if (path === "/voice-move-grant") {
          return failGrantRecord
            ? new Response("down", { status: 500 })
            : Response.json({ recorded: true });
        }
        return path === "/voice-move"
          ? Response.json({ moved: movedSessions })
          : Response.json({ cleared: 1 });
      },
    }),
  };
}

function routes() {
  const env = {
    REALTIME_TICKET_SECRET: SECRET,
    MEETING_ROOM: meetingRoomNamespace(),
  } as unknown as Partial<WorkerBindings>;
  return voiceMoveRoutes(
    testServices({ auth: memoryAuth({ [TOKEN]: MOD }), db, env, rateLimits }),
  );
}

function move(body: Record<string, unknown>, token = TOKEN) {
  return routes().POST({
    request: new Request("https://meet.test/api/voice/move", {
      method: "POST",
      headers: { authorization: token, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  });
}

const validBody = { user_id: TARGET, from_channel_id: FROM, to_channel_id: TO };

function roles(userId: string, permissions: number, position: number) {
  db.mockQuery(
    "JOIN member_roles",
    {
      results: [
        { id: `everyone`, permissions: 0, position: 0, is_default: 1 },
        { id: `role-${userId}`, permissions, position, is_default: 0 },
      ],
    },
    [userId],
  );
}

function seed({
  modPerms = MOD_PERMS,
  modTop = 2,
  targetPerms = MEMBER_PERMS,
  targetTop = 1,
  owner = "owner-9",
  channels = [
    { id: FROM, server_id: SERVER, channel_type: "voice", name: "General" },
    { id: TO, server_id: SERVER, channel_type: "voice", name: "Lounge" },
  ],
}: {
  modPerms?: number;
  modTop?: number;
  targetPerms?: number | null;
  targetTop?: number;
  owner?: string;
  channels?: Array<Record<string, unknown>>;
} = {}) {
  db.mockQuery("FROM channels WHERE id IN", { results: channels });
  db.mockQuery("SELECT owner_id FROM servers", { owner_id: owner });
  roles(MOD, modPerms, modTop);
  if (targetPerms !== null) roles(TARGET, targetPerms, targetTop);
  db.mockQuery("MAX(r.position)", {
    results: [
      { user_id: MOD, max_position: modTop },
      { user_id: TARGET, max_position: targetTop },
    ],
  });
  db.mockQuery("FROM users WHERE id", { username: "mod", display_name: "Mo" });
}

describe("POST /api/voice/move", () => {
  beforeEach(() => {
    db = createMockD1();
    doCalls = [];
    movedSessions = 1;
    failGrantRecord = false;
    rateLimits = undefined;
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("moves the member: records the grant, tells the source room, audits", async () => {
    seed();
    const response = await move(validBody);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      moved: true,
      sessions: 1,
    });
    // The grant is live with the gateway before the room tells the client.
    // No third call: ending the sessions changes the room's roster, which
    // the room pushes to the gateway itself (realtime/VOICE_ROSTER.md).
    expect(doCalls.map(({ room, path }) => [room, path])).toEqual([
      ["global-gateway", "/voice-move-grant"],
      [`voice-${SERVER}-${FROM}`, "/voice-move"],
    ]);
    const notice = doCalls[1].body as {
      user_id: string;
      notice: Record<string, unknown>;
    };
    expect(notice.user_id).toBe(TARGET);
    expect(notice.notice).toMatchObject({
      channel_id: TO,
      server_id: SERVER,
      channel_name: "Lounge",
      mover_name: "Mo",
    });
    const grant = await openVoiceMoveGrant(notice.notice.grant, SECRET, {
      subject: TARGET,
      channelId: TO,
      serverId: SERVER,
    });
    expect(grant).not.toBeNull();
    expect(doCalls[0].body).toEqual({
      user_id: TARGET,
      jti: grant?.jti,
      channel_id: TO,
      expires_at: grant?.expiresAt,
    });
    db.assertCalledWith("INSERT INTO server_audit_logs", [
      expect.any(String),
      SERVER,
      MOD,
      "MEMBER_MOVE",
      TARGET,
      JSON.stringify({ from_channel_id: FROM, to_channel_id: TO }),
      null,
    ]);
  });

  it("answers 401 when signed out", async () => {
    const response = await move(validBody, "Bearer nope");
    expect(response.status).toBe(401);
  });

  it("answers 403 without MOVE_MEMBERS and contacts no room", async () => {
    seed({ modPerms: MEMBER_PERMS });
    const response = await move(validBody);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "MISSING_PERMISSIONS",
    });
    expect(doCalls).toEqual([]);
  });

  it("checks MOVE_MEMBERS per channel, overrides included", async () => {
    seed();
    // A deny on the target channel only.
    db.mockQuery(
      "FROM channel_permission_overrides",
      {
        results: [
          {
            target_id: `role-${MOD}`,
            target_type: "role",
            allow: 0,
            deny: PERMISSIONS.MOVE_MEMBERS,
          },
        ],
      },
      [TO, MOD],
    );
    const response = await move(validBody);
    expect(response.status).toBe(403);
    expect(doCalls).toEqual([]);
  });

  it("refuses MOVE_MEMBERS on a source channel the mover cannot see", async () => {
    seed();
    // A private source: MOVE_MEMBERS allowed, VIEW_CHANNELS denied there.
    db.mockQuery(
      "FROM channel_permission_overrides",
      {
        results: [
          {
            target_id: `role-${MOD}`,
            target_type: "role",
            allow: PERMISSIONS.MOVE_MEMBERS,
            deny: PERMISSIONS.VIEW_CHANNELS,
          },
        ],
      },
      [FROM, MOD],
    );
    const response = await move(validBody);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "MISSING_PERMISSIONS",
    });
    expect(doCalls).toEqual([]);
  });

  it("answers a non-mover 403 whether or not the user is a member", async () => {
    // No probing membership by 404 vs 403.
    seed({ modPerms: MEMBER_PERMS, targetPerms: null });
    const response = await move(validBody);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "MISSING_PERMISSIONS",
    });
  });

  it("answers 403 ROLE_HIERARCHY for an equal or higher role", async () => {
    seed({ targetTop: 2 });
    const response = await move(validBody);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "ROLE_HIERARCHY",
    });
  });

  it("lets the owner and administrators move anyone", async () => {
    seed({ owner: MOD, modPerms: 0, modTop: 0, targetTop: 5 });
    expect((await move(validBody)).status).toBe(200);

    db = createMockD1();
    seed({ modPerms: PERMISSIONS.ADMINISTRATOR, modTop: 1, targetTop: 5 });
    expect((await move(validBody)).status).toBe(200);
  });

  it("answers 404 for a missing channel or member", async () => {
    seed({ channels: [] });
    const noChannel = await move(validBody);
    expect(noChannel.status).toBe(404);
    await expect(noChannel.json()).resolves.toMatchObject({
      code: "CHANNEL_NOT_FOUND",
    });

    db = createMockD1();
    seed({ targetPerms: null });
    const noMember = await move(validBody);
    expect(noMember.status).toBe(404);
    await expect(noMember.json()).resolves.toMatchObject({
      code: "MEMBER_NOT_FOUND",
    });
  });

  it("refuses text channels, DMs and channels in another server", async () => {
    seed({
      channels: [
        { id: FROM, server_id: SERVER, channel_type: "voice", name: "A" },
        { id: TO, server_id: SERVER, channel_type: "text", name: "chat" },
      ],
    });
    const text = await move(validBody);
    expect(text.status).toBe(400);
    await expect(text.json()).resolves.toMatchObject({
      code: "VOICE_CHANNEL_REQUIRED",
    });

    db = createMockD1();
    seed({
      channels: [
        { id: FROM, server_id: SERVER, channel_type: "voice", name: "A" },
        { id: TO, server_id: "server-2", channel_type: "voice", name: "B" },
      ],
    });
    const crossServer = await move(validBody);
    expect(crossServer.status).toBe(400);
    await expect(crossServer.json()).resolves.toMatchObject({
      code: "SERVER_MISMATCH",
    });
    expect(doCalls).toEqual([]);
  });

  it("refuses a target who cannot see the channel", async () => {
    seed({ targetPerms: PERMISSIONS.CONNECT });
    const response = await move(validBody);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "TARGET_CANNOT_VIEW",
    });
  });

  it("allows a target who can see but not join the channel", async () => {
    seed({ targetPerms: PERMISSIONS.VIEW_CHANNELS });
    expect((await move(validBody)).status).toBe(200);
  });

  it("answers 409 NOT_IN_VOICE when the member left before the drop", async () => {
    seed();
    movedSessions = 0;
    const response = await move(validBody);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "NOT_IN_VOICE",
    });
    // Nothing to clear and nothing to audit.
    expect(doCalls.map((call) => call.path)).toEqual([
      "/voice-move-grant",
      "/voice-move",
    ]);
    db.assertNotCalled("INSERT INTO server_audit_logs");
  });

  it("answers 502 and tells no room when the grant cannot be recorded", async () => {
    seed();
    failGrantRecord = true;
    const response = await move(validBody);
    expect(response.status).toBe(502);
    expect(doCalls.map((call) => call.path)).toEqual(["/voice-move-grant"]);
  });

  it("treats the same channel as a no-op", async () => {
    const response = await move({ ...validBody, to_channel_id: FROM });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      moved: false,
      reason: "same_channel",
    });
    expect(doCalls).toEqual([]);
  });

  it("refuses moving yourself", async () => {
    const response = await move({ ...validBody, user_id: MOD });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "CANNOT_MOVE_SELF",
    });
  });

  it("answers 400 for a malformed body", async () => {
    const response = await move({ user_id: TARGET });
    expect(response.status).toBe(400);
  });

  it("is rate limited per mover", async () => {
    const shards: string[] = [];
    rateLimits = Layer.succeed(
      RateLimiter,
      RateLimiter.of({
        check: (shardId) =>
          Effect.sync(() => {
            shards.push(shardId);
            return Response.json({ error: "Too many" }, { status: 429 });
          }),
      }),
    );
    seed();
    const response = await move(validBody);
    expect(response.status).toBe(429);
    expect(shards).toEqual([`voice-move:${MOD}`]);
    expect(doCalls).toEqual([]);
  });
});
