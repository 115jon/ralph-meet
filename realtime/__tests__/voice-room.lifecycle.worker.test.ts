import { env } from "cloudflare:workers";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import {
  issueSocketTicket,
  verifySocketTicket,
} from "../../src/lib/voice/socket-ticket";
import {
  appendRealtimeAdmissionHeaders,
  consumeRealtimeTicketNonce,
  createRealtimeAdmissionContext,
  initRealtimeTicketNonces,
} from "../realtime-admission";
import { createSoundboardPlaybackId } from "../../src/lib/voice/soundboard-playback-id";
import { verifySoundboardMediaCapability } from "../../src/lib/voice/soundboard-media-capability";
import { GET as GET_SOUNDBOARD_UPLOAD } from "../../src/lib/voice/soundboard-upload-handler";
import { VoiceRoom } from "../voice-room";
import {
  GatewayOp,
  HEARTBEAT_FRAME,
  voiceGatewayClientRules,
} from "../../src/lib/gateway-protocol";

const textEncoder = new TextEncoder();
const TEST_SUBJECT = "user-test";
const RADIO_STATION_UUID = "4f0b9a5c-1f0d-4d76-8d27-3b89b7cd1749";
const MAX_SOUNDBOARD_DATA_URL_BYTES = 128 * 1024;

function audioDataUrlForDecodedBytes(byteLength: number) {
  const completeGroups = Math.floor(byteLength / 3);
  const remainder = byteLength % 3;
  const remainderBase64 =
    remainder === 1 ? "AA==" : remainder === 2 ? "AAA=" : "";
  return `data:audio/wav;base64,${"A".repeat(completeGroups * 4)}${remainderBase64}`;
}

async function createAdmissionHeaders(
  roomName: string,
  subject = TEST_SUBJECT,
  accessMode: "authenticated" | "public-demo" = "authenticated",
  serverId?: string,
) {
  const ticket = await issueSocketTicket(
    {
      accessMode,
      audience: "voice",
      expiresAt: Date.now() + 60_000,
      nonce: crypto.randomUUID(),
      roomSlug: roomName,
      ...(serverId ? { serverId } : {}),
      subject,
    },
    env.CALLS_APP_SECRET,
  );
  const verification = await verifySocketTicket(ticket, env.CALLS_APP_SECRET, {
    accessMode,
    audience: "voice",
    now: Date.now(),
    roomSlug: roomName,
  });
  if (!verification.ok) throw new Error("Expected test ticket to verify");
  return appendRealtimeAdmissionHeaders(
    new Headers({ Upgrade: "websocket" }),
    await createRealtimeAdmissionContext(verification.claims),
  );
}

