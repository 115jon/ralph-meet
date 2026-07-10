import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { issueSocketTicket, verifySocketTicket } from "../../src/lib/voice/socket-ticket";
import {
  appendRealtimeAdmissionHeaders,
  createRealtimeAdmissionContext,
} from "../realtime-admission";

async function createAdmissionHeaders(roomName: string, audience: "global" | "room") {
  const roomSlug = audience === "global" ? "global-gateway" : roomName;
  const ticket = await issueSocketTicket({
    accessMode: "authenticated",
    audience,
    expiresAt: Date.now() + 60_000,
    nonce: crypto.randomUUID(),
    roomSlug,
    subject: "user-test",
  }, env.CALLS_APP_SECRET);
  const verification = await verifySocketTicket(ticket, env.CALLS_APP_SECRET, {
    accessMode: "authenticated",
    audience,
    now: Date.now(),
    roomSlug,
  });
  if (!verification.ok) throw new Error("Expected test ticket to verify");
  return appendRealtimeAdmissionHeaders(new Headers({
    Upgrade: "websocket",
    "Sec-WebSocket-Protocol": "ralph.realtime.v1",
  }), await createRealtimeAdmissionContext(verification.claims));
}

async function openMeetingSocket(roomName = crypto.randomUUID()): Promise<WebSocket> {
  const roomId = env.MEETING_ROOM.idFromName(roomName);
  const room = env.MEETING_ROOM.get(roomId);
  const response = await room.fetch(`https://internal/api/channels/${roomName}/ws?v=1`, {
    headers: await createAdmissionHeaders(roomName, "room"),
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

describe("MeetingRoom lifecycle", () => {
  it("accepts a hibernatable room socket and sends Hello", async () => {
    const roomId = env.MEETING_ROOM.idFromName("lifecycle-test-room");
    const room = env.MEETING_ROOM.get(roomId);
    const response = await room.fetch("https://internal/api/channels/lifecycle-test-room/ws?v=1", {
      headers: await createAdmissionHeaders("lifecycle-test-room", "room"),
    });

    expect(response.status).toBe(101);
    expect(response.webSocket).not.toBeNull();
    expect(response.headers.get("Sec-WebSocket-Protocol")).toBe("ralph.realtime.v1");

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

    socket.send(JSON.stringify({
      op: 0,
      d: {
        clerk_user_id: "forged-user",
        name: "Forged Name",
      },
    }));

    expect(await ready).toMatchObject({ op: 2 });

    const room = env.MEETING_ROOM.get(env.MEETING_ROOM.idFromName(roomName));
    const admitted = await room.fetch("https://internal/voice-session-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: "user-test", require_channel_match: false }),
    });
    const forged = await room.fetch("https://internal/voice-session-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: "forged-user", require_channel_match: false }),
    });

    await expect(admitted.json()).resolves.toMatchObject({ allowed: true });
    await expect(forged.json()).resolves.toMatchObject({ allowed: false });

    socket.close();
  });
});
