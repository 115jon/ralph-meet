/**
 * Server Service — pure business logic extracted from route handlers.
 *
 * All functions accept a D1Database as their first argument (dependency injection)
 * and return plain objects. They never touch HTTP concerns (Request/Response/NextResponse).
 *
 * Side effects (cache invalidation, broadcasts, audit logs) are returned as
 * declarative metadata that the route handler executes after the service call.
 */

import { AuditLogAction } from "@/lib/audit-logger";
import { CacheKey } from "@/lib/cache";
import { DEFAULT_EVERYONE_PERMISSIONS, hasPermission, PERMISSIONS } from "@/lib/permissions";
import { ServiceError } from "@/lib/service-error";
import type { D1Database } from "@cloudflare/workers-types";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BroadcastDescriptor {
  type: "channel" | "server" | "user" | "all";
  target?: string;
  event: string;
  data: unknown;
}

export interface AuditLogDescriptor {
  serverId: string;
  actorId: string;
  actionType: string;
  targetId?: string | null;
  changes?: Record<string, unknown> | null;
  reason?: string | null;
}

export interface ServiceResult<T> {
  data: T;
  cacheKeysToInvalidate: string[];
  broadcast?: BroadcastDescriptor;
  auditLog?: AuditLogDescriptor;
}

// ─── ID generator (injectable for testing) ───────────────────────────────────

let _genId = (): string => crypto.randomUUID();

/** Override the ID generator (useful in tests) */
export function setIdGenerator(fn: () => string): void {
  _genId = fn;
}

function genId(): string {
  return _genId();
}

// ─── listUserServers ─────────────────────────────────────────────────────────

export async function listUserServers(
  db: D1Database,
  userId: string
): Promise<Record<string, unknown>[]> {
  const { results } = await db
    .prepare(
      `SELECT s.* FROM servers s
       INNER JOIN server_members sm ON sm.server_id = s.id
       WHERE sm.user_id = ?
       ORDER BY s.created_at ASC`
    )
    .bind(userId)
    .all();
  return results ?? [];
}

// ─── createServer ────────────────────────────────────────────────────────────

export interface CreateServerInput {
  name: string;
  icon_url?: string | null;
}

export async function createServer(
  db: D1Database,
  userId: string,
  input: CreateServerInput
): Promise<{
  id: string;
  name: string;
  owner_id: string;
  icon_url: string | null;
  created_at: string;
}> {
  const name = input.name.trim();
  const iconUrl = input.icon_url ?? null;

  const serverId = genId();
  const now = new Date().toISOString();
  const textCategoryId = genId();
  const voiceCategoryId = genId();
  const channelId = genId();
  const voiceChannelId = genId();
  const everyoneRoleId = genId();
  const ownerRoleId = genId();

  await db.batch([
    db
      .prepare(
        `INSERT INTO servers (id, name, owner_id, icon_url, created_at) VALUES (?, ?, ?, ?, ?)`
      )
      .bind(serverId, name, userId, iconUrl, now),
    db
      .prepare(
        `INSERT INTO server_members (server_id, user_id, joined_at) VALUES (?, ?, ?)`
      )
      .bind(serverId, userId, now),
    db
      .prepare(
        `INSERT INTO roles (id, server_id, name, color, permissions, position, is_default, created_at) VALUES (?, ?, '@everyone', NULL, ?, 0, 1, ?)`
      )
      .bind(everyoneRoleId, serverId, DEFAULT_EVERYONE_PERMISSIONS, now),
    db
      .prepare(
        `INSERT INTO roles (id, server_id, name, color, permissions, position, is_default, created_at) VALUES (?, ?, 'Owner', '#FACC15', ?, 1, 0, ?)`
      )
      .bind(ownerRoleId, serverId, PERMISSIONS.ADMINISTRATOR, now),
    db
      .prepare(
        `INSERT INTO member_roles (server_id, user_id, role_id) VALUES (?, ?, ?)`
      )
      .bind(serverId, userId, ownerRoleId),
    db
      .prepare(
        `INSERT INTO categories (id, server_id, name, rank) VALUES (?, ?, 'TEXT CHANNELS', 0)`
      )
      .bind(textCategoryId, serverId),
    db
      .prepare(
        `INSERT INTO categories (id, server_id, name, rank) VALUES (?, ?, 'VOICE CHANNELS', 1)`
      )
      .bind(voiceCategoryId, serverId),
    db
      .prepare(
        `INSERT INTO channels (id, server_id, name, channel_type, category_id, position, created_at)
         VALUES (?, ?, 'general', 'text', ?, 0, ?)`
      )
      .bind(channelId, serverId, textCategoryId, now),
    db
      .prepare(
        `INSERT INTO channels (id, server_id, name, channel_type, category_id, position, created_at)
         VALUES (?, ?, 'General', 'voice', ?, 1, ?)`
      )
      .bind(voiceChannelId, serverId, voiceCategoryId, now),
  ]);

  return {
    id: serverId,
    name,
    owner_id: userId,
    icon_url: iconUrl,
    created_at: now,
  };
}

// ─── updateServer ────────────────────────────────────────────────────────────

