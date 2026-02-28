/**
 * Message Service — reusable message formatting, reactions, pins, read-state.
 *
 * The key shared pattern extracted here is `batchFetchReactions` and
 * `batchFetchAttachments` + `formatMessageRow`, which were duplicated
 * across messages, pins, and thread routes.
 */

import { ServiceError } from "@/lib/service-error";
import type { D1Database } from "@cloudflare/workers-types";
import type { BroadcastDescriptor } from "./server.service";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ReactionGroup {
  emoji: string;
  user_ids: string[];
}

export interface Attachment {
  id: string;
  filename: string;
  file_key: string;
  content_type: string | null;
  size_bytes: number;
  url: string;
}

export interface FormattedReaction {
  emoji: string;
  count: number;
  me: boolean;
  users: string[];
}

export interface FormattedMessage {
  id: unknown;
  channel_id: unknown;
  author_id: unknown;
  author: { id: unknown; username: string; avatar_url: unknown };
  content: unknown;
  reply_to_id: unknown;
  is_pinned: boolean;
  created_at: unknown;
  updated_at: unknown;
  attachments: Attachment[];
  reactions: FormattedReaction[];
}

// ─── batchFetchReactions ─────────────────────────────────────────────────────

export async function batchFetchReactions(
  db: D1Database,
  messageIds: string[]
): Promise<Record<string, ReactionGroup[]>> {
  if (messageIds.length === 0) return {};

  const placeholders = messageIds.map(() => "?").join(",");
  const { results } = await db
    .prepare(
      `SELECT message_id, emoji, user_id FROM message_reactions
       WHERE message_id IN (${placeholders})
       ORDER BY created_at ASC`
    )
    .bind(...messageIds)
    .all();

  const map: Record<string, ReactionGroup[]> = {};
  for (const r of results ?? []) {
    const msgId = r.message_id as string;
    const emoji = r.emoji as string;
    const uid = r.user_id as string;
    if (!map[msgId]) map[msgId] = [];
    let existing = map[msgId].find((e) => e.emoji === emoji);
    if (!existing) {
      existing = { emoji, user_ids: [] };
      map[msgId].push(existing);
    }
    existing.user_ids.push(uid);
  }
  return map;
}

// ─── batchFetchAttachments ───────────────────────────────────────────────────

export async function batchFetchAttachments(
  db: D1Database,
  messageIds: string[]
): Promise<Record<string, Attachment[]>> {
  if (messageIds.length === 0) return {};

  const placeholders = messageIds.map(() => "?").join(",");
  const { results } = await db
    .prepare(
      `SELECT id, message_id, filename, file_key, content_type, size_bytes
       FROM attachments
       WHERE message_id IN (${placeholders})
       ORDER BY created_at ASC`
    )
    .bind(...messageIds)
    .all();

  const map: Record<string, Attachment[]> = {};
  for (const r of results ?? []) {
    const msgId = r.message_id as string;
    if (!map[msgId]) map[msgId] = [];
    map[msgId].push({
      id: r.id as string,
      filename: r.filename as string,
      file_key: r.file_key as string,
      content_type: r.content_type as string | null,
      size_bytes: r.size_bytes as number,
      url: `/api/${r.file_key as string}`,
    });
  }
  return map;
}

// ─── formatMessageRow ────────────────────────────────────────────────────────

export function formatMessageRow(
  row: Record<string, unknown>,
  currentUserId: string,
  reactionsByMessage: Record<string, ReactionGroup[]>,
  attachmentsByMessage: Record<string, Attachment[]>
): FormattedMessage {
  const msgId = row.id as string;
  return {
    id: row.id,
    channel_id: row.channel_id,
    author_id: row.author_id,
    author: {
      id: row.author_id,
      username: (row.author_username as string) ?? "Unknown",
      avatar_url: row.author_avatar_url,
    },
    content: row.content,
    reply_to_id: row.reply_to_id,
    is_pinned: !!row.is_pinned,
    created_at: row.created_at,
    updated_at: row.updated_at,
    attachments: attachmentsByMessage[msgId] ?? [],
    reactions: (reactionsByMessage[msgId] ?? []).map((r) => ({
      emoji: r.emoji,
      count: r.user_ids.length,
      me: r.user_ids.includes(currentUserId),
      users: r.user_ids,
    })),
  };
}

