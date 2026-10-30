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
import { createSoundboardPlaybackId } from "../../src/lib/voice/soundboard-playback-id";
import { verifySoundboardMediaCapability } from "../../src/lib/voice/soundboard-media-capability";
import { GET as GET_SOUNDBOARD_UPLOAD } from "../../src/routes/api/soundboard/uploads/$id";

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
  roomName = crypto.randomUUID(),
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

async function collectListenTogetherEventsForSockets(
  sockets: WebSocket[],
  send: () => void,
  timeoutMs = 100,
): Promise<ListenTogetherTestEvent[][]> {
  return new Promise((resolve) => {
    const events = sockets.map(() => [] as ListenTogetherTestEvent[]);
    let timer: ReturnType<typeof setTimeout>;
    const listeners = sockets.map((socket, index) => {
      const onMessage = (event: MessageEvent<string>) => {
        const message = JSON.parse(event.data) as {
          op: number;
          d: ListenTogetherTestEvent;
        };
        if (
          message.op !== 106 ||
          !message.d.type?.startsWith("listen_together.")
        ) {
          return;
        }
        events[index]?.push(message.d);
        clearTimeout(timer);
        timer = setTimeout(finish, timeoutMs);
      };
      socket.addEventListener("message", onMessage);
      return { socket, onMessage };
    });
    const finish = () => {
      clearTimeout(timer);
      for (const { socket, onMessage } of listeners) {
        socket.removeEventListener("message", onMessage);
      }
      resolve(events);
    };
    timer = setTimeout(finish, timeoutMs);
    send();
  });
}

