// Moderator voice moves in the MeetingRoom: the source room hands the user's
// voice session the move and ends it (VOICE_MOVE_PATH); its roster push takes
// them off the sidebar (voice-roster.worker.test.ts), and the global gateway
// keeps each user's latest move grant for the target's tickets.

import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

import { PERMISSIONS } from "../../src/lib/permissions";
import {
  issueSocketTicket,
  verifySocketTicket,
} from "../../src/lib/voice/socket-ticket";
import { issueVoiceMoveGrant } from "../../src/lib/voice/voice-move-grant";
import {
  appendRealtimeAdmissionHeaders,
  createRealtimeAdmissionContext,
} from "../realtime-admission";
import {
  serializeVoiceMoveRequest,
  VOICE_MOVE_GRANT_PATH,
  VOICE_MOVE_GRANT_USE_PATH,
  VOICE_MOVE_PATH,
  type VoiceMoveNotice,
} from "../voice-move";

type Frame = { op: number; d: unknown };

const NOTICE: VoiceMoveNotice = {
  channel_id: "target-channel",
  server_id: "move-server",
  channel_name: "Lounge",
  mover_name: "Mod",
  grant: "vm1.grant.signature",
  grant_expires_at: Date.now() + 60_000,
};

function meetingRoom(roomName: string) {
  return env.MEETING_ROOM.get(env.MEETING_ROOM.idFromName(roomName));
}

async function admissionHeaders(
  roomSlug: string,
  audience: "global" | "room" | "voice",
  subject: string,
) {
  const ticket = await issueSocketTicket(
    {
      accessMode: "authenticated",
      audience,
      expiresAt: Date.now() + 60_000,
      nonce: crypto.randomUUID(),
      roomSlug,
      subject,
    },
    env.CALLS_APP_SECRET,
  );
  const verification = await verifySocketTicket(ticket, env.CALLS_APP_SECRET, {
    accessMode: "authenticated",
    audience,
    now: Date.now(),
    roomSlug,
  });
  if (!verification.ok) throw new Error("Expected test ticket to verify");
  return appendRealtimeAdmissionHeaders(
    new Headers({
      Upgrade: "websocket",
      "Sec-WebSocket-Protocol": "ralph.realtime.v1",
    }),
    await createRealtimeAdmissionContext(verification.claims),
  );
}

function nextFrame(socket: WebSocket): Promise<Frame> {
  return new Promise((resolve) => {
    socket.addEventListener(
      "message",
      (event) => resolve(JSON.parse(event.data as string) as Frame),
      { once: true },
    );
  });
}

async function nextOp(socket: WebSocket, op: number): Promise<Frame> {
  while (true) {
    const frame = await nextFrame(socket);
    if (frame.op === op) return frame;
  }
}

/** Every frame until the socket closes, and the close. */
function framesUntilClose(socket: WebSocket) {
  const frames: Frame[] = [];
  socket.addEventListener("message", (event) => {
    frames.push(JSON.parse(event.data as string) as Frame);
  });
  return new Promise<{ frames: Frame[]; code: number; reason: string }>(
    (resolve) => {
      socket.addEventListener(
        "close",
        (event) => resolve({ frames, code: event.code, reason: event.reason }),
        { once: true },
      );
    },
  );
}

async function openSocket(
  roomName: string,
  audience: "global" | "room",
  subject: string,
): Promise<WebSocket> {
  const path =
    audience === "global"
      ? "https://internal/api/gateway?v=1"
      : `https://internal/api/channels/${roomName}/ws?v=1`;
  const response = await meetingRoom(roomName).fetch(path, {
    headers: await admissionHeaders(
      audience === "global" ? "global-gateway" : roomName,
      audience,
      subject,
    ),
  });
  expect(response.status).toBe(101);
  const socket = response.webSocket;
  if (!socket) throw new Error("Expected a WebSocket");
  socket.accept();
  await nextOp(socket, 8);
  return socket;
}

async function identify(
  socket: WebSocket,
  extra: Record<string, unknown> = {},
) {
  const ready = nextOp(socket, 2);
  socket.send(JSON.stringify({ op: 0, d: { name: "Tester", ...extra } }));
  return (await ready).d as {
    participant_id: string;
    voice_token: string;
  };
}

