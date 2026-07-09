import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

async function openMeetingSocket(roomName = crypto.randomUUID()): Promise<WebSocket> {
  const roomId = env.MEETING_ROOM.idFromName(roomName);
  const room = env.MEETING_ROOM.get(roomId);
  const response = await room.fetch(`https://internal/api/channels/${roomName}/ws?v=1`, {
    headers: { Upgrade: "websocket" },
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
      headers: { Upgrade: "websocket" },
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
});
