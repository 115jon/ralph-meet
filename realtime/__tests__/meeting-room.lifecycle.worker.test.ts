import { env } from "cloudflare:workers";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import {
  issueSocketTicket,
  verifySocketTicket,
} from "../../src/lib/voice/socket-ticket";
import {
  appendRealtimeAdmissionHeaders,
  createRealtimeAdmissionContext,
} from "../realtime-admission";
import { PERMISSIONS } from "../../src/lib/permissions";
import {
  GatewayOp,
  HEARTBEAT_FRAME,
  mainGatewayClientRules,
} from "../../src/lib/gateway-protocol";
import type { IceServer } from "../meeting-room/turn-credentials";
import { SOCKET_ROLE_OPCODES } from "../socket-core";
import { VOICE_ROSTER_PATH } from "../voice-roster";

async function createAdmissionHeaders(
  roomName: string,
  audience: "global" | "room",
  subject = "user-test",
  nonce: string = crypto.randomUUID(),
) {
  const roomSlug = audience === "global" ? "global-gateway" : roomName;
  const ticket = await issueSocketTicket(
    {
      accessMode: "authenticated",
      audience,
      expiresAt: Date.now() + 60_000,
      nonce,
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

async function createVoiceAdmissionHeaders(
  roomName: string,
  subject = "user-test",
) {
  const ticket = await issueSocketTicket(
    {
      accessMode: "authenticated",
      audience: "voice",
      expiresAt: Date.now() + 60_000,
      nonce: crypto.randomUUID(),
      roomSlug: roomName,
      subject,
    },
    env.CALLS_APP_SECRET,
  );
  const verification = await verifySocketTicket(ticket, env.CALLS_APP_SECRET, {
    accessMode: "authenticated",
    audience: "voice",
    now: Date.now(),
    roomSlug: roomName,
  });
  if (!verification.ok) throw new Error("Expected voice test ticket to verify");
  return appendRealtimeAdmissionHeaders(
    new Headers({ Upgrade: "websocket" }),
    await createRealtimeAdmissionContext(verification.claims),
  );
}

async function openMeetingSocket(
  roomName: string = crypto.randomUUID(),
  subject = "user-test",
  nonce: string = crypto.randomUUID(),
): Promise<WebSocket> {
  const roomId = env.MEETING_ROOM.idFromName(roomName);
  const room = env.MEETING_ROOM.get(roomId);
  const response = await room.fetch(
    `https://internal/api/channels/${roomName}/ws?v=1`,
    {
      headers: await createAdmissionHeaders(roomName, "room", subject, nonce),
    },
  );

  expect(response.status).toBe(101);
  expect(response.webSocket).not.toBeNull();

  const socket = response.webSocket;
  if (!socket) {
    throw new Error("Expected WebSocket upgrade response");
  }

  socket.accept();
  await nextMessageWithOpcode(socket, 8);
  return socket;
}

// The global gateway allows several chat sessions per user; channel rooms
// allow only one non-standby session per user (see replaceOtherVoiceSessions).
async function openGlobalSocket(
  roomName: string = crypto.randomUUID(),
  subject = "user-test",
  nonce: string = crypto.randomUUID(),
): Promise<WebSocket> {
  const room = env.MEETING_ROOM.get(env.MEETING_ROOM.idFromName(roomName));
  const response = await room.fetch("https://internal/api/gateway?v=1", {
    headers: await createAdmissionHeaders(roomName, "global", subject, nonce),
  });

  expect(response.status).toBe(101);
  const socket = response.webSocket;
  if (!socket) {
    throw new Error("Expected WebSocket upgrade response");
  }

  socket.accept();
  await nextMessageWithOpcode(socket, 8);
  return socket;
}

it("reuses the room ticket nonce for MediaReady and Ready", async () => {
  const roomName = crypto.randomUUID();
  const reservedParticipantId = crypto.randomUUID();
  const socket = await openMeetingSocket(
    roomName,
    "reserved-user",
    reservedParticipantId,
  );

  socket.send(
    JSON.stringify({
      op: 0,
      d: { name: "Reserved User" },
    }),
  );
  const mediaReady = (await nextMessageWithOpcode(socket, 41)).d as {
    participant_id: string;
  };
  const ready = (await nextMessageWithOpcode(socket, 2)).d as {
    participant_id: string;
  };

  expect(mediaReady.participant_id).toBe(reservedParticipantId);
  expect(ready.participant_id).toBe(reservedParticipantId);
  socket.close(1000, "test complete");
});

async function nextJsonMessage(
  socket: WebSocket,
): Promise<{ op: number; d: unknown }> {
  const message = await new Promise<MessageEvent<string>>((resolve) => {
    socket.addEventListener("message", resolve, { once: true });
  });
  return JSON.parse(message.data) as { op: number; d: unknown };
}

async function identifyMeetingSocket(
  socket: WebSocket,
  profile: {
    name?: string;
    username?: string;
    display_name?: string | null;
    avatar_url?: string | null;
    avatar_display?: string | null;
    supports_voice_state_deltas?: boolean;
  } = {},
) {
  const response = nextMessageWithOpcode(socket, 2);
  socket.send(
    JSON.stringify({
      op: 0,
      d: {
        name: profile.name ?? "Test User",
        username: profile.username,
        display_name: profile.display_name,
        avatar_url: profile.avatar_url,
        avatar_display: profile.avatar_display,
        supports_voice_state_deltas: profile.supports_voice_state_deltas,
      },
    }),
  );
  return (await response).d as {
    participant_id: string;
    voice_token: string;
    participants: Array<Record<string, unknown>>;
  };
}

async function issueVoiceTokenForTest(
  participantId: string,
  roomName: string,
  subject: string,
  timestamp: number,
) {
  const payload = `${participantId}:${roomName}:${timestamp}:${subject}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.CALLS_APP_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  return `${payload}.${btoa(String.fromCharCode(...new Uint8Array(signature)))}`;
}

async function nextMessageWithOpcode(socket: WebSocket, opcode: number) {
  while (true) {
    const message = await nextJsonMessage(socket);
    if (message.op === opcode) return message;
  }
}

async function nextMessageWithOpcodeMatching(
  socket: WebSocket,
  opcode: number,
  predicate: (message: { op: number; d: unknown }) => boolean,
) {
  while (true) {
    const message = await nextMessageWithOpcode(socket, opcode);
    if (predicate(message)) return message;
  }
}

async function nextMessageWithOpcodeWithin(
  socket: WebSocket,
  opcode: number,
  timeoutMs = 1_000,
) {
  return Promise.race([
    nextMessageWithOpcode(socket, opcode),
    new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error(`Timed out waiting for opcode ${opcode}`)),
        timeoutMs,
      );
    }),
  ]);
}

async function messagesThroughOpcode(socket: WebSocket, opcode: number) {
  return new Promise<Array<{ op: number; d: unknown }>>((resolve) => {
    const messages: Array<{ op: number; d: unknown }> = [];
    const onMessage = (event: MessageEvent<string>) => {
      const message = JSON.parse(event.data) as { op: number; d: unknown };
      messages.push(message);
      if (message.op !== opcode) return;
      socket.removeEventListener("message", onMessage);
      resolve(messages);
    };
    socket.addEventListener("message", onMessage);
  });
}

async function nextDispatchEvent(socket: WebSocket, eventName: string) {
  while (true) {
    const message = await nextJsonMessage(socket);
    if (
      message.op === 19 &&
      (message.d as { event?: unknown } | null)?.event === eventName
    )
      return message;
  }
}

async function nextDispatchEventMatching(
  socket: WebSocket,
  eventName: string,
  predicate: (message: { op: number; d: unknown }) => boolean,
) {
  while (true) {
    const message = await nextDispatchEvent(socket, eventName);
    if (predicate(message)) return message;
  }
}

function meetingRoom(roomName: string) {
  return env.MEETING_ROOM.get(env.MEETING_ROOM.idFromName(roomName));
}

/** A roster member as a channel's room reports it (realtime/voice-roster). */
function rosterMember(userId: string, overrides: Record<string, unknown> = {}) {
  return {
    user_id: userId,
    name: userId,
    username: userId,
    display_name: null,
    avatar_url: null,
    avatar_display: null,
    stream_preview_url: null,
    connected: true,
    connection_state: "connected",
    disconnected_at: null,
    reconnect_expires_at: null,
    self_mute: true,
    self_deaf: false,
    self_video: false,
    self_stream: false,
    self_stream_audio: false,
    spatial_audio_enabled: false,
    spatial_audio_high_fidelity: false,
    joined_at: 1_700_000_000_000,
    ...overrides,
  };
}

let rosterSeq = 0;
/**
 * Pushes a channel's roster to a global gateway object the way the
 * channel's room does: the only way a sidebar member appears or goes.
 */
async function pushRoster(
  gatewayName: string,
  channelId: string,
  members: Array<Record<string, unknown>>,
) {
  rosterSeq += 1;
  const response = await meetingRoom(gatewayName).fetch(
    `https://internal${VOICE_ROSTER_PATH}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel_id: channelId,
        room_slug: `room-of-${channelId}`,
        seq: Date.now() * 1000 + rosterSeq,
        started_at: members.length > 0 ? 1_700_000_000_000 : null,
        members,
      }),
    },
  );
  expect(response.status).toBe(200);
}

/**
 * ServerSubscribe has no acknowledgement and checks membership in D1, so wait
 * until the room has registered the expected subscribers instead of sleeping.
 */
async function waitForServerSubscribers(
  roomName: string,
  serverId: string,
  count: number,
) {
  await vi.waitFor(
    async () => {
      const size = await runInDurableObject(
        meetingRoom(roomName),
        (instance) =>
          (
            instance as unknown as {
              serverSubscriptions: Map<string, Set<unknown>>;
            }
          ).serverSubscriptions.get(serverId)?.size ?? 0,
      );
      expect(size).toBe(count);
    },
    { timeout: 5_000, interval: 5 },
  );
}

/** Waits until a closed socket's session is held for resume. */
async function waitForResumableSession(roomName: string, sessionId: string) {
  await vi.waitFor(
    async () => {
      const resumable = await runInDurableObject(
        meetingRoom(roomName),
        (instance) =>
          (
            instance as unknown as {
              resumableSessions: Map<string, unknown>;
            }
          ).resumableSessions.has(sessionId),
      );
      expect(resumable).toBe(true);
    },
    { timeout: 5_000, interval: 5 },
  );
}

async function hasMessageWithOpcode(
  socket: WebSocket,
  opcode: number,
  timeoutMs = 75,
): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      socket.removeEventListener("message", onMessage);
      resolve(false);
    }, timeoutMs);
    const onMessage = (event: MessageEvent<string>) => {
      const message = JSON.parse(event.data) as { op: number };
      if (message.op !== opcode) return;
      clearTimeout(timer);
      socket.removeEventListener("message", onMessage);
      resolve(true);
    };
    socket.addEventListener("message", onMessage);
  });
}

