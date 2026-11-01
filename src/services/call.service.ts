/**
 * Call Service — what a DM call does outside the gateway's sockets: rings
 * phones over FCM, stops them ringing, and saves each call's outcome as a
 * system message in the DM.
 *
 * Pushes never throw: a ring is best effort and must not fail the call.
 */

import type { D1Database } from "@cloudflare/workers-types";
import {
  CALL_MESSAGE_TYPE,
  CallRecordSchema,
  callRecordFallbackText,
  type CallRecord,
} from "@ralph/protocol";

import { safeParseJson } from "@/lib/schema";
import type { FcmMessage, FcmSender } from "@/server/fcm";

/** Marks a data-only push the app's native FCM service handles. */
const NATIVE_FORMAT = "2";

/** A call push's data: FCM data values are strings; optional keys are added later. */
interface CallPushData {
  [key: string]: string;
}

// ─── Who rings ───────────────────────────────────────────────────────────────

export interface CallRingPlan {
  /** Ring at all; otherwise the caller hears "unavailable". */
  readonly ring: boolean;
  /** Send a `call_ring` push to the callee's phones. */
  readonly push: boolean;
}

/**
 * A callee rings on every device they are signed in on: their live gateway
 * sessions (web, desktop, an open app) and, through FCM, their phones. With
 * neither, the call is unavailable. `pushDevices` already leaves out legacy
 * apps and users on Do Not Disturb.
 */
export function planCallRing(callee: {
  readonly online: boolean;
  readonly pushDevices: number;
}): CallRingPlan {
  const push = callee.pushDevices > 0;
  return { ring: callee.online || push, push };
}

/**
 * The callee's devices that can ring natively: tokens registered as
 * `native` (older apps cannot draw a call), and none at all while the user
 * is on Do Not Disturb, the rule message pushes follow too.
 */
export async function callRingTokens(
  db: D1Database,
  userId: string,
): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT t.token FROM push_tokens t
       JOIN users u ON u.id = t.user_id
       WHERE t.user_id = ? AND t.push_format = 'native'
         AND COALESCE(u.status, 'online') != 'dnd'`,
    )
    .bind(userId)
    .all();
  return (results ?? []).map((row) => row.token as string);
}

/** Every native token of the user, DND or not: stopping a ring always goes. */
async function nativeTokens(db: D1Database, userId: string): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT token FROM push_tokens
       WHERE user_id = ? AND push_format = 'native'`,
    )
    .bind(userId)
    .all();
  return (results ?? []).map((row) => row.token as string);
}

// ─── Payloads ────────────────────────────────────────────────────────────────

export interface CallRing {
  readonly callId: string;
  readonly channelId: string;
  readonly callerId: string;
  readonly callerName: string;
  /** The stored avatar URL as-is; may be a relative `/api/...` path. */
  readonly callerAvatarUrl: string | null;
  /** When the server stops ringing (epoch ms). */
  readonly expiresAt: number;
}

/**
 * `call_ring`: data-only and high priority so the phone's FCM service wakes
 * with the app killed and shows the incoming call. `ringSeconds` is relative
 * (phone clocks drift); FCM drops the push once its TTL, the ring's
 * remaining time, has passed, so a phone that comes online late never rings.
 */
export function buildCallRingPush(
  ring: CallRing,
  nowMs: number = Date.now(),
): FcmMessage {
  const ringSeconds = Math.max(1, Math.ceil((ring.expiresAt - nowMs) / 1000));
  const data: CallPushData = {
    ralph: NATIVE_FORMAT,
    kind: "call_ring",
    callId: ring.callId,
    channelId: ring.channelId,
    callerId: ring.callerId,
    callerName: ring.callerName,
    ringSeconds: String(ringSeconds),
  };
  if (ring.callerAvatarUrl) data.callerAvatar = ring.callerAvatarUrl;
  return { data, android: { priority: "HIGH", ttl: `${ringSeconds}s` } };
}

/** Why a ring stopped; the gateway's CALL_RING_STOP reasons. */
export type CallRingStopReason =
  | "accepted"
  | "declined"
  | "timeout"
  | "cancelled"
  | "abandoned"
  | "disconnected";

/** The callee never picked up: the ring becomes a missed call. */
export function isMissedRingStop(reason: CallRingStopReason): boolean {
  return reason !== "accepted" && reason !== "declined";
}

/**
 * `call_ring_stop`: takes the ringing screen and notification down. A missed
 * call keeps a day's TTL and the caller, so a phone that was offline still
 * gets its missed-call notification; any other stop is moot after a minute.
 */
export function buildCallRingStopPush(
  ring: Omit<CallRing, "expiresAt">,
  reason: CallRingStopReason,
): FcmMessage {
  const data: CallPushData = {
    ralph: NATIVE_FORMAT,
    kind: "call_ring_stop",
    callId: ring.callId,
    channelId: ring.channelId,
    callerId: ring.callerId,
    callerName: ring.callerName,
    reason,
  };
  if (ring.callerAvatarUrl) data.callerAvatar = ring.callerAvatarUrl;
  return {
    data,
    android: {
      priority: "HIGH",
      ttl: isMissedRingStop(reason) ? "86400s" : "60s",
    },
  };
}

