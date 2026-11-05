import { env } from "cloudflare:workers";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import {
  GatewayOp,
  HEARTBEAT_FRAME,
  mainGatewayClientRules,
  voiceGatewayClientRules,
} from "../../src/lib/gateway-protocol";
import {
  appendRealtimeAdmissionHeaders,
  createRealtimeAdmissionContext,
  type RealtimeAdmissionContext,
} from "../realtime-admission";
import {
  broadcastToIdentified,
  isSilent,
  MAX_SOCKET_FRAME_BYTES,
  readSocketFrame,
  silentAt,
  SOCKET_HEARTBEAT_INTERVAL_MS,
  SOCKET_PROTOCOL_NAME,
  SOCKET_ROLE_OPCODES,
  SOCKET_ZOMBIE_TIMEOUT_MS,
  SocketRateLimiter,
  type SocketRole,
} from "../socket-core";

// ── Helpers ────────────────────────────────────────────────────────────────

const GLOBAL_SLUG = "global-gateway";

interface Frame {
  op: number;
  d: unknown;
}

function admission(
  audience: SocketRole,
  roomSlug: string,
  subject = "user-core",
): Promise<RealtimeAdmissionContext> {
  return createRealtimeAdmissionContext({
    accessMode: "authenticated",
    audience,
    expiresAt: Date.now() + 60_000,
    nonce: crypto.randomUUID(),
    roomSlug,
    subject,
  });
}

/** The object a role's sockets live in, and the path the worker forwards. */
function target(role: SocketRole, objectName: string, roomSlug: string) {
  if (role === "voice") {
    return {
      stub: env.VOICE_ROOM.get(env.VOICE_ROOM.idFromName(objectName)),
      url: `https://internal/api/channels/${roomSlug}/voice?v=1`,
    };
  }
  return {
    stub: env.MEETING_ROOM.get(env.MEETING_ROOM.idFromName(objectName)),
    url:
      role === "global"
        ? "https://internal/api/gateway?v=1"
        : `https://internal/api/channels/${roomSlug}/ws?v=1`,
  };
}

function upgrade(
  role: SocketRole,
  objectName: string,
  context: RealtimeAdmissionContext | null,
  version = 1,
) {
  const roomSlug = role === "global" ? GLOBAL_SLUG : objectName;
  const { stub, url } = target(role, objectName, roomSlug);
  const headers = new Headers({ Upgrade: "websocket" });
  return stub.fetch(url.replace("?v=1", `?v=${version}`), {
    headers: context
      ? appendRealtimeAdmissionHeaders(headers, context)
      : headers,
  });
}

function nextFrame(socket: WebSocket): Promise<Frame> {
  return new Promise((resolve) => {
    socket.addEventListener(
      "message",
      (event) => resolve(JSON.parse(event.data as string) as Frame),
      { once: true },
    );
  });
}

async function nextFrameWithOp(socket: WebSocket, op: number) {
  while (true) {
    const frame = await nextFrame(socket);
    if (frame.op === op) return frame;
  }
}

/** Accepts the socket and waits for Hello. */
async function openSocket(
  role: SocketRole,
  objectName = crypto.randomUUID(),
  subject = "user-core",
) {
  const roomSlug = role === "global" ? GLOBAL_SLUG : objectName;
  const response = await upgrade(
    role,
    objectName,
    await admission(role, roomSlug, subject),
  );
  expect(response.status).toBe(101);
  const socket = response.webSocket;
  if (!socket) throw new Error("Expected a WebSocket upgrade");
  const hello = nextFrameWithOp(socket, GatewayOp.Hello);
  socket.accept();
  await hello;
  return socket;
}

async function identifyMain(socket: WebSocket) {
  const ready = nextFrameWithOp(socket, GatewayOp.Ready);
  socket.send(
    JSON.stringify({ op: GatewayOp.Identify, d: { name: "Core User" } }),
  );
  return (await ready).d as { participant_id: string; voice_token: string };
}

function errorFrame(code: number, message: string): Frame {
  return { op: GatewayOp.Error, d: { code, message } };
}