describe("MeetingRoom lifecycle", () => {
  // The DM list and friends list are only right if the client knows who is
  // connected before it opens any channel (ChannelSubscribe also sends one).
  it("sends the presence list on identify, before any channel subscribe", async () => {
    const roomName = crypto.randomUUID();
    const present = await openGlobalSocket(roomName, "present-user");
    await identifyMeetingSocket(present, { name: "Present" });

    const joining = await openGlobalSocket(roomName, "joining-user");
    const presenceList = nextDispatchEvent(joining, "PRESENCE_LIST");
    await identifyMeetingSocket(joining, { name: "Joining" });

    const data = (
      (await presenceList).d as {
        data: {
          user_ids: string[];
          users: Array<{ user_id: string; status: string }>;
        };
      }
    ).data;
    expect(data.user_ids).toEqual(
      expect.arrayContaining(["present-user", "joining-user"]),
    );
    expect(data.users).toContainEqual(
      expect.objectContaining({ user_id: "present-user", status: "online" }),
    );

    present.close(1000, "test complete");
    joining.close(1000, "test complete");
  });

  it("hides a standby identify until the session is promoted", async () => {
    const roomName = crypto.randomUUID();
    const seated = await openMeetingSocket(roomName, "seated-user");
    const seatedReady = await identifyMeetingSocket(seated, {
      name: "Seated",
    });
    const rosterJoin = hasMessageWithOpcode(seated, 15, 200);
    const warming = await openMeetingSocket(roomName, "warming-user");
    const warmingReadyPromise = nextMessageWithOpcode(warming, 2);
    warming.send(
      JSON.stringify({
        op: 0,
        d: { name: "Warming", standby: true },
      }),
    );
    const warmingReady = (await warmingReadyPromise).d as {
      participant_id: string;
      participants: Array<{ id?: string }>;
    };

    expect(await rosterJoin).toBe(false);
    expect(
      warmingReady.participants.map((participant) => participant.id),
    ).toContain(seatedReady.participant_id);

    const late = await openMeetingSocket(roomName, "late-user");
    const lateReady = await identifyMeetingSocket(late, { name: "Late" });
    expect(
      lateReady.participants.map((participant) => participant.id),
    ).toContain(seatedReady.participant_id);
    expect(
      lateReady.participants.map((participant) => participant.id),
    ).not.toContain(warmingReady.participant_id);

    const promoted = nextMessageWithOpcodeMatching(seated, 15, (message) => {
      const participant = (
        message.d as { participant?: { id?: string }; action?: string }
      ).participant;
      return participant?.id === warmingReady.participant_id;
    });
    warming.send(
      JSON.stringify({
        op: 15,
        d: { promote_standby: true, self_mute: false, self_deaf: false },
      }),
    );
    expect((await promoted).d).toEqual(
      expect.objectContaining({
        action: "join",
        participant: expect.objectContaining({
          id: warmingReady.participant_id,
          self_mute: false,
          self_deaf: false,
        }),
      }),
    );

    seated.close(1000, "test complete");
    warming.close(1000, "test complete");
    late.close(1000, "test complete");
  });

  it("does not announce a standby session that leaves before promotion", async () => {
    const roomName = crypto.randomUUID();
    const seated = await openMeetingSocket(roomName, "seated-user");
    await identifyMeetingSocket(seated, { name: "Seated" });
    const warming = await openMeetingSocket(roomName, "warming-user");
    const warmingReady = nextMessageWithOpcode(warming, 2);
    warming.send(
      JSON.stringify({
        op: 0,
        d: { name: "Warming", standby: true },
      }),
    );
    await warmingReady;

    const rosterChange = hasMessageWithOpcode(seated, 15, 200);
    warming.send(JSON.stringify({ op: 11, d: {} }));
    expect(await rosterChange).toBe(false);

    seated.close(1000, "test complete");
    warming.close(1000, "test complete");
  });

  it("negotiates participant updates for mixed capable and legacy recipients", async () => {
    const roomName = crypto.randomUUID();
    const capable = await openMeetingSocket(roomName, "profile-capable");
    await identifyMeetingSocket(capable, {
      name: "Capable Name",
      username: "capable-user",
      display_name: "Capable Display",
      avatar_url: "https://example.com/capable.png",
      avatar_display: "frame:capable",
      supports_voice_state_deltas: true,
    });

    const capableJoin = nextMessageWithOpcode(capable, 15);
    const legacy = await openMeetingSocket(roomName, "profile-legacy");
    const legacyJoin = nextMessageWithOpcode(legacy, 15);
    await identifyMeetingSocket(legacy, {
      name: "Legacy Name",
      username: "legacy-user",
      display_name: "Legacy Display",
      avatar_url: "https://example.com/legacy.png",
      avatar_display: "frame:legacy",
    });
    const sender = await openMeetingSocket(roomName, "profile-sender");
    const senderReady = await identifyMeetingSocket(sender, {
      name: "Sender Name",
      username: "sender-user",
      display_name: "Sender Display",
      avatar_url: "https://example.com/sender.png",
      avatar_display: "frame:sender",
    });
    await capableJoin;
    await legacyJoin;

    expect(senderReady.participants).toEqual([
      expect.objectContaining({ name: "Capable Name" }),
      expect.objectContaining({ name: "Legacy Name" }),
    ]);

    const capableUpdate = nextMessageWithOpcode(capable, 15);
    const legacyUpdate = nextMessageWithOpcode(legacy, 15);
    sender.send(JSON.stringify({ op: 15, d: { self_mute: false } }));
    const [capablePayload, legacyPayload] = await Promise.all([
      capableUpdate,
      legacyUpdate,
    ]);

    expect(capablePayload.d).toEqual({
      seq: expect.any(Number),
      action: "update",
      participant: {
        id: senderReady.participant_id,
        user_id: "profile-sender",
        platform: "web",
        stream_preview_url: null,
        self_mute: false,
        self_deaf: false,
        self_stream: false,
        self_stream_audio: false,
        self_video: false,
        spatial_audio_enabled: false,
        spatial_audio_high_fidelity: false,
        suppress: false,
        status: "online",
        tracks: [],
      },
    });
    expect(legacyPayload.d).toEqual({
      seq: expect.any(Number),
      action: "update",
      participant: {
        id: senderReady.participant_id,
        user_id: "profile-sender",
        name: "Sender Name",
        username: "sender-user",
        display_name: "Sender Display",
        avatar_url: "https://example.com/sender.png",
        avatar_display: "frame:sender",
        platform: "web",
        stream_preview_url: null,
        self_mute: false,
        self_deaf: false,
        self_stream: false,
        self_stream_audio: false,
        self_video: false,
        spatial_audio_enabled: false,
        spatial_audio_high_fidelity: false,
        suppress: false,
        status: "online",
        tracks: [],
      },
    });

    capable.close();
    legacy.close();
    sender.close();
  });

  it("replays recipient-specific capable and legacy participant updates in sequence", async () => {
    const roomName = crypto.randomUUID();
    const capable = await openMeetingSocket(roomName, "replay-capable");
    const capableReady = await identifyMeetingSocket(capable, {
      supports_voice_state_deltas: true,
    });
    const capableSenderJoin = nextMessageWithOpcode(capable, 15);
    const legacy = await openMeetingSocket(roomName, "replay-legacy");
    const legacySenderJoin = nextMessageWithOpcode(legacy, 15);
    const legacyReady = await identifyMeetingSocket(legacy);
    const sender = await openMeetingSocket(roomName, "replay-sender");
    const senderReady = await identifyMeetingSocket(sender, {
      name: "Replay Sender",
      username: "replay-sender",
      display_name: "Replay Display",
      avatar_url: "https://example.com/replay.png",
      avatar_display: "frame:replay",
    });
    await capableSenderJoin;
    await legacySenderJoin;

    capable.close();
    await new Promise((resolve) => setTimeout(resolve, 20));
    legacy.close();
    await new Promise((resolve) => setTimeout(resolve, 20));
    sender.send(JSON.stringify({ op: 15, d: { self_mute: false } }));
    await new Promise((resolve) => setTimeout(resolve, 20));

    const resumedCapable = await openMeetingSocket(roomName, "replay-capable");
    const capableMessagesPromise = messagesThroughOpcode(resumedCapable, 9);
    resumedCapable.send(
      JSON.stringify({
        op: 7,
        d: { session_id: capableReady.participant_id, seq_ack: 0 },
      }),
    );
    const capableMessages = await capableMessagesPromise;

    const resumedLegacy = await openMeetingSocket(roomName, "replay-legacy");
    const legacyMessagesPromise = messagesThroughOpcode(resumedLegacy, 9);
    resumedLegacy.send(
      JSON.stringify({
        op: 7,
        d: { session_id: legacyReady.participant_id, seq_ack: 0 },
      }),
    );
    const legacyMessages = await legacyMessagesPromise;

    const capableReplay = capableMessages.find(
      (message) =>
        message.op === 15 &&
        (message.d as { action?: string }).action === "update",
    );
    const legacyReplay = legacyMessages.find(
      (message) =>
        message.op === 15 &&
        (message.d as { action?: string }).action === "update",
    );
    expect(capableReplay?.d).toEqual({
      seq: 6,
      action: "update",
      participant: {
        id: senderReady.participant_id,
        user_id: "replay-sender",
        platform: "web",
        stream_preview_url: null,
        self_mute: false,
        self_deaf: false,
        self_stream: false,
        self_stream_audio: false,
        self_video: false,
        spatial_audio_enabled: false,
        spatial_audio_high_fidelity: false,
        suppress: false,
        status: "online",
        tracks: [],
      },
    });
    expect(legacyReplay?.d).toEqual({
      seq: 4,
      action: "update",
      participant: {
        id: senderReady.participant_id,
        user_id: "replay-sender",
        name: "Replay Sender",
        username: "replay-sender",
        display_name: "Replay Display",
        avatar_url: "https://example.com/replay.png",
        avatar_display: "frame:replay",
        platform: "web",
        stream_preview_url: null,
        self_mute: false,
        self_deaf: false,
        self_stream: false,
        self_stream_audio: false,
        self_video: false,
        spatial_audio_enabled: false,
        spatial_audio_high_fidelity: false,
        suppress: false,
        status: "online",
        tracks: [],
      },
    });
    expect(
      capableMessages
        .filter(
          (message) => typeof (message.d as { seq?: unknown }).seq === "number",
        )
        .map((message) => (message.d as { seq: number }).seq),
    ).toEqual([1, 2, 3, 4, 5, 6]);
    expect(
      legacyMessages
        .filter(
          (message) => typeof (message.d as { seq?: unknown }).seq === "number",
        )
        .map((message) => (message.d as { seq: number }).seq),
      // 5: the capable session resuming first is re-announced in full.
    ).toEqual([1, 2, 3, 4, 5]);
    expect(
      legacyMessages.find(
        (message) =>
          (message.d as { seq?: number }).seq === 5 &&
          (message.d as { action?: string }).action === "update",
      )?.d,
    ).toMatchObject({
      participant: { id: capableReady.participant_id, name: "Test User" },
    });

    sender.close();
    resumedCapable.close();
    resumedLegacy.close();
  });

  it("serializes explicit nulls in a dedicated ProfileUpdate", async () => {
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL, display_name TEXT, avatar_url TEXT, avatar_display TEXT)",
    ).run();
    const userId = `profile-refresh-${crypto.randomUUID()}`;
    await env.DB.prepare(
      "INSERT INTO users (id, username, display_name, avatar_url, avatar_display) VALUES (?, ?, NULL, NULL, NULL)",
    )
      .bind(userId, "profile-refresh-user")
      .run();
    const roomName = crypto.randomUUID();
    const source = await openMeetingSocket(roomName, userId);
    const ready = await identifyMeetingSocket(source);
    const observer = await openMeetingSocket(roomName, "profile-observer");
    await identifyMeetingSocket(observer);

    const profileUpdate = nextMessageWithOpcode(observer, 16);
    source.send(JSON.stringify({ op: 17, d: {} }));

    await expect(profileUpdate).resolves.toMatchObject({
      op: 16,
      d: {
        display_name: null,
        avatar_url: null,
        avatar_display: null,
      },
    });

    const legacyUpdate = nextMessageWithOpcode(observer, 15);
    source.send(JSON.stringify({ op: 15, d: { self_mute: false } }));
    await expect(legacyUpdate).resolves.toMatchObject({
      op: 15,
      d: {
        action: "update",
        participant: {
          id: ready.participant_id,
          avatar_url: null,
          self_mute: false,
        },
      },
    });

    source.close();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const resumed = await openMeetingSocket(roomName, userId);
    const resumedResponse = nextMessageWithOpcode(resumed, 9);
    resumed.send(
      JSON.stringify({
        op: 7,
        d: { session_id: ready.participant_id, seq_ack: 0 },
      }),
    );
    const resumedPayload = await resumedResponse;
    const resumedParticipant = (
      resumedPayload.d as { participants: Array<Record<string, unknown>> }
    ).participants.find(
      (participant) => participant.id === ready.participant_id,
    );
    expect(resumedParticipant).toMatchObject({ avatar_url: null });

    observer.close();
    resumed.close();
  });

  it("retains profile fields in a resumed full participant snapshot", async () => {
    const roomName = crypto.randomUUID();
    const original = await openMeetingSocket(roomName, "resume-profile");
    const ready = await identifyMeetingSocket(original, {
      name: "Resume Name",
      username: "resume-user",
      display_name: "Resume Display",
      avatar_url: "https://example.com/resume.png",
      avatar_display: "frame:resume",
    });
    original.close();

    const resumed = await openMeetingSocket(roomName, "resume-profile");
    const response = nextMessageWithOpcode(resumed, 9);
    resumed.send(
      JSON.stringify({
        op: 7,
        d: { session_id: ready.participant_id, seq_ack: 0 },
      }),
    );

    const resumedPayload = await response;
    expect(resumedPayload).toMatchObject({
      op: 9,
      d: {
        participants: [
          expect.objectContaining({
            name: "Resume Name",
            username: "resume-user",
            display_name: "Resume Display",
            avatar_url: "https://example.com/resume.png",
            avatar_display: "frame:resume",
          }),
        ],
      },
    });

    resumed.close();
  });

  it("preserves a newer shared profile when a stale session resumes", async () => {
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL, display_name TEXT, avatar_url TEXT, avatar_display TEXT)",
    ).run();
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS channels (id TEXT PRIMARY KEY, server_id TEXT, channel_type TEXT NOT NULL)",
    ).run();
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS dm_recipients (channel_id TEXT NOT NULL, user_id TEXT NOT NULL)",
    ).run();

    const userId = `resume-convergence-${crypto.randomUUID()}`;
    const channelId = `resume-channel-${crypto.randomUUID()}`;
    await env.DB.prepare(
      "INSERT INTO users (id, username, display_name, avatar_url, avatar_display) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(
        userId,
        "old-user",
        "Old Display",
        "https://example.com/old.png",
        "frame:old",
      )
      .run();
    await env.DB.prepare(
      "INSERT INTO channels (id, server_id, channel_type) VALUES (?, NULL, 'dm')",
    )
      .bind(channelId)
      .run();
    await env.DB.prepare(
      "INSERT INTO dm_recipients (channel_id, user_id) VALUES (?, ?)",
    )
      .bind(channelId, userId)
      .run();

    const roomName = crypto.randomUUID();
    // `fresh` is a second session of the user that is not in voice. A member
    // stays connected while another session of the user is in its channel, so
    // only the stale session can put it into reconnecting.
    const fresh = await openGlobalSocket(roomName, userId);
    await identifyMeetingSocket(fresh);

    const stale = await openGlobalSocket(roomName, userId);
    const staleReady = await identifyMeetingSocket(stale);
    // The room reports the stale session's identity, as it has it.
    const staleIdentity = {
      name: "Old Display",
      username: "old-user",
      display_name: "Old Display",
      avatar_url: "https://example.com/old.png",
      avatar_display: "frame:old",
    };
    const staleJoin = nextDispatchEvent(fresh, "VOICE_CHANNEL_STATE_UPDATE");
    await pushRoster(roomName, channelId, [
      rosterMember(userId, staleIdentity),
    ]);
    await staleJoin;

    await env.DB.prepare(
      "UPDATE users SET username = ?, display_name = ?, avatar_url = ?, avatar_display = ? WHERE id = ?",
    )
      .bind(
        "new-user",
        "New Display",
        "https://example.com/new.png",
        "frame:new",
        userId,
      )
      .run();
    const refreshed = nextDispatchEventMatching(
      fresh,
      "VOICE_CHANNEL_STATE_UPDATE",
      (message) =>
        (
          message.d as {
            data?: { members?: Array<Record<string, unknown>> };
          }
        ).data?.members?.some((member) => member.name === "New Display") ??
        false,
    );
    const staleProfileUpdate = nextMessageWithOpcodeMatching(
      stale,
      16,
      (message) =>
        (message.d as { participant_id?: string }).participant_id ===
        staleReady.participant_id,
    );
    fresh.send(JSON.stringify({ op: 17, d: {} }));
    await expect(refreshed).resolves.toMatchObject({
      d: {
        data: {
          members: [
            expect.objectContaining({
              name: "New Display",
              username: "new-user",
              display_name: "New Display",
              avatar_url: "https://example.com/new.png",
              avatar_display: "frame:new",
            }),
          ],
        },
      },
    });
    await expect(staleProfileUpdate).resolves.toMatchObject({
      d: {
        participant_id: staleReady.participant_id,
        name: "New Display",
        username: "new-user",
        display_name: "New Display",
        avatar_url: "https://example.com/new.png",
        avatar_display: "frame:new",
      },
    });

    const staleDisconnect = nextDispatchEventMatching(
      fresh,
      "VOICE_CHANNEL_STATE_UPDATE",
      (message) =>
        (
          message.d as {
            data?: { members?: Array<Record<string, unknown>> };
          }
        ).data?.members?.some(
          (member) =>
            member.name === "New Display" &&
            member.connection_state === "reconnecting",
        ) ?? false,
    );
    stale.close();
    // The room holds the session for resume; it still has the old identity.
    await pushRoster(roomName, channelId, [
      rosterMember(userId, {
        ...staleIdentity,
        connected: false,
        connection_state: "reconnecting",
        disconnected_at: Date.now(),
        reconnect_expires_at: Date.now() + 120_000,
      }),
    ]);
    await staleDisconnect;

    const resumed = await openGlobalSocket(roomName, userId);
    const resumedSidebar = nextDispatchEventMatching(
      resumed,
      "VOICE_CHANNEL_STATE_UPDATE",
      (message) =>
        (
          message.d as {
            data?: { members?: Array<Record<string, unknown>> };
          }
        ).data?.members?.some(
          (member) =>
            member.name === "New Display" &&
            member.connection_state === "connected",
        ) ?? false,
    );
    const resumedResponse = nextMessageWithOpcode(resumed, 9);
    resumed.send(
      JSON.stringify({
        op: 7,
        d: { session_id: staleReady.participant_id, seq_ack: 0 },
      }),
    );

    const resumedPayload = await resumedResponse;
    await pushRoster(roomName, channelId, [
      rosterMember(userId, staleIdentity),
    ]);
    const resumedParticipant = (
      resumedPayload.d as { participants: Array<Record<string, unknown>> }
    ).participants.find(
      (participant) => participant.id === staleReady.participant_id,
    );
    expect(resumedParticipant).toMatchObject({
      name: "New Display",
      username: "new-user",
      display_name: "New Display",
      avatar_url: "https://example.com/new.png",
      avatar_display: "frame:new",
    });
    await expect(resumedSidebar).resolves.toMatchObject({
      d: {
        data: {
          channel_id: channelId,
          members: [
            expect.objectContaining({
              user_id: userId,
              name: "New Display",
              username: "new-user",
              display_name: "New Display",
              avatar_url: "https://example.com/new.png",
              avatar_display: "frame:new",
            }),
          ],
        },
      },
    });

    const resumedUpdate = nextMessageWithOpcode(fresh, 15);
    const resumedState = nextDispatchEventMatching(
      fresh,
      "VOICE_CHANNEL_STATE_UPDATE",
      (message) =>
        (
          message.d as {
            data?: { members?: Array<Record<string, unknown>> };
          }
        ).data?.members?.some(
          (member) =>
            member.name === "New Display" && member.self_mute === false,
        ) ?? false,
    );
    resumed.send(JSON.stringify({ op: 15, d: { self_mute: false } }));
    // The sidebar takes mute from the room's roster, not this op 15.
    await pushRoster(roomName, channelId, [
      rosterMember(userId, { ...staleIdentity, self_mute: false }),
    ]);
    await expect(resumedUpdate).resolves.toMatchObject({
      d: {
        action: "update",
        participant: {
          id: staleReady.participant_id,
          name: "New Display",
          username: "new-user",
          display_name: "New Display",
          avatar_url: "https://example.com/new.png",
          avatar_display: "frame:new",
          self_mute: false,
        },
      },
    });
    await expect(resumedState).resolves.toMatchObject({
      d: {
        data: {
          members: [
            expect.objectContaining({
              name: "New Display",
              username: "new-user",
              display_name: "New Display",
              avatar_url: "https://example.com/new.png",
              avatar_display: "frame:new",
              self_mute: false,
            }),
          ],
        },
      },
    });

    fresh.close();
    resumed.close();
  });

  it("reconciles every voice channel before a stale session can restore its old profile", async () => {
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL, display_name TEXT, avatar_url TEXT, avatar_display TEXT)",
    ).run();
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS channels (id TEXT PRIMARY KEY, server_id TEXT, channel_type TEXT NOT NULL)",
    ).run();
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS dm_recipients (channel_id TEXT NOT NULL, user_id TEXT NOT NULL)",
    ).run();

    const userId = `identify-convergence-${crypto.randomUUID()}`;
    const firstChannelId = `identify-channel-a-${crypto.randomUUID()}`;
    const secondChannelId = `identify-channel-b-${crypto.randomUUID()}`;
    await env.DB.prepare(
      "INSERT INTO users (id, username, display_name, avatar_url, avatar_display) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(
        userId,
        "old-user",
        "Old Display",
        "https://example.com/old.png",
        "frame:old",
      )
      .run();
    await env.DB.prepare(
      "INSERT INTO channels (id, server_id, channel_type) VALUES (?, NULL, 'dm'), (?, NULL, 'dm')",
    )
      .bind(firstChannelId, secondChannelId)
      .run();
    await env.DB.prepare(
      "INSERT INTO dm_recipients (channel_id, user_id) VALUES (?, ?), (?, ?)",
    )
      .bind(firstChannelId, userId, secondChannelId, userId)
      .run();

    const roomName = crypto.randomUUID();
    const first = await openGlobalSocket(roomName, userId);
    await identifyMeetingSocket(first);
    const firstJoin = nextDispatchEventMatching(
      first,
      "VOICE_CHANNEL_STATE_UPDATE",
      (message) =>
        (message.d as { data?: { channel_id?: string } }).data?.channel_id ===
        firstChannelId,
    );
    const oldIdentity = {
      name: "Old Display",
      username: "old-user",
      display_name: "Old Display",
      avatar_url: "https://example.com/old.png",
      avatar_display: "frame:old",
    };
    await pushRoster(roomName, firstChannelId, [
      rosterMember(userId, oldIdentity),
    ]);
    await expect(firstJoin).resolves.toBeDefined();

    const stale = await openGlobalSocket(roomName, userId);
    await identifyMeetingSocket(stale);
    const secondJoin = nextDispatchEventMatching(
      stale,
      "VOICE_CHANNEL_STATE_UPDATE",
      (message) =>
        (message.d as { data?: { channel_id?: string } }).data?.channel_id ===
        secondChannelId,
    );
    await pushRoster(roomName, secondChannelId, [
      rosterMember(userId, oldIdentity),
    ]);
    await expect(secondJoin).resolves.toBeDefined();

    await env.DB.prepare(
      "UPDATE users SET username = ?, display_name = ?, avatar_url = ?, avatar_display = ? WHERE id = ?",
    )
      .bind(
        "new-user",
        "New Display",
        "https://example.com/new.png",
        "frame:new",
        userId,
      )
      .run();

    const firstReconciled = nextDispatchEventMatching(
      first,
      "VOICE_CHANNEL_STATE_UPDATE",
      (message) =>
        (
          message.d as {
            data?: {
              channel_id?: string;
              members?: Array<Record<string, unknown>>;
            };
          }
        ).data?.channel_id === firstChannelId &&
        (
          message.d as {
            data?: { members?: Array<Record<string, unknown>> };
          }
        ).data?.members?.some((member) => member.name === "New Display") ===
          true,
    );
    const secondReconciled = nextDispatchEventMatching(
      stale,
      "VOICE_CHANNEL_STATE_UPDATE",
      (message) =>
        (
          message.d as {
            data?: {
              channel_id?: string;
              members?: Array<Record<string, unknown>>;
            };
          }
        ).data?.channel_id === secondChannelId &&
        (
          message.d as {
            data?: { members?: Array<Record<string, unknown>> };
          }
        ).data?.members?.some((member) => member.name === "New Display") ===
          true,
    );
    const fresh = await openGlobalSocket(roomName, userId);
    await identifyMeetingSocket(fresh);

    await expect(firstReconciled).resolves.toMatchObject({
      d: {
        data: {
          channel_id: firstChannelId,
          members: [
            expect.objectContaining({
              name: "New Display",
              username: "new-user",
              avatar_url: "https://example.com/new.png",
              avatar_display: "frame:new",
            }),
          ],
        },
      },
    });
    await expect(secondReconciled).resolves.toMatchObject({
      d: {
        data: {
          channel_id: secondChannelId,
          members: [
            expect.objectContaining({
              name: "New Display",
              username: "new-user",
              avatar_url: "https://example.com/new.png",
              avatar_display: "frame:new",
            }),
          ],
        },
      },
    });

    const staleUpdate = nextDispatchEventMatching(
      first,
      "VOICE_CHANNEL_STATE_UPDATE",
      (message) =>
        (
          message.d as {
            data?: { members?: Array<Record<string, unknown>> };
          }
        ).data?.members?.some(
          (member) =>
            member.name === "New Display" && member.self_mute === false,
        ) === true,
    );
    // The room still reports the old identity; the sidebar keeps the new.
    await pushRoster(roomName, firstChannelId, [
      rosterMember(userId, { ...oldIdentity, self_mute: false }),
    ]);
    await expect(staleUpdate).resolves.toMatchObject({
      d: {
        data: {
          members: [
            expect.objectContaining({
              name: "New Display",
              username: "new-user",
              avatar_url: "https://example.com/new.png",
              avatar_display: "frame:new",
              self_mute: false,
            }),
          ],
        },
      },
    });

    first.close();
    stale.close();
    fresh.close();
  });

  it("propagates identify profiles across live sessions and prevents stale resume identity", async () => {
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL, display_name TEXT, avatar_url TEXT, avatar_display TEXT)",
    ).run();

    const userId = `identify-multi-session-${crypto.randomUUID()}`;
    await env.DB.prepare(
      "INSERT INTO users (id, username, display_name, avatar_url, avatar_display) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(
        userId,
        "old-user",
        "Old Display",
        "/api/avatars/old.png",
        "frame:old",
      )
      .run();

    const roomName = crypto.randomUUID();
    const first = await Promise.race([
      openGlobalSocket(roomName, userId),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("first socket timed out")), 1_000),
      ),
    ]);
    await identifyMeetingSocket(first);

    const stale = await openGlobalSocket(roomName, userId);
    const staleReady = await identifyMeetingSocket(stale);
    stale.close();
    await new Promise((resolve) => setTimeout(resolve, 20));

    const second = await openGlobalSocket(roomName, userId);
    await identifyMeetingSocket(second);

    await env.DB.prepare(
      "UPDATE users SET username = ?, display_name = ?, avatar_url = ?, avatar_display = ? WHERE id = ?",
    )
      .bind(
        "new-user",
        "New Display",
        "/api/avatars/new.png",
        "frame:new",
        userId,
      )
      .run();

    const firstProfile = nextMessageWithOpcodeMatching(
      first,
      16,
      (message) => (message.d as { name?: string }).name === "New Display",
    );
    const secondProfile = nextMessageWithOpcodeMatching(
      second,
      16,
      (message) => (message.d as { name?: string }).name === "New Display",
    );

    const identifyRefresh = await openGlobalSocket(roomName, userId);
    await identifyMeetingSocket(identifyRefresh);

    await expect(firstProfile).resolves.toMatchObject({
      d: {
        name: "New Display",
        username: "new-user",
        avatar_url: "/api/avatars/new.png",
        avatar_display: "frame:new",
      },
    });
    await expect(secondProfile).resolves.toMatchObject({
      d: {
        name: "New Display",
        username: "new-user",
        avatar_url: "/api/avatars/new.png",
        avatar_display: "frame:new",
      },
    });

    const resumed = await openGlobalSocket(roomName, userId);
    const resumedResponse = nextMessageWithOpcode(resumed, 9);
    resumed.send(
      JSON.stringify({
        op: 7,
        d: { session_id: staleReady.participant_id, seq_ack: 0 },
      }),
    );
    const resumedPayload = await resumedResponse;
    const resumedParticipant = (
      resumedPayload.d as { participants: Array<Record<string, unknown>> }
    ).participants.find(
      (participant) => participant.id === staleReady.participant_id,
    );
    expect(resumedParticipant).toMatchObject({
      name: "New Display",
      username: "new-user",
      avatar_url: "/api/avatars/new.png",
      avatar_display: "frame:new",
    });

    first.close();
    second.close();
    identifyRefresh.close();
    resumed.close();
  });

  it("negotiates compact sidebar updates while retaining full snapshots", async () => {
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS channels (id TEXT PRIMARY KEY, server_id TEXT, channel_type TEXT NOT NULL)",
    ).run();
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS dm_recipients (channel_id TEXT NOT NULL, user_id TEXT NOT NULL)",
    ).run();

    const roomName = crypto.randomUUID();
    const channelId = `dm-channel-${crypto.randomUUID()}`;
    const firstUserId = `sidebar-first-${crypto.randomUUID()}`;
    const secondUserId = `sidebar-second-${crypto.randomUUID()}`;
    await env.DB.prepare(
      "INSERT INTO channels (id, server_id, channel_type) VALUES (?, NULL, 'dm')",
    )
      .bind(channelId)
      .run();
    await env.DB.prepare(
      "INSERT INTO dm_recipients (channel_id, user_id) VALUES (?, ?), (?, ?)",
    )
      .bind(channelId, firstUserId, channelId, secondUserId)
      .run();

    const firstIdentity = {
      name: "Sidebar First",
      username: "sidebar-first",
      display_name: "Sidebar First Display",
      avatar_url: "https://example.com/sidebar-first.png",
      avatar_display: "frame:sidebar-first",
    };
    const secondIdentity = {
      name: "Sidebar Second",
      username: "sidebar-second",
      display_name: "Sidebar Second Display",
      avatar_url: "https://example.com/sidebar-second.png",
      avatar_display: "frame:sidebar-second",
    };
    const first = await openGlobalSocket(roomName, firstUserId);
    await identifyMeetingSocket(first, {
      ...firstIdentity,
      supports_voice_state_deltas: true,
    });
    await pushRoster(roomName, channelId, [
      rosterMember(firstUserId, firstIdentity),
    ]);

    const second = await openGlobalSocket(roomName, secondUserId);
    const fullSnapshot = nextDispatchEvent(second, "VOICE_CHANNEL_STATES");
    await identifyMeetingSocket(second, {
      name: "Sidebar Second",
      username: "sidebar-second",
      display_name: "Sidebar Second Display",
      avatar_url: "https://example.com/sidebar-second.png",
      avatar_display: "frame:sidebar-second",
    });
    await expect(fullSnapshot).resolves.toMatchObject({
      d: {
        data: {
          voice_states: {
            [channelId]: [
              expect.objectContaining({
                name: "Sidebar First",
                username: "sidebar-first",
                display_name: "Sidebar First Display",
                avatar_url: "https://example.com/sidebar-first.png",
                avatar_display: "frame:sidebar-first",
              }),
            ],
          },
        },
      },
    });

    const newJoin = nextDispatchEvent(first, "VOICE_CHANNEL_STATE_UPDATE");
    const secondNewJoin = nextDispatchEvent(
      second,
      "VOICE_CHANNEL_STATE_UPDATE",
    );
    await pushRoster(roomName, channelId, [
      rosterMember(firstUserId, firstIdentity),
      rosterMember(secondUserId, { ...secondIdentity, self_mute: false }),
    ]);
    await expect(newJoin).resolves.toMatchObject({
      d: {
        data: {
          members: expect.arrayContaining([
            expect.objectContaining({
              username: "sidebar-second",
              display_name: "Sidebar Second Display",
              avatar_url: "https://example.com/sidebar-second.png",
              avatar_display: "frame:sidebar-second",
            }),
          ]),
        },
      },
    });
    await secondNewJoin;

    const legacyUpdate = nextDispatchEvent(
      second,
      "VOICE_CHANNEL_STATE_UPDATE",
    );
    const capableUpdate = nextDispatchEvent(
      first,
      "VOICE_CHANNEL_STATE_UPDATE",
    );
    await pushRoster(roomName, channelId, [
      rosterMember(firstUserId, { ...firstIdentity, self_mute: false }),
      rosterMember(secondUserId, { ...secondIdentity, self_mute: false }),
    ]);
    const [legacyPayload, capablePayload] = await Promise.all([
      legacyUpdate,
      capableUpdate,
    ]);
    const legacyMembers = (
      legacyPayload.d as {
        data: { members: Array<Record<string, unknown>> };
      }
    ).data.members;
    const legacyMember = legacyMembers.find(
      (member) => member.user_id === firstUserId,
    );
    expect(legacyMember).toMatchObject({
      self_mute: false,
      name: "Sidebar First",
      username: "sidebar-first",
      display_name: "Sidebar First Display",
      avatar_url: "https://example.com/sidebar-first.png",
      avatar_display: "frame:sidebar-first",
    });

    const capableMembers = (
      capablePayload.d as {
        data: { members: Array<Record<string, unknown>> };
      }
    ).data.members;
    const capableMember = capableMembers.find(
      (member) => member.user_id === firstUserId,
    );
    expect(capableMember).toMatchObject({ self_mute: false });
    expect(capableMember).not.toHaveProperty("name");
    expect(capableMember).not.toHaveProperty("username");
    expect(capableMember).not.toHaveProperty("display_name");
    expect(capableMember).not.toHaveProperty("avatar_url");
    expect(capableMember).not.toHaveProperty("avatar_display");

    first.close();
    second.close();
  });

  it("sends full profiles when a call's room roster inserts a new sidebar member", async () => {
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS channels (id TEXT PRIMARY KEY, server_id TEXT, channel_type TEXT NOT NULL)",
    ).run();
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS dm_recipients (channel_id TEXT NOT NULL, user_id TEXT NOT NULL)",
    ).run();
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS relationships (user_id TEXT NOT NULL, target_user_id TEXT NOT NULL, type INTEGER NOT NULL)",
    ).run();

    const roomName = crypto.randomUUID();
    const channelId = `call-profile-${crypto.randomUUID()}`;
    const callerId = `call-caller-${crypto.randomUUID()}`;
    const calleeId = `call-callee-${crypto.randomUUID()}`;
    await env.DB.prepare(
      "INSERT INTO channels (id, server_id, channel_type) VALUES (?, NULL, 'dm')",
    )
      .bind(channelId)
      .run();
    await env.DB.prepare(
      "INSERT INTO dm_recipients (channel_id, user_id) VALUES (?, ?), (?, ?)",
    )
      .bind(channelId, callerId, channelId, calleeId)
      .run();

    const callerIdentity = {
      name: "Call Caller",
      username: "call-caller",
      display_name: "Call Caller Display",
      avatar_url: "https://example.com/call-caller.png",
      avatar_display: "frame:call-caller",
    };
    const caller = await openGlobalSocket(roomName, callerId);
    await identifyMeetingSocket(caller, callerIdentity);
    const callee = await openGlobalSocket(roomName, calleeId);
    await identifyMeetingSocket(callee, {
      supports_voice_state_deltas: true,
    });

    const sidebarUpdate = nextDispatchEventMatching(
      callee,
      "VOICE_CHANNEL_STATE_UPDATE",
      (message) =>
        (
          message.d as {
            data?: { members?: Array<Record<string, unknown>> };
          }
        ).data?.members?.some((member) => member.user_id === callerId) ?? false,
    );
    const ringing = nextDispatchEvent(caller, "CALL_RINGING");
    caller.send(
      JSON.stringify({
        op: 36,
        d: { target_user_id: calleeId, channel_id: channelId },
      }),
    );
    await ringing;
    // Ringing alone puts nobody on the sidebar: the caller shows once their
    // client is in the DM's voice room, which reports them.
    expect(
      await runInDurableObject(meetingRoom(roomName), (instance) =>
        (
          instance as unknown as {
            voiceChannelMembers: Map<string, unknown>;
          }
        ).voiceChannelMembers.has(channelId),
      ),
    ).toBe(false);
    await pushRoster(roomName, channelId, [
      rosterMember(callerId, callerIdentity),
    ]);

    await expect(sidebarUpdate).resolves.toMatchObject({
      d: {
        data: {
          channel_id: channelId,
          members: [
            expect.objectContaining({
              user_id: callerId,
              name: "Call Caller",
              username: "call-caller",
              display_name: "Call Caller Display",
              avatar_url: "https://example.com/call-caller.png",
              avatar_display: "frame:call-caller",
            }),
          ],
        },
      },
    });

    caller.close();
    callee.close();
  });

  it("persists pending calls and expires them through the durable alarm", async () => {
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS channels (id TEXT PRIMARY KEY, server_id TEXT, channel_type TEXT NOT NULL)",
    ).run();
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS dm_recipients (channel_id TEXT NOT NULL, user_id TEXT NOT NULL)",
    ).run();
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS relationships (user_id TEXT NOT NULL, target_user_id TEXT NOT NULL, type INTEGER NOT NULL)",
    ).run();

    const roomName = crypto.randomUUID();
    const channelId = `call-persistence-${crypto.randomUUID()}`;
    const callerId = `call-persist-caller-${crypto.randomUUID()}`;
    const calleeId = `call-persist-callee-${crypto.randomUUID()}`;
    await env.DB.prepare(
      "INSERT INTO channels (id, server_id, channel_type) VALUES (?, NULL, 'dm')",
    )
      .bind(channelId)
      .run();
    await env.DB.prepare(
      "INSERT INTO dm_recipients (channel_id, user_id) VALUES (?, ?), (?, ?)",
    )
      .bind(channelId, callerId, channelId, calleeId)
      .run();

    const caller = await openGlobalSocket(roomName, callerId);
    await identifyMeetingSocket(caller, { name: "Persist Caller" });
    const callee = await openGlobalSocket(roomName, calleeId);
    await identifyMeetingSocket(callee, { name: "Persist Callee" });

    const calleeRing = nextDispatchEvent(callee, "CALL_RING");
    caller.send(
      JSON.stringify({
        op: 36,
        d: { target_user_id: calleeId, channel_id: channelId },
      }),
    );
    const ring = await calleeRing;
    const callId = (ring.d as { data: { call_id: string } }).data.call_id;
    const room = env.MEETING_ROOM.get(env.MEETING_ROOM.idFromName(roomName));

    await runInDurableObject(room, async (instance, state) => {
      const stored =
        await state.storage.get<Record<string, unknown>>("pendingCalls");
      expect(stored).toMatchObject({
        [calleeId]: {
          callId,
          callerId,
          calleeId,
          channelId,
          expiresAt: expect.any(Number),
        },
      });
      expect(await state.storage.getAlarm()).toBeLessThanOrEqual(
        Date.now() + 30_000,
      );
      await state.storage.put("pendingCalls", {
        [calleeId]: {
          ...(stored?.[calleeId] as object),
          expiresAt: Date.now() - 1,
        },
      });
      const liveState = instance as unknown as {
        pendingCalls: Map<string, { expiresAt: number }>;
      };
      const livePendingCall = liveState.pendingCalls.get(calleeId);
      if (!livePendingCall) throw new Error("Expected live pending call");
      livePendingCall.expiresAt = Date.now() - 1;
    });

    const callerStop = nextDispatchEventMatching(
      caller,
      "CALL_RING_STOP",
      (message) =>
        (message.d as { data?: { call_id?: string; reason?: string } }).data
          ?.call_id === callId,
    );
    const calleeStop = nextDispatchEventMatching(
      callee,
      "CALL_RING_STOP",
      (message) =>
        (message.d as { data?: { call_id?: string; reason?: string } }).data
          ?.call_id === callId,
    );

    expect(await runDurableObjectAlarm(room)).toBe(true);
    await expect(callerStop).resolves.toMatchObject({
      d: { data: { call_id: callId, reason: "timeout" } },
    });
    await expect(calleeStop).resolves.toMatchObject({
      d: { data: { call_id: callId, reason: "timeout" } },
    });
    await runInDurableObject(room, async (_instance, state) => {
      await expect(state.storage.get("pendingCalls")).resolves.toEqual({});
    });

    caller.close();
    callee.close();
  }, 12_000);

  it("ignores a CALL_END for an earlier call and cancels the ring on a matching call_id", async () => {
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS channels (id TEXT PRIMARY KEY, server_id TEXT, channel_type TEXT NOT NULL)",
    ).run();
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS dm_recipients (channel_id TEXT NOT NULL, user_id TEXT NOT NULL)",
    ).run();
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS relationships (user_id TEXT NOT NULL, target_user_id TEXT NOT NULL, type INTEGER NOT NULL)",
    ).run();

    const roomName = crypto.randomUUID();
    const channelId = `call-end-${crypto.randomUUID()}`;
    const callerId = `call-end-caller-${crypto.randomUUID()}`;
    const calleeId = `call-end-callee-${crypto.randomUUID()}`;
    await env.DB.prepare(
      "INSERT INTO channels (id, server_id, channel_type) VALUES (?, NULL, 'dm')",
    )
      .bind(channelId)
      .run();
    await env.DB.prepare(
      "INSERT INTO dm_recipients (channel_id, user_id) VALUES (?, ?), (?, ?)",
    )
      .bind(channelId, callerId, channelId, calleeId)
      .run();

    const caller = await openGlobalSocket(roomName, callerId);
    await identifyMeetingSocket(caller, { name: "End Caller" });
    const callee = await openGlobalSocket(roomName, calleeId);
    await identifyMeetingSocket(callee, { name: "End Callee" });

    const calleeRing = nextDispatchEvent(callee, "CALL_RING");
    caller.send(
      JSON.stringify({
        op: 36,
        d: { target_user_id: calleeId, channel_id: channelId },
      }),
    );
    const callId = ((await calleeRing).d as { data: { call_id: string } }).data
      .call_id;

    const pendingCallIds = () =>
      runInDurableObject(meetingRoom(roomName), (instance) =>
        [
          ...(
            instance as unknown as {
              pendingCalls: Map<string, { callId: string }>;
            }
          ).pendingCalls.values(),
        ].map((call) => call.callId),
      );
    /** A heartbeat ack proves the frames sent before it were handled. */
    const settled = async () => {
      const ack = nextMessageWithOpcode(caller, 6);
      caller.send(HEARTBEAT_FRAME);
      await ack;
    };
    expect(await pendingCallIds()).toEqual([callId]);

    // A CALL_END that names an earlier call must not cancel this ring.
    caller.send(
      JSON.stringify({
        op: 39,
        d: { call_id: `stale-${crypto.randomUUID()}` },
      }),
    );
    await settled();
    expect(await pendingCallIds()).toEqual([callId]);

    const stopMatching = (socket: WebSocket) =>
      nextDispatchEventMatching(
        socket,
        "CALL_RING_STOP",
        (message) =>
          (message.d as { data?: { call_id?: string } }).data?.call_id ===
          callId,
      );
    const callerStop = stopMatching(caller);
    const calleeStop = stopMatching(callee);
    caller.send(JSON.stringify({ op: 39, d: { call_id: callId } }));
    await expect(callerStop).resolves.toMatchObject({
      d: { data: { call_id: callId, reason: "cancelled" } },
    });
    await expect(calleeStop).resolves.toMatchObject({
      d: { data: { call_id: callId, reason: "cancelled" } },
    });
    expect(await pendingCallIds()).toEqual([]);

    caller.close();
    callee.close();
  });

  it("answers a ring over REST for the callee only, and saves a declined call in the DM", async () => {
    for (const sql of [
      "CREATE TABLE IF NOT EXISTS channels (id TEXT PRIMARY KEY, server_id TEXT, channel_type TEXT NOT NULL)",
      "CREATE TABLE IF NOT EXISTS dm_recipients (channel_id TEXT NOT NULL, user_id TEXT NOT NULL)",
      "CREATE TABLE IF NOT EXISTS relationships (user_id TEXT NOT NULL, target_user_id TEXT NOT NULL, type INTEGER NOT NULL)",
      "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT, display_name TEXT, avatar_url TEXT, avatar_display TEXT, status TEXT)",
      "CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, author_id TEXT NOT NULL, content TEXT NOT NULL, reply_to_id TEXT, created_at TEXT, content_revision INTEGER, type TEXT, metadata TEXT)",
    ]) {
      await env.DB.prepare(sql).run();
    }

    const roomName = crypto.randomUUID();
    const channelId = `call-rest-${crypto.randomUUID()}`;
    const callerId = `call-rest-caller-${crypto.randomUUID()}`;
    const calleeId = `call-rest-callee-${crypto.randomUUID()}`;
    await env.DB.prepare(
      "INSERT INTO channels (id, server_id, channel_type) VALUES (?, NULL, 'dm')",
    )
      .bind(channelId)
      .run();
    await env.DB.prepare(
      "INSERT INTO dm_recipients (channel_id, user_id) VALUES (?, ?), (?, ?)",
    )
      .bind(channelId, callerId, channelId, calleeId)
      .run();
    await env.DB.prepare(
      "INSERT INTO users (id, username, display_name) VALUES (?, 'rest-caller', 'Rest Caller')",
    )
      .bind(callerId)
      .run();

    const caller = await openGlobalSocket(roomName, callerId);
    await identifyMeetingSocket(caller, { name: "Rest Caller" });
    const callee = await openGlobalSocket(roomName, calleeId);
    await identifyMeetingSocket(callee, { name: "Rest Callee" });
    const room = meetingRoom(roomName);
    const answer = (path: string, callId: string, userId: string) =>
      room.fetch(`https://internal/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ call_id: callId, user_id: userId }),
      });
    const ringOnce = async () => {
      const ring = nextDispatchEvent(callee, "CALL_RING");
      caller.send(
        JSON.stringify({
          op: 36,
          d: { target_user_id: calleeId, channel_id: channelId },
        }),
      );
      return ((await ring).d as { data: { call_id: string } }).data.call_id;
    };
    const stopFor = (socket: WebSocket, callId: string) =>
      nextDispatchEventMatching(
        socket,
        "CALL_RING_STOP",
        (message) =>
          (message.d as { data?: { call_id?: string } }).data?.call_id ===
          callId,
      );

    // Accept: the caller is refused, an unknown call is gone, the callee wins.
    const accepted = await ringOnce();
    expect((await answer("call-accept", accepted, callerId)).status).toBe(403);
    expect((await answer("call-accept", "nope", calleeId)).status).toBe(404);
    const acceptStop = stopFor(caller, accepted);
    expect((await answer("call-accept", accepted, calleeId)).status).toBe(200);
    await expect(acceptStop).resolves.toMatchObject({
      d: { data: { call_id: accepted, reason: "accepted" } },
    });
    // A second answer (notification, then the app) is still fine.
    expect((await answer("call-accept", accepted, calleeId)).status).toBe(200);

    // Hang up (the caller's room reports them in, then gone: the answered
    // call's channel emptied), then ring again and decline.
    await pushRoster(roomName, channelId, [rosterMember(callerId)]);
    await pushRoster(roomName, channelId, []);
    const declined = await ringOnce();
    const declineStop = stopFor(caller, declined);
    const record = nextDispatchEventMatching(
      caller,
      "MESSAGE_CREATE",
      (message) =>
        (message.d as { data?: { call?: { call_id?: string } } }).data?.call
          ?.call_id === declined,
    );
    expect((await answer("call-decline", declined, calleeId)).status).toBe(200);
    await expect(declineStop).resolves.toMatchObject({
      d: { data: { call_id: declined, reason: "declined" } },
    });
    await expect(record).resolves.toMatchObject({
      d: {
        data: {
          channel_id: channelId,
          author_id: callerId,
          type: "call",
          content: "Declined call",
          call: {
            call_id: declined,
            outcome: "declined",
            caller_id: callerId,
            callee_id: calleeId,
          },
        },
      },
    });
    const stored = await env.DB.prepare(
      "SELECT type, metadata FROM messages WHERE channel_id = ? AND type = 'call'",
    )
      .bind(channelId)
      .all<{ type: string; metadata: string }>();
    expect(
      stored.results.map((row) => JSON.parse(row.metadata).outcome).sort(),
    ).toEqual(["declined", "ended"]);

    caller.close();
    callee.close();
  });

  it("keeps a throttled background tab (one heartbeat a minute) and prunes a dead one", async () => {
    const roomName = crypto.randomUUID();
    const userId = `throttled-${crypto.randomUUID()}`;
    const socket = await openMeetingSocket(roomName, userId);
    await identifyMeetingSocket(socket, { name: "Background Tab" });
    const room = env.MEETING_ROOM.get(env.MEETING_ROOM.idFromName(roomName));
    type Live = { sessions: Map<unknown, { last_heartbeat?: number }> };

    const ageHeartbeat = (ms: number) =>
      runInDurableObject(room, (instance) => {
        for (const session of (instance as unknown as Live).sessions.values()) {
          session.last_heartbeat = Date.now() - ms;
        }
      });
    const sessionCount = () =>
      runInDurableObject(
        room,
        (instance) => (instance as unknown as Live).sessions.size,
      );

    // Chrome's intensive throttling: the 15s beat lands about 60s apart.
    await ageHeartbeat(62_000);
    await runInDurableObject(room, (instance) =>
      (instance as unknown as { alarm(): Promise<void> }).alarm(),
    );
    expect(await sessionCount()).toBe(1);

    await ageHeartbeat(95_000);
    await runInDurableObject(room, (instance) =>
      (instance as unknown as { alarm(): Promise<void> }).alarm(),
    );
    expect(await sessionCount()).toBe(0);

    socket.close();
  });

  it("accepts a hibernatable room socket and sends Hello", async () => {
    const roomId = env.MEETING_ROOM.idFromName("lifecycle-test-room");
    const room = env.MEETING_ROOM.get(roomId);
    const response = await room.fetch(
      "https://internal/api/channels/lifecycle-test-room/ws?v=1",
      {
        headers: await createAdmissionHeaders("lifecycle-test-room", "room"),
      },
    );

    expect(response.status).toBe(101);
    expect(response.webSocket).not.toBeNull();
    expect(response.headers.get("Sec-WebSocket-Protocol")).toBe(
      "ralph.realtime.v1",
    );

    const socket = response.webSocket;
    if (!socket) {
      throw new Error("Expected WebSocket upgrade response");
    }

    socket.accept();
    const message = await new Promise<MessageEvent<string>>((resolve) => {
      socket.addEventListener("message", resolve, { once: true });
    });

    expect(JSON.parse(message.data)).toMatchObject({
      op: 8,
      d: { heartbeat_interval: 15_000 },
    });

    socket.close();
  });

  it("returns a protocol error for invalid JSON", async () => {
    const socket = await openMeetingSocket();
    const response = nextJsonMessage(socket);

    socket.send("not-json");

    expect(await response).toMatchObject({
      op: 18,
      d: { code: 4002, message: "Invalid JSON" },
    });

    socket.close();
  });

  it.each([null, [], "not an object"])(
    "rejects a valid JSON root that is not an object: %j",
    async (payload) => {
      const socket = await openMeetingSocket();
      const response = nextJsonMessage(socket);

      socket.send(JSON.stringify(payload));

      expect(await response).toMatchObject({
        op: 18,
        d: { code: 4001, message: "Missing opcode" },
      });
      socket.close();
    },
  );

  it.each([
    [7, null, "Invalid resume payload"],
    [36, null, "Invalid call payload"],
  ] as const)(
    "rejects opcode %s with a non-object payload",
    async (opcode, payload, message) => {
      const socket = await openGlobalSocket();
      await identifyMeetingSocket(socket);
      const response = nextJsonMessage(socket);

      socket.send(JSON.stringify({ op: opcode, d: payload }));

      expect(await response).toMatchObject({
        op: 18,
        d: { code: 4000, message },
      });
      socket.close();
    },
  );

  it("rate-limits expensive message operations without affecting heartbeats", async () => {
    const socket = await openGlobalSocket();
    await identifyMeetingSocket(socket);

    const responses = [];
    for (let index = 0; index < 31; index += 1) {
      const response = nextMessageWithOpcode(socket, 18);
      socket.send(JSON.stringify({ op: 20, d: null }));
      responses.push(await response);
    }
    expect(
      responses.some(
        (message) =>
          message.op === 18 && (message.d as { code?: number }).code === 4290,
      ),
    ).toBe(true);

    const heartbeat = nextJsonMessage(socket);
    socket.send(JSON.stringify({ op: 3, d: { seq_ack: 0 } }));
    await expect(heartbeat).resolves.toMatchObject({ op: 6 });
    socket.close();
  });

  it("acks an unidentified heartbeat without creating a session", async () => {
    const socket = await openMeetingSocket();
    const response = nextJsonMessage(socket);

    socket.send(JSON.stringify({ op: 3, d: { seq_ack: 0 } }));

    expect(await response).toMatchObject({
      op: 6,
      d: { seq: 0 },
    });

    socket.close();
  });

  it("binds Identify to the admitted subject, ignoring any user id the client sends", async () => {
    const roomName = crypto.randomUUID();
    const socket = await openMeetingSocket(roomName);
    const ready = nextMessageWithOpcode(socket, 2);

    // The room must accept the frame and take the user from the ticket, not
    // from the payload.
    socket.send(
      JSON.stringify({
        op: 0,
        d: {
          user_id: "forged-user",
          name: "Forged Name",
        },
      }),
    );

    expect(await ready).toMatchObject({ op: 2 });

    const room = env.MEETING_ROOM.get(env.MEETING_ROOM.idFromName(roomName));
    const admitted = await room.fetch("https://internal/voice-session-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: "user-test",
        require_channel_match: false,
      }),
    });
    const forged = await room.fetch("https://internal/voice-session-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: "forged-user",
        require_channel_match: false,
      }),
    });

    await expect(admitted.json()).resolves.toMatchObject({ allowed: true });
    await expect(forged.json()).resolves.toMatchObject({ allowed: false });

    socket.close();
  });

  it("rejects subscriptions to unknown channels", async () => {
    const roomName = crypto.randomUUID();
    const socket = await openGlobalSocket(roomName);
    await identifyMeetingSocket(socket);
    const response = nextJsonMessage(socket);

    socket.send(
      JSON.stringify({
        op: 27,
        d: { channel_id: `unknown-${crypto.randomUUID()}` },
      }),
    );

    expect(await response).toMatchObject({
      op: 18,
      d: { code: 4003, message: "Channel not found or access denied" },
    });
    socket.close();
  });

  it("only invalidates member caches when presence status changes", async () => {
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL, display_name TEXT, avatar_url TEXT, avatar_display TEXT, status TEXT DEFAULT 'online', updated_at TEXT)",
    ).run();
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS server_members (server_id TEXT NOT NULL, user_id TEXT NOT NULL)",
    ).run();

    try {
      await env.DB.prepare(
        "ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'online'",
      ).run();
    } catch {
      // The shared test database may already have the column.
    }
    try {
      await env.DB.prepare(
        "ALTER TABLE users ADD COLUMN updated_at TEXT",
      ).run();
    } catch {
      // The shared test database may already have the column.
    }

    const userId = `presence-cache-${crypto.randomUUID()}`;
    const serverIds = [
      `presence-server-${crypto.randomUUID()}`,
      `presence-server-${crypto.randomUUID()}`,
    ];
    await env.DB.prepare(
      "INSERT INTO users (id, username, status) VALUES (?, ?, NULL)",
    )
      .bind(userId, userId)
      .run();
    for (const serverId of serverIds) {
      await env.DB.prepare(
        "INSERT INTO server_members (server_id, user_id) VALUES (?, ?)",
      )
        .bind(serverId, userId)
        .run();
      await env.CACHE.put(`v1:server:members:${serverId}`, "present", {
        expirationTtl: 60,
      });
    }

    const socket = await openGlobalSocket(crypto.randomUUID(), userId);
    await identifyMeetingSocket(socket);

    // Invalidation runs after the status write, so wait for it instead of a
    // fixed sleep (a loaded CI runner needs more than 100 ms).
    const expectInvalidated = () =>
      vi.waitFor(
        async () => {
          for (const serverId of serverIds) {
            expect(
              await env.CACHE.get(`v1:server:members:${serverId}`),
            ).toBeNull();
          }
        },
        { timeout: 5_000, interval: 25 },
      );
    // The DO handles frames in order: once it ACKs a heartbeat sent after the
    // presence frame, that frame has been fully processed. The heartbeat
    // carries a payload so it is not the exact `{"op":3}` frame the runtime
    // auto-responds to without waking the DO.
    const settle = async () => {
      socket.send(JSON.stringify({ op: 3, d: { settle: true } }));
      await nextMessageWithOpcode(socket, 6);
    };

    socket.send(JSON.stringify({ op: 26, d: { status: "online" } }));
    await expectInvalidated();
    for (const serverId of serverIds) {
      await env.CACHE.put(`v1:server:members:${serverId}`, "present", {
        expirationTtl: 60,
      });
    }

    socket.send(JSON.stringify({ op: 26, d: { status: "online" } }));
    expect(await hasMessageWithOpcode(socket, 19, 100)).toBe(false);
    await settle();

    for (const serverId of serverIds) {
      await expect(
        env.CACHE.get(`v1:server:members:${serverId}`),
      ).resolves.toBe("present");
    }

    socket.send(JSON.stringify({ op: 26, d: { status: "idle" } }));
    await expectInvalidated();
    socket.close();
  }, 12_000);

  it("rejects subscriptions to a private server channel", async () => {
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS channels (id TEXT PRIMARY KEY, server_id TEXT, channel_type TEXT NOT NULL)",
    ).run();
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS server_members (server_id TEXT NOT NULL, user_id TEXT NOT NULL)",
    ).run();
    const channelId = `private-${crypto.randomUUID()}`;
    await env.DB.prepare(
      "INSERT INTO channels (id, server_id, channel_type) VALUES (?, ?, 'text')",
    )
      .bind(channelId, `server-${crypto.randomUUID()}`)
      .run();

    const socket = await openGlobalSocket(crypto.randomUUID());
    await identifyMeetingSocket(socket);
    const response = nextJsonMessage(socket);
    socket.send(JSON.stringify({ op: 27, d: { channel_id: channelId } }));

    expect(await response).toMatchObject({
      op: 18,
      d: { code: 4003, message: "Channel not found or access denied" },
    });
    socket.close();
  });

  it("issues a voice token that VoiceRoom accepts", async () => {
    const roomName = crypto.randomUUID();
    const meetingSocket = await openMeetingSocket(roomName);
    const ready = await identifyMeetingSocket(meetingSocket);
    const voiceRoom = env.VOICE_ROOM.get(env.VOICE_ROOM.idFromName(roomName));
    const response = await voiceRoom.fetch(
      `https://internal/api/channels/${roomName}/voice?v=1`,
      { headers: await createVoiceAdmissionHeaders(roomName) },
    );

    expect(response.status).toBe(101);
    const voiceSocket = response.webSocket;
    if (!voiceSocket) throw new Error("Expected VoiceRoom WebSocket");
    voiceSocket.accept();
    await nextJsonMessage(voiceSocket);

    const voiceReady = nextJsonMessage(voiceSocket);
    voiceSocket.send(
      JSON.stringify({
        op: 100,
        d: {
          participant_id: ready.participant_id,
          voice_token: ready.voice_token,
        },
      }),
    );

    expect(await voiceReady).toMatchObject({
      op: 101,
      d: { participant_id: ready.participant_id },
    });

    meetingSocket.close();
    voiceSocket.close();
  });

  it.each([
    ["malformed", "not-a-token", "Invalid voice token format", 4004],
    [
      "wrong room",
      "participant:other-room:123:user-test.bad",
      "Invalid voice token",
      4004,
    ],
    ["expired", "", "Voice token expired", 4004],
    [
      "invalid signature",
      "participant:ROOM_TIMESTAMP:user-test.invalid",
      "Voice token verification failed",
      4004,
    ],
  ] as const)(
    "rejects a %s voice token without mutating identity",
    async (kind, tokenTemplate, expectedMessage, expectedCode) => {
      const roomName = crypto.randomUUID();
      const socket = await openMeetingSocket(roomName);
      const participantId = crypto.randomUUID();
      const token =
        kind === "expired"
          ? await issueVoiceTokenForTest(
              participantId,
              roomName,
              "user-test",
              Date.now() - 60 * 60 * 1000 - 1,
            )
          : tokenTemplate
              .replace("participant", participantId)
              .replace("ROOM_TIMESTAMP", `${roomName}:${Date.now()}`);
      const voiceRoom = env.VOICE_ROOM.get(env.VOICE_ROOM.idFromName(roomName));
      const response = await voiceRoom.fetch(
        `https://internal/api/channels/${roomName}/voice?v=1`,
        { headers: await createVoiceAdmissionHeaders(roomName) },
      );
      expect(response.status, kind).toBe(101);
      const voiceSocket = response.webSocket;
      if (!voiceSocket) throw new Error("Expected VoiceRoom WebSocket");
      voiceSocket.accept();
      await nextJsonMessage(voiceSocket);

      const error = nextJsonMessage(voiceSocket);
      voiceSocket.send(
        JSON.stringify({
          op: 100,
          d: { participant_id: participantId, voice_token: token },
        }),
      );

      expect(await error).toMatchObject({
        op: 18,
        d: { code: expectedCode, message: expectedMessage },
      });
      const sessionCheck = await voiceRoom.fetch(
        "https://internal/disconnect-participant",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            participant_id: participantId,
            user_id: "user-test",
          }),
        },
      );
      await expect(sessionCheck.json()).resolves.toEqual({
        disconnected: false,
      });
      socket.close();
      voiceSocket.close();
    },
  );

  it("applies profile broadcasts before a later room roster", async () => {
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS channels (id TEXT PRIMARY KEY, server_id TEXT, channel_type TEXT NOT NULL)",
    ).run();
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS dm_recipients (channel_id TEXT NOT NULL, user_id TEXT NOT NULL)",
    ).run();

    const roomName = crypto.randomUUID();
    const channelId = `profile-voice-${crypto.randomUUID()}`;
    await env.DB.prepare(
      "INSERT INTO channels (id, server_id, channel_type) VALUES (?, NULL, 'dm')",
    )
      .bind(channelId)
      .run();
    await env.DB.prepare(
      "INSERT INTO dm_recipients (channel_id, user_id) VALUES (?, ?), (?, ?)",
    )
      .bind(channelId, "user-test", channelId, "observer")
      .run();

    const ownerIdentity = {
      name: "Old Name",
      username: "old-user",
      display_name: "Old Name",
      avatar_url: "https://example.com/old.png",
      avatar_display: "frame:old",
    };
    const owner = await openGlobalSocket(roomName, "user-test");
    await identifyMeetingSocket(owner, ownerIdentity);
    const observer = await openGlobalSocket(roomName, "observer");
    await identifyMeetingSocket(observer, {
      name: "Observer",
      username: "observer",
    });

    const initialJoin = nextDispatchEventMatching(
      observer,
      "VOICE_CHANNEL_STATE_UPDATE",
      (message) =>
        (
          message.d as {
            data?: { members?: Array<Record<string, unknown>> };
          }
        ).data?.members?.some((member) => member.user_id === "user-test") ??
        false,
    );
    await pushRoster(roomName, channelId, [
      rosterMember("user-test", ownerIdentity),
    ]);
    expect(
      ((await initialJoin).d as { data: { members: unknown[] } }).data.members,
    ).toEqual([
      expect.objectContaining({
        user_id: "user-test",
      }),
    ]);

    const updatedState = nextDispatchEventMatching(
      observer,
      "VOICE_CHANNEL_STATE_UPDATE",
      (message) =>
        (
          message.d as {
            data?: { members?: Array<Record<string, unknown>> };
          }
        ).data?.members?.some(
          (member) =>
            member.user_id === "user-test" &&
            member.avatar_url === "https://example.com/new.png" &&
            member.avatar_display === "frame:new",
        ) ?? false,
    );
    const updatedProfile = nextDispatchEventMatching(
      observer,
      "USER_PROFILE_UPDATE",
      (message) =>
        (
          message.d as {
            data?: { user_id?: string; avatar_url?: string };
          }
        ).data?.user_id === "user-test",
    );
    const room = env.MEETING_ROOM.get(env.MEETING_ROOM.idFromName(roomName));
    const broadcast = await room.fetch("https://internal/broadcast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        broadcast_all: true,
        event: "USER_PROFILE_UPDATE",
        data: {
          user_id: "user-test",
          username: "new-user",
          display_name: "New Name",
          avatar_url: "https://example.com/new.png",
          avatar_display: "frame:new",
          updated_at: new Date().toISOString(),
        },
      }),
    });
    expect(broadcast.status).toBe(200);
    await expect(updatedState).resolves.toMatchObject({
      d: {
        data: {
          members: [
            expect.objectContaining({
              user_id: "user-test",
              name: "New Name",
              username: "new-user",
              display_name: "New Name",
              avatar_url: "https://example.com/new.png",
              avatar_display: "frame:new",
            }),
          ],
        },
      },
    });
    await expect(updatedProfile).resolves.toMatchObject({
      d: {
        event: "USER_PROFILE_UPDATE",
        data: {
          user_id: "user-test",
          avatar_url: "https://example.com/new.png",
        },
      },
    });

    const left = nextDispatchEventMatching(
      observer,
      "VOICE_CHANNEL_STATE_UPDATE",
      (message) =>
        (
          message.d as {
            data?: { members?: Array<Record<string, unknown>> };
          }
        ).data?.members?.length === 0,
    );
    await pushRoster(roomName, channelId, []);
    await left;

    const rejoined = nextDispatchEventMatching(
      observer,
      "VOICE_CHANNEL_STATE_UPDATE",
      (message) =>
        (
          message.d as {
            data?: { members?: Array<Record<string, unknown>> };
          }
        ).data?.members?.some(
          (member) =>
            member.user_id === "user-test" &&
            member.avatar_url === "https://example.com/new.png",
        ) ?? false,
    );
    // The room still has the identity from the owner's join.
    await pushRoster(roomName, channelId, [
      rosterMember("user-test", ownerIdentity),
    ]);
    await expect(rejoined).resolves.toMatchObject({
      d: {
        data: {
          members: [
            expect.objectContaining({
              user_id: "user-test",
              avatar_url: "https://example.com/new.png",
              avatar_display: "frame:new",
            }),
          ],
        },
      },
    });

    owner.close();
    observer.close();
  });

  it("broadcasts through the trusted internal endpoint and disconnects an exact session", async () => {
    const roomName = crypto.randomUUID();
    const sender = await openMeetingSocket(roomName);
    await identifyMeetingSocket(sender);
    const recipient = await openMeetingSocket(roomName);
    const recipientReady = await identifyMeetingSocket(recipient);

    const recipientBroadcast = nextMessageWithOpcodeWithin(recipient, 19);
    const broadcast = await env.MEETING_ROOM.get(
      env.MEETING_ROOM.idFromName(roomName),
    ).fetch("https://internal/broadcast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        broadcast_all: true,
        event: "CHARACTERIZATION_EVENT",
        data: { value: 42 },
      }),
    });
    expect(broadcast.status).toBe(200);
    expect(await recipientBroadcast).toMatchObject({
      op: 19,
      d: {
        event: "CHARACTERIZATION_EVENT",
        data: { value: 42 },
      },
    });

    const disconnected = await env.MEETING_ROOM.get(
      env.MEETING_ROOM.idFromName(roomName),
    ).fetch("https://internal/disconnect-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: "user-test",
        session_id: recipientReady.participant_id,
      }),
    });
    await expect(disconnected.json()).resolves.toEqual({ disconnected: true });

    sender.close();
    recipient.close();
  });

  it("does not deliver a channel dispatch after VIEW_CHANNELS is revoked", async () => {
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS channels (id TEXT PRIMARY KEY, server_id TEXT, channel_type TEXT NOT NULL)",
    ).run();
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS server_members (server_id TEXT NOT NULL, user_id TEXT NOT NULL)",
    ).run();
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS roles (id TEXT PRIMARY KEY, permissions INTEGER NOT NULL, position INTEGER NOT NULL, is_default INTEGER NOT NULL)",
    ).run();
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS member_roles (server_id TEXT NOT NULL, user_id TEXT NOT NULL, role_id TEXT NOT NULL)",
    ).run();
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS channel_permission_overrides (channel_id TEXT NOT NULL, target_id TEXT NOT NULL, target_type TEXT NOT NULL, allow INTEGER NOT NULL, deny INTEGER NOT NULL)",
    ).run();

    const serverId = `server-${crypto.randomUUID()}`;
    const channelId = `channel-${crypto.randomUUID()}`;
    const roleId = `role-${crypto.randomUUID()}`;
    await env.DB.prepare(
      "INSERT INTO channels (id, server_id, channel_type) VALUES (?, ?, 'text')",
    )
      .bind(channelId, serverId)
      .run();
    await env.DB.prepare(
      "INSERT INTO roles (id, permissions, position, is_default) VALUES (?, ?, 0, 1)",
    )
      .bind(
        roleId,
        PERMISSIONS.VIEW_CHANNELS |
          PERMISSIONS.SEND_MESSAGES |
          PERMISSIONS.ADD_REACTIONS,
      )
      .run();
    for (const userId of ["user-test", "user-recipient"]) {
      await env.DB.prepare(
        "INSERT INTO server_members (server_id, user_id) VALUES (?, ?)",
      )
        .bind(serverId, userId)
        .run();
      await env.DB.prepare(
        "INSERT INTO member_roles (server_id, user_id, role_id) VALUES (?, ?, ?)",
      )
        .bind(serverId, userId, roleId)
        .run();
    }

    const sharedRoomName = crypto.randomUUID();
    const sender = await openGlobalSocket(sharedRoomName, "user-test");
    await identifyMeetingSocket(sender);
    const recipient = await openGlobalSocket(sharedRoomName, "user-recipient");
    await identifyMeetingSocket(recipient);

    const subscribeSender = nextJsonMessage(sender);
    sender.send(JSON.stringify({ op: 27, d: { channel_id: channelId } }));
    await subscribeSender;
    const subscribeRecipient = nextJsonMessage(recipient);
    recipient.send(JSON.stringify({ op: 27, d: { channel_id: channelId } }));
    await subscribeRecipient;

    const firstDispatch = nextMessageWithOpcodeWithin(recipient, 19);
    await env.MEETING_ROOM.get(
      env.MEETING_ROOM.idFromName(sharedRoomName),
    ).fetch("https://internal/broadcast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        server_id: serverId,
        event: "MESSAGE_CREATE",
        data: { channel_id: channelId, id: "before-revoke" },
      }),
    });
    await expect(firstDispatch).resolves.toMatchObject({
      d: { event: "MESSAGE_CREATE", data: { id: "before-revoke" } },
    });

    await env.DB.prepare(
      "INSERT INTO channel_permission_overrides (channel_id, target_id, target_type, allow, deny) VALUES (?, ?, 'user', 0, ?)",
    )
      .bind(channelId, "user-recipient", PERMISSIONS.VIEW_CHANNELS)
      .run();

    await env.MEETING_ROOM.get(
      env.MEETING_ROOM.idFromName("global-gateway"),
    ).fetch("https://internal/broadcast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        server_id: serverId,
        event: "MESSAGE_CREATE",
        data: { channel_id: channelId, id: "after-revoke" },
      }),
    });
    await expect(hasMessageWithOpcode(recipient, 19, 150)).resolves.toBe(false);

    sender.close();
    recipient.close();
  });

  it("delivers duplicate sessions for one user and prunes both after revocation", async () => {
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS channels (id TEXT PRIMARY KEY, server_id TEXT, channel_type TEXT NOT NULL)",
    ).run();
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS server_members (server_id TEXT NOT NULL, user_id TEXT NOT NULL)",
    ).run();
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS roles (id TEXT PRIMARY KEY, permissions INTEGER NOT NULL, position INTEGER NOT NULL, is_default INTEGER NOT NULL)",
    ).run();
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS member_roles (server_id TEXT NOT NULL, user_id TEXT NOT NULL, role_id TEXT NOT NULL)",
    ).run();
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS channel_permission_overrides (channel_id TEXT NOT NULL, target_id TEXT NOT NULL, target_type TEXT NOT NULL, allow INTEGER NOT NULL, deny INTEGER NOT NULL)",
    ).run();

    const roomName = crypto.randomUUID();
    const serverId = `server-${crypto.randomUUID()}`;
    const channelId = `channel-${crypto.randomUUID()}`;
    const roleId = `role-${crypto.randomUUID()}`;
    await env.DB.prepare(
      "INSERT INTO channels (id, server_id, channel_type) VALUES (?, ?, 'text')",
    )
      .bind(channelId, serverId)
      .run();
    await env.DB.prepare(
      "INSERT INTO roles (id, permissions, position, is_default) VALUES (?, ?, 0, 1)",
    )
      .bind(roleId, PERMISSIONS.VIEW_CHANNELS)
      .run();
    await env.DB.prepare(
      "INSERT INTO server_members (server_id, user_id) VALUES (?, ?)",
    )
      .bind(serverId, "user-duplicate")
      .run();
    await env.DB.prepare(
      "INSERT INTO member_roles (server_id, user_id, role_id) VALUES (?, ?, ?)",
    )
      .bind(serverId, "user-duplicate", roleId)
      .run();

    const first = await openGlobalSocket(roomName, "user-duplicate");
    await identifyMeetingSocket(first);
    const second = await openGlobalSocket(roomName, "user-duplicate");
    await identifyMeetingSocket(second);

    const firstSubscription = nextJsonMessage(first);
    first.send(JSON.stringify({ op: 27, d: { channel_id: channelId } }));
    await firstSubscription;
    const secondSubscription = nextJsonMessage(second);
    second.send(JSON.stringify({ op: 27, d: { channel_id: channelId } }));
    await secondSubscription;

    const firstDispatch = nextMessageWithOpcodeWithin(first, 19);
    const secondDispatch = nextMessageWithOpcodeWithin(second, 19);
    const room = env.MEETING_ROOM.get(env.MEETING_ROOM.idFromName(roomName));
    await room.fetch("https://internal/broadcast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel_id: channelId,
        event: "MESSAGE_CREATE",
        data: { channel_id: channelId, id: "duplicate-session" },
      }),
    });

    await expect(firstDispatch).resolves.toMatchObject({
      d: { event: "MESSAGE_CREATE", data: { id: "duplicate-session" } },
    });
    await expect(secondDispatch).resolves.toMatchObject({
      d: { event: "MESSAGE_CREATE", data: { id: "duplicate-session" } },
    });

    await env.DB.prepare(
      "INSERT INTO channel_permission_overrides (channel_id, target_id, target_type, allow, deny) VALUES (?, ?, 'user', 0, ?)",
    )
      .bind(channelId, "user-duplicate", PERMISSIONS.VIEW_CHANNELS)
      .run();

    const firstRevoked = hasMessageWithOpcode(first, 19, 150);
    const secondRevoked = hasMessageWithOpcode(second, 19, 150);
    await room.fetch("https://internal/broadcast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel_id: channelId,
        event: "MESSAGE_CREATE",
        data: { channel_id: channelId, id: "duplicate-session-revoked" },
      }),
    });

    await expect(firstRevoked).resolves.toBe(false);
    await expect(secondRevoked).resolves.toBe(false);

    first.close();
    second.close();
  });

  it("isolates server dispatches and removes revoked server subscriptions", async () => {
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS server_members (server_id TEXT NOT NULL, user_id TEXT NOT NULL)",
    ).run();

    const roomName = crypto.randomUUID();
    const serverA = `server-a-${crypto.randomUUID()}`;
    const serverB = `server-b-${crypto.randomUUID()}`;
    await env.DB.prepare(
      "INSERT INTO server_members (server_id, user_id) VALUES (?, ?), (?, ?)",
    )
      .bind(serverA, "user-a", serverB, "user-b")
      .run();

    const socketA = await openGlobalSocket(roomName, "user-a");
    await identifyMeetingSocket(socketA);
    const socketB = await openGlobalSocket(roomName, "user-b");
    await identifyMeetingSocket(socketB);

    socketA.send(JSON.stringify({ op: 35, d: { server_id: serverA } }));
    socketB.send(JSON.stringify({ op: 35, d: { server_id: serverB } }));
    await waitForServerSubscribers(roomName, serverA, 1);
    await waitForServerSubscribers(roomName, serverB, 1);

    const isolatedA = nextMessageWithOpcodeWithin(socketA, 19);
    await env.MEETING_ROOM.get(env.MEETING_ROOM.idFromName(roomName)).fetch(
      "https://internal/broadcast",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          server_id: serverA,
          event: "GUILD_UPDATE",
          data: { id: serverA },
        }),
      },
    );
    await expect(isolatedA).resolves.toMatchObject({
      d: { event: "GUILD_UPDATE", data: { id: serverA } },
    });
    await expect(hasMessageWithOpcode(socketB, 19, 150)).resolves.toBe(false);

    await env.DB.prepare(
      "DELETE FROM server_members WHERE server_id = ? AND user_id = ?",
    )
      .bind(serverA, "user-a")
      .run();

    const revokedDispatch = hasMessageWithOpcode(socketA, 19, 150);
    await env.MEETING_ROOM.get(env.MEETING_ROOM.idFromName(roomName)).fetch(
      "https://internal/broadcast",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          server_id: serverA,
          event: "GUILD_UPDATE",
          data: { id: serverA, name: "revoked" },
        }),
      },
    );
    await expect(revokedDispatch).resolves.toBe(false);

    await env.DB.prepare(
      "INSERT INTO server_members (server_id, user_id) VALUES (?, ?)",
    )
      .bind(serverA, "user-a")
      .run();
    const removedSubscription = hasMessageWithOpcode(socketA, 19, 150);
    await env.MEETING_ROOM.get(env.MEETING_ROOM.idFromName(roomName)).fetch(
      "https://internal/broadcast",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          server_id: serverA,
          event: "GUILD_UPDATE",
          data: { id: serverA, name: "must-resubscribe" },
        }),
      },
    );
    await expect(removedSubscription).resolves.toBe(false);

    socketA.close();
    socketB.close();
  });

  it("delivers a server dispatch only to members when several sessions share one server subscription", async () => {
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS server_members (server_id TEXT NOT NULL, user_id TEXT NOT NULL)",
    ).run();

    const roomName = crypto.randomUUID();
    const serverId = `server-${crypto.randomUUID()}`;
    // Only the member is inserted; the other subscriber must be filtered out by
    // the batched membership resolution and pruned from the subscription set.
    await env.DB.prepare(
      "INSERT INTO server_members (server_id, user_id) VALUES (?, ?)",
    )
      .bind(serverId, "user-member")
      .run();

    const memberSocket = await openGlobalSocket(roomName, "user-member");
    await identifyMeetingSocket(memberSocket);
    const outsiderSocket = await openGlobalSocket(roomName, "user-outsider");
    await identifyMeetingSocket(outsiderSocket);

    memberSocket.send(JSON.stringify({ op: 35, d: { server_id: serverId } }));
    outsiderSocket.send(JSON.stringify({ op: 35, d: { server_id: serverId } }));
    await waitForServerSubscribers(roomName, serverId, 1);

    const memberDispatch = nextMessageWithOpcodeWithin(memberSocket, 19);
    const outsiderDispatch = hasMessageWithOpcode(outsiderSocket, 19, 150);
    await env.MEETING_ROOM.get(env.MEETING_ROOM.idFromName(roomName)).fetch(
      "https://internal/broadcast",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          server_id: serverId,
          event: "GUILD_UPDATE",
          data: { id: serverId, name: "members-only" },
        }),
      },
    );

    await expect(memberDispatch).resolves.toMatchObject({
      d: {
        event: "GUILD_UPDATE",
        data: { id: serverId, name: "members-only" },
      },
    });
    await expect(outsiderDispatch).resolves.toBe(false);

    memberSocket.close();
    outsiderSocket.close();
  });

  it("rejects calls unless the channel is an exact two-recipient DM", async () => {
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS channels (id TEXT PRIMARY KEY, server_id TEXT, channel_type TEXT NOT NULL)",
    ).run();
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS dm_recipients (channel_id TEXT NOT NULL, user_id TEXT NOT NULL)",
    ).run();
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS relationships (user_id TEXT NOT NULL, target_user_id TEXT NOT NULL, type INTEGER NOT NULL)",
    ).run();

    const roomName = crypto.randomUUID();
    const serverChannel = `server-channel-${crypto.randomUUID()}`;
    const dmChannel = `dm-channel-${crypto.randomUUID()}`;
    const groupDm = `group-dm-${crypto.randomUUID()}`;
    const serverId = `server-${crypto.randomUUID()}`;
    await env.DB.prepare(
      "INSERT INTO channels (id, server_id, channel_type) VALUES (?, ?, 'text'), (?, NULL, 'dm'), (?, NULL, 'dm')",
    )
      .bind(serverChannel, serverId, dmChannel, groupDm)
      .run();
    for (const channelId of [dmChannel, groupDm]) {
      await env.DB.prepare(
        "INSERT INTO dm_recipients (channel_id, user_id) VALUES (?, ?), (?, ?)",
      )
        .bind(channelId, "user-test", channelId, "user-callee")
        .run();
    }
    await env.DB.prepare(
      "INSERT INTO dm_recipients (channel_id, user_id) VALUES (?, ?)",
    )
      .bind(groupDm, "user-third")
      .run();

    const caller = await openGlobalSocket(roomName, "user-test");
    await identifyMeetingSocket(caller);
    const callee = await openGlobalSocket(roomName, "user-callee");
    await identifyMeetingSocket(callee);
    await hasMessageWithOpcode(caller, 19, 150);

    for (const channelId of [serverChannel, groupDm]) {
      const response = nextMessageWithOpcode(caller, 19);
      caller.send(
        JSON.stringify({
          op: 36,
          d: { channel_id: channelId, target_user_id: "user-callee" },
        }),
      );
      await expect(response).resolves.toMatchObject({
        op: 19,
        d: { event: "CALL_RING_STOP", data: { reason: "unavailable" } },
      });
    }

    caller.close();
    callee.close();
  });

  it("replays a message created during the disconnect grace period before Resumed", async () => {
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS channels (id TEXT PRIMARY KEY, server_id TEXT, channel_type TEXT NOT NULL)",
    ).run();
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS server_members (server_id TEXT NOT NULL, user_id TEXT NOT NULL)",
    ).run();
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS roles (id TEXT PRIMARY KEY, permissions INTEGER NOT NULL, position INTEGER NOT NULL, is_default INTEGER NOT NULL)",
    ).run();
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS member_roles (server_id TEXT NOT NULL, user_id TEXT NOT NULL, role_id TEXT NOT NULL)",
    ).run();
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS channel_permission_overrides (channel_id TEXT NOT NULL, target_id TEXT NOT NULL, target_type TEXT NOT NULL, allow INTEGER NOT NULL, deny INTEGER NOT NULL)",
    ).run();
    const roomName = crypto.randomUUID();
    const serverId = `server-${crypto.randomUUID()}`;
    const channelId = `channel-${crypto.randomUUID()}`;
    const roleId = `role-${crypto.randomUUID()}`;
    await env.DB.prepare(
      "INSERT INTO channels (id, server_id, channel_type) VALUES (?, ?, 'text')",
    )
      .bind(channelId, serverId)
      .run();
    await env.DB.prepare(
      "INSERT INTO server_members (server_id, user_id) VALUES (?, ?)",
    )
      .bind(serverId, "user-test")
      .run();
    await env.DB.prepare(
      "INSERT INTO roles (id, permissions, position, is_default) VALUES (?, ?, 0, 1)",
    )
      .bind(roleId, PERMISSIONS.VIEW_CHANNELS)
      .run();
    await env.DB.prepare(
      "INSERT INTO member_roles (server_id, user_id, role_id) VALUES (?, ?, ?)",
    )
      .bind(serverId, "user-test", roleId)
      .run();

    const original = await openGlobalSocket(roomName);
    const ready = await identifyMeetingSocket(original);
    original.send(JSON.stringify({ op: 35, d: { server_id: serverId } }));
    await waitForServerSubscribers(roomName, serverId, 1);

    original.close();
    await waitForResumableSession(roomName, ready.participant_id);

    const room = env.MEETING_ROOM.get(env.MEETING_ROOM.idFromName(roomName));
    await room.fetch("https://internal/broadcast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        server_id: serverId,
        event: "MESSAGE_CREATE",
        data: { id: "during-disconnect", channel_id: channelId },
      }),
    });

    const resumedSocket = await openGlobalSocket(roomName);
    const orderedMessages: Array<{ op: number; d: unknown }> = [];
    const ordered = new Promise<Array<{ op: number; d: unknown }>>(
      (resolve) => {
        const onMessage = (event: MessageEvent<string>) => {
          const message = JSON.parse(event.data) as { op: number; d: unknown };
          if (
            message.op === 9 ||
            (message.op === 19 &&
              (message.d as { event?: unknown } | null)?.event ===
                "MESSAGE_CREATE")
          ) {
            orderedMessages.push(message);
          }
          if (orderedMessages.length === 2) {
            resumedSocket.removeEventListener("message", onMessage);
            resolve(orderedMessages);
          }
        };
        resumedSocket.addEventListener("message", onMessage);
      },
    );
    resumedSocket.send(
      JSON.stringify({
        op: 7,
        d: { session_id: ready.participant_id, seq_ack: 0 },
      }),
    );

    const messages = await ordered;
    expect(messages[0]).toMatchObject({
      op: 19,
      d: { event: "MESSAGE_CREATE", data: { id: "during-disconnect" } },
    });
    expect(messages[1]).toMatchObject({ op: 9 });

    resumedSocket.close();
  });

  it("assigns distinct monotonic sequences to replayable dispatches", async () => {
    const roomName = crypto.randomUUID();
    const socket = await openMeetingSocket(roomName);
    await identifyMeetingSocket(socket);
    const room = env.MEETING_ROOM.get(env.MEETING_ROOM.idFromName(roomName));

    const first = nextMessageWithOpcode(socket, 19);
    await room.fetch("https://internal/broadcast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        broadcast_all: true,
        event: "SEQUENCE_ONE",
        data: {},
      }),
    });
    const firstMessage = await first;

    const second = nextMessageWithOpcode(socket, 19);
    await room.fetch("https://internal/broadcast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        broadcast_all: true,
        event: "SEQUENCE_TWO",
        data: {},
      }),
    });

    const secondMessage = await second;
    const firstSeq = (firstMessage.d as { seq: number }).seq;
    const secondSeq = (secondMessage.d as { seq: number }).seq;
    expect(firstSeq).toBeTypeOf("number");
    expect(secondSeq).toBe(firstSeq + 1);
    socket.close();
  });

  it("rejects Resume when the requested cursor is outside the replay window", async () => {
    const roomName = crypto.randomUUID();
    const original = await openMeetingSocket(roomName);
    const ready = await identifyMeetingSocket(original);
    const room = env.MEETING_ROOM.get(env.MEETING_ROOM.idFromName(roomName));

    for (let index = 0; index < 105; index += 1) {
      await room.fetch("https://internal/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          broadcast_all: true,
          event: `WINDOW_${index}`,
          data: {},
        }),
      });
    }
    original.close();

    const resumedSocket = await openMeetingSocket(roomName);
    const error = nextJsonMessage(resumedSocket);
    resumedSocket.send(
      JSON.stringify({
        op: 7,
        d: { session_id: ready.participant_id, seq_ack: 0 },
      }),
    );
    await expect(error).resolves.toMatchObject({
      op: 18,
      d: { code: 4006 },
    });
    resumedSocket.close();
  });

  it("invalidates continuity after the disconnected replay write budget is spent", async () => {
    const roomName = crypto.randomUUID();
    const original = await openMeetingSocket(roomName);
    const ready = await identifyMeetingSocket(original);
    original.close();
    await new Promise((resolve) => setTimeout(resolve, 20));

    const room = env.MEETING_ROOM.get(env.MEETING_ROOM.idFromName(roomName));
    for (let index = 0; index < 33; index += 1) {
      await room.fetch("https://internal/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          broadcast_all: true,
          event: `OFFLINE_${index}`,
          data: {},
        }),
      });
    }

    const resumedSocket = await openMeetingSocket(roomName);
    const error = nextJsonMessage(resumedSocket);
    resumedSocket.send(
      JSON.stringify({
        op: 7,
        d: { session_id: ready.participant_id, seq_ack: 0 },
      }),
    );

    await expect(error).resolves.toMatchObject({
      op: 18,
      d: { code: 4006 },
    });
    resumedSocket.close();
  });

  it("rejects Resume for an active session that has not disconnected", async () => {
    const roomName = crypto.randomUUID();
    const original = await openMeetingSocket(roomName);
    const ready = await identifyMeetingSocket(original);
    const takeover = await openMeetingSocket(roomName);
    const error = nextJsonMessage(takeover);

    takeover.send(
      JSON.stringify({
        op: 7,
        d: { session_id: ready.participant_id, seq_ack: 0 },
      }),
    );

    await expect(error).resolves.toMatchObject({
      op: 18,
      d: { code: 4006 },
    });

    original.close();
    takeover.close();
  });

  it("rejects Resume when the admitted subject differs from the session subject", async () => {
    const roomName = crypto.randomUUID();
    const original = await openMeetingSocket(roomName, "user-a");
    const ready = await identifyMeetingSocket(original);
    original.close();
    await new Promise((resolve) => setTimeout(resolve, 20));

    const separate = await openMeetingSocket(roomName, "user-b");
    const response = nextJsonMessage(separate);
    separate.send(
      JSON.stringify({
        op: 7,
        d: { session_id: ready.participant_id, seq_ack: 0 },
      }),
    );

    await expect(response).resolves.toMatchObject({
      op: 18,
      d: { code: 4008, message: "Resume subject mismatch" },
    });
    await expect(hasMessageWithOpcode(separate, 9, 100)).resolves.toBe(false);

    separate.close();
  });

  it("delivers an inactive server-channel message once and filters hidden channels", async () => {
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS channels (id TEXT PRIMARY KEY, server_id TEXT, channel_type TEXT NOT NULL)",
    ).run();
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS server_members (server_id TEXT NOT NULL, user_id TEXT NOT NULL)",
    ).run();
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS roles (id TEXT PRIMARY KEY, permissions INTEGER NOT NULL, position INTEGER NOT NULL, is_default INTEGER NOT NULL)",
    ).run();
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS member_roles (server_id TEXT NOT NULL, user_id TEXT NOT NULL, role_id TEXT NOT NULL)",
    ).run();
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS channel_permission_overrides (channel_id TEXT NOT NULL, target_id TEXT NOT NULL, target_type TEXT NOT NULL, allow INTEGER NOT NULL, deny INTEGER NOT NULL)",
    ).run();
    const roomName = crypto.randomUUID();
    const serverId = `server-${crypto.randomUUID()}`;
    const visibleChannelId = `visible-${crypto.randomUUID()}`;
    const hiddenChannelId = `hidden-${crypto.randomUUID()}`;
    const roleId = `role-${crypto.randomUUID()}`;
    await env.DB.prepare(
      "INSERT INTO channels (id, server_id, channel_type) VALUES (?, ?, 'text'), (?, ?, 'text')",
    )
      .bind(visibleChannelId, serverId, hiddenChannelId, serverId)
      .run();
    await env.DB.prepare(
      "INSERT INTO server_members (server_id, user_id) VALUES (?, ?)",
    )
      .bind(serverId, "user-test")
      .run();
    await env.DB.prepare(
      "INSERT INTO roles (id, permissions, position, is_default) VALUES (?, ?, 0, 1)",
    )
      .bind(roleId, PERMISSIONS.VIEW_CHANNELS)
      .run();
    await env.DB.prepare(
      "INSERT INTO member_roles (server_id, user_id, role_id) VALUES (?, ?, ?)",
    )
      .bind(serverId, "user-test", roleId)
      .run();
    await env.DB.prepare(
      "INSERT INTO channel_permission_overrides (channel_id, target_id, target_type, allow, deny) VALUES (?, ?, 'user', 0, ?)",
    )
      .bind(hiddenChannelId, "user-test", PERMISSIONS.VIEW_CHANNELS)
      .run();

    const socket = await openGlobalSocket(roomName);
    await identifyMeetingSocket(socket);
    socket.send(JSON.stringify({ op: 35, d: { server_id: serverId } }));
    await waitForServerSubscribers(roomName, serverId, 1);

    const room = env.MEETING_ROOM.get(env.MEETING_ROOM.idFromName(roomName));
    const visible = nextMessageWithOpcodeWithin(socket, 19);
    await room.fetch("https://internal/broadcast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        server_id: serverId,
        event: "MESSAGE_CREATE",
        data: { id: "inactive-visible", channel_id: visibleChannelId },
      }),
    });
    await expect(visible).resolves.toMatchObject({
      d: { data: { id: "inactive-visible" } },
    });
    await expect(hasMessageWithOpcode(socket, 19, 100)).resolves.toBe(false);

    const hidden = hasMessageWithOpcode(socket, 19, 150);
    await room.fetch("https://internal/broadcast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        server_id: serverId,
        event: "MESSAGE_CREATE",
        data: { id: "inactive-hidden", channel_id: hiddenChannelId },
      }),
    });
    await expect(hidden).resolves.toBe(false);
    socket.close();
  });

  it("rejects oversized voice state attachments without corrupting the session", async () => {
    const roomName = crypto.randomUUID();
    const socket = await openMeetingSocket(roomName);
    await identifyMeetingSocket(socket);
    const observer = await openMeetingSocket(roomName, "observer-user");
    await identifyMeetingSocket(observer);
    const response = nextMessageWithOpcodeWithin(socket, 18);

    socket.send(
      JSON.stringify({
        op: 15,
        d: { stream_preview_url: `https://example.com/${"x".repeat(20_000)}` },
      }),
    );

    await expect(response).resolves.toMatchObject({
      op: 18,
      d: { code: 4000 },
    });
    const heartbeat = nextMessageWithOpcodeWithin(socket, 6);
    socket.send(JSON.stringify({ op: 3, d: { seq_ack: 0 } }));
    await expect(heartbeat).resolves.toMatchObject({ op: 6 });
    const update = nextMessageWithOpcodeWithin(observer, 15);
    socket.send(JSON.stringify({ op: 15, d: { self_deaf: false } }));
    await expect(update).resolves.toMatchObject({
      op: 15,
      d: { participant: { self_mute: true } },
    });
    socket.close();
    observer.close();
  });

  it("does not replay a channel message after channel access is revoked", async () => {
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS channels (id TEXT PRIMARY KEY, server_id TEXT, channel_type TEXT NOT NULL)",
    ).run();
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS server_members (server_id TEXT NOT NULL, user_id TEXT NOT NULL)",
    ).run();
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS roles (id TEXT PRIMARY KEY, permissions INTEGER NOT NULL, position INTEGER NOT NULL, is_default INTEGER NOT NULL)",
    ).run();
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS member_roles (server_id TEXT NOT NULL, user_id TEXT NOT NULL, role_id TEXT NOT NULL)",
    ).run();
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS channel_permission_overrides (channel_id TEXT NOT NULL, target_id TEXT NOT NULL, target_type TEXT NOT NULL, allow INTEGER NOT NULL, deny INTEGER NOT NULL)",
    ).run();

    const roomName = crypto.randomUUID();
    const serverId = `server-${crypto.randomUUID()}`;
    const channelId = `channel-${crypto.randomUUID()}`;
    const roleId = `role-${crypto.randomUUID()}`;
    await env.DB.prepare(
      "INSERT INTO channels (id, server_id, channel_type) VALUES (?, ?, 'text')",
    )
      .bind(channelId, serverId)
      .run();
    await env.DB.prepare(
      "INSERT INTO server_members (server_id, user_id) VALUES (?, ?)",
    )
      .bind(serverId, "user-test")
      .run();
    await env.DB.prepare(
      "INSERT INTO roles (id, permissions, position, is_default) VALUES (?, ?, 0, 1)",
    )
      .bind(roleId, PERMISSIONS.VIEW_CHANNELS)
      .run();
    await env.DB.prepare(
      "INSERT INTO member_roles (server_id, user_id, role_id) VALUES (?, ?, ?)",
    )
      .bind(serverId, "user-test", roleId)
      .run();

    const original = await openGlobalSocket(roomName);
    const ready = await identifyMeetingSocket(original);
    original.send(JSON.stringify({ op: 35, d: { server_id: serverId } }));
    await waitForServerSubscribers(roomName, serverId, 1);
    original.close();
    await waitForResumableSession(roomName, ready.participant_id);

    const room = env.MEETING_ROOM.get(env.MEETING_ROOM.idFromName(roomName));
    await room.fetch("https://internal/broadcast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        server_id: serverId,
        event: "MESSAGE_CREATE",
        data: { id: "revoked-message", channel_id: channelId },
      }),
    });
    await env.DB.prepare(
      "INSERT INTO channel_permission_overrides (channel_id, target_id, target_type, allow, deny) VALUES (?, ?, 'user', 0, ?)",
    )
      .bind(channelId, "user-test", PERMISSIONS.VIEW_CHANNELS)
      .run();

    const resumedSocket = await openGlobalSocket(roomName);
    const orderedMessages: Array<{ op: number; d: unknown }> = [];
    const resumed = new Promise<Array<{ op: number; d: unknown }>>(
      (resolve) => {
        const onMessage = (event: MessageEvent<string>) => {
          const message = JSON.parse(event.data) as { op: number; d: unknown };
          orderedMessages.push(message);
          if (message.op === 9) {
            resumedSocket.removeEventListener("message", onMessage);
            resolve(orderedMessages);
          }
        };
        resumedSocket.addEventListener("message", onMessage);
      },
    );
    resumedSocket.send(
      JSON.stringify({
        op: 7,
        d: { session_id: ready.participant_id, seq_ack: 0 },
      }),
    );

    const messages = await resumed;
    expect(
      messages.some(
        (message) =>
          message.op === 19 &&
          (message.d as { data?: { id?: string } } | null)?.data?.id ===
            "revoked-message",
      ),
    ).toBe(false);
    resumedSocket.close();
  });

  it("leaves immediately when intentional and defers leave on abrupt close", async () => {
    const intentionalRoom = crypto.randomUUID();
    const intentional = await openMeetingSocket(intentionalRoom);
    await identifyMeetingSocket(intentional);
    const intentionalObserver = await openMeetingSocket(
      intentionalRoom,
      "observer-user",
    );
    await identifyMeetingSocket(intentionalObserver);
    intentional.send(JSON.stringify({ op: 11, d: {} }));
    expect(await nextMessageWithOpcode(intentionalObserver, 15)).toMatchObject({
      op: 15,
      d: { action: "leave" },
    });

    const abruptRoom = crypto.randomUUID();
    const abrupt = await openMeetingSocket(abruptRoom);
    await identifyMeetingSocket(abrupt);
    const abruptObserver = await openMeetingSocket(abruptRoom, "observer-user");
    await identifyMeetingSocket(abruptObserver);
    abrupt.close();
    expect(await hasMessageWithOpcode(abruptObserver, 15)).toBe(false);

    intentionalObserver.close();
    abruptObserver.close();
  });

  it("keeps a screen sharer held for resume in rosters and re-announces it on resume", async () => {
    type Participant = { id?: string; name?: string; self_stream?: boolean };
    const participantOf = (message: { d: unknown }) =>
      (message.d as { participant?: Participant; action?: string })
        .participant ?? {};
    const roomName = crypto.randomUUID();

    const sharer = await openMeetingSocket(roomName, "sharer-user");
    const sharerId = (await identifyMeetingSocket(sharer, { name: "Sharer" }))
      .participant_id;
    const viewer = await openMeetingSocket(roomName, "viewer-user");
    const viewerId = (await identifyMeetingSocket(viewer, { name: "Viewer" }))
      .participant_id;

    // The sharer starts a screen share; the viewer sees self_stream.
    const shared = nextMessageWithOpcodeMatching(
      viewer,
      15,
      (message) =>
        participantOf(message).id === sharerId &&
        participantOf(message).self_stream === true,
    );
    sharer.send(JSON.stringify({ op: 15, d: { self_stream: true } }));
    await shared;

    // The sharer's room socket drops (a phone in the background, a network
    // change): no leave goes out and its voice tracks stay.
    sharer.close();
    await waitForResumableSession(roomName, sharerId);

    // A viewer joining meanwhile gets the held sharer in its Ready roster.
    const late = await openMeetingSocket(roomName, "late-viewer");
    const lateReady = await identifyMeetingSocket(late, { name: "Late" });
    expect(lateReady.participants).toContainEqual(
      expect.objectContaining({ id: sharerId, self_stream: true }),
    );

    // A viewer that resumes meanwhile replaces its participant list with the
    // Resumed roster: the held sharer must be in it, or the viewer drops the
    // sharer and its screen until it rejoins.
    viewer.close();
    await waitForResumableSession(roomName, viewerId);
    const viewerAgain = await openMeetingSocket(roomName, "viewer-user");
    const viewerResumed = nextMessageWithOpcode(viewerAgain, 9);
    viewerAgain.send(
      JSON.stringify({ op: 7, d: { session_id: viewerId, seq_ack: 0 } }),
    );
    expect(
      (
        (await viewerResumed).d as {
          participants: Array<Record<string, unknown>>;
        }
      ).participants,
    ).toContainEqual(
      expect.objectContaining({ id: sharerId, self_stream: true }),
    );

    // A credential refresh answers with a Resumed roster too.
    const refreshed = nextMessageWithOpcode(late, 9);
    late.send(JSON.stringify({ op: 40, d: {} }));
    expect(
      ((await refreshed).d as { participants: Array<Record<string, unknown>> })
        .participants,
    ).toContainEqual(
      expect.objectContaining({ id: sharerId, self_stream: true }),
    );

    // When the sharer resumes, the others hear it again in full (an update
    // with its profile), so a client that dropped it brings it back.
    const reannounced = nextMessageWithOpcodeMatching(
      late,
      15,
      (message) =>
        (message.d as { action?: string }).action === "update" &&
        participantOf(message).id === sharerId,
    );
    const sharerAgain = await openMeetingSocket(roomName, "sharer-user");
    const sharerResumed = nextMessageWithOpcode(sharerAgain, 9);
    sharerAgain.send(
      JSON.stringify({ op: 7, d: { session_id: sharerId, seq_ack: 0 } }),
    );
    await sharerResumed;
    expect(participantOf(await reannounced)).toMatchObject({
      id: sharerId,
      name: "Sharer",
      self_stream: true,
    });

    sharerAgain.close();
    viewerAgain.close();
    late.close();
  });

  it("leaves a session held past the resume grace out of the roster", async () => {
    const roomName = crypto.randomUUID();
    const gone = await openMeetingSocket(roomName, "gone-user");
    const goneId = (await identifyMeetingSocket(gone)).participant_id;
    gone.close();
    await waitForResumableSession(roomName, goneId);
    await runInDurableObject(meetingRoom(roomName), (instance) => {
      (
        instance as unknown as { resumableSessionExpiry: Map<string, number> }
      ).resumableSessionExpiry.set(goneId, Date.now() - 121_000);
    });

    const late = await openMeetingSocket(roomName, "late-user");
    const ready = await identifyMeetingSocket(late);
    expect(
      ready.participants.map((participant) => participant.id),
    ).not.toContain(goneId);
    late.close();
  });
});

