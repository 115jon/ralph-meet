/**
 * Ban Service — pure business logic for server ban operations.
 *
 * All functions accept a D1Database, return plain objects, and throw ServiceError
 * for error cases. Side effects are returned declaratively.
 */

import { AuditLogAction } from "@/lib/audit-logger";
import { CacheKey } from "@/lib/cache";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { ServiceError } from "@/lib/service-error";
import type { D1Database } from "@cloudflare/workers-types";
import type { AuditLogDescriptor, BroadcastDescriptor } from "./server.service";

// ─── Shared helper ───────────────────────────────────────────────────────────

async function getActorPermsAndPosition(
  db: D1Database,
  serverId: string,
  userId: string
): Promise<{ total_perms: number | null; max_position: number | null }> {
  const result = (await db
    .prepare(
      `SELECT SUM(r.permissions) as total_perms, MAX(r.position) as max_position
       FROM member_roles mr
       JOIN roles r ON r.id = mr.role_id
       WHERE mr.server_id = ? AND mr.user_id = ?`
    )
    .bind(serverId, userId)
    .first()) as { total_perms: number | null; max_position: number | null } | null;

  return result ?? { total_perms: null, max_position: null };
}

function hasBanPermission(totalPerms: number | null): boolean {
  if (!totalPerms) return false;
  return (
    hasPermission(totalPerms, PERMISSIONS.BAN_MEMBERS) ||
    hasPermission(totalPerms, PERMISSIONS.ADMINISTRATOR)
  );
}

function hasViewBanPermission(totalPerms: number | null): boolean {
  if (!totalPerms) return false;
  return (
    hasPermission(totalPerms, PERMISSIONS.BAN_MEMBERS) ||
    hasPermission(totalPerms, PERMISSIONS.MANAGE_SERVER) ||
    hasPermission(totalPerms, PERMISSIONS.ADMINISTRATOR)
  );
}

// ─── listBans ────────────────────────────────────────────────────────────────

export async function listBans(
  db: D1Database,
  serverId: string,
  actorId: string
): Promise<Array<Record<string, unknown>>> {
  const actorPerms = await getActorPermsAndPosition(db, serverId, actorId);

  if (!hasViewBanPermission(actorPerms.total_perms)) {
    throw ServiceError.forbidden("Insufficient permissions");
  }

  const { results } = await db
    .prepare(
      `SELECT b.*, u.username, u.avatar_url, banner.username as banned_by_username
       FROM server_bans b
       LEFT JOIN users u ON u.id = b.user_id
       LEFT JOIN users banner ON banner.id = b.banned_by
       WHERE b.server_id = ?
       ORDER BY b.created_at DESC`
    )
    .bind(serverId)
    .all();

  return results ?? [];
}

// ─── banUser ─────────────────────────────────────────────────────────────────

export interface BanUserInput {
  user_id: string;
  reason?: string | null;
}

export async function banUser(
  db: D1Database,
  serverId: string,
  actorId: string,
  input: BanUserInput
): Promise<{
  cacheKeysToInvalidate: string[];
  broadcast: BroadcastDescriptor;
  auditLog: AuditLogDescriptor;
}> {
  const targetUserId = input.user_id;

  const actorPerms = await getActorPermsAndPosition(db, serverId, actorId);

  if (!hasBanPermission(actorPerms.total_perms)) {
    throw ServiceError.forbidden(
      "Insufficient permissions (BAN_MEMBERS required)"
    );
  }

  if (targetUserId === actorId) {
    throw ServiceError.badRequest("You cannot ban yourself");
  }

  // Check server ownership — can't ban the owner
  const server = (await db
    .prepare(`SELECT owner_id FROM servers WHERE id = ?`)
    .bind(serverId)
    .first()) as { owner_id: string } | null;

  if (server?.owner_id === targetUserId) {
    throw ServiceError.badRequest("Cannot ban the server owner");
  }

  // Role hierarchy check
  const targetPerms = await getActorPermsAndPosition(db, serverId, targetUserId);
  const actorTopRole = actorPerms.max_position ?? 0;
  const targetTopRole = targetPerms.max_position ?? 0;

  if (
    targetTopRole >= actorTopRole &&
    !hasPermission(actorPerms.total_perms!, PERMISSIONS.ADMINISTRATOR)
  ) {
    throw ServiceError.forbidden("Cannot ban a member with equal or higher role");
  }

  const now = new Date().toISOString();

  await db.batch([
    db
      .prepare(
        `INSERT OR REPLACE INTO server_bans (server_id, user_id, reason, banned_by, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(serverId, targetUserId, input.reason ?? null, actorId, now),
    db
      .prepare(`DELETE FROM server_members WHERE server_id = ? AND user_id = ?`)
      .bind(serverId, targetUserId),
    db
      .prepare(`DELETE FROM member_roles WHERE server_id = ? AND user_id = ?`)
      .bind(serverId, targetUserId),
  ]);

  return {
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
        banned: true,
      },
    },
    auditLog: {
      serverId,
      actorId,
      actionType: AuditLogAction.MEMBER_BAN,
      targetId: targetUserId,
      reason: input.reason ?? null,
    },
  };
}

// ─── unbanUser ───────────────────────────────────────────────────────────────

export async function unbanUser(
  db: D1Database,
  serverId: string,
  actorId: string,
  targetUserId: string
): Promise<{
  auditLog: AuditLogDescriptor;
}> {
  const actorPerms = await getActorPermsAndPosition(db, serverId, actorId);

  if (!hasBanPermission(actorPerms.total_perms)) {
    throw ServiceError.forbidden("Insufficient permissions");
  }

  await db
    .prepare(`DELETE FROM server_bans WHERE server_id = ? AND user_id = ?`)
    .bind(serverId, targetUserId)
    .run();

  return {
    auditLog: {
      serverId,
      actorId,
      actionType: AuditLogAction.MEMBER_UNBAN,
      targetId: targetUserId,
    },
  };
}
