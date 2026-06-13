/**
 * Notification Service — pure business logic for notification operations.
 *
 * All functions accept a D1Database, return plain objects, and throw ServiceError
 * for error cases.
 */

import { ServiceError } from "@/lib/service-error";
import type { D1Database } from "@cloudflare/workers-types";

// ─── listNotifications ───────────────────────────────────────────────────────

export interface ListNotificationsOptions {
  limit: number;
  unreadOnly: boolean;
}

export interface Notification {
  id: unknown;
  type: unknown;
  channel_id: unknown;
  server_id: unknown;
  message_id: unknown;
  from_user: { id: unknown; username: string; display_name: string | null; avatar_url: unknown };
  content: unknown;
  is_read: boolean;
  created_at: unknown;
  channel_name: unknown;
  server_name: unknown;
}

export async function listNotifications(
  db: D1Database,
  userId: string,
  opts: ListNotificationsOptions
): Promise<{ notifications: Notification[]; unread_count: number }> {
  const cappedLimit = Math.min(opts.limit, 100);

  const whereClause = opts.unreadOnly
    ? "WHERE n.user_id = ? AND n.is_read = 0"
    : "WHERE n.user_id = ?";

  const { results } = await db
    .prepare(
      `SELECT n.*,
              u.username as from_username, u.display_name as from_display_name, u.avatar_url as from_avatar_url,
              CASE WHEN c.channel_type = 'dm' THEN u.username ELSE c.name END as channel_name,
              s.name as server_name
       FROM notifications n
       LEFT JOIN users u ON u.id = n.from_user_id
       LEFT JOIN channels c ON c.id = n.channel_id
       LEFT JOIN servers s ON s.id = n.server_id
       ${whereClause}
       ORDER BY n.created_at DESC
       LIMIT ?`
    )
    .bind(userId, cappedLimit)
    .all();

  const countRow = (await db
    .prepare(
      `SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0`
    )
    .bind(userId)
    .first()) as { count: number } | null;

  const notifications: Notification[] = (results ?? []).map(
    (r: Record<string, unknown>) => ({
      id: r.id,
      type: r.type,
      channel_id: r.channel_id,
      server_id: r.server_id,
      message_id: r.message_id,
      from_user: {
        id: r.from_user_id,
        username: (r.from_username as string) ?? "Unknown",
        display_name: (r.from_display_name as string) ?? null,
        avatar_url: r.from_avatar_url,
      },
      content: r.content,
      is_read: !!r.is_read,
      created_at: r.created_at,
      channel_name: r.channel_name,
      server_name: r.server_name,
    })
  );

  return {
    notifications,
    unread_count: countRow?.count ?? 0,
  };
}

// ─── markNotificationsRead ───────────────────────────────────────────────────

export interface MarkReadInput {
  ids?: string[];
  all?: boolean;
}

export async function markNotificationsRead(
  db: D1Database,
  userId: string,
  input: MarkReadInput
): Promise<void> {
  if (input.all) {
    await db
      .prepare(
        `UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0`
      )
      .bind(userId)
      .run();
    return;
  }

  if (input.ids && input.ids.length > 0) {
    const placeholders = input.ids.map(() => "?").join(",");
    await db
      .prepare(
        `UPDATE notifications SET is_read = 1 WHERE user_id = ? AND id IN (${placeholders})`
      )
      .bind(userId, ...input.ids)
      .run();
    return;
  }

  throw ServiceError.badRequest("Provide ids array or all: true");
}

// ─── clearNotifications ──────────────────────────────────────────────────────

export async function clearNotifications(
  db: D1Database,
  userId: string
): Promise<void> {
  await db
    .prepare(`DELETE FROM notifications WHERE user_id = ?`)
    .bind(userId)
    .run();
}