describe("MeetingRoom gateway protocol edge", () => {
  /** A mistyped payload per opcode (non-objects are sent too). */
  const MISTYPED_PAYLOADS = new Map<number, unknown>([
    [GatewayOp.Identify, { name: 5 }],
    [GatewayOp.Resume, { session_id: "s", seq_ack: "0" }],
    [GatewayOp.VoiceStateUpdate, { self_mute: "yes" }],
    [GatewayOp.MessageCreate, { channel_id: "c", content: 5 }],
    [GatewayOp.MessageUpdate, { message_id: "m" }],
    [GatewayOp.MessageDelete, { message_id: "m", channel_id: null }],
    [GatewayOp.TypingStart, { channel_id: 1 }],
    [GatewayOp.ReactionAdd, { channel_id: "c", message_id: "m", emoji: 1 }],
    [GatewayOp.ReactionRemove, { channel_id: "c", message_id: "m" }],
    [GatewayOp.ChannelSubscribe, {}],
    [GatewayOp.ChannelUnsubscribe, { channel_id: ["c"] }],
    [GatewayOp.PresenceUpdate, { status: 1 }],
    [GatewayOp.VoiceChannelJoin, { channel_id: "c", self_mute: "no" }],
    [GatewayOp.VoiceChannelLeave, { channel_id: 5 }],
    [GatewayOp.ServerSubscribe, { server_id: [] }],
    [GatewayOp.CallInitiate, { target_user_id: "u" }],
    [GatewayOp.CallAccept, { call_id: 1 }],
    [GatewayOp.CallDecline, { call_id: null }],
    [GatewayOp.CallEnd, {}],
  ]);
  const payloadOps = Object.entries(mainGatewayClientRules).flatMap(
    ([op, rule]) => (rule ? [[Number(op), rule.invalid] as const] : []),
  );
  /** Each payload opcode on each MeetingRoom role that accepts it. */
  const payloadOpsByRole = (["global", "room"] as const).flatMap((role) =>
    payloadOps
      .filter(([op]) => SOCKET_ROLE_OPCODES[role].has(op))
      .map(([op, invalid]) => [op, role, invalid] as const),
  );

  /** Everything a client frame could change, without heartbeat fields. */
  async function roomState(roomName: string) {
    return runInDurableObject(meetingRoom(roomName), (instance) => {
      const live = instance as unknown as {
        sessions: Map<unknown, Record<string, unknown>>;
        channelSubscriptions: Map<string, unknown>;
        serverSubscriptions: Map<string, unknown>;
        pendingCalls: Map<string, unknown>;
        spatialAudioStates: Map<string, unknown>;
      };
      return JSON.stringify({
        sessions: [...live.sessions.values()].map((session) => {
          const {
            last_heartbeat: _lastHeartbeat,
            seq: _seq,
            ...rest
          } = session;
          return rest;
        }),
        channels: [...live.channelSubscriptions.keys()],
        servers: [...live.serverSubscriptions.keys()],
        calls: [...live.pendingCalls.keys()],
        spatial: [...live.spatialAudioStates.keys()],
      });
    });
  }

  async function nextRawMessage(socket: WebSocket) {
    const message = await new Promise<MessageEvent<string>>((resolve) => {
      socket.addEventListener("message", resolve, { once: true });
    });
    return message.data;
  }

  it("has a mistyped payload for every opcode with a payload", () => {
    expect([...MISTYPED_PAYLOADS.keys()].sort((a, b) => a - b)).toEqual(
      payloadOps.map(([op]) => op).sort((a, b) => a - b),
    );
  });

  it("checks every payload opcode on at least one role", () => {
    expect(new Set(payloadOpsByRole.map(([op]) => op)).size).toBe(
      payloadOps.length,
    );
  });

  it.each(payloadOpsByRole)(
    "answers malformed opcode %s payloads on the %s socket with %j and changes nothing",
    async (op, role, invalid) => {
      const roomName = crypto.randomUUID();
      const socket =
        role === "global"
          ? await openGlobalSocket(roomName)
          : await openMeetingSocket(roomName);
      if (op !== GatewayOp.Identify) await identifyMeetingSocket(socket);
      const before = await roomState(roomName);

      for (const d of [
        undefined,
        null,
        [],
        "text",
        7,
        MISTYPED_PAYLOADS.get(op),
      ]) {
        const reply = nextJsonMessage(socket);
        socket.send(JSON.stringify({ op, d }));
        expect(await reply).toEqual({
          op: 18,
          d: { code: 4000, message: invalid },
        });
      }

      expect(await roomState(roomName)).toBe(before);
      const ack = nextJsonMessage(socket);
      socket.send(HEARTBEAT_FRAME);
      await expect(ack).resolves.toMatchObject({ op: 6 });
      socket.close();
    },
  );

  it("sends the same error bytes as before for edge failures", async () => {
    const socket = await openGlobalSocket();
    await identifyMeetingSocket(socket);
    const cases: Array<[string, string]> = [
      ["not-json", '{"op":18,"d":{"code":4002,"message":"Invalid JSON"}}'],
      ['{"d":{}}', '{"op":18,"d":{"code":4001,"message":"Missing opcode"}}'],
      [
        '{"op":999,"d":{}}',
        '{"op":18,"d":{"code":4001,"message":"Unknown opcode: 999"}}',
      ],
      [
        '{"op":23,"d":null}',
        '{"op":18,"d":{"code":4000,"message":"Invalid typing payload"}}',
      ],
    ];
    for (const [sent, expected] of cases) {
      const reply = nextRawMessage(socket);
      socket.send(sent);
      expect(await reply).toBe(expected);
    }
    socket.close();
  });

  it("accepts keys it does not know, as a newer client may send", async () => {
    const roomName = crypto.randomUUID();
    const sender = await openMeetingSocket(roomName);
    const ready = await identifyMeetingSocket(sender);
    const observer = await openMeetingSocket(roomName, "observer-user");
    await identifyMeetingSocket(observer);

    const update = nextMessageWithOpcodeMatching(
      observer,
      15,
      (message) =>
        (message.d as { participant?: { id?: string } }).participant?.id ===
        ready.participant_id,
    );
    sender.send(
      JSON.stringify({
        op: 15,
        d: { self_mute: true, added_by_a_newer_client: { nested: [1] } },
      }),
    );
    expect(await update).toMatchObject({
      d: { participant: { self_mute: true }, action: "update" },
    });
    sender.close();
    observer.close();
  });
});