// ─── Sending ─────────────────────────────────────────────────────────────────

async function sendToTokens(
  db: D1Database,
  sender: FcmSender,
  tokens: readonly string[],
  message: FcmMessage,
): Promise<void> {
  const outcomes = await Promise.allSettled(
    tokens.map(async (token) => {
      const result = await sender.send(token, message);
      if (result.ok) return;
      if (!result.staleToken) {
        console.warn("push.call_failed", { status: result.status });
        return;
      }
      await db
        .prepare(`DELETE FROM push_tokens WHERE token = ?`)
        .bind(token)
        .run();
    }),
  );
  const rejected = outcomes.filter((o) => o.status === "rejected").length;
  if (rejected > 0) console.warn("push.call_errored", { count: rejected });
}

/** Rings `tokens` (from callRingTokens). Never throws. */
export async function sendCallRingPushes(
  db: D1Database,
  sender: FcmSender | null,
  tokens: readonly string[],
  ring: CallRing,
): Promise<void> {
  if (!sender || tokens.length === 0) return;
  try {
    await sendToTokens(db, sender, tokens, buildCallRingPush(ring));
  } catch (error: unknown) {
    console.error("push.call_ring_failed", error);
  }
}

/** Stops the ring on every phone of `calleeId`. Never throws. */
export async function sendCallRingStopPushes(
  db: D1Database,
  sender: FcmSender | null,
  calleeId: string,
  ring: Omit<CallRing, "expiresAt">,
  reason: CallRingStopReason,
): Promise<void> {
  if (!sender) return;
  try {
    const tokens = await nativeTokens(db, calleeId);
    if (tokens.length === 0) return;
    await sendToTokens(db, sender, tokens, buildCallRingStopPush(ring, reason));
  } catch (error: unknown) {
    console.error("push.call_ring_stop_failed", error);
  }
}

// ─── Call records ────────────────────────────────────────────────────────────

/** The message a call record is dispatched as (MESSAGE_CREATE). */
export interface CallRecordMessage {
  id: string;
  channel_id: string;
  author_id: string;
  author: {
    id: string;
    username: string;
    display_name: string | null;
    avatar_url: string | null;
    avatar_display: string | null;
  };
  content: string;
  content_revision: number;
  type: typeof CALL_MESSAGE_TYPE;
  call: CallRecord;
  reply_to_id: null;
  is_pinned: false;
  created_at: string;
  attachments: [];
  reactions: [];
}

/**
 * Saves `record` in `channelId` as a call message by the caller and returns
 * it for dispatch. No postprocessing job: a call record has no links to
 * embed and pushes nothing (the ring pushes already told the callee).
 */
export async function insertCallRecord(
  db: D1Database,
  channelId: string,
  messageId: string,
  record: CallRecord,
  createdAt: string = new Date().toISOString(),
): Promise<CallRecordMessage> {
  const content = callRecordFallbackText(record);
  await db
    .prepare(
      `INSERT INTO messages
         (id, channel_id, author_id, content, created_at, content_revision,
          type, metadata)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    .bind(
      messageId,
      channelId,
      record.caller_id,
      content,
      createdAt,
      CALL_MESSAGE_TYPE,
      JSON.stringify(record),
    )
    .run();
  const author = await db
    .prepare(
      `SELECT username, display_name, avatar_url, avatar_display
       FROM users WHERE id = ?`,
    )
    .bind(record.caller_id)
    .first<{
      username: string | null;
      display_name: string | null;
      avatar_url: string | null;
      avatar_display: string | null;
    }>();
  return {
    id: messageId,
    channel_id: channelId,
    author_id: record.caller_id,
    author: {
      id: record.caller_id,
      username: author?.username ?? "Unknown",
      display_name: author?.display_name ?? null,
      avatar_url: author?.avatar_url ?? null,
      avatar_display: author?.avatar_display ?? null,
    },
    content,
    content_revision: 1,
    type: CALL_MESSAGE_TYPE,
    call: record,
    reply_to_id: null,
    is_pinned: false,
    created_at: createdAt,
    attachments: [],
    reactions: [],
  };
}

/**
 * A stored row's system-message fields, for formatMessageRow: `type` and
 * the parsed `call` for a call record; nothing for a person's message or a
 * record whose metadata does not parse.
 */
export function callRecordFields(row: {
  readonly type?: unknown;
  readonly metadata?: unknown;
}): { type: typeof CALL_MESSAGE_TYPE; call: CallRecord } | null {
  if (row.type !== CALL_MESSAGE_TYPE || typeof row.metadata !== "string") {
    return null;
  }
  const parsed = safeParseJson(CallRecordSchema, row.metadata);
  return parsed.success ? { type: CALL_MESSAGE_TYPE, call: parsed.data } : null;
}