const ROLES: readonly SocketRole[] = ["global", "room", "voice"];

// ── Opcode tables ──────────────────────────────────────────────────────────
// What each released client sends on each socket (SOCKET_CORE.md has the
// sources). A table that drops one of these breaks that client.

const CLIENT_SENDS = {
  // src/stores/chat-gateway.ts, room-gateway.ts, sfu-client.ts,
  // voice-gateway.ts, native-screen-share-transport.ts (v3.0.0 → main).
  web: {
    global: [0, 3, 7, 15, 26, 27, 28, 33, 34, 35, 36, 37, 38, 39],
    room: [0, 3, 7, 11, 15, 17, 40],
    voice: [100, 3, 1, 5, 11, 12, 13, 102, 106, 109],
  },
  // apps/mobile (mobile-v0.1.0 → main).
  mobile: {
    global: [0, 3, 15, 26, 27, 28, 33, 34, 35, 36, 39],
    room: [0, 3, 7, 11, 15, 40],
    voice: [100, 3, 5, 11, 12, 13, 106, 109],
  },
  // desktop-native/VOICE_PROTOCOL.md (spike/qt-desktop).
  native: {
    global: [0, 3, 33, 34],
    room: [0, 3, 7, 11, 15, 17, 40],
    voice: [100, 3, 1, 5, 11, 12, 13, 102, 106, 109],
  },
} satisfies Record<string, Record<SocketRole, readonly number[]>>;

