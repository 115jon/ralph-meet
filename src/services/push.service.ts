/**
 * Push Service — device push tokens and message pushes over FCM.
 *
 * Token functions accept a D1Database. `sendMessagePushes` and
 * `sendReadPushes` never throw: a push is best effort and must not fail (or
 * retry) the work that made it.
 */

import type { D1Database } from "@cloudflare/workers-types";

import type { FcmMessage, FcmSender } from "@/server/fcm";

// ─── Tokens ──────────────────────────────────────────────────────────────────

export interface PushTokenInput {
  token: string;
  platform: "android" | "ios";
  appVariant: string | null;
  /** NULL = legacy app (system-rendered push); "native" = data-only pushes. */
  pushFormat: "native" | null;
}

/** Registers `token` for `userId`, taking it over from any previous owner. */
export async function upsertPushToken(
  db: D1Database,
  userId: string,
  id: string,
  input: PushTokenInput,
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO push_tokens
         (id, user_id, token, platform, app_variant, push_format,
          created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(token) DO UPDATE SET
         user_id = excluded.user_id,
         platform = excluded.platform,
         app_variant = excluded.app_variant,
         push_format = excluded.push_format,
         last_seen_at = excluded.last_seen_at`,
    )
    .bind(
      id,
      userId,
      input.token,
      input.platform,
      input.appVariant,
      input.pushFormat,
      now,
      now,
    )
    .run();
}

/** Unregisters `token`, only if `userId` owns it. */
export async function deletePushToken(
  db: D1Database,
  userId: string,
  token: string,
): Promise<void> {
  await db
    .prepare(`DELETE FROM push_tokens WHERE token = ? AND user_id = ?`)
    .bind(token, userId)
    .run();
}

interface DeviceToken {
  token: string;
  /** NULL = legacy app; "native" = the app renders data-only pushes. */
  pushFormat: string | null;
}

/**
 * Each user's device tokens. Users on Do Not Disturb are left out: they get
 * no message pushes at all.
 */
async function tokensByUser(
  db: D1Database,
  userIds: readonly string[],
): Promise<Map<string, DeviceToken[]>> {
  const byUser = new Map<string, DeviceToken[]>();
  for (let offset = 0; offset < userIds.length; offset += 90) {
    const chunk = userIds.slice(offset, offset + 90);
    const { results } = await db
      .prepare(
        `SELECT t.user_id, t.token, t.push_format FROM push_tokens t
         JOIN users u ON u.id = t.user_id
         WHERE t.user_id IN (${chunk.map(() => "?").join(",")})
           AND COALESCE(u.status, 'online') != 'dnd'`,
      )
      .bind(...chunk)
      .all();
    for (const row of results ?? []) {
      const userId = row.user_id as string;
      byUser.set(userId, [
        ...(byUser.get(userId) ?? []),
        {
          token: row.token as string,
          pushFormat: (row.push_format as string | null) ?? null,
        },
      ]);
    }
  }
  return byUser;
}

async function deleteStaleToken(db: D1Database, token: string): Promise<void> {
  await db.prepare(`DELETE FROM push_tokens WHERE token = ?`).bind(token).run();
}

// ─── Payload ─────────────────────────────────────────────────────────────────

/** The Android channel the app creates at startup for message pushes. */
export const MESSAGES_CHANNEL_ID = "messages";
const BODY_MAX = 180;
/** Marks a data-only push the app's native FCM service handles. */
const NATIVE_FORMAT = "2";

export interface MessagePush {
  recipientId: string;
  notificationId: string;
  type: "mention" | "reply" | "dm";
  channelId: string;
  serverId: string | null;
  messageId: string;
  senderName: string;
  channelName: string | null;
  serverName: string | null;
  content: string;
  senderId: string;
  /** The stored avatar URL as-is; may be a relative `/api/...` path. */
  senderAvatarUrl: string | null;
  /** ISO time the message was sent. */
  sentAt: string;
}

function previewOf(push: MessagePush): string {
  const text = push.content.replace(/\s+/g, " ").trim();
  if (!text) {
    if (push.type === "mention") return "Mentioned you";
    if (push.type === "reply") return "Replied to you";
    return "Sent an attachment";
  }
  return text.length > BODY_MAX
    ? `${text.slice(0, BODY_MAX - 1).trimEnd()}…`
    : text;
}

function titleOf(push: MessagePush): string {
  if (push.type === "dm" || !push.channelName) return push.senderName;
  const where = push.serverName
    ? `#${push.channelName}, ${push.serverName}`
    : `#${push.channelName}`;
  return `${push.senderName} (${where})`;
}

/** A message FCM renders itself: it always has a `notification` block. */
export type SystemFcmMessage = FcmMessage &
  Required<Pick<FcmMessage, "notification">>;

/**
 * The FCM message for one push: a system notification on the `messages`
 * channel, tagged per conversation so a newer message replaces the older
 * one, and data for the app's deep link.
 */
export function buildMessagePush(push: MessagePush): SystemFcmMessage {
  const tag = `channel:${push.channelId}`;
  const data = {
    type: push.type,
    channelId: push.channelId,
    messageId: push.messageId,
    notificationId: push.notificationId,
    // expo-notifications ids a notification it shows in the foreground by
    // `data.tag`, so those collapse per conversation too.
    tag,
  };
  return {
    notification: { title: titleOf(push), body: previewOf(push) },
    data: push.serverId ? { ...data, serverId: push.serverId } : data,
    android: {
      priority: "HIGH",
      notification: {
        channel_id: MESSAGES_CHANNEL_ID,
        tag,
      },
    },
  };
}

/** The string-valued data of a native push; optional keys are added later. */
interface NativePushData {
  [key: string]: string;
}

/**
 * The data-only FCM message for a native-format device: no `notification`
 * block, so the app renders it (and can group, reply and clear it). Null
 * values are left out. Avoids the data key `body`, which expo-notifications
 * parses as JSON.
 */
export function buildNativeMessagePush(push: MessagePush): FcmMessage {
  const isChannel = push.type !== "dm" && push.channelName !== null;
  const data: NativePushData = {
    ralph: NATIVE_FORMAT,
    kind: "message",
    type: push.type,
    channelId: push.channelId,
    messageId: push.messageId,
    notificationId: push.notificationId,
    tag: `channel:${push.channelId}`,
    senderId: push.senderId,
    senderName: push.senderName,
    preview: previewOf(push),
    sentAt: push.sentAt,
  };
  if (push.serverId) data.serverId = push.serverId;
  if (push.senderAvatarUrl) data.senderAvatar = push.senderAvatarUrl;
  if (isChannel) data.conversation = `#${push.channelName}`;
  if (isChannel && push.serverName) data.serverName = push.serverName;
  return { data, android: { priority: "HIGH", ttl: "86400s" } };
}

// ─── Fan-out ─────────────────────────────────────────────────────────────────

/**
 * Sends each push to every device its recipient registered, in the format
 * that device asked for, and deletes the tokens FCM calls dead. A null sender
 * (push not configured) does nothing.
 */
export async function sendMessagePushes(
  db: D1Database,
  sender: FcmSender | null,
  pushes: readonly MessagePush[],
): Promise<void> {
  if (!sender || pushes.length === 0) return;
  try {
    const tokens = await tokensByUser(db, [
      ...new Set(pushes.map((push) => push.recipientId)),
    ]);
    const sends = pushes.flatMap((push) =>
      (tokens.get(push.recipientId) ?? []).map(async (device) => {
        const message =
          device.pushFormat === "native"
            ? buildNativeMessagePush(push)
            : buildMessagePush(push);
        const result = await sender.send(device.token, message);
        if (result.ok) return;
        if (!result.staleToken) {
          console.warn("push.failed", { status: result.status });
          return;
        }
        await deleteStaleToken(db, device.token);
      }),
    );
    const outcomes = await Promise.allSettled(sends);
    const rejected = outcomes.filter((o) => o.status === "rejected").length;
    if (rejected > 0) console.warn("push.errored", { count: rejected });
  } catch (error: unknown) {
    console.error("push.fanout_failed", error);
  }
}

// ─── Read elsewhere ──────────────────────────────────────────────────────────

/** Only notifications this recent can still be sitting in a tray. */
const READ_PUSH_LOOKBACK_DAYS = 7;
/** At most one read push per user and channel per this long, per isolate. */
const READ_PUSH_MIN_INTERVAL_MS = 10_000;

/**
 * Whether marking `channelId` read now clears anything: the user has a
 * notification there newer than their previous `last_read_at` (or any, with
 * no read state yet). Call it before `markChannelAsRead` moves the mark.
 *
 * `created_at` is ISO text from the app, but defaults and older rows are
 * SQLite's `YYYY-MM-DD HH:MM:SS`; `julianday()` reads both. The lookback and
 * `LIMIT 1` keep it cheap, and `idx_notifications_user` narrows it to the
 * user's rows.
 */
export async function hasNotificationsSinceLastRead(
  db: D1Database,
  userId: string,
  channelId: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS found FROM notifications
       WHERE user_id = ? AND channel_id = ?
         AND julianday(created_at) > julianday('now', '-${READ_PUSH_LOOKBACK_DAYS} days')
         AND julianday(created_at) > COALESCE(
           (SELECT julianday(last_read_at) FROM read_states
            WHERE user_id = ? AND channel_id = ?), 0)
       LIMIT 1`,
    )
    .bind(userId, channelId, userId, channelId)
    .first();
  return row !== null && row !== undefined;
}

const lastReadPushAt = new Map<string, number>();

/** Whether a read push for `key` may go out now; records it if so. */
function takeReadPushSlot(key: string, nowMs: number): boolean {
  const last = lastReadPushAt.get(key);
  if (last !== undefined && nowMs - last < READ_PUSH_MIN_INTERVAL_MS) {
    return false;
  }
  for (const [other, at] of lastReadPushAt) {
    if (nowMs - at >= READ_PUSH_MIN_INTERVAL_MS) lastReadPushAt.delete(other);
  }
  lastReadPushAt.set(key, nowMs);
  return true;
}

/**
 * Tells the user's native-format devices that `channelId` was read (at
 * `readAt`, ISO) so they can clear its tray notifications. Never throws.
 */
export async function sendReadPushes(
  db: D1Database,
  sender: FcmSender | null,
  userId: string,
  channelId: string,
  readAt: string,
  nowMs: number = Date.now(),
): Promise<void> {
  if (!sender) return;
  try {
    if (!takeReadPushSlot(`${userId}:${channelId}`, nowMs)) return;
    const { results } = await db
      .prepare(
        `SELECT token FROM push_tokens
         WHERE user_id = ? AND push_format = 'native'`,
      )
      .bind(userId)
      .all();
    const message: FcmMessage = {
      data: { ralph: NATIVE_FORMAT, kind: "read", channelId, readAt },
      android: { priority: "NORMAL", ttl: "3600s" },
    };
    const sends = (results ?? []).map(async (row) => {
      const token = row.token as string;
      const result = await sender.send(token, message);
      if (result.ok) return;
      if (!result.staleToken) {
        console.warn("push.failed", { status: result.status });
        return;
      }
      await deleteStaleToken(db, token);
    });
    const outcomes = await Promise.allSettled(sends);
    const rejected = outcomes.filter((o) => o.status === "rejected").length;
    if (rejected > 0) console.warn("push.errored", { count: rejected });
  } catch (error: unknown) {
    console.error("push.read_failed", error);
  }
}