async function openVoiceSocket(
  roomName: string = crypto.randomUUID(),
  subject = TEST_SUBJECT,
  accessMode: "authenticated" | "public-demo" = "authenticated",
  serverId = accessMode === "authenticated" ? "server-1" : undefined,
): Promise<WebSocket> {
  if (accessMode === "authenticated" && serverId) {
    await seedSoundboardMembership(serverId, subject);
  }
  const roomId = env.VOICE_ROOM.idFromName(roomName);
  const room = env.VOICE_ROOM.get(roomId);
  const response = await room.fetch(
    `https://internal/api/channels/${roomName}/voice?v=1`,
    {
      headers: await createAdmissionHeaders(
        roomName,
        subject,
        accessMode,
        serverId,
      ),
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

async function mockRadioBrowserStation(
  roomName: string,
  station: Record<string, unknown>,
) {
  const room = env.VOICE_ROOM.get(env.VOICE_ROOM.idFromName(roomName));
  await runInDurableObject(room, () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify([station]), {
        headers: { "Content-Type": "application/json" },
      });
  });
}

async function nextJsonMessage(
  socket: WebSocket,
): Promise<{ op: number; d: unknown }> {
  const message = await new Promise<MessageEvent<string>>((resolve) => {
    socket.addEventListener("message", resolve, { once: true });
  });
  return JSON.parse(message.data) as { op: number; d: unknown };
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

async function nextMessageWithOpcode(
  socket: WebSocket,
  opcode: number,
): Promise<{ op: number; d: unknown }> {
  while (true) {
    const message = await nextJsonMessage(socket);
    if (message.op === opcode) return message;
  }
}

async function nextMessagesWithOpcodes(
  socket: WebSocket,
  opcodes: readonly number[],
): Promise<Map<number, { op: number; d: unknown }>> {
  const remaining = new Set(opcodes);
  const messages = new Map<number, { op: number; d: unknown }>();
  return new Promise((resolve) => {
    const onMessage = (event: MessageEvent<string>) => {
      const message = JSON.parse(event.data) as { op: number; d: unknown };
      if (!remaining.delete(message.op)) return;
      messages.set(message.op, message);
      if (remaining.size > 0) return;
      socket.removeEventListener("message", onMessage);
      resolve(messages);
    };
    socket.addEventListener("message", onMessage);
  });
}

async function nextMessageWithOpcodeOrNull(
  socket: WebSocket,
  opcode: number,
  timeoutMs = 250,
): Promise<{ op: number; d: unknown } | null> {
  return new Promise((resolve) => {
    const onMessage = (event: MessageEvent<string>) => {
      const message = JSON.parse(event.data) as { op: number; d: unknown };
      if (message.op !== opcode) return;
      clearTimeout(timer);
      socket.removeEventListener("message", onMessage);
      resolve(message);
    };
    const timer = setTimeout(() => {
      socket.removeEventListener("message", onMessage);
      resolve(null);
    }, timeoutMs);
    socket.addEventListener("message", onMessage);
  });
}

async function nextMessageWithOpcodeAndType(
  socket: WebSocket,
  opcode: number,
  eventType: string,
): Promise<{ op: number; d: unknown }> {
  while (true) {
    const message = await nextJsonMessage(socket);
    if (message.op === opcode) {
      const d = message.d as Record<string, unknown>;
      if (d?.type === eventType) return message;
    }
  }
}

async function nextMessageWithOpcodeAndTypeOrNull(
  socket: WebSocket,
  opcode: number,
  eventType: string,
  timeoutMs = 250,
): Promise<{ op: number; d: unknown } | null> {
  return new Promise((resolve) => {
    const onMessage = (event: MessageEvent<string>) => {
      const message = JSON.parse(event.data) as {
        op: number;
        d: unknown;
      };
      if (
        message.op !== opcode ||
        !message.d ||
        typeof message.d !== "object" ||
        (message.d as { type?: unknown }).type !== eventType
      ) {
        return;
      }
      clearTimeout(timer);
      socket.removeEventListener("message", onMessage);
      resolve(message);
    };
    const timer = setTimeout(() => {
      socket.removeEventListener("message", onMessage);
      resolve(null);
    }, timeoutMs);
    socket.addEventListener("message", onMessage);
  });
}

type ListenTogetherTestEvent = {
  type?: string;
  snapshot?: {
    revision?: number;
    paused?: boolean;
    positionMs?: number;
    currentEntryId?: string | null;
    queue?: Array<{ entryId: string }>;
  };
};

/**
 * Collects the Listen Together events a command produces, with no timing
 * window. After the command, each socket sends a heartbeat and collection on
 * that socket ends at its HeartbeatACK. The voice room handles a socket's
 * frames in order and these commands do no I/O before broadcasting, so every
 * event the command caused precedes the ACK. Sockets are flushed one after
 * another so the sender's command is fully handled before an observer's
 * barrier is sent.
 */
async function collectListenTogetherEventsForSockets(
  sockets: WebSocket[],
  send: () => void,
): Promise<ListenTogetherTestEvent[][]> {
  const events = sockets.map(() => [] as ListenTogetherTestEvent[]);
  const listeners = sockets.map((socket, index) => {
    const onMessage = (event: MessageEvent<string>) => {
      const message = JSON.parse(event.data) as {
        op: number;
        d: ListenTogetherTestEvent;
      };
      if (
        message.op === 106 &&
        message.d.type?.startsWith("listen_together.")
      ) {
        events[index]?.push(message.d);
      }
    };
    socket.addEventListener("message", onMessage);
    return { socket, onMessage };
  });
  try {
    send();
    for (const socket of sockets) {
      const ack = nextMessageWithOpcode(socket, 6);
      socket.send(JSON.stringify({ op: 3, d: {} }));
      await ack;
    }
  } finally {
    for (const { socket, onMessage } of listeners) {
      socket.removeEventListener("message", onMessage);
    }
  }
  return events;
}

async function collectListenTogetherEvents(
  socket: WebSocket,
  send: () => void,
): Promise<ListenTogetherTestEvent[]> {
  const [events] = await collectListenTogetherEventsForSockets([socket], send);
  return events ?? [];
}

async function mockCallsApi(
  roomName: string,
  handler: (request: Request) => Response | Promise<Response>,
) {
  const room = env.VOICE_ROOM.get(env.VOICE_ROOM.idFromName(roomName));
  await runInDurableObject(room, () => {
    globalThis.fetch = async (input, init) => handler(new Request(input, init));
  });
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((fulfill) => {
    resolve = fulfill;
  });
  return { promise, resolve };
}

function sendNativeScreenSelect(
  socket: WebSocket,
  participantId: string,
  requestId: string,
): void {
  socket.send(
    JSON.stringify({
      op: 1,
      d: {
        sdp: `native-offer-${requestId}`,
        push_prefix: "screen",
        request_id: requestId,
        push_tracks: [
          {
            track_name: `screen-video-${participantId}`,
            kind: "video",
            mid: "0",
          },
        ],
        pull_tracks: [],
      },
    }),
  );
}

async function seedSoundboardCatalogEntry(
  serverId: string,
  soundId: string,
  ownerId = TEST_SUBJECT,
  metadata: {
    name?: string;
    emoji?: string | null;
    volume?: number;
  } = {},
) {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS attachments (
       id TEXT PRIMARY KEY,
       soundboard_server_id TEXT,
       filename TEXT,
       file_key TEXT,
       content_type TEXT,
       size_bytes INTEGER,
       user_id TEXT,
       sound_name TEXT,
       sound_emoji TEXT,
       sound_volume REAL
      )`,
  ).run();
  await env.DB.prepare(
    `INSERT OR REPLACE INTO attachments (
       id, soundboard_server_id, filename, file_key, content_type, size_bytes,
       user_id, sound_name, sound_emoji, sound_volume
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      soundId,
      serverId,
      "airhorn.mp3",
      `attachments/channel-1/${soundId}/airhorn.mp3`,
      "audio/mpeg",
      12,
      ownerId,
      metadata.name ?? "Canonical Airhorn",
      metadata.emoji ?? "🎺",
      metadata.volume ?? 0.4,
    )
    .run();
}

async function seedSoundboardMembership(serverId: string, userId: string) {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS server_members (
       server_id TEXT NOT NULL,
       user_id TEXT NOT NULL,
       PRIMARY KEY (server_id, user_id)
     )`,
  ).run();
  await env.DB.prepare(
    `INSERT OR REPLACE INTO server_members (server_id, user_id)
     VALUES (?, ?)`,
  )
    .bind(serverId, userId)
    .run();
}

async function seedManageServerPermission(serverId: string, userId: string) {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS roles (
       id TEXT PRIMARY KEY,
       server_id TEXT NOT NULL,
       name TEXT NOT NULL,
       permissions INTEGER NOT NULL DEFAULT 0,
       position INTEGER NOT NULL DEFAULT 0,
       is_default INTEGER NOT NULL DEFAULT 0
     )`,
  ).run();
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS member_roles (
       server_id TEXT NOT NULL,
       user_id TEXT NOT NULL,
       role_id TEXT NOT NULL,
       PRIMARY KEY (server_id, user_id, role_id)
     )`,
  ).run();
  await env.DB.prepare(
    `INSERT OR REPLACE INTO roles
       (id, server_id, name, permissions, position, is_default)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(`role-${userId}`, serverId, "Soundboard Manager", 2, 1, 0)
    .run();
  await env.DB.prepare(
    `INSERT OR REPLACE INTO member_roles (server_id, user_id, role_id)
     VALUES (?, ?, ?)`,
  )
    .bind(serverId, userId, `role-${userId}`)
    .run();
}

function listenTogetherMusicEntry(durationMs = 1_000) {
  return {
    track: {
      kind: "music",
      id: "music-1",
      provider: "youtube",
      videoId: "dQw4w9WgXcQ",
      title: "Never Gonna Give You Up",
      durationMs,
      canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      sourceLabel: "YouTube",
    },
  };
}

async function issueVoiceToken(
  participantId: string,
  roomName: string,
  subject = TEST_SUBJECT,
): Promise<string> {
  const payload = `${participantId}:${roomName}:${Date.now()}:${subject}`;
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(env.CALLS_APP_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    textEncoder.encode(payload),
  );
  const encodedSignature = btoa(
    String.fromCharCode(...new Uint8Array(signature)),
  );
  return `${payload}.${encodedSignature}`;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

async function issuePartyTracksSessionCapability(
  participantId: string,
  roomSlug: string,
  sessionId: string,
): Promise<string> {
  const payload = bytesToBase64Url(
    textEncoder.encode(
      JSON.stringify({ version: 1, roomSlug, participantId, sessionId }),
    ),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(env.CALLS_APP_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    textEncoder.encode(payload),
  );
  return `${payload}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

let voiceJoinGrantSeq = 0;

/** Stands in for the MeetingRoom's push when a session joins the channel. */
async function grantVoiceJoin(
  roomName: string,
  participantId: string,
  subject = TEST_SUBJECT,
  granted = true,
  replaced = false,
) {
  const room = env.VOICE_ROOM.get(env.VOICE_ROOM.idFromName(roomName));
  const response = await room.fetch("https://internal/voice-join-grant", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      participant_id: participantId,
      subject,
      granted,
      seq: ++voiceJoinGrantSeq,
      ...(replaced ? { replaced: true } : {}),
    }),
  });
  expect(response.status).toBe(200);
}

async function identifyVoiceSocket(
  socket: WebSocket,
  participantId: string,
  roomName: string,
  subject = TEST_SUBJECT,
  supportsSnapshotEvents = true,
) {
  await grantVoiceJoin(roomName, participantId, subject);
  const response = nextJsonMessage(socket);
  const identifyPayload: Record<string, unknown> = {
    participant_id: participantId,
    voice_token: await issueVoiceToken(participantId, roomName, subject),
  };
  if (supportsSnapshotEvents) {
    identifyPayload.supports_listen_together_snapshot_events = true;
  }
  socket.send(
    JSON.stringify({
      op: 100,
      d: identifyPayload,
    }),
  );

  expect(await response).toMatchObject({
    op: 101,
    d: { participant_id: participantId },
  });
}

/** The participant's held_until (the voice reconnect hold), or undefined without a row. */
async function heldUntil(
  roomName: string,
  participantId: string,
): Promise<number | null | undefined> {
  const room = env.VOICE_ROOM.get(env.VOICE_ROOM.idFromName(roomName));
  return runInDurableObject(room, (_instance, state) => {
    const row = [
      ...state.storage.sql.exec(
        "SELECT held_until FROM participants WHERE id = ?",
        participantId,
      ),
    ][0];
    return row ? ((row.held_until as number | null) ?? null) : undefined;
  });
}

/** Runs the hold out: every held participant's held_until is now past. */
async function expireReconnectHolds(roomName: string): Promise<void> {
  const room = env.VOICE_ROOM.get(env.VOICE_ROOM.idFromName(roomName));
  await runInDurableObject(room, (_instance, state) => {
    state.storage.sql.exec(
      "UPDATE participants SET held_until = 1 WHERE held_until IS NOT NULL",
    );
  });
  expect(await runDurableObjectAlarm(room)).toBe(true);
}

async function trackNames(roomName: string): Promise<string[]> {
  const room = env.VOICE_ROOM.get(env.VOICE_ROOM.idFromName(roomName));
  return runInDurableObject(room, (_instance, state) =>
    [...state.storage.sql.exec("SELECT track_name FROM tracks")].map(
      (row) => row.track_name as string,
    ),
  );
}

describe("VoiceRoom lifecycle", () => {
  it("accepts a hibernatable voice socket and sends Hello", async () => {
    const roomId = env.VOICE_ROOM.idFromName("lifecycle-test-room");
    const room = env.VOICE_ROOM.get(roomId);
    const response = await room.fetch(
      "https://internal/api/channels/lifecycle-test-room/voice?v=1",
      {
        headers: await createAdmissionHeaders("lifecycle-test-room"),
      },
    );

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

  it.each([null, [], "not an object"])(
    "rejects a valid JSON root that is not an object: %j",
    async (payload) => {
      const socket = await openVoiceSocket();
      const response = nextJsonMessage(socket);

      socket.send(JSON.stringify(payload));

      expect(await response).toMatchObject({
        op: 18,
        d: { code: 4001, message: "Missing opcode" },
      });
      socket.close();
    },
  );

  it("rejects a null StopTracks payload without throwing", async () => {
    const roomName = crypto.randomUUID();
    const socket = await openVoiceSocket(roomName);
    await identifyVoiceSocket(socket, crypto.randomUUID(), roomName);
    const response = nextMessageWithOpcode(socket, 18);

    socket.send(JSON.stringify({ op: 13, d: null }));

    await expect(response).resolves.toMatchObject({
      op: 18,
      d: { code: 4000, message: "Invalid stop tracks payload" },
    });
    socket.close();
  });

  it("rejects an unknown source-less sound ID", async () => {
    const roomName = crypto.randomUUID();
    const socket = await openVoiceSocket(roomName);
    await identifyVoiceSocket(socket, crypto.randomUUID(), roomName);
    const response = nextMessageWithOpcodeOrNull(socket, 18, 5_000);
    const broadcast = nextMessageWithOpcodeAndTypeOrNull(
      socket,
      106,
      "soundboard.play",
    );

    socket.send(
      JSON.stringify({
        op: 106,
        d: {
          type: "soundboard.play",
          server_key: "server-1",
          playback_id: createSoundboardPlaybackId(
            TEST_SUBJECT,
            "unknown-source",
          ),
          sound_id: "not-a-default-sound",
          name: "Unknown",
        },
      }),
    );

    expect(await response).toMatchObject({
      op: 18,
      d: { code: 4000, message: "Soundboard event was rejected" },
    });
    expect(await broadcast).toBeNull();
    socket.close();
  });

  it("accepts a known source-less default sound ID", async () => {
    const roomName = crypto.randomUUID();
    const participantId = crypto.randomUUID();
    const socket = await openVoiceSocket(roomName);
    await identifyVoiceSocket(socket, participantId, roomName);
    const listener = await openVoiceSocket(roomName);
    await identifyVoiceSocket(listener, crypto.randomUUID(), roomName);

    socket.send(
      JSON.stringify({
        op: 106,
        d: {
          type: "soundboard.play",
          server_key: "server-1",
          playback_id: createSoundboardPlaybackId(
            TEST_SUBJECT,
            "known-default",
          ),
          sound_id: "ping",
          name: "Ping",
        },
      }),
    );

    const response = await nextMessageWithOpcodeAndType(
      listener,
      106,
      "soundboard.play",
    );
    expect(response.d).toMatchObject({
      sound_id: "ping",
      playback_id: createSoundboardPlaybackId(TEST_SUBJECT, "known-default"),
    });

    socket.close();
    listener.close();
  });

  it("allows default soundboard controls in an authenticated DM call without server media", async () => {
    const roomName = `dm-call-${TEST_SUBJECT}-${crypto.randomUUID()}`;
    const participantId = crypto.randomUUID();
    const socket = await openVoiceSocket(
      roomName,
      TEST_SUBJECT,
      "authenticated",
      "",
    );
    await identifyVoiceSocket(socket, participantId, roomName);
    const listener = await openVoiceSocket(
      roomName,
      "dm-peer",
      "authenticated",
      "",
    );
    await identifyVoiceSocket(
      listener,
      crypto.randomUUID(),
      roomName,
      "dm-peer",
    );

    const playbackId = createSoundboardPlaybackId(TEST_SUBJECT, "ping");
    socket.send(
      JSON.stringify({
        op: 106,
        d: {
          type: "soundboard.play",
          server_key: "dm-call",
          playback_id: playbackId,
          sound_id: "ping",
          name: "Ping",
        },
      }),
    );
    await expect(
      nextMessageWithOpcodeAndType(listener, 106, "soundboard.play"),
    ).resolves.toMatchObject({
      d: {
        server_key: "dm-call",
        playback_id: playbackId,
        sound_id: "ping",
      },
    });

    for (const event of [
      { type: "soundboard.pause-set", paused: true },
      { type: "soundboard.stop" },
    ]) {
      const broadcast = nextMessageWithOpcodeAndType(listener, 106, event.type);
      socket.send(
        JSON.stringify({
          op: 106,
          d: {
            server_key: "dm-call",
            playback_id: playbackId,
            ...event,
          },
        }),
      );
      await expect(broadcast).resolves.toMatchObject({
        d: {
          server_key: "dm-call",
          playback_id: playbackId,
          type: event.type,
        },
      });
    }

    const mediaRejected = nextMessageWithOpcode(socket, 18);
    socket.send(
      JSON.stringify({
        op: 106,
        d: {
          type: "soundboard.play",
          server_key: "dm-call",
          playback_id: createSoundboardPlaybackId(TEST_SUBJECT, "upload-1"),
          sound_id: "upload-1",
          name: "Uploaded",
          media_url: "/api/soundboard/uploads/upload-1",
        },
      }),
    );
    await expect(mediaRejected).resolves.toMatchObject({
      d: { message: "Soundboard event was rejected" },
    });

    const catalogRejected = nextMessageWithOpcode(socket, 18);
    socket.send(
      JSON.stringify({
        op: 106,
        d: {
          type: "soundboard.catalog-updated",
          server_key: "dm-call",
          sound: { id: "upload-1", name: "Uploaded" },
        },
      }),
    );
    await expect(catalogRejected).resolves.toMatchObject({
      d: { message: "Soundboard event was rejected" },
    });

    socket.close();
    listener.close();
  });

  it("authorizes a member's uploaded server sound in a DM with a media capability", async () => {
    const roomName = `dm-call-${TEST_SUBJECT}-${crypto.randomUUID()}`;
    const participantId = crypto.randomUUID();
    await seedSoundboardCatalogEntry("dm-source-server-1", "dm-sound-1");
    await seedSoundboardMembership("dm-source-server-1", TEST_SUBJECT);
    const socket = await openVoiceSocket(
      roomName,
      TEST_SUBJECT,
      "authenticated",
      "",
    );
    await identifyVoiceSocket(socket, participantId, roomName);
    const listener = await openVoiceSocket(
      roomName,
      "dm-peer",
      "authenticated",
      "",
    );
    await identifyVoiceSocket(
      listener,
      crypto.randomUUID(),
      roomName,
      "dm-peer",
    );

    const playbackId = createSoundboardPlaybackId(TEST_SUBJECT, "dm-sound-1");
    socket.send(
      JSON.stringify({
        op: 106,
        d: {
          type: "soundboard.play",
          server_key: "dm-call",
          source_server_id: "dm-source-server-1",
          playback_id: playbackId,
          sound_id: "dm-sound-1",
          name: "Forged name",
          media_url: "/api/soundboard/uploads/dm-sound-1",
        },
      }),
    );

    const response = await nextMessageWithOpcodeAndType(
      listener,
      106,
      "soundboard.play",
    );
    const event = response.d as Record<string, unknown>;
    const mediaUrl = event.media_url;
    expect(event).toMatchObject({
      server_key: "dm-call",
      source_server_id: "dm-source-server-1",
      sound_id: "dm-sound-1",
      playback_id: playbackId,
    });
    expect(mediaUrl).toEqual(
      expect.stringContaining("/api/soundboard/uploads/dm-sound-1?cap=sbm1."),
    );

    const parsedUrl = new URL(String(mediaUrl), "https://voice-room.invalid");
    expect(parsedUrl.searchParams.get("room_slug")).toBe(roomName);
    expect(parsedUrl.searchParams.get("playback_id")).toBe(playbackId);
    const capabilityVerification = await verifySoundboardMediaCapability(
      parsedUrl.searchParams.get("cap") ?? "",
      env.REALTIME_TICKET_SECRET,
      {
        now: Date.now(),
        soundId: "dm-sound-1",
        sourceServerId: "dm-source-server-1",
        roomSlug: roomName,
        playbackId,
      },
    );
    expect(capabilityVerification).toMatchObject({
      ok: true,
      claims: { issuerSubject: TEST_SUBJECT },
    });
    if (!capabilityVerification.ok)
      throw new Error("Expected valid capability");
    const remainingLifetime =
      capabilityVerification.claims.expiresAt - Date.now();
    expect(remainingLifetime).toBeGreaterThan(59 * 60 * 1000);
    expect(remainingLifetime).toBeLessThanOrEqual(60 * 60 * 1000);

    socket.close();
    listener.close();
  });

  it("renews a DM capability through an owner replay and rejects peer renewal", async () => {
    const roomName = `dm-call-${TEST_SUBJECT}-${crypto.randomUUID()}`;
    const soundId = "dm-renew-sound";
    const serverId = "dm-renew-server";
    await seedSoundboardCatalogEntry(serverId, soundId);
    await seedSoundboardMembership(serverId, TEST_SUBJECT);
    await seedSoundboardMembership(serverId, "dm-peer");

    const owner = await openVoiceSocket(
      roomName,
      TEST_SUBJECT,
      "authenticated",
      "",
    );
    const peer = await openVoiceSocket(
      roomName,
      "dm-peer",
      "authenticated",
      "",
    );
    await identifyVoiceSocket(owner, crypto.randomUUID(), roomName);
    await identifyVoiceSocket(peer, crypto.randomUUID(), roomName, "dm-peer");

    const playbackId = createSoundboardPlaybackId(TEST_SUBJECT, soundId);
    const play = (state?: { current_time: number; paused: boolean }) =>
      owner.send(
        JSON.stringify({
          op: 106,
          d: {
            type: "soundboard.play",
            server_key: "dm-call",
            source_server_id: serverId,
            playback_id: playbackId,
            sound_id: soundId,
            name: "Renewable clip",
            media_url: `/api/soundboard/uploads/${soundId}`,
            ...state,
          },
        }),
      );

    play();
    const firstEvent = await nextMessageWithOpcodeAndType(
      peer,
      106,
      "soundboard.play",
    );
    const firstUrl = String(
      (firstEvent.d as Record<string, unknown>).media_url,
    );

    await new Promise((resolve) => setTimeout(resolve, 2));
    play({ current_time: 12.5, paused: true });
    const renewedEvent = await nextMessageWithOpcodeAndType(
      peer,
      106,
      "soundboard.play",
    );
    const renewedUrl = String(
      (renewedEvent.d as Record<string, unknown>).media_url,
    );
    expect(renewedUrl).not.toBe(firstUrl);
    expect(renewedUrl).toContain("cap=sbm1.");
    expect(renewedEvent.d).toMatchObject({
      current_time: 12.5,
      paused: true,
    });

    const renewedCapability = new URL(
      renewedUrl,
      "https://voice-room.invalid",
    ).searchParams.get("cap");
    await expect(
      verifySoundboardMediaCapability(
        renewedCapability ?? "",
        env.REALTIME_TICKET_SECRET,
        {
          now: Date.now(),
          soundId,
          sourceServerId: serverId,
          roomSlug: roomName,
          playbackId,
        },
      ),
    ).resolves.toMatchObject({
      ok: true,
      claims: { issuerSubject: TEST_SUBJECT },
    });

    const peerRejected = nextMessageWithOpcode(peer, 18);
    peer.send(
      JSON.stringify({
        op: 106,
        d: {
          type: "soundboard.play",
          server_key: "dm-call",
          source_server_id: serverId,
          playback_id: playbackId,
          sound_id: soundId,
          name: "Peer renewal",
          media_url: `/api/soundboard/uploads/${soundId}`,
        },
      }),
    );
    await expect(peerRejected).resolves.toMatchObject({
      d: { message: "Soundboard event was rejected" },
    });

    owner.close();
    peer.close();
  });

  it("authorizes a DM server sound uploaded by another user for a current member", async () => {
    const roomName = `dm-call-${TEST_SUBJECT}-${crypto.randomUUID()}`;
    const uploaderId = "uploader-1";
    await seedSoundboardCatalogEntry(
      "dm-other-uploader-server",
      "dm-other-uploader-sound",
      uploaderId,
    );
    await seedSoundboardMembership("dm-other-uploader-server", TEST_SUBJECT);
    const socket = await openVoiceSocket(
      roomName,
      TEST_SUBJECT,
      "authenticated",
      "",
    );
    const listener = await openVoiceSocket(
      roomName,
      "dm-peer",
      "authenticated",
      "",
    );
    await identifyVoiceSocket(socket, crypto.randomUUID(), roomName);
    await identifyVoiceSocket(
      listener,
      crypto.randomUUID(),
      roomName,
      "dm-peer",
    );

    const playbackId = createSoundboardPlaybackId(
      TEST_SUBJECT,
      "dm-other-uploader-sound",
    );
    socket.send(
      JSON.stringify({
        op: 106,
        d: {
          type: "soundboard.play",
          server_key: "dm-call",
          source_server_id: "dm-other-uploader-server",
          playback_id: playbackId,
          sound_id: "dm-other-uploader-sound",
          name: "Uploaded by another user",
          media_url: "/api/soundboard/uploads/dm-other-uploader-sound",
        },
      }),
    );

    const response = await nextMessageWithOpcodeAndType(
      listener,
      106,
      "soundboard.play",
    );
    expect(response.d).toMatchObject({
      source_server_id: "dm-other-uploader-server",
      sound_id: "dm-other-uploader-sound",
      playback_id: playbackId,
      media_url: expect.stringContaining(
        "/api/soundboard/uploads/dm-other-uploader-sound?cap=sbm1.",
      ),
    });

    socket.close();
    listener.close();
  });

  it("serves the exact emitted DM media URL to a non-member peer", async () => {
    const roomName = `dm-call-${TEST_SUBJECT}-${crypto.randomUUID()}`;
    const soundId = "dm-e2e-sound";
    const serverId = "dm-e2e-server";
    const fileKey = `attachments/channel-1/${soundId}/airhorn.mp3`;
    await seedSoundboardCatalogEntry(serverId, soundId, "uploader-2");
    await seedSoundboardMembership(serverId, TEST_SUBJECT);
    await env.BUCKET.put(fileKey, new Uint8Array([1, 2, 3]), {
      httpMetadata: { contentType: "audio/mpeg" },
    });

    const socket = await openVoiceSocket(
      roomName,
      TEST_SUBJECT,
      "authenticated",
      "",
    );
    const peer = await openVoiceSocket(
      roomName,
      "non-member-peer",
      "authenticated",
      "",
    );
    await identifyVoiceSocket(socket, crypto.randomUUID(), roomName);
    await identifyVoiceSocket(
      peer,
      crypto.randomUUID(),
      roomName,
      "non-member-peer",
    );

    const playbackId = createSoundboardPlaybackId(TEST_SUBJECT, soundId);
    socket.send(
      JSON.stringify({
        op: 106,
        d: {
          type: "soundboard.play",
          server_key: "dm-call",
          source_server_id: serverId,
          playback_id: playbackId,
          sound_id: soundId,
          name: "End to end sound",
          media_url: `/api/soundboard/uploads/${soundId}`,
        },
      }),
    );

    const event = await nextMessageWithOpcodeAndType(
      peer,
      106,
      "soundboard.play",
    );
    const mediaUrl = (event.d as Record<string, unknown>).media_url;
    expect(typeof mediaUrl).toBe("string");

    const response = await GET_SOUNDBOARD_UPLOAD({
      request: new Request(`https://meet.test${String(mediaUrl)}`),
      params: { id: soundId },
    });
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    );

    await env.BUCKET.delete(fileKey);
    socket.close();
    peer.close();
  });

  it("revokes an emitted DM capability after membership removal without reading R2", async () => {
    const roomName = `dm-call-${TEST_SUBJECT}-${crypto.randomUUID()}`;
    const soundId = "dm-revoked-capability-sound";
    const serverId = "dm-revoked-capability-server";
    const fileKey = `attachments/channel-1/${soundId}/airhorn.mp3`;
    await seedSoundboardCatalogEntry(serverId, soundId, TEST_SUBJECT);
    await seedSoundboardMembership(serverId, TEST_SUBJECT);
    await env.BUCKET.put(fileKey, new Uint8Array([4, 5, 6]), {
      httpMetadata: { contentType: "audio/mpeg" },
    });

    const socket = await openVoiceSocket(
      roomName,
      TEST_SUBJECT,
      "authenticated",
      "",
    );
    const peer = await openVoiceSocket(
      roomName,
      "revocation-peer",
      "authenticated",
      "",
    );
    await identifyVoiceSocket(socket, crypto.randomUUID(), roomName);
    await identifyVoiceSocket(
      peer,
      crypto.randomUUID(),
      roomName,
      "revocation-peer",
    );

    const playbackId = createSoundboardPlaybackId(TEST_SUBJECT, soundId);
    socket.send(
      JSON.stringify({
        op: 106,
        d: {
          type: "soundboard.play",
          server_key: "dm-call",
          source_server_id: serverId,
          playback_id: playbackId,
          sound_id: soundId,
          name: "Revoked sound",
          media_url: `/api/soundboard/uploads/${soundId}`,
        },
      }),
    );
    const event = await nextMessageWithOpcodeAndType(
      peer,
      106,
      "soundboard.play",
    );
    const mediaUrl = String((event.d as Record<string, unknown>).media_url);

    await env.DB.prepare(
      "DELETE FROM server_members WHERE server_id = ? AND user_id = ?",
    )
      .bind(serverId, TEST_SUBJECT)
      .run();
    const attachment = await env.DB.prepare(
      "SELECT id FROM attachments WHERE id = ? AND soundboard_server_id = ?",
    )
      .bind(soundId, serverId)
      .first();
    expect(attachment).not.toBeNull();

    const response = await GET_SOUNDBOARD_UPLOAD({
      request: new Request(`https://meet.test${mediaUrl}`),
      params: { id: soundId },
    });
    expect(response.status).toBe(404);

    await env.BUCKET.delete(fileKey);
    socket.close();
    peer.close();
  });

  it("supports legacy DM server media playback, capability, and owner controls", async () => {
    const roomName = `dm-call-${TEST_SUBJECT}-${crypto.randomUUID()}`;
    const soundId = "legacy-dm-sound";
    const serverId = "legacy-dm-server";
    await seedSoundboardCatalogEntry(serverId, soundId, "legacy-uploader");
    await seedSoundboardMembership(serverId, TEST_SUBJECT);
    const socket = await openVoiceSocket(
      roomName,
      TEST_SUBJECT,
      "authenticated",
      "",
    );
    const listener = await openVoiceSocket(
      roomName,
      "legacy-peer",
      "authenticated",
      "",
    );
    await identifyVoiceSocket(socket, crypto.randomUUID(), roomName);
    await identifyVoiceSocket(
      listener,
      crypto.randomUUID(),
      roomName,
      "legacy-peer",
    );

    const playbackId = createSoundboardPlaybackId(TEST_SUBJECT, soundId);
    socket.send(
      JSON.stringify({
        op: 106,
        d: {
          type: "soundboard.play",
          server_key: "dm-call",
          source_server_id: serverId,
          playback_id: playbackId,
          sound_id: soundId,
          name: "Legacy DM sound",
          media_url: `/api/soundboard/uploads/${soundId}`,
        },
      }),
    );
    const playEvent = await nextMessageWithOpcodeAndType(
      listener,
      106,
      "soundboard.play",
    );
    const emittedUrl = String(
      (playEvent.d as Record<string, unknown>).media_url,
    );
    expect(emittedUrl).toContain("cap=sbm1.");
    const parsedUrl = new URL(emittedUrl, "https://meet.test");
    await expect(
      verifySoundboardMediaCapability(
        parsedUrl.searchParams.get("cap") ?? "",
        env.REALTIME_TICKET_SECRET,
        {
          now: Date.now(),
          soundId,
          sourceServerId: serverId,
          roomSlug: roomName,
          playbackId,
        },
      ),
    ).resolves.toMatchObject({
      ok: true,
      claims: { issuerSubject: TEST_SUBJECT, playbackId },
    });

    for (const event of [
      { type: "soundboard.pause-set", paused: true },
      { type: "soundboard.stop" },
    ]) {
      const broadcast = nextMessageWithOpcodeAndType(listener, 106, event.type);
      socket.send(
        JSON.stringify({
          op: 106,
          d: {
            server_key: "dm-call",
            playback_id: playbackId,
            ...event,
          },
        }),
      );
      await expect(broadcast).resolves.toMatchObject({
        d: { server_key: "dm-call", playback_id: playbackId },
      });
    }

    socket.close();
    listener.close();
  });

  it("rejects a DM uploaded server sound when the sender is not a member", async () => {
    const roomName = `dm-call-${TEST_SUBJECT}-${crypto.randomUUID()}`;
    const socket = await openVoiceSocket(
      roomName,
      TEST_SUBJECT,
      "authenticated",
      "",
    );
    await identifyVoiceSocket(socket, crypto.randomUUID(), roomName);
    const response = nextMessageWithOpcode(socket, 18);

    await seedSoundboardCatalogEntry(
      "dm-nonmember-server",
      "dm-nonmember-sound",
    );
    socket.send(
      JSON.stringify({
        op: 106,
        d: {
          type: "soundboard.play",
          server_key: "dm-call",
          source_server_id: "dm-nonmember-server",
          playback_id: createSoundboardPlaybackId(
            TEST_SUBJECT,
            "dm-nonmember-sound",
          ),
          sound_id: "dm-nonmember-sound",
          name: "Airhorn",
          media_url: "/api/soundboard/uploads/dm-nonmember-sound",
        },
      }),
    );

    await expect(response).resolves.toMatchObject({
      d: { message: "Soundboard event was rejected" },
    });
    socket.close();
  });

  it("rejects a DM uploaded server sound after membership is removed", async () => {
    const roomName = `dm-call-${TEST_SUBJECT}-${crypto.randomUUID()}`;
    await seedSoundboardCatalogEntry("dm-removed-server", "dm-removed-sound");
    await seedSoundboardMembership("dm-removed-server", TEST_SUBJECT);
    await env.DB.prepare(
      "DELETE FROM server_members WHERE server_id = ? AND user_id = ?",
    )
      .bind("dm-removed-server", TEST_SUBJECT)
      .run();
    const socket = await openVoiceSocket(
      roomName,
      TEST_SUBJECT,
      "authenticated",
      "",
    );
    await identifyVoiceSocket(socket, crypto.randomUUID(), roomName);
    const response = nextMessageWithOpcode(socket, 18);

    socket.send(
      JSON.stringify({
        op: 106,
        d: {
          type: "soundboard.play",
          server_key: "dm-call",
          source_server_id: "dm-removed-server",
          playback_id: createSoundboardPlaybackId(
            TEST_SUBJECT,
            "dm-removed-sound",
          ),
          sound_id: "dm-removed-sound",
          name: "Airhorn",
          media_url: "/api/soundboard/uploads/dm-removed-sound",
        },
      }),
    );

    await expect(response).resolves.toMatchObject({
      d: { message: "Soundboard event was rejected" },
    });
    socket.close();
  });

  it.each([
    {
      label: "forged source server",
      sourceServerId: "dm-forged-other-server",
      soundId: "dm-forged-sound",
      mediaUrl: "/api/soundboard/uploads/dm-forged-sound",
    },
    {
      label: "forged sound ID",
      sourceServerId: "dm-forged-server",
      soundId: "dm-forged-other",
      mediaUrl: "/api/soundboard/uploads/dm-forged-other",
    },
    {
      label: "mismatched canonical URL",
      sourceServerId: "dm-forged-server",
      soundId: "dm-forged-sound",
      mediaUrl: "/api/soundboard/uploads/dm-forged-other",
    },
  ])("rejects a DM uploaded sound with a $label", async (caseData) => {
    const roomName = `dm-call-${TEST_SUBJECT}-${crypto.randomUUID()}`;
    await seedSoundboardCatalogEntry("dm-forged-server", "dm-forged-sound");
    await seedSoundboardMembership("dm-forged-server", TEST_SUBJECT);
    const socket = await openVoiceSocket(
      roomName,
      TEST_SUBJECT,
      "authenticated",
      "",
    );
    await identifyVoiceSocket(socket, crypto.randomUUID(), roomName);
    const response = nextMessageWithOpcode(socket, 18);

    socket.send(
      JSON.stringify({
        op: 106,
        d: {
          type: "soundboard.play",
          server_key: "dm-call",
          source_server_id: caseData.sourceServerId,
          playback_id: createSoundboardPlaybackId(
            TEST_SUBJECT,
            caseData.soundId,
          ),
          sound_id: caseData.soundId,
          name: "Airhorn",
          media_url: caseData.mediaUrl,
        },
      }),
    );

    await expect(response).resolves.toMatchObject({
      d: { message: "Soundboard event was rejected" },
    });
    socket.close();
  });

  it.each([
    [
      "too many track names",
      Array.from({ length: 33 }, (_, index) => `track-${index}`),
    ],
    ["an oversized track name", ["x".repeat(201)]],
  ] as const)("rejects TracksReady with %s", async (_kind, trackNames) => {
    const roomName = crypto.randomUUID();
    const socket = await openVoiceSocket(roomName);
    await identifyVoiceSocket(socket, crypto.randomUUID(), roomName);
    const response = nextMessageWithOpcode(socket, 18);

    socket.send(JSON.stringify({ op: 102, d: { track_names: trackNames } }));

    await expect(response).resolves.toMatchObject({
      op: 18,
      d: { code: 4000, message: "Invalid tracks ready payload" },
    });
    socket.close();
  });

  it("rate-limits repeated TracksReady operations before track lookup", async () => {
    const roomName = crypto.randomUUID();
    const socket = await openVoiceSocket(roomName);
    await identifyVoiceSocket(socket, crypto.randomUUID(), roomName);
    const rateLimitError = nextMessageWithOpcode(socket, 18);

    for (let index = 0; index < 61; index += 1) {
      socket.send(
        JSON.stringify({ op: 102, d: { track_names: [`track-${index}`] } }),
      );
    }

    await expect(rateLimitError).resolves.toMatchObject({
      op: 18,
      d: { code: 4290, message: "Operation rate limit exceeded" },
    });
    socket.close();
  });

  it.each([null, [], "not an object"])(
    "rejects a non-object voice app event payload: %j",
    async (payload) => {
      const roomName = crypto.randomUUID();
      const socket = await openVoiceSocket(roomName);
      await identifyVoiceSocket(socket, crypto.randomUUID(), roomName);
      const response = nextMessageWithOpcode(socket, 18);

      socket.send(JSON.stringify({ op: 106, d: payload }));

      expect(await response).toMatchObject({
        op: 18,
        d: {
          code: 4000,
          message: "Voice app event payload must be a plain object",
        },
      });
      socket.close();
    },
  );

  it("rejects unknown authenticated voice app events", async () => {
    const roomName = crypto.randomUUID();
    const socket = await openVoiceSocket(roomName);
    await identifyVoiceSocket(socket, crypto.randomUUID(), roomName);
    const response = nextMessageWithOpcode(socket, 18);

    socket.send(
      JSON.stringify({
        op: 106,
        d: { type: "arbitrary.event", secret: "must-not-broadcast" },
      }),
    );

    expect(await response).toMatchObject({
      op: 18,
      d: { code: 4000, message: "Unknown voice app event" },
    });
    socket.close();
  });

  it("rebroadcasts sanitized activity starts with the authenticated sender", async () => {
    const roomName = crypto.randomUUID();
    const socket = await openVoiceSocket(roomName, "authenticated-user");
    const participantId = crypto.randomUUID();
    await identifyVoiceSocket(
      socket,
      participantId,
      roomName,
      "authenticated-user",
    );
    const event = nextMessageWithOpcodeAndType(socket, 106, "activity.start");

    socket.send(
      JSON.stringify({
        op: 106,
        d: {
          type: "activity.start",
          userId: "spoofed-user",
          channelId: "channel-1",
          activity: "wordle",
          startedAt: Date.now(),
          secret: "must-not-broadcast",
        },
      }),
    );

    await expect(event).resolves.toMatchObject({
      op: 106,
      d: {
        type: "activity.start",
        userId: "authenticated-user",
        participant_id: participantId,
        channelId: "channel-1",
        activity: "wordle",
      },
    });
    socket.close();
  });

  it("rebroadcasts sanitized activity leaves with the authenticated sender", async () => {
    const roomName = crypto.randomUUID();
    const socket = await openVoiceSocket(roomName, "authenticated-user");
    const participantId = crypto.randomUUID();
    await identifyVoiceSocket(
      socket,
      participantId,
      roomName,
      "authenticated-user",
    );
    const event = nextMessageWithOpcodeAndType(socket, 106, "activity.leave");

    socket.send(
      JSON.stringify({
        op: 106,
        d: {
          type: "activity.leave",
          userId: "spoofed-user",
          channelId: " channel-1 ",
          secret: "must-not-broadcast",
        },
      }),
    );

    await expect(event).resolves.toMatchObject({
      op: 106,
      d: {
        type: "activity.leave",
        userId: "authenticated-user",
        participant_id: participantId,
        channelId: "channel-1",
      },
    });
    socket.close();
  });

  it.each([
    { guesses: Array.from({ length: 7 }, () => "crane") },
    { guesses: ["too-short"] },
  ])("rejects malformed Wordle progress: %j", async (progress) => {
    const roomName = crypto.randomUUID();
    const socket = await openVoiceSocket(roomName);
    await identifyVoiceSocket(socket, crypto.randomUUID(), roomName);
    const response = nextMessageWithOpcode(socket, 18);

    socket.send(
      JSON.stringify({
        op: 106,
        d: {
          type: "wordle.progress",
          channel_id: "channel-1",
          puzzle_date: "2026-06-09",
          progress: {
            name: "Ada",
            avatar: null,
            streak: 1,
            finished: false,
            missed: false,
            ...progress,
          },
        },
      }),
    );

    await expect(response).resolves.toMatchObject({
      op: 18,
      d: { code: 4000, message: "Invalid wordle.progress payload" },
    });
    socket.close();
  });

  it("rebroadcasts valid Wordle progress without accepting a spoofed user", async () => {
    const roomName = crypto.randomUUID();
    const participantId = crypto.randomUUID();
    const socket = await openVoiceSocket(roomName, "authenticated-user");
    await identifyVoiceSocket(
      socket,
      participantId,
      roomName,
      "authenticated-user",
    );
    const event = nextMessageWithOpcodeAndType(socket, 106, "wordle.progress");

    socket.send(
      JSON.stringify({
        op: 106,
        d: {
          type: "wordle.progress",
          channel_id: "channel-1",
          puzzle_date: "2026-06-09",
          progress: {
            userId: "spoofed-user",
            name: "Ada",
            avatar: null,
            guesses: ["CRANE"],
            streak: 2,
            finished: false,
            missed: false,
            secret: "must-not-broadcast",
          },
        },
      }),
    );

    await expect(event).resolves.toMatchObject({
      op: 106,
      d: {
        type: "wordle.progress",
        channel_id: "channel-1",
        puzzle_date: "2026-06-09",
        progress: {
          userId: "authenticated-user",
          participant_id: participantId,
          guesses: ["crane"],
        },
      },
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

  it("sends room broadcasts only to identified sockets", async () => {
    const roomName = crypto.randomUUID();
    const speakerId = crypto.randomUUID();
    const listenerId = crypto.randomUUID();
    const speaker = await openVoiceSocket(roomName);
    await identifyVoiceSocket(speaker, speakerId, roomName);
    const listener = await openVoiceSocket(roomName, "listener-user");
    await identifyVoiceSocket(listener, listenerId, roomName, "listener-user");
    // Admitted with a voice ticket, but never sends VoiceIdentify.
    const lurker = await openVoiceSocket(roomName, "lurker-user");
    const lurkerOps: number[] = [];
    lurker.addEventListener("message", (event) => {
      lurkerOps.push((JSON.parse(event.data as string) as { op: number }).op);
    });

    const heardSpeaking = nextMessageWithOpcode(listener, 5);
    speaker.send(JSON.stringify({ op: 5, d: { speaking: 1 } }));
    await expect(heardSpeaking).resolves.toMatchObject({
      d: { participant_id: speakerId, speaking: 1 },
    });

    const session = await issuePartyTracksSessionCapability(
      speakerId,
      roomName,
      "raw-partytracks-session-lurker",
    );
    const heardVideo = nextMessageWithOpcode(listener, 12);
    speaker.send(
      JSON.stringify({
        op: 12,
        d: {
          tracks: [
            {
              participant_id: speakerId,
              track_name: `cam-video-${speakerId}`,
              sfu_track_name: "partytracks-opaque-video",
              session_id: session,
              kind: "video",
            },
          ],
        },
      }),
    );
    await expect(heardVideo).resolves.toMatchObject({
      d: { participant_id: speakerId },
    });

    const listenerSawLeave = nextMessageWithOpcode(listener, 11);
    speaker.send(JSON.stringify({ op: 11, d: {} }));
    await expect(listenerSawLeave).resolves.toMatchObject({
      d: { participant_id: speakerId },
    });

    // Its own heartbeat ack arrives after anything sent to it before.
    const ack = nextMessageWithOpcode(lurker, 6);
    lurker.send(JSON.stringify({ op: 3, d: { seq_ack: 0 } }));
    await ack;
    expect(lurkerOps).toEqual([6]);

    listener.close();
    lurker.close();
  });

  it("closes an unidentified socket that stops heartbeating", async () => {
    const roomName = crypto.randomUUID();
    const silent = await openVoiceSocket(roomName, "silent-user");
    const standby = await openVoiceSocket(roomName, "standby-user");
    const silentClosed = new Promise<CloseEvent>((resolve) => {
      silent.addEventListener("close", resolve, { once: true });
    });
    let standbyClosed = false;
    standby.addEventListener("close", () => {
      standbyClosed = true;
    });
    const room = env.VOICE_ROOM.get(env.VOICE_ROOM.idFromName(roomName));

    // Both were last heard from longer ago than the zombie timeout...
    await runInDurableObject(room, (_instance, state) => {
      for (const ws of state.getWebSockets()) {
        const attachment = ws.deserializeAttachment() as Record<
          string,
          unknown
        >;
        ws.serializeAttachment({
          ...attachment,
          last_seen_at: Date.now() - 2 * 60 * 1000,
        });
      }
    });
    // ...but the standby socket heartbeats again, as a live one does.
    const ack = nextMessageWithOpcode(standby, 6);
    standby.send(JSON.stringify({ op: 3, d: { seq_ack: 0 } }));
    await ack;

    expect(await runDurableObjectAlarm(room)).toBe(true);

    await expect(silentClosed).resolves.toMatchObject({ code: 4009 });
    const standbyAck = nextMessageWithOpcode(standby, 6);
    standby.send(JSON.stringify({ op: 3, d: { seq_ack: 0 } }));
    await expect(standbyAck).resolves.toMatchObject({ op: 6 });
    expect(standbyClosed).toBe(false);

    standby.close();
  });

  it("schedules the alarm for an unidentified socket", async () => {
    const roomName = crypto.randomUUID();
    const socket = await openVoiceSocket(roomName, "standby-user");
    const room = env.VOICE_ROOM.get(env.VOICE_ROOM.idFromName(roomName));

    await vi.waitFor(async () => {
      const alarm = await runInDurableObject(room, (_instance, state) =>
        state.storage.getAlarm(),
      );
      expect(alarm).not.toBeNull();
    });

    socket.close();
  });

  it("records no tracks for a participant that left while its publication was being checked", async () => {
    const roomName = crypto.randomUUID();
    const publisherId = crypto.randomUUID();
    const observerId = crypto.randomUUID();
    const session = await issuePartyTracksSessionCapability(
      publisherId,
      roomName,
      "raw-partytracks-session-leaving",
    );
    const publisher = await openVoiceSocket(roomName);
    await identifyVoiceSocket(publisher, publisherId, roomName);
    const observer = await openVoiceSocket(roomName, "observer-user");
    await identifyVoiceSocket(observer, observerId, roomName, "observer-user");

    // Hold the publication's capability check open until the leave is done.
    // (Plain flags: a promise made here cannot be awaited inside the room.)
    const check = { started: false, released: false };
    const verify = crypto.subtle.verify.bind(crypto.subtle);
    const verifySpy = vi
      .spyOn(crypto.subtle, "verify")
      .mockImplementation(async (...args) => {
        check.started = true;
        while (!check.released) {
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        return verify(...args);
      });
    try {
      const observerOps: number[] = [];
      observer.addEventListener("message", (event) => {
        observerOps.push(
          (JSON.parse(event.data as string) as { op: number }).op,
        );
      });
      publisher.send(
        JSON.stringify({
          op: 12,
          d: {
            tracks: [
              {
                participant_id: publisherId,
                track_name: `cam-video-${publisherId}`,
                sfu_track_name: "partytracks-opaque-video",
                session_id: session,
                kind: "video",
              },
            ],
          },
        }),
      );
      await vi.waitFor(() => {
        expect(check.started).toBe(true);
      });

      const left = nextMessageWithOpcode(observer, 11);
      publisher.send(JSON.stringify({ op: 11, d: {} }));
      await expect(left).resolves.toMatchObject({
        d: { participant_id: publisherId },
      });

      check.released = true;
      await vi.waitFor(() => {
        expect(verifySpy).toHaveReturned();
      });
      // The observer's heartbeat ack arrives after any broadcast before it.
      const ack = nextMessageWithOpcode(observer, 6);
      observer.send(JSON.stringify({ op: 3, d: { seq_ack: 0 } }));
      await ack;

      expect(await trackNames(roomName)).toEqual([]);
      expect(observerOps).not.toContain(12);
    } finally {
      check.released = true;
      verifySpy.mockRestore();
    }

    observer.close();
  });

  it("rejects a voice token for a subject other than the admitted socket", async () => {
    const roomName = crypto.randomUUID();
    const participantId = crypto.randomUUID();
    const socket = await openVoiceSocket(roomName);
    const response = nextJsonMessage(socket);

    socket.send(
      JSON.stringify({
        op: 100,
        d: {
          participant_id: participantId,
          voice_token: await issueVoiceToken(
            participantId,
            roomName,
            "other-user",
          ),
        },
      }),
    );

    expect(await response).toMatchObject({
      op: 18,
      d: { code: 4008, message: "Voice token subject mismatch" },
    });

    socket.close();
  });

  it("broadcasts and persists PartyTracks publication metadata without calling the SFU", async () => {
    const roomName = crypto.randomUUID();
    const publisherId = crypto.randomUUID();
    const observerId = crypto.randomUUID();
    let callsRequestCount = 0;
    await mockCallsApi(roomName, async () => {
      callsRequestCount += 1;
      return Response.json({});
    });
    const firstSession = await issuePartyTracksSessionCapability(
      publisherId,
      roomName,
      "raw-partytracks-session-1",
    );
    const refreshedSession = await issuePartyTracksSessionCapability(
      publisherId,
      roomName,
      "raw-partytracks-session-2",
    );
    const publisher = await openVoiceSocket(roomName);
    await identifyVoiceSocket(publisher, publisherId, roomName);
    const observer = await openVoiceSocket(roomName, "observer-user");
    await identifyVoiceSocket(observer, observerId, roomName, "observer-user");

    const firstPublication = nextMessageWithOpcode(observer, 12);
    publisher.send(
      JSON.stringify({
        op: 12,
        d: {
          tracks: [
            {
              participant_id: publisherId,
              track_name: `cam-audio-${publisherId}`,
              sfu_track_name: "partytracks-opaque-audio",
              session_id: firstSession,
              kind: "audio",
            },
          ],
        },
      }),
    );

    await expect(firstPublication).resolves.toMatchObject({
      op: 12,
      d: {
        participant_id: publisherId,
        tracks: [
          {
            participant_id: publisherId,
            track_name: `cam-audio-${publisherId}`,
            sfu_track_name: "partytracks-opaque-audio",
            session_id: firstSession,
            kind: "audio",
          },
        ],
      },
    });
    expect(await hasMessageWithOpcode(observer, 12)).toBe(false);

    const refreshedPublication = nextMessageWithOpcode(observer, 12);
    publisher.send(
      JSON.stringify({
        op: 12,
        d: {
          tracks: [
            {
              participant_id: publisherId,
              track_name: `cam-audio-${publisherId}`,
              sfu_track_name: "partytracks-opaque-audio",
              session_id: refreshedSession,
              kind: "audio",
            },
          ],
        },
      }),
    );

    await expect(refreshedPublication).resolves.toMatchObject({
      d: {
        tracks: [
          {
            track_name: `cam-audio-${publisherId}`,
            sfu_track_name: "partytracks-opaque-audio",
            session_id: refreshedSession,
          },
        ],
      },
    });

    const lateObserverId = crypto.randomUUID();
    const lateObserver = await openVoiceSocket(roomName, "late-observer-user");
    await grantVoiceJoin(roomName, lateObserverId, "late-observer-user");
    const lateReady = nextJsonMessage(lateObserver);
    lateObserver.send(
      JSON.stringify({
        op: 100,
        d: {
          participant_id: lateObserverId,
          voice_token: await issueVoiceToken(
            lateObserverId,
            roomName,
            "late-observer-user",
          ),
        },
      }),
    );
    const lateReadyMessage = await lateReady;
    expect(lateReadyMessage).toMatchObject({
      op: 101,
      d: {
        tracks: [
          {
            track_name: `cam-audio-${publisherId}`,
            sfu_track_name: "partytracks-opaque-audio",
            session_id: refreshedSession,
          },
        ],
      },
    });

    const stoppedPublication = nextMessageWithOpcode(observer, 13);
    publisher.send(
      JSON.stringify({
        op: 13,
        d: { track_names: [`cam-audio-${publisherId}`] },
      }),
    );
    await expect(stoppedPublication).resolves.toMatchObject({
      op: 13,
      d: {
        participant_id: publisherId,
        track_names: [`cam-audio-${publisherId}`],
        tracks: [
          {
            track_name: `cam-audio-${publisherId}`,
            sfu_track_name: "partytracks-opaque-audio",
            session_id: refreshedSession,
          },
        ],
      },
    });

    const postStopObserverId = crypto.randomUUID();
    const postStopObserver = await openVoiceSocket(
      roomName,
      "post-stop-observer-user",
    );
    await grantVoiceJoin(
      roomName,
      postStopObserverId,
      "post-stop-observer-user",
    );
    const postStopReady = nextJsonMessage(postStopObserver);
    postStopObserver.send(
      JSON.stringify({
        op: 100,
        d: {
          participant_id: postStopObserverId,
          voice_token: await issueVoiceToken(
            postStopObserverId,
            roomName,
            "post-stop-observer-user",
          ),
        },
      }),
    );
    await expect(postStopReady).resolves.toMatchObject({
      op: 101,
      d: { tracks: [] },
    });
    expect(callsRequestCount).toBe(0);

    publisher.close();
    observer.close();
    lateObserver.close();
    postStopObserver.close();
  });

  it("relays a camera's simulcast layers to listeners and late joiners", async () => {
    const roomName = crypto.randomUUID();
    const publisherId = crypto.randomUUID();
    const observerId = crypto.randomUUID();
    await mockCallsApi(roomName, async () => Response.json({}));
    const session = await issuePartyTracksSessionCapability(
      publisherId,
      roomName,
      "raw-partytracks-session",
    );
    const publisher = await openVoiceSocket(roomName);
    await identifyVoiceSocket(publisher, publisherId, roomName);
    const observer = await openVoiceSocket(roomName, "observer-user");
    await identifyVoiceSocket(observer, observerId, roomName, "observer-user");
    const camera = (sfuTrackName: string, rids?: unknown) => ({
      participant_id: publisherId,
      track_name: `cam-video-${publisherId}`,
      sfu_track_name: sfuTrackName,
      session_id: session,
      kind: "video",
      ...(rids === undefined ? {} : { simulcast_rids: rids }),
    });

    const publication = nextMessageWithOpcode(observer, 12);
    publisher.send(
      JSON.stringify({
        op: 12,
        d: { tracks: [camera("opaque-camera", ["f", "h", "q"])] },
      }),
    );
    await expect(publication).resolves.toMatchObject({
      d: {
        tracks: [
          {
            track_name: `cam-video-${publisherId}`,
            simulcast_rids: ["f", "h", "q"],
          },
        ],
      },
    });

    const lateObserverId = crypto.randomUUID();
    const lateObserver = await openVoiceSocket(roomName, "late-observer-user");
    await grantVoiceJoin(roomName, lateObserverId, "late-observer-user");
    const lateReady = nextJsonMessage(lateObserver);
    lateObserver.send(
      JSON.stringify({
        op: 100,
        d: {
          participant_id: lateObserverId,
          voice_token: await issueVoiceToken(
            lateObserverId,
            roomName,
            "late-observer-user",
          ),
        },
      }),
    );
    await expect(lateReady).resolves.toMatchObject({
      op: 101,
      d: {
        tracks: [
          {
            track_name: `cam-video-${publisherId}`,
            simulcast_rids: ["f", "h", "q"],
          },
        ],
      },
    });

    // The PartyTracks proxy asks for the layers of pulls that name none
    // (clients older than simulcast), with the join check it already makes.
    const authorizeMedia = async (subject: string, participantId: string) => {
      const room = env.VOICE_ROOM.get(env.VOICE_ROOM.idFromName(roomName));
      const response = await room.fetch(
        "https://internal/voice-media-authorization",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            participant_id: participantId,
            subject,
            tracks: [
              { session_id: session, track_name: "opaque-camera" },
              { session_id: session, track_name: "opaque-microphone" },
              { session_id: "other-session", track_name: "opaque-camera" },
            ],
          }),
        },
      );
      return response.json();
    };
    await expect(
      authorizeMedia("late-observer-user", lateObserverId),
    ).resolves.toEqual({
      authorized: true,
      simulcast: [
        {
          sessionId: session,
          trackName: "opaque-camera",
          rids: ["f", "h", "q"],
        },
      ],
    });

    // Malformed layers (duplicate RIDs) are refused, not stored.
    publisher.send(
      JSON.stringify({
        op: 12,
        d: { tracks: [camera("opaque-camera-bad", ["f", "f"])] },
      }),
    );
    expect(await hasMessageWithOpcode(observer, 12)).toBe(false);

    // Republished without simulcast (e.g. the browser declined it): the
    // stored layers go with the old publication.
    const singleLayer = nextMessageWithOpcode(observer, 12);
    publisher.send(
      JSON.stringify({ op: 12, d: { tracks: [camera("opaque-camera-2")] } }),
    );
    const singleLayerMessage = (await singleLayer) as {
      d: { tracks: Array<Record<string, unknown>> };
    };
    expect(singleLayerMessage.d.tracks[0]).toMatchObject({
      sfu_track_name: "opaque-camera-2",
    });
    expect(singleLayerMessage.d.tracks[0]).not.toHaveProperty("simulcast_rids");

    publisher.close();
    observer.close();
    lateObserver.close();
  });

  it("keeps two PartyTracks participants off the direct Calls signaling path", async () => {
    const roomName = crypto.randomUUID();
    const firstParticipantId = crypto.randomUUID();
    const secondParticipantId = crypto.randomUUID();
    let callsRequestCount = 0;
    await mockCallsApi(roomName, async () => {
      callsRequestCount += 1;
      return Response.json({});
    });

    const first = await openVoiceSocket(roomName, "partytracks-first");
    await identifyVoiceSocket(
      first,
      firstParticipantId,
      roomName,
      "partytracks-first",
    );
    const second = await openVoiceSocket(roomName, "partytracks-second");
    await identifyVoiceSocket(
      second,
      secondParticipantId,
      roomName,
      "partytracks-second",
    );

    const firstCapability = await issuePartyTracksSessionCapability(
      firstParticipantId,
      roomName,
      "partytracks-session-first",
    );
    const secondCapability = await issuePartyTracksSessionCapability(
      secondParticipantId,
      roomName,
      "partytracks-session-second",
    );
    const firstOffer = nextMessageWithOpcode(second, 12);
    first.send(
      JSON.stringify({
        op: 12,
        d: {
          tracks: [
            {
              participant_id: firstParticipantId,
              track_name: `cam-audio-${firstParticipantId}`,
              sfu_track_name: "opaque-first",
              session_id: firstCapability,
              kind: "audio",
            },
          ],
        },
      }),
    );
    await expect(firstOffer).resolves.toMatchObject({
      d: {
        tracks: [
          {
            sfu_track_name: "opaque-first",
            session_id: firstCapability,
          },
        ],
      },
    });

    const secondOffer = nextMessageWithOpcode(first, 12);
    second.send(
      JSON.stringify({
        op: 12,
        d: {
          tracks: [
            {
              participant_id: secondParticipantId,
              track_name: `cam-audio-${secondParticipantId}`,
              sfu_track_name: "opaque-second",
              session_id: secondCapability,
              kind: "audio",
            },
          ],
        },
      }),
    );
    await expect(secondOffer).resolves.toMatchObject({
      d: {
        tracks: [
          {
            sfu_track_name: "opaque-second",
            session_id: secondCapability,
          },
        ],
      },
    });

    expect(callsRequestCount).toBe(0);
    for (const opcode of [4, 10, 108]) {
      expect(await hasMessageWithOpcode(first, opcode)).toBe(false);
      expect(await hasMessageWithOpcode(second, opcode)).toBe(false);
    }
    first.close();
    second.close();
  });

  it.each([
    {
      label: "camera push",
      op: 1,
      d: {
        sdp: "browser-camera-offer",
        push_prefix: "cam",
        push_tracks: [
          { track_name: "cam-audio-browser", kind: "audio", mid: "0" },
        ],
        pull_tracks: [],
      },
    },
    {
      label: "pull",
      op: 1,
      d: {
        push_tracks: [],
        pull_tracks: [
          {
            participant_id: "publisher",
            track_name: "cam-audio-publisher",
            session_id: "publisher-session",
            kind: "audio",
          },
        ],
      },
    },
    {
      label: "mixed push and pull",
      op: 1,
      d: {
        sdp: "mixed-offer",
        push_prefix: "screen",
        push_tracks: [
          { track_name: "screen-video-browser", kind: "video", mid: "0" },
        ],
        pull_tracks: [
          {
            participant_id: "publisher",
            track_name: "cam-video-publisher",
            session_id: "publisher-session",
            kind: "video",
          },
        ],
      },
    },
  ])(
    "rejects unsupported browser SFU $label without side effects",
    async (message) => {
      const roomName = crypto.randomUUID();
      const participantId = crypto.randomUUID();
      let callsRequestCount = 0;
      await mockCallsApi(roomName, async (request) => {
        callsRequestCount += 1;
        const url = new URL(request.url);
        if (url.pathname.endsWith("/sessions/new")) {
          return Response.json({ sessionId: "unexpected-browser-session" });
        }
        if (url.pathname.endsWith("/tracks/new")) {
          return Response.json({
            sessionDescription: { type: "answer", sdp: "unexpected-answer" },
            tracks: [
              {
                location: "local",
                trackName: "cam-audio-browser",
                mid: "0",
              },
            ],
          });
        }
        return Response.json({});
      });
      const socket = await openVoiceSocket(roomName);
      await identifyVoiceSocket(socket, participantId, roomName);
      const unsupported = nextMessageWithOpcodeOrNull(socket, 18);

      socket.send(JSON.stringify({ op: message.op, d: message.d }));

      await expect(unsupported).resolves.toMatchObject({
        op: 18,
        d: { code: 4000, message: "Browser SFU negotiation is unsupported" },
      });
      expect(callsRequestCount).toBe(0);
      await runInDurableObject(
        env.VOICE_ROOM.get(env.VOICE_ROOM.idFromName(roomName)),
        (_instance, state) => {
          const tracks = [
            ...state.storage.sql.exec(
              "SELECT track_name FROM tracks WHERE participant_id = ?",
              participantId,
            ),
          ];
          expect(tracks).toHaveLength(0);
        },
      );
      for (const opcode of [4, 10, 108]) {
        expect(await hasMessageWithOpcode(socket, opcode)).toBe(false);
      }
      socket.close();
    },
  );

  it.each([107, 105])(
    "answers retired browser SFU opcode %i as an unknown opcode",
    async (op) => {
      const roomName = crypto.randomUUID();
      const participantId = crypto.randomUUID();
      let callsRequestCount = 0;
      await mockCallsApi(roomName, async () => {
        callsRequestCount += 1;
        return Response.json({});
      });
      const socket = await openVoiceSocket(roomName);
      await identifyVoiceSocket(socket, participantId, roomName);
      const unknown = nextMessageWithOpcodeOrNull(socket, 18);

      socket.send(JSON.stringify({ op, d: {} }));

      await expect(unknown).resolves.toMatchObject({
        op: 18,
        d: { code: 4001, message: `Unknown voice opcode: ${op}` },
      });
      expect(callsRequestCount).toBe(0);
      socket.close();
    },
  );

  it("negotiates and publishes only owned native screen tracks", async () => {
    const roomName = crypto.randomUUID();
    const participantId = crypto.randomUUID();
    const callsRequests: Array<{
      body: unknown;
      method: string;
      pathname: string;
    }> = [];
    await mockCallsApi(roomName, async (request) => {
      const url = new URL(request.url);
      const rawBody = await request.text();
      const body: unknown = rawBody ? JSON.parse(rawBody) : null;
      callsRequests.push({
        body,
        method: request.method,
        pathname: url.pathname,
      });
      if (url.pathname.endsWith("/sessions/new")) {
        return Response.json({ sessionId: "native-screen-session" });
      }
      if (url.pathname.endsWith("/tracks/new")) {
        return Response.json({
          sessionDescription: { type: "answer", sdp: "native-answer" },
          tracks: [
            {
              location: "local",
              trackName: `screen-video-${participantId}`,
              mid: "0",
            },
            {
              location: "local",
              trackName: `screen-audio-${participantId}`,
              mid: "1",
            },
          ],
        });
      }
      if (url.pathname.endsWith("/tracks/close")) {
        return Response.json({});
      }
      throw new Error(`Unexpected Calls request: ${request.url}`);
    });

    const publisher = await openVoiceSocket(roomName);
    await identifyVoiceSocket(publisher, participantId, roomName);
    const observer = await openVoiceSocket(roomName, "native-observer");
    await identifyVoiceSocket(
      observer,
      crypto.randomUUID(),
      roomName,
      "native-observer",
    );
    const negotiationMessages = nextMessagesWithOpcodes(publisher, [4, 10]);
    publisher.send(
      JSON.stringify({
        op: 1,
        d: {
          sdp: "native-offer",
          push_prefix: "screen",
          request_id: "native-screen-request",
          push_tracks: [
            {
              track_name: `screen-video-${participantId}`,
              kind: "video",
              mid: "0",
            },
            {
              track_name: `screen-audio-${participantId}`,
              kind: "audio",
              mid: "1",
            },
          ],
          pull_tracks: [],
        },
      }),
    );

    const messages = await negotiationMessages;
    expect(messages.get(4)).toMatchObject({
      op: 4,
      d: {
        operation: "push",
        push_prefix: "screen",
        request_id: "native-screen-request",
        sdp: "native-answer",
        sdp_type: "answer",
        session_id: "native-screen-session",
      },
    });
    expect(messages.get(10)).toMatchObject({
      op: 10,
      d: {
        operation: "push",
        push_prefix: "screen",
        request_id: "native-screen-request",
        session_id: "native-screen-session",
      },
    });
    expect(await hasMessageWithOpcode(observer, 12)).toBe(false);

    const published = nextMessageWithOpcode(observer, 12);
    publisher.send(
      JSON.stringify({
        op: 102,
        d: {
          track_names: [
            `screen-video-${participantId}`,
            `screen-audio-${participantId}`,
            "screen-video-forged-participant",
          ],
        },
      }),
    );
    // Announced pullable: the pushed name as the SFU track name, and a
    // capability for the native session (viewers pull via PartyTracks).
    const nativeCapability = await issuePartyTracksSessionCapability(
      participantId,
      roomName,
      "native-screen-session",
    );
    await expect(published).resolves.toMatchObject({
      d: {
        tracks: [
          {
            participant_id: participantId,
            track_name: `screen-video-${participantId}`,
            sfu_track_name: `screen-video-${participantId}`,
            session_id: nativeCapability,
          },
          {
            participant_id: participantId,
            track_name: `screen-audio-${participantId}`,
            sfu_track_name: `screen-audio-${participantId}`,
            session_id: nativeCapability,
          },
        ],
      },
    });

    const stopped = nextMessageWithOpcode(observer, 13);
    publisher.send(
      JSON.stringify({
        op: 13,
        d: {
          track_names: [
            `screen-video-${participantId}`,
            `screen-audio-${participantId}`,
          ],
        },
      }),
    );
    await expect(stopped).resolves.toMatchObject({
      d: {
        participant_id: participantId,
        track_names: [
          `screen-video-${participantId}`,
          `screen-audio-${participantId}`,
        ],
      },
    });
    await vi.waitFor(() => {
      expect(
        callsRequests.filter((request) =>
          request.pathname.endsWith("/tracks/close"),
        ),
      ).toHaveLength(1);
    });
    publisher.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(
      callsRequests.filter((request) =>
        request.pathname.endsWith("/tracks/close"),
      ),
    ).toHaveLength(1);
    observer.close();
  });

  it("invalidates an in-flight native screen publication when StopTracks arrives", async () => {
    const roomName = crypto.randomUUID();
    const participantId = crypto.randomUUID();
    const trackName = `screen-video-${participantId}`;
    const delayedTracksResponse = createDeferred<void>();
    const callsPaths: string[] = [];
    await mockCallsApi(roomName, async (request) => {
      const pathname = new URL(request.url).pathname;
      callsPaths.push(pathname);
      if (pathname.endsWith("/sessions/new")) {
        return Response.json({ sessionId: "native-stop-race-session" });
      }
      if (pathname.endsWith("/tracks/new")) {
        await delayedTracksResponse.promise;
        return Response.json({
          sessionDescription: { type: "answer", sdp: "stale-answer" },
          tracks: [{ location: "local", trackName, mid: "0" }],
        });
      }
      if (pathname.endsWith("/tracks/close")) return Response.json({});
      throw new Error(`Unexpected Calls request: ${request.url}`);
    });

    const publisher = await openVoiceSocket(roomName, "native-stop-race");
    await identifyVoiceSocket(
      publisher,
      participantId,
      roomName,
      "native-stop-race",
    );
    const observer = await openVoiceSocket(roomName, "native-stop-observer");
    await identifyVoiceSocket(
      observer,
      crypto.randomUUID(),
      roomName,
      "native-stop-observer",
    );

    sendNativeScreenSelect(publisher, participantId, "native-stop-race");
    await vi.waitFor(() => {
      expect(
        callsPaths.filter((pathname) => pathname.endsWith("/tracks/new")),
      ).toHaveLength(1);
    });

    const heartbeat = nextMessageWithOpcode(publisher, 6);
    publisher.send(JSON.stringify({ op: 13, d: { track_names: [trackName] } }));
    publisher.send(JSON.stringify({ op: 3, d: {} }));
    await heartbeat;

    const staleDescription = hasMessageWithOpcode(publisher, 4, 250);
    const staleNegotiation = hasMessageWithOpcode(publisher, 10, 250);
    const staleError = hasMessageWithOpcode(publisher, 18, 250);
    const stalePublication = hasMessageWithOpcode(observer, 12, 250);
    delayedTracksResponse.resolve(undefined);

    await vi.waitFor(() => {
      expect(
        callsPaths.filter((pathname) =>
          pathname.endsWith("/sessions/native-stop-race-session/tracks/close"),
        ),
      ).toHaveLength(1);
    });
    await expect(staleDescription).resolves.toBe(false);
    await expect(staleNegotiation).resolves.toBe(false);
    await expect(staleError).resolves.toBe(false);
    await expect(stalePublication).resolves.toBe(false);

    const lateParticipantId = crypto.randomUUID();
    const late = await openVoiceSocket(roomName, "native-stop-late");
    await grantVoiceJoin(roomName, lateParticipantId, "native-stop-late");
    const ready = nextJsonMessage(late);
    late.send(
      JSON.stringify({
        op: 100,
        d: {
          participant_id: lateParticipantId,
          voice_token: await issueVoiceToken(
            lateParticipantId,
            roomName,
            "native-stop-late",
          ),
        },
      }),
    );
    await expect(ready).resolves.toMatchObject({ op: 101, d: { tracks: [] } });

    publisher.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(
      callsPaths.filter((pathname) =>
        pathname.endsWith("/sessions/native-stop-race-session/tracks/close"),
      ),
    ).toHaveLength(1);
    observer.close();
    late.close();
  });

  it("keeps only the latest overlapping native screen publication", async () => {
    const roomName = crypto.randomUUID();
    const participantId = crypto.randomUUID();
    const trackName = `screen-video-${participantId}`;
    const delayedFirstSession = createDeferred<void>();
    const callsPaths: string[] = [];
    let sessionRequestCount = 0;
    await mockCallsApi(roomName, async (request) => {
      const pathname = new URL(request.url).pathname;
      callsPaths.push(pathname);
      if (pathname.endsWith("/sessions/new")) {
        sessionRequestCount += 1;
        if (sessionRequestCount === 1) {
          await delayedFirstSession.promise;
          return Response.json({ sessionId: "native-first-session" });
        }
        return Response.json({ sessionId: "native-latest-session" });
      }
      if (pathname.endsWith("/tracks/new")) {
        const sessionId = pathname.includes("native-first-session")
          ? "native-first-session"
          : "native-latest-session";
        return Response.json({
          sessionDescription: {
            type: "answer",
            sdp: `answer-${sessionId}`,
          },
          tracks: [{ location: "local", trackName, mid: "0" }],
        });
      }
      if (pathname.endsWith("/tracks/close")) return Response.json({});
      throw new Error(`Unexpected Calls request: ${request.url}`);
    });

    const publisher = await openVoiceSocket(roomName, "native-overlap");
    await identifyVoiceSocket(
      publisher,
      participantId,
      roomName,
      "native-overlap",
    );
    const observer = await openVoiceSocket(roomName, "native-overlap-observer");
    await identifyVoiceSocket(
      observer,
      crypto.randomUUID(),
      roomName,
      "native-overlap-observer",
    );

    sendNativeScreenSelect(publisher, participantId, "native-first-request");
    await vi.waitFor(() => expect(sessionRequestCount).toBe(1));

    const latestMessages = nextMessagesWithOpcodes(publisher, [4, 10]);
    sendNativeScreenSelect(publisher, participantId, "native-latest-request");
    const messages = await latestMessages;
    expect(messages.get(4)).toMatchObject({
      d: {
        request_id: "native-latest-request",
        session_id: "native-latest-session",
      },
    });
    expect(messages.get(10)).toMatchObject({
      d: {
        request_id: "native-latest-request",
        session_id: "native-latest-session",
      },
    });
    expect(await hasMessageWithOpcode(observer, 12)).toBe(false);

    const staleDescription = hasMessageWithOpcode(publisher, 4, 250);
    const staleNegotiation = hasMessageWithOpcode(publisher, 10, 250);
    delayedFirstSession.resolve(undefined);
    await vi.waitFor(() => {
      expect(
        callsPaths.filter((pathname) =>
          pathname.endsWith("/sessions/native-first-session/tracks/close"),
        ),
      ).toHaveLength(1);
    });
    await expect(staleDescription).resolves.toBe(false);
    await expect(staleNegotiation).resolves.toBe(false);
    expect(
      callsPaths.filter((pathname) =>
        pathname.endsWith("/sessions/native-first-session/tracks/new"),
      ),
    ).toHaveLength(0);

    const published = nextMessageWithOpcode(observer, 12);
    publisher.send(
      JSON.stringify({ op: 102, d: { track_names: [trackName] } }),
    );
    await expect(published).resolves.toMatchObject({
      d: {
        tracks: [
          {
            track_name: trackName,
            sfu_track_name: trackName,
            session_id: await issuePartyTracksSessionCapability(
              participantId,
              roomName,
              "native-latest-session",
            ),
          },
        ],
      },
    });

    publisher.close();
    await vi.waitFor(() => {
      expect(
        callsPaths.filter((pathname) =>
          pathname.endsWith("/sessions/native-latest-session/tracks/close"),
        ),
      ).toHaveLength(1);
    });
    expect(
      callsPaths.filter((pathname) =>
        pathname.endsWith("/sessions/native-first-session/tracks/close"),
      ),
    ).toHaveLength(1);
    observer.close();
  });

  it("closes an in-flight native screen publication when the publisher disconnects", async () => {
    const roomName = crypto.randomUUID();
    const participantId = crypto.randomUUID();
    const trackName = `screen-video-${participantId}`;
    const delayedTracksResponse = createDeferred<void>();
    const callsPaths: string[] = [];
    await mockCallsApi(roomName, async (request) => {
      const pathname = new URL(request.url).pathname;
      callsPaths.push(pathname);
      if (pathname.endsWith("/sessions/new")) {
        return Response.json({ sessionId: "native-disconnect-race-session" });
      }
      if (pathname.endsWith("/tracks/new")) {
        await delayedTracksResponse.promise;
        return Response.json({
          sessionDescription: {
            type: "answer",
            sdp: "disconnected-answer",
          },
          tracks: [{ location: "local", trackName, mid: "0" }],
        });
      }
      if (pathname.endsWith("/tracks/close")) return Response.json({});
      throw new Error(`Unexpected Calls request: ${request.url}`);
    });

    const publisher = await openVoiceSocket(roomName, "native-disconnect-race");
    await identifyVoiceSocket(
      publisher,
      participantId,
      roomName,
      "native-disconnect-race",
    );
    const observer = await openVoiceSocket(
      roomName,
      "native-disconnect-observer",
    );
    await identifyVoiceSocket(
      observer,
      crypto.randomUUID(),
      roomName,
      "native-disconnect-observer",
    );

    sendNativeScreenSelect(publisher, participantId, "native-disconnect-race");
    await vi.waitFor(() => {
      expect(
        callsPaths.filter((pathname) => pathname.endsWith("/tracks/new")),
      ).toHaveLength(1);
    });

    const staleDescription = hasMessageWithOpcode(publisher, 4, 250);
    const staleNegotiation = hasMessageWithOpcode(publisher, 10, 250);
    const stalePublication = hasMessageWithOpcode(observer, 12, 250);
    publisher.close();
    // Held through a possible reconnect; the native share ends at once.
    await vi.waitFor(async () => {
      expect(await heldUntil(roomName, participantId)).toEqual(
        expect.any(Number),
      );
    });

    delayedTracksResponse.resolve(undefined);
    await vi.waitFor(() => {
      expect(
        callsPaths.filter((pathname) =>
          pathname.endsWith(
            "/sessions/native-disconnect-race-session/tracks/close",
          ),
        ),
      ).toHaveLength(1);
    });
    await expect(staleDescription).resolves.toBe(false);
    await expect(staleNegotiation).resolves.toBe(false);
    await expect(stalePublication).resolves.toBe(false);

    const lateParticipantId = crypto.randomUUID();
    const late = await openVoiceSocket(roomName, "native-disconnect-late");
    await grantVoiceJoin(roomName, lateParticipantId, "native-disconnect-late");
    const ready = nextJsonMessage(late);
    late.send(
      JSON.stringify({
        op: 100,
        d: {
          participant_id: lateParticipantId,
          voice_token: await issueVoiceToken(
            lateParticipantId,
            roomName,
            "native-disconnect-late",
          ),
        },
      }),
    );
    await expect(ready).resolves.toMatchObject({ op: 101, d: { tracks: [] } });
    expect(
      callsPaths.filter((pathname) =>
        pathname.endsWith(
          "/sessions/native-disconnect-race-session/tracks/close",
        ),
      ),
    ).toHaveLength(1);

    const disconnected = nextMessageWithOpcode(observer, 11);
    await expireReconnectHolds(roomName);
    await expect(disconnected).resolves.toMatchObject({
      d: { participant_id: participantId },
    });
    observer.close();
    late.close();
  });

  it("replays PartyTracks and ready native screen descriptors without transfer state", async () => {
    const roomName = crypto.randomUUID();
    const participantId = crypto.randomUUID();
    const partyTracksCapability = await issuePartyTracksSessionCapability(
      participantId,
      roomName,
      "partytracks-replay-session",
    );
    await mockCallsApi(roomName, async (request) => {
      const url = new URL(request.url);
      if (url.pathname.endsWith("/sessions/new")) {
        return Response.json({ sessionId: "native-replay-session" });
      }
      if (url.pathname.endsWith("/tracks/new")) {
        return Response.json({
          sessionDescription: { type: "answer", sdp: "native-answer" },
          tracks: [
            {
              location: "local",
              trackName: `screen-video-${participantId}`,
              mid: "0",
            },
          ],
        });
      }
      if (url.pathname.endsWith("/tracks/close")) return Response.json({});
      throw new Error(`Unexpected Calls request: ${request.url}`);
    });
    const publisher = await openVoiceSocket(roomName);
    await identifyVoiceSocket(publisher, participantId, roomName);
    publisher.send(
      JSON.stringify({
        op: 12,
        d: {
          tracks: [
            {
              participant_id: participantId,
              track_name: `cam-audio-${participantId}`,
              sfu_track_name: "opaque-replay-audio",
              session_id: partyTracksCapability,
              kind: "audio",
            },
          ],
        },
      }),
    );
    publisher.send(
      JSON.stringify({
        op: 1,
        d: {
          sdp: "native-offer",
          push_prefix: "screen",
          request_id: "native-replay-request",
          push_tracks: [
            {
              track_name: `screen-video-${participantId}`,
              kind: "video",
              mid: "0",
            },
          ],
          pull_tracks: [],
        },
      }),
    );
    await nextMessageWithOpcode(publisher, 4);
    await nextMessageWithOpcode(publisher, 10);
    publisher.send(
      JSON.stringify({
        op: 102,
        d: { track_names: [`screen-video-${participantId}`] },
      }),
    );

    const lateParticipantId = crypto.randomUUID();
    const late = await openVoiceSocket(roomName, "native-replay-observer");
    await grantVoiceJoin(roomName, lateParticipantId, "native-replay-observer");
    const ready = nextJsonMessage(late);
    late.send(
      JSON.stringify({
        op: 100,
        d: {
          participant_id: lateParticipantId,
          voice_token: await issueVoiceToken(
            lateParticipantId,
            roomName,
            "native-replay-observer",
          ),
        },
      }),
    );
    const readyMessage = await ready;
    expect(readyMessage).toMatchObject({
      op: 101,
      d: {
        tracks: expect.arrayContaining([
          expect.objectContaining({
            participant_id: participantId,
            track_name: `cam-audio-${participantId}`,
            sfu_track_name: "opaque-replay-audio",
            session_id: partyTracksCapability,
            kind: "audio",
          }),
          expect.objectContaining({
            participant_id: participantId,
            track_name: `screen-video-${participantId}`,
            sfu_track_name: `screen-video-${participantId}`,
            session_id: await issuePartyTracksSessionCapability(
              participantId,
              roomName,
              "native-replay-session",
            ),
            kind: "video",
          }),
        ]),
      },
    });
    expect(readyMessage.d).not.toHaveProperty("sfu_session_transferred");
    expect(readyMessage.d).not.toHaveProperty("pull_session_id");
    publisher.close();
    late.close();
  });

  it("does not replay tracks of participants whose voice socket vanished in a restart", async () => {
    const roomName = crypto.randomUUID();
    const room = env.VOICE_ROOM.get(env.VOICE_ROOM.idFromName(roomName));
    const goneId = crypto.randomUUID();
    const listenerOldId = crypto.randomUUID();
    const liveId = crypto.randomUUID();
    const listenerId = crypto.randomUUID();
    await mockCallsApi(roomName, async () => Response.json({}));

    // A restart drops every socket without webSocketClose: the participant
    // and track rows stay until the zombie alarm. One of them is the
    // listener's own previous participant (same user, new id after restart).
    const leftover = [
      { participantId: goneId, subject: "gone-user" },
      { participantId: listenerOldId, subject: "listener-user" },
    ];
    await runInDurableObject(room, (_instance, state) => {
      for (const { participantId, subject } of leftover) {
        state.storage.sql.exec(
          "INSERT INTO participants (id, user_id, native_screen_session_id, last_heartbeat, speaking, connection_id) VALUES (?, ?, NULL, ?, 1, ?)",
          participantId,
          subject,
          Date.now(),
          crypto.randomUUID(),
        );
        state.storage.sql.exec(
          "INSERT INTO tracks (track_name, participant_id, sfu_track_name, session_id, kind) VALUES (?, ?, ?, ?, 'audio')",
          `cam-audio-${participantId}`,
          participantId,
          `opaque-${participantId}`,
          `dead-session-${participantId}`,
        );
      }
    });

    const live = await openVoiceSocket(roomName, "live-user");
    await identifyVoiceSocket(live, liveId, roomName, "live-user");
    const liveSession = await issuePartyTracksSessionCapability(
      liveId,
      roomName,
      "live-partytracks-session",
    );
    live.send(
      JSON.stringify({
        op: 12,
        d: {
          tracks: [
            {
              participant_id: liveId,
              track_name: `cam-audio-${liveId}`,
              sfu_track_name: "opaque-live-audio",
              session_id: liveSession,
              kind: "audio",
            },
          ],
        },
      }),
    );
    await vi.waitFor(async () => {
      expect(await trackNames(roomName)).toContain(`cam-audio-${liveId}`);
    });

    const listener = await openVoiceSocket(roomName, "listener-user");
    await grantVoiceJoin(roomName, listenerId, "listener-user");
    const ready = nextMessageWithOpcode(listener, 101);
    listener.send(
      JSON.stringify({
        op: 100,
        d: {
          participant_id: listenerId,
          voice_token: await issueVoiceToken(
            listenerId,
            roomName,
            "listener-user",
          ),
        },
      }),
    );
    const readyMessage = (await ready) as {
      d: { tracks: Array<{ participant_id: string }>; speaking: object };
    };

    expect(readyMessage.d.tracks).toEqual([
      expect.objectContaining({
        participant_id: liveId,
        track_name: `cam-audio-${liveId}`,
        sfu_track_name: "opaque-live-audio",
      }),
    ]);
    expect(readyMessage.d.speaking).toEqual({});
    live.close();
    listener.close();
  });

  it("keeps replaying a participant's tracks while its voice socket reconnects", async () => {
    const roomName = crypto.randomUUID();
    const publisherId = crypto.randomUUID();
    const listenerId = crypto.randomUUID();
    await mockCallsApi(roomName, async () => Response.json({}));
    const publisher = await openVoiceSocket(roomName);
    await identifyVoiceSocket(publisher, publisherId, roomName);
    const session = await issuePartyTracksSessionCapability(
      publisherId,
      roomName,
      "resuming-partytracks-session",
    );
    publisher.send(
      JSON.stringify({
        op: 12,
        d: {
          tracks: [
            {
              participant_id: publisherId,
              track_name: `cam-audio-${publisherId}`,
              sfu_track_name: "opaque-resuming-audio",
              session_id: session,
              kind: "audio",
            },
          ],
        },
      }),
    );
    await vi.waitFor(async () => {
      expect(await trackNames(roomName)).toContain(`cam-audio-${publisherId}`);
    });

    // The replacement socket is open but has not identified yet; the old
    // one still carries the participant until the new one replaces it.
    const replacement = await openVoiceSocket(roomName);
    const listener = await openVoiceSocket(roomName, "listener-user");
    await grantVoiceJoin(roomName, listenerId, "listener-user");
    const ready = nextMessageWithOpcode(listener, 101);
    listener.send(
      JSON.stringify({
        op: 100,
        d: {
          participant_id: listenerId,
          voice_token: await issueVoiceToken(
            listenerId,
            roomName,
            "listener-user",
          ),
        },
      }),
    );

    await expect(ready).resolves.toMatchObject({
      d: {
        tracks: [
          expect.objectContaining({
            participant_id: publisherId,
            track_name: `cam-audio-${publisherId}`,
            sfu_track_name: "opaque-resuming-audio",
            session_id: session,
          }),
        ],
      },
    });
    publisher.close();
    replacement.close();
    listener.close();
  });

  it("limits public-demo sockets to temporary demo chat events", async () => {
    const roomName = crypto.randomUUID();
    const subject = "demo-test-subject";
    const participantId = crypto.randomUUID();
    const socket = await openVoiceSocket(roomName, subject, "public-demo");
    await identifyVoiceSocket(socket, participantId, roomName, subject);
    socket.send(
      JSON.stringify({
        op: 106,
        d: { type: "activity.start", name: "not allowed" },
      }),
    );

    expect(await nextMessageWithOpcode(socket, 18)).toMatchObject({
      op: 18,
      d: {
        code: 4003,
        message: "Voice app event is unavailable in public demo rooms",
      },
    });

    socket.close();
  });

  describe("voice join grant revocation", () => {
    const closeOf = (socket: WebSocket) =>
      new Promise<{ code: number; reason: string }>((resolve) => {
        socket.addEventListener(
          "close",
          (event) => resolve({ code: event.code, reason: event.reason }),
          { once: true },
        );
      });
    const participantRowCount = (roomName: string, participantId: string) =>
      runInDurableObject(
        env.VOICE_ROOM.get(env.VOICE_ROOM.idFromName(roomName)),
        (_instance, state) =>
          [
            ...state.storage.sql.exec(
              "SELECT id FROM participants WHERE id = ?",
              participantId,
            ),
          ].length,
      );

    it("closes a replaced participant with SessionReplaced and tells the room it left", async () => {
      const roomName = crypto.randomUUID();
      const replacedId = crypto.randomUUID();
      const replacedSocket = await openVoiceSocket(roomName, "replaced-user");
      await identifyVoiceSocket(
        replacedSocket,
        replacedId,
        roomName,
        "replaced-user",
      );
      const observer = await openVoiceSocket(roomName, "observer-user");
      await identifyVoiceSocket(
        observer,
        crypto.randomUUID(),
        roomName,
        "observer-user",
      );

      const error = nextMessageWithOpcode(replacedSocket, 18);
      const closed = closeOf(replacedSocket);
      const disconnect = nextMessageWithOpcode(observer, 11);
      await grantVoiceJoin(roomName, replacedId, "replaced-user", false, true);

      await expect(error).resolves.toMatchObject({
        op: 18,
        d: { code: 4010, message: "Voice moved to another device" },
      });
      await expect(closed).resolves.toMatchObject({ code: 4010 });
      await expect(disconnect).resolves.toMatchObject({
        op: 11,
        d: { participant_id: replacedId },
      });
      expect(await participantRowCount(roomName, replacedId)).toBe(0);
      observer.close();
    });

    it("closes a plainly revoked participant with a normal close and no SessionReplaced error", async () => {
      const roomName = crypto.randomUUID();
      const participantId = crypto.randomUUID();
      const socket = await openVoiceSocket(roomName, "revoked-user");
      await identifyVoiceSocket(
        socket,
        participantId,
        roomName,
        "revoked-user",
      );

      const errors: Array<{ d: unknown }> = [];
      socket.addEventListener("message", (event) => {
        const message = JSON.parse(event.data as string) as {
          op: number;
          d: unknown;
        };
        if (message.op === 18) errors.push(message);
      });
      const closed = closeOf(socket);
      await grantVoiceJoin(roomName, participantId, "revoked-user", false);

      await expect(closed).resolves.toMatchObject({ code: 1000 });
      expect(errors).toEqual([]);
      expect(await participantRowCount(roomName, participantId)).toBe(0);
    });

    it("reaps a participant the MeetingRoom no longer reports as joined", async () => {
      const roomName = crypto.randomUUID();
      const ghostId = crypto.randomUUID();
      const ghost = await openVoiceSocket(roomName, "ghost-user");
      // Granted only by a direct push: no MeetingRoom session exists for it.
      await identifyVoiceSocket(ghost, ghostId, roomName, "ghost-user");
      const room = env.VOICE_ROOM.get(env.VOICE_ROOM.idFromName(roomName));

      // Inside the recheck window the grant stands and the alarm leaves it be.
      expect(await runDurableObjectAlarm(room)).toBe(true);
      expect(await participantRowCount(roomName, ghostId)).toBe(1);

      await runInDurableObject(room, (instance) => {
        (
          instance as unknown as { voiceJoinGrantRecheckMs: number }
        ).voiceJoinGrantRecheckMs = 0;
      });
      const closed = closeOf(ghost);
      expect(await runDurableObjectAlarm(room)).toBe(true);

      await expect(closed).resolves.toMatchObject({ code: 1000 });
      expect(await participantRowCount(roomName, ghostId)).toBe(0);

      // Its client reconnecting the voice socket is refused, not re-admitted
      // by the old grant and reaped again at the next alarm.
      const again = await openVoiceSocket(roomName, "ghost-user");
      const refused = nextMessageWithOpcode(again, 18);
      again.send(
        JSON.stringify({
          op: 100,
          d: {
            participant_id: ghostId,
            voice_token: await issueVoiceToken(ghostId, roomName, "ghost-user"),
          },
        }),
      );
      await expect(refused).resolves.toMatchObject({
        d: { code: 4008, message: "Voice channel join required" },
      });
      expect(await participantRowCount(roomName, ghostId)).toBe(0);
    });

    it("forgets the participant on the server socket once it disconnects", async () => {
      const roomName = crypto.randomUUID();
      const participantId = crypto.randomUUID();
      const socket = await openVoiceSocket(roomName);
      await identifyVoiceSocket(socket, participantId, roomName);
      const room = env.VOICE_ROOM.get(env.VOICE_ROOM.idFromName(roomName));
      const attachedParticipants = () =>
        runInDurableObject(room, (_instance, state) =>
          state
            .getWebSockets()
            .map(
              (ws) =>
                (
                  ws.deserializeAttachment() as {
                    participant_id?: string;
                  } | null
                )?.participant_id,
            )
            .filter((id): id is string => id !== undefined),
        );
      expect(await attachedParticipants()).toEqual([participantId]);

      const closed = closeOf(socket);
      socket.send(JSON.stringify({ op: 11, d: null }));
      await closed;

      await vi.waitFor(async () => {
        expect(await participantRowCount(roomName, participantId)).toBe(0);
        expect(await attachedParticipants()).toEqual([]);
      });
    });
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
    const disconnectResponse = await room.fetch(
      "https://internal/disconnect-participant",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participant_id: participantId,
          user_id: TEST_SUBJECT,
        }),
      },
    );

    expect(disconnectResponse.status).toBe(200);
    await expect(disconnectResponse.json()).resolves.toEqual({
      disconnected: true,
    });
  });

  it("only disconnects a participant for the user who owns it", async () => {
    const roomName = crypto.randomUUID();
    const participantId = crypto.randomUUID();
    const socket = await openVoiceSocket(roomName, "owner-user");
    await identifyVoiceSocket(socket, participantId, roomName, "owner-user");

    const room = env.VOICE_ROOM.get(env.VOICE_ROOM.idFromName(roomName));
    const participantRows = () =>
      runInDurableObject(
        room,
        (_instance, state) =>
          [
            ...state.storage.sql.exec(
              "SELECT id FROM participants WHERE id = ?",
              participantId,
            ),
          ].length,
      );
    const disconnect = (body: Record<string, unknown>) =>
      room.fetch("https://internal/disconnect-participant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

    const missingUser = await disconnect({ participant_id: participantId });
    expect(missingUser.status).toBe(400);
    await missingUser.body?.cancel();

    const otherUser = await disconnect({
      participant_id: participantId,
      user_id: "other-user",
    });
    expect(otherUser.status).toBe(200);
    await expect(otherUser.json()).resolves.toEqual({ disconnected: false });
    expect(await participantRows()).toBe(1);
    expect(socket.readyState).toBe(WebSocket.OPEN);

    const owner = await disconnect({
      participant_id: participantId,
      user_id: "owner-user",
    });
    await expect(owner.json()).resolves.toEqual({ disconnected: true });
    await vi.waitFor(async () => {
      expect(await participantRows()).toBe(0);
    });
  });

  it("clears persisted speaking state when a publisher disconnects", async () => {
    const roomName = crypto.randomUUID();
    const publisherId = crypto.randomUUID();
    const publisher = await openVoiceSocket(roomName, "publisher-user");
    await identifyVoiceSocket(
      publisher,
      publisherId,
      roomName,
      "publisher-user",
    );

    const observer = await openVoiceSocket(roomName, "observer-user");
    await identifyVoiceSocket(
      observer,
      crypto.randomUUID(),
      roomName,
      "observer-user",
    );

    publisher.send(
      JSON.stringify({
        op: 5,
        d: { speaking: 1 },
      }),
    );
    await expect(nextMessageWithOpcode(observer, 5)).resolves.toMatchObject({
      d: { participant_id: publisherId, speaking: 1 },
    });

    publisher.close();
    // At once, though the participant is held through a possible reconnect.
    await expect(nextMessageWithOpcode(observer, 5)).resolves.toMatchObject({
      d: { participant_id: publisherId, speaking: 0 },
    });

    const room = env.VOICE_ROOM.get(env.VOICE_ROOM.idFromName(roomName));
    const speakingRow = () =>
      runInDurableObject(
        room,
        (_instance, state) =>
          [
            ...state.storage.sql.exec(
              "SELECT speaking FROM participants WHERE id = ?",
              publisherId,
            ),
          ][0],
      );
    expect(await speakingRow()).toMatchObject({ speaking: 0 });

    await expireReconnectHolds(roomName);
    expect(await speakingRow()).toBeUndefined();

    observer.close();
  });

  it("ignores stale authenticated state and broadcast opcodes after reconnect", async () => {
    const roomName = crypto.randomUUID();
    const participantId = crypto.randomUUID();
    const trackName = `cam-audio-${participantId}`;
    const capability = await issuePartyTracksSessionCapability(
      participantId,
      roomName,
      "current-partytracks-session",
    );
    const oldSocket = await openVoiceSocket(roomName);
    await identifyVoiceSocket(oldSocket, participantId, roomName);
    const currentSocket = await openVoiceSocket(roomName);
    await identifyVoiceSocket(currentSocket, participantId, roomName);
    const observer = await openVoiceSocket(roomName, "observer-user");
    await identifyVoiceSocket(
      observer,
      crypto.randomUUID(),
      roomName,
      "observer-user",
    );

    const publication = nextMessageWithOpcode(observer, 12);
    currentSocket.send(
      JSON.stringify({
        op: 12,
        d: {
          tracks: [
            {
              participant_id: participantId,
              track_name: trackName,
              sfu_track_name: "current-opaque-track",
              session_id: capability,
              kind: "audio",
            },
          ],
        },
      }),
    );
    await expect(publication).resolves.toMatchObject({
      op: 12,
      d: { tracks: [{ track_name: trackName }] },
    });

    const staleHeartbeat = hasMessageWithOpcode(oldSocket, 6, 150);
    oldSocket.send(JSON.stringify({ op: 3, d: {} }));
    await expect(staleHeartbeat).resolves.toBe(false);

    oldSocket.send(JSON.stringify({ op: 13, d: { track_names: [trackName] } }));
    oldSocket.send(
      JSON.stringify({
        op: 106,
        d: {
          type: "reaction.sticker",
          url: "https://media.tenor.com/stale.gif",
          contentType: "image/gif",
          displayMode: "single",
        },
      }),
    );

    await expect(hasMessageWithOpcode(observer, 13, 150)).resolves.toBe(false);
    await expect(hasMessageWithOpcode(observer, 106, 150)).resolves.toBe(false);
    const room = env.VOICE_ROOM.get(env.VOICE_ROOM.idFromName(roomName));
    await runInDurableObject(room, (_instance, state) => {
      const track = [
        ...state.storage.sql.exec(
          "SELECT session_id, sfu_track_name, native_screen_pending FROM tracks WHERE track_name = ?",
          trackName,
        ),
      ][0];
      expect(track).toMatchObject({
        session_id: capability,
        sfu_track_name: "current-opaque-track",
        native_screen_pending: 0,
      });
    });

    oldSocket.close();
    currentSocket.close();
    observer.close();
  });

  it("resolves a radio station UUID and ignores a forged client stream URL", async () => {
    const roomName = crypto.randomUUID();
    await mockRadioBrowserStation(roomName, {
      stationuuid: RADIO_STATION_UUID,
      name: "Resolved Radio Station",
      url_resolved: "https://stream.example.com/radio",
      homepage: "https://station.example.com",
      favicon: "https://station.example.com/artwork.png",
    });
    const participantId = crypto.randomUUID();
    const socket = await openVoiceSocket(roomName);
    await identifyVoiceSocket(socket, participantId, roomName);

    const listener = await openVoiceSocket(roomName);
    await identifyVoiceSocket(listener, crypto.randomUUID(), roomName);

    socket.send(
      JSON.stringify({
        op: 106,
        d: {
          type: "listen_together.enqueue",
          room_slug: roomName,
          mode: "append",
          entries: [
            {
              track: {
                kind: "radio",
                station_uuid: RADIO_STATION_UUID,
                provider: "radio",
                title: "Client supplied title",
                artwork_url: "https://attacker.example.com/artwork.png",
                stream_url: "https://attacker.example.com/stream.mp3",
              },
              requester: {
                userId: "spoofed-user-id",
                displayName: "Test User",
              },
            },
          ],
        },
      }),
    );

    const response = await nextMessageWithOpcodeAndType(
      listener,
      106,
      "listen_together.snapshot",
    );
    expect(response.d).toMatchObject({
      type: "listen_together.snapshot",
      room_slug: roomName,
      snapshot: {
        queue: [
          {
            track: {
              kind: "radio",
              id: RADIO_STATION_UUID,
              provider: "radio",
              title: "Resolved Radio Station",
              streamUrl: "https://stream.example.com/radio",
              artworkUrl: "https://station.example.com/artwork.png",
              canonicalUrl: "https://station.example.com/",
              sourceLabel: "Live Radio",
            },
            requester: {
              userId: TEST_SUBJECT,
              displayName: "Test User",
            },
          },
        ],
      },
    });

    socket.close();
    listener.close();
  });

  it("resolves at most five distinct radio stations per enqueue and caches duplicates", async () => {
    const roomName = crypto.randomUUID();
    const stationUuids = [
      "4f0b9a5c-1f0d-4d76-8d27-3b89b7cd1741",
      "4f0b9a5c-1f0d-4d76-8d27-3b89b7cd1742",
      "4f0b9a5c-1f0d-4d76-8d27-3b89b7cd1743",
      "4f0b9a5c-1f0d-4d76-8d27-3b89b7cd1744",
      "4f0b9a5c-1f0d-4d76-8d27-3b89b7cd1745",
      "4f0b9a5c-1f0d-4d76-8d27-3b89b7cd1746",
    ];
    const room = env.VOICE_ROOM.get(env.VOICE_ROOM.idFromName(roomName));
    let fetchCount = 0;
    await runInDurableObject(room, () => {
      globalThis.fetch = async (input) => {
        const requestUrl = String(input);
        if (requestUrl.includes("/json/stations/byuuid/")) fetchCount += 1;
        const stationuuid = requestUrl.split("/").at(-1) ?? "";
        return new Response(
          JSON.stringify([
            {
              stationuuid,
              name: `Station ${stationuuid}`,
              url_resolved: "https://stream.example.com/live.mp3",
            },
          ]),
          { headers: { "Content-Type": "application/json" } },
        );
      };
    });
    const socket = await openVoiceSocket(roomName);
    await identifyVoiceSocket(socket, crypto.randomUUID(), roomName);
    const entries = [...stationUuids, stationUuids[0]!].map((stationUuid) => ({
      track: { kind: "radio", provider: "radio", station_uuid: stationUuid },
    }));

    socket.send(
      JSON.stringify({
        op: 106,
        d: { type: "listen_together.enqueue", room_slug: roomName, entries },
      }),
    );
    const response = await nextMessageWithOpcodeAndType(
      socket,
      106,
      "listen_together.snapshot",
    );

    expect(fetchCount).toBe(5);
    expect(
      (response.d as { snapshot: { queue: unknown[] } }).snapshot.queue,
    ).toHaveLength(5);
    socket.close();
  });

  it("serializes a delayed radio enqueue before a later clear", async () => {
    const roomName = crypto.randomUUID();
    const room = env.VOICE_ROOM.get(env.VOICE_ROOM.idFromName(roomName));
    await runInDurableObject(room, () => {
      globalThis.fetch = async (input) => {
        if (!String(input).includes("/json/stations/byuuid/")) {
          return new Response(null, { status: 404 });
        }
        await new Promise((release) => setTimeout(release, 50));
        return new Response(
          JSON.stringify([
            {
              stationuuid: RADIO_STATION_UUID,
              name: "Delayed Radio Station",
              url_resolved: "https://stream.example.com/delayed",
            },
          ]),
          { headers: { "Content-Type": "application/json" } },
        );
      };
    });
    const socket = await openVoiceSocket(roomName);
    await identifyVoiceSocket(socket, crypto.randomUUID(), roomName);
    const snapshots: unknown[] = [];
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data) as {
        op: number;
        d: { type?: string };
      };
      if (message.op === 106 && message.d.type === "listen_together.snapshot") {
        snapshots.push(message.d);
      }
    });

    socket.send(
      JSON.stringify({
        op: 106,
        d: {
          type: "listen_together.enqueue",
          room_slug: roomName,
          entries: [
            {
              track: {
                kind: "radio",
                provider: "radio",
                station_uuid: RADIO_STATION_UUID,
              },
            },
          ],
        },
      }),
    );
    socket.send(
      JSON.stringify({
        op: 106,
        d: { type: "listen_together.clear", room_slug: roomName },
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    const finalSnapshot = snapshots.at(-1) as
      | { snapshot: { queue: unknown[] } }
      | undefined;
    expect(finalSnapshot?.snapshot.queue).toEqual([]);
    socket.close();
  });

  it("serves state requests while a radio mutation is stalled", async () => {
    const roomName = crypto.randomUUID();
    const room = env.VOICE_ROOM.get(env.VOICE_ROOM.idFromName(roomName));
    let resolutionStarted = false;

    await runInDurableObject(room, () => {
      globalThis.fetch = async (input) => {
        if (!String(input).includes("/json/stations/byuuid/")) {
          return new Response(null, { status: 404 });
        }
        resolutionStarted = true;
        await new Promise((resolve) => setTimeout(resolve, 500));
        return new Response(
          JSON.stringify([
            {
              stationuuid: RADIO_STATION_UUID,
              name: "Stalled Radio Station",
              url_resolved: "https://stream.example.com/stalled",
            },
          ]),
          { headers: { "Content-Type": "application/json" } },
        );
      };
    });

    const socket = await openVoiceSocket(roomName);
    await identifyVoiceSocket(socket, crypto.randomUUID(), roomName);
    socket.send(
      JSON.stringify({
        op: 106,
        d: {
          type: "listen_together.enqueue",
          room_slug: roomName,
          entries: [
            {
              track: {
                kind: "radio",
                provider: "radio",
                station_uuid: RADIO_STATION_UUID,
              },
            },
          ],
        },
      }),
    );
    for (let attempt = 0; attempt < 20 && !resolutionStarted; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(resolutionStarted).toBe(true);

    const stateRequest = nextMessageWithOpcodeAndType(
      socket,
      106,
      "listen_together.snapshot",
    );
    socket.send(
      JSON.stringify({
        op: 106,
        d: { type: "listen_together.state.request", room_slug: roomName },
      }),
    );

    await expect(
      Promise.race([
        stateRequest,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("state request timed out")), 100),
        ),
      ]),
    ).resolves.toMatchObject({
      d: {
        type: "listen_together.snapshot",
        snapshot: { revision: 0, queue: [] },
      },
    });

    const mutationSnapshot = nextMessageWithOpcodeAndType(
      socket,
      106,
      "listen_together.snapshot",
    );
    await expect(mutationSnapshot).resolves.toMatchObject({
      d: {
        type: "listen_together.snapshot",
        snapshot: {
          revision: 1,
          queue: [{ track: { title: "Stalled Radio Station" } }],
        },
      },
    });
    socket.close();
  });

  it("schedules an alarm after queueing a finite music track", async () => {
    const roomName = crypto.randomUUID();
    const socket = await openVoiceSocket(roomName);
    await identifyVoiceSocket(socket, crypto.randomUUID(), roomName);
    socket.send(
      JSON.stringify({
        op: 106,
        d: {
          type: "listen_together.enqueue",
          room_slug: roomName,
          entries: [listenTogetherMusicEntry(1_000)],
        },
      }),
    );
    await nextMessageWithOpcodeAndType(socket, 106, "listen_together.snapshot");

    const room = env.VOICE_ROOM.get(env.VOICE_ROOM.idFromName(roomName));
    await runInDurableObject(room, async (_instance, state) => {
      expect(await state.storage.getAlarm()).toBeLessThanOrEqual(
        Date.now() + 1_500,
      );
    });
    socket.close();
  });

  it("advances to the next queued track when the current track deadline passes", async () => {
    const roomName = crypto.randomUUID();
    const socket = await openVoiceSocket(roomName);
    await identifyVoiceSocket(socket, crypto.randomUUID(), roomName);
    socket.send(
      JSON.stringify({
        op: 106,
        d: {
          type: "listen_together.enqueue",
          room_slug: roomName,
          entries: [
            listenTogetherMusicEntry(10_000),
            {
              ...listenTogetherMusicEntry(10_000),
              track: {
                ...listenTogetherMusicEntry(10_000).track,
                id: "music-2",
                videoId: "dQw4w9WgXcQ-2",
                title: "Second Track",
              },
            },
          ],
        },
      }),
    );
    await nextMessageWithOpcodeAndType(socket, 106, "listen_together.snapshot");

    const room = env.VOICE_ROOM.get(env.VOICE_ROOM.idFromName(roomName));
    await runInDurableObject(room, (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE listen_together_state SET anchor_updated_at = ? WHERE id = 1",
        Date.now() - 20_000,
      );
    });
    const nextSnapshot = nextMessageWithOpcodeAndType(
      socket,
      106,
      "listen_together.snapshot",
    );
    expect(await runDurableObjectAlarm(room)).toBe(true);

    await expect(nextSnapshot).resolves.toMatchObject({
      d: {
        snapshot: {
          paused: false,
          currentEntry: { track: { title: "Second Track" } },
        },
      },
    });
    socket.close();
  });

  it("ignores playback commands scoped to an entry that already ended", async () => {
    const roomName = crypto.randomUUID();
    const socket = await openVoiceSocket(roomName);
    await identifyVoiceSocket(socket, crypto.randomUUID(), roomName);
    const first = listenTogetherMusicEntry(10_000);
    const second = {
      ...listenTogetherMusicEntry(10_000),
      track: {
        ...listenTogetherMusicEntry(10_000).track,
        id: "music-2",
        videoId: "dQw4w9WgXcQ-2",
        title: "Second Track",
      },
    };
    socket.send(
      JSON.stringify({
        op: 106,
        d: {
          type: "listen_together.enqueue",
          room_slug: roomName,
          entries: [first, second],
        },
      }),
    );
    const initial = await nextMessageWithOpcodeAndType(
      socket,
      106,
      "listen_together.snapshot",
    );
    const firstEntryId = (initial.d as { snapshot: { currentEntryId: string } })
      .snapshot.currentEntryId;

    socket.send(
      JSON.stringify({
        op: 106,
        d: {
          type: "listen_together.skip",
          room_slug: roomName,
          entryId: firstEntryId,
        },
      }),
    );
    const advanced = await nextMessageWithOpcodeAndType(
      socket,
      106,
      "listen_together.snapshot",
    );
    const secondEntryId = (
      advanced.d as { snapshot: { currentEntryId: string } }
    ).snapshot.currentEntryId;

    socket.send(
      JSON.stringify({
        op: 106,
        d: {
          type: "listen_together.pause",
          room_slug: roomName,
          paused: true,
          entryId: firstEntryId,
        },
      }),
    );
    socket.send(
      JSON.stringify({
        op: 106,
        d: {
          type: "listen_together.pause",
          room_slug: roomName,
          paused: true,
        },
      }),
    );
    socket.send(
      JSON.stringify({
        op: 106,
        d: {
          type: "listen_together.skip",
          room_slug: roomName,
          entryId: firstEntryId,
        },
      }),
    );
    socket.send(
      JSON.stringify({
        op: 106,
        d: { type: "listen_together.state.request", room_slug: roomName },
      }),
    );
    const finalSnapshot = await nextMessageWithOpcodeAndType(
      socket,
      106,
      "listen_together.snapshot",
    );

    expect(finalSnapshot.d).toMatchObject({
      snapshot: {
        currentEntryId: secondEntryId,
        paused: false,
        queue: [{ entryId: secondEntryId }],
      },
    });
    socket.close();
  });

  it("broadcasts one canonical snapshot per changed mutation and none for no-ops", async () => {
    const roomName = crypto.randomUUID();
    const socket = await openVoiceSocket(roomName);
    await identifyVoiceSocket(socket, crypto.randomUUID(), roomName);

    const sendCommand = (d: Record<string, unknown>) =>
      socket.send(JSON.stringify({ op: 106, d }));
    const collectCommand = (d: Record<string, unknown>) =>
      collectListenTogetherEvents(socket, () => sendCommand(d));

    // Long enough that playback cannot reach the end (and auto-advance on the
    // alarm) while the test runs, however slow the runner is.
    const trackDurationMs = 60 * 60 * 1000;
    const enqueued = await collectCommand({
      type: "listen_together.enqueue",
      room_slug: roomName,
      mode: "append",
      entries: [listenTogetherMusicEntry(trackDurationMs)],
    });
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toMatchObject({
      type: "listen_together.snapshot",
      snapshot: { revision: 1 },
    });
    const firstEntryId = enqueued[0]?.snapshot?.currentEntryId ?? "";
    expect(firstEntryId).not.toBe("");
    const paused = await collectCommand({
      type: "listen_together.pause",
      room_slug: roomName,
      paused: true,
      entryId: firstEntryId,
    });
    expect(paused).toHaveLength(1);
    expect(paused[0]).toMatchObject({
      type: "listen_together.snapshot",
      snapshot: { revision: 2, paused: true, currentEntryId: firstEntryId },
    });

    const sought = await collectCommand({
      type: "listen_together.seek",
      room_slug: roomName,
      positionMs: 250,
      entryId: firstEntryId,
    });
    expect(sought).toHaveLength(1);
    expect(sought[0]).toMatchObject({
      type: "listen_together.snapshot",
      snapshot: { revision: 3, positionMs: 250 },
    });

    const appended = await collectCommand({
      type: "listen_together.enqueue",
      room_slug: roomName,
      mode: "append",
      entries: [
        {
          ...listenTogetherMusicEntry(trackDurationMs),
          track: {
            ...listenTogetherMusicEntry(trackDurationMs).track,
            id: "music-2",
            videoId: "dQw4w9WgXcQ-2",
            title: "Second Track",
          },
        },
      ],
    });
    expect(appended).toHaveLength(1);
    expect(appended[0]).toMatchObject({
      type: "listen_together.snapshot",
      snapshot: { revision: 4 },
    });
    const secondEntryId = appended[0]?.snapshot?.queue?.[1]?.entryId;

    const skipped = await collectCommand({
      type: "listen_together.skip",
      room_slug: roomName,
      entryId: firstEntryId,
    });
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toMatchObject({
      type: "listen_together.snapshot",
      snapshot: { revision: 5, currentEntryId: secondEntryId },
    });

    const cleared = await collectCommand({
      type: "listen_together.clear",
      room_slug: roomName,
    });
    expect(cleared).toHaveLength(1);
    expect(cleared[0]).toMatchObject({
      type: "listen_together.snapshot",
      snapshot: { revision: 6, queue: [] },
    });

    const repeatedClear = await collectCommand({
      type: "listen_together.clear",
      room_slug: roomName,
    });
    expect(repeatedClear).toHaveLength(0);

    const stateAfterRepeatedClear = await collectCommand({
      type: "listen_together.state.request",
      room_slug: roomName,
    });
    expect(stateAfterRepeatedClear).toHaveLength(1);
    expect(stateAfterRepeatedClear[0]).toMatchObject({
      type: "listen_together.snapshot",
      snapshot: { revision: 6, queue: [] },
    });

    const noOp = await collectCommand({
      type: "listen_together.play",
      room_slug: roomName,
    });
    expect(noOp).toHaveLength(0);

    const stale = await collectCommand({
      type: "listen_together.skip",
      room_slug: roomName,
      entryId: firstEntryId,
    });
    expect(stale).toHaveLength(0);

    const stateRequest = await collectCommand({
      type: "listen_together.state.request",
      room_slug: roomName,
    });
    expect(stateRequest).toHaveLength(1);
    expect(stateRequest[0]).toMatchObject({
      type: "listen_together.snapshot",
      snapshot: { revision: 6, queue: [] },
    });

    socket.close();
  });

  it("selects Listen Together event envelopes per recipient capability", async () => {
    const roomName = crypto.randomUUID();
    const capable = await openVoiceSocket(roomName, "capable-user");
    await identifyVoiceSocket(
      capable,
      crypto.randomUUID(),
      roomName,
      "capable-user",
      true,
    );
    const legacy = await openVoiceSocket(roomName, "legacy-user");
    await identifyVoiceSocket(
      legacy,
      crypto.randomUUID(),
      roomName,
      "legacy-user",
      false,
    );

    const sendCommand = (d: Record<string, unknown>) =>
      capable.send(JSON.stringify({ op: 106, d }));
    const collectCommand = (d: Record<string, unknown>) =>
      collectListenTogetherEventsForSockets([capable, legacy], () =>
        sendCommand(d),
      );

    // Long enough that playback cannot end and auto-advance mid-test.
    const trackDurationMs = 60 * 60 * 1000;
    const enqueued = await collectCommand({
      type: "listen_together.enqueue",
      room_slug: roomName,
      mode: "append",
      entries: [listenTogetherMusicEntry(trackDurationMs)],
    });
    expect(enqueued[0]?.map((event) => event.type)).toEqual([
      "listen_together.snapshot",
    ]);
    expect(enqueued[1]?.map((event) => event.type)).toEqual([
      "listen_together.queue.updated",
      "listen_together.playback.updated",
    ]);
    expect(enqueued[0]?.[0]?.snapshot).toMatchObject({ revision: 1 });
    expect(enqueued[1]?.[0]?.snapshot).toEqual(enqueued[0]?.[0]?.snapshot);
    expect(enqueued[1]?.[1]?.snapshot).toEqual(enqueued[0]?.[0]?.snapshot);

    const currentEntryId = enqueued[0]?.[0]?.snapshot?.currentEntryId ?? "";
    const appended = await collectCommand({
      type: "listen_together.enqueue",
      room_slug: roomName,
      mode: "append",
      entries: [
        {
          ...listenTogetherMusicEntry(trackDurationMs),
          track: {
            ...listenTogetherMusicEntry(trackDurationMs).track,
            id: "music-2",
            videoId: "dQw4w9WgXcQ-2",
            title: "Second Track",
          },
        },
      ],
    });
    expect(appended[0]?.map((event) => event.type)).toEqual([
      "listen_together.snapshot",
    ]);
    expect(appended[1]?.map((event) => event.type)).toEqual([
      "listen_together.queue.updated",
    ]);
    expect(appended[0]?.[0]?.snapshot).toMatchObject({ revision: 2 });
    expect(appended[1]?.[0]?.snapshot).toEqual(appended[0]?.[0]?.snapshot);

    const paused = await collectCommand({
      type: "listen_together.pause",
      room_slug: roomName,
      paused: true,
      entryId: currentEntryId,
    });
    expect(paused[0]?.map((event) => event.type)).toEqual([
      "listen_together.snapshot",
    ]);
    expect(paused[1]?.map((event) => event.type)).toEqual([
      "listen_together.playback.updated",
    ]);
    expect(paused[0]?.[0]?.snapshot).toMatchObject({
      revision: 3,
      paused: true,
    });
    expect(paused[1]?.[0]?.snapshot).toEqual(paused[0]?.[0]?.snapshot);

    capable.close();
    legacy.close();
  });

  it("persists recently played across clear and reconnect snapshots", async () => {
    const roomName = crypto.randomUUID();
    const socket = await openVoiceSocket(roomName);
    await identifyVoiceSocket(socket, crypto.randomUUID(), roomName);

    socket.send(
      JSON.stringify({
        op: 106,
        d: {
          type: "listen_together.enqueue",
          room_slug: roomName,
          mode: "append",
          entries: [listenTogetherMusicEntry()],
        },
      }),
    );
    await nextMessageWithOpcodeAndType(socket, 106, "listen_together.snapshot");

    socket.send(
      JSON.stringify({
        op: 106,
        d: {
          type: "listen_together.enqueue",
          room_slug: roomName,
          mode: "play-now",
          entries: [
            {
              track: {
                ...listenTogetherMusicEntry().track,
                id: "music-2",
                videoId: "dQw4w9WgXcQ-2",
                title: "Played Next",
              },
            },
          ],
        },
      }),
    );
    const playedSnapshot = await nextMessageWithOpcodeAndType(
      socket,
      106,
      "listen_together.snapshot",
    );
    expect(playedSnapshot.d).toMatchObject({
      snapshot: {
        currentEntry: { track: { title: "Played Next" } },
        recentlyPlayed: [
          { entry: { track: { title: "Played Next" } } },
          { entry: { track: { title: "Never Gonna Give You Up" } } },
        ],
      },
    });

    socket.send(
      JSON.stringify({
        op: 106,
        d: { type: "listen_together.clear", room_slug: roomName },
      }),
    );
    const clearedSnapshot = await nextMessageWithOpcodeAndType(
      socket,
      106,
      "listen_together.snapshot",
    );
    expect(clearedSnapshot.d).toMatchObject({
      snapshot: { queue: [], recentlyPlayed: expect.any(Array) },
    });
    socket.close();

    const reconnected = await openVoiceSocket(roomName);
    await identifyVoiceSocket(reconnected, crypto.randomUUID(), roomName);
    reconnected.send(
      JSON.stringify({
        op: 106,
        d: { type: "listen_together.state.request", room_slug: roomName },
      }),
    );
    const reconnectedSnapshot = await nextMessageWithOpcodeAndType(
      reconnected,
      106,
      "listen_together.snapshot",
    );
    expect(reconnectedSnapshot.d).toMatchObject({
      snapshot: {
        queue: [],
        recentlyPlayed: [
          { entry: { track: { title: "Played Next" } } },
          { entry: { track: { title: "Never Gonna Give You Up" } } },
        ],
      },
    });
    reconnected.close();
  });

  it("limits each user to ten radio station resolutions per minute", async () => {
    const roomName = crypto.randomUUID();
    const room = env.VOICE_ROOM.get(env.VOICE_ROOM.idFromName(roomName));
    let fetchCount = 0;
    await runInDurableObject(room, () => {
      globalThis.fetch = async (input) => {
        const requestUrl = String(input);
        if (requestUrl.includes("/json/stations/byuuid/")) fetchCount += 1;
        const stationuuid = requestUrl.split("/").at(-1) ?? "";
        return new Response(
          JSON.stringify([
            {
              stationuuid,
              name: `Station ${stationuuid}`,
              url_resolved: "https://stream.example.com/live.mp3",
            },
          ]),
          { headers: { "Content-Type": "application/json" } },
        );
      };
    });
    const socket = await openVoiceSocket(roomName);
    await identifyVoiceSocket(socket, crypto.randomUUID(), roomName);
    const stationUuids = Array.from(
      { length: 11 },
      (_, index) =>
        `4f0b9a5c-1f0d-4d76-8d27-3b89b7cd17${String(40 + index).padStart(2, "0")}`,
    );

    for (const stationUuid of stationUuids) {
      socket.send(
        JSON.stringify({
          op: 106,
          d: {
            type: "listen_together.enqueue",
            room_slug: roomName,
            entries: [
              {
                track: {
                  kind: "radio",
                  provider: "radio",
                  station_uuid: stationUuid,
                },
              },
            ],
          },
        }),
      );
    }

    for (let index = 0; index < 10; index += 1) {
      await nextMessageWithOpcodeAndType(
        socket,
        106,
        "listen_together.snapshot",
      );
    }
    expect(
      await nextMessageWithOpcodeAndType(socket, 106, "listen_together.error"),
    ).toMatchObject({
      d: { code: "EMPTY_QUEUE" },
    });
    expect(fetchCount).toBe(10);
    socket.close();
  });

  it("rejects a radio station resolved with a non-public stream URL", async () => {
    const roomName = crypto.randomUUID();
    await mockRadioBrowserStation(roomName, {
      stationuuid: RADIO_STATION_UUID,
      name: "Private Radio Station",
      url_resolved: "https://127.0.0.1/stream.mp3",
    });
    const participantId = crypto.randomUUID();
    const socket = await openVoiceSocket(roomName);
    await identifyVoiceSocket(socket, participantId, roomName);

    socket.send(
      JSON.stringify({
        op: 106,
        d: {
          type: "listen_together.enqueue",
          room_slug: roomName,
          mode: "append",
          entries: [
            {
              track: {
                kind: "radio",
                station_uuid: RADIO_STATION_UUID,
                provider: "radio",
                title: "Bad Radio Station",
              },
              requester: {
                userId: "test-user",
                displayName: "Test User",
              },
            },
          ],
        },
      }),
    );

    const response = await nextMessageWithOpcodeAndType(
      socket,
      106,
      "listen_together.error",
    );
    expect(response.d).toMatchObject({
      type: "listen_together.error",
      code: "EMPTY_QUEUE",
      message: "Nothing valid to queue",
    });

    socket.close();
  });

  it("rejects a radio entry that declares a music provider", async () => {
    const roomName = crypto.randomUUID();
    const participantId = crypto.randomUUID();
    const socket = await openVoiceSocket(roomName);
    await identifyVoiceSocket(socket, participantId, roomName);

    socket.send(
      JSON.stringify({
        op: 106,
        d: {
          type: "listen_together.enqueue",
          room_slug: roomName,
          mode: "append",
          entries: [
            {
              track: {
                kind: "radio",
                station_uuid: RADIO_STATION_UUID,
                provider: "youtube",
                title: "Invalid Radio Provider",
              },
              requester: {
                userId: "test-user",
                displayName: "Test User",
              },
            },
          ],
        },
      }),
    );

    const response = await nextMessageWithOpcodeAndType(
      socket,
      106,
      "listen_together.error",
    );
    expect(response.d).toMatchObject({
      type: "listen_together.error",
      code: "EMPTY_QUEUE",
      message: "Nothing valid to queue",
    });

    socket.close();
  });

  it("overwrites spoofed requester userId with authenticated caller", async () => {
    const roomName = crypto.randomUUID();
    const participantId = crypto.randomUUID();
    const socket = await openVoiceSocket(roomName);
    await identifyVoiceSocket(socket, participantId, roomName);

    socket.send(
      JSON.stringify({
        op: 106,
        d: {
          type: "listen_together.enqueue",
          room_slug: roomName,
          mode: "append",
          entries: [
            {
              track: {
                kind: "music",
                id: "music-1",
                provider: "youtube",
                videoId: "dQw4w9WgXcQ",
                title: "Never Gonna Give You Up",
                durationMs: 213000,
                canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
                sourceLabel: "YouTube",
              },
              requester: {
                userId: "malicious-spoofed-id",
                displayName: "Test User",
              },
            },
          ],
        },
      }),
    );

    const response = await nextMessageWithOpcodeAndType(
      socket,
      106,
      "listen_together.snapshot",
    );
    expect(response.d).toMatchObject({
      type: "listen_together.snapshot",
      snapshot: {
        queue: [
          {
            requester: {
              userId: TEST_SUBJECT,
              displayName: "Test User",
            },
          },
        ],
      },
    });

    socket.close();
  });

  it("allows an approved external soundboard media URL", async () => {
    const roomName = crypto.randomUUID();
    const participantId = crypto.randomUUID();
    const socket = await openVoiceSocket(roomName);
    await identifyVoiceSocket(socket, participantId, roomName);
    const listener = await openVoiceSocket(roomName);
    await identifyVoiceSocket(listener, crypto.randomUUID(), roomName);
    const mediaUrl = "https://www.myinstants.com/media/sounds/airhorn.mp3";

    socket.send(
      JSON.stringify({
        op: 106,
        d: {
          type: "soundboard.play",
          user_id: "forged-owner",
          participant_id: "forged-participant",
          server_key: "server-1",
          playback_id: createSoundboardPlaybackId(TEST_SUBJECT, "sound-1"),
          sound_id: "sound-1",
          name: "Airhorn",
          media_url: mediaUrl,
          volume: 4,
          unexpected: "must not be broadcast",
        },
      }),
    );

    const response = await nextMessageWithOpcodeAndType(
      listener,
      106,
      "soundboard.play",
    );
    expect(response.d).toEqual({
      type: "soundboard.play",
      user_id: TEST_SUBJECT,
      participant_id: participantId,
      server_key: "server-1",
      playback_id: createSoundboardPlaybackId(TEST_SUBJECT, "sound-1"),
      sound_id: "sound-1",
      name: "Airhorn",
      media_url: mediaUrl,
      volume: 1,
      sent_at: expect.any(Number),
    });

    socket.close();
    listener.close();
  });

  it("uses an approved external media URL as the canonical soundboard source", async () => {
    const roomName = crypto.randomUUID();
    const participantId = crypto.randomUUID();
    const socket = await openVoiceSocket(roomName);
    await identifyVoiceSocket(socket, participantId, roomName);
    const listener = await openVoiceSocket(roomName);
    await identifyVoiceSocket(listener, crypto.randomUUID(), roomName);
    const mediaUrl = "https://www.myinstants.com/media/sounds/airhorn.mp3";

    socket.send(
      JSON.stringify({
        op: 106,
        d: {
          type: "soundboard.play",
          server_key: "server-1",
          playback_id: createSoundboardPlaybackId(TEST_SUBJECT, "canonical"),
          sound_id: "sound-1",
          name: "Airhorn",
          data_url: audioDataUrlForDecodedBytes(1),
          media_url: mediaUrl,
        },
      }),
    );

    const response = await nextMessageWithOpcodeAndType(
      listener,
      106,
      "soundboard.play",
    );
    expect(response.d).toEqual({
      type: "soundboard.play",
      participant_id: participantId,
      user_id: TEST_SUBJECT,
      server_key: "server-1",
      playback_id: createSoundboardPlaybackId(TEST_SUBJECT, "canonical"),
      sound_id: "sound-1",
      name: "Airhorn",
      media_url: mediaUrl,
      volume: 1,
      sent_at: expect.any(Number),
    });

    socket.close();
    listener.close();
  });

  it("keeps a valid external media URL when the legacy data URL is invalid", async () => {
    const roomName = crypto.randomUUID();
    const participantId = crypto.randomUUID();
    const socket = await openVoiceSocket(roomName);
    await identifyVoiceSocket(socket, participantId, roomName);
    const listener = await openVoiceSocket(roomName);
    await identifyVoiceSocket(listener, crypto.randomUUID(), roomName);
    const mediaUrl = "https://www.myinstants.com/media/sounds/airhorn.mp3";

    socket.send(
      JSON.stringify({
        op: 106,
        d: {
          type: "soundboard.play",
          server_key: "server-1",
          playback_id: createSoundboardPlaybackId(
            TEST_SUBJECT,
            "invalid-legacy",
          ),
          sound_id: "sound-1",
          name: "Airhorn",
          data_url: "data:audio/wav;base64,AAA==",
          media_url: mediaUrl,
        },
      }),
    );

    const response = await nextMessageWithOpcodeAndType(
      listener,
      106,
      "soundboard.play",
    );
    expect(response.d).toEqual({
      type: "soundboard.play",
      participant_id: participantId,
      user_id: TEST_SUBJECT,
      server_key: "server-1",
      playback_id: createSoundboardPlaybackId(TEST_SUBJECT, "invalid-legacy"),
      sound_id: "sound-1",
      name: "Airhorn",
      media_url: mediaUrl,
      volume: 1,
      sent_at: expect.any(Number),
    });

    socket.close();
    listener.close();
  });

  it("rejects an arbitrary HTTPS soundboard media URL", async () => {
    const roomName = crypto.randomUUID();
    const socket = await openVoiceSocket(roomName);
    await identifyVoiceSocket(socket, crypto.randomUUID(), roomName);
    const response = nextMessageWithOpcode(socket, 18);
    socket.send(
      JSON.stringify({
        op: 106,
        d: {
          type: "soundboard.play",
          server_key: "server-1",
          playback_id: createSoundboardPlaybackId(TEST_SUBJECT, "tracking"),
          name: "Tracking",
          media_url: "https://tracking.example.com/pixel.mp3",
        },
      }),
    );
    expect(await response).toMatchObject({
      op: 18,
      d: { code: 4000, message: "Soundboard event was rejected" },
    });
    socket.close();
  });

  it.each([
    "https://www.myinstants.com/media/sounds/airhorn.mp3?token=secret",
    "https://www.myinstants.com/media/sounds/airhorn.mp3#access_token=secret",
    "/api/soundboard/uploads/sound-1?token=secret",
    "/api/soundboard/uploads/sound-1?download=1",
    "/api/soundboard/uploads/sound-1#fragment",
    "https://www.myinstants.com/media/sounds/airhorn.mp3?download=1",
    "https://www.myinstants.com/media/sounds/airhorn.mp3#clip",
  ])(
    "rejects credential-bearing soundboard URL metadata: %s",
    async (mediaUrl) => {
      const roomName = crypto.randomUUID();
      const socket = await openVoiceSocket(roomName);
      await identifyVoiceSocket(socket, crypto.randomUUID(), roomName);
      const response = nextMessageWithOpcodeOrNull(socket, 18, 5_000);
      const broadcast = nextMessageWithOpcodeAndTypeOrNull(
        socket,
        106,
        "soundboard.play",
      );

      socket.send(
        JSON.stringify({
          op: 106,
          d: {
            type: "soundboard.play",
            server_key: "server-1",
            playback_id: createSoundboardPlaybackId(
              TEST_SUBJECT,
              "credential-url",
            ),
            name: "Airhorn",
            media_url: mediaUrl,
          },
        }),
      );

      expect(await response).toMatchObject({
        op: 18,
        d: { code: 4000, message: "Soundboard event was rejected" },
      });
      expect(await broadcast).toBeNull();
      socket.close();
    },
  );

  it.each([
    ["malformed base64", "data:audio/wav;base64,A"],
    ["invalid padding", "data:audio/wav;base64,AAA=="],
    ["padding in the middle", "data:audio/wav;base64,AA=A"],
    ["noncanonical padding bits", "data:audio/wav;base64,AB=="],
  ])("rejects %s soundboard data URLs", async (_label, dataUrl) => {
    const roomName = crypto.randomUUID();
    const socket = await openVoiceSocket(roomName);
    await identifyVoiceSocket(socket, crypto.randomUUID(), roomName);
    const response = nextMessageWithOpcodeOrNull(socket, 18, 5_000);
    const broadcast = nextMessageWithOpcodeAndTypeOrNull(
      socket,
      106,
      "soundboard.play",
    );

    socket.send(
      JSON.stringify({
        op: 106,
        d: {
          type: "soundboard.play",
          server_key: "server-1",
          playback_id: createSoundboardPlaybackId(
            TEST_SUBJECT,
            "invalid-data-url",
          ),
          sound_id: "sound-1",
          name: "Custom",
          data_url: dataUrl,
        },
      }),
    );

    expect(await response).toMatchObject({
      op: 18,
      d: { code: 4000, message: "Soundboard event was rejected" },
    });
    expect(await broadcast).toBeNull();
    socket.close();
  });

  it.each([
    "/api/attachments/clip.mp3",
    "/api/soundboard/../clip.mp3",
    "/api/soundboard/uploads/../clip.mp3",
    "/api/soundboard/uploads/%2e%2e/clip.mp3",
    "/api/soundboard/uploads/%252e%252e/clip.mp3",
    "/api/soundboard/uploads/%2f..%2fclip.mp3",
  ])("rejects unsafe local soundboard media URL: %s", async (mediaUrl) => {
    const roomName = crypto.randomUUID();
    const socket = await openVoiceSocket(roomName);
    await identifyVoiceSocket(socket, crypto.randomUUID(), roomName);
    const response = nextMessageWithOpcodeOrNull(socket, 18, 5_000);
    const broadcast = nextMessageWithOpcodeAndTypeOrNull(
      socket,
      106,
      "soundboard.play",
    );

    socket.send(
      JSON.stringify({
        op: 106,
        d: {
          type: "soundboard.play",
          server_key: "server-1",
          playback_id: createSoundboardPlaybackId(TEST_SUBJECT, "unsafe-media"),
          name: "Custom",
          media_url: mediaUrl,
        },
      }),
    );

    expect(await response).toMatchObject({
      op: 18,
      d: { code: 4000, message: "Soundboard event was rejected" },
    });
    expect(await broadcast).toBeNull();
    socket.close();
  });

  it("rejects a local soundboard media URL that is not bound to a catalog row", async () => {
    const roomName = crypto.randomUUID();
    const socket = await openVoiceSocket(roomName);
    await identifyVoiceSocket(socket, crypto.randomUUID(), roomName);
    const response = nextMessageWithOpcodeOrNull(socket, 18, 5_000);
    const broadcast = nextMessageWithOpcodeAndTypeOrNull(
      socket,
      106,
      "soundboard.play",
    );

    socket.send(
      JSON.stringify({
        op: 106,
        d: {
          type: "soundboard.play",
          server_key: "server-1",
          playback_id: createSoundboardPlaybackId(
            TEST_SUBJECT,
            "catalog-media",
          ),
          sound_id: "sound-1",
          name: "Airhorn",
          media_url: "/api/soundboard/uploads/sound-1",
        },
      }),
    );

    expect(await response).toMatchObject({
      op: 18,
      d: { code: 4000, message: "Soundboard event was rejected" },
    });
    expect(await broadcast).toBeNull();
    socket.close();
  });

  it("allows a local soundboard media URL only when the catalog row matches the admitted server", async () => {
    const roomName = crypto.randomUUID();
    const participantId = crypto.randomUUID();
    const socket = await openVoiceSocket(roomName);
    await identifyVoiceSocket(socket, participantId, roomName);
    const listener = await openVoiceSocket(roomName);
    await identifyVoiceSocket(listener, crypto.randomUUID(), roomName);
    await seedSoundboardCatalogEntry("server-1", "sound-1");

    socket.send(
      JSON.stringify({
        op: 106,
        d: {
          type: "soundboard.play",
          server_key: "server-1",
          playback_id: createSoundboardPlaybackId(
            TEST_SUBJECT,
            "catalog-media",
          ),
          sound_id: "sound-1",
          name: "Airhorn",
          media_url: "/api/soundboard/uploads/sound-1",
        },
      }),
    );

    const response = await nextMessageWithOpcodeAndType(
      listener,
      106,
      "soundboard.play",
    );
    expect(response.d).toMatchObject({
      media_url: "/api/soundboard/uploads/sound-1",
      sound_id: "sound-1",
      server_key: "server-1",
    });

    socket.close();
    listener.close();
  });

  it("closes an already-connected server voice socket after membership is revoked", async () => {
    const roomName = crypto.randomUUID();
    await seedSoundboardMembership("server-1", TEST_SUBJECT);
    const socket = await openVoiceSocket(roomName);
    await identifyVoiceSocket(socket, crypto.randomUUID(), roomName);
    await env.DB.prepare(
      "DELETE FROM server_members WHERE server_id = ? AND user_id = ?",
    )
      .bind("server-1", TEST_SUBJECT)
      .run();

    const response = nextMessageWithOpcode(socket, 18);
    const closed = new Promise<void>((resolve) => {
      socket.addEventListener("close", () => resolve(), { once: true });
    });
    socket.send(
      JSON.stringify({
        op: 106,
        d: {
          type: "soundboard.play",
          server_key: "server-1",
          playback_id: createSoundboardPlaybackId(TEST_SUBJECT, "ping"),
          sound_id: "ping",
          name: "Ping",
        },
      }),
    );

    await expect(response).resolves.toMatchObject({
      op: 18,
      d: { message: "Server membership is required for soundboard actions" },
    });
    await expect(closed).resolves.toBeUndefined();
  });

  it("rejects soundboard commands whose playback ID is not owned by the caller", async () => {
    const roomName = crypto.randomUUID();
    const socket = await openVoiceSocket(roomName);
    await identifyVoiceSocket(socket, crypto.randomUUID(), roomName);

    const response = nextMessageWithOpcode(socket, 18);
    socket.send(
      JSON.stringify({
        op: 106,
        d: {
          type: "soundboard.play",
          server_key: "server-1",
          playback_id: createSoundboardPlaybackId("another-user", "airhorn"),
          sound_id: "airhorn",
          name: "Airhorn",
          media_url: "https://cdn.example.com/airhorn.mp3",
        },
      }),
    );

    expect(await response).toMatchObject({
      op: 18,
      d: { code: 4000, message: "Soundboard event was rejected" },
    });
    socket.close();
  });

  it.each([
    {
      type: "soundboard.stop",
      playback_id: createSoundboardPlaybackId(TEST_SUBJECT, "control"),
    },
    {
      type: "soundboard.pause-set",
      playback_id: createSoundboardPlaybackId(TEST_SUBJECT, "control"),
      paused: true,
    },
    {
      type: "soundboard.volume-set",
      playback_id: createSoundboardPlaybackId(TEST_SUBJECT, "control"),
      volume: 0.25,
    },
  ])("accepts an own %s control", async (event) => {
    const roomName = crypto.randomUUID();
    const participantId = crypto.randomUUID();
    const socket = await openVoiceSocket(roomName);
    await identifyVoiceSocket(socket, participantId, roomName);
    const listener = await openVoiceSocket(roomName);
    await identifyVoiceSocket(listener, crypto.randomUUID(), roomName);

    socket.send(
      JSON.stringify({
        op: 106,
        d: { server_key: "server-1", ...event },
      }),
    );

    const response = await nextMessageWithOpcodeAndType(
      listener,
      106,
      event.type,
    );
    expect(response.d).toMatchObject({
      ...event,
      participant_id: participantId,
      user_id: TEST_SUBJECT,
      server_key: "server-1",
    });

    socket.close();
    listener.close();
  });

  it("rejects a control naming the caller in the retired s-<owner>-<sound> form", async () => {
    const roomName = crypto.randomUUID();
    const listener = await openVoiceSocket(roomName, "user-other");
    await identifyVoiceSocket(
      listener,
      crypto.randomUUID(),
      roomName,
      "user-other",
    );
    const caller = await openVoiceSocket(roomName, "user");
    await identifyVoiceSocket(caller, crypto.randomUUID(), roomName, "user");
    const response = nextMessageWithOpcode(caller, 18);
    const broadcast = nextMessageWithOpcodeAndTypeOrNull(
      listener,
      106,
      "soundboard.stop",
    );

    caller.send(
      JSON.stringify({
        op: 106,
        d: {
          type: "soundboard.stop",
          server_key: "server-1",
          playback_id: "s-user-control",
        },
      }),
    );

    expect(await response).toMatchObject({
      op: 18,
      d: { code: 4000, message: "Soundboard event was rejected" },
    });
    expect(await broadcast).toBeNull();
    listener.close();
    caller.close();
  });

  it.each([
    {
      type: "soundboard.stop",
      playback_id: createSoundboardPlaybackId(
        TEST_SUBJECT,
        "cross-user-control",
      ),
    },
    {
      type: "soundboard.pause-set",
      playback_id: createSoundboardPlaybackId(
        TEST_SUBJECT,
        "cross-user-control",
      ),
      paused: true,
    },
    {
      type: "soundboard.volume-set",
      playback_id: createSoundboardPlaybackId(
        TEST_SUBJECT,
        "cross-user-control",
      ),
      volume: 0.25,
    },
  ])("rejects a cross-user %s control", async (event) => {
    const roomName = crypto.randomUUID();
    const socket = await openVoiceSocket(roomName, "other-user");
    await identifyVoiceSocket(
      socket,
      crypto.randomUUID(),
      roomName,
      "other-user",
    );
    const response = nextMessageWithOpcodeOrNull(socket, 18, 5_000);
    const broadcast = nextMessageWithOpcodeAndTypeOrNull(
      socket,
      106,
      event.type,
    );

    socket.send(
      JSON.stringify({
        op: 106,
        d: { server_key: "server-1", ...event },
      }),
    );

    expect(await response).toMatchObject({
      op: 18,
      d: { code: 4000, message: "Soundboard event was rejected" },
    });
    expect(await broadcast).toBeNull();
    socket.close();
  });

  it("rejects malformed and unknown soundboard events instead of rebroadcasting them", async () => {
    const roomName = crypto.randomUUID();
    const socket = await openVoiceSocket(roomName);
    await identifyVoiceSocket(socket, crypto.randomUUID(), roomName);

    const malformed = nextMessageWithOpcode(socket, 18);
    socket.send(JSON.stringify({ op: 106, d: { type: "soundboard.play" } }));
    expect(await malformed).toMatchObject({
      op: 18,
      d: { code: 4000, message: "Soundboard event was rejected" },
    });

    const unknown = nextMessageWithOpcode(socket, 18);
    socket.send(
      JSON.stringify({ op: 106, d: { type: "soundboard.not-real" } }),
    );
    expect(await unknown).toMatchObject({
      op: 18,
      d: { code: 4000, message: "Soundboard event was rejected" },
    });
    socket.close();
  });

  it("sanitizes catalog updates with authenticated sender identity", async () => {
    const roomName = crypto.randomUUID();
    const participantId = crypto.randomUUID();
    const socket = await openVoiceSocket(roomName);
    await identifyVoiceSocket(socket, participantId, roomName);
    const listener = await openVoiceSocket(roomName);
    await identifyVoiceSocket(listener, crypto.randomUUID(), roomName);
    await seedSoundboardCatalogEntry("server-1", "sound-1");

    socket.send(
      JSON.stringify({
        op: 106,
        d: {
          type: "soundboard.catalog-updated",
          server_key: "server-1",
          user_id: "forged-user",
          sound: {
            id: "sound-1",
            name: "  Airhorn  ",
            file_url: "/api/soundboard/uploads/sound-1",
            emoji: "!",
            volume: 3,
            unknown: "removed",
          },
        },
      }),
    );

    const response = await nextMessageWithOpcodeAndType(
      listener,
      106,
      "soundboard.catalog-updated",
    );
    expect(response.d).toEqual({
      type: "soundboard.catalog-updated",
      participant_id: participantId,
      user_id: TEST_SUBJECT,
      server_key: "server-1",
      sound: {
        id: "sound-1",
        name: "Canonical Airhorn",
        file_url: "/api/soundboard/uploads/sound-1",
        emoji: "🎺",
        volume: 0.4,
      },
      sent_at: expect.any(Number),
    });
    socket.close();
    listener.close();
  });

  it("allows a catalog update by a MANAGE_SERVER member using canonical D1 metadata", async () => {
    const roomName = crypto.randomUUID();
    const managerId = `manager-${crypto.randomUUID()}`;
    const participantId = crypto.randomUUID();
    await seedSoundboardCatalogEntry("server-1", "sound-1", "uploader-1", {
      name: "Manager Canonical",
      emoji: "🔊",
      volume: 0.6,
    });
    await seedManageServerPermission("server-1", managerId);
    const socket = await openVoiceSocket(roomName, managerId);
    await identifyVoiceSocket(socket, participantId, roomName, managerId);
    const listener = await openVoiceSocket(roomName, "listener");
    await identifyVoiceSocket(
      listener,
      crypto.randomUUID(),
      roomName,
      "listener",
    );

    socket.send(
      JSON.stringify({
        op: 106,
        d: {
          type: "soundboard.catalog-updated",
          server_key: "server-1",
          sound: {
            id: "sound-1",
            name: "Spoofed Name",
            emoji: "!",
            volume: 0,
          },
        },
      }),
    );

    await expect(
      nextMessageWithOpcodeAndType(listener, 106, "soundboard.catalog-updated"),
    ).resolves.toMatchObject({
      d: {
        user_id: managerId,
        sound: {
          id: "sound-1",
          name: "Manager Canonical",
          emoji: "🔊",
          volume: 0.6,
          file_url: "/api/soundboard/uploads/sound-1",
        },
      },
    });

    socket.close();
    listener.close();
  });

  it("rejects a catalog update from a non-owner without MANAGE_SERVER", async () => {
    const roomName = crypto.randomUUID();
    const unauthorizedId = `unauthorized-${crypto.randomUUID()}`;
    await seedSoundboardCatalogEntry("server-1", "sound-1", "uploader-2");
    const socket = await openVoiceSocket(roomName, unauthorizedId);
    await identifyVoiceSocket(
      socket,
      crypto.randomUUID(),
      roomName,
      unauthorizedId,
    );
    const response = nextMessageWithOpcode(socket, 18);
    const broadcast = nextMessageWithOpcodeAndTypeOrNull(
      socket,
      106,
      "soundboard.catalog-updated",
    );

    socket.send(
      JSON.stringify({
        op: 106,
        d: {
          type: "soundboard.catalog-updated",
          server_key: "server-1",
          sound: { id: "sound-1", name: "Spoofed" },
        },
      }),
    );

    await expect(response).resolves.toMatchObject({
      d: { message: "Soundboard event was rejected" },
    });
    await expect(broadcast).resolves.toBeNull();
    socket.close();
  });

  it("rejects a catalog update for a server outside the signed voice admission", async () => {
    const roomName = crypto.randomUUID();
    const socket = await openVoiceSocket(roomName);
    await identifyVoiceSocket(socket, crypto.randomUUID(), roomName);
    const response = nextMessageWithOpcodeOrNull(socket, 18);
    const broadcast = nextMessageWithOpcodeAndTypeOrNull(
      socket,
      106,
      "soundboard.catalog-updated",
    );

    socket.send(
      JSON.stringify({
        op: 106,
        d: {
          type: "soundboard.catalog-updated",
          server_key: "other-server",
          sound: { id: "sound-1", name: "Airhorn" },
        },
      }),
    );

    await expect(response).resolves.toMatchObject({
      op: 18,
      d: { code: 4000, message: "Soundboard event was rejected" },
    });
    await expect(broadcast).resolves.toBeNull();
    socket.close();
  });

  it("rejects a catalog update for an unknown sound id even on the admitted server", async () => {
    const roomName = crypto.randomUUID();
    const socket = await openVoiceSocket(roomName);
    await identifyVoiceSocket(socket, crypto.randomUUID(), roomName);
    const response = nextMessageWithOpcodeOrNull(socket, 18);
    const broadcast = nextMessageWithOpcodeAndTypeOrNull(
      socket,
      106,
      "soundboard.catalog-updated",
    );

    socket.send(
      JSON.stringify({
        op: 106,
        d: {
          type: "soundboard.catalog-updated",
          server_key: "server-1",
          sound: {
            id: "missing-sound",
            name: "Missing",
            file_url: "/api/soundboard/uploads/missing-sound",
          },
        },
      }),
    );

    await expect(response).resolves.toMatchObject({
      op: 18,
      d: { code: 4000, message: "Soundboard event was rejected" },
    });
    await expect(broadcast).resolves.toBeNull();
    socket.close();
  });

  it("accepts soundboard data URLs just below the decoded byte cap", async () => {
    const roomName = crypto.randomUUID();
    const participantId = crypto.randomUUID();
    const socket = await openVoiceSocket(roomName);
    await identifyVoiceSocket(socket, participantId, roomName);
    const listener = await openVoiceSocket(roomName);
    await identifyVoiceSocket(listener, crypto.randomUUID(), roomName);
    const dataUrl = audioDataUrlForDecodedBytes(
      MAX_SOUNDBOARD_DATA_URL_BYTES - 1,
    );

    socket.send(
      JSON.stringify({
        op: 106,
        d: {
          type: "soundboard.play",
          server_key: "server-1",
          playback_id: createSoundboardPlaybackId(TEST_SUBJECT, "under-cap"),
          name: "Custom",
          data_url: dataUrl,
        },
      }),
    );

    const response = await nextMessageWithOpcodeAndType(
      listener,
      106,
      "soundboard.play",
    );
    expect(response.d).toEqual({
      type: "soundboard.play",
      participant_id: participantId,
      user_id: TEST_SUBJECT,
      server_key: "server-1",
      playback_id: createSoundboardPlaybackId(TEST_SUBJECT, "under-cap"),
      name: "Custom",
      data_url: dataUrl,
      volume: 1,
      sent_at: expect.any(Number),
    });

    socket.close();
    listener.close();
  });

  it("accepts a soundboard data URL at the decoded byte cap", async () => {
    const roomName = crypto.randomUUID();
    const participantId = crypto.randomUUID();
    const socket = await openVoiceSocket(roomName);
    await identifyVoiceSocket(socket, participantId, roomName);
    const listener = await openVoiceSocket(roomName);
    await identifyVoiceSocket(listener, crypto.randomUUID(), roomName);
    const dataUrl = audioDataUrlForDecodedBytes(MAX_SOUNDBOARD_DATA_URL_BYTES);

    socket.send(
      JSON.stringify({
        op: 106,
        d: {
          type: "soundboard.play",
          server_key: "server-1",
          playback_id: createSoundboardPlaybackId(TEST_SUBJECT, "at-cap"),
          name: "Custom",
          data_url: dataUrl,
        },
      }),
    );

    const response = await nextMessageWithOpcodeAndType(
      listener,
      106,
      "soundboard.play",
    );
    expect(response.d).toMatchObject({
      data_url: dataUrl,
      playback_id: createSoundboardPlaybackId(TEST_SUBJECT, "at-cap"),
    });

    socket.close();
    listener.close();
  });

  it("rejects an oversized data URL even when a sound ID is supplied", async () => {
    const roomName = crypto.randomUUID();
    const socket = await openVoiceSocket(roomName);
    await identifyVoiceSocket(socket, crypto.randomUUID(), roomName);
    const oversizedDataUrl = audioDataUrlForDecodedBytes(
      MAX_SOUNDBOARD_DATA_URL_BYTES + 1,
    );
    const response = nextMessageWithOpcodeOrNull(socket, 18, 5_000);
    const broadcast = nextMessageWithOpcodeAndTypeOrNull(
      socket,
      106,
      "soundboard.play",
    );

    socket.send(
      JSON.stringify({
        op: 106,
        d: {
          type: "soundboard.play",
          server_key: "server-1",
          playback_id: createSoundboardPlaybackId(
            TEST_SUBJECT,
            "oversized-with-id",
          ),
          sound_id: "sound-1",
          name: "Custom",
          data_url: oversizedDataUrl,
        },
      }),
    );

    expect(await response).toMatchObject({
      op: 18,
      d: { code: 4000, message: "Soundboard event was rejected" },
    });
    expect(await broadcast).toBeNull();
    socket.close();
  });

  it("rejects oversized soundboard data URLs before broadcast", async () => {
    const roomName = crypto.randomUUID();
    const socket = await openVoiceSocket(roomName);
    await identifyVoiceSocket(socket, crypto.randomUUID(), roomName);
    const oversizedDataUrl = audioDataUrlForDecodedBytes(
      MAX_SOUNDBOARD_DATA_URL_BYTES + 1,
    );

    const response = nextMessageWithOpcodeOrNull(socket, 18, 5_000);
    const broadcast = nextMessageWithOpcodeAndTypeOrNull(
      socket,
      106,
      "soundboard.play",
    );
    socket.send(
      JSON.stringify({
        op: 106,
        d: {
          type: "soundboard.play",
          server_key: "server-1",
          playback_id: createSoundboardPlaybackId(TEST_SUBJECT, "custom"),
          name: "Custom",
          data_url: oversizedDataUrl,
        },
      }),
    );
    expect(await response).toMatchObject({
      op: 18,
      d: { code: 4000, message: "Soundboard event was rejected" },
    });
    expect(await broadcast).toBeNull();
    socket.close();
  });

  it.each([
    "https://10.1.2.3/live",
    "https://127.0.0.1/live",
    "https://169.254.1.1/live",
    "https://172.16.1.1/live",
    "https://192.168.1.1/live",
    "https://0.1.2.3/live",
    "https://[::1]/live",
  ])("rejects private radio URLs: %s", async (privateUrl) => {
    const roomName = crypto.randomUUID();
    await mockRadioBrowserStation(roomName, {
      stationuuid: RADIO_STATION_UUID,
      name: "Private Radio Station",
      url_resolved: privateUrl,
    });
    const socket = await openVoiceSocket(roomName);
    await identifyVoiceSocket(socket, crypto.randomUUID(), roomName);
    const response = nextMessageWithOpcodeAndType(
      socket,
      106,
      "listen_together.error",
    );
    socket.send(
      JSON.stringify({
        op: 106,
        d: {
          type: "listen_together.enqueue",
          room_slug: roomName,
          entries: [
            {
              track: {
                kind: "radio",
                provider: "radio",
                station_uuid: RADIO_STATION_UUID,
              },
            },
          ],
        },
      }),
    );
    expect(await response).toMatchObject({
      op: 106,
      d: { type: "listen_together.error", code: "EMPTY_QUEUE" },
    });
    socket.close();
  });
});

