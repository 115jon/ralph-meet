// The one-request admission (realtime/ADMISSION.md) as the Durable Objects
// see it: a room ticket's `media` claim decides whether Identify and Resume
// mint voice credentials, and a voice ticket's `participant` claim binds the
// voice socket to one participant. Tickets without either claim are the
// deprecated two-request flow, which keeps its old behaviour.

import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  issueSocketTicket,
  verifySocketTicket,
  type SocketTicketClaims,
} from "../../src/lib/voice/socket-ticket";
import {
  appendRealtimeAdmissionHeaders,
  createRealtimeAdmissionContext,
} from "../realtime-admission";
import { issueVoiceToken } from "../voice-token";

type Message = { op: number; d: unknown };

const HELLO = 8;
const IDENTIFY = 0;
const READY = 2;
const RESUME = 7;
const RESUMED = 9;
const MEDIA_READY = 41;
const REFRESH_CREDENTIALS = 40;
const VOICE_IDENTIFY = 100;

async function admissionHeaders(
  claims: Omit<SocketTicketClaims, "accessMode" | "expiresAt" | "nonce"> & {
    nonce?: string;
  },
) {
  const ticket = await issueSocketTicket(
    {
      accessMode: "authenticated",
      expiresAt: Date.now() + 60_000,
      nonce: claims.nonce ?? crypto.randomUUID(),
      ...claims,
    },
    env.CALLS_APP_SECRET,
  );
  const verification = await verifySocketTicket(ticket, env.CALLS_APP_SECRET, {
    audience: claims.audience,
    now: Date.now(),
    roomSlug: claims.roomSlug,
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

/** Every message until one with `opcode` arrives (inclusive). */
function messagesThrough(socket: WebSocket, opcode: number) {
  return new Promise<Message[]>((resolve) => {
    const seen: Message[] = [];
    const onMessage = (event: MessageEvent<string>) => {
      const message = JSON.parse(event.data) as Message;
      seen.push(message);
      if (message.op !== opcode) return;
      socket.removeEventListener("message", onMessage);
      resolve(seen);
    };
    socket.addEventListener("message", onMessage);
  });
}

async function openRoomSocket(
  roomName: string,
  subject: string,
  options: { nonce?: string; media?: "issued" | "held" } = {},
) {
  const room = env.MEETING_ROOM.get(env.MEETING_ROOM.idFromName(roomName));
  const response = await room.fetch(
    `https://internal/api/channels/${roomName}/ws?v=1`,
    {
      headers: await admissionHeaders({
        audience: "room",
        roomSlug: roomName,
        subject,
        ...(options.nonce ? { nonce: options.nonce } : {}),
        ...(options.media ? { media: options.media } : {}),
      }),
    },
  );
  const socket = response.webSocket;
  if (!socket) throw new Error("Expected room WebSocket");
  const hello = messagesThrough(socket, HELLO);
  socket.accept();
  await hello;
  return socket;
}

async function identify(socket: WebSocket) {
  const messages = messagesThrough(socket, READY);
  socket.send(JSON.stringify({ op: IDENTIFY, d: { name: "Voice User" } }));
  const seen = await messages;
  return {
    mediaReady: seen.find((message) => message.op === MEDIA_READY),
    ready: seen[seen.length - 1].d as Record<string, unknown>,
  };
}

async function resume(socket: WebSocket, sessionId: string) {
  const messages = messagesThrough(socket, RESUMED);
  socket.send(
    JSON.stringify({ op: RESUME, d: { session_id: sessionId, seq_ack: 0 } }),
  );
  const seen = await messages;
  return seen[seen.length - 1].d as Record<string, unknown>;
}

async function dropAndWait(socket: WebSocket) {
  socket.close(4000, "network drop");
  await new Promise((resolve) => setTimeout(resolve, 30));
}

describe("room Identify and Resume by admission", () => {
  it("mints nothing on Identify when the admission issued the credentials", async () => {
    const roomName = crypto.randomUUID();
    const nonce = crypto.randomUUID();
    const socket = await openRoomSocket(roomName, "admitted-user", {
      nonce,
      media: "issued",
    });

    const { mediaReady, ready } = await identify(socket);

    expect(mediaReady).toBeUndefined();
    expect(ready.participant_id).toBe(nonce);
    expect(ready).not.toHaveProperty("voice_token");
    expect(ready).not.toHaveProperty("ice_servers");
    socket.close(1000, "done");
  });

  it("mints on Identify for a reconnect's new participant (held credentials)", async () => {
    const roomName = crypto.randomUUID();
    const nonce = crypto.randomUUID();
    const socket = await openRoomSocket(roomName, "reconnecting-user", {
      nonce,
      media: "held",
    });

    const { mediaReady, ready } = await identify(socket);

    expect(mediaReady?.d).toMatchObject({ participant_id: nonce });
    expect(ready.participant_id).toBe(nonce);
    expect(typeof ready.voice_token).toBe("string");
    expect(Array.isArray(ready.ice_servers)).toBe(true);
    socket.close(1000, "done");
  });

  it("keeps minting for deprecated two-request clients (no media claim)", async () => {
    const roomName = crypto.randomUUID();
    const socket = await openRoomSocket(roomName, "old-client");

    const { mediaReady, ready } = await identify(socket);

    expect(mediaReady).toBeDefined();
    expect(typeof ready.voice_token).toBe("string");
    expect(Array.isArray(ready.ice_servers)).toBe(true);

    // ...and on Resume, as before.
    await dropAndWait(socket);
    const again = await openRoomSocket(roomName, "old-client");
    const resumed = await resume(again, String(ready.participant_id));
    expect(typeof resumed.voice_token).toBe("string");
    expect(Array.isArray(resumed.ice_servers)).toBe(true);
    again.close(1000, "done");
  });

  it("resumes an admitted session without re-minting, and op 40 still refreshes", async () => {
    const roomName = crypto.randomUUID();
    const nonce = crypto.randomUUID();
    const first = await openRoomSocket(roomName, "admitted-user", {
      nonce,
      media: "issued",
    });
    await identify(first);
    await dropAndWait(first);

    const again = await openRoomSocket(roomName, "admitted-user", {
      media: "held",
    });
    const resumed = await resume(again, nonce);
    expect(resumed).not.toHaveProperty("voice_token");
    expect(resumed).not.toHaveProperty("ice_servers");
    expect(Array.isArray(resumed.participants)).toBe(true);

    // Expiry is still covered: op 40 mints for the resumed participant.
    const refreshed = messagesThrough(again, RESUMED);
    again.send(JSON.stringify({ op: REFRESH_CREDENTIALS, d: {} }));
    const reply = (await refreshed).at(-1)?.d as Record<string, unknown>;
    expect(typeof reply.voice_token).toBe("string");
    expect(String(reply.voice_token).startsWith(`${nonce}:${roomName}:`)).toBe(
      true,
    );
    expect(Array.isArray(reply.ice_servers)).toBe(true);
    again.close(1000, "done");
  });
});

describe("voice socket bound to a participant", () => {
  async function openVoiceSocket(
    roomName: string,
    subject: string,
    participant?: string,
  ) {
    const voice = env.VOICE_ROOM.get(env.VOICE_ROOM.idFromName(roomName));
    const response = await voice.fetch(
      `https://internal/api/channels/${roomName}/voice?v=1`,
      {
        headers: await admissionHeaders({
          audience: "voice",
          roomSlug: roomName,
          subject,
          ...(participant ? { participant } : {}),
        }),
      },
    );
    const socket = response.webSocket;
    if (!socket) throw new Error("Expected voice WebSocket");
    const hello = messagesThrough(socket, HELLO);
    socket.accept();
    await hello;
    return socket;
  }

  it("closes with a retryable code when VoiceIdentify names another participant", async () => {
    const roomName = crypto.randomUUID();
    const bound = crypto.randomUUID();
    const other = crypto.randomUUID();
    const socket = await openVoiceSocket(roomName, "member", bound);
    const close = new Promise<CloseEvent>((resolve) => {
      socket.addEventListener("close", resolve, { once: true });
    });

    socket.send(
      JSON.stringify({
        op: VOICE_IDENTIFY,
        d: {
          participant_id: other,
          voice_token: await issueVoiceToken({
            participantId: other,
            roomSlug: roomName,
            subject: "member",
            secret: env.CALLS_APP_SECRET,
          }),
        },
      }),
    );

    // 1013, not AdmissionRejected (4008): the client asks for a new ticket.
    await expect(close).resolves.toMatchObject({ code: 1013 });
  });

  it("lets the bound participant through to the join-grant check", async () => {
    const roomName = crypto.randomUUID();
    const nonce = crypto.randomUUID();
    const room = await openRoomSocket(roomName, "member", {
      nonce,
      media: "issued",
    });
    await identify(room);
    const voice = await openVoiceSocket(roomName, "member", nonce);

    const ready = messagesThrough(voice, 101);
    voice.send(
      JSON.stringify({
        op: VOICE_IDENTIFY,
        d: {
          participant_id: nonce,
          voice_token: await issueVoiceToken({
            participantId: nonce,
            roomSlug: roomName,
            subject: "member",
            secret: env.CALLS_APP_SECRET,
          }),
        },
      }),
    );
    await expect(ready).resolves.toContainEqual(
      expect.objectContaining({ op: 101 }),
    );
    voice.close(1000, "done");
    room.close(1000, "done");
  });
});
