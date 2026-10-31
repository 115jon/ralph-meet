import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import {
  issueSocketTicket,
  verifySocketTicket,
} from "../../src/lib/voice/socket-ticket";
import {
  appendRealtimeAdmissionHeaders,
  createRealtimeAdmissionContext,
} from "../realtime-admission";
import { issueVoiceToken } from "../voice-token";
import { VOICE_JOIN_GRANT_WAIT_MS } from "../voice-join-grant";
import {
  handlePartyTracksProxyRequest,
  type PartyTracksProxyEnv,
  type PartyTracksRouter,
} from "../partytracks-proxy";

// MeetingRoom opcodes
const IDENTIFY = 0;
const READY = 2;
const HELLO = 8;
const CLIENT_DISCONNECT = 11;
const VOICE_STATE_UPDATE = 15;
// VoiceRoom opcodes
const HEARTBEAT = 3;
const HEARTBEAT_ACK = 6;
const ERROR = 18;
const VOICE_IDENTIFY = 100;
const VOICE_READY = 101;

type Message = { op: number; d: Record<string, unknown> };

async function admissionHeaders(
  roomName: string,
  audience: "room" | "voice",
  subject: string,
  nonce: string = crypto.randomUUID(),
) {
  const ticket = await issueSocketTicket(
    {
      accessMode: "authenticated",
      audience,
      expiresAt: Date.now() + 60_000,
      nonce,
      roomSlug: roomName,
      subject,
    },
    env.CALLS_APP_SECRET,
  );
  const verification = await verifySocketTicket(ticket, env.CALLS_APP_SECRET, {
    accessMode: "authenticated",
    audience,
    now: Date.now(),
    roomSlug: roomName,
  });
  if (!verification.ok) throw new Error("Expected test ticket to verify");
  return appendRealtimeAdmissionHeaders(
    new Headers({ Upgrade: "websocket" }),
    await createRealtimeAdmissionContext(verification.claims),
  );
}

function nextMessage(socket: WebSocket, opcode: number): Promise<Message> {
  return new Promise((resolve) => {
    const onMessage = (event: MessageEvent<string>) => {
      const message = JSON.parse(event.data) as Message;
      if (message.op !== opcode) return;
      socket.removeEventListener("message", onMessage);
      resolve(message);
    };
    socket.addEventListener("message", onMessage);
  });
}