export interface UpdateServerInput {
  name?: string;
  icon_url?: string | null;
  invites_paused?: boolean;
}

export async function updateServer(
  db: D1Database,
  serverId: string,
  actorId: string,
  input: UpdateServerInput
): Promise<ServiceResult<{ server: Record<string, unknown> | null }>> {
  const updates: string[] = [];
  const values: (string | null)[] = [];

  if (input.name?.trim()) {
    updates.push("name = ?");
    values.push(input.name.trim());
  }
  if (input.icon_url !== undefined) {
    updates.push("icon_url = ?");
    values.push(input.icon_url ?? null);
  }
  if (input.invites_paused !== undefined) {
    updates.push("invites_paused = ?");
    values.push(input.invites_paused ? "1" : "0");
  }

  if (updates.length === 0) {
    throw ServiceError.badRequest("No changes");
  }

  values.push(serverId);
  await db
    .prepare(`UPDATE servers SET ${updates.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();

  const server = await db
    .prepare(`SELECT * FROM servers WHERE id = ?`)
    .bind(serverId)
    .first();

  // Fetch member IDs for cache invalidation
  const { results: memberRows } = await db
    .prepare(`SELECT user_id FROM server_members WHERE server_id = ?`)
    .bind(serverId)
    .all();

  const cacheKeysToInvalidate = [
    CacheKey.server(serverId),
    ...(memberRows ?? []).map((r: Record<string, unknown>) =>
      CacheKey.userServers(r.user_id as string)
    ),
  ];

  return {
    data: { server },
    cacheKeysToInvalidate,
    broadcast: {
      type: "all",
      event: "GUILD_UPDATE",
      data: server,
    },
    auditLog: {
      serverId,
      actorId,
      actionType: AuditLogAction.SERVER_UPDATE,
      changes: updates.reduce(
        (acc, curr, idx) => {
          acc[curr.split(" = ")[0]] = values[idx];
          return acc;
        },
        {} as Record<string, unknown>
      ),
    },
  };
}

// ─── deleteServer ────────────────────────────────────────────────────────────

export async function deleteServer(
  db: D1Database,
  serverId: string,
  actorId: string
): Promise<{
  cacheKeysToInvalidate: string[];
  broadcast: BroadcastDescriptor;
}> {
  const server = (await db
    .prepare(`SELECT owner_id FROM servers WHERE id = ?`)
    .bind(serverId)
    .first()) as { owner_id: string } | null;

  if (!server || server.owner_id !== actorId) {
    throw ServiceError.forbidden("Only the owner can delete");
  }

  // Fetch member IDs BEFORE deleting
  const { results: memberRows } = await db
    .prepare(`SELECT user_id FROM server_members WHERE server_id = ?`)
    .bind(serverId)
    .all();

  await db.prepare(`DELETE FROM servers WHERE id = ?`).bind(serverId).run();

  return {
    cacheKeysToInvalidate: [
      CacheKey.server(serverId),
      CacheKey.serverChannels(serverId),
      CacheKey.serverMembers(serverId),
      ...(memberRows ?? []).map((r: Record<string, unknown>) =>
        CacheKey.userServers(r.user_id as string)
      ),
    ],
    broadcast: {
      type: "all",
      event: "GUILD_DELETE",
      data: { id: serverId },
    },
  };
}

// ─── listServerMembers ───────────────────────────────────────────────────────

export async function listServerMembers(
  db: D1Database,
  serverId: string
): Promise<
  Array<{
    joined_at: unknown;
    roles: Array<Record<string, unknown>>;
    user: {
      id: unknown;
      username: string;
      avatar_url: unknown;
      bio: unknown;
      status: string;
      custom_status: unknown;
    };
  }>
> {
  const { results } = await db
    .prepare(
      `SELECT
         sm.user_id,
         sm.joined_at,
         u.username,
         u.display_name,
         u.avatar_url,
         u.bio,
         u.status,
         u.custom_status,
         (
           SELECT json_group_array(json_object(
             'id', r.id,
             'server_id', r.server_id,
             'name', r.name,
             'color', r.color,
             'permissions', r.permissions,
             'position', r.position,
             'is_default', r.is_default,
             'created_at', r.created_at
           ))
           FROM member_roles mr
           JOIN roles r ON r.id = mr.role_id
           WHERE mr.user_id = sm.user_id AND mr.server_id = sm.server_id
           ORDER BY r.position DESC
         ) as roles_json
       FROM server_members sm
       LEFT JOIN users u ON u.id = sm.user_id
       WHERE sm.server_id = ?
       ORDER BY sm.joined_at ASC`
    )
    .bind(serverId)
    .all();

  return (results ?? []).map((row: Record<string, unknown>) => ({
    joined_at: row.joined_at,
    roles: JSON.parse((row.roles_json as string) || "[]").map(
      (r: Record<string, unknown>) => ({
        ...r,
        is_default: r.is_default === 1,
      })
    ),
    user: {
      id: row.user_id,
      username: (row.username as string) ?? "Unknown",
      display_name: (row.display_name as string) ?? null,
      avatar_url: row.avatar_url,
      bio: row.bio,
      status: (row.status as string) ?? "offline",
      custom_status: row.custom_status,
    },
  }));
}

// ─── searchMessages ──────────────────────────────────────────────────────────

export async function searchMessages(
  db: D1Database,
  serverId: string,
  query: string,
  limit: number,
  offset: number
): Promise<{
  messages: Array<{
    id: unknown;
    channel_id: unknown;
    channel_name: unknown;
    author_id: unknown;
    author: { id: unknown; username: string; avatar_url: unknown };
    content: unknown;
    is_pinned: boolean;
    created_at: unknown;
  }>;
  total: number;
  limit: number;
  offset: number;
}> {
  const cappedLimit = Math.min(limit, 50);
  const likeQuery = `%${query}%`;

  const { results } = await db
    .prepare(
      `SELECT m.id, m.channel_id, m.author_id, m.content, m.created_at, m.is_pinned,
              u.username as author_username, u.display_name as author_display_name, u.avatar_url as author_avatar_url,
              c.name as channel_name
       FROM messages m
       JOIN channels c ON c.id = m.channel_id AND c.server_id = ?
       LEFT JOIN users u ON u.id = m.author_id
       WHERE m.content LIKE ?
       ORDER BY m.created_at DESC
       LIMIT ? OFFSET ?`
    )
    .bind(serverId, likeQuery, cappedLimit, offset)
    .all();

  const countRow = (await db
    .prepare(
      `SELECT COUNT(*) as total
       FROM messages m
       JOIN channels c ON c.id = m.channel_id AND c.server_id = ?
       WHERE m.content LIKE ?`
    )
    .bind(serverId, likeQuery)
    .first()) as { total: number } | null;

  const messages = (results ?? []).map((row: Record<string, unknown>) => ({
    id: row.id,
    channel_id: row.channel_id,
    channel_name: row.channel_name,
    author_id: row.author_id,
    author: {
      id: row.author_id,
      username: (row.author_username as string) ?? "Unknown",
      display_name: (row.author_display_name as string) ?? null,
      avatar_url: row.author_avatar_url,
    },
    content: row.content,
    is_pinned: !!row.is_pinned,
    created_at: row.created_at,
  }));

  return {
    messages,
    total: countRow?.total ?? 0,
    limit: cappedLimit,
    offset,
  };
}

// ─── kickMember ──────────────────────────────────────────────────────────────

export async function kickMember(
  db: D1Database,
  serverId: string,
  actorId: string,
  targetUserId: string
): Promise<{
  kicked: boolean;
  cacheKeysToInvalidate: string[];
  broadcast: BroadcastDescriptor;
  auditLog: AuditLogDescriptor;
}> {
  // Get actor's permissions + role hierarchy
  const actorPermsResult = (await db
    .prepare(
      `SELECT SUM(r.permissions) as total_perms, MAX(r.position) as max_position
       FROM member_roles mr
       JOIN roles r ON r.id = mr.role_id
       WHERE mr.server_id = ? AND mr.user_id = ?`
    )
    .bind(serverId, actorId)
    .first()) as {
      total_perms: number | null;
      max_position: number | null;
    } | null;

  if (
    !actorPermsResult ||
    !actorPermsResult.total_perms ||
    !hasPermission(actorPermsResult.total_perms, PERMISSIONS.KICK_MEMBERS)
  ) {
    throw ServiceError.forbidden("Insufficient permissions");
  }

  // Verify target is a member
  const target = await db
    .prepare(
      `SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?`
    )
    .bind(serverId, targetUserId)
    .first();

  if (!target) {
    throw ServiceError.notFound("Member not found");
  }

  // Retrieve target's highest role position
  const targetPermsResult = (await db
    .prepare(
      `SELECT MAX(r.position) as max_position
       FROM member_roles mr
       JOIN roles r ON r.id = mr.role_id
       WHERE mr.server_id = ? AND mr.user_id = ?`
    )
    .bind(serverId, targetUserId)
    .first()) as { max_position: number | null } | null;

  const actorTopRole = actorPermsResult.max_position ?? 0;
  const targetTopRole = targetPermsResult?.max_position ?? 0;

  if (
    targetTopRole >= actorTopRole &&
    !hasPermission(actorPermsResult.total_perms, PERMISSIONS.ADMINISTRATOR)
  ) {
    throw ServiceError.forbidden(
      "Cannot kick a member with equal or higher role"
    );
  }

  await db
    .prepare(
      `DELETE FROM server_members WHERE server_id = ? AND user_id = ?`
    )
    .bind(serverId, targetUserId)
    .run();

  return {
    kicked: true,
    cacheKeysToInvalidate: [
      CacheKey.serverMembers(serverId),
      CacheKey.userServers(targetUserId),
    ],
    broadcast: {
      type: "all",
      event: "GUILD_MEMBER_REMOVE",
      data: {
        server_id: serverId,
        user_id: targetUserId,
      },
    },
    auditLog: {
      serverId,
      actorId,
      actionType: AuditLogAction.MEMBER_KICK,
      targetId: targetUserId,
    },
  };
}
