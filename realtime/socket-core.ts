// ============================================================================
// Socket core: the WebSocket plumbing MeetingRoom and VoiceRoom share.
//
// One Durable Object class serves each socket role:
//
// - global: MeetingRoom named "global-gateway" (/api/gateway). Chat,
//   presence, subscriptions, DM calls, the voice channel sidebar.
// - room:   MeetingRoom named after a channel (/api/channels/:slug/ws). The
//   voice session: Identify, roster, mute state, voice credentials.
// - voice:  VoiceRoom (/api/channels/:slug/voice). Media metadata, speaking,
//   app events.
//
// This module owns what every role does the same way: admission (the ticket
// the worker verified → the socket's attachment), single-use nonces, accept
// and Hello, the frame preamble (text only, size cap, JSON), the per-role
// opcode table, per-opcode rate limits, sends and identified-only
// broadcasts, and the liveness clock. Each Durable Object keeps its own
// session state and handlers. SOCKET_CORE.md lists the opcode tables and the
// evidence they were built from; keep the two in step.
//
// Hibernation: nothing here keeps per-socket state in memory. A socket's
// admission and last-heard time live in its serialized attachment, so a
// woken object reads them back from the socket.
// ============================================================================

import {
  GatewayCloseCode as CloseCode,
  GatewayOp as Op,
  parseGatewayFrame,
  type GatewayFrame,
} from "../src/lib/gateway-protocol";
import {
  SOCKET_PROTOCOL_NAME,
  type SocketTicketAudience,
} from "../src/lib/voice/socket-ticket";
import {
  consumeRealtimeTicketNonce,
  getRealtimeAdmissionFromHeaders,
  type RealtimeAdmissionContext,
} from "./realtime-admission";

export { SOCKET_PROTOCOL_NAME };

/** A socket's role is its ticket's audience. */
export type SocketRole = SocketTicketAudience;

/** An outbound frame. */
export interface ServerFrame {
  op: number;
  d: unknown;
}

// ── Constants ───────────────────────────────────────────────────────────────

/** Sent in Hello; clients heartbeat at this interval. */
export const SOCKET_HEARTBEAT_INTERVAL_MS = 15_000;
/**
 * 90 s, six missed heartbeats. Chrome throttles timers in a tab hidden for
 * 5+ minutes to one wake-up a minute, so its 15 s heartbeat arrives ~60 s
 * apart; three beats (45 s) evicted every background tab. Still under
 * Cloudflare's ~100 s idle-socket close, which the 60 s beats keep open.
 */
export const SOCKET_ZOMBIE_TIMEOUT_MS = SOCKET_HEARTBEAT_INTERVAL_MS * 6;
/** Largest text frame a socket accepts, in UTF-8 bytes. */
export const MAX_SOCKET_FRAME_BYTES = 1_000_000;
/** Rate limit window for every per-opcode limit. */
export const SOCKET_RATE_LIMIT_WINDOW_MS = 60_000;

// ── Opcode tables ───────────────────────────────────────────────────────────
// Client → server opcodes each role accepts. An opcode outside its socket's
// table gets the same Error frame as an opcode no role knows (4001). The
// payload decoders (client-payloads.ts) still check each payload; these
// tables only say which socket an opcode belongs on. Evidence for every
// entry: SOCKET_CORE.md.

const GLOBAL_OPCODES = [
  Op.Identify,
  Op.Heartbeat,
  Op.Resume,
  Op.ClientDisconnect,
  Op.VoiceStateUpdate,
  Op.ProfileRefresh,
  Op.MessageCreate,
  Op.MessageUpdate,
  Op.MessageDelete,
  Op.TypingStart,
  Op.ReactionAdd,
  Op.ReactionRemove,
  Op.PresenceUpdate,
  Op.ChannelSubscribe,
  Op.ChannelUnsubscribe,
  Op.VoiceChannelJoin,
  Op.VoiceChannelLeave,
  Op.ServerSubscribe,
  Op.CallInitiate,
  Op.CallAccept,
  Op.CallDecline,
  Op.CallEnd,
] as const;