function moveRequest(roomName: string, userId: string) {
  return meetingRoom(roomName).fetch(`https://internal${VOICE_MOVE_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: serializeVoiceMoveRequest(userId, NOTICE),
  });
}

const liveSessionIds = (roomName: string) =>
  runInDurableObject(meetingRoom(roomName), (instance) =>
    [
      ...(
        instance as unknown as { sessions: Map<unknown, { id: string }> }
      ).sessions.values(),
    ].map((session) => session.id),
  );

describe("MeetingRoom voice move (source room)", () => {
  it("sends VoiceMove, then ends the session with SessionReplaced", async () => {
    const roomName = crypto.randomUUID();
    const moved = await openSocket(roomName, "room", "moved-user");
    const movedReady = await identify(moved);
    const observer = await openSocket(roomName, "room", "observer");
    await identify(observer);

    const movedEnd = framesUntilClose(moved);
    const observerSawLeave = (async () => {
      while (true) {
        const frame = await nextOp(observer, 15);
        const d = frame.d as { action?: string; participant?: { id?: string } };
        if (
          d.action === "leave" &&
          d.participant?.id === movedReady.participant_id
        )
          return frame;
      }
    })();

    const response = await moveRequest(roomName, "moved-user");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ moved: 1 });

    const { frames, code, reason } = await movedEnd;
    // The move comes first, so the client knows where to go before the close.
    expect(frames.find((frame) => frame.op === 42)).toEqual({
      op: 42,
      d: NOTICE,
    });
    expect(code).toBe(4010);
    expect(reason).toBe("Moved to another voice channel");
    await expect(observerSawLeave).resolves.toBeDefined();
    expect(await liveSessionIds(roomName)).not.toContain(
      movedReady.participant_id,
    );

    observer.close();
  });

  it("answers a Resume of the moved session with the same VoiceMove, then 4010", async () => {
    const roomName = crypto.randomUUID();
    const moved = await openSocket(roomName, "room", "resume-user");
    const ready = await identify(moved);
    const ended = framesUntilClose(moved);
    await moveRequest(roomName, "resume-user");
    await ended;

    const stale = await openSocket(roomName, "room", "resume-user");
    const staleEnd = framesUntilClose(stale);
    stale.send(
      JSON.stringify({
        op: 7,
        d: { session_id: ready.participant_id, seq_ack: 0 },
      }),
    );
    const { frames, code, reason } = await staleEnd;
    // A client mid-reconnect learns where it went, not "another device".
    expect(frames).toEqual([{ op: 42, d: NOTICE }]);
    expect(code).toBe(4010);
    expect(reason).toBe("Moved to another voice channel");
  });

  it("replays the move to a held session that resumes after it", async () => {
    const roomName = crypto.randomUUID();
    const held = await openSocket(roomName, "room", "held-move-user");
    const ready = await identify(held);
    held.close();
    await vi.waitFor(
      async () => {
        const isHeld = await runInDurableObject(
          meetingRoom(roomName),
          (instance) =>
            (
              instance as unknown as {
                resumableSessions: Map<string, unknown>;
              }
            ).resumableSessions.has(ready.participant_id),
        );
        expect(isHeld).toBe(true);
      },
      { timeout: 5_000, interval: 5 },
    );
    await moveRequest(roomName, "held-move-user");

    const back = await openSocket(roomName, "room", "held-move-user");
    const backEnd = framesUntilClose(back);
    back.send(
      JSON.stringify({
        op: 7,
        d: { session_id: ready.participant_id, seq_ack: 0 },
      }),
    );
    const { frames, code } = await backEnd;
    expect(frames).toEqual([{ op: 42, d: NOTICE }]);
    expect(code).toBe(4010);
  });

  it("never hands a moved session's notice to another user", async () => {
    const roomName = crypto.randomUUID();
    const moved = await openSocket(roomName, "room", "notice-owner");
    const ready = await identify(moved);
    const ended = framesUntilClose(moved);
    await moveRequest(roomName, "notice-owner");
    await ended;

    const other = await openSocket(roomName, "room", "notice-thief");
    const otherEnd = framesUntilClose(other);
    other.send(
      JSON.stringify({
        op: 7,
        d: { session_id: ready.participant_id, seq_ack: 0 },
      }),
    );
    const { frames } = await otherEnd;
    expect(frames.some((frame) => frame.op === 42)).toBe(false);
  });

  it("removes a session held for resume (client offline) too", async () => {
    const roomName = crypto.randomUUID();
    const offline = await openSocket(roomName, "room", "offline-user");
    const ready = await identify(offline);
    offline.close();
    await vi.waitFor(
      async () => {
        const held = await runInDurableObject(
          meetingRoom(roomName),
          (instance) =>
            (
              instance as unknown as {
                resumableSessions: Map<string, unknown>;
              }
            ).resumableSessions.has(ready.participant_id),
        );
        expect(held).toBe(true);
      },
      { timeout: 5_000, interval: 5 },
    );

    const response = await moveRequest(roomName, "offline-user");
    await expect(response.json()).resolves.toEqual({ moved: 1 });
    const held = await runInDurableObject(meetingRoom(roomName), (instance) =>
      (
        instance as unknown as { resumableSessions: Map<string, unknown> }
      ).resumableSessions.has(ready.participant_id),
    );
    expect(held).toBe(false);
  });

  it("answers moved 0 when the user is not in voice, and leaves standby alone", async () => {
    const roomName = crypto.randomUUID();
    const standby = await openSocket(roomName, "room", "standby-user");
    const standbyReady = await identify(standby, { standby: true });

    const absent = await moveRequest(roomName, "nobody-here");
    await expect(absent.json()).resolves.toEqual({ moved: 0 });
    const standbyOnly = await moveRequest(roomName, "standby-user");
    await expect(standbyOnly.json()).resolves.toEqual({ moved: 0 });
    expect(await liveSessionIds(roomName)).toContain(
      standbyReady.participant_id,
    );

    standby.close();
  });

  it("closes the moved session's VoiceRoom socket with the moved reason", async () => {
    const roomName = crypto.randomUUID();
    const moved = await openSocket(roomName, "room", "media-user");
    const ready = await identify(moved);
    const voiceResponse = await env.VOICE_ROOM.get(
      env.VOICE_ROOM.idFromName(roomName),
    ).fetch(`https://internal/api/channels/${roomName}/voice?v=1`, {
      headers: await admissionHeaders(roomName, "voice", "media-user"),
    });
    const voice = voiceResponse.webSocket;
    if (!voice) throw new Error("Expected a VoiceRoom socket");
    voice.accept();
    await nextOp(voice, 8);
    const voiceReady = nextOp(voice, 101);
    voice.send(
      JSON.stringify({
        op: 100,
        d: {
          participant_id: ready.participant_id,
          voice_token: ready.voice_token,
        },
      }),
    );
    await voiceReady;

    const voiceEnd = framesUntilClose(voice);
    await moveRequest(roomName, "media-user");
    await vi.waitFor(
      async () => {
        // Distinct from a takeover's, so the client never mistakes one for
        // the other.
        await expect(voiceEnd).resolves.toMatchObject({
          code: 4010,
          reason: "Moved to another voice channel",
        });
      },
      { timeout: 5_000, interval: 10 },
    );
  });

  it("rejects a malformed move", async () => {
    const response = await meetingRoom(crypto.randomUUID()).fetch(
      `https://internal${VOICE_MOVE_PATH}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: "x", notice: { channel_id: 1 } }),
      },
    );
    expect(response.status).toBe(400);
  });
});

// ── Global gateway ─────────────────────────────────────────────────────────

async function seedServerVoiceChannel(options: {
  userId: string;
  permissions: number;
}) {
  const statements = [
    "CREATE TABLE IF NOT EXISTS channels (id TEXT PRIMARY KEY, server_id TEXT, channel_type TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS dm_recipients (channel_id TEXT NOT NULL, user_id TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS server_members (server_id TEXT NOT NULL, user_id TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS member_roles (server_id TEXT NOT NULL, user_id TEXT NOT NULL, role_id TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS roles (id TEXT PRIMARY KEY, server_id TEXT, permissions INTEGER NOT NULL, position INTEGER NOT NULL, is_default INTEGER NOT NULL)",
    "CREATE TABLE IF NOT EXISTS channel_permission_overrides (channel_id TEXT NOT NULL, target_id TEXT NOT NULL, target_type TEXT NOT NULL, allow INTEGER NOT NULL, deny INTEGER NOT NULL)",
  ];
  for (const sql of statements) await env.DB.prepare(sql).run();
  const serverId = `move-server-${crypto.randomUUID()}`;
  const channelId = `move-channel-${crypto.randomUUID()}`;
  const roleId = `move-role-${crypto.randomUUID()}`;
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO channels (id, server_id, channel_type) VALUES (?, ?, 'voice')",
    ).bind(channelId, serverId),
    env.DB.prepare(
      "INSERT INTO server_members (server_id, user_id) VALUES (?, ?)",
    ).bind(serverId, options.userId),
    env.DB.prepare(
      "INSERT INTO roles (id, server_id, permissions, position, is_default) VALUES (?, ?, ?, 0, 1)",
    ).bind(roleId, serverId, options.permissions),
    env.DB.prepare(
      "INSERT INTO member_roles (server_id, user_id, role_id) VALUES (?, ?, ?)",
    ).bind(serverId, options.userId, roleId),
  ]);
  return { serverId, channelId };
}

const sessionChannel = (roomName: string, sessionId: string) =>
  runInDurableObject(meetingRoom(roomName), (instance) => {
    const live = instance as unknown as {
      sessions: Map<unknown, { id: string; voice_channel_id?: string }>;
    };
    for (const session of live.sessions.values()) {
      if (session.id === sessionId) return session.voice_channel_id ?? null;
    }
    return "no such session";
  });

const isRosterMember = (roomName: string, channelId: string, userId: string) =>
  runInDurableObject(meetingRoom(roomName), (instance) =>
    (
      instance as unknown as {
        voiceChannelMembers: Map<string, Map<string, unknown>>;
      }
    ).voiceChannelMembers
      .get(channelId)
      ?.has(userId),
  );

function recordGrant(
  roomName: string,
  userId: string,
  jti: string,
  channelId: string,
  expiresAt: number,
) {
  return meetingRoom(roomName)
    .fetch(`https://internal${VOICE_MOVE_GRANT_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: userId,
        jti,
        channel_id: channelId,
        expires_at: expiresAt,
      }),
    })
    .then((response) => expect(response.status).toBe(200));
}

