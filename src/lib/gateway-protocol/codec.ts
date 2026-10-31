// ── Gateway frame codec ─────────────────────────────────────────────────────
// Decoding happens in two steps, so callers can keep their own checks in
// between (frame size, public-demo allowlist, rate limits):
//
// 1. parseGatewayFrame: JSON text → `{ op, d }`, or the Error reply the
//    Durable Objects have always sent (4002 "Invalid JSON", 4001 "Missing
//    opcode").
// 2. A payload decoder built once per endpoint with compilePayloadDecoder from a
//    rules table (client-payloads.ts, server-payloads.ts): `{ op, d }` → a
//    message typed by opcode, "unknown-op", or "invalid-payload".
//
// Validation uses `Schema.is` guards built when the decoder is made, so a
// frame costs one property walk and no copy; handlers get the parsed object
// itself, extra keys included. Encoding is plain JSON.stringify at the call
// sites: the wire format is unchanged.
//
// Schema only. Clients load this file, so do not add Effect runtime modules.

import { Schema } from "effect";
import { GatewayCloseCode, GatewayOp } from "./opcodes";

/** A JSON object with a numeric `op`; `d` is not inspected yet. */
export interface GatewayFrame {
  readonly op: number;
  readonly d?: unknown;
}

export type FrameParseResult =
  | { readonly ok: true; readonly frame: GatewayFrame }
  | {
      readonly ok: false;
      readonly code:
        | GatewayCloseCode.InvalidJson
        | GatewayCloseCode.UnknownOpcode;
      readonly message: string;
    };

const INVALID_JSON: FrameParseResult = {
  ok: false,
  code: GatewayCloseCode.InvalidJson,
  message: "Invalid JSON",
};
const MISSING_OPCODE: FrameParseResult = {
  ok: false,
  code: GatewayCloseCode.UnknownOpcode,
  message: "Missing opcode",
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Parses one text frame. Never throws. */
export function parseGatewayFrame(raw: string): FrameParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return INVALID_JSON;
  }
  if (!isPlainObject(parsed) || typeof parsed.op !== "number") {
    return MISSING_OPCODE;
  }
  return { ok: true, frame: { op: parsed.op, d: parsed.d } };
}

/**
 * The replay cursor a main-gateway frame carries in `d.seq`, if any. Every
 * replayable broadcast gets one, whatever its opcode, so read it before (and
 * regardless of) payload decoding. HeartbeatACK's `seq` is a heartbeat
 * counter, not a cursor.
 */
export function readReplaySeq(frame: GatewayFrame): number | undefined {
  if (frame.op === GatewayOp.HeartbeatACK || !isPlainObject(frame.d)) {
    return undefined;
  }
  const seq = frame.d.seq;
  return typeof seq === "number" && Number.isInteger(seq) ? seq : undefined;
}

// ── Payload rules ──────────────────────────────────────────────────────────

export interface PayloadRule<S extends Schema.Top = Schema.Top> {
  readonly schema: S;
  /** The Error frame `message` (server) or log line (client) on failure. */
  readonly invalid: string;
}

/**
 * Opcode → rule. `null` means the opcode is known but its payload is neither
 * read nor decoded (heartbeats, "leave", "refresh"). Opcodes missing from the
 * table are unknown to that endpoint.
 */
export type PayloadRules = { readonly [op: number]: PayloadRule | null };

/** The typed message union a rules table decodes to. */
export type DecodedMessage<R extends PayloadRules> = {
  readonly [K in keyof R & number]: R[K] extends PayloadRule<infer S>
    ? { readonly op: K; readonly d: S["Type"] }
    : { readonly op: K; readonly d?: unknown };
}[keyof R & number];

/** The `d` type of one opcode in a rules table. */
export type PayloadOf<
  R extends PayloadRules,
  K extends keyof R & number,
> = Extract<DecodedMessage<R>, { readonly op: K }>["d"];

export type PayloadDecodeResult<M> =
  | { readonly ok: true; readonly message: M }
  | { readonly ok: false; readonly reason: "unknown-op" }
  | {
      readonly ok: false;
      readonly reason: "invalid-payload";
      readonly invalid: string;
    };

const UNKNOWN_OP = { ok: false, reason: "unknown-op" } as const;

interface CompiledRule {
  readonly is: (value: unknown) => boolean;
  readonly invalid: string;
}

/**
 * Builds the decoder for one endpoint. Call it once, at module load: the
 * schema guards are compiled here, not per frame.
 */
export function compilePayloadDecoder<const R extends PayloadRules>(
  rules: R,
): (frame: GatewayFrame) => PayloadDecodeResult<DecodedMessage<R>> {
  const compiled = new Map<number, CompiledRule | null>();
  for (const [op, rule] of Object.entries(rules)) {
    compiled.set(
      Number(op),
      rule && { is: Schema.is(rule.schema), invalid: rule.invalid },
    );
  }

  return (frame) => {
    const rule = compiled.get(frame.op);
    if (rule === undefined) return UNKNOWN_OP;
    if (rule !== null && !rule.is(frame.d)) {
      return { ok: false, reason: "invalid-payload", invalid: rule.invalid };
    }
    // The guard for this opcode accepted `d` (or the opcode has no payload),
    // which is what DecodedMessage<R> states for it.
    return { ok: true, message: frame as DecodedMessage<R> };
  };
}
