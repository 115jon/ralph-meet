// ── Server → client payloads: both gateways and the chat socket ─────────────
// What clients accept in `d` for the opcodes every gateway sends (Hello,
// Error) and for the chat socket on /api/gateway, which the web chat store
// and the mobile app both open. Clients check frames against these at the
// socket edge (see codec.ts); a frame that fails is logged and dropped, an
// opcode a client does not know is ignored.
//
// These are deliberately looser than what the Durable Objects send: a field
// is required only when the client reads it without a fallback. Extra keys
// are never rejected, and the client receives the original object.
//
// The call sockets' rules (RoomGateway, VoiceGateway) carry the web app's
// voice domain types, so they stay in src/lib/gateway-protocol.

import { Schema } from "effect";
import { GatewayOp } from "./opcodes";
import type { PayloadRules } from "./codec";

// ── Both gateways ──────────────────────────────────────────────────────────

/** Used when a Hello carries no interval (no current server omits it). */
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 45_000;

export const HelloPayload = Schema.Struct({
  heartbeat_interval: Schema.optional(Schema.Finite),
  gateway_version: Schema.optional(Schema.Unknown),
});

export const ErrorPayload = Schema.Struct({
  code: Schema.Number,
  message: Schema.String,
  /** Native screen-share errors only. */
  request_id: Schema.optional(Schema.String),
  operation: Schema.optional(Schema.Literal("push")),
  push_prefix: Schema.optional(Schema.Literal("screen")),
});

// ── Main gateway (MeetingRoom): the chat socket ───────────────────────────

/** The event payload is routed by `event` in the chat store, not checked here. */
const DispatchPayload = Schema.Struct({
  event: Schema.String,
  data: Schema.optional(Schema.Unknown),
  /** Replay cursor; also read generically by readReplaySeq. */
  seq: Schema.optional(Schema.Number),
});

/** The chat store reads only the session id from Ready. */
const ChatReadyPayload = Schema.Struct({
  participant_id: Schema.optional(Schema.String),
});

/**
 * Server opcodes the chat store handles on /api/gateway. `null`: the payload
 * is not decoded (HeartbeatACK may arrive with no `d`; Resumed is not read).
 */
export const chatGatewayServerRules = {
  [GatewayOp.Hello]: { schema: HelloPayload, invalid: "Invalid Hello" },
  [GatewayOp.HeartbeatACK]: null,
  [GatewayOp.Ready]: { schema: ChatReadyPayload, invalid: "Invalid Ready" },
  [GatewayOp.Resumed]: null,
  [GatewayOp.Error]: { schema: ErrorPayload, invalid: "Invalid Error" },
  [GatewayOp.Dispatch]: {
    schema: DispatchPayload,
    invalid: "Invalid Dispatch",
  },
} as const satisfies PayloadRules;

// ── Payload types ──────────────────────────────────────────────────────────

type HelloPayload = typeof HelloPayload.Type;
type ErrorPayload = typeof ErrorPayload.Type;
type DispatchPayload = typeof DispatchPayload.Type;
type ChatReadyPayload = typeof ChatReadyPayload.Type;