/** A heartbeat with a payload is acked after every frame sent before it. */
async function settle(socket: WebSocket) {
  const ack = nextOp(socket, 6);
  socket.send(JSON.stringify({ op: 3, d: { settle: true } }));
  await ack;
}

describe("MeetingRoom voice move (global gateway)", () => {
  it("adds nobody on a VoiceChannelJoin, with or without a move grant", async () => {
    const userId = `grant-user-${crypto.randomUUID()}`;
    const { serverId, channelId } = await seedServerVoiceChannel({
      userId,
      permissions: PERMISSIONS.VIEW_CHANNELS,
    });
    const roomName = crypto.randomUUID();
    const socket = await openSocket(roomName, "global", userId);
    const ready = await identify(socket);
    const frames: Frame[] = [];
    socket.addEventListener("message", (event) => {
      frames.push(JSON.parse(event.data as string) as Frame);
    });

    const expiresAt = Date.now() + 60_000;
    await recordGrant(roomName, userId, "move-1", channelId, expiresAt);
    const grant = await issueVoiceMoveGrant(
      { jti: "move-1", subject: userId, serverId, channelId, expiresAt },
      env.REALTIME_TICKET_SECRET,
    );
    // An old client's join, before and after a move: the roster is the
    // room's, so neither puts the user on it, and neither is refused.
    socket.send(JSON.stringify({ op: 33, d: { channel_id: channelId } }));
    socket.send(
      JSON.stringify({
        op: 33,
        d: { channel_id: channelId, move_grant: grant },
      }),
    );
    await settle(socket);
    expect(frames.filter((frame) => frame.op === 18)).toEqual([]);
    expect(await isRosterMember(roomName, channelId, userId)).toBeFalsy();
    // It only names the channel its op 15 hints are for.
    expect(await sessionChannel(roomName, ready.participant_id)).toBe(
      channelId,
    );

    socket.close();
  });

  it("kills the earlier grant on a later move (A -> B -> C)", async () => {
    const userId = `abc-user-${crypto.randomUUID()}`;
    const b = await seedServerVoiceChannel({
      userId,
      permissions: PERMISSIONS.VIEW_CHANNELS,
    });
    const roomName = crypto.randomUUID();
    const expiresAt = Date.now() + 60_000;
    await recordGrant(roomName, userId, "move-b", b.channelId, expiresAt);
    // Moved on to C before using B's grant.
    await recordGrant(roomName, userId, "move-c", "channel-c", expiresAt);
    const grantB = await issueVoiceMoveGrant(
      {
        jti: "move-b",
        subject: userId,
        serverId: b.serverId,
        channelId: b.channelId,
        expiresAt,
      },
      env.REALTIME_TICKET_SECRET,
    );
    const socket = await openSocket(roomName, "global", userId);
    await identify(socket);
    expect(grantB).toBeTruthy();

    // Tickets: B is dead, C spends once per audience.
    const use = (jti: string, channel: string, kind: "room" | "voice") =>
      meetingRoom(roomName)
        .fetch(`https://internal${VOICE_MOVE_GRANT_USE_PATH}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_id: userId,
            jti,
            channel_id: channel,
            use: kind,
          }),
        })
        .then((response) => response.json());
    await expect(use("move-b", b.channelId, "room")).resolves.toEqual({
      ok: false,
    });
    await expect(use("move-c", "channel-c", "room")).resolves.toEqual({
      ok: true,
    });
    await expect(use("move-c", "channel-c", "room")).resolves.toEqual({
      ok: false,
    });
    await expect(use("move-c", "channel-c", "voice")).resolves.toEqual({
      ok: true,
    });

    socket.close();
  });
});
