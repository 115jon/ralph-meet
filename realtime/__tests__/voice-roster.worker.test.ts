// Voice rosters (realtime/VOICE_ROSTER.md): a channel's room object is the
// authority on who is in its voice, and pushes every change to the global
// gateway, which only mirrors it for the sidebar. Old clients' op 33/34/15 on
// the global socket never add or remove a member.

import { env } from "cloudflare:workers";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

import {
  issueSocketTicket,
  verifySocketTicket,
} from "../../src/lib/voice/socket-ticket";
import type { IceServer } from "../meeting-room/turn-credentials";
import {
  appendRealtimeAdmissionHeaders,
  createRealtimeAdmissionContext,
} from "../realtime-admission";
import { serializeVoiceMoveRequest, VOICE_MOVE_PATH } from "../voice-move";
import { VOICE_ROSTER_GATEWAY, VOICE_ROSTER_PATH } from "../voice-roster";

type Frame = { op: number; d: any };
type Member = Record<string, unknown> & { user_id: string };

const STATE_UPDATE = "VOICE_CHANNEL_STATE_UPDATE";

function meetingRoom(name: string) {
  return env.MEETING_ROOM.get(env.MEETING_ROOM.idFromName(name));
}

async function admissionHeaders(
  roomSlug: string,
  audience: "global" | "room",
  subject: string,
  claims: { channelId?: string; serverId?: string } = {},
) {
  const ticket = await issueSocketTicket(
    {
      accessMode: "authenticated",
      audience,
      expiresAt: Date.now() + 60_000,
      nonce: crypto.randomUUID(),
      roomSlug,
      subject,
      ...claims,
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

async function accept(response: Response): Promise<WebSocket> {
  expect(response.status).toBe(101);
  const socket = response.webSocket;
  if (!socket) throw new Error("Expected a WebSocket");
  socket.accept();
  await nextOp(socket, 8);
  return socket;
}

/** A room (voice channel) socket, admitted for `channelId`. */
async function openRoomSocket(
  roomSlug: string,
  subject: string,
  claims: { channelId?: string; serverId?: string },
) {
  return accept(
    await meetingRoom(roomSlug).fetch(
      `https://internal/api/channels/${roomSlug}/ws?v=1`,
      { headers: await admissionHeaders(roomSlug, "room", subject, claims) },
    ),
  );
}

/** A chat (global gateway) socket on the object rooms push to, or another. */
async function openGatewaySocket(
  subject: string,
  objectName = VOICE_ROSTER_GATEWAY,
) {
  return accept(
    await meetingRoom(objectName).fetch("https://internal/api/gateway?v=1", {
      headers: await admissionHeaders("global-gateway", "global", subject),
    }),
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

/** Every frame the socket gets from now on. */
function record(socket: WebSocket): Frame[] {
  const frames: Frame[] = [];
  socket.addEventListener("message", (event) => {
    frames.push(JSON.parse(event.data as string) as Frame);
  });
  return frames;
}

function closeOf(socket: WebSocket) {
  return new Promise<{ code: number }>((resolve) => {
    socket.addEventListener("close", (event) => resolve({ code: event.code }), {
      once: true,
    });
  });
}

async function identify(socket: WebSocket, d: Record<string, unknown> = {}) {
  const ready = nextOp(socket, 2);
  socket.send(JSON.stringify({ op: 0, d: { name: "Tester", ...d } }));
  return (await ready).d as { participant_id: string };
}

/** A heartbeat with a payload is acked after every frame sent before it. */
async function settle(socket: WebSocket) {
  const ack = nextOp(socket, 6);
  socket.send(JSON.stringify({ op: 3, d: { settle: true } }));
  await ack;
}

function sidebarUpdates(frames: Frame[], channelId: string): Member[][] {
  return frames
    .filter(
      (frame) =>
        frame.op === 19 &&
        frame.d?.event === STATE_UPDATE &&
        frame.d?.data?.channel_id === channelId,
    )
    .map((frame) => frame.d.data.members as Member[]);
}

/** The global gateway's sidebar entry for `userId`, or null. */
const memberOf = (
  channelId: string,
  userId: string,
  objectName = VOICE_ROSTER_GATEWAY,
) =>
  runInDurableObject(meetingRoom(objectName), (instance) => {
    const live = instance as unknown as {
      voiceChannelMembers: Map<string, Map<string, Member>>;
    };
    return live.voiceChannelMembers.get(channelId)?.get(userId) ?? null;
  });

async function waitForMember(
  channelId: string,
  userId: string,
  expected: Record<string, unknown> | null,
  objectName = VOICE_ROSTER_GATEWAY,
) {
  await vi.waitFor(
    async () => {
      const member = await memberOf(channelId, userId, objectName);
      if (expected === null) expect(member).toBeNull();
      else expect(member).toMatchObject(expected);
    },
    { timeout: 5_000, interval: 10 },
  );
}

async function seedDmChannel(userIds: string[]) {
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS channels (id TEXT PRIMARY KEY, server_id TEXT, channel_type TEXT NOT NULL)",
  ).run();
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS dm_recipients (channel_id TEXT NOT NULL, user_id TEXT NOT NULL)",
  ).run();
  const channelId = `roster-dm-${crypto.randomUUID()}`;
  await env.DB.prepare(
    "INSERT INTO channels (id, server_id, channel_type) VALUES (?, NULL, 'dm')",
  )
    .bind(channelId)
    .run();
  for (const userId of userIds) {
    await env.DB.prepare(
      "INSERT INTO dm_recipients (channel_id, user_id) VALUES (?, ?)",
    )
      .bind(channelId, userId)
      .run();
  }
  return channelId;
}

/** A DM call room and its channel; `users` may see the channel. */
async function dmRoom(users: string[]) {
  const channelId = await seedDmChannel(users);
  return { channelId, roomSlug: `dm-call-${crypto.randomUUID()}` };
}

describe("voice roster: the room is the authority", () => {
  it("mirrors a join, voice state changes and a leave onto the sidebar", async () => {
    const userId = `roster-user-${crypto.randomUUID()}`;
    const observerId = `roster-observer-${crypto.randomUUID()}`;
    const { channelId, roomSlug } = await dmRoom([userId, observerId]);
    const observer = await openGatewaySocket(observerId);
    await identify(observer);
    const seen = record(observer);

    const room = await openRoomSocket(roomSlug, userId, { channelId });
    await identify(room, { name: "Roster User" });
    await waitForMember(channelId, userId, {
      name: "Roster User",
      connected: true,
      connection_state: "connected",
      self_mute: true,
      self_deaf: false,
    });

    // Op 15 on the room socket alone reaches the sidebar.
    room.send(
      JSON.stringify({ op: 15, d: { self_mute: false, self_deaf: true } }),
    );
    await waitForMember(channelId, userId, {
      self_mute: false,
      self_deaf: true,
    });

    room.send(JSON.stringify({ op: 11, d: {} }));
    await waitForMember(channelId, userId, null);
    await vi.waitFor(() => {
      const updates = sidebarUpdates(seen, channelId);
      expect(updates.at(-1)).toEqual([]);
      expect(updates.some((members) => members.length === 1)).toBe(true);
    });

    observer.close();
  });

  it("shows an abrupt close as reconnecting and a resume as connected", async () => {
    const userId = `roster-resume-${crypto.randomUUID()}`;
    const { channelId, roomSlug } = await dmRoom([userId]);
    const first = await openRoomSocket(roomSlug, userId, { channelId });
    const ready = await identify(first);
    await waitForMember(channelId, userId, { connection_state: "connected" });

    first.close();
    await waitForMember(channelId, userId, {
      connected: false,
      connection_state: "reconnecting",
    });

    const resumed = await openRoomSocket(roomSlug, userId, { channelId });
    const resumedReply = nextOp(resumed, 9);
    resumed.send(
      JSON.stringify({
        op: 7,
        d: { session_id: ready.participant_id, seq_ack: 0 },
      }),
    );
    await resumedReply;
    await waitForMember(channelId, userId, {
      connected: true,
      connection_state: "connected",
    });

    resumed.close();
  });

  it("clears a zombie once its resume grace lapses", async () => {
    const userId = `roster-zombie-${crypto.randomUUID()}`;
    const { channelId, roomSlug } = await dmRoom([userId]);
    const socket = await openRoomSocket(roomSlug, userId, { channelId });
    const ready = await identify(socket);
    await waitForMember(channelId, userId, { connection_state: "connected" });

    const room = meetingRoom(roomSlug);
    await runInDurableObject(room, (instance) => {
      const live = instance as unknown as {
        sessions: Map<unknown, { last_heartbeat?: number }>;
      };
      for (const session of live.sessions.values()) {
        session.last_heartbeat = Date.now() - 91_000;
      }
    });
    expect(await runDurableObjectAlarm(room)).toBe(true);
    await waitForMember(channelId, userId, {
      connection_state: "reconnecting",
    });

    await runInDurableObject(room, (instance) => {
      (
        instance as unknown as { resumableSessionExpiry: Map<string, number> }
      ).resumableSessionExpiry.set(ready.participant_id, Date.now() - 121_000);
    });
    expect(await runDurableObjectAlarm(room)).toBe(true);
    await waitForMember(channelId, userId, null);
  });

  it("keeps one connected member through a device takeover, and drops it on a kick", async () => {
    const userId = `roster-takeover-${crypto.randomUUID()}`;
    const observerId = `roster-takeover-observer-${crypto.randomUUID()}`;
    const { channelId, roomSlug } = await dmRoom([userId, observerId]);
    const observer = await openGatewaySocket(observerId);
    await identify(observer);

    const phone = await openRoomSocket(roomSlug, userId, { channelId });
    await identify(phone, { name: "Phone" });
    await waitForMember(channelId, userId, { connection_state: "connected" });
    const seen = record(observer);

    const phoneClosed = closeOf(phone);
    const laptop = await openRoomSocket(roomSlug, userId, { channelId });
    const laptopReady = await identify(laptop, { name: "Laptop" });
    await expect(phoneClosed).resolves.toMatchObject({ code: 4010 });
    await settle(laptop);
    await waitForMember(channelId, userId, { connection_state: "connected" });
    // The takeover never emptied the sidebar entry on the way.
    expect(
      sidebarUpdates(seen, channelId).some((members) => members.length === 0),
    ).toBe(false);

    const kicked = await meetingRoom(roomSlug).fetch(
      "https://internal/disconnect-session",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          session_id: laptopReady.participant_id,
        }),
      },
    );
    expect(await kicked.json()).toEqual({ disconnected: true });
    await waitForMember(channelId, userId, null);

    observer.close();
  });

  it("takes a moved user off the source channel with no global-gateway step", async () => {
    const userId = `roster-move-${crypto.randomUUID()}`;
    const serverId = `roster-server-${crypto.randomUUID()}`;
    const channelId = `roster-voice-${crypto.randomUUID()}`;
    // A server voice room: the channel comes from the slug and server id.
    const roomSlug = `voice-${serverId}-${channelId}`;
    const socket = await openRoomSocket(roomSlug, userId, { serverId });
    await identify(socket);
    await waitForMember(channelId, userId, { connection_state: "connected" });

    const moved = await meetingRoom(roomSlug).fetch(
      `https://internal${VOICE_MOVE_PATH}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: serializeVoiceMoveRequest(userId, {
          channel_id: "roster-target",
          server_id: serverId,
          channel_name: "Target",
          mover_name: "Mod",
          grant: "vm1.grant.signature",
          grant_expires_at: Date.now() + 60_000,
        }),
      },
    );
    expect(await moved.json()).toEqual({ moved: 1 });
    await waitForMember(channelId, userId, null);
  });

  it("retries from the room's alarm after a push that failed for good", async () => {
    const userId = `roster-retry-${crypto.randomUUID()}`;
    const { channelId, roomSlug } = await dmRoom([userId]);
    const socket = await openRoomSocket(roomSlug, userId, { channelId });
    await identify(socket);
    await waitForMember(channelId, userId, { connection_state: "connected" });

    // As if every push of the latest roster had failed: the gateway lacks
    // it and the room has a retry due.
    await runInDurableObject(meetingRoom(VOICE_ROSTER_GATEWAY), (instance) => {
      (
        instance as unknown as {
          voiceChannelMembers: Map<string, unknown>;
          voiceRosterSources: Map<string, { seq: number }>;
        }
      ).voiceChannelMembers.delete(channelId);
      (
        instance as unknown as {
          voiceRosterSources: Map<string, { seq: number }>;
        }
      ).voiceRosterSources.get(channelId)!.seq = 0;
    });
    const room = meetingRoom(roomSlug);
    await runInDurableObject(room, (instance) => {
      const live = instance as unknown as {
        voiceRosterDelivered: string | null;
        voiceRosterRetryAt: number | null;
      };
      live.voiceRosterDelivered = null;
      live.voiceRosterRetryAt = Date.now() - 1;
    });
    expect(await runDurableObjectAlarm(room)).toBe(true);
    await waitForMember(channelId, userId, { connection_state: "connected" });

    socket.close();
  });

  it("pulls a roster the gateway has not heard of lately: a reset room's ghost goes", async () => {
    const userId = `roster-ghost-${crypto.randomUUID()}`;
    const { channelId, roomSlug } = await dmRoom([userId]);
    const gatewayName = `roster-gateway-${crypto.randomUUID()}`;
    const chat = await openGatewaySocket(userId, gatewayName);
    await identify(chat);

    // The room's last push named the user; then the room lost its sessions
    // without a word (an object reset drops sockets, and no close runs).
    const push = await meetingRoom(gatewayName).fetch(
      `https://internal${VOICE_ROSTER_PATH}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel_id: channelId,
          room_slug: roomSlug,
          seq: 5,
          started_at: Date.now(),
          members: [
            {
              user_id: userId,
              name: "Ghost",
              connected: true,
              connection_state: "connected",
              disconnected_at: null,
              reconnect_expires_at: null,
              self_mute: true,
              self_deaf: false,
              self_video: false,
              self_stream: false,
              joined_at: Date.now(),
            },
          ],
        }),
      },
    );
    expect(await push.json()).toMatchObject({ applied: true });
    expect(await memberOf(channelId, userId, gatewayName)).not.toBeNull();

    // A minute without word from the room: the alarm pulls its roster.
    await runInDurableObject(meetingRoom(gatewayName), (instance) => {
      (
        instance as unknown as {
          voiceRosterSources: Map<string, { confirmedAt: number }>;
        }
      ).voiceRosterSources.get(channelId)!.confirmedAt = Date.now() - 61_000;
    });
    expect(await runDurableObjectAlarm(meetingRoom(gatewayName))).toBe(true);
    await waitForMember(channelId, userId, null, gatewayName);

    chat.close();
  });

  it("applies only newer snapshots: duplicates and late ones change nothing", async () => {
    const gatewayName = `roster-order-${crypto.randomUUID()}`;
    const chat = await openGatewaySocket("roster-order-user", gatewayName);
    await identify(chat);
    const channelId = `roster-order-${crypto.randomUUID()}`;
    const roomSlug = `room-${channelId}`;
    const member = (userId: string) => ({
      user_id: userId,
      name: userId,
      connected: true,
      connection_state: "connected",
      disconnected_at: null,
      reconnect_expires_at: null,
      self_mute: true,
      self_deaf: false,
      self_video: false,
      self_stream: false,
      joined_at: 1_700_000_000_000,
    });
    const push = async (
      seq: number,
      members: unknown[],
      slug: string = roomSlug,
    ) => {
      const response = await meetingRoom(gatewayName).fetch(
        `https://internal${VOICE_ROSTER_PATH}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            channel_id: channelId,
            room_slug: slug,
            seq,
            started_at: members.length > 0 ? 1_700_000_000_000 : null,
            members,
          }),
        },
      );
      return ((await response.json()) as { applied: boolean }).applied;
    };

    expect(await push(10, [member("alice")])).toBe(true);
    expect(await push(10, [member("alice")])).toBe(false); // duplicate
    expect(await push(12, [])).toBe(true);
    expect(await push(11, [member("alice")])).toBe(false); // arrived late
    expect(await memberOf(channelId, "alice", gatewayName)).toBeNull();
    // A channel has one room: another room's snapshot for it is ignored.
    expect(await push(99, [member("mallory")], "some-other-room")).toBe(false);
    expect(await memberOf(channelId, "mallory", gatewayName)).toBeNull();
    expect(await push(13, [member("bob")])).toBe(true);
    expect(await memberOf(channelId, "bob", gatewayName)).not.toBeNull();

    chat.close();
  });

  it("drops a stored entry from before rooms pushed once no room claims it", async () => {
    const gatewayName = `roster-legacy-${crypto.randomUUID()}`;
    const chat = await openGatewaySocket("roster-legacy-user", gatewayName);
    await identify(chat);
    const channelId = `roster-legacy-${crypto.randomUUID()}`;
    const gateway = meetingRoom(gatewayName);
    // What a pre-push gateway left: a member, no source.
    await runInDurableObject(gateway, (instance) => {
      const live = instance as unknown as {
        voiceChannelMembers: Map<string, Map<string, unknown>>;
        voiceRosterSources: Map<string, unknown>;
      };
      live.voiceChannelMembers.set(
        channelId,
        new Map([["old-op33-user", { user_id: "old-op33-user", name: "Old" }]]),
      );
      live.voiceRosterSources.set(channelId, {
        roomSlug: null,
        seq: 0,
        confirmedAt: Date.now() - 121_000,
      });
    });
    expect(await runDurableObjectAlarm(gateway)).toBe(true);
    expect(await memberOf(channelId, "old-op33-user", gatewayName)).toBeNull();

    chat.close();
  });
});

/** POSTs a roster snapshot to a gateway as a room would; the reply body. */
async function pushSnapshot(
  gatewayName: string,
  snapshot: {
    channel_id: string;
    room_slug: string;
    seq: number;
    members: Array<{ user_id: string; name?: string }>;
  },
) {
  const response = await meetingRoom(gatewayName).fetch(
    `https://internal${VOICE_ROSTER_PATH}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...snapshot,
        started_at: snapshot.members.length > 0 ? Date.now() : null,
        members: snapshot.members.map((member) => ({
          name: member.user_id,
          connected: true,
          connection_state: "connected",
          disconnected_at: null,
          reconnect_expires_at: null,
          self_mute: true,
          self_deaf: false,
          self_video: false,
          self_stream: false,
          joined_at: Date.now(),
          ...member,
        })),
      }),
    },
  );
  return (await response.json()) as { applied: boolean; seq?: number };
}