describe("socket role opcode tables", () => {
  it.each(Object.keys(CLIENT_SENDS) as Array<keyof typeof CLIENT_SENDS>)(
    "accepts every opcode the %s client sends on each socket",
    (client) => {
      for (const role of ROLES) {
        const missing = CLIENT_SENDS[client][role].filter(
          (op) => !SOCKET_ROLE_OPCODES[role].has(op),
        );
        expect({ client, role, missing }).toEqual({
          client,
          role,
          missing: [],
        });
      }
    },
  );

  it("splits the main gateway decoder between the global and room roles", () => {
    const main = Object.keys(mainGatewayClientRules).map(Number);
    const union = new Set([
      ...SOCKET_ROLE_OPCODES.global,
      ...SOCKET_ROLE_OPCODES.room,
    ]);
    expect([...union].sort((a, b) => a - b)).toEqual(
      main.sort((a, b) => a - b),
    );
  });

  it("gives the voice role exactly the voice decoder's opcodes", () => {
    expect([...SOCKET_ROLE_OPCODES.voice].sort((a, b) => a - b)).toEqual(
      Object.keys(voiceGatewayClientRules)
        .map(Number)
        .sort((a, b) => a - b),
    );
  });

  // Room-only and global-only opcodes, each sent on the other role with a
  // payload that would pass its decoder.
  const GLOBAL_ONLY: Array<[number, unknown]> = [
    [GatewayOp.MessageCreate, { channel_id: "c", content: "hi" }],
    [
      GatewayOp.MessageUpdate,
      { message_id: "m", channel_id: "c", content: "x" },
    ],
    [GatewayOp.MessageDelete, { message_id: "m", channel_id: "c" }],
    [GatewayOp.TypingStart, { channel_id: "c" }],
    [GatewayOp.ReactionAdd, { channel_id: "c", message_id: "m", emoji: "👍" }],
    [
      GatewayOp.ReactionRemove,
      { channel_id: "c", message_id: "m", emoji: "👍" },
    ],
    [GatewayOp.PresenceUpdate, { status: "dnd" }],
    [GatewayOp.ChannelSubscribe, { channel_id: "c" }],
    [GatewayOp.ChannelUnsubscribe, { channel_id: "c" }],
    [GatewayOp.VoiceChannelJoin, { channel_id: "c" }],
    [GatewayOp.VoiceChannelLeave, {}],
    [GatewayOp.ServerSubscribe, { server_id: "s" }],
    [GatewayOp.CallInitiate, { target_user_id: "u", channel_id: "c" }],
    [GatewayOp.CallAccept, { call_id: "call" }],
    [GatewayOp.CallDecline, { call_id: "call" }],
    [GatewayOp.CallEnd, { call_id: "call" }],
  ];

  it("lists the global-only opcodes this suite sends", () => {
    const globalOnly = [...SOCKET_ROLE_OPCODES.global].filter(
      (op) => !SOCKET_ROLE_OPCODES.room.has(op),
    );
    expect(GLOBAL_ONLY.map(([op]) => op).sort((a, b) => a - b)).toEqual(
      globalOnly.sort((a, b) => a - b),
    );
  });

  it.each(GLOBAL_ONLY)(
    "answers global-only opcode %s on a room socket as unknown, changing nothing",
    async (op, d) => {
      const objectName = crypto.randomUUID();
      const socket = await openSocket("room", objectName);
      await identifyMain(socket);
      const stub = env.MEETING_ROOM.get(
        env.MEETING_ROOM.idFromName(objectName),
      );
      const state = () =>
        runInDurableObject(stub, (instance) => {
          const live = instance as unknown as {
            sessions: Map<unknown, Record<string, unknown>>;
            channelSubscriptions: Map<string, unknown>;
            serverSubscriptions: Map<string, unknown>;
            pendingCalls: Map<string, unknown>;
          };
          return JSON.stringify({
            sessions: [...live.sessions.values()].map(
              ({ last_heartbeat: _h, seq: _s, ...rest }) => rest,
            ),
            channels: [...live.channelSubscriptions.keys()],
            servers: [...live.serverSubscriptions.keys()],
            calls: [...live.pendingCalls.keys()],
          });
        });
      const before = await state();

      const reply = nextFrameWithOp(socket, GatewayOp.Error);
      socket.send(JSON.stringify({ op, d }));
      expect(await reply).toEqual(errorFrame(4001, `Unknown opcode: ${op}`));
      expect(await state()).toBe(before);
      socket.close();
    },
  );

  it("answers RefreshVoiceCredentials on the global socket as unknown", async () => {
    const socket = await openSocket("global");
    await identifyMain(socket);
    const reply = nextFrameWithOp(socket, GatewayOp.Error);
    socket.send(
      JSON.stringify({ op: GatewayOp.RefreshVoiceCredentials, d: {} }),
    );
    expect(await reply).toEqual(errorFrame(4001, "Unknown opcode: 40"));
    socket.close();
  });

  it("still refreshes voice credentials on the room socket", async () => {
    const socket = await openSocket("room");
    await identifyMain(socket);
    const resumed = nextFrameWithOp(socket, GatewayOp.Resumed);
    socket.send(
      JSON.stringify({ op: GatewayOp.RefreshVoiceCredentials, d: {} }),
    );
    expect((await resumed).d).toMatchObject({
      voice_token: expect.any(String),
    });
    socket.close();
  });

  it("refuses promote_standby on the global socket and keeps the rest of op 15", async () => {
    const socket = await openSocket("global");
    await identifyMain(socket);

    const refused = nextFrameWithOp(socket, GatewayOp.Error);
    socket.send(
      JSON.stringify({
        op: GatewayOp.VoiceStateUpdate,
        d: { promote_standby: true, self_mute: false },
      }),
    );
    expect(await refused).toEqual(
      errorFrame(4000, "promote_standby is not accepted on the global socket"),
    );

    // Without it, op 15 is processed: no Error before the heartbeat ACK.
    const seen: number[] = [];
    const record = (event: MessageEvent) => {
      seen.push((JSON.parse(event.data as string) as Frame).op);
    };
    socket.addEventListener("message", record);
    const ack = nextFrameWithOp(socket, GatewayOp.HeartbeatACK);
    socket.send(
      JSON.stringify({
        op: GatewayOp.VoiceStateUpdate,
        d: { promote_standby: false, self_mute: false },
      }),
    );
    socket.send(HEARTBEAT_FRAME);
    await ack;
    socket.removeEventListener("message", record);
    expect(seen).not.toContain(GatewayOp.Error);
    socket.close();
  });

  it.each([
    ["global", GatewayOp.VoiceIdentify, "Unknown opcode: 100"],
    ["room", GatewayOp.Video, "Unknown opcode: 12"],
    ["voice", GatewayOp.Identify, "Unknown voice opcode: 0"],
    ["voice", GatewayOp.VoiceChannelJoin, "Unknown voice opcode: 33"],
    ["voice", GatewayOp.RefreshVoiceCredentials, "Unknown voice opcode: 40"],
    ["voice", GatewayOp.CallInitiate, "Unknown voice opcode: 36"],
    ["global", 999, "Unknown opcode: 999"],
    ["room", 999, "Unknown opcode: 999"],
    ["voice", 999, "Unknown voice opcode: 999"],
  ] as const)(
    "on the %s socket answers opcode %s with the unknown-opcode error",
    async (role, op, message) => {
      const socket = await openSocket(role);
      const reply = nextFrameWithOp(socket, GatewayOp.Error);
      socket.send(JSON.stringify({ op, d: {} }));
      expect(await reply).toEqual(errorFrame(4001, message));
      socket.close();
    },
  );
});