describe("VoiceRoom voice reconnect hold", () => {
  /** Every frame the socket receives from now on. */
  function recordFrames(socket: WebSocket): Array<{ op: number; d: unknown }> {
    const frames: Array<{ op: number; d: unknown }> = [];
    socket.addEventListener("message", (event: MessageEvent<string>) => {
      frames.push(JSON.parse(event.data) as { op: number; d: unknown });
    });
    return frames;
  }

  function opcodes(frames: Array<{ op: number }>): number[] {
    return frames.map((frame) => frame.op);
  }

  async function publish(
    socket: WebSocket,
    participantId: string,
    roomName: string,
    sessionLabel: string,
    tracks: Array<{ name: string; sfu: string; kind: "audio" | "video" }>,
  ) {
    const sessionId = await issuePartyTracksSessionCapability(
      participantId,
      roomName,
      sessionLabel,
    );
    socket.send(
      JSON.stringify({
        op: 12,
        d: {
          tracks: tracks.map((track) => ({
            participant_id: participantId,
            track_name: track.name,
            sfu_track_name: track.sfu,
            session_id: sessionId,
            kind: track.kind,
          })),
        },
      }),
    );
    return sessionId;
  }

  async function heldTrackFlags(
    roomName: string,
  ): Promise<Record<string, number>> {
    const room = env.VOICE_ROOM.get(env.VOICE_ROOM.idFromName(roomName));
    return runInDurableObject(room, (_instance, state) =>
      Object.fromEntries(
        [...state.storage.sql.exec("SELECT track_name, held FROM tracks")].map(
          (row) => [row.track_name as string, Number(row.held)],
        ),
      ),
    );
  }

  async function setUp() {
    const roomName = crypto.randomUUID();
    const publisherId = crypto.randomUUID();
    const listenerId = crypto.randomUUID();
    await mockCallsApi(roomName, async () => Response.json({}));
    const publisher = await openVoiceSocket(roomName);
    await identifyVoiceSocket(publisher, publisherId, roomName);
    const listener = await openVoiceSocket(roomName, "listener-user");
    await identifyVoiceSocket(listener, listenerId, roomName, "listener-user");
    const audio = `cam-audio-${publisherId}`;
    const video = `cam-video-${publisherId}`;
    const offered = nextMessageWithOpcode(listener, 12);
    const sessionId = await publish(
      publisher,
      publisherId,
      roomName,
      "held-session",
      [
        { name: audio, sfu: "sfu-audio-1", kind: "audio" },
        { name: video, sfu: "sfu-video-1", kind: "video" },
      ],
    );
    await offered;
    return {
      roomName,
      publisherId,
      publisher,
      listener,
      audio,
      video,
      sessionId,
    };
  }

  it("keeps a reconnecting publisher's tracks with no op 11 or 13 when it offers them again", async () => {
    const { roomName, publisherId, publisher, listener, audio, video } =
      await setUp();
    const frames = recordFrames(listener);

    publisher.close();
    await vi.waitFor(async () => {
      expect(await heldUntil(roomName, publisherId)).toEqual(
        expect.any(Number),
      );
    });
    expect(await heldTrackFlags(roomName)).toEqual({ [audio]: 1, [video]: 1 });

    const replacement = await openVoiceSocket(roomName);
    await identifyVoiceSocket(replacement, publisherId, roomName);
    const reoffered = nextMessageWithOpcode(listener, 12);
    // The PartyTracks session survived the socket: the same SFU tracks.
    await publish(replacement, publisherId, roomName, "held-session", [
      { name: audio, sfu: "sfu-audio-1", kind: "audio" },
      { name: video, sfu: "sfu-video-1", kind: "video" },
    ]);
    await expect(reoffered).resolves.toMatchObject({
      d: {
        participant_id: publisherId,
        tracks: [
          expect.objectContaining({
            track_name: audio,
            sfu_track_name: "sfu-audio-1",
          }),
          expect.objectContaining({
            track_name: video,
            sfu_track_name: "sfu-video-1",
          }),
        ],
      },
    });
    await vi.waitFor(async () => {
      expect(await heldTrackFlags(roomName)).toEqual({
        [audio]: 0,
        [video]: 0,
      });
    });

    await expireReconnectHolds(roomName);
    expect(await heldUntil(roomName, publisherId)).toBeNull();
    expect((await trackNames(roomName)).sort()).toEqual([audio, video].sort());
    await expect(hasMessageWithOpcode(listener, 13, 150)).resolves.toBe(false);
    expect(opcodes(frames)).not.toContain(11);
    expect(opcodes(frames)).not.toContain(13);

    replacement.close();
    listener.close();
  });

  it("holds the tracks when the participant identifies again before its old socket closes", async () => {
    const { roomName, publisherId, publisher, listener, audio, video } =
      await setUp();
    const frames = recordFrames(listener);
    const replaced = new Promise<CloseEvent>((resolve) =>
      publisher.addEventListener("close", resolve, { once: true }),
    );

    const replacement = await openVoiceSocket(roomName);
    await identifyVoiceSocket(replacement, publisherId, roomName);
    await expect(replaced).resolves.toMatchObject({
      reason: "Replaced by new connection",
    });
    expect(await heldTrackFlags(roomName)).toEqual({ [audio]: 1, [video]: 1 });

    await publish(replacement, publisherId, roomName, "held-session", [
      { name: audio, sfu: "sfu-audio-1", kind: "audio" },
      { name: video, sfu: "sfu-video-1", kind: "video" },
    ]);
    await vi.waitFor(async () => {
      expect(await heldTrackFlags(roomName)).toEqual({
        [audio]: 0,
        [video]: 0,
      });
    });
    await expireReconnectHolds(roomName);
    await expect(hasMessageWithOpcode(listener, 13, 150)).resolves.toBe(false);
    expect(opcodes(frames)).not.toContain(11);
    expect(opcodes(frames)).not.toContain(13);
    expect((await trackNames(roomName)).sort()).toEqual([audio, video].sort());

    replacement.close();
    listener.close();
  });

  it("moves listeners to changed tracks and stops only those not offered again", async () => {
    const { roomName, publisherId, publisher, listener, audio, video } =
      await setUp();
    const frames = recordFrames(listener);

    publisher.close();
    await vi.waitFor(async () => {
      expect(await heldUntil(roomName, publisherId)).toEqual(
        expect.any(Number),
      );
    });
    const replacement = await openVoiceSocket(roomName);
    await identifyVoiceSocket(replacement, publisherId, roomName);
    // A rebuilt PartyTracks session republished the microphone only.
    const reoffered = nextMessageWithOpcode(listener, 12);
    const newSession = await publish(
      replacement,
      publisherId,
      roomName,
      "rebuilt-session",
      [{ name: audio, sfu: "sfu-audio-2", kind: "audio" }],
    );
    await expect(reoffered).resolves.toMatchObject({
      d: {
        tracks: [
          expect.objectContaining({
            track_name: audio,
            sfu_track_name: "sfu-audio-2",
            session_id: newSession,
          }),
        ],
      },
    });
    expect(opcodes(frames)).not.toContain(13);

    const stopped = nextMessageWithOpcode(listener, 13);
    await expireReconnectHolds(roomName);
    await expect(stopped).resolves.toMatchObject({
      d: { participant_id: publisherId, track_names: [video] },
    });
    expect(await trackNames(roomName)).toEqual([audio]);
    expect(opcodes(frames)).not.toContain(11);

    replacement.close();
    listener.close();
  });

  it("purges a participant that does not reconnect within the hold", async () => {
    const { roomName, publisherId, publisher, listener, audio, video } =
      await setUp();
    const frames = recordFrames(listener);

    publisher.close();
    await vi.waitFor(async () => {
      expect(await heldUntil(roomName, publisherId)).toEqual(
        expect.any(Number),
      );
    });
    expect(opcodes(frames)).not.toContain(11);
    expect(opcodes(frames)).not.toContain(13);
    // The alarm is due when the hold ends, not at the next zombie sweep.
    const room = env.VOICE_ROOM.get(env.VOICE_ROOM.idFromName(roomName));
    const until = await heldUntil(roomName, publisherId);
    const alarm = await runInDurableObject(room, (_instance, state) =>
      state.storage.getAlarm(),
    );
    expect(alarm).not.toBeNull();
    expect(alarm as number).toBeLessThanOrEqual(until as number);

    // Someone joining meanwhile is offered the held tracks.
    const lateId = crypto.randomUUID();
    const late = await openVoiceSocket(roomName, "late-user");
    await grantVoiceJoin(roomName, lateId, "late-user");
    const ready = nextMessageWithOpcode(late, 101);
    late.send(
      JSON.stringify({
        op: 100,
        d: {
          participant_id: lateId,
          voice_token: await issueVoiceToken(lateId, roomName, "late-user"),
        },
      }),
    );
    const readyFrame = (await ready) as {
      d: { tracks: Array<{ track_name: string }> };
    };
    expect(readyFrame.d.tracks.map((track) => track.track_name).sort()).toEqual(
      [audio, video].sort(),
    );

    const disconnected = nextMessageWithOpcode(listener, 11);
    const stopped = nextMessageWithOpcode(listener, 13);
    await expireReconnectHolds(roomName);
    await expect(disconnected).resolves.toMatchObject({
      d: { participant_id: publisherId },
    });
    await expect(stopped).resolves.toMatchObject({
      d: {
        participant_id: publisherId,
        track_names: expect.arrayContaining([audio, video]),
      },
    });
    expect(await heldUntil(roomName, publisherId)).toBeUndefined();
    expect(await trackNames(roomName)).toEqual([]);

    late.close();
    listener.close();
  });

  it("purges a held participant at once when it leaves during the hold", async () => {
    const { roomName, publisherId, publisher, listener, audio, video } =
      await setUp();

    publisher.close();
    await vi.waitFor(async () => {
      expect(await heldUntil(roomName, publisherId)).toEqual(
        expect.any(Number),
      );
    });

    const disconnected = nextMessageWithOpcode(listener, 11);
    const stopped = nextMessageWithOpcode(listener, 13);
    const room = env.VOICE_ROOM.get(env.VOICE_ROOM.idFromName(roomName));
    const response = await room.fetch(
      "https://internal/disconnect-participant",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participant_id: publisherId,
          user_id: TEST_SUBJECT,
        }),
      },
    );
    await expect(response.json()).resolves.toEqual({ disconnected: true });
    await expect(disconnected).resolves.toMatchObject({
      d: { participant_id: publisherId },
    });
    await expect(stopped).resolves.toMatchObject({
      d: { track_names: expect.arrayContaining([audio, video]) },
    });
    expect(await heldUntil(roomName, publisherId)).toBeUndefined();
    expect(await trackNames(roomName)).toEqual([]);

    listener.close();
  });

  it("purges at once, with no hold, on a leave (op 11)", async () => {
    const { roomName, publisherId, publisher, listener, audio, video } =
      await setUp();

    const disconnected = nextMessageWithOpcode(listener, 11);
    const stopped = nextMessageWithOpcode(listener, 13);
    publisher.send(JSON.stringify({ op: 11, d: {} }));
    await expect(disconnected).resolves.toMatchObject({
      d: { participant_id: publisherId },
    });
    await expect(stopped).resolves.toMatchObject({
      d: { track_names: expect.arrayContaining([audio, video]) },
    });
    expect(await heldUntil(roomName, publisherId)).toBeUndefined();
    expect(await trackNames(roomName)).toEqual([]);

    listener.close();
  });
});

