/**
 * User Service — user profile queries and mutations.
 */

import type { ProfileAssetKind } from "@/lib/profile-assets";
import { ServiceError } from "@/lib/service-error";
import { withVersionedAssetUrl } from "@/lib/versioned-asset-url";
import type { D1Database } from "@cloudflare/workers-types";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface UserProfile {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  banner_url: string | null;
  banner_content_type: string | null;
  nameplate_url: string | null;
  nameplate_content_type: string | null;
  theme_preference: string | null;
  theme_sync_enabled: number;
  updated_at: string | null;
  bio: string | null;
  status: string;
  custom_status: string | null;
}

export interface MutualInfo {
  userId: string;
  mutualServers: { count: number; items: Array<{ id: string; name: string; icon_url: string | null }> };
  mutualFriends: { count: number; items: Array<{ id: string; username: string; display_name: string | null; avatar_url: string | null }> };
}

const MAX_PREVIEW = 6;

// ─── getMe ───────────────────────────────────────────────────────────────────

export async function getMe(
  db: D1Database,
  userId: string
): Promise<UserProfile> {
  const user = await db
    .prepare(`SELECT id, username, display_name, avatar_url, banner_url, banner_content_type, nameplate_url, nameplate_content_type, theme_preference, theme_sync_enabled, updated_at, bio, status, custom_status FROM users WHERE id = ?`)
    .bind(userId)
    .first<UserProfile>();

  if (!user) {
    throw ServiceError.notFound("User not found");
  }

  return user;
}

// ─── getUserProfileMutuals ───────────────────────────────────────────────────

export async function getUserProfileMutuals(
  db: D1Database,
  targetUserId: string,
  currentUserId: string
): Promise<MutualInfo> {
  const results = await db.batch([
    db.prepare(`
      SELECT COUNT(*) as count
      FROM server_members sm1
      JOIN server_members sm2 ON sm1.server_id = sm2.server_id
      WHERE sm1.user_id = ? AND sm2.user_id = ?
    `).bind(targetUserId, currentUserId),

    db.prepare(`
      SELECT s.id, s.name, s.icon_url
      FROM servers s
      JOIN server_members sm1 ON s.id = sm1.server_id
      JOIN server_members sm2 ON s.id = sm2.server_id
      WHERE sm1.user_id = ? AND sm2.user_id = ?
      LIMIT ?
    `).bind(targetUserId, currentUserId, MAX_PREVIEW),

    db.prepare(`
      SELECT COUNT(*) as count
      FROM relationships r1
      JOIN relationships r2
        ON r1.target_user_id = r2.target_user_id
      WHERE r1.user_id = ? AND r1.type = 0
        AND r2.user_id = ? AND r2.type = 0
    `).bind(targetUserId, currentUserId),

    db.prepare(`
      SELECT u.id, u.username, u.display_name, u.avatar_url
      FROM users u
      JOIN relationships r1 ON u.id = r1.target_user_id
      JOIN relationships r2 ON u.id = r2.target_user_id
      WHERE r1.user_id = ? AND r1.type = 0
        AND r2.user_id = ? AND r2.type = 0
      LIMIT ?
    `).bind(targetUserId, currentUserId, MAX_PREVIEW),
  ]);

  const serverCount = (results[0].results?.[0] as any)?.count || 0;
  const serverItems = (results[1].results as any[]) || [];
  const friendCount = (results[2].results?.[0] as any)?.count || 0;
  const friendItems = (results[3].results as any[]) || [];

  return {
    userId: targetUserId,
    mutualServers: { count: serverCount, items: serverItems },
    mutualFriends: { count: friendCount, items: friendItems },
  };
}

// ─── updateAvatarUrl ─────────────────────────────────────────────────────────

export async function updateAvatarUrl(
  db: D1Database,
  userId: string,
  avatarUrl: string
) : Promise<{ username: string | null; serverIds: string[]; avatarUrl: string; updatedAt: string }> {
  const updatedAt = new Date().toISOString();
  const versionedAvatarUrl = withVersionedAssetUrl(avatarUrl, updatedAt);
  await db.prepare(
    `UPDATE users SET avatar_url = ?, updated_at = ? WHERE id = ?`
  ).bind(versionedAvatarUrl, updatedAt, userId).run();

  const { results: memberships } = await db.prepare(
    `SELECT server_id FROM server_members WHERE user_id = ?`
  ).bind(userId).all();

  const userRow = await db.prepare(
    `SELECT username FROM users WHERE id = ?`
  ).bind(userId).first() as { username: string } | null;

  return {
    username: userRow?.username ?? null,
    serverIds: (memberships ?? []).map((m: Record<string, unknown>) => m.server_id as string),
    avatarUrl: versionedAvatarUrl,
    updatedAt,
  };
}

export async function updateProfileAsset(
  db: D1Database,
  userId: string,
  kind: ProfileAssetKind,
  asset: { url: string; contentType: string },
): Promise<{
  username: string | null;
  serverIds: string[];
  updatedAt: string;
  user: Pick<UserProfile, "banner_url" | "banner_content_type" | "nameplate_url" | "nameplate_content_type">;
}> {
  const updatedAt = new Date().toISOString();
  const versionedUrl = withVersionedAssetUrl(asset.url, updatedAt);
  const urlColumn = `${kind}_url`;
  const contentTypeColumn = `${kind}_content_type`;

  await db.prepare(
    `UPDATE users SET ${urlColumn} = ?, ${contentTypeColumn} = ?, updated_at = ? WHERE id = ?`
  ).bind(versionedUrl, asset.contentType, updatedAt, userId).run();

  const { results: memberships } = await db.prepare(
    `SELECT server_id FROM server_members WHERE user_id = ?`
  ).bind(userId).all();

  const userRow = await db.prepare(
    `SELECT username, banner_url, banner_content_type, nameplate_url, nameplate_content_type FROM users WHERE id = ?`
  ).bind(userId).first() as Pick<UserProfile, "username" | "banner_url" | "banner_content_type" | "nameplate_url" | "nameplate_content_type"> | null;

  return {
    username: userRow?.username ?? null,
    serverIds: (memberships ?? []).map((m: Record<string, unknown>) => m.server_id as string),
    updatedAt,
    user: {
      banner_url: userRow?.banner_url ?? null,
      banner_content_type: userRow?.banner_content_type ?? null,
      nameplate_url: userRow?.nameplate_url ?? null,
      nameplate_content_type: userRow?.nameplate_content_type ?? null,
    },
  };
}