// ─── addReaction ─────────────────────────────────────────────────────────────

export async function addReaction(
  db: D1Database,
  channelId: string,
  userId: string,
  messageId: string,
  emoji: string
): Promise<{ broadcast: BroadcastDescriptor }> {
  const now = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO message_reactions (message_id, user_id, emoji, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (message_id, user_id, emoji) DO NOTHING`
    )
    .bind(messageId, userId, emoji, now)
    .run();

  return {
    broadcast: {
      type: "channel",
      target: channelId,
      event: "REACTION_ADD",
      data: {
        message_id: messageId,
        channel_id: channelId,
        user_id: userId,
        emoji,
      },
    },
  };
}

// ─── removeReaction ──────────────────────────────────────────────────────────

export async function removeReaction(
  db: D1Database,
  channelId: string,
  userId: string,
  messageId: string,
  emoji: string
): Promise<{ broadcast: BroadcastDescriptor }> {
  await db
    .prepare(
      `DELETE FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?`
    )
    .bind(messageId, userId, emoji)
    .run();

  return {
    broadcast: {
      type: "channel",
      target: channelId,
      event: "REACTION_REMOVE",
      data: {
        message_id: messageId,
        channel_id: channelId,
        user_id: userId,
        emoji,
      },
    },
  };
}

// ─── markChannelAsRead ───────────────────────────────────────────────────────

export async function markChannelAsRead(
  db: D1Database,
  userId: string,
  channelId: string
): Promise<{ channel_id: string; last_read_at: string }> {
  const now = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO read_states (user_id, channel_id, last_read_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id, channel_id) DO UPDATE SET last_read_at = excluded.last_read_at`
    )
    .bind(userId, channelId, now)
    .run();

  return { channel_id: channelId, last_read_at: now };
}

// ─── pinMessage ──────────────────────────────────────────────────────────────

export async function pinMessage(
  db: D1Database,
  channelId: string,
  messageId: string
): Promise<{ broadcast: BroadcastDescriptor }> {
  const msg = (await db
    .prepare(
      `SELECT id, channel_id, is_pinned FROM messages WHERE id = ? AND channel_id = ?`
    )
    .bind(messageId, channelId)
    .first()) as { id: string } | null;

  if (!msg) {
    throw ServiceError.notFound("Message not found");
  }

  // Check pin limit (50 per channel)
  const { results: pinCount } = await db
    .prepare(
      `SELECT COUNT(*) as count FROM messages WHERE channel_id = ? AND is_pinned = 1`
    )
    .bind(channelId)
    .all();
  const count =
    ((pinCount?.[0] as Record<string, unknown>)?.count as number) ?? 0;
  if (count >= 50) {
    throw ServiceError.badRequest(
      "Maximum 50 pinned messages per channel"
    );
  }

  await db
    .prepare(`UPDATE messages SET is_pinned = 1 WHERE id = ?`)
    .bind(messageId)
    .run();

  return {
    broadcast: {
      type: "channel",
      target: channelId,
      event: "MESSAGE_PIN",
      data: { id: messageId, channel_id: channelId, is_pinned: true },
    },
  };
}

// ─── unpinMessage ────────────────────────────────────────────────────────────

export async function unpinMessage(
  db: D1Database,
  channelId: string,
  messageId: string
): Promise<{ broadcast: BroadcastDescriptor }> {
  const msg = (await db
    .prepare(
      `SELECT id, channel_id, is_pinned FROM messages WHERE id = ? AND channel_id = ?`
    )
    .bind(messageId, channelId)
    .first()) as { id: string } | null;

  if (!msg) {
    throw ServiceError.notFound("Message not found");
  }

  await db
    .prepare(`UPDATE messages SET is_pinned = 0 WHERE id = ?`)
    .bind(messageId)
    .run();

  return {
    broadcast: {
      type: "channel",
      target: channelId,
      event: "MESSAGE_UNPIN",
      data: {
        id: messageId,
        channel_id: channelId,
        is_pinned: false,
      },
    },
  };
}
