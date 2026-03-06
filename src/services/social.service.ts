/**
 * Social Service — friends, DMs, invites, and server joining.
 */

import { CacheKey } from "@/lib/cache";
import { ServiceError } from "@/lib/service-error";
import type { D1Database } from "@cloudflare/workers-types";
import type { BroadcastDescriptor } from "./server.service";

// ─── ID generator (injectable) ───────────────────────────────────────────────

let _genId = (): string => crypto.randomUUID();
export function setSocialIdGenerator(fn: () => string): void {
  _genId = fn;
}

// ─── listRelationships ───────────────────────────────────────────────────────

export async function listRelationships(
  db: D1Database,
  userId: string
): Promise<
  Array<{
    user: Record<string, unknown>;
    type: number;
    created_at: unknown;
  }>
> {
  const { results } = await db
    .prepare(
      `SELECT r.target_user_id, r.type, r.created_at,
              u.username, u.avatar_url, u.status, u.custom_status
       FROM relationships r
       JOIN users u ON u.id = r.target_user_id
       WHERE r.user_id = ?
       ORDER BY r.created_at DESC`
    )
    .bind(userId)
    .all();

  return (results ?? []).map((row: Record<string, unknown>) => ({
    user: {
      id: row.target_user_id,
      username: row.username,
      avatar_url: row.avatar_url,
      status: row.status,
      custom_status: row.custom_status,
    },
    type: row.type as number,
    created_at: row.created_at,
  }));
}

// ─── sendFriendRequest ───────────────────────────────────────────────────────

export async function sendFriendRequest(
  db: D1Database,
  userId: string,
  targetUsername: string
): Promise<{
  user: Record<string, unknown>;
  type: number;
  broadcasts: BroadcastDescriptor[];
}> {
  const target = (await db
    .prepare(
      `SELECT id, username, avatar_url, status, custom_status FROM users WHERE username = ?`
    )
    .bind(targetUsername.trim())
    .first()) as Record<string, unknown> | null;

  if (!target) {
    throw ServiceError.notFound("User not found");
  }

  if (target.id === userId) {
    throw ServiceError.badRequest("Cannot friend yourself");
  }

  // Check existing relationship
  const existing = (await db
    .prepare(
      `SELECT type FROM relationships WHERE user_id = ? AND target_user_id = ?`
    )
    .bind(userId, target.id)
    .first()) as { type: number } | null;

  if (existing) {
    if (existing.type === 0) throw ServiceError.conflict("Already friends");
    if (existing.type === 1) throw ServiceError.conflict("User is blocked");
    if (existing.type === 3)
      throw ServiceError.conflict("Request already sent");

    if (existing.type === 2) {
      // They sent us a request — auto-accept
      const now = new Date().toISOString();
      await db.batch([
        db
          .prepare(
            `UPDATE relationships SET type = 0, updated_at = ? WHERE user_id = ? AND target_user_id = ?`
          )
          .bind(now, userId, target.id as string),
        db
          .prepare(
            `UPDATE relationships SET type = 0, updated_at = ? WHERE user_id = ? AND target_user_id = ?`
          )
          .bind(now, target.id as string, userId),
      ]);
      return {
        user: {
          id: target.id,
          username: target.username,
          avatar_url: target.avatar_url,
          status: target.status,
          custom_status: target.custom_status,
        },
        type: 0,
        broadcasts: [],
      };
    }
  }

  // Create pending relationships
  const now = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        `INSERT INTO relationships (user_id, target_user_id, type, created_at, updated_at)
         VALUES (?, ?, 3, ?, ?)`
      )
      .bind(userId, target.id as string, now, now),
    db
      .prepare(
        `INSERT INTO relationships (user_id, target_user_id, type, created_at, updated_at)
         VALUES (?, ?, 2, ?, ?)`
      )
      .bind(target.id as string, userId, now, now),
  ]);

  // Fetch current user for broadcasts
  const currentUser = await db
    .prepare(
      `SELECT id, username, avatar_url, status, custom_status FROM users WHERE id = ?`
    )
    .bind(userId)
    .first();

  return {
    user: {
      id: target.id,
      username: target.username,
      avatar_url: target.avatar_url,
      status: target.status,
      custom_status: target.custom_status,
    },
    type: 3,
    broadcasts: [
      {
        type: "user",
        target: target.id as string,
        event: "RELATIONSHIP_ADD",
        data: { user: currentUser, type: 2, created_at: now },
      },
      {
        type: "user",
        target: userId,
        event: "RELATIONSHIP_ADD",
        data: { user: target, type: 3, created_at: now },
      },
    ],
  };
}

