import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  issueSocketTicket,
  verifySocketTicket,
} from "../../src/lib/voice/socket-ticket";
import {
  appendRealtimeAdmissionHeaders,
  createRealtimeAdmissionContext,
} from "../realtime-admission";
import { PERMISSIONS } from "../../src/lib/permissions";

async function createAdmissionHeaders(
  roomName: string,
  audience: "global" | "room",
  subject = "user-test",
) {
  const roomSlug = audience === "global" ? "global-gateway" : roomName;
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

async function createVoiceAdmissionHeaders(roomName: string) {
  const ticket = await issueSocketTicket(
    {
      accessMode: "authenticated",
      audience: "voice",
      expiresAt: Date.now() + 60_000,
      nonce: crypto.randomUUID(),
      roomSlug: roomName,
      subject: "user-test",
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
  roomName = crypto.randomUUID(),
  subject = "user-test",
): Promise<WebSocket> {
  const roomId = env.MEETING_ROOM.idFromName(roomName);
  const room = env.MEETING_ROOM.get(roomId);
  const response = await room.fetch(
    `https://internal/api/channels/${roomName}/ws?v=1`,
    {
      headers: await createAdmissionHeaders(roomName, "room", subject),
    },
  );

  expect(response.status).toBe(101);
  expect(response.webSocket).not.toBeNull();

  const socket = response.webSocket;
  if (!socket) {
    throw new Error("Expected WebSocket upgrade response");
  }

  socket.accept();
  await nextJsonMessage(socket);
  return socket;
}

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
  const response = nextJsonMessage(socket);
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
        clerk_user_id: "forged-user",
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

async function nextDispatchEventWithin(
  socket: WebSocket,
  eventName: string,
  timeoutMs = 2_000,
) {
  return Promise.race([
    nextDispatchEvent(socket, eventName),
    new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error(`Timed out waiting for event ${eventName}`)),
        timeoutMs,
      );
    }),
  ]);
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

    const legacy = await openMeetingSocket(roomName, "profile-legacy");
    await identifyMeetingSocket(legacy, {
      name: "Legacy Name",
      username: "legacy-user",
      display_name: "Legacy Display",
      avatar_url: "https://example.com/legacy.png",
      avatar_display: "frame:legacy",
    });
    await nextMessageWithOpcode(capable, 15);

    const capableJoin = nextMessageWithOpcode(capable, 15);
    const legacyJoin = nextMessageWithOpcode(legacy, 15);
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
        clerk_user_id: "profile-sender",
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
        clerk_user_id: "profile-sender",
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
    const legacy = await openMeetingSocket(roomName, "replay-legacy");
    const legacyReady = await identifyMeetingSocket(legacy);
    await nextMessageWithOpcode(capable, 15);

    const capableSenderJoin = nextMessageWithOpcode(capable, 15);
    const legacySenderJoin = nextMessageWithOpcode(legacy, 15);
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
        clerk_user_id: "replay-sender",
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
        clerk_user_id: "replay-sender",
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
    ).toEqual([1, 2, 3, 4]);

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
    await env.CACHE.put(
      `clerk:profile:${userId}`,
      JSON.stringify({ name: "Cached Profile" }),
      { expirationTtl: 300 },
    );

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
    const fresh = await openMeetingSocket(roomName, userId);
    await identifyMeetingSocket(fresh);
    const freshJoin = nextDispatchEvent(fresh, "VOICE_CHANNEL_STATE_UPDATE");
    fresh.send(
      JSON.stringify({
        op: 33,
        d: { channel_id: channelId, self_mute: true },
      }),
    );
    await freshJoin;

    const stale = await openMeetingSocket(roomName, userId);
    const staleReady = await identifyMeetingSocket(stale);
    const staleJoin = nextDispatchEvent(fresh, "VOICE_CHANNEL_STATE_UPDATE");
    stale.send(
      JSON.stringify({
        op: 33,
        d: { channel_id: channelId, self_mute: true },
      }),
    );
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
    await staleDisconnect;

    const resumed = await openMeetingSocket(roomName, userId);
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
              clerk_user_id: userId,
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
    const first = await openMeetingSocket(roomName, userId);
    await identifyMeetingSocket(first);
    const firstJoin = nextDispatchEventMatching(
      first,
      "VOICE_CHANNEL_STATE_UPDATE",
      (message) =>
        (message.d as { data?: { channel_id?: string } }).data?.channel_id ===
        firstChannelId,
    );
    first.send(
      JSON.stringify({
        op: 33,
        d: { channel_id: firstChannelId, self_mute: true },
      }),
    );
    await expect(firstJoin).resolves.toBeDefined();

    const stale = await openMeetingSocket(roomName, userId);
    await identifyMeetingSocket(stale);
    const secondJoin = nextDispatchEventMatching(
      stale,
      "VOICE_CHANNEL_STATE_UPDATE",
      (message) =>
        (message.d as { data?: { channel_id?: string } }).data?.channel_id ===
        secondChannelId,
    );
    stale.send(
      JSON.stringify({
        op: 33,
        d: { channel_id: secondChannelId, self_mute: true },
      }),
    );
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
    const fresh = await openMeetingSocket(roomName, userId);
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
    first.send(JSON.stringify({ op: 15, d: { self_mute: false } }));
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

    await env.CACHE.put(
      `clerk:profile:${userId}`,
      JSON.stringify({ name: "Cached Profile", imageUrl: "cached.png" }),
      { expirationTtl: 300 },
    );

    const roomName = crypto.randomUUID();
    const first = await Promise.race([
      openMeetingSocket(roomName, userId),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("first socket timed out")), 1_000),
      ),
    ]);
    await identifyMeetingSocket(first);

    const stale = await openMeetingSocket(roomName, userId);
    const staleReady = await identifyMeetingSocket(stale);
    stale.close();
    await new Promise((resolve) => setTimeout(resolve, 20));

    const second = await openMeetingSocket(roomName, userId);
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

    const identifyRefresh = await openMeetingSocket(roomName, userId);
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

    const resumed = await openMeetingSocket(roomName, userId);
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

    const first = await openMeetingSocket(roomName, firstUserId);
    await identifyMeetingSocket(first, {
      name: "Sidebar First",
      username: "sidebar-first",
      display_name: "Sidebar First Display",
      avatar_url: "https://example.com/sidebar-first.png",
      avatar_display: "frame:sidebar-first",
      supports_voice_state_deltas: true,
    });
    first.send(
      JSON.stringify({
        op: 33,
        d: { channel_id: channelId, self_mute: true },
      }),
    );

    const second = await openMeetingSocket(roomName, secondUserId);
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
    second.send(
      JSON.stringify({
        op: 33,
        d: { channel_id: channelId, self_mute: false },
      }),
    );
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
    first.send(JSON.stringify({ op: 15, d: { self_mute: false } }));
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
      (member) => member.clerk_user_id === firstUserId,
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
      (member) => member.clerk_user_id === firstUserId,
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

  it("sends full profiles when a call inserts a new sidebar member", async () => {
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

    const caller = await openMeetingSocket(roomName, callerId);
    await identifyMeetingSocket(caller, {
      name: "Call Caller",
      username: "call-caller",
      display_name: "Call Caller Display",
      avatar_url: "https://example.com/call-caller.png",
      avatar_display: "frame:call-caller",
    });
    const callee = await openMeetingSocket(roomName, calleeId);
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
        ).data?.members?.some((member) => member.clerk_user_id === callerId) ??
        false,
    );
    caller.send(
      JSON.stringify({
        op: 36,
        d: { target_user_id: calleeId, channel_id: channelId },
      }),
    );

    await expect(sidebarUpdate).resolves.toMatchObject({
      d: {
        data: {
          channel_id: channelId,
          members: [
            expect.objectContaining({
              clerk_user_id: callerId,
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
      const socket = await openMeetingSocket();
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
    const socket = await openMeetingSocket("global-gateway");
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

  it("binds Identify to the admitted subject instead of clerk_user_id", async () => {
    const roomName = crypto.randomUUID();
    const socket = await openMeetingSocket(roomName);
    const ready = nextJsonMessage(socket);

    socket.send(
      JSON.stringify({
        op: 0,
        d: {
          clerk_user_id: "forged-user",
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
    const socket = await openMeetingSocket(roomName);
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

    const socket = await openMeetingSocket(crypto.randomUUID());
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
          body: JSON.stringify({ participant_id: participantId }),
        },
      );
      await expect(sessionCheck.json()).resolves.toEqual({
        disconnected: false,
      });
      socket.close();
      voiceSocket.close();
    },
  );

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
    const sender = await openMeetingSocket(sharedRoomName, "user-test");
    await identifyMeetingSocket(sender);
    const recipient = await openMeetingSocket(sharedRoomName, "user-recipient");
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

    const first = await openMeetingSocket(roomName, "user-duplicate");
    await identifyMeetingSocket(first);
    const second = await openMeetingSocket(roomName, "user-duplicate");
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

    const socketA = await openMeetingSocket(roomName, "user-a");
    await identifyMeetingSocket(socketA);
    const socketB = await openMeetingSocket(roomName, "user-b");
    await identifyMeetingSocket(socketB);

    socketA.send(JSON.stringify({ op: 35, d: { server_id: serverA } }));
    socketB.send(JSON.stringify({ op: 35, d: { server_id: serverB } }));
    await new Promise((resolve) => setTimeout(resolve, 25));

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

    const memberSocket = await openMeetingSocket(roomName, "user-member");
    await identifyMeetingSocket(memberSocket);
    const outsiderSocket = await openMeetingSocket(roomName, "user-outsider");
    await identifyMeetingSocket(outsiderSocket);

    memberSocket.send(JSON.stringify({ op: 35, d: { server_id: serverId } }));
    outsiderSocket.send(JSON.stringify({ op: 35, d: { server_id: serverId } }));
    await new Promise((resolve) => setTimeout(resolve, 25));

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

    const caller = await openMeetingSocket(roomName, "user-test");
    await identifyMeetingSocket(caller);
    const callee = await openMeetingSocket(roomName, "user-callee");
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

    const original = await openMeetingSocket(roomName);
    const ready = await identifyMeetingSocket(original);
    original.send(JSON.stringify({ op: 35, d: { server_id: serverId } }));
    await new Promise((resolve) => setTimeout(resolve, 25));

    original.close();
    await new Promise((resolve) => setTimeout(resolve, 20));

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

    const resumedSocket = await openMeetingSocket(roomName);
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

    const socket = await openMeetingSocket(roomName);
    await identifyMeetingSocket(socket);
    socket.send(JSON.stringify({ op: 35, d: { server_id: serverId } }));
    await new Promise((resolve) => setTimeout(resolve, 25));

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
    const observer = await openMeetingSocket(roomName);
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

    const original = await openMeetingSocket(roomName);
    const ready = await identifyMeetingSocket(original);
    original.send(JSON.stringify({ op: 35, d: { server_id: serverId } }));
    await new Promise((resolve) => setTimeout(resolve, 25));
    original.close();
    await new Promise((resolve) => setTimeout(resolve, 20));

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

    const resumedSocket = await openMeetingSocket(roomName);
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
    const intentionalObserver = await openMeetingSocket(intentionalRoom);
    await identifyMeetingSocket(intentionalObserver);
    intentional.send(JSON.stringify({ op: 11, d: {} }));
    expect(await nextMessageWithOpcode(intentionalObserver, 15)).toMatchObject({
      op: 15,
      d: { action: "leave" },
    });

    const abruptRoom = crypto.randomUUID();
    const abrupt = await openMeetingSocket(abruptRoom);
    await identifyMeetingSocket(abrupt);
    const abruptObserver = await openMeetingSocket(abruptRoom);
    await identifyMeetingSocket(abruptObserver);
    abrupt.close();
    expect(await hasMessageWithOpcode(abruptObserver, 15)).toBe(false);

    intentionalObserver.close();
    abruptObserver.close();
  });
});