/**
 * An object reset (deploy, exception, exceeded limit): the room's sockets
 * drop with no close event, so no session is held for resume.
 */
async function resetRoom(roomSlug: string) {
  await runInDurableObject(meetingRoom(roomSlug), (_instance, state) => {
    state.abort("reset");
  }).catch(() => {});
}

/** The room's members a reset dropped and it holds (wakes the room). */
const resetHeldOf = (roomSlug: string) =>
  runInDurableObject(meetingRoom(roomSlug), (instance) =>
    [
      ...(
        instance as unknown as {
          voiceRosterResetHeld: Map<string, unknown>;
        }
      ).voiceRosterResetHeld.keys(),
    ].sort(),
  );

/** The global gateway's call state and started_at for a DM channel. */
const callStateOf = (channelId: string) =>
  runInDurableObject(meetingRoom(VOICE_ROSTER_GATEWAY), (instance) => {
    const live = instance as unknown as {
      activeCalls: Map<string, unknown>;
      pendingCalls: Map<string, { channelId: string }>;
      voiceChannelStartedAt: Map<string, number>;
    };
    return {
      active: live.activeCalls.has(channelId),
      ringing: [...live.pendingCalls.values()].some(
        (call) => call.channelId === channelId,
      ),
      startedAt: live.voiceChannelStartedAt.get(channelId) ?? null,
    };
  });

