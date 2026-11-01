/**
 * Push Service — device push tokens and message pushes over FCM.
 *
 * Token functions accept a D1Database. `sendMessagePushes` never throws: a
 * push is best effort and must not fail (or retry) the work that made it.
 */

import type { D1Database } from "@cloudflare/workers-types";

import type { FcmMessage, FcmSender } from "@/server/fcm";

// ─── Tokens ──────────────────────────────────────────────────────────────────

export interface PushTokenInput {
  token: string;
  platform: "android" | "ios";
  appVariant: string | null;
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
         (id, user_id, token, platform, app_variant, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(token) DO UPDATE SET
         user_id = excluded.user_id,
         platform = excluded.platform,
         app_variant = excluded.app_variant,
         last_seen_at = excluded.last_seen_at`,
    )
    .bind(id, userId, input.token, input.platform, input.appVariant, now, now)
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

async function tokensByUser(
  db: D1Database,
  userIds: readonly string[],
): Promise<Map<string, string[]>> {
  const byUser = new Map<string, string[]>();
  for (let offset = 0; offset < userIds.length; offset += 90) {
    const chunk = userIds.slice(offset, offset + 90);
    const { results } = await db
      .prepare(
        `SELECT user_id, token FROM push_tokens
         WHERE user_id IN (${chunk.map(() => "?").join(",")})`,
      )
      .bind(...chunk)
      .all();
    for (const row of results ?? []) {
      const userId = row.user_id as string;
      byUser.set(userId, [...(byUser.get(userId) ?? []), row.token as string]);
    }
  }
  return byUser;
}

// ─── Payload ─────────────────────────────────────────────────────────────────

/** The Android channel the app creates at startup for message pushes. */
export const MESSAGES_CHANNEL_ID = "messages";
const BODY_MAX = 180;

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

/**
 * The FCM message for one push: a system notification on the `messages`
 * channel, tagged per conversation so a newer message replaces the older
 * one, and data for the app's deep link.
 */
export function buildMessagePush(push: MessagePush): FcmMessage {
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

// ─── Fan-out ─────────────────────────────────────────────────────────────────

/**
 * Sends each push to every device its recipient registered, and deletes the
 * tokens FCM calls dead. A null sender (push not configured) does nothing.
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
      (tokens.get(push.recipientId) ?? []).map(async (token) => {
        const result = await sender.send(token, buildMessagePush(push));
        if (result.ok) return;
        if (!result.staleToken) {
          console.warn("push.failed", { status: result.status });
          return;
        }
        await db
          .prepare(`DELETE FROM push_tokens WHERE token = ?`)
          .bind(token)
          .run();
      }),
    );
    const outcomes = await Promise.allSettled(sends);
    const rejected = outcomes.filter((o) => o.status === "rejected").length;
    if (rejected > 0) console.warn("push.errored", { count: rejected });
  } catch (error: unknown) {
    console.error("push.fanout_failed", error);
  }
}