// ─── acceptFriendRequest ────────────────────────────────────────────────────

export async function acceptFriendRequest(
  db: D1Database,
  userId: string,
  targetUserId: string
): Promise<{ type: number; broadcasts: BroadcastDescriptor[] }> {
  const pending = await db
    .prepare(
      `SELECT 1 FROM relationships WHERE user_id = ? AND target_user_id = ? AND type = 2`
    )
    .bind(userId, targetUserId)
    .first();

  if (!pending) {
    throw ServiceError.notFound("No pending request");
  }

  const now = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        `UPDATE relationships SET type = 0, updated_at = ? WHERE user_id = ? AND target_user_id = ?`
      )
      .bind(now, userId, targetUserId),
    db
      .prepare(
        `UPDATE relationships SET type = 0, updated_at = ? WHERE user_id = ? AND target_user_id = ?`
      )
      .bind(now, targetUserId, userId),
  ]);

  const userA = await db
    .prepare(
      `SELECT id, username, avatar_url, status, custom_status FROM users WHERE id = ?`
    )
    .bind(userId)
    .first();
  const userB = await db
    .prepare(
      `SELECT id, username, avatar_url, status, custom_status FROM users WHERE id = ?`
    )
    .bind(targetUserId)
    .first();

  return {
    type: 0,
    broadcasts: [
      {
        type: "user",
        target: userId,
        event: "RELATIONSHIP_ADD",
        data: { user: userB, type: 0, created_at: now },
      },
      {
        type: "user",
        target: targetUserId,
        event: "RELATIONSHIP_ADD",
        data: { user: userA, type: 0, created_at: now },
      },
    ],
  };
}

// ─── blockUser ───────────────────────────────────────────────────────────────

export async function blockUser(
  db: D1Database,
  userId: string,
  targetUserId: string
): Promise<{ type: number; broadcasts: BroadcastDescriptor[] }> {
  const now = new Date().toISOString();

  await db.batch([
    db
      .prepare(
        `INSERT OR REPLACE INTO relationships (user_id, target_user_id, type, created_at, updated_at)
         VALUES (?, ?, 1, ?, ?)`
      )
      .bind(userId, targetUserId, now, now),
    db
      .prepare(
        `DELETE FROM relationships WHERE user_id = ? AND target_user_id = ?`
      )
      .bind(targetUserId, userId),
  ]);

  const userB = await db
    .prepare(
      `SELECT id, username, avatar_url, status, custom_status FROM users WHERE id = ?`
    )
    .bind(targetUserId)
    .first();

  return {
    type: 1,
    broadcasts: [
      {
        type: "user",
        target: userId,
        event: "RELATIONSHIP_ADD",
        data: { user: userB, type: 1, created_at: now },
      },
      {
        type: "user",
        target: targetUserId,
        event: "RELATIONSHIP_REMOVE",
        data: { user_id: userId },
      },
    ],
  };
}

// ─── removeRelationship ──────────────────────────────────────────────────────

export async function removeRelationship(
  db: D1Database,
  userId: string,
  targetUserId: string
): Promise<{ broadcasts: BroadcastDescriptor[] }> {
  await db.batch([
    db
      .prepare(
        `DELETE FROM relationships WHERE user_id = ? AND target_user_id = ?`
      )
      .bind(userId, targetUserId),
    db
      .prepare(
        `DELETE FROM relationships WHERE user_id = ? AND target_user_id = ?`
      )
      .bind(targetUserId, userId),
  ]);

  return {
    broadcasts: [
      {
        type: "user",
        target: userId,
        event: "RELATIONSHIP_REMOVE",
        data: { user_id: targetUserId },
      },
      {
        type: "user",
        target: targetUserId,
        event: "RELATIONSHIP_REMOVE",
        data: { user_id: userId },
      },
    ],
  };
}

