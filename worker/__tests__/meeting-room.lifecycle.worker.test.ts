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

async function identifyMeetingSocket(socket: WebSocket) {
  const response = nextJsonMessage(socket);
  socket.send(
    JSON.stringify({
      op: 0,
      d: { name: "Test User", clerk_user_id: "forged-user" },
    }),
  );
  return (await response).d as {
    participant_id: string;
    voice_token: string;
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

  it("replays retained dispatches before Resumed after a valid Resume", async () => {
    const roomName = crypto.randomUUID();
    const original = await openMeetingSocket(roomName);
    const originalReady = await identifyMeetingSocket(original);
    const other = await openMeetingSocket(roomName);
    await identifyMeetingSocket(other);

    original.send(JSON.stringify({ op: 3, d: { seq_ack: 0 } }));
    await expect(nextMessageWithOpcode(original, 6)).resolves.toMatchObject({
      op: 6,
      d: { seq: 1 },
    });

    const room = env.MEETING_ROOM.get(env.MEETING_ROOM.idFromName(roomName));
    const dispatch = nextMessageWithOpcodeWithin(original, 19);
    await room.fetch("https://internal/broadcast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        broadcast_all: true,
        event: "REPLAY_ME",
        data: {},
      }),
    });
    await expect(dispatch).resolves.toMatchObject({
      op: 19,
      d: { event: "REPLAY_ME" },
    });

    original.close();
    await new Promise((resolve) => setTimeout(resolve, 20));

    const resumedSocket = await openMeetingSocket(roomName);
    const replay = nextJsonMessage(resumedSocket);
    resumedSocket.send(
      JSON.stringify({
        op: 7,
        d: { session_id: originalReady.participant_id, seq_ack: 0 },
      }),
    );

    await expect(replay).resolves.toMatchObject({
      op: 19,
      d: { event: "REPLAY_ME" },
    });
    expect(await nextJsonMessage(resumedSocket)).toMatchObject({ op: 9 });

    const duplicateSocket = await openMeetingSocket(roomName);
    const duplicateError = nextJsonMessage(duplicateSocket);
    duplicateSocket.send(
      JSON.stringify({
        op: 7,
        d: { session_id: originalReady.participant_id, seq_ack: 0 },
      }),
    );
    await expect(duplicateError).resolves.toMatchObject({
      op: 18,
      d: { code: 4006, message: "Session not found for resume" },
    });

    other.close();
    resumedSocket.close();
    duplicateSocket.close();
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
