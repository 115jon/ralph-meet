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

async function createAdmissionHeaders(
  roomName: string,
  audience: "global" | "room",
) {
  const roomSlug = audience === "global" ? "global-gateway" : roomName;
  const ticket = await issueSocketTicket(
    {
      accessMode: "authenticated",
      audience,
      expiresAt: Date.now() + 60_000,
      nonce: crypto.randomUUID(),
      roomSlug,
      subject: "user-test",
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
): Promise<WebSocket> {
  const roomId = env.MEETING_ROOM.idFromName(roomName);
  const room = env.MEETING_ROOM.get(roomId);
  const response = await room.fetch(
    `https://internal/api/channels/${roomName}/ws?v=1`,
    {
      headers: await createAdmissionHeaders(roomName, "room"),
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

    other.close();
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