export async function clearProfileAsset(
  db: D1Database,
  userId: string,
  kind: ProfileAssetKind,
): Promise<{
  username: string | null;
  serverIds: string[];
  updatedAt: string;
  user: Pick<UserProfile, "banner_url" | "banner_content_type" | "nameplate_url" | "nameplate_content_type">;
}> {
  const updatedAt = new Date().toISOString();
  const urlColumn = `${kind}_url`;
  const contentTypeColumn = `${kind}_content_type`;

  await db.prepare(
    `UPDATE users SET ${urlColumn} = NULL, ${contentTypeColumn} = NULL, updated_at = ? WHERE id = ?`
  ).bind(updatedAt, userId).run();

  const { results: memberships } = await db.prepare(
    `SELECT server_id FROM server_members WHERE user_id = ?`
  ).bind(userId).all();

  const userRow = await db.prepare(
    `SELECT username, banner_url, banner_content_type, nameplate_url, nameplate_content_type FROM users WHERE id = ?`
  ).bind(userId).first() as Pick<UserProfile, "username" | "banner_url" | "banner_content_type" | "nameplate_url" | "nameplate_content_type"> | null;

  return {
    username: userRow?.username ?? null,
    serverIds: (memberships ?? []).map((m: Record<string, unknown>) => m.server_id as string),
    updatedAt,
    user: {
      banner_url: userRow?.banner_url ?? null,
      banner_content_type: userRow?.banner_content_type ?? null,
      nameplate_url: userRow?.nameplate_url ?? null,
      nameplate_content_type: userRow?.nameplate_content_type ?? null,
    },
  };
}

// ─── fetchReadStates ─────────────────────────────────────────────────────────

export async function fetchReadStates(
  db: D1Database,
  userId: string
): Promise<{
  read_states: Record<string, unknown>[];
  last_messages: Record<string, unknown>[];
}> {
  const [readResult, latestResult] = await Promise.all([
    db.prepare(
      `SELECT rs.channel_id, rs.last_read_at
       FROM read_states rs
       INNER JOIN channels c ON c.id = rs.channel_id
       LEFT JOIN server_members sm ON sm.server_id = c.server_id AND sm.user_id = ?
       LEFT JOIN dm_recipients dm ON dm.channel_id = c.id AND dm.user_id = ?
       WHERE rs.user_id = ? AND (sm.user_id IS NOT NULL OR dm.user_id IS NOT NULL)`
    ).bind(userId, userId, userId).all(),

    db.prepare(
      `SELECT m.channel_id, MAX(m.created_at) as last_message_at
       FROM messages m
       INNER JOIN channels c ON c.id = m.channel_id
       LEFT JOIN server_members sm ON sm.server_id = c.server_id AND sm.user_id = ?
       LEFT JOIN dm_recipients dm ON dm.channel_id = c.id AND dm.user_id = ?
       WHERE (sm.user_id IS NOT NULL OR dm.user_id IS NOT NULL)
       GROUP BY m.channel_id`
    ).bind(userId, userId).all(),
  ]);

  return {
    read_states: readResult.results ?? [],
    last_messages: latestResult.results ?? [],
  };
}

// ─── fetchAuditLogs ──────────────────────────────────────────────────────────

export interface FormattedAuditLog {
  id: string;
  server_id: string;
  actor_id: string;
  action_type: string;
  target_id: string | null;
  changes: unknown;
  reason: string | null;
  created_at: string;
  actor: { id: string; username: string; display_name: string | null; avatar_url: string | null };
}

export async function fetchAuditLogs(
  db: D1Database,
  serverId: string,
  opts: { limit?: number; page?: number } = {}
): Promise<FormattedAuditLog[]> {
  const limit = Math.min(opts.limit ?? 50, 100);
  const page = Math.max(opts.page ?? 1, 1);
  const offset = (page - 1) * limit;

  const { results } = await db
    .prepare(
      `SELECT
         a.id, a.server_id, a.actor_id, a.action_type,
         a.target_id, a.changes, a.reason, a.created_at,
         u.id as user_id, u.username as user_username,
         u.display_name as user_display_name, u.avatar_url as user_avatar_url
       FROM server_audit_logs a
       JOIN users u ON a.actor_id = u.id
       WHERE a.server_id = ?
       ORDER BY a.created_at DESC
       LIMIT ? OFFSET ?`
    )
    .bind(serverId, limit, offset)
    .all();

  return (results ?? []).map((row: any) => {
    let parsedChanges = null;
    if (row.changes) {
      try { parsedChanges = JSON.parse(row.changes as string); } catch { }
    }

    return {
      id: row.id,
      server_id: row.server_id,
      actor_id: row.actor_id,
      action_type: row.action_type,
      target_id: row.target_id,
      changes: parsedChanges,
      reason: row.reason,
      created_at: row.created_at,
      actor: {
        id: row.user_id,
        username: row.user_username,
        display_name: row.user_display_name,
        avatar_url: row.user_avatar_url,
      },
    };
  });
}