// ─── listDMs ─────────────────────────────────────────────────────────────────

export async function listDMs(
  db: D1Database,
  userId: string
): Promise<
  Array<{
    id: unknown;
    channel_type: string;
    name: unknown;
    created_at: unknown;
    recipient: Record<string, unknown>;
  }>
> {
  const { results } = await db
    .prepare(
      `SELECT c.id, c.name, c.channel_type, c.created_at,
              other.user_id as other_user_id,
              u.username as other_username,
              u.avatar_url as other_avatar_url,
              u.status as other_status,
              u.custom_status as other_custom_status
       FROM dm_recipients me
       JOIN channels c ON c.id = me.channel_id AND c.channel_type = 'dm'
       JOIN dm_recipients other ON other.channel_id = c.id AND other.user_id != ?
       JOIN users u ON u.id = other.user_id
       WHERE me.user_id = ?
       ORDER BY c.created_at DESC`
    )
    .bind(userId, userId)
    .all();

  return (results ?? []).map((row: Record<string, unknown>) => ({
    id: row.id,
    channel_type: "dm" as const,
    name: row.other_username,
    created_at: row.created_at,
    recipient: {
      id: row.other_user_id,
      username: row.other_username,
      avatar_url: row.other_avatar_url,
      status: row.other_status,
      custom_status: row.other_custom_status,
    },
  }));
}

// ─── getOrCreateDM ───────────────────────────────────────────────────────────

export async function getOrCreateDM(
  db: D1Database,
  userId: string,
  targetUserId: string
): Promise<{
  isNew: boolean;
  dm: Record<string, unknown>;
  broadcast?: BroadcastDescriptor;
}> {
  if (targetUserId === userId) {
    throw ServiceError.badRequest("Cannot DM yourself");
  }

  const target = (await db
    .prepare(
      `SELECT id, username, avatar_url, status, custom_status FROM users WHERE id = ?`
    )
    .bind(targetUserId)
    .first()) as Record<string, unknown> | null;

  if (!target) {
    throw ServiceError.notFound("User not found");
  }

  // Check existing DM
  const existing = await db
    .prepare(
      `SELECT c.id FROM dm_recipients a
       JOIN dm_recipients b ON a.channel_id = b.channel_id
       JOIN channels c ON c.id = a.channel_id AND c.channel_type = 'dm'
       WHERE a.user_id = ? AND b.user_id = ?`
    )
    .bind(userId, targetUserId)
    .first();

  if (existing) {
    return {
      isNew: false,
      dm: {
        id: existing.id,
        channel_type: "dm",
        name: target.username,
        created_at: null,
        recipient: target,
      },
    };
  }

  // Create new DM
  const channelId = _genId();
  const now = new Date().toISOString();

  await db.batch([
    db
      .prepare(
        `INSERT INTO channels (id, server_id, name, channel_type, position, created_at)
         VALUES (?, NULL, ?, 'dm', 0, ?)`
      )
      .bind(channelId, `DM-${userId}-${targetUserId}`, now),
    db
      .prepare(
        `INSERT INTO dm_recipients (channel_id, user_id) VALUES (?, ?)`
      )
      .bind(channelId, userId),
    db
      .prepare(
        `INSERT INTO dm_recipients (channel_id, user_id) VALUES (?, ?)`
      )
      .bind(channelId, targetUserId),
  ]);

  const currentUser = await db
    .prepare(
      `SELECT id, username, avatar_url, status, custom_status FROM users WHERE id = ?`
    )
    .bind(userId)
    .first();

  return {
    isNew: true,
    dm: {
      id: channelId,
      channel_type: "dm",
      name: target.username,
      created_at: now,
      recipient: target,
    },
    broadcast: {
      type: "user",
      target: targetUserId,
      event: "DM_CHANNEL_CREATE",
      data: {
        id: channelId,
        channel_type: "dm",
        name: (currentUser as Record<string, unknown>)?.username ?? "Unknown",
        created_at: now,
        recipient: {
          id: userId,
          username:
            (currentUser as Record<string, unknown>)?.username ?? "Unknown",
          avatar_url:
            (currentUser as Record<string, unknown>)?.avatar_url ?? null,
          status:
            (currentUser as Record<string, unknown>)?.status ?? "online",
          custom_status:
            (currentUser as Record<string, unknown>)?.custom_status ?? null,
        },
      },
    },
  };
}

