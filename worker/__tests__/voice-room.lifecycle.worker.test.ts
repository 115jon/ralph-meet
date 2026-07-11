import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  issueSocketTicket,
  verifySocketTicket,
} from "../../src/lib/voice/socket-ticket";
import {
  appendRealtimeAdmissionHeaders,
  createRealtimeAdmissionContext,
} from "../realtime-admission";

const textEncoder = new TextEncoder();
const TEST_SUBJECT = "user-test";
const RADIO_STATION_UUID = "4f0b9a5c-1f0d-4d76-8d27-3b89b7cd1749";

async function createAdmissionHeaders(
  roomName: string,
  subject = TEST_SUBJECT,
  accessMode: "authenticated" | "public-demo" = "authenticated",
) {
  const ticket = await issueSocketTicket(
    {
      accessMode,
      audience: "voice",
      expiresAt: Date.now() + 60_000,
      nonce: crypto.randomUUID(),
      roomSlug: roomName,
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
): Promise<WebSocket> {
  const roomId = env.VOICE_ROOM.idFromName(roomName);
  const room = env.VOICE_ROOM.get(roomId);
  const response = await room.fetch(
    `https://internal/api/channels/${roomName}/voice?v=1`,
    {
      headers: await createAdmissionHeaders(roomName, subject, accessMode),
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

async function nextMessageWithOpcode(
  socket: WebSocket,
  opcode: number,
): Promise<{ op: number; d: unknown }> {
  while (true) {
    const message = await nextJsonMessage(socket);
    if (message.op === opcode) return message;
  }
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

async function identifyVoiceSocket(
  socket: WebSocket,
  participantId: string,
  roomName: string,
  subject = TEST_SUBJECT,
) {
  const response = nextJsonMessage(socket);
  socket.send(
    JSON.stringify({
      op: 100,
      d: {
        participant_id: participantId,
        voice_token: await issueVoiceToken(participantId, roomName, subject),
      },
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

  it.each([
    [
      "/api/soundboard/uploads/airhorn.mp3",
      "/api/soundboard/uploads/airhorn.mp3",
    ],
    [
      "https://www.myinstants.com/media/sounds/airhorn.mp3",
      "https://www.myinstants.com/media/sounds/airhorn.mp3",
    ],
  ])(
    "allows approved soundboard media URL: %s",
    async (mediaUrl, expectedMediaUrl) => {
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
        media_url: expectedMediaUrl,
        volume: 1,
        sent_at: expect.any(Number),
      });

      socket.close();
      listener.close();
    },
  );

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
            file_url: "/api/soundboard/uploads/airhorn.mp3",
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
        name: "Airhorn",
        file_url: "/api/soundboard/uploads/airhorn.mp3",
        emoji: "!",
        volume: 1,
      },
      sent_at: expect.any(Number),
    });
    socket.close();
    listener.close();
  });

  it("rejects oversized soundboard data URLs", async () => {
    const roomName = crypto.randomUUID();
    const socket = await openVoiceSocket(roomName);
    await identifyVoiceSocket(socket, crypto.randomUUID(), roomName);
    const oversizedDataUrl = `data:audio/wav;base64,${"A".repeat(700_000)}`;

    const response = nextMessageWithOpcode(socket, 18);
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