const ringStops = (frames: Frame[]) =>
  frames.filter(
    (frame) => frame.op === 19 && frame.d?.event === "CALL_RING_STOP",
  );

describe("voice roster: a room reset", () => {
  it("holds the members a reset dropped, so an answered call goes on when they reconnect", async () => {
    const callerId = `reset-caller-${crypto.randomUUID()}`;
    const calleeId = `reset-callee-${crypto.randomUUID()}`;
    const { channelId, roomSlug } = await dmRoom([callerId, calleeId]);
    const chat = await openGatewaySocket(callerId);
    await identify(chat);
    const seen = record(chat);

    const caller = await openRoomSocket(roomSlug, callerId, { channelId });
    await identify(caller);
    const callee = await openRoomSocket(roomSlug, calleeId, { channelId });
    await identify(callee);
    await waitForMember(channelId, callerId, { connection_state: "connected" });
    await waitForMember(channelId, calleeId, { connection_state: "connected" });
    await runInDurableObject(meetingRoom(VOICE_ROSTER_GATEWAY), (instance) => {
      (
        instance as unknown as { activeCalls: Map<string, unknown> }
      ).activeCalls.set(channelId, {
        callId: `call-${crypto.randomUUID()}`,
        callerId,
        calleeId,
        channelId,
        acceptedAt: Date.now() - 60_000,
      });
    });
    const before = await callStateOf(channelId);
    expect(before).toMatchObject({ active: true });

    await resetRoom(roomSlug);
    // The room's next start (here a pull would do the same) shows both as
    // reconnecting instead of emptying the channel.
    expect(await resetHeldOf(roomSlug)).toEqual([calleeId, callerId].sort());
    await waitForMember(channelId, callerId, {
      connected: false,
      connection_state: "reconnecting",
    });
    await waitForMember(channelId, calleeId, {
      connection_state: "reconnecting",
    });

    // Both clients reconnect (their Resume gets 4006; they Identify again).
    const callerAgain = await openRoomSocket(roomSlug, callerId, { channelId });
    await identify(callerAgain);
    const calleeAgain = await openRoomSocket(roomSlug, calleeId, { channelId });
    await identify(calleeAgain);
    await waitForMember(channelId, callerId, { connection_state: "connected" });
    await waitForMember(channelId, calleeId, { connection_state: "connected" });
    expect(await resetHeldOf(roomSlug)).toEqual([]);

    expect(await callStateOf(channelId)).toEqual(before);
    expect(
      sidebarUpdates(seen, channelId).some((members) => members.length === 0),
    ).toBe(false);

    // Back in a session, a leave is a leave: not reconnecting again.
    callerAgain.send(JSON.stringify({ op: 11, d: {} }));
    await waitForMember(channelId, callerId, null);

    calleeAgain.close();
    chat.close();
  });

  it("does not cancel a ring when the caller's room resets and they reconnect", async () => {
    const callerId = `reset-ring-caller-${crypto.randomUUID()}`;
    const calleeId = `reset-ring-callee-${crypto.randomUUID()}`;
    const { channelId, roomSlug } = await dmRoom([callerId, calleeId]);
    const chat = await openGatewaySocket(callerId);
    await identify(chat);
    const seen = record(chat);
    const caller = await openRoomSocket(roomSlug, callerId, { channelId });
    await identify(caller);
    await waitForMember(channelId, callerId, { connection_state: "connected" });
    await runInDurableObject(meetingRoom(VOICE_ROSTER_GATEWAY), (instance) => {
      (
        instance as unknown as { pendingCalls: Map<string, unknown> }
      ).pendingCalls.set(calleeId, {
        callId: `ring-${crypto.randomUUID()}`,
        callerId,
        calleeId,
        channelId,
        voiceRoomId: roomSlug,
        expiresAt: Date.now() + 30_000,
        callerName: "Caller",
        timeout: undefined,
      });
    });

    await resetRoom(roomSlug);
    expect(await resetHeldOf(roomSlug)).toEqual([callerId]);
    await waitForMember(channelId, callerId, {
      connection_state: "reconnecting",
    });
    const again = await openRoomSocket(roomSlug, callerId, { channelId });
    await identify(again);
    await waitForMember(channelId, callerId, { connection_state: "connected" });
    await settle(chat);

    expect(await callStateOf(channelId)).toMatchObject({ ringing: true });
    expect(ringStops(seen)).toEqual([]);

    await runInDurableObject(meetingRoom(VOICE_ROSTER_GATEWAY), (instance) => {
      (
        instance as unknown as { pendingCalls: Map<string, unknown> }
      ).pendingCalls.delete(calleeId);
    });
    again.close();
    chat.close();
  });

  it("ends the call once the grace runs out with nobody back", async () => {
    const callerId = `reset-gone-caller-${crypto.randomUUID()}`;
    const calleeId = `reset-gone-callee-${crypto.randomUUID()}`;
    const { channelId, roomSlug } = await dmRoom([callerId, calleeId]);
    const caller = await openRoomSocket(roomSlug, callerId, { channelId });
    await identify(caller);
    const callee = await openRoomSocket(roomSlug, calleeId, { channelId });
    await identify(callee);
    await waitForMember(channelId, callerId, { connection_state: "connected" });
    await waitForMember(channelId, calleeId, { connection_state: "connected" });
    await runInDurableObject(meetingRoom(VOICE_ROSTER_GATEWAY), (instance) => {
      (
        instance as unknown as { activeCalls: Map<string, unknown> }
      ).activeCalls.set(channelId, {
        callId: `call-${crypto.randomUUID()}`,
        callerId,
        calleeId,
        channelId,
        acceptedAt: Date.now() - 60_000,
      });
    });
    const startedAt = (await callStateOf(channelId)).startedAt;

    await resetRoom(roomSlug);
    expect(await resetHeldOf(roomSlug)).toHaveLength(2);
    await waitForMember(channelId, callerId, {
      connection_state: "reconnecting",
    });
    // Held, the channel keeps its call and its started_at.
    expect(await callStateOf(channelId)).toEqual({
      active: true,
      ringing: false,
      startedAt,
    });

    const room = meetingRoom(roomSlug);
    await runInDurableObject(room, (instance) => {
      for (const lost of (
        instance as unknown as {
          voiceRosterResetHeld: Map<string, { disconnectedAt: number }>;
        }
      ).voiceRosterResetHeld.values()) {
        lost.disconnectedAt -= 121_000;
      }
    });
    expect(await runDurableObjectAlarm(room)).toBe(true);
    await waitForMember(channelId, callerId, null);
    await waitForMember(channelId, calleeId, null);
    await vi.waitFor(async () =>
      expect(await callStateOf(channelId)).toMatchObject({
        active: false,
        startedAt: null,
      }),
    );
  });
});