/** Resolves with the close code the client socket receives from the room. */
function closeOf(socket: WebSocket) {
  return new Promise<{ code: number; reason: string }>((resolve) => {
    socket.addEventListener(
      "close",
      (event) => resolve({ code: event.code, reason: event.reason }),
      { once: true },
    );
  });
}

/**
 * A heartbeat that carries a payload is not auto-answered by the runtime, so
 * its ack proves the room handled every frame sent before it.
 */
async function settled(socket: WebSocket) {
  const ack = nextMessageWithOpcode(socket, 6);
  socket.send(JSON.stringify({ op: 3, d: { settle: true } }));
  await ack;
}

async function openVoiceRoomSocket(roomName: string, subject: string) {
  const voiceRoom = env.VOICE_ROOM.get(env.VOICE_ROOM.idFromName(roomName));
  const response = await voiceRoom.fetch(
    `https://internal/api/channels/${roomName}/voice?v=1`,
    { headers: await createVoiceAdmissionHeaders(roomName, subject) },
  );
  expect(response.status).toBe(101);
  const voiceSocket = response.webSocket;
  if (!voiceSocket) throw new Error("Expected VoiceRoom WebSocket");
  voiceSocket.accept();
  await nextMessageWithOpcode(voiceSocket, 8);
  return voiceSocket;
}