const ROOM_OPCODES = [
  Op.Identify,
  Op.Heartbeat,
  Op.Resume,
  Op.ClientDisconnect,
  Op.VoiceStateUpdate,
  Op.ProfileRefresh,
  Op.RefreshVoiceCredentials,
] as const;

const VOICE_OPCODES = [
  Op.VoiceIdentify,
  Op.Heartbeat,
  Op.SelectProtocol,
  Op.Video,
  Op.StopTracks,
  Op.TracksReady,
  Op.Speaking,
  Op.ClientDisconnect,
  Op.VoiceAppEvent,
  Op.TrackUnavailable,
] as const;

export const SOCKET_ROLE_OPCODES: Readonly<
  Record<SocketRole, ReadonlySet<number>>
> = {
  global: new Set<number>(GLOBAL_OPCODES),
  room: new Set<number>(ROOM_OPCODES),
  voice: new Set<number>(VOICE_OPCODES),
};

/**
 * Payload fields one role refuses on an opcode it otherwise accepts. Op 15
 * is on both MeetingRoom roles, but only the room has standby sessions to
 * promote.
 */
export const SOCKET_ROLE_REFUSED_FIELDS: Readonly<
  Record<SocketRole, Readonly<Partial<Record<number, readonly string[]>>>>
> = {
  global: { [Op.VoiceStateUpdate]: ["promote_standby"] },
  room: {},
  voice: {},
};

const UNKNOWN_OPCODE_MESSAGE: Readonly<Record<SocketRole, string>> = {
  global: "Unknown opcode",
  room: "Unknown opcode",
  voice: "Unknown voice opcode",
};

export function isOpcodeAllowed(role: SocketRole, op: number): boolean {
  return SOCKET_ROLE_OPCODES[role].has(op);
}

/** The Error frame for an opcode outside the socket's table. */
export function unknownOpcodeError(role: SocketRole, op: number): ServerFrame {
  return {
    op: Op.Error,
    d: {
      code: CloseCode.UnknownOpcode,
      message: `${UNKNOWN_OPCODE_MESSAGE[role]}: ${op}`,
    },
  };
}

/**
 * The Error frame for a payload that sets a field its role refuses (see
 * SOCKET_ROLE_REFUSED_FIELDS), or null. Only a field present with a value
 * other than false/undefined counts.
 */
export function refusedFieldError(
  role: SocketRole,
  frame: GatewayFrame,
): ServerFrame | null {
  const refused = SOCKET_ROLE_REFUSED_FIELDS[role][frame.op];
  if (!refused || !frame.d || typeof frame.d !== "object") return null;
  const payload = frame.d as Record<string, unknown>;
  const field = refused.find(
    (name) => payload[name] !== undefined && payload[name] !== false,
  );
  if (!field) return null;
  return {
    op: Op.Error,
    d: {
      code: CloseCode.InvalidPayload,
      message: `${field} is not accepted on the ${role} socket`,
    },
  };
}

// ── Admission ───────────────────────────────────────────────────────────────

export type SocketAdmissionResult =
  | { ok: true; admission: RealtimeAdmissionContext }
  | {
      ok: false;
      reason:
        | "missing"
        | "wrong_audience"
        | "wrong_room"
        | "expired"
        | "replayed"
        | "storage_error";
    };

/** The SQL surface the core needs (a Durable Object's `storage.sql`). */
export interface SocketSql {
  exec(
    query: string,
    ...bindings: unknown[]
  ): Iterable<Record<string, unknown>>;
}

/**
 * Checks the admission the worker attached to an upgrade (it verified the
 * ticket's HMAC) against this object, then spends the ticket's nonce. The
 * nonce is spent only when the audience and room match, so a ticket sent to
 * the wrong object can still be used where it belongs.
 */
export function admitSocket(
  headers: Headers,
  sql: SocketSql,
  expected: { audience: SocketRole; roomSlug: string },
): SocketAdmissionResult {
  const admission = getRealtimeAdmissionFromHeaders(headers);
  if (!admission) return { ok: false, reason: "missing" };
  if (admission.audience !== expected.audience) {
    return { ok: false, reason: "wrong_audience" };
  }
  if (admission.roomSlug !== expected.roomSlug) {
    return { ok: false, reason: "wrong_room" };
  }
  // Single use: the ticket's nonce is spent here, in the object that accepts
  // the socket (custom-server-entry.ts verified its signature).
  const consumed = consumeRealtimeTicketNonce(sql, admission);
  if (!consumed.ok) return { ok: false, reason: consumed.reason };
  return { ok: true, admission };
}