describe("voice roster: a room seq behind the gateway's", () => {
  // The room lost its stored seq and its host's clock is an hour behind:
  // the gateway holds a seq above anything the room would count to.
  const aheadSeq = () => (Date.now() + 3_600_000) * 1000;

  it("pushes again above the gateway's seq when a push is ignored as older", async () => {
    const userId = `seq-push-${crypto.randomUUID()}`;
    const { channelId, roomSlug } = await dmRoom([userId]);
    const socket = await openRoomSocket(roomSlug, userId, { channelId });
    await identify(socket);
    await waitForMember(channelId, userId, { self_mute: true });
    await runInDurableObject(meetingRoom(VOICE_ROSTER_GATEWAY), (instance) => {
      (
        instance as unknown as {
          voiceRosterSources: Map<string, { seq: number }>;
        }
      ).voiceRosterSources.get(channelId)!.seq = aheadSeq();
    });

    socket.send(JSON.stringify({ op: 15, d: { self_mute: false } }));
    await waitForMember(channelId, userId, { self_mute: false });

    socket.close();
  });

  it("answers a pull above the gateway's seq, so the pull replaces a stale roster", async () => {
    const userId = `seq-pull-${crypto.randomUUID()}`;
    const { channelId, roomSlug } = await dmRoom([userId]);
    const socket = await openRoomSocket(roomSlug, userId, { channelId });
    await identify(socket);
    await waitForMember(channelId, userId, { connection_state: "connected" });
    // What the gateway holds: a ghost, at a seq above the room's.
    expect(
      await pushSnapshot(VOICE_ROSTER_GATEWAY, {
        channel_id: channelId,
        room_slug: roomSlug,
        seq: aheadSeq(),
        members: [{ user_id: "seq-ghost" }],
      }),
    ).toMatchObject({ applied: true });
    await waitForMember(channelId, userId, null);

    const gateway = meetingRoom(VOICE_ROSTER_GATEWAY);
    await runInDurableObject(gateway, (instance) => {
      (
        instance as unknown as {
          voiceRosterSources: Map<string, { confirmedAt: number }>;
        }
      ).voiceRosterSources.get(channelId)!.confirmedAt = Date.now() - 61_000;
    });
    expect(await runDurableObjectAlarm(gateway)).toBe(true);
    await waitForMember(channelId, userId, { connection_state: "connected" });
    expect(await memberOf(channelId, "seq-ghost")).toBeNull();

    socket.close();
  });

  it("tells a room the seq it holds when it ignores an older push", async () => {
    const gatewayName = `seq-reply-${crypto.randomUUID()}`;
    const chat = await openGatewaySocket("seq-reply-user", gatewayName);
    await identify(chat);
    const snapshot = {
      channel_id: `seq-reply-${crypto.randomUUID()}`,
      room_slug: "seq-reply-room",
      members: [{ user_id: "alice" }],
    };
    expect(await pushSnapshot(gatewayName, { ...snapshot, seq: 20 })).toEqual({
      applied: true,
      seq: 20,
    });
    expect(await pushSnapshot(gatewayName, { ...snapshot, seq: 7 })).toEqual({
      applied: false,
      seq: 20,
    });
    // Not the channel's room: no seq to count from.
    expect(
      await pushSnapshot(gatewayName, {
        ...snapshot,
        room_slug: "another-room",
        seq: 99,
      }),
    ).toEqual({ applied: false });

    chat.close();
  });
});