describe("VoiceRoom track-unavailable reports", () => {
  const SFU_TRACK = "partytracks-opaque-audio";

  /** A publisher with one announced PartyTracks track, and a listener. */
  async function publishedRoom(
    accessMode: "authenticated" | "public-demo" = "authenticated",
  ) {
    const roomName = crypto.randomUUID();
    const publisherId = crypto.randomUUID();
    const listenerId = crypto.randomUUID();
    const trackName = `cam-audio-${publisherId}`;
    const sessionId = await issuePartyTracksSessionCapability(
      publisherId,
      roomName,
      "raw-publisher-session",
    );
    const publisher = await openVoiceSocket(
      roomName,
      "publisher-user",
      accessMode,
    );
    await identifyVoiceSocket(
      publisher,
      publisherId,
      roomName,
      "publisher-user",
    );
    const listener = await openVoiceSocket(
      roomName,
      "listener-user",
      accessMode,
    );
    await identifyVoiceSocket(listener, listenerId, roomName, "listener-user");

    const announced = nextMessageWithOpcode(listener, GatewayOp.Video);
    publisher.send(
      JSON.stringify({
        op: GatewayOp.Video,
        d: {
          tracks: [
            {
              participant_id: publisherId,
              track_name: trackName,
              sfu_track_name: SFU_TRACK,
              session_id: sessionId,
              kind: "audio",
            },
          ],
        },
      }),
    );
    await announced;

    const report = (socket: WebSocket, patch: Record<string, unknown> = {}) =>
      socket.send(
        JSON.stringify({
          op: GatewayOp.TrackUnavailable,
          d: {
            participant_id: publisherId,
            track_name: trackName,
            sfu_track_name: SFU_TRACK,
            session_id: sessionId,
            ...patch,
          },
        }),
      );
    const close = () => {
      publisher.close();
      listener.close();
    };
    return {
      roomName,
      publisherId,
      trackName,
      sessionId,
      publisher,
      listener,
      report,
      close,
    };
  }

  /** Lets the next republish request through the per-track interval. */
  async function expireRepublishInterval(roomName: string) {
    const room = env.VOICE_ROOM.get(env.VOICE_ROOM.idFromName(roomName));
    await runInDurableObject(room, (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE ws_rate_limits SET window_start = window_start - 3000 " +
          "WHERE rate_key LIKE 'republish:%'",
      );
    });
  }

  it.each(["authenticated", "public-demo"] as const)(
    "asks the publisher to republish a track a listener cannot pull (%s)",
    async (accessMode) => {
      const room = await publishedRoom(accessMode);
      const request = nextMessageWithOpcode(
        room.publisher,
        GatewayOp.RepublishRequest,
      );
      const listenerCopy = nextMessageWithOpcodeOrNull(
        room.listener,
        GatewayOp.RepublishRequest,
      );
      room.report(room.listener);

      expect(await request).toEqual({
        op: GatewayOp.RepublishRequest,
        d: {
          track_name: room.trackName,
          sfu_track_name: SFU_TRACK,
          session_id: room.sessionId,
        },
      });
      expect(await listenerCopy).toBeNull();
      room.close();
    },
  );

  it("ignores reports that do not match the publisher's current track", async () => {
    const room = await publishedRoom();
    const request = nextMessageWithOpcodeOrNull(
      room.publisher,
      GatewayOp.RepublishRequest,
    );
    room.report(room.listener, { track_name: `cam-video-${room.publisherId}` });
    room.report(room.listener, { sfu_track_name: "republished-already" });
    room.report(room.listener, { session_id: "another-session" });
    room.report(room.listener, { participant_id: crypto.randomUUID() });
    // Nobody asks itself.
    room.report(room.publisher);
    expect(await request).toBeNull();

    // A listener in another room cannot reach this publisher.
    const otherRoom = crypto.randomUUID();
    const outsider = await openVoiceSocket(otherRoom, "outsider-user");
    await identifyVoiceSocket(
      outsider,
      crypto.randomUUID(),
      otherRoom,
      "outsider-user",
    );
    const fromOutside = nextMessageWithOpcodeOrNull(
      room.publisher,
      GatewayOp.RepublishRequest,
    );
    room.report(outsider);
    expect(await fromOutside).toBeNull();

    outsider.close();
    room.close();
  });

  it("asks at most once per 3 s per track, whoever reports it", async () => {
    const room = await publishedRoom();
    const second = await openVoiceSocket(room.roomName, "second-listener");
    await identifyVoiceSocket(
      second,
      crypto.randomUUID(),
      room.roomName,
      "second-listener",
    );

    const first = nextMessageWithOpcode(
      room.publisher,
      GatewayOp.RepublishRequest,
    );
    room.report(room.listener);
    await first;

    const limited = nextMessageWithOpcodeOrNull(
      room.publisher,
      GatewayOp.RepublishRequest,
    );
    room.report(room.listener);
    room.report(second);
    expect(await limited).toBeNull();

    await expireRepublishInterval(room.roomName);
    const later = nextMessageWithOpcode(
      room.publisher,
      GatewayOp.RepublishRequest,
    );
    room.report(second);
    await expect(later).resolves.toMatchObject({
      d: { track_name: room.trackName },
    });

    second.close();
    room.close();
  });
});