// ── Admission ──────────────────────────────────────────────────────────────

describe("socket admission", () => {
  it.each(ROLES)(
    "accepts a %s ticket once, with the realtime subprotocol and Hello",
    async (role) => {
      const objectName = crypto.randomUUID();
      const roomSlug = role === "global" ? GLOBAL_SLUG : objectName;
      const context = await admission(role, roomSlug);

      const first = await upgrade(role, objectName, context, 3);
      expect(first.status).toBe(101);
      expect(first.headers.get("Sec-WebSocket-Protocol")).toBe(
        SOCKET_PROTOCOL_NAME,
      );
      const socket = first.webSocket!;
      const hello = nextFrame(socket);
      socket.accept();
      expect(await hello).toEqual({
        op: GatewayOp.Hello,
        d: {
          heartbeat_interval: SOCKET_HEARTBEAT_INTERVAL_MS,
          gateway_version: 3,
        },
      });

      const replay = await upgrade(role, objectName, context);
      expect(replay.status).toBe(401);
      socket.close();
    },
  );

  it.each(ROLES)("refuses a %s upgrade without admission", async (role) => {
    const response = await upgrade(role, crypto.randomUUID(), null);
    expect(response.status).toBe(401);
  });

  it("refuses a ticket for another audience without spending its nonce there", async () => {
    const objectName = crypto.randomUUID();
    const voiceTicket = await admission("voice", objectName);

    // A voice ticket presented to the room socket of the same channel...
    const misdirected = await upgrade("room", objectName, voiceTicket);
    expect(misdirected.status).toBe(401);
    const spentInRoom = await runInDurableObject(
      env.MEETING_ROOM.get(env.MEETING_ROOM.idFromName(objectName)),
      (_i, state) =>
        [
          ...state.storage.sql.exec(
            "SELECT 1 FROM realtime_ticket_nonce_uses WHERE nonce_digest = ?",
            voiceTicket.nonceDigest,
          ),
        ].length,
    );
    expect(spentInRoom).toBe(0);

    // ...still opens the voice socket it was issued for.
    const intended = await upgrade("voice", objectName, voiceTicket);
    expect(intended.status).toBe(101);
    intended.webSocket?.accept();
    intended.webSocket?.close();
  });

  it("refuses a ticket for another room", async () => {
    const response = await upgrade(
      "room",
      crypto.randomUUID(),
      await admission("room", crypto.randomUUID()),
    );
    expect(response.status).toBe(401);
  });
});

// ── Frame preamble ─────────────────────────────────────────────────────────

