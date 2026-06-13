/**
 * Message Service — reusable message formatting, reactions, pins, read-state.
 *
 * The key shared pattern extracted here is `batchFetchReactions` and
 * `batchFetchAttachments` + `formatMessageRow`, which were duplicated
 * across messages, pins, and thread routes.
 */

import { ServiceError } from "@/lib/service-error";
import { getAttachmentUrl } from "@/lib/attachment-url";
import type { D1Database } from "@cloudflare/workers-types";
import { markSharesDeletedForMessage } from "./message-share.service";
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

export interface ReplyPreview {
  id: string;
  content: string;
  author_id: string;
  author: { id: string; username: string; display_name: string | null; avatar_url: string | null };
}

export interface FormattedMessage {
  id: unknown;
  channel_id: unknown;
  author_id: unknown;
  author: { id: unknown; username: string; display_name: unknown; avatar_url: unknown };
  content: unknown;
  reply_to_id: unknown;
  reply_to?: ReplyPreview;
  is_pinned: boolean;
  created_at: unknown;
  updated_at: unknown;
  attachments: Attachment[];
  reactions: FormattedReaction[];
  reply_count?: number;
  nonce?: string;
  [key: string]: unknown;
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
      url: getAttachmentUrl(r.file_key as string),
    });
  }
  return map;
}

// ─── formatMessageRow ────────────────────────────────────────────────────────