describe("voice roster: gateway alarm", () => {
  it("schedules the revalidation alarm for every newly mirrored channel", async () => {
    const gatewayName = `roster-alarm-${crypto.randomUUID()}`;
    const chat = await openGatewaySocket("roster-alarm-user", gatewayName);
    await identify(chat);
    const gateway = meetingRoom(gatewayName);
    const first = `roster-alarm-a-${crypto.randomUUID()}`;
    // A first channel that emptied: its source stays (tombstone).
    await pushSnapshot(gatewayName, {
      channel_id: first,
      room_slug: "room-a",
      seq: 1,
      members: [{ user_id: "alice" }],
    });
    await pushSnapshot(gatewayName, {
      channel_id: first,
      room_slug: "room-a",
      seq: 2,
      members: [],
    });
    await runInDurableObject(gateway, (_instance, state) =>
      state.storage.setAlarm(Date.now() + 600_000),
    );

    await pushSnapshot(gatewayName, {
      channel_id: `roster-alarm-b-${crypto.randomUUID()}`,
      room_slug: "room-b",
      seq: 1,
      members: [{ user_id: "bob" }],
    });
    await vi.waitFor(async () => {
      const alarm = await runInDurableObject(gateway, (_instance, state) =>
        state.storage.getAlarm(),
      );
      expect(alarm).not.toBeNull();
      expect(alarm!).toBeLessThanOrEqual(Date.now() + 60_000);
    });

    chat.close();
  });
});