describe("socket frame preamble", () => {
  it("reads a JSON frame and refuses binary, oversized and non-JSON ones", () => {
    expect(readSocketFrame('{"op":3}')).toEqual({
      ok: true,
      frame: { op: 3, d: undefined },
    });
    expect(readSocketFrame(new ArrayBuffer(4))).toEqual({
      ok: false,
      error: errorFrame(4000, "Text websocket frames are required"),
    });
    expect(readSocketFrame("x".repeat(MAX_SOCKET_FRAME_BYTES + 1))).toEqual({
      ok: false,
      error: errorFrame(4000, "Websocket frame is too large"),
    });
    // Under the cap in UTF-16 code units, over it in UTF-8 bytes.
    const multibyte = "€".repeat(Math.ceil(MAX_SOCKET_FRAME_BYTES / 3) + 1);
    expect(multibyte.length).toBeLessThan(MAX_SOCKET_FRAME_BYTES);
    expect(readSocketFrame(multibyte)).toEqual({
      ok: false,
      error: errorFrame(4000, "Websocket frame is too large"),
    });
    expect(readSocketFrame("not-json")).toEqual({
      ok: false,
      error: errorFrame(4002, "Invalid JSON"),
    });
    expect(readSocketFrame("[]")).toEqual({
      ok: false,
      error: errorFrame(4001, "Missing opcode"),
    });
  });

  it.each(ROLES)(
    "answers binary and oversized frames on the %s socket",
    async (role) => {
      const socket = await openSocket(role);

      const binary = nextFrameWithOp(socket, GatewayOp.Error);
      socket.send(new Uint8Array([1, 2, 3]));
      expect(await binary).toEqual(
        errorFrame(4000, "Text websocket frames are required"),
      );

      const oversized = nextFrameWithOp(socket, GatewayOp.Error);
      socket.send(
        JSON.stringify({ op: 3, d: "x".repeat(MAX_SOCKET_FRAME_BYTES) }),
      );
      expect(await oversized).toEqual(
        errorFrame(4000, "Websocket frame is too large"),
      );

      // The socket stays usable.
      const ack = nextFrameWithOp(socket, GatewayOp.HeartbeatACK);
      socket.send(HEARTBEAT_FRAME);
      await ack;
      socket.close();
    },
  );
});

// ── Rate limiting ──────────────────────────────────────────────────────────

describe("SocketRateLimiter", () => {
  it("counts per session and per subject in a fixed window", async () => {
    const stub = env.VOICE_ROOM.get(
      env.VOICE_ROOM.idFromName(crypto.randomUUID()),
    );
    await runInDurableObject(stub, (_instance, state) => {
      const limiter = new SocketRateLimiter(
        state.storage.sql,
        { 50: 2 },
        1_000,
      );
      const t0 = 1_000_000;

      // Unlimited opcodes are never counted.
      for (let i = 0; i < 10; i += 1) {
        expect(limiter.isLimited(51, "s1", "u1", t0)).toBe(false);
      }

      expect(limiter.isLimited(50, "s1", "u1", t0)).toBe(false);
      expect(limiter.isLimited(50, "s1", "u1", t0 + 1)).toBe(false);
      expect(limiter.isLimited(50, "s1", "u1", t0 + 2)).toBe(true);

      // Another session of the same subject shares the subject's budget.
      expect(limiter.isLimited(50, "s2", "u1", t0 + 3)).toBe(true);
      // Another subject has its own.
      expect(limiter.isLimited(50, "s3", "u2", t0 + 3)).toBe(false);

      // A new window starts the count again.
      expect(limiter.isLimited(50, "s1", "u1", t0 + 1_000)).toBe(false);
    });
  });

  it("answers an over-limit opcode with RateLimited on the voice socket", async () => {
    const socket = await openSocket("voice");
    // TracksReady: 60 a minute. Unidentified, each is refused with
    // NotAuthenticated until the limit, then RateLimited.
    const codes: number[] = [];
    for (let i = 0; i < 61; i += 1) {
      const reply = nextFrameWithOp(socket, GatewayOp.Error);
      socket.send(
        JSON.stringify({
          op: GatewayOp.TracksReady,
          d: { track_names: ["screen-video-x"] },
        }),
      );
      codes.push(((await reply).d as { code: number }).code);
    }
    expect(codes.at(-1)).toBe(4290);
    expect(codes.slice(0, 60)).not.toContain(4290);
    socket.close();
  });
});

// ── Broadcast ──────────────────────────────────────────────────────────────