async function identifyVoiceRoomSocket(
  voiceSocket: WebSocket,
  ready: { participant_id: string; voice_token: string },
) {
  const voiceReady = nextMessageWithOpcode(voiceSocket, 101);
  voiceSocket.send(
    JSON.stringify({
      op: 100,
      d: {
        participant_id: ready.participant_id,
        voice_token: ready.voice_token,
      },
    }),
  );
  expect((await voiceReady).d).toMatchObject({
    participant_id: ready.participant_id,
  });
}

describe("MeetingRoom one voice session per user", () => {
  const participantIds = (ready: { participants: Array<{ id?: unknown }> }) =>
    ready.participants.map((participant) => participant.id);
  const hasResumableSession = (roomName: string, sessionId: string) =>
    runInDurableObject(meetingRoom(roomName), (instance) =>
      (
        instance as unknown as {
          resumableSessions: Map<string, unknown>;
        }
      ).resumableSessions.has(sessionId),
    );

  it("ends the user's other session when a newer one identifies", async () => {
    const roomName = crypto.randomUUID();
    const userId = "takeover-user";
    const first = await openMeetingSocket(roomName, userId);
    const firstReady = await identifyMeetingSocket(first, { name: "Phone" });
    const observer = await openMeetingSocket(roomName, "takeover-observer");
    const observerReady = await identifyMeetingSocket(observer, {
      name: "Observer",
    });

    const firstError = nextMessageWithOpcode(first, 18);
    const firstClosed = closeOf(first);
    const observerSawLeave = nextMessageWithOpcodeMatching(
      observer,
      15,
      (message) => {
        const d = message.d as {
          action?: string;
          participant?: { id?: string };
        };
        return (
          d.action === "leave" &&
          d.participant?.id === firstReady.participant_id
        );
      },
    );

    const second = await openMeetingSocket(roomName, userId);
    const secondReady = await identifyMeetingSocket(second, { name: "Laptop" });

    await expect(firstError).resolves.toMatchObject({
      op: 18,
      d: { code: 4010, message: "Voice moved to another device" },
    });
    await expect(firstClosed).resolves.toMatchObject({ code: 4010 });
    await expect(observerSawLeave).resolves.toMatchObject({
      d: { action: "leave" },
    });
    expect(participantIds(secondReady)).not.toContain(
      firstReady.participant_id,
    );
    expect(participantIds(secondReady)).toContain(observerReady.participant_id);
    // The replaced session is gone for good, not held for resume.
    expect(await hasResumableSession(roomName, firstReady.participant_id)).toBe(
      false,
    );

    observer.close();
    second.close();
  });

  it("closes the replaced session's VoiceRoom socket the same way", async () => {
    const roomName = crypto.randomUUID();
    const userId = "takeover-voice-user";
    const first = await openMeetingSocket(roomName, userId);
    const firstReady = await identifyMeetingSocket(first);
    const firstVoice = await openVoiceRoomSocket(roomName, userId);
    await identifyVoiceRoomSocket(firstVoice, firstReady);

    const voiceError = nextMessageWithOpcode(firstVoice, 18);
    const voiceClosed = closeOf(firstVoice);
    const second = await openMeetingSocket(roomName, userId);
    await identifyMeetingSocket(second);

    await vi.waitFor(
      async () => {
        await expect(voiceError).resolves.toMatchObject({
          op: 18,
          d: { code: 4010, message: "Voice moved to another device" },
        });
        await expect(voiceClosed).resolves.toMatchObject({ code: 4010 });
      },
      { timeout: 5_000, interval: 10 },
    );

    second.close();
  });

  it("answers a Resume of a held, replaced session with SessionReplaced", async () => {
    const roomName = crypto.randomUUID();
    const userId = "held-takeover-user";
    const first = await openMeetingSocket(roomName, userId);
    const firstReady = await identifyMeetingSocket(first);
    first.close();
    await waitForResumableSession(roomName, firstReady.participant_id);

    const second = await openMeetingSocket(roomName, userId);
    await identifyMeetingSocket(second);
    expect(await hasResumableSession(roomName, firstReady.participant_id)).toBe(
      false,
    );

    // The device that was offline during the takeover tries to claim it back.
    const stale = await openMeetingSocket(roomName, userId);
    const staleError = nextMessageWithOpcode(stale, 18);
    const staleClosed = closeOf(stale);
    stale.send(
      JSON.stringify({
        op: 7,
        d: { session_id: firstReady.participant_id, seq_ack: 0 },
      }),
    );

    await expect(staleError).resolves.toMatchObject({
      op: 18,
      d: { code: 4010 },
    });
    await expect(staleClosed).resolves.toMatchObject({ code: 4010 });

    second.close();
  });

  it("leaves the live session alone for a standby identify until it is promoted", async () => {
    const roomName = crypto.randomUUID();
    const userId = "standby-takeover-user";
    const first = await openMeetingSocket(roomName, userId);
    const firstReady = await identifyMeetingSocket(first);
    const firstMessages: Array<{ op: number; d: unknown }> = [];
    first.addEventListener("message", (event) => {
      firstMessages.push(JSON.parse(event.data as string));
    });
    let firstClosedEarly = false;
    first.addEventListener("close", () => {
      firstClosedEarly = true;
    });

    const standby = await openMeetingSocket(roomName, userId);
    const standbyReady = nextMessageWithOpcode(standby, 2);
    standby.send(
      JSON.stringify({ op: 0, d: { name: "Warming", standby: true } }),
    );
    await standbyReady;

    await settled(first);
    expect(firstMessages.filter((message) => message.op === 18)).toEqual([]);
    expect(firstClosedEarly).toBe(false);
    const liveIds = await runInDurableObject(
      meetingRoom(roomName),
      (instance) =>
        [
          ...(
            instance as unknown as {
              sessions: Map<unknown, { id: string }>;
            }
          ).sessions.values(),
        ].map((session) => session.id),
    );
    expect(liveIds).toContain(firstReady.participant_id);

    const firstError = nextMessageWithOpcode(first, 18);
    const firstClosed = closeOf(first);
    standby.send(
      JSON.stringify({
        op: 15,
        d: { promote_standby: true, self_mute: false, self_deaf: false },
      }),
    );

    await expect(firstError).resolves.toMatchObject({
      op: 18,
      d: { code: 4010 },
    });
    await expect(firstClosed).resolves.toMatchObject({ code: 4010 });

    standby.close();
  });

  it("drops an Identify whose socket closed before it finished", async () => {
    const roomName = crypto.randomUUID();
    const userId = "closed-mid-identify-user";
    const room = meetingRoom(roomName);
    // Hold the first Identify's TURN step open (plain flags: a promise made
    // here cannot be awaited inside the room).
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

    const stale = await openMeetingSocket(roomName, userId);
    stale.send(JSON.stringify({ op: 0, d: { name: "Old tab" } }));
    await vi.waitFor(() => {
      expect(turn.calls).toBe(1);
    });
    const staleClosed = closeOf(stale);
    stale.close(1000, "tab closed");
    await staleClosed;

    const current = await openMeetingSocket(roomName, userId);
    const currentMessages: Array<{ op: number; d: unknown }> = [];
    current.addEventListener("message", (event) => {
      currentMessages.push(JSON.parse(event.data as string));
    });
    let currentClosed = false;
    const currentClose = closeOf(current).then((close) => {
      currentClosed = true;
      return close;
    });
    const currentReady = await identifyMeetingSocket(current, {
      name: "New tab",
    });

    turn.released = true;
    await vi.waitFor(async () => {
      const identifying = await runInDurableObject(
        room,
        (instance) =>
          (
            instance as unknown as {
              identifyingVoiceJoins: Map<string, string>;
            }
          ).identifyingVoiceJoins.size,
      );
      expect(identifying).toBe(0);
    });
    // A replaced socket is closed and never acks.
    await Promise.race([settled(current), currentClose]);

    expect(currentMessages.filter((message) => message.op === 18)).toEqual([]);
    expect(currentClosed).toBe(false);
    const sessionIds = await runInDurableObject(room, (instance) =>
      [
        ...(
          instance as unknown as {
            sessions: Map<WebSocket, { id: string }>;
          }
        ).sessions.values(),
      ].map((session) => session.id),
    );
    expect(sessionIds).toEqual([currentReady.participant_id]);

    current.close();
  });

  it("never replaces a different user's session", async () => {
    const roomName = crypto.randomUUID();
    const first = await openMeetingSocket(roomName, "peer-one");
    const firstReady = await identifyMeetingSocket(first);
    const firstMessages: Array<{ op: number; d: unknown }> = [];
    first.addEventListener("message", (event) => {
      firstMessages.push(JSON.parse(event.data as string));
    });
    let firstClosed = false;
    first.addEventListener("close", () => {
      firstClosed = true;
    });

    const second = await openMeetingSocket(roomName, "peer-two");
    const secondReady = await identifyMeetingSocket(second);

    await settled(first);
    expect(firstMessages.filter((message) => message.op === 18)).toEqual([]);
    expect(firstClosed).toBe(false);
    expect(participantIds(secondReady)).toContain(firstReady.participant_id);

    first.close();
    second.close();
  });
});