// ─── createInvite ────────────────────────────────────────────────────────────

export async function createInvite(
  db: D1Database,
  serverId: string,
  userId: string,
  options: {
    channel_id?: string;
    max_uses?: number;
    max_age?: number;
    temporary?: boolean;
  }
): Promise<{
  code: string;
  expires_at: string | null;
  channel_id: string | null;
}> {
  const code = _genId().split("-")[0];
  const now = new Date().toISOString();

  const expiresAt =
    options.max_age && options.max_age > 0
      ? new Date(Date.now() + options.max_age * 1000).toISOString()
      : null;

  await db
    .prepare(
      `INSERT INTO invites (code, server_id, channel_id, inviter_id, max_uses, temporary, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      code,
      serverId,
      options.channel_id ?? null,
      userId,
      options.max_uses ?? null,
      options.temporary ? 1 : 0,
      expiresAt,
      now
    )
    .run();

  return {
    code,
    expires_at: expiresAt,
    channel_id: options.channel_id ?? null,
  };
}

// ─── listInvites ─────────────────────────────────────────────────────────────

export async function listInvites(
  db: D1Database,
  serverId: string,
  showAll: boolean
): Promise<Record<string, unknown>[]> {
  let query = `
    SELECT i.*,
           c.name AS channel_name
    FROM invites i
    LEFT JOIN channels c ON c.id = i.channel_id
    WHERE i.server_id = ?`;

  if (!showAll) {
    query += `
      AND (i.expires_at IS NULL OR i.expires_at > datetime('now'))
      AND (i.max_uses IS NULL OR i.max_uses = 0 OR i.uses < i.max_uses)`;
  }

  query += `\n    ORDER BY i.created_at DESC`;

  const { results } = await db.prepare(query).bind(serverId).all();
  return results ?? [];
}

// ─── joinServer ──────────────────────────────────────────────────────────────

export async function joinServer(
  db: D1Database,
  code: string,
  userId: string,
  username: string,
  avatarUrl: string | null
): Promise<{
  joined?: boolean;
  already_member?: boolean;
  server: Record<string, unknown> | null;
  cacheKeysToInvalidate: string[];
  broadcasts?: BroadcastDescriptor[];
}> {
  const invite = (await db
    .prepare(`SELECT * FROM invites WHERE code = ?`)
    .bind(code)
    .first()) as {
      code: string;
      server_id: string;
      channel_id: string | null;
      max_uses: number | null;
      uses: number;
      temporary: number;
      expires_at: string | null;
    } | null;

  if (!invite) {
    throw ServiceError.notFound("Invalid invite");
  }

  const server = (await db
    .prepare(`SELECT * FROM servers WHERE id = ?`)
    .bind(invite.server_id)
    .first()) as Record<string, unknown> | null;

  if ((server as { invites_paused?: number })?.invites_paused) {
    throw ServiceError.forbidden(
      "Invites are currently paused for this server"
    );
  }

  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
    throw ServiceError.badRequest("Invite expired");
  }

  if (invite.max_uses && invite.uses >= invite.max_uses) {
    throw ServiceError.badRequest("Invite has reached max uses");
  }

  // Check if already a member
  const existing = await db
    .prepare(
      `SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?`
    )
    .bind(invite.server_id, userId)
    .first();

  if (existing) {
    return {
      already_member: true,
      server,
      cacheKeysToInvalidate: [],
    };
  }

  // Check if banned
  const banned = await db
    .prepare(
      `SELECT 1 FROM server_bans WHERE server_id = ? AND user_id = ?`
    )
    .bind(invite.server_id, userId)
    .first();

  if (banned) {
    throw ServiceError.forbidden("You are banned from this server");
  }

  // Get @everyone role
  const everyoneRole = (await db
    .prepare(
      `SELECT id FROM roles WHERE server_id = ? AND is_default = 1`
    )
    .bind(invite.server_id)
    .first()) as { id: string };

  const now = new Date().toISOString();

  await db.batch([
    db
      .prepare(
        `INSERT INTO server_members (server_id, user_id, joined_at)
         VALUES (?, ?, ?)`
      )
      .bind(invite.server_id, userId, now),
    db
      .prepare(
        `INSERT INTO member_roles (server_id, user_id, role_id)
         VALUES (?, ?, ?)`
      )
      .bind(invite.server_id, userId, everyoneRole.id),
    db
      .prepare(`UPDATE invites SET uses = uses + 1 WHERE code = ?`)
      .bind(code),
  ]);

  return {
    joined: true,
    server,
    cacheKeysToInvalidate: [
      CacheKey.serverMembers(invite.server_id),
      CacheKey.userServers(userId),
      CacheKey.invite(code),
    ],
    broadcasts: [
      {
        type: "all",
        event: "GUILD_MEMBER_ADD",
        data: {
          server_id: invite.server_id,
          user: {
            id: userId,
            username,
            avatar_url: avatarUrl,
            status: "online",
          },
          roles: [everyoneRole.id],
        },
      },
      {
        type: "all",
        event: "INVITE_UPDATED",
        data: {
          server_id: invite.server_id,
          code: invite.code,
          uses: invite.uses + 1,
        },
      },
    ],
  };
}

// ─── revokeInvite ────────────────────────────────────────────────────────────

export async function revokeInvite(
  db: D1Database,
  serverId: string,
  code: string
): Promise<void> {
  const invite = await db.prepare(
    `SELECT code FROM invites WHERE code = ? AND server_id = ?`
  ).bind(code, serverId).first();

  if (!invite) {
    throw ServiceError.notFound("Invite not found");
  }

  await db.prepare(`DELETE FROM invites WHERE code = ?`).bind(code).run();
}

// ─── getInviteInfo ───────────────────────────────────────────────────────────

export interface InviteInfo {
  code: string;
  server: { id: string; name: string; icon_url: string | null; member_count: number };
  inviter: { username: string; avatar_url: string | null };
}

export async function getInviteInfo(
  db: D1Database,
  code: string
): Promise<InviteInfo> {
  const invite = await db
    .prepare(
      `SELECT i.code, i.server_id, i.expires_at, i.max_uses, i.uses,
              s.name AS server_name, s.icon_url AS server_icon,
              u.username AS inviter_name, u.avatar_url AS inviter_avatar,
              (SELECT COUNT(*) FROM server_members WHERE server_id = i.server_id) AS member_count
       FROM invites i
       JOIN servers s ON s.id = i.server_id
       JOIN users u ON u.id = i.inviter_id
       WHERE i.code = ?`
    )
    .bind(code)
    .first<{
      code: string;
      server_id: string;
      expires_at: string | null;
      max_uses: number | null;
      uses: number;
      server_name: string;
      server_icon: string | null;
      inviter_name: string;
      inviter_avatar: string | null;
      member_count: number;
    }>();

  if (!invite) {
    throw ServiceError.notFound("Invite not found or expired");
  }

  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
    throw new ServiceError("Invite has expired", 410);
  }

  if (invite.max_uses && invite.uses >= invite.max_uses) {
    throw new ServiceError("Invite has reached maximum uses", 410);
  }

  return {
    code: invite.code,
    server: {
      id: invite.server_id,
      name: invite.server_name,
      icon_url: invite.server_icon,
      member_count: invite.member_count,
    },
    inviter: {
      username: invite.inviter_name,
      avatar_url: invite.inviter_avatar,
    },
  };
}