describe("voice roster: released clients' op 33 / 34 / 15", () => {
  it("never puts a member on the sidebar or takes one off from the global socket", async () => {
    const userId = `roster-legacy-client-${crypto.randomUUID()}`;
    const observerId = `roster-legacy-observer-${crypto.randomUUID()}`;
    const { channelId, roomSlug } = await dmRoom([userId, observerId]);
    const observer = await openGatewaySocket(observerId);
    await identify(observer);
    const seen = record(observer);
    const chat = await openGatewaySocket(userId);
    await identify(chat);
    const chatFrames = record(chat);

    // The old client says it joined, before its room session exists.
    chat.send(
      JSON.stringify({
        op: 33,
        d: { channel_id: channelId, self_mute: false },
      }),
    );
    chat.send(JSON.stringify({ op: 15, d: { self_mute: false } }));
    await settle(chat);
    await settle(observer);
    expect(await memberOf(channelId, userId)).toBeNull();
    expect(sidebarUpdates(seen, channelId)).toEqual([]);
    expect(chatFrames.filter((frame) => frame.op === 18)).toEqual([]);

    // The room reports the real session.
    const room = await openRoomSocket(roomSlug, userId, { channelId });
    await identify(room);
    await waitForMember(channelId, userId, { self_mute: true });

    // Mute on the global socket is not the room's state; the preview (a
    // field only the global socket carries) is shown.
    chat.send(
      JSON.stringify({
        op: 15,
        d: {
          self_mute: false,
          self_deaf: true,
          stream_preview_url: "https://example.com/preview.png",
        },
      }),
    );
    await waitForMember(channelId, userId, {
      self_mute: true,
      self_deaf: false,
      stream_preview_url: "https://example.com/preview.png",
    });

    // An old client's leave (or its 30 s re-join) does not move the entry.
    chat.send(JSON.stringify({ op: 34, d: { channel_id: channelId } }));
    chat.send(JSON.stringify({ op: 33, d: { channel_id: channelId } }));
    await settle(chat);
    expect(await memberOf(channelId, userId)).toMatchObject({
      connection_state: "connected",
    });

    // Only the room's leave does; a re-sent op 33 afterwards adds nothing.
    room.send(JSON.stringify({ op: 11, d: {} }));
    await waitForMember(channelId, userId, null);
    chat.send(JSON.stringify({ op: 33, d: { channel_id: channelId } }));
    await settle(chat);
    expect(await memberOf(channelId, userId)).toBeNull();

    chat.close();
    observer.close();
  });
});