function nextMessageOrNull(
  socket: WebSocket,
  opcode: number,
  timeoutMs = 200,
): Promise<Message | null> {
  return Promise.race([
    nextMessage(socket, opcode),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);
}

function closed(socket: WebSocket): Promise<CloseEvent> {
  return new Promise((resolve) => {
    socket.addEventListener("close", resolve, { once: true });
  });
}

/** A channel's room (MeetingRoom) socket, admitted with ticket nonce `participantId`. */
async function openRoomSocket(
  roomName: string,
  subject: string,
  participantId: string,
) {
  const room = env.MEETING_ROOM.get(env.MEETING_ROOM.idFromName(roomName));
  const response = await room.fetch(
    `https://internal/api/channels/${roomName}/ws?v=1`,
    {
      headers: await admissionHeaders(roomName, "room", subject, participantId),
    },
  );
  const socket = response.webSocket;
  if (!socket) throw new Error("Expected room WebSocket");
  const hello = nextMessage(socket, HELLO);
  socket.accept();
  await hello;
  return socket;
}

async function joinRoom(
  socket: WebSocket,
  options: { standby?: boolean } = {},
) {
  const ready = nextMessage(socket, READY);
  socket.send(
    JSON.stringify({
      op: IDENTIFY,
      d: { name: "Voice User", ...(options.standby ? { standby: true } : {}) },
    }),
  );
  return ready;
}

function voiceRoom(roomName: string) {
  return env.VOICE_ROOM.get(env.VOICE_ROOM.idFromName(roomName));
}

async function openVoiceSocket(roomName: string, subject: string) {
  const response = await voiceRoom(roomName).fetch(
    `https://internal/api/channels/${roomName}/voice?v=1`,
    { headers: await admissionHeaders(roomName, "voice", subject) },
  );
  const socket = response.webSocket;
  if (!socket) throw new Error("Expected voice WebSocket");
  const hello = nextMessage(socket, HELLO);
  socket.accept();
  await hello;
  return socket;
}

/** Keeps refusal tests fast; production waits up to VOICE_JOIN_GRANT_WAIT_MS. */
async function shortenJoinWait(roomName: string, waitMs = 100) {
  await runInDurableObject(voiceRoom(roomName), (instance) => {
    (
      instance as unknown as { voiceJoinGrantWaitMs: number }
    ).voiceJoinGrantWaitMs = waitMs;
  });
}

async function voiceToken(
  participantId: string,
  roomName: string,
  subject: string,
  now?: number,
) {
  return issueVoiceToken({
    participantId,
    roomSlug: roomName,
    subject,
    secret: env.CALLS_APP_SECRET,
    now,
  });
}

async function sendVoiceIdentify(
  socket: WebSocket,
  participantId: string,
  token: string,
) {
  socket.send(
    JSON.stringify({
      op: VOICE_IDENTIFY,
      d: { participant_id: participantId, voice_token: token },
    }),
  );
}

async function waitForGrant(
  roomName: string,
  participantId: string,
  subject: string,
  expected: boolean,
) {
  await vi.waitFor(async () => {
    const granted = await runInDurableObject(voiceRoom(roomName), (instance) =>
      (
        instance as unknown as {
          voiceJoinGrants: {
            isGranted(participantId: string, subject: string): boolean;
          };
        }
      ).voiceJoinGrants.isGranted(participantId, subject),
    );
    expect(granted).toBe(expected);
  });
}

describe("voice join grants", () => {
  it("refuses a voice identify from a token holder who never joined the channel", async () => {
    const roomName = crypto.randomUUID();
    const participantId = crypto.randomUUID();
    const voice = await openVoiceSocket(roomName, "lurker");
    await shortenJoinWait(roomName);

    // The unidentified (standby) socket itself stays usable.
    const ack = nextMessage(voice, HEARTBEAT_ACK);
    voice.send(JSON.stringify({ op: HEARTBEAT, d: {} }));
    await expect(ack).resolves.toMatchObject({ d: { seq: 0 } });

    const ready = nextMessageOrNull(voice, VOICE_READY, 500);
    const error = nextMessage(voice, ERROR);
    const close = closed(voice);
    await sendVoiceIdentify(
      voice,
      participantId,
      await voiceToken(participantId, roomName, "lurker"),
    );

    await expect(error).resolves.toMatchObject({
      d: { code: 4008, message: "Voice channel join required" },
    });
    await expect(close).resolves.toMatchObject({ code: 4008 });
    await expect(ready).resolves.toBeNull();
  });

  it("keeps a standby room session out of voice until it is promoted", async () => {
    const roomName = crypto.randomUUID();
    const participantId = crypto.randomUUID();
    const subject = "standby-user";
    const room = await openRoomSocket(roomName, subject, participantId);
    await joinRoom(room, { standby: true });
    const token = await voiceToken(participantId, roomName, subject);

    const standbyVoice = await openVoiceSocket(roomName, subject);
    await shortenJoinWait(roomName);
    const refused = nextMessage(standbyVoice, ERROR);
    await sendVoiceIdentify(standbyVoice, participantId, token);
    await expect(refused).resolves.toMatchObject({
      d: { code: 4008, message: "Voice channel join required" },
    });

    room.send(
      JSON.stringify({ op: VOICE_STATE_UPDATE, d: { promote_standby: true } }),
    );
    await waitForGrant(roomName, participantId, subject, true);
    const voice = await openVoiceSocket(roomName, subject);
    const ready = nextMessage(voice, VOICE_READY);
    await sendVoiceIdentify(voice, participantId, token);
    await expect(ready).resolves.toMatchObject({
      d: { participant_id: participantId },
    });

    voice.close();
    room.close();
  });

  it("admits a joined session without a wait once the room has pushed the grant", async () => {
    const roomName = crypto.randomUUID();
    const participantId = crypto.randomUUID();
    const subject = "joined-user";
    const room = await openRoomSocket(roomName, subject, participantId);
    await joinRoom(room);
    await waitForGrant(roomName, participantId, subject, true);

    // `join_wait_ms` is wall-clock elapsed time around the grant lookup, so it
    // reads 1 when the process is descheduled between the two clock reads
    // (workerd does not freeze Date.now() locally). "No wait" is the lookup
    // answering from the stored grant without asking the MeetingRoom.
    let grantChecks = 0;
    await runInDurableObject(voiceRoom(roomName), (instance) => {
      const live = instance as unknown as {
        confirmVoiceJoinGrant(query: unknown): Promise<boolean>;
      };
      const confirm = live.confirmVoiceJoinGrant.bind(live);
      live.confirmVoiceJoinGrant = (query) => {
        grantChecks += 1;
        return confirm(query);
      };
    });

    const voice = await openVoiceSocket(roomName, subject);
    const ready = nextMessage(voice, VOICE_READY);
    await sendVoiceIdentify(
      voice,
      participantId,
      await voiceToken(participantId, roomName, subject),
    );
    const readyMessage = await ready;
    expect(readyMessage).toMatchObject({
      d: { participant_id: participantId },
    });
    expect(grantChecks).toBe(0);
    expect(readyMessage.d.join_wait_ms).toEqual(expect.any(Number));
    expect(readyMessage.d.join_wait_ms as number).toBeLessThan(
      VOICE_JOIN_GRANT_WAIT_MS,
    );

    voice.close();
    room.close();
  });

  it("holds a voice identify that races ahead of the room Identify until the join arrives", async () => {
    const roomName = crypto.randomUUID();
    const participantId = crypto.randomUUID();
    const subject = "racing-user";
    const voice = await openVoiceSocket(roomName, subject);
    const room = await openRoomSocket(roomName, subject, participantId);

    const ready = nextMessage(voice, VOICE_READY);
    await sendVoiceIdentify(
      voice,
      participantId,
      await voiceToken(participantId, roomName, subject),
    );
    await expect(
      nextMessageOrNull(voice, VOICE_READY, 100),
    ).resolves.toBeNull();

    // The grant is pushed when the room Identify arrives, before Ready.
    const roomReady = joinRoom(room);
    const readyMessage = await ready;
    expect(readyMessage).toMatchObject({
      d: { participant_id: participantId },
    });
    expect(readyMessage.d.join_wait_ms).toEqual(expect.any(Number));
    await roomReady;

    voice.close();
    room.close();
  });

  it("revokes voice when the room session leaves and refuses the old token afterwards", async () => {
    const roomName = crypto.randomUUID();
    const participantId = crypto.randomUUID();
    const subject = "leaving-user";
    const token = await voiceToken(participantId, roomName, subject);
    const room = await openRoomSocket(roomName, subject, participantId);
    await joinRoom(room);

    const voice = await openVoiceSocket(roomName, subject);
    const ready = nextMessage(voice, VOICE_READY);
    await sendVoiceIdentify(voice, participantId, token);
    await ready;

    const voiceClosed = closed(voice);
    room.send(JSON.stringify({ op: CLIENT_DISCONNECT, d: {} }));
    await voiceClosed;
    await waitForGrant(roomName, participantId, subject, false);

    // Revocation is remembered, so the same token is refused immediately.
    const retry = await openVoiceSocket(roomName, subject);
    const refused = nextMessage(retry, ERROR);
    await sendVoiceIdentify(retry, participantId, token);
    await expect(refused).resolves.toMatchObject({
      d: { code: 4008, message: "Voice channel join required" },
    });
  });

  it("revokes voice when the session is disconnected by the server", async () => {
    const roomName = crypto.randomUUID();
    const participantId = crypto.randomUUID();
    const subject = "kicked-user";
    const room = await openRoomSocket(roomName, subject, participantId);
    await joinRoom(room);

    const voice = await openVoiceSocket(roomName, subject);
    const ready = nextMessage(voice, VOICE_READY);
    await sendVoiceIdentify(
      voice,
      participantId,
      await voiceToken(participantId, roomName, subject),
    );
    await ready;

    const voiceClosed = closed(voice);
    const response = await env.MEETING_ROOM.get(
      env.MEETING_ROOM.idFromName(roomName),
    ).fetch("https://internal/disconnect-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: subject, session_id: participantId }),
    });
    expect(await response.json()).toEqual({ disconnected: true });
    await voiceClosed;
    await waitForGrant(roomName, participantId, subject, false);
  });

  it("refuses an expired voice token even for a joined session", async () => {
    const roomName = crypto.randomUUID();
    const participantId = crypto.randomUUID();
    const subject = "expired-user";
    const room = await openRoomSocket(roomName, subject, participantId);
    await joinRoom(room);

    const voice = await openVoiceSocket(roomName, subject);
    const error = nextMessage(voice, ERROR);
    await sendVoiceIdentify(
      voice,
      participantId,
      await voiceToken(
        participantId,
        roomName,
        subject,
        Date.now() - 2 * 60 * 60 * 1000,
      ),
    );
    await expect(error).resolves.toMatchObject({
      d: { code: 4004, message: "Voice token expired" },
    });

    voice.close();
    room.close();
  });

  it("lets PartyTracks pull remote tracks only while the puller is joined", async () => {
    const roomName = crypto.randomUUID();
    const publisherId = crypto.randomUUID();
    const pullerId = crypto.randomUUID();
    const subject = "puller-user";
    const proxyEnv: PartyTracksProxyEnv = {
      CALLS_APP_ID: "calls-app",
      CALLS_APP_SECRET: env.CALLS_APP_SECRET,
      VOICE_ROOM: env.VOICE_ROOM,
    };
    const routedPaths: string[] = [];
    const route: PartyTracksRouter = async ({ request }) => {
      const url = new URL(request.url);
      routedPaths.push(url.pathname);
      if (url.pathname.endsWith("/sessions/new")) {
        return Response.json({ sessionId: `raw-${crypto.randomUUID()}` });
      }
      return Response.json({ tracks: [] });
    };
    const proxy = async (
      participantId: string,
      token: string,
      endpoint: string,
      body?: unknown,
    ) =>
      handlePartyTracksProxyRequest(
        new Request(
          `https://meet.test/api/channels/${roomName}/partytracks${endpoint}`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "X-Voice-Session-Id": participantId,
              "Content-Type": "application/json",
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          },
        ),
        proxyEnv,
        route,
      );
    const newSession = async (participantId: string, token: string) => {
      const response = await proxy(participantId, token, "/sessions/new");
      if (!response)
        throw new Error("Expected the proxy to handle the request");
      expect(response.status).toBe(200);
      return ((await response.json()) as { sessionId: string }).sessionId;
    };

    const publisherToken = await voiceToken(publisherId, roomName, "publisher");
    const pullerToken = await voiceToken(pullerId, roomName, subject);
    const publisherSession = await newSession(publisherId, publisherToken);
    // A standby (not yet joined) session may still warm up its own session
    // and push local tracks: nothing is announced to the room.
    const pullerSession = await newSession(pullerId, pullerToken);
    const localPush = await proxy(
      pullerId,
      pullerToken,
      `/sessions/${encodeURIComponent(pullerSession)}/tracks/new`,
      { tracks: [{ location: "local", trackName: "mic", mid: "0" }] },
    );
    expect(localPush?.status).toBe(200);

    const pullBody = {
      tracks: [
        {
          location: "remote",
          sessionId: publisherSession,
          trackName: "publisher-mic",
        },
      ],
    };
    const pullPath = `/sessions/${encodeURIComponent(pullerSession)}/tracks/new`;
    await shortenJoinWait(roomName);
    const routedBeforeJoin = routedPaths.length;
    const notJoined = await proxy(pullerId, pullerToken, pullPath, pullBody);
    expect(notJoined?.status).toBe(403);
    expect(routedPaths).toHaveLength(routedBeforeJoin);

    const room = await openRoomSocket(roomName, subject, pullerId);
    await joinRoom(room);
    const joined = await proxy(pullerId, pullerToken, pullPath, pullBody);
    expect(joined?.status).toBe(200);
    expect(joined?.headers.get("Server-Timing")).toMatch(/voice-join;dur=/);
    room.send(JSON.stringify({ op: CLIENT_DISCONNECT, d: {} }));
    await waitForGrant(roomName, pullerId, subject, false);
    const afterLeave = await proxy(pullerId, pullerToken, pullPath, pullBody);
    expect(afterLeave?.status).toBe(403);
  });
});