describe("broadcastToIdentified", () => {
  it("sends one serialized frame to identified sockets only", () => {
    const sent = new Map<string, string[]>();
    const fake = (name: string, fails = false) =>
      ({
        name,
        send(data: string) {
          if (fails) throw new Error("closed");
          sent.set(name, [...(sent.get(name) ?? []), data]);
        },
      }) as unknown as WebSocket & { name: string };
    const a = fake("a");
    const b = fake("b");
    const lurker = fake("lurker");
    const closed = fake("closed", true);
    const identified = new Set<WebSocket>([a, b, closed]);

    broadcastToIdentified(
      [a, b, lurker, closed],
      { op: GatewayOp.Speaking, d: { speaking: 1 } },
      (ws) => identified.has(ws),
      b,
    );

    expect(Object.fromEntries(sent)).toEqual({
      a: ['{"op":5,"d":{"speaking":1}}'],
    });
  });
});

// ── Liveness ───────────────────────────────────────────────────────────────

describe("socket liveness", () => {
  it("goes silent after the zombie timeout", () => {
    const t = 5_000_000;
    expect(isSilent(undefined, t)).toBe(false);
    expect(isSilent(0, t)).toBe(false);
    expect(isSilent(t - SOCKET_ZOMBIE_TIMEOUT_MS + 1, t)).toBe(false);
    expect(isSilent(t - SOCKET_ZOMBIE_TIMEOUT_MS, t)).toBe(true);
    expect(silentAt(t)).toBe(t + SOCKET_ZOMBIE_TIMEOUT_MS);
  });

  it("keeps an unidentified voice socket's clock in its attachment, so a woken alarm closes it", async () => {
    const objectName = crypto.randomUUID();
    const socket = await openSocket("voice", objectName);
    const closed = new Promise<CloseEvent>((resolve) => {
      socket.addEventListener("close", resolve, { once: true });
    });
    const stub = env.VOICE_ROOM.get(env.VOICE_ROOM.idFromName(objectName));

    // A heartbeat moves the clock in the serialized attachment.
    const before = await runInDurableObject(stub, (_i, state) => {
      const [ws] = state.getWebSockets();
      const attachment = ws.deserializeAttachment() as {
        last_seen_at: number;
      };
      ws.serializeAttachment({ ...attachment, last_seen_at: 1 });
      return attachment.last_seen_at;
    });
    expect(before).toBeGreaterThan(1);
    const ack = nextFrameWithOp(socket, GatewayOp.HeartbeatACK);
    socket.send(HEARTBEAT_FRAME);
    await ack;
    const afterBeat = await runInDurableObject(stub, (_i, state) => {
      const [ws] = state.getWebSockets();
      return (ws.deserializeAttachment() as { last_seen_at: number })
        .last_seen_at;
    });
    expect(afterBeat).toBeGreaterThan(1);

    // The attachment alone (no in-memory state) decides the timeout.
    await runInDurableObject(stub, (_i, state) => {
      const [ws] = state.getWebSockets();
      const attachment = ws.deserializeAttachment() as Record<string, unknown>;
      ws.serializeAttachment({
        ...attachment,
        last_seen_at: Date.now() - SOCKET_ZOMBIE_TIMEOUT_MS,
      });
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    await expect(closed).resolves.toMatchObject({ code: 4009 });
  });

  it("keeps an identified main session's clock in its attachment", async () => {
    const objectName = crypto.randomUUID();
    const socket = await openSocket("room", objectName);
    await identifyMain(socket);
    const stub = env.MEETING_ROOM.get(env.MEETING_ROOM.idFromName(objectName));
    const read = () =>
      runInDurableObject(stub, (_i, state) => {
        const [ws] = state.getWebSockets();
        return (ws.deserializeAttachment() as { last_heartbeat: number })
          .last_heartbeat;
      });
    const identifiedAt = await read();
    expect(identifiedAt).toBeGreaterThan(0);

    await new Promise((resolve) => setTimeout(resolve, 5));
    const ack = nextFrameWithOp(socket, GatewayOp.HeartbeatACK);
    socket.send(HEARTBEAT_FRAME);
    await ack;
    expect(await read()).toBeGreaterThan(identifiedAt);
    socket.close();
  });
});
