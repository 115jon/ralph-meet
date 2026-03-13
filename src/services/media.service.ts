/**
 * Media Service — channel media/attachments queries for the media panel.
 *
 * Supports three content types: images (includes video), links, and files.
 * Uses INNER JOIN to messages for channel-scoped filtering — attachments
 * with NULL message_id are excluded (orphaned uploads).
 */

import type { D1Database } from "@cloudflare/workers-types";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MediaItem {
  id: string;
  message_id: string;
  filename: string;
  url: string;
  content_type: string;
  size_bytes: number;
  author: { id: string; username: string; display_name: string | null; avatar_url: string | null };
  created_at: string;
}

export interface LinkItem {
  id: string;
  message_id: string;
  content: string;
  author: { id: string; username: string; display_name: string | null; avatar_url: string | null };
  created_at: string;
}

// ─── fetchChannelMedia ───────────────────────────────────────────────────────

/**
 * Fetch image and video attachments for a channel (Media tab).
 */
export async function fetchChannelMedia(
  db: D1Database,
  channelId: string,
  opts: { limit?: number; before?: string | null } = {}
): Promise<MediaItem[]> {
  const limit = Math.min(opts.limit ?? 50, 100);
  const bindings: (string | number)[] = [channelId];

  let cursorClause = "";
  if (opts.before) {
    cursorClause = "AND a.created_at < ?";
    bindings.push(opts.before);
  }
  bindings.push(limit);

  const { results } = await db
    .prepare(
      `SELECT a.id, a.filename, a.file_key, a.content_type, a.size_bytes, a.created_at,
              a.message_id, m.author_id,
              u.username AS author_username, u.display_name AS author_display_name, u.avatar_url AS author_avatar_url
       FROM attachments a
       INNER JOIN messages m ON m.id = a.message_id
       LEFT JOIN users u ON u.id = m.author_id
       WHERE m.channel_id = ?
         AND (
           a.content_type LIKE 'image/%'
           OR a.content_type LIKE 'video/mp4%'
           OR a.content_type LIKE 'video/webm%'
           OR a.content_type LIKE 'video/ogg%'
           OR a.content_type LIKE 'video/mp2t%'
         )
         ${cursorClause}
       ORDER BY a.created_at DESC
       LIMIT ?`
    )
    .bind(...bindings)
    .all();

  return (results ?? []).map(formatAttachmentRow);
}

// ─── fetchChannelFiles ───────────────────────────────────────────────────────

/**
 * Fetch non-media file attachments for a channel (Files tab).
 * Excludes images and videos (those go in the Media tab).
 */
export async function fetchChannelFiles(
  db: D1Database,
  channelId: string,
  opts: { limit?: number; before?: string | null } = {}
): Promise<MediaItem[]> {
  const limit = Math.min(opts.limit ?? 50, 100);
  const bindings: (string | number)[] = [channelId];

  let cursorClause = "";
  if (opts.before) {
    cursorClause = "AND a.created_at < ?";
    bindings.push(opts.before);
  }
  bindings.push(limit);

  const { results } = await db
    .prepare(
      `SELECT a.id, a.filename, a.file_key, a.content_type, a.size_bytes, a.created_at,
              a.message_id, m.author_id,
              u.username AS author_username, u.display_name AS author_display_name, u.avatar_url AS author_avatar_url
       FROM attachments a
       INNER JOIN messages m ON m.id = a.message_id
       LEFT JOIN users u ON u.id = m.author_id
       WHERE m.channel_id = ?
         AND a.content_type NOT LIKE 'image/%'
         AND a.content_type NOT LIKE 'video/mp4%'
         AND a.content_type NOT LIKE 'video/webm%'
         AND a.content_type NOT LIKE 'video/ogg%'
         AND a.content_type NOT LIKE 'video/mp2t%'
         ${cursorClause}
       ORDER BY a.created_at DESC
       LIMIT ?`
    )
    .bind(...bindings)
    .all();

  return (results ?? []).map(formatAttachmentRow);
}

// ─── fetchChannelLinks ───────────────────────────────────────────────────────

/**
 * Fetch messages containing URLs for a channel (Links tab).
 */
export async function fetchChannelLinks(
  db: D1Database,
  channelId: string,
  opts: { limit?: number; before?: string | null } = {}
): Promise<LinkItem[]> {
  const limit = Math.min(opts.limit ?? 50, 100);
  const bindings: (string | number)[] = [channelId];

  let cursorClause = "";
  if (opts.before) {
    cursorClause = "AND m.created_at < ?";
    bindings.push(opts.before);
  }
  bindings.push(limit);

  const { results } = await db
    .prepare(
      `SELECT m.id, m.content, m.author_id, m.created_at,
              u.username AS author_username, u.display_name AS author_display_name, u.avatar_url AS author_avatar_url
       FROM messages m
       LEFT JOIN users u ON u.id = m.author_id
       WHERE m.channel_id = ?
         AND (m.content LIKE '%http://%' OR m.content LIKE '%https://%')
         ${cursorClause}
       ORDER BY m.created_at DESC
       LIMIT ?`
    )
    .bind(...bindings)
    .all();

  return (results ?? []).map((row) => ({
    id: row.id as string,
    message_id: row.id as string,
    content: row.content as string,
    author: {
      id: row.author_id as string,
      username: (row.author_username as string) ?? "Unknown",
      display_name: (row.author_display_name as string) ?? null,
      avatar_url: (row.author_avatar_url as string) ?? null,
    },
    created_at: row.created_at as string,
  }));
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatAttachmentRow(row: Record<string, unknown>): MediaItem {
  return {
    id: row.id as string,
    message_id: row.message_id as string,
    filename: row.filename as string,
    url: `/api/${row.file_key as string}`,
    content_type: row.content_type as string,
    size_bytes: row.size_bytes as number,
    author: {
      id: row.author_id as string,
      username: (row.author_username as string) ?? "Unknown",
      display_name: (row.author_display_name as string) ?? null,
      avatar_url: (row.author_avatar_url as string) ?? null,
    },
    created_at: row.created_at as string,
  };
}