async function collectListenTogetherEvents(
  socket: WebSocket,
  send: () => void,
  timeoutMs = 100,
): Promise<ListenTogetherTestEvent[]> {
  const [events] = await collectListenTogetherEventsForSockets(
    [socket],
    send,
    timeoutMs,
  );
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
    const response = nextMessageWithOpcodeOrNull(socket, 18);
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
          playback_id: `s-${TEST_SUBJECT}-unknown-source`,
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
          playback_id: `s-${TEST_SUBJECT}-known-default`,
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
      playback_id: `s-${TEST_SUBJECT}-known-default`,
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

    const playbackId = `s-${TEST_SUBJECT}-${soundId}`;
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
    { label: "pull prewarm", op: 107, d: {} },
    { label: "pull reset", op: 105, d: {} },
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
    await expect(published).resolves.toMatchObject({
      d: {
        tracks: [
          {
            participant_id: participantId,
            track_name: `screen-video-${participantId}`,
            session_id: "native-screen-session",
          },
          {
            participant_id: participantId,
            track_name: `screen-audio-${participantId}`,
            session_id: "native-screen-session",
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
            session_id: "native-latest-session",
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

    const disconnected = nextMessageWithOpcode(observer, 11);
    const staleDescription = hasMessageWithOpcode(publisher, 4, 250);
    const staleNegotiation = hasMessageWithOpcode(publisher, 10, 250);
    const stalePublication = hasMessageWithOpcode(observer, 12, 250);
    publisher.close();
    await expect(disconnected).resolves.toMatchObject({
      d: { participant_id: participantId },
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
            session_id: "native-replay-session",
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
        body: JSON.stringify({ participant_id: participantId }),
      },
    );

    expect(disconnectResponse.status).toBe(200);
    await expect(disconnectResponse.json()).resolves.toEqual({
      disconnected: true,
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
    await expect(nextMessageWithOpcode(observer, 5)).resolves.toMatchObject({
      d: { participant_id: publisherId, speaking: 0 },
    });

    const room = env.VOICE_ROOM.get(env.VOICE_ROOM.idFromName(roomName));
    await runInDurableObject(room, (_instance, state) => {
      const row = [
        ...state.storage.sql.exec(
          "SELECT speaking FROM participants WHERE id = ?",
          publisherId,
        ),
      ][0];
      expect(row).toBeUndefined();
    });

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

    const enqueued = await collectCommand({
      type: "listen_together.enqueue",
      room_slug: roomName,
      mode: "append",
      entries: [listenTogetherMusicEntry()],
    });
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toMatchObject({
      type: "listen_together.snapshot",
      snapshot: { revision: 1 },
    });
    const firstEntryId = enqueued[0]?.snapshot?.currentEntryId ?? "";

    const paused = await collectCommand({
      type: "listen_together.pause",
      room_slug: roomName,
      paused: true,
      entryId: firstEntryId,
    });
    expect(paused).toHaveLength(1);
    expect(paused[0]).toMatchObject({
      type: "listen_together.snapshot",
      snapshot: { revision: 2, paused: true },
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
          ...listenTogetherMusicEntry(),
          track: {
            ...listenTogetherMusicEntry().track,
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

    const enqueued = await collectCommand({
      type: "listen_together.enqueue",
      room_slug: roomName,
      mode: "append",
      entries: [listenTogetherMusicEntry()],
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
          ...listenTogetherMusicEntry(),
          track: {
            ...listenTogetherMusicEntry().track,
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
          playback_id: `s-${TEST_SUBJECT}-sound-1`,
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
      playback_id: `s-${TEST_SUBJECT}-sound-1`,
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
          playback_id: `s-${TEST_SUBJECT}-canonical`,
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
      playback_id: `s-${TEST_SUBJECT}-canonical`,
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
          playback_id: `s-${TEST_SUBJECT}-invalid-legacy`,
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
      playback_id: `s-${TEST_SUBJECT}-invalid-legacy`,
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
          playback_id: `s-${TEST_SUBJECT}-tracking`,
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
      const response = nextMessageWithOpcodeOrNull(socket, 18);
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
            playback_id: `s-${TEST_SUBJECT}-credential-url`,
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
    const response = nextMessageWithOpcodeOrNull(socket, 18);
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
          playback_id: `s-${TEST_SUBJECT}-invalid-data-url`,
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
    const response = nextMessageWithOpcodeOrNull(socket, 18);
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
          playback_id: `s-${TEST_SUBJECT}-unsafe-media`,
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
    const response = nextMessageWithOpcodeOrNull(socket, 18);
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
          playback_id: `s-${TEST_SUBJECT}-catalog-media`,
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
          playback_id: `s-${TEST_SUBJECT}-catalog-media`,
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
          playback_id: "s-another-user-airhorn",
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

  it("rejects a prefix-colliding legacy control from user", async () => {
    const roomName = crypto.randomUUID();
    const owner = await openVoiceSocket(roomName, "user-other");
    await identifyVoiceSocket(
      owner,
      crypto.randomUUID(),
      roomName,
      "user-other",
    );
    const caller = await openVoiceSocket(roomName, "user");
    await identifyVoiceSocket(caller, crypto.randomUUID(), roomName, "user");
    const response = nextMessageWithOpcode(caller, 18);
    const broadcast = nextMessageWithOpcodeAndTypeOrNull(
      owner,
      106,
      "soundboard.stop",
    );

    caller.send(
      JSON.stringify({
        op: 106,
        d: {
          type: "soundboard.stop",
          server_key: "server-1",
          playback_id: "s-user-other-control",
        },
      }),
    );

    expect(await response).toMatchObject({
      op: 18,
      d: { code: 4000, message: "Soundboard event was rejected" },
    });
    expect(await broadcast).toBeNull();
    owner.close();
    caller.close();
  });

  it.each([
    {
      type: "soundboard.stop",
      playback_id: `s-${TEST_SUBJECT}-cross-user-control`,
    },
    {
      type: "soundboard.pause-set",
      playback_id: `s-${TEST_SUBJECT}-cross-user-control`,
      paused: true,
    },
    {
      type: "soundboard.volume-set",
      playback_id: `s-${TEST_SUBJECT}-cross-user-control`,
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
    const response = nextMessageWithOpcodeOrNull(socket, 18);
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

  it("prunes expired legacy soundboard playback owner rows", async () => {
    const roomName = crypto.randomUUID();
    const room = env.VOICE_ROOM.get(env.VOICE_ROOM.idFromName(roomName));
    const socket = await openVoiceSocket(roomName);
    await identifyVoiceSocket(socket, crypto.randomUUID(), roomName);

    await runInDurableObject(room, (instance) => {
      const sql = (instance as { sql: SqlStorage }).sql;
      sql.exec(
        `INSERT OR REPLACE INTO soundboard_legacy_playback_owners (playback_id, owner_id, created_at)
         VALUES (?, ?, ?)`,
        `s-${TEST_SUBJECT}-stale`,
        TEST_SUBJECT,
        Date.now() - 11 * 60 * 1000,
      );
    });

    await runDurableObjectAlarm(room);

    await runInDurableObject(room, (instance) => {
      const sql = (instance as { sql: SqlStorage }).sql;
      const rows = [
        ...sql.exec(
          "SELECT playback_id FROM soundboard_legacy_playback_owners WHERE playback_id = ?",
          `s-${TEST_SUBJECT}-stale`,
        ),
      ];
      expect(rows).toHaveLength(0);
    });

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
          playback_id: `s-${TEST_SUBJECT}-under-cap`,
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
      playback_id: `s-${TEST_SUBJECT}-under-cap`,
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
          playback_id: `s-${TEST_SUBJECT}-at-cap`,
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
      playback_id: `s-${TEST_SUBJECT}-at-cap`,
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
    const response = nextMessageWithOpcodeOrNull(socket, 18);
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
          playback_id: `s-${TEST_SUBJECT}-oversized-with-id`,
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

    const response = nextMessageWithOpcodeOrNull(socket, 18);
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
          playback_id: `s-${TEST_SUBJECT}-custom`,
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