/**
 * Whether a refusal came from spending the nonce (worth a log line) rather
 * than from a ticket meant for another object.
 */
export function isSpentTicketReason(
  reason: Extract<SocketAdmissionResult, { ok: false }>["reason"],
): boolean {
  return (
    reason === "expired" || reason === "replayed" || reason === "storage_error"
  );
}

/** The reply to a refused upgrade, whatever the reason. */
export function unauthorizedUpgrade(): Response {
  return new Response("Unauthorized", { status: 401 });
}

/**
 * Accepts the upgrade under the Hibernation API: stores `attachment` on the
 * socket, sends Hello, and returns the 101 response with the realtime
 * subprotocol.
 */
export interface AcceptedSocket {
  /** The 101 response to return from fetch. */
  response: Response;
  /** The server end, accepted and attached. */
  socket: WebSocket;
}

export function acceptSocket(
  ctx: DurableObjectState<unknown>,
  attachment: unknown,
  gatewayVersion: number,
): AcceptedSocket {
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);
  ctx.acceptWebSocket(server);
  server.serializeAttachment(attachment);
  sendFrame(server, {
    op: Op.Hello,
    d: {
      heartbeat_interval: SOCKET_HEARTBEAT_INTERVAL_MS,
      gateway_version: gatewayVersion,
    },
  });
  return {
    socket: server,
    response: new Response(null, {
      status: 101,
      headers: { "Sec-WebSocket-Protocol": SOCKET_PROTOCOL_NAME },
      webSocket: client,
    }),
  };
}

/** The `?v=` an upgrade asked for (1 when absent), echoed in Hello. */
export function requestedGatewayVersion(url: URL): number {
  return parseInt(url.searchParams.get("v") ?? "1", 10);
}

// ── Frame preamble ──────────────────────────────────────────────────────────

export type SocketFrameResult =
  | { ok: true; frame: GatewayFrame }
  | { ok: false; error: ServerFrame };

const textEncoder = new TextEncoder();

function frameError(code: CloseCode, message: string): ServerFrame {
  return { op: Op.Error, d: { code, message } };
}

/** UTF-8 length of `text`, stopping once it is known to exceed `limit`. */
function exceedsUtf8Bytes(text: string, limit: number): boolean {
  // A UTF-16 code unit is 1–3 UTF-8 bytes.
  if (text.length > limit) return true;
  if (text.length * 3 <= limit) return false;
  return textEncoder.encode(text).byteLength > limit;
}

/**
 * Text only, at most MAX_SOCKET_FRAME_BYTES, a JSON object with a numeric
 * `op`. Never throws. The Error frames are the ones both objects have
 * always sent.
 */
export function readSocketFrame(
  raw: string | ArrayBuffer,
  maxBytes = MAX_SOCKET_FRAME_BYTES,
): SocketFrameResult {
  if (typeof raw !== "string") {
    return {
      ok: false,
      error: frameError(
        CloseCode.InvalidPayload,
        "Text websocket frames are required",
      ),
    };
  }
  if (exceedsUtf8Bytes(raw, maxBytes)) {
    return {
      ok: false,
      error: frameError(
        CloseCode.InvalidPayload,
        "Websocket frame is too large",
      ),
    };
  }
  const parsed = parseGatewayFrame(raw);
  if (!parsed.ok) {
    return { ok: false, error: frameError(parsed.code, parsed.message) };
  }
  return { ok: true, frame: parsed.frame };
}

// ── Sending ─────────────────────────────────────────────────────────────────

/** Sends one frame; a closed socket is ignored. */
export function sendFrame(ws: WebSocket, msg: ServerFrame): void {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    // Closed.
  }
}

/**
 * Sends `msg` to every socket `isIdentified` accepts, except `exclude`. A
 * socket that has not identified has not been admitted to the room's state
 * and hears none of it; its Ready gives it that state when it identifies.
 */