describe("VoiceRoom gateway protocol edge", () => {
  /** A mistyped payload per opcode (non-objects are sent too). */
  const MISTYPED_PAYLOADS = new Map<number, unknown>([
    [GatewayOp.VoiceIdentify, { participant_id: "p" }],
    [
      GatewayOp.SelectProtocol,
      {
        sdp: "v=0",
        push_prefix: "camera",
        push_tracks: [{ track_name: "screen-video-p", kind: "video" }],
        pull_tracks: [],
      },
    ],
    [GatewayOp.Video, { tracks: [{ track_name: "cam-video-p" }] }],
    [GatewayOp.StopTracks, { track_names: [1] }],
    [GatewayOp.TracksReady, { track_names: "screen-video-p" }],
    [GatewayOp.Speaking, { speaking: "1" }],
    [GatewayOp.VoiceAppEvent, [{ type: "soundboard.play" }]],
    [GatewayOp.TrackUnavailable, { participant_id: "p", track_name: "t" }],
  ]);
  const payloadOps = Object.entries(voiceGatewayClientRules).flatMap(
    ([op, rule]) => (rule ? [[Number(op), rule.invalid] as const] : []),
  );

  async function roomRows(roomName: string) {
    const room = env.VOICE_ROOM.get(env.VOICE_ROOM.idFromName(roomName));
    return runInDurableObject(room, (_instance, state) => {
      const rows = (table: string) => [
        ...state.storage.sql.exec(`SELECT * FROM ${table} ORDER BY 1`),
      ];
      return JSON.stringify({
        participants: rows("participants").map((row) => ({
          ...row,
          last_heartbeat: undefined,
        })),
        tracks: rows("tracks"),
      });
    });
  }

  it("has a mistyped payload for every opcode with a payload", () => {
    expect([...MISTYPED_PAYLOADS.keys()].sort((a, b) => a - b)).toEqual(
      payloadOps.map(([op]) => op).sort((a, b) => a - b),
    );
  });

  it.each(payloadOps)(
    "answers malformed opcode %s payloads with %j and changes nothing",
    async (op, invalid) => {
      const roomName = crypto.randomUUID();
      const socket = await openVoiceSocket(roomName);
      if (op !== GatewayOp.VoiceIdentify) {
        await identifyVoiceSocket(socket, crypto.randomUUID(), roomName);
      }
      const before = await roomRows(roomName);

      for (const d of [
        undefined,
        null,
        [],
        "text",
        7,
        MISTYPED_PAYLOADS.get(op),
      ]) {
        const reply = nextMessageWithOpcode(socket, 18);
        socket.send(JSON.stringify({ op, d }));
        expect(await reply).toEqual({
          op: 18,
          d: { code: 4000, message: invalid },
        });
      }

      expect(await roomRows(roomName)).toBe(before);
      const ack = nextMessageWithOpcode(socket, 6);
      socket.send(HEARTBEAT_FRAME);
      await expect(ack).resolves.toMatchObject({ op: 6 });
      socket.close();
    },
  );

  it("still asks an unidentified socket to identify before judging an offer", async () => {
    const socket = await openVoiceSocket();
    const reply = nextMessageWithOpcode(socket, 18);
    socket.send(JSON.stringify({ op: GatewayOp.SelectProtocol, d: null }));
    await expect(reply).resolves.toEqual({
      op: 18,
      d: { code: 4003, message: "Not identified on voice" },
    });
    socket.close();
  });

  it("answers an unknown opcode as before", async () => {
    const socket = await openVoiceSocket();
    const reply = nextMessageWithOpcode(socket, 18);
    socket.send(JSON.stringify({ op: 999, d: {} }));
    await expect(reply).resolves.toEqual({
      op: 18,
      d: { code: 4001, message: "Unknown voice opcode: 999" },
    });
    socket.close();
  });
});