export function formatMessageRow(
  row: Record<string, unknown>,
  currentUserId: string,
  reactionsByMessage: Record<string, ReactionGroup[]>,
  attachmentsByMessage: Record<string, Attachment[]>,
  replyPreviews?: Record<string, ReplyPreview>
): FormattedMessage {
  const msgId = row.id as string;
  const replyData = row.reply_to_id && replyPreviews
    ? replyPreviews[row.reply_to_id as string]
    : undefined;
  return {
    id: row.id,
    channel_id: row.channel_id,
    author_id: row.author_id,
    author: {
      id: row.author_id,
      username: (row.author_username as string) ?? "Unknown",
      display_name: (row.author_display_name as string) ?? null,
      avatar_url: row.author_avatar_url,
    },
    content: row.content,
    reply_to_id: row.reply_to_id,
    reply_to: replyData,
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
    embeds: row.embeds ? (typeof row.embeds === "string" ? JSON.parse(row.embeds) : row.embeds) : undefined,
    reply_count: (row.reply_count as number) ?? 0,
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

// ─── fetchChannelThreads ─────────────────────────────────────────────────────

export interface ThreadItem {
  id: string;
  content: string;
  author: { id: string; username: string; display_name: string | null; avatar_url: string | null };
  reply_count: number;
  last_reply_at: string;
  created_at: string;
}

export async function fetchChannelThreads(
  db: D1Database,
  channelId: string,
  opts: { limit?: number } = {}
): Promise<ThreadItem[]> {
  const limit = Math.min(opts.limit ?? 30, 50);

  const { results } = await db.prepare(
    `SELECT m.id, m.content, m.author_id, m.created_at,
            u.username as author_username, u.display_name as author_display_name, u.avatar_url as author_avatar_url,
            COUNT(r.id) as reply_count,
            MAX(r.created_at) as last_reply_at
     FROM messages m
     LEFT JOIN users u ON u.id = m.author_id
     INNER JOIN messages r ON r.reply_to_id = m.id
     WHERE m.channel_id = ?
     GROUP BY m.id
     ORDER BY last_reply_at DESC
     LIMIT ?`
  ).bind(channelId, limit).all();

  return (results ?? []).map((row: Record<string, unknown>) => ({
    id: row.id as string,
    content: (row.content as string).slice(0, 200),
    author: {
      id: row.author_id as string,
      username: (row.author_username as string) ?? "Unknown",
      display_name: (row.author_display_name as string) ?? null,
      avatar_url: (row.author_avatar_url as string) ?? null,
    },
    reply_count: row.reply_count as number,
    last_reply_at: row.last_reply_at as string,
    created_at: row.created_at as string,
  }));
}

// ─── batchFetchReplyPreviews ─────────────────────────────────────────────────

export async function batchFetchReplyPreviews(
  db: D1Database,
  replyToIds: string[]
): Promise<Record<string, ReplyPreview>> {
  const result: Record<string, ReplyPreview> = {};
  if (replyToIds.length === 0) return result;

  const uniqueIds = [...new Set(replyToIds)];
  const placeholders = uniqueIds.map(() => "?").join(",");
  const { results } = await db.prepare(
    `SELECT m.id, m.content, m.author_id, u.username as author_username, u.display_name as author_display_name, u.avatar_url as author_avatar_url
     FROM messages m LEFT JOIN users u ON u.id = m.author_id
     WHERE m.id IN (${placeholders})`
  ).bind(...uniqueIds).all();

  for (const r of results ?? []) {
    result[r.id as string] = {
      id: r.id as string,
      content: (r.content as string).slice(0, 200),
      author_id: r.author_id as string,
      author: {
        id: r.author_id as string,
        username: (r.author_username as string) ?? "Unknown",
        display_name: (r.author_display_name as string) ?? null,
        avatar_url: (r.author_avatar_url as string) ?? null,
      },
    };
  }
  return result;
}

// ─── MESSAGE_SELECT (shared SQL fragment) ────────────────────────────────────

const MESSAGE_SELECT = `SELECT m.*, u.username as author_username, u.display_name as author_display_name, u.avatar_url as author_avatar_url,
  (SELECT COUNT(*) FROM messages r WHERE r.reply_to_id = m.id) as reply_count
  FROM messages m LEFT JOIN users u ON u.id = m.author_id`;

// ─── fetchMessageRows (raw query + cursor logic) ─────────────────────────────

export interface ListMessagesOpts {
  limit?: number;
  before?: string | null;
  after?: string | null;
  around?: string | null;
}

export interface ListMessagesResult {
  rows: Record<string, unknown>[];
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
  mode: 'around' | 'after' | 'before' | 'latest';
}

export async function fetchMessageRows(
  db: D1Database,
  channelId: string,
  opts: ListMessagesOpts = {}
): Promise<ListMessagesResult> {
  const limit = Math.min(opts.limit ?? 50, 100);
  let rows: Record<string, unknown>[];
  let hasMoreBefore = false;
  let hasMoreAfter = false;

  if (opts.around) {
    const halfBefore = 25;
    const halfAfter = 24;

    const anchor = await db
      .prepare(`SELECT created_at FROM messages WHERE id = ? AND channel_id = ?`)
      .bind(opts.around, channelId)
      .first() as { created_at: string } | null;

    if (!anchor) {
      throw ServiceError.notFound("Message not found");
    }

    const anchorTime = anchor.created_at;

    const [{ results: beforeRows }, { results: afterRows }] = await Promise.all([
      db.prepare(`${MESSAGE_SELECT} WHERE m.channel_id = ? AND m.created_at <= ? ORDER BY m.created_at DESC LIMIT ?`)
        .bind(channelId, anchorTime, halfBefore + 1).all(),
      db.prepare(`${MESSAGE_SELECT} WHERE m.channel_id = ? AND m.created_at > ? ORDER BY m.created_at ASC LIMIT ?`)
        .bind(channelId, anchorTime, halfAfter + 1).all(),
    ]);

    hasMoreBefore = (beforeRows?.length ?? 0) > halfBefore;
    hasMoreAfter = (afterRows?.length ?? 0) > halfAfter;

    const beforeSlice = (beforeRows ?? []).slice(0, halfBefore).reverse();
    const afterSlice = (afterRows ?? []).slice(0, halfAfter);
    rows = [...beforeSlice, ...afterSlice];

    return { rows, hasMoreBefore, hasMoreAfter, mode: 'around' };
  }

  if (opts.before) {
    const { results } = await db.prepare(
      `${MESSAGE_SELECT} WHERE m.channel_id = ? AND m.created_at < ? ORDER BY m.created_at DESC LIMIT ?`
    ).bind(channelId, opts.before, limit).all();
    rows = (results ?? []).reverse();
    return { rows, hasMoreBefore: false, hasMoreAfter: false, mode: 'before' };
  }

  if (opts.after) {
    const { results } = await db.prepare(
      `${MESSAGE_SELECT} WHERE m.channel_id = ? AND m.created_at > ? ORDER BY m.created_at ASC LIMIT ?`
    ).bind(channelId, opts.after, limit + 1).all();
    hasMoreAfter = (results?.length ?? 0) > limit;
    rows = (results ?? []).slice(0, limit);
    return { rows, hasMoreBefore: false, hasMoreAfter, mode: 'after' };
  }

  // Default: latest N messages
  const { results } = await db.prepare(
    `${MESSAGE_SELECT} WHERE m.channel_id = ? ORDER BY m.created_at DESC LIMIT ?`
  ).bind(channelId, limit).all();
  rows = (results ?? []).reverse();
  return { rows, hasMoreBefore: false, hasMoreAfter: false, mode: 'latest' };
}

// ─── listMessages (full pipeline: fetch + hydrate + format) ──────────────────

export async function listMessages(
  db: D1Database,
  channelId: string,
  userId: string,
  opts: ListMessagesOpts = {}
): Promise<{ messages: FormattedMessage[]; hasMoreBefore: boolean; hasMoreAfter: boolean; mode: string }> {
  const { rows, hasMoreBefore, hasMoreAfter, mode } = await fetchMessageRows(db, channelId, opts);

  const messageIds = rows.map((r) => r.id as string);
  const replyToIds = rows
    .map((r) => r.reply_to_id as string | null)
    .filter((id): id is string => !!id);

  const [reactionsByMessage, attachmentsByMessage, replyPreviews] = await Promise.all([
    batchFetchReactions(db, messageIds),
    batchFetchAttachments(db, messageIds),
    batchFetchReplyPreviews(db, replyToIds),
  ]);

  const messages = rows.map((row) =>
    formatMessageRow(row, userId, reactionsByMessage, attachmentsByMessage, replyPreviews)
  );

  return { messages, hasMoreBefore, hasMoreAfter, mode };
}

// ─── createMessage ───────────────────────────────────────────────────────────

export interface CreateMessageInput {
  content: string;
  reply_to_id?: string;
  nonce?: string;
  attachment_ids?: string[];
}

export async function createMessage(
  db: D1Database,
  channelId: string,
  userId: string,
  messageId: string,
  input: CreateMessageInput
): Promise<FormattedMessage> {
  const now = new Date().toISOString();
  const content = (input.content ?? "").trim();

  await db.prepare(
    `INSERT INTO messages (id, channel_id, author_id, content, reply_to_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(messageId, channelId, userId, content, input.reply_to_id ?? null, now).run();

  // Link pre-uploaded attachments
  let attachments: Attachment[] = [];
  if (input.attachment_ids?.length) {
    const attIds = input.attachment_ids;
    const placeholders = attIds.map(() => "?").join(",");
    await db.prepare(
      `UPDATE attachments SET message_id = ? WHERE id IN (${placeholders}) AND user_id = ?`
    ).bind(messageId, ...attIds, userId).run();

    const { results: attRows } = await db.prepare(
      `SELECT id, filename, file_key, content_type, size_bytes FROM attachments WHERE id IN (${placeholders})`
    ).bind(...attIds).all();

    attachments = (attRows ?? []).map((r: Record<string, unknown>) => ({
      id: r.id as string,
      filename: r.filename as string,
      file_key: r.file_key as string,
      content_type: r.content_type as string | null,
      size_bytes: r.size_bytes as number,
      url: getAttachmentUrl(r.file_key as string),
    }));
  }

  // Get author info
  const authorRow = await db.prepare(
    `SELECT username, display_name, avatar_url FROM users WHERE id = ?`
  ).bind(userId).first() as { username: string; display_name: string | null; avatar_url: string | null } | null;

  // Get reply-to preview
  let replyTo: ReplyPreview | undefined;
  if (input.reply_to_id) {
    const previews = await batchFetchReplyPreviews(db, [input.reply_to_id]);
    replyTo = previews[input.reply_to_id];
  }

  return {
    id: messageId,
    channel_id: channelId,
    author_id: userId,
    author: {
      id: userId,
      username: authorRow?.username ?? "User",
      display_name: authorRow?.display_name ?? null,
      avatar_url: authorRow?.avatar_url ?? null,
    },
    content,
    reply_to_id: input.reply_to_id ?? null,
    reply_to: replyTo,
    is_pinned: false,
    created_at: now,
    updated_at: null,
    nonce: input.nonce,
    attachments,
    reactions: [],
    reply_count: 0,
  };
}

// ─── editMessage ─────────────────────────────────────────────────────────────

export async function editMessage(
  db: D1Database,
  channelId: string,
  userId: string,
  messageId: string,
  newContent: string
): Promise<{ id: string; channel_id: string; content: string; updated_at: string }> {
  const msg = await db.prepare(
    `SELECT author_id FROM messages WHERE id = ? AND channel_id = ?`
  ).bind(messageId, channelId).first() as { author_id: string } | null;

  if (!msg) throw ServiceError.notFound("Message not found");
  if (msg.author_id !== userId) throw ServiceError.forbidden("Not your message");

  const now = new Date().toISOString();
  await db.prepare(
    `UPDATE messages SET content = ?, updated_at = ? WHERE id = ?`
  ).bind(newContent.trim(), now, messageId).run();

  return { id: messageId, channel_id: channelId, content: newContent.trim(), updated_at: now };
}

// ─── deleteMessage ───────────────────────────────────────────────────────────

export async function deleteMessage(
  db: D1Database,
  channelId: string,
  messageId: string,
  userId: string,
  hasModeratorPermission: boolean
): Promise<void> {
  const msg = await db.prepare(
    `SELECT author_id FROM messages WHERE id = ? AND channel_id = ?`
  ).bind(messageId, channelId).first() as { author_id: string } | null;

  if (!msg) throw ServiceError.notFound("Message not found");
  if (msg.author_id !== userId && !hasModeratorPermission) {
    throw ServiceError.forbidden("Not your message");
  }

  await markSharesDeletedForMessage(db, messageId);
  await db.prepare(`DELETE FROM messages WHERE id = ?`).bind(messageId).run();
}

// ─── getDMRecipients ─────────────────────────────────────────────────────────

export async function getDMRecipients(
  db: D1Database,
  channelId: string,
  excludeUserId: string
): Promise<string[]> {
  const { results } = await db.prepare(
    `SELECT user_id FROM dm_recipients WHERE channel_id = ? AND user_id != ?`
  ).bind(channelId, excludeUserId).all();
  return (results ?? []).map((r) => r.user_id as string);
}

// ─── generateMessageNotifications ────────────────────────────────────────────

export interface NotificationBroadcast {
  userId: string;
  event: string;
  data: Record<string, unknown>;
}

export async function generateMessageNotifications(
  db: D1Database,
  genId: () => string,
  opts: {
    channelId: string;
    messageId: string;
    authorId: string;
    authorUsername: string;
    authorDisplayName: string | null;
    authorAvatarUrl: string | null;
    content: string;
    replyToId?: string;
  }
): Promise<NotificationBroadcast[]> {
  const broadcasts: NotificationBroadcast[] = [];
  const notifiedUserIds = new Set<string>();
  const now = new Date().toISOString();
  const snippet = opts.content.trim().slice(0, 200);

  // Get channel info for denormalized fields
  const channelInfo = await db.prepare(
    `SELECT c.name as channel_name, c.server_id, c.channel_type, s.name as server_name
     FROM channels c LEFT JOIN servers s ON s.id = c.server_id
     WHERE c.id = ?`
  ).bind(opts.channelId).first() as { channel_name: string; server_id: string | null; channel_type: string; server_name: string | null } | null;

  const serverId = channelInfo?.server_id ?? null;

  // 1. Parse @username mentions
  const mentionRegex = /@(\w+)/g;
  const mentionedUsernames = new Set<string>();
  let match;
  while ((match = mentionRegex.exec(opts.content ?? "")) !== null) {
    mentionedUsernames.add(match[1].toLowerCase());
  }

  if (mentionedUsernames.size > 0) {
    const placeholders = [...mentionedUsernames].map(() => "LOWER(?)").join(",");
    const { results: mentionedUsers } = await db.prepare(
      `SELECT id, username FROM users WHERE LOWER(username) IN (${placeholders})`
    ).bind(...mentionedUsernames).all();

    for (const mu of mentionedUsers ?? []) {
      const mentionedId = mu.id as string;
      if (mentionedId === opts.authorId) continue;
      notifiedUserIds.add(mentionedId);

      const notifId = genId();
      await db.prepare(
        `INSERT INTO notifications (id, user_id, type, channel_id, server_id, message_id, from_user_id, content, created_at)
         VALUES (?, ?, 'mention', ?, ?, ?, ?, ?, ?)`
      ).bind(notifId, mentionedId, opts.channelId, serverId, opts.messageId, opts.authorId, snippet, now).run();

      broadcasts.push({
        userId: mentionedId,
        event: "NOTIFICATION_CREATE",
        data: {
          id: notifId,
          type: "mention",
          channel_id: opts.channelId,
          server_id: serverId,
          message_id: opts.messageId,
          from_user: { id: opts.authorId, username: opts.authorUsername, display_name: opts.authorDisplayName, avatar_url: opts.authorAvatarUrl },
          content: snippet,
          is_read: false,
          created_at: now,
          channel_name: channelInfo?.channel_name,
          server_name: channelInfo?.server_name,
        },
      });
    }
  }

  // 2. Reply notification
  if (opts.replyToId) {
    const parentMsg = await db.prepare(
      `SELECT author_id FROM messages WHERE id = ?`
    ).bind(opts.replyToId).first() as { author_id: string } | null;

    if (parentMsg && parentMsg.author_id !== opts.authorId && !notifiedUserIds.has(parentMsg.author_id)) {
      const notifId = genId();
      await db.prepare(
        `INSERT INTO notifications (id, user_id, type, channel_id, server_id, message_id, from_user_id, content, created_at)
         VALUES (?, ?, 'reply', ?, ?, ?, ?, ?, ?)`
      ).bind(notifId, parentMsg.author_id, opts.channelId, serverId, opts.messageId, opts.authorId, snippet, now).run();

      broadcasts.push({
        userId: parentMsg.author_id,
        event: "NOTIFICATION_CREATE",
        data: {
          id: notifId,
          type: "reply",
          channel_id: opts.channelId,
          server_id: serverId,
          message_id: opts.messageId,
          from_user: { id: opts.authorId, username: opts.authorUsername, display_name: opts.authorDisplayName, avatar_url: opts.authorAvatarUrl },
          content: snippet,
          is_read: false,
          created_at: now,
          channel_name: channelInfo?.channel_name,
          server_name: channelInfo?.server_name,
        },
      });
    }
  }

  // 3. DM notification
  if (channelInfo?.channel_type === "dm") {
    // Get recipients excluding the author
    const recipients = await getDMRecipients(db, opts.channelId, opts.authorId);
    for (const recipientId of recipients) {
      if (!notifiedUserIds.has(recipientId)) {
        notifiedUserIds.add(recipientId);

        const notifId = genId();
        await db.prepare(
          `INSERT INTO notifications (id, user_id, type, channel_id, server_id, message_id, from_user_id, content, created_at)
           VALUES (?, ?, 'dm', ?, ?, ?, ?, ?, ?)`
        ).bind(notifId, recipientId, opts.channelId, null, opts.messageId, opts.authorId, snippet, now).run();

        broadcasts.push({
          userId: recipientId,
          event: "NOTIFICATION_CREATE",
          data: {
            id: notifId,
            type: "dm",
            channel_id: opts.channelId,
            server_id: null,
            message_id: opts.messageId,
          from_user: { id: opts.authorId, username: opts.authorUsername, display_name: opts.authorDisplayName, avatar_url: opts.authorAvatarUrl },
            content: snippet,
            is_read: false,
            created_at: now,
            channel_name: opts.authorUsername,
            server_name: null,
          },
        });
      }
    }
  }

  return broadcasts;
}