describe("VoiceRoom reaper confirms a joined participant", () => {
  it("keeps a participant the MeetingRoom still reports as joined", async () => {
    const roomName = crypto.randomUUID();
    const userId = "reaper-survivor";
    const meetingSocket = await openMeetingSocket(roomName, userId);
    const ready = await identifyMeetingSocket(meetingSocket);
    const voiceSocket = await openVoiceRoomSocket(roomName, userId);
    await identifyVoiceRoomSocket(voiceSocket, ready);
    const voiceRoom = env.VOICE_ROOM.get(env.VOICE_ROOM.idFromName(roomName));

    // Age the grant past the recheck window so the next alarm must ask the
    // MeetingRoom about it.
    const staleAt = Date.now() - 10 * 60_000;
    await runInDurableObject(voiceRoom, (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE voice_join_grants SET updated_at = ? WHERE participant_id = ?",
        staleAt,
        ready.participant_id,
      );
    });
    let voiceClosed = false;
    voiceSocket.addEventListener("close", () => {
      voiceClosed = true;
    });

    expect(await runDurableObjectAlarm(voiceRoom)).toBe(true);

    const { rows, confirmedAt } = await runInDurableObject(
      voiceRoom,
      (_instance, state) => ({
        rows: [
          ...state.storage.sql.exec(
            "SELECT id FROM participants WHERE id = ?",
            ready.participant_id,
          ),
        ].length,
        confirmedAt: state.storage.sql
          .exec(
            "SELECT updated_at FROM voice_join_grants WHERE participant_id = ?",
            ready.participant_id,
          )
          .one().updated_at as number,
      }),
    );
    expect(rows).toBe(1);
    expect(confirmedAt).toBeGreaterThan(staleAt + 5 * 60_000);
    expect(voiceClosed).toBe(false);

    meetingSocket.close();
    voiceSocket.close();
  });
});