function step<T>(label: string, promise: Promise<T>, ms = 1_500): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`stuck at ${label}`)), ms),
    ),
  ]);
}

describe("room races", () => {
  it("replaces the earlier tab's Identify when it finishes after a later one", async () => {
    const roomSlug = crypto.randomUUID();
    const userId = `two-tabs-${crypto.randomUUID()}`;
    const room = meetingRoom(roomSlug);
    // Hold the first Identify's TURN step (plain flags: a promise made here
    // cannot be awaited inside the room).
    const turn = { calls: 0, released: false };
    await runInDurableObject(room, (instance) => {
      const live = instance as unknown as {
        generateTurnCredentials(): Promise<IceServer[]>;
      };
      const generate = live.generateTurnCredentials.bind(live);
      live.generateTurnCredentials = async () => {
        turn.calls += 1;
        if (turn.calls === 1) {
          while (!turn.released) {
            await new Promise((resolve) => setTimeout(resolve, 5));
          }
        }
        return generate();
      };
    });

    const earlier = await openRoomSocket(roomSlug, userId, {});
    const earlierFrames = record(earlier);
    const earlierClosed = closeOf(earlier);
    earlier.send(JSON.stringify({ op: 0, d: { name: "Tab A" } }));
    await vi.waitFor(() => expect(turn.calls).toBe(1));

    const later = await openRoomSocket(roomSlug, userId, {});
    const laterFrames = record(later);
    const laterReady = await identify(later, { name: "Tab B" });

    turn.released = true;
    await expect(earlierClosed).resolves.toMatchObject({ code: 4010 });
    expect(earlierFrames).toContainEqual(
      expect.objectContaining({
        op: 18,
        d: expect.objectContaining({ code: 4010 }),
      }),
    );
    expect(earlierFrames.some((frame) => frame.op === 2)).toBe(false);
    await settle(later);
    expect(laterFrames.filter((frame) => frame.op === 18)).toEqual([]);
    const sessionIds = await runInDurableObject(room, (instance) =>
      [
        ...(
          instance as unknown as { sessions: Map<unknown, { id: string }> }
        ).sessions.values(),
      ].map((session) => session.id),
    );
    expect(sessionIds).toEqual([laterReady.participant_id]);

    later.close();
  });

  it("does not re-add a socket that closes while its Resume checks subscriptions", async () => {
    const gatewayName = `resume-race-${crypto.randomUUID()}`;
    const userId = `resume-race-${crypto.randomUUID()}`;
    const gateway = meetingRoom(gatewayName);
    const first = await step("open", openGatewaySocket(userId, gatewayName));
    const ready = await step("identify", identify(first));
    // A subscription for Resume to re-check against D1.
    await runInDurableObject(gateway, (instance) => {
      const live = instance as unknown as {
        sessions: Map<unknown, { subscribed_channels: string[] }>;
      };
      for (const session of live.sessions.values()) {
        session.subscribed_channels = ["resume-race-channel"];
      }
    });
    first.close();
    await step(
      "held",
      vi.waitFor(async () => {
        const held = await runInDurableObject(gateway, (instance) =>
          (
            instance as unknown as { resumableSessions: Map<string, unknown> }
          ).resumableSessions.has(ready.participant_id),
        );
        expect(held).toBe(true);
      }),
    );

    // Hold the D1 check (plain flags, as above).
    const gate = { calls: 0, released: false };
    await runInDurableObject(gateway, (instance) => {
      const live = instance as unknown as { env: { DB: D1Database } };
      const db = live.env.DB;
      const held = {
        prepare: (sql: string) => {
          const statement = db.prepare(sql);
          return {
            bind: (...values: unknown[]) => {
              const bound = statement.bind(...values);
              return {
                first: async () => {
                  // Only Resume's channel check; the close must not wait.
                  if (sql.includes("FROM channels WHERE id")) {
                    gate.calls += 1;
                    while (!gate.released) {
                      await new Promise((resolve) => setTimeout(resolve, 5));
                    }
                  }
                  return bound.first();
                },
                all: () => bound.all(),
                run: () => bound.run(),
              };
            },
          };
        },
      };
      live.env = { ...live.env, DB: held as unknown as D1Database };
    });

    const resuming = await step(
      "open2",
      openGatewaySocket(userId, gatewayName),
    );
    resuming.send(
      JSON.stringify({
        op: 7,
        d: { session_id: ready.participant_id, seq_ack: 0 },
      }),
    );
    await step(
      "gate",
      vi.waitFor(() => expect(gate.calls).toBeGreaterThan(0)),
    );
    const closed = closeOf(resuming);
    resuming.close(1000, "network drop");
    await step("closed", closed);
    gate.released = true;

    await vi.waitFor(async () => {
      const state = await runInDurableObject(gateway, (instance) => {
        const live = instance as unknown as {
          sessions: Map<unknown, { id: string }>;
          resumableSessions: Map<string, unknown>;
          resumingSockets: Set<unknown>;
          channelSubscriptions: Map<string, Set<unknown>>;
        };
        return {
          live: [...live.sessions.values()].map((session) => session.id),
          held: live.resumableSessions.has(ready.participant_id),
          resuming: live.resumingSockets.size,
          subscribers:
            live.channelSubscriptions.get("resume-race-channel")?.size ?? 0,
        };
      });
      expect(state).toEqual({
        live: [],
        held: true,
        resuming: 0,
        subscribers: 0,
      });
    });
  });
});