export function broadcastToIdentified(
  sockets: Iterable<WebSocket>,
  msg: ServerFrame,
  isIdentified: (ws: WebSocket) => boolean,
  exclude?: WebSocket,
): void {
  const data = JSON.stringify(msg);
  for (const ws of sockets) {
    if (ws === exclude || !isIdentified(ws)) continue;
    try {
      ws.send(data);
    } catch {
      // Closed.
    }
  }
}

// ── Rate limiting ───────────────────────────────────────────────────────────

/**
 * Fixed-window per-opcode limits, counted per session and per subject, in
 * the object's SQLite (so they survive hibernation). An opcode with no limit
 * is never counted.
 */
export class SocketRateLimiter {
  constructor(
    private readonly sql: SocketSql,
    private readonly limits: Readonly<Record<number, number>>,
    private readonly windowMs = SOCKET_RATE_LIMIT_WINDOW_MS,
  ) {
    sql.exec(`
      CREATE TABLE IF NOT EXISTS ws_rate_limits (
        rate_key TEXT PRIMARY KEY,
        window_start INTEGER NOT NULL,
        count INTEGER NOT NULL
      );
    `);
  }

  /**
   * Counts one `op` for the session (or "unidentified") and the subject, and
   * says whether either is now over its limit.
   */
  isLimited(
    op: number,
    sessionId: string | undefined,
    subject: string | undefined,
    now = Date.now(),
  ): boolean {
    const limit = this.limits[op];
    if (!limit) return false;

    const keys = [
      `session:${sessionId ?? "unidentified"}:${op}`,
      ...(subject ? [`subject:${subject}:${op}`] : []),
    ];
    let limited = false;

    for (const key of keys) {
      const existing = [
        ...this.sql.exec(
          "SELECT window_start, count FROM ws_rate_limits WHERE rate_key = ?",
          key,
        ),
      ][0];
      if (!existing || now - Number(existing.window_start) >= this.windowMs) {
        this.sql.exec(
          `INSERT INTO ws_rate_limits (rate_key, window_start, count)
           VALUES (?, ?, 1)
           ON CONFLICT(rate_key) DO UPDATE SET window_start = excluded.window_start, count = 1`,
          key,
          now,
        );
        continue;
      }
      const count = Number(existing.count) + 1;
      this.sql.exec(
        "UPDATE ws_rate_limits SET count = ? WHERE rate_key = ?",
        count,
        key,
      );
      if (count > limit) limited = true;
    }
    this.sql.exec(
      "DELETE FROM ws_rate_limits WHERE window_start < ?",
      now - this.windowMs,
    );
    return limited;
  }
}

/** The Error frame for a rate-limited opcode. */
export function rateLimitedError(): ServerFrame {
  return frameError(CloseCode.RateLimited, "Operation rate limit exceeded");
}

// ── Liveness ────────────────────────────────────────────────────────────────
// A socket is alive while it is heard from: accepted, then each heartbeat.
// The time it was last heard lives in its serialized attachment (identified
// voice participants: their SQLite row), never only in memory, so the alarm
// of an object woken from hibernation still sees it.

/** Whether a socket last heard at `lastHeardAt` has gone silent. */
export function isSilent(
  lastHeardAt: number | undefined,
  now: number,
  timeoutMs = SOCKET_ZOMBIE_TIMEOUT_MS,
): boolean {
  return (
    typeof lastHeardAt === "number" &&
    lastHeardAt > 0 &&
    now - lastHeardAt >= timeoutMs
  );
}

/** When a socket last heard at `lastHeardAt` goes silent. */
export function silentAt(
  lastHeardAt: number,
  timeoutMs = SOCKET_ZOMBIE_TIMEOUT_MS,
): number {
  return lastHeardAt + timeoutMs;
}

/**
 * Stores `now` as the socket's last-heard time under `field` in its
 * attachment, keeping the rest. Returns false when the socket has no
 * attachment or is gone.
 */
export function markSocketHeard(
  ws: WebSocket,
  field: string,
  now = Date.now(),
): boolean {
  try {
    const attachment = ws.deserializeAttachment() as Record<
      string,
      unknown
    > | null;
    if (!attachment) return false;
    ws.serializeAttachment({ ...attachment, [field]: now });
    return true;
  } catch {
    return false;
  }
}