describe("VoiceRoom schema start-up", () => {
  type SqlStorage = DurableObjectState["storage"]["sql"];
  type Internals = {
    getUserIdForParticipant(participantId: string): string | null;
  };
  const columns = (sql: SqlStorage) =>
    [...sql.exec<{ name: string }>("PRAGMA table_info(participants)")].map(
      (row) => row.name,
    );
  const userIdOf = (sql: SqlStorage, participantId: string) =>
    [
      ...sql.exec<{ user_id: string | null }>(
        "SELECT user_id FROM participants WHERE id = ?",
        participantId,
      ),
    ][0]?.user_id;
  const roomEnv = env as unknown as ConstructorParameters<typeof VoiceRoom>[1];

  it.each([
    {
      label: "a table with only the pre-rename column",
      columnsSql: "clerk_user_id TEXT",
      insertSql:
        "INSERT INTO participants (id, clerk_user_id) VALUES (?, ?), (?, ?)",
      rows: (a: string, b: string) => [a, "user-a", b, "user-b"],
    },
    {
      label: "a table with both user id columns",
      columnsSql: "user_id TEXT, clerk_user_id TEXT",
      // One row written by both versions, one only by pre-rename code.
      insertSql:
        "INSERT INTO participants (id, user_id, clerk_user_id) VALUES (?, ?, ?), (?, NULL, ?)",
      rows: (a: string, b: string) => [a, "user-a", "user-a", b, "user-b"],
    },
  ])(
    "drops the pre-rename user id column from $label, keeping every user id",
    async ({ columnsSql, insertSql, rows }) => {
      const roomName = crypto.randomUUID();
      const room = env.VOICE_ROOM.get(env.VOICE_ROOM.idFromName(roomName));
      const a = crypto.randomUUID();
      const b = crypto.randomUUID();

      await runInDurableObject(room, (_instance, state) => {
        const sql = state.storage.sql;
        sql.exec("DROP TABLE participants");
        sql.exec(
          `CREATE TABLE participants (id TEXT PRIMARY KEY, ${columnsSql}, native_screen_session_id TEXT, last_heartbeat INTEGER DEFAULT 0, speaking INTEGER DEFAULT 0, connection_id TEXT)`,
        );
        sql.exec(insertSql, ...rows(a, b));

        const started = new VoiceRoom(state, roomEnv) as unknown as Internals;
        expect(columns(sql)).toContain("user_id");
        expect(columns(sql)).not.toContain("clerk_user_id");
        expect(userIdOf(sql, a)).toBe("user-a");
        expect(userIdOf(sql, b)).toBe("user-b");
        expect(started.getUserIdForParticipant(b)).toBe("user-b");

        const before = columns(sql);
        new VoiceRoom(state, roomEnv);
        expect(columns(sql)).toEqual(before);
        expect(userIdOf(sql, b)).toBe("user-b");
      });
    },
  );

  it("drops the retired soundboard playback owner table", async () => {
    const roomName = crypto.randomUUID();
    const room = env.VOICE_ROOM.get(env.VOICE_ROOM.idFromName(roomName));

    await runInDurableObject(room, (_instance, state) => {
      const sql = state.storage.sql;
      sql.exec(
        "CREATE TABLE IF NOT EXISTS soundboard_legacy_playback_owners (playback_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT 0)",
      );
      new VoiceRoom(state, roomEnv);
      expect(() =>
        sql.exec("SELECT COUNT(*) FROM soundboard_legacy_playback_owners"),
      ).toThrow(/no such table/);
    });
  });

  it("carries live nonces over from the retired nonce table and drops it", async () => {
    const roomName = crypto.randomUUID();
    const room = env.VOICE_ROOM.get(env.VOICE_ROOM.idFromName(roomName));
    const now = Date.now();

    await runInDurableObject(room, (_instance, state) => {
      const sql = state.storage.sql;
      // The previous version's table, as it creates it.
      sql.exec(`
        CREATE TABLE IF NOT EXISTS realtime_ticket_nonces (
          nonce_digest TEXT PRIMARY KEY,
          access_mode TEXT NOT NULL,
          audience TEXT NOT NULL,
          room_slug TEXT NOT NULL,
          subject TEXT NOT NULL,
          connection_generation TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          consumed_at INTEGER NOT NULL
        );
      `);
      const insert =
        "INSERT INTO realtime_ticket_nonces VALUES (?, 'authenticated', 'voice', ?, 'user', 'gen', ?, ?)";
      sql.exec(insert, "live-digest", roomName, now + 60_000, now);
      sql.exec(insert, "expired-digest", roomName, now - 1, now - 60_000);

      initRealtimeTicketNonces(sql, now);

      expect(() =>
        sql.exec("SELECT COUNT(*) FROM realtime_ticket_nonces"),
      ).toThrow(/no such table/);
      expect(
        [
          ...sql.exec<{ nonce_digest: string }>(
            "SELECT nonce_digest FROM realtime_ticket_nonce_uses",
          ),
        ].map((row) => row.nonce_digest),
      ).toEqual(["live-digest"]);
      const replay = {
        accessMode: "authenticated" as const,
        audience: "voice" as const,
        expiresAt: now + 60_000,
        nonceDigest: "live-digest",
        participantId: "p",
        roomSlug: roomName,
        subject: "user",
      };
      expect(consumeRealtimeTicketNonce(sql, replay, now)).toEqual({
        ok: false,
        reason: "replayed",
      });
      expect(
        consumeRealtimeTicketNonce(
          sql,
          { ...replay, nonceDigest: "fresh-digest" },
          now,
        ),
      ).toEqual({ ok: true });

      // A second start, with no retired table left, changes nothing.
      initRealtimeTicketNonces(sql, now);
      expect(
        [
          ...sql.exec<{ c: number }>(
            "SELECT COUNT(*) AS c FROM realtime_ticket_nonce_uses",
          ),
        ][0]?.c,
      ).toBe(2);
    });
  });

  it("keeps the retired nonce table when carrying its nonces over fails", async () => {
    const roomName = crypto.randomUUID();
    const room = env.VOICE_ROOM.get(env.VOICE_ROOM.idFromName(roomName));
    const now = Date.now();

    await runInDurableObject(room, (_instance, state) => {
      const sql = state.storage.sql;
      // A retired table the carry-over SELECT cannot read (no consumed_at).
      sql.exec(`
        CREATE TABLE IF NOT EXISTS realtime_ticket_nonces (
          nonce_digest TEXT PRIMARY KEY,
          access_mode TEXT NOT NULL,
          audience TEXT NOT NULL,
          room_slug TEXT NOT NULL,
          subject TEXT NOT NULL,
          expires_at INTEGER NOT NULL
        );
      `);
      sql.exec(
        "INSERT INTO realtime_ticket_nonces VALUES ('live-digest', 'authenticated', 'voice', ?, 'user', ?)",
        roomName,
        now + 60_000,
      );

      expect(() => initRealtimeTicketNonces(sql, now)).toThrow(
        /no such column/,
      );
      expect(
        [
          ...sql.exec<{ c: number }>(
            "SELECT COUNT(*) AS c FROM realtime_ticket_nonces",
          ),
        ][0]?.c,
      ).toBe(1);
    });
  });
});
