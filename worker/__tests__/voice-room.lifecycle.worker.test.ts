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

async function mockCallsApi(
  roomName: string,
  handler: (request: Request) => Response | Promise<Response>,
) {
  const room = env.VOICE_ROOM.get(env.VOICE_ROOM.idFromName(roomName));
  await runInDurableObject(room, () => {
    globalThis.fetch = async (input, init) => handler(new Request(input, init));
  });
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

  it("rejects malformed select protocol payloads", async () => {
    const roomName = crypto.randomUUID();
    const socket = await openVoiceSocket(roomName);
    await identifyVoiceSocket(socket, crypto.randomUUID(), roomName);
    const response = nextMessageWithOpcode(socket, 18);

    socket.send(JSON.stringify({ op: 1, d: {} }));

    expect(await response).toMatchObject({
      op: 18,
      d: { code: 4000, message: "Invalid select protocol payload" },
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

  it("keeps negotiated tracks private until TracksReady promotes them", async () => {
    const roomName = crypto.randomUUID();
    let sessionNumber = 0;
    await mockCallsApi(roomName, async (request) => {
      const url = new URL(request.url);
      if (url.pathname.endsWith("/sessions/new")) {
        sessionNumber += 1;
        return Response.json({ sessionId: `session-${sessionNumber}` });
      }
      if (url.pathname.endsWith("/tracks/new")) {
        return Response.json({
          sessionDescription: { type: "answer", sdp: "answer-sdp" },
          tracks: [
            {
              location: "local",
              trackName: "cam-audio",
              mid: "0",
            },
          ],
        });
      }
      throw new Error(
        `Unexpected Calls request: ${request.method} ${request.url}`,
      );
    });

    const publisher = await openVoiceSocket(roomName);
    await identifyVoiceSocket(publisher, crypto.randomUUID(), roomName);
    const observer = await openVoiceSocket(roomName, "observer-user");
    await identifyVoiceSocket(
      observer,
      crypto.randomUUID(),
      roomName,
      "observer-user",
    );

    const description = nextMessageWithOpcode(publisher, 4);
    publisher.send(
      JSON.stringify({
        op: 1,
        d: {
          sdp: "offer-sdp",
          push_prefix: "cam",
          push_tracks: [{ track_name: "cam-audio", kind: "audio", mid: "0" }],
          pull_tracks: [],
          request_id: "push-1",
        },
      }),
    );
    expect(await description).toMatchObject({
      op: 4,
      d: {
        session_id: expect.any(String),
        tracks: [
          { track_name: "cam-audio", participant_id: expect.any(String) },
        ],
      },
    });

    expect(await hasMessageWithOpcode(observer, 12)).toBe(false);

    publisher.send(
      JSON.stringify({
        op: 102,
        d: { track_names: ["cam-audio"] },
      }),
    );
    expect(await nextMessageWithOpcode(observer, 12)).toMatchObject({
      op: 12,
      d: {
        tracks: [
          { track_name: "cam-audio", session_id: expect.any(String), mid: "0" },
        ],
      },
    });

    publisher.close();
    observer.close();
  });

  it("rejects a publisher track name already owned by another participant", async () => {
    const roomName = crypto.randomUUID();
    await mockCallsApi(roomName, async (request) => {
      const url = new URL(request.url);
      if (url.pathname.endsWith("/sessions/new")) {
        return Response.json({ sessionId: crypto.randomUUID() });
      }
      if (url.pathname.endsWith("/tracks/new")) {
        return Response.json({
          sessionDescription: { type: "answer", sdp: "answer-sdp" },
          tracks: [{ location: "local", trackName: "cam-audio", mid: "0" }],
        });
      }
      throw new Error(
        `Unexpected Calls request: ${request.method} ${request.url}`,
      );
    });

    const first = await openVoiceSocket(roomName);
    await identifyVoiceSocket(first, crypto.randomUUID(), roomName);
    const firstDescription = nextMessageWithOpcode(first, 4);
    first.send(
      JSON.stringify({
        op: 1,
        d: {
          sdp: "offer-sdp",
          push_prefix: "cam",
          push_tracks: [{ track_name: "cam-audio", kind: "audio", mid: "0" }],
          pull_tracks: [],
        },
      }),
    );
    await firstDescription;
    first.send(JSON.stringify({ op: 102, d: { track_names: ["cam-audio"] } }));
    await nextMessageWithOpcode(first, 10);

    const second = await openVoiceSocket(roomName, "second-user");
    await identifyVoiceSocket(
      second,
      crypto.randomUUID(),
      roomName,
      "second-user",
    );
    const conflict = nextMessageWithOpcode(second, 18);
    second.send(
      JSON.stringify({
        op: 1,
        d: {
          sdp: "offer-sdp",
          push_prefix: "cam",
          push_tracks: [{ track_name: "cam-audio", kind: "audio", mid: "0" }],
          pull_tracks: [],
        },
      }),
    );

    await expect(conflict).resolves.toMatchObject({
      op: 18,
      d: { code: 4000, message: "Track name is already in use" },
    });

    first.close();
    second.close();
  });

  it("drops an SFU negotiation that resumes on a superseded socket", async () => {
    const roomName = crypto.randomUUID();
    let releaseTracks: (() => void) | undefined;
    let tracksStarted: (() => void) | undefined;
    const tracksGate = new Promise<void>((resolve) => {
      releaseTracks = resolve;
    });
    const started = new Promise<void>((resolve) => {
      tracksStarted = resolve;
    });
    await mockCallsApi(roomName, async (request) => {
      const url = new URL(request.url);
      if (url.pathname.endsWith("/sessions/new")) {
        return Response.json({ sessionId: "delayed-session" });
      }
      if (url.pathname.endsWith("/tracks/new")) {
        tracksStarted?.();
        await tracksGate;
        return Response.json({
          sessionDescription: { type: "answer", sdp: "answer-sdp" },
          tracks: [{ location: "local", trackName: "cam-audio", mid: "0" }],
        });
      }
      throw new Error(
        `Unexpected Calls request: ${request.method} ${request.url}`,
      );
    });

    const participantId = crypto.randomUUID();
    const oldSocket = await openVoiceSocket(roomName);
    await identifyVoiceSocket(oldSocket, participantId, roomName);
    oldSocket.send(
      JSON.stringify({
        op: 1,
        d: {
          sdp: "offer-sdp",
          push_prefix: "cam",
          push_tracks: [{ track_name: "cam-audio", kind: "audio", mid: "0" }],
          pull_tracks: [],
        },
      }),
    );
    await started;

    const currentSocket = await openVoiceSocket(roomName);
    await identifyVoiceSocket(currentSocket, participantId, roomName);
    releaseTracks?.();

    expect(await hasMessageWithOpcode(oldSocket, 4, 150)).toBe(false);
    const room = env.VOICE_ROOM.get(env.VOICE_ROOM.idFromName(roomName));
    await runInDurableObject(room, async (_instance, state) => {
      const rows = [
        ...state.storage.sql.exec(
          "SELECT push_session_cam FROM participants WHERE id = ?",
          participantId,
        ),
      ];
      expect(rows[0]?.push_session_cam).toBeNull();
    });
  });

  it("rate-limits voice app events while preserving heartbeat acknowledgements", async () => {
    const roomName = crypto.randomUUID();
    const socket = await openVoiceSocket(roomName);
    await identifyVoiceSocket(socket, crypto.randomUUID(), roomName);

    const responses = [];
    for (let index = 0; index < 61; index += 1) {
      const response = nextMessageWithOpcode(socket, 18);
      socket.send(
        JSON.stringify({
          op: 106,
          d: { type: "unknown.rate-test-event" },
        }),
      );
      responses.push(await response);
    }
    expect(
      responses.some(
        (message) =>
          message.op === 18 && (message.d as { code?: number }).code === 4290,
      ),
    ).toBe(true);

    const heartbeat = nextJsonMessage(socket);
    socket.send(JSON.stringify({ op: 3, d: {} }));
    await expect(heartbeat).resolves.toMatchObject({ op: 6 });
    socket.close();
  });

  it("rejects pull tracks with cross-session identifiers", async () => {
    const roomName = crypto.randomUUID();
    let sessionNumber = 0;
    await mockCallsApi(roomName, async (request) => {
      const url = new URL(request.url);
      if (url.pathname.endsWith("/sessions/new")) {
        sessionNumber += 1;
        return Response.json({ sessionId: `session-${sessionNumber}` });
      }
      if (url.pathname.endsWith("/tracks/new")) {
        const body = (await request.json()) as {
          tracks?: unknown;
          sessionDescription?: { type?: string };
        };
        if (body.tracks && Array.isArray(body.tracks)) {
          const first = body.tracks[0] as Record<string, unknown> | undefined;
          if (first?.location === "remote") {
            return Response.json({
              sessionDescription: { type: "offer", sdp: "pull-offer" },
              tracks: [
                {
                  location: "remote",
                  trackName: "cam-audio",
                  sessionId: "session-2",
                  mid: "0",
                },
              ],
            });
          }
        }
        return Response.json({
          sessionDescription: { type: "answer", sdp: "push-answer" },
          tracks: [{ location: "local", trackName: "cam-audio", mid: "0" }],
        });
      }
      throw new Error(
        `Unexpected Calls request: ${request.method} ${request.url}`,
      );
    });

    const publisher = await openVoiceSocket(roomName);
    const publisherId = crypto.randomUUID();
    await identifyVoiceSocket(publisher, publisherId, roomName);
    const pushDescription = nextMessageWithOpcode(publisher, 4);
    publisher.send(
      JSON.stringify({
        op: 1,
        d: {
          sdp: "push-offer",
          push_prefix: "cam",
          push_tracks: [{ track_name: "cam-audio", kind: "audio", mid: "0" }],
          pull_tracks: [],
        },
      }),
    );
    await pushDescription;
    publisher.send(
      JSON.stringify({ op: 102, d: { track_names: ["cam-audio"] } }),
    );

    const viewer = await openVoiceSocket(roomName, "viewer-user");
    await identifyVoiceSocket(
      viewer,
      crypto.randomUUID(),
      roomName,
      "viewer-user",
    );
    const pullError = nextMessageWithOpcode(viewer, 18);
    viewer.send(
      JSON.stringify({
        op: 1,
        d: {
          sdp: "",
          push_tracks: [],
          pull_tracks: [
            {
              participant_id: "forged-participant",
              track_name: "cam-audio",
              session_id: "forged-session",
              kind: "audio",
            },
          ],
          request_id: "pull-1",
        },
      }),
    );

    expect(await pullError).toMatchObject({
      op: 18,
      d: { code: 4000, message: "Requested track is not available" },
    });

    publisher.close();
    viewer.close();
  });

  it.each([
    [
      "an unexpected track name",
      [
        {
          location: "remote",
          trackName: "unexpected",
          sessionId: "push-session",
          mid: "0",
        },
      ],
    ],
    [
      "a duplicate track",
      [
        {
          location: "remote",
          trackName: "cam-audio",
          sessionId: "push-session",
          mid: "0",
        },
        {
          location: "remote",
          trackName: "cam-audio",
          sessionId: "push-session",
          mid: "1",
        },
      ],
    ],
    [
      "a mismatched publisher session",
      [
        {
          location: "remote",
          trackName: "cam-audio",
          sessionId: "other-publisher-session",
          mid: "0",
        },
      ],
    ],
    [
      "a non-remote track",
      [
        {
          location: "local",
          trackName: "cam-audio",
          sessionId: "push-session",
          mid: "0",
        },
      ],
    ],
  ] as const)(
    "resets and closes pull sessions for %s",
    async (_kind, responseTracks) => {
      const roomName = crypto.randomUUID();
      const publisherId = crypto.randomUUID();
      const viewerId = crypto.randomUUID();
      const closeRequests: Array<{ body: unknown; url: string }> = [];
      let sessionNumber = 0;

      await mockCallsApi(roomName, async (request) => {
        const url = new URL(request.url);
        if (url.pathname.endsWith("/sessions/new")) {
          sessionNumber += 1;
          const sessionId =
            sessionNumber === 1 ? "push-session" : "pull-session";
          return Response.json({ sessionId });
        }
        if (url.pathname.endsWith("/tracks/close")) {
          closeRequests.push({ body: await request.json(), url: request.url });
          return Response.json({});
        }
        if (url.pathname.endsWith("/tracks/new")) {
          const body = (await request.json()) as {
            tracks?: Array<Record<string, unknown>>;
          };
          if (body.tracks?.[0]?.location === "remote") {
            return Response.json({
              sessionDescription: { type: "offer", sdp: "pull-offer" },
              tracks: responseTracks,
            });
          }
          return Response.json({
            sessionDescription: { type: "answer", sdp: "push-answer" },
            tracks: [{ location: "local", trackName: "cam-audio", mid: "0" }],
          });
        }
        throw new Error(
          `Unexpected Calls request: ${request.method} ${request.url}`,
        );
      });

      const publisher = await openVoiceSocket(roomName);
      await identifyVoiceSocket(publisher, publisherId, roomName);
      const pushDescription = nextMessageWithOpcode(publisher, 4);
      publisher.send(
        JSON.stringify({
          op: 1,
          d: {
            sdp: "push-offer",
            push_prefix: "cam",
            push_tracks: [{ track_name: "cam-audio", kind: "audio", mid: "0" }],
            pull_tracks: [],
          },
        }),
      );
      await pushDescription;
      publisher.send(
        JSON.stringify({ op: 102, d: { track_names: ["cam-audio"] } }),
      );
      await nextMessageWithOpcode(publisher, 10);

      const viewer = await openVoiceSocket(roomName, "viewer-user");
      await identifyVoiceSocket(viewer, viewerId, roomName, "viewer-user");
      const pullResponse = nextMessageWithOpcodeOrNull(viewer, 18);
      viewer.send(
        JSON.stringify({
          op: 1,
          d: {
            sdp: "",
            push_tracks: [],
            pull_tracks: [
              {
                participant_id: publisherId,
                track_name: "cam-audio",
                session_id: "push-session",
                kind: "audio",
              },
            ],
            request_id: "pull-invalid-response",
          },
        }),
      );

      await expect(pullResponse).resolves.toMatchObject({
        op: 18,
        d: {
          code: 0,
          message: "session-dead-reconnect",
          operation: "pull",
          request_id: "pull-invalid-response",
        },
      });
      expect(closeRequests).toHaveLength(1);
      expect(closeRequests[0]).toMatchObject({
        url: expect.stringContaining("/sessions/pull-session/tracks/close"),
        body: {
          tracks: Array.from(
            new Set(responseTracks.map((track) => track.mid)),
          ).map((mid) => ({ mid })),
          force: true,
        },
      });

      const room = env.VOICE_ROOM.get(env.VOICE_ROOM.idFromName(roomName));
      await runInDurableObject(room, (_instance, state) => {
        const row = [
          ...state.storage.sql.exec(
            "SELECT pull_session_id FROM participants WHERE id = ?",
            viewerId,
          ),
        ][0];
        expect(row?.pull_session_id).toBeNull();
      });

      publisher.close();
      viewer.close();
    },
  );

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

  it("ignores stale authenticated state and broadcast opcodes after reconnect", async () => {
    const roomName = crypto.randomUUID();
    const participantId = crypto.randomUUID();
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

    const room = env.VOICE_ROOM.get(env.VOICE_ROOM.idFromName(roomName));
    await runInDurableObject(room, (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE participants SET pull_session_id = ? WHERE id = ?",
        "current-pull",
        participantId,
      );
      state.storage.sql.exec(
        "INSERT INTO tracks (track_name, participant_id, session_id, mid, kind, is_pending) VALUES (?, ?, ?, ?, ?, 1)",
        "stale-track",
        participantId,
        "current-push",
        "0",
        "audio",
      );
    });

    const staleHeartbeat = hasMessageWithOpcode(oldSocket, 6, 150);
    oldSocket.send(JSON.stringify({ op: 3, d: {} }));
    await expect(staleHeartbeat).resolves.toBe(false);

    oldSocket.send(JSON.stringify({ op: 105, d: {} }));
    oldSocket.send(
      JSON.stringify({ op: 102, d: { track_names: ["stale-track"] } }),
    );
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

    await expect(hasMessageWithOpcode(observer, 106, 150)).resolves.toBe(false);
    await runInDurableObject(room, (_instance, state) => {
      const participant = [
        ...state.storage.sql.exec(
          "SELECT pull_session_id FROM participants WHERE id = ?",
          participantId,
        ),
      ][0];
      const track = [
        ...state.storage.sql.exec(
          "SELECT is_pending FROM tracks WHERE track_name = ?",
          "stale-track",
        ),
      ][0];
      expect(participant?.pull_session_id).toBe("current-pull");
      expect(track?.is_pending).toBe(1);
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
