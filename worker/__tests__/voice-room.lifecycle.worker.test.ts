import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { issueSocketTicket, verifySocketTicket } from "../../src/lib/voice/socket-ticket";
import {
  appendRealtimeAdmissionHeaders,
  createRealtimeAdmissionContext,
} from "../realtime-admission";

const textEncoder = new TextEncoder();
const TEST_SUBJECT = "user-test";

async function createAdmissionHeaders(
  roomName: string,
  subject = TEST_SUBJECT,
  accessMode: "authenticated" | "public-demo" = "authenticated",
) {
  const ticket = await issueSocketTicket({
    accessMode,
    audience: "voice",
    expiresAt: Date.now() + 60_000,
    nonce: crypto.randomUUID(),
    roomSlug: roomName,
    subject,
  }, env.CALLS_APP_SECRET);
  const verification = await verifySocketTicket(ticket, env.CALLS_APP_SECRET, {
    accessMode,
    audience: "voice",
    now: Date.now(),
    roomSlug: roomName,
  });
  if (!verification.ok) throw new Error("Expected test ticket to verify");
  return appendRealtimeAdmissionHeaders(new Headers({ Upgrade: "websocket" }), await createRealtimeAdmissionContext(verification.claims));
}

async function openVoiceSocket(
  roomName = crypto.randomUUID(),
  subject = TEST_SUBJECT,
  accessMode: "authenticated" | "public-demo" = "authenticated",
): Promise<WebSocket> {
  const roomId = env.VOICE_ROOM.idFromName(roomName);
  const room = env.VOICE_ROOM.get(roomId);
  const response = await room.fetch(`https://internal/api/channels/${roomName}/voice?v=1`, {
    headers: await createAdmissionHeaders(roomName, subject, accessMode),
  });

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

async function nextJsonMessage(socket: WebSocket): Promise<{ op: number; d: unknown }> {
  const message = await new Promise<MessageEvent<string>>((resolve) => {
    socket.addEventListener("message", resolve, { once: true });
  });
  return JSON.parse(message.data) as { op: number; d: unknown };
}

async function nextMessageWithOpcode(socket: WebSocket, opcode: number): Promise<{ op: number; d: unknown }> {
  while (true) {
    const message = await nextJsonMessage(socket);
    if (message.op === opcode) return message;
  }
}

async function issueVoiceToken(participantId: string, roomName: string, subject = TEST_SUBJECT): Promise<string> {
  const payload = `${participantId}:${roomName}:${Date.now()}:${subject}`;
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(env.CALLS_APP_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, textEncoder.encode(payload));
  const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature)));
  return `${payload}.${encodedSignature}`;
}

async function identifyVoiceSocket(socket: WebSocket, participantId: string, roomName: string, subject = TEST_SUBJECT) {
  const response = nextJsonMessage(socket);
  socket.send(JSON.stringify({
    op: 100,
    d: {
      participant_id: participantId,
      voice_token: await issueVoiceToken(participantId, roomName, subject),
    },
  }));

  expect(await response).toMatchObject({
    op: 101,
    d: { participant_id: participantId },
  });
}

describe("VoiceRoom lifecycle", () => {
  it("accepts a hibernatable voice socket and sends Hello", async () => {
    const roomId = env.VOICE_ROOM.idFromName("lifecycle-test-room");
    const room = env.VOICE_ROOM.get(roomId);
    const response = await room.fetch("https://internal/api/channels/lifecycle-test-room/voice?v=1", {
      headers: await createAdmissionHeaders("lifecycle-test-room"),
    });

    expect(response.status).toBe(101);
    expect(response.webSocket).not.toBeNull();

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
    const socket = await openVoiceSocket();
    const response = nextJsonMessage(socket);

    socket.send("not-json");

    expect(await response).toMatchObject({
      op: 18,
      d: { code: 4002, message: "Invalid JSON" },
    });

    socket.close();
  });

  it("acks an unidentified heartbeat without creating a participant", async () => {
    const socket = await openVoiceSocket();
    const response = nextJsonMessage(socket);

    socket.send(JSON.stringify({ op: 3, d: { seq_ack: 0 } }));

    expect(await response).toMatchObject({
      op: 6,
      d: { seq: 0 },
    });

    socket.close();
  });

  it("rejects a voice token for a subject other than the admitted socket", async () => {
    const roomName = crypto.randomUUID();
    const participantId = crypto.randomUUID();
    const socket = await openVoiceSocket(roomName);
    const response = nextJsonMessage(socket);

    socket.send(JSON.stringify({
      op: 100,
      d: {
        participant_id: participantId,
        voice_token: await issueVoiceToken(participantId, roomName, "other-user"),
      },
    }));

    expect(await response).toMatchObject({
      op: 18,
      d: { code: 4008, message: "Voice token subject mismatch" },
    });

    socket.close();
  });

  it("limits public-demo sockets to temporary demo chat events", async () => {
    const roomName = crypto.randomUUID();
    const subject = "demo-test-subject";
    const participantId = crypto.randomUUID();
    const socket = await openVoiceSocket(roomName, subject, "public-demo");
    await identifyVoiceSocket(socket, participantId, roomName, subject);
    socket.send(JSON.stringify({
      op: 106,
      d: { type: "activity.start", name: "not allowed" },
    }));

    expect(await nextMessageWithOpcode(socket, 18)).toMatchObject({
      op: 18,
      d: { code: 4003, message: "Voice app event is unavailable in public demo rooms" },
    });

    socket.close();
  });

  it("ignores a stale socket close after the participant reconnects", async () => {
    const roomName = crypto.randomUUID();
    const participantId = crypto.randomUUID();
    const oldSocket = await openVoiceSocket(roomName);
    await identifyVoiceSocket(oldSocket, participantId, roomName);

    const currentSocket = await openVoiceSocket(roomName);
    await identifyVoiceSocket(currentSocket, participantId, roomName);

    oldSocket.close(1000, "stale connection");

    const room = env.VOICE_ROOM.get(env.VOICE_ROOM.idFromName(roomName));
    const disconnectResponse = await room.fetch("https://internal/disconnect-participant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participant_id: participantId }),
    });

    expect(disconnectResponse.status).toBe(200);
    await expect(disconnectResponse.json()).resolves.toEqual({ disconnected: true });
  });
});
