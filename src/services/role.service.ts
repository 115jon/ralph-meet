/**
 * Role Service — pure business logic for role operations.
 *
 * All functions accept a D1Database, return plain objects, and throw ServiceError
 * for error cases. Side effects are returned declaratively.
 */

import { AuditLogAction } from "@/lib/audit-logger";
import { CacheKey } from "@/lib/cache";
import { calculatePermissions, hasPermission, PERMISSIONS } from "@/lib/permissions";
import { ServiceError } from "@/lib/service-error";
import type { D1Database } from "@cloudflare/workers-types";
import type {
  AuditLogDescriptor,
  BroadcastDescriptor,
  ServiceResult
} from "./server.service";

// ─── ID generator (injectable for testing) ───────────────────────────────────

let _genId = (): string => crypto.randomUUID();

export function setRoleIdGenerator(fn: () => string): void {
  _genId = fn;
}

// ─── Shared helper ───────────────────────────────────────────────────────────

async function getActorPermissions(
  db: D1Database,
  serverId: string,
  userId: string
): Promise<number | null> {
  const { results } = await db
    .prepare(
      `SELECT r.permissions
       FROM member_roles mr
       JOIN roles r ON r.id = mr.role_id
       JOIN server_members sm ON sm.server_id = mr.server_id AND sm.user_id = mr.user_id
       WHERE mr.server_id = ? AND mr.user_id = ?`
    )
    .bind(serverId, userId)
    .all();

  if (!results || results.length === 0) return null;
  return calculatePermissions(results.map((row) => row.permissions as number));
}

async function getActorRoleContext(
  db: D1Database,
  serverId: string,
  userId: string
): Promise<{ totalPermissions: number; topPosition: number; isOwner: boolean } | null> {
  const { results } = await db
    .prepare(
      `SELECT r.permissions, r.position, s.owner_id
       FROM server_members sm
       JOIN member_roles mr ON mr.server_id = sm.server_id AND mr.user_id = sm.user_id
       JOIN roles r ON r.id = mr.role_id
       JOIN servers s ON s.id = sm.server_id
       WHERE sm.server_id = ? AND sm.user_id = ?`
    )
    .bind(serverId, userId)
    .all();

  if (!results || results.length === 0) return null;

  const totalPermissions = calculatePermissions(results.map((row) => row.permissions as number));
  const topPosition = results.reduce(
    (max, row) => Math.max(max, (row.position as number) ?? 0),
    0
  );
  const ownerId = results[0].owner_id as string;

  return {
    totalPermissions,
    topPosition,
    isOwner: ownerId === userId,
  };
}

async function getRoleRecord(
  db: D1Database,
  serverId: string,
  roleId: string
): Promise<Record<string, unknown> | null> {
  return (await db
    .prepare(`SELECT * FROM roles WHERE id = ? AND server_id = ?`)
    .bind(roleId, serverId)
    .first()) as Record<string, unknown> | null;
}

async function assertManageRolesAuthority(
  db: D1Database,
  serverId: string,
  actorId: string,
  options: {
    targetRole?: Record<string, unknown> | null;
    targetUserId?: string;
    requestedRoleIds?: string[];
    requestedPermissions?: number;
    requestedPosition?: number;
  } = {}
): Promise<{ totalPermissions: number; topPosition: number; isOwner: boolean }> {
  const actorContext = await getActorRoleContext(db, serverId, actorId);
  if (!actorContext || !hasPermission(actorContext.totalPermissions, PERMISSIONS.MANAGE_ROLES)) {
    throw ServiceError.forbidden("Insufficient permissions");
  }

  const {
    targetRole,
    targetUserId,
    requestedRoleIds = [],
    requestedPermissions,
    requestedPosition,
  } = options;

  if (actorContext.isOwner) {
    return actorContext;
  }

  if (targetRole) {
    const targetRolePosition = (targetRole.position as number) ?? 0;
    if (targetRolePosition >= actorContext.topPosition) {
      throw ServiceError.forbidden("Cannot manage a role with equal or higher position");
    }
  }

  if (requestedPermissions !== undefined && hasPermission(requestedPermissions, PERMISSIONS.ADMINISTRATOR)) {
    throw ServiceError.forbidden("Only the server owner can grant administrator");
  }

  if (requestedPosition !== undefined && requestedPosition >= actorContext.topPosition) {
    throw ServiceError.forbidden("Cannot move a role to equal or higher than your top role");
  }

  if (requestedRoleIds.length > 0) {
    const placeholders = requestedRoleIds.map(() => "?").join(",");
    const { results } = await db
      .prepare(
        `SELECT id, permissions, position
         FROM roles
         WHERE server_id = ? AND id IN (${placeholders})`
      )
      .bind(serverId, ...requestedRoleIds)
      .all();

    for (const role of results ?? []) {
      const rolePosition = (role.position as number) ?? 0;
      if (rolePosition >= actorContext.topPosition) {
        throw ServiceError.forbidden("Cannot assign a role with equal or higher position");
      }
      if (hasPermission(role.permissions as number, PERMISSIONS.ADMINISTRATOR)) {
        throw ServiceError.forbidden("Only the server owner can assign administrator");
      }
    }
  }

  if (targetUserId) {
    const targetContext = await getActorRoleContext(db, serverId, targetUserId);
    if (!targetContext) {
      throw ServiceError.notFound("User is not a member of this server");
    }
    if (targetContext.topPosition >= actorContext.topPosition) {
      throw ServiceError.forbidden("Cannot manage a member with equal or higher top role");
    }
  }

  return actorContext;
}

// ─── listServerRoles ─────────────────────────────────────────────────────────

export async function listServerRoles(
  db: D1Database,
  serverId: string,
  actorId: string
): Promise<Array<Record<string, unknown>>> {
  // Verify membership
  const member = await db
    .prepare(`SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?`)
    .bind(serverId, actorId)
    .first();

  if (!member) {
    throw ServiceError.forbidden("Not a member");
  }

  const { results } = await db
    .prepare(`SELECT * FROM roles WHERE server_id = ? ORDER BY position DESC`)
    .bind(serverId)
    .all();

  return (results ?? []).map((r: Record<string, unknown>) => ({
    ...r,
    is_default: r.is_default === 1,
  }));
}

// ─── createRole ──────────────────────────────────────────────────────────────

export interface CreateRoleInput {
  name: string;
  color?: string | null;
  permissions?: number;
}

export async function createRole(
  db: D1Database,
  serverId: string,
  actorId: string,
  input: CreateRoleInput
): Promise<ServiceResult<{ name: string; id: string;[key: string]: unknown }>> {
  const name = input.name.trim();
  if (!name) {
    throw ServiceError.badRequest("Name is required");
  }

  const actorContext = await assertManageRolesAuthority(db, serverId, actorId, {
    requestedPermissions: input.permissions ?? 0,
  });

  const roleId = _genId();
  const now = new Date().toISOString();

  const lastRole = (await db
    .prepare(
      `SELECT MAX(position) as max_pos FROM roles WHERE server_id = ? AND is_default = 0`
    )
    .bind(serverId)
    .first()) as { max_pos: number | null } | null;

  const newPosition =
    lastRole && typeof lastRole.max_pos === "number"
      ? Math.min(lastRole.max_pos + 1, actorContext.topPosition - 1)
      : 1;

  if (newPosition >= actorContext.topPosition) {
    throw ServiceError.forbidden("Cannot create a role at or above your top role");
  }

  await db
    .prepare(
      `INSERT INTO roles (id, server_id, name, color, permissions, position, is_default, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)`
    )
    .bind(
      roleId,
      serverId,
      name,
      input.color ?? null,
      input.permissions ?? 0,
      newPosition,
      now
    )
    .run();

  const newRole = (await db
    .prepare(`SELECT * FROM roles WHERE id = ?`)
    .bind(roleId)
    .first()) as Record<string, unknown>;

  return {
    data: {
      ...(newRole ?? {}),
      name,
      id: roleId,
      is_default: false,
    },
    cacheKeysToInvalidate: [CacheKey.serverMembers(serverId)],
    auditLog: {
      serverId,
      actorId,
      actionType: AuditLogAction.ROLE_CREATE,
      targetId: roleId,
      changes: {
        name: newRole?.name ?? name,
        color: newRole?.color,
        permissions: newRole?.permissions,
      },
    },
  };
}

// ─── updateRole ──────────────────────────────────────────────────────────────

export interface UpdateRoleInput {
  name?: string;
  color?: string | null;
  permissions?: number;
  position?: number;
}

export async function updateRole(
  db: D1Database,
  serverId: string,
  roleId: string,
  actorId: string,
  input: UpdateRoleInput
): Promise<
  Omit<ServiceResult<null>, "data"> & {
    auditLog?: AuditLogDescriptor | undefined;
    cacheKeysToInvalidate: string[];
  }
> {
  const existingRole = await getRoleRecord(db, serverId, roleId);

  if (!existingRole) {
    throw ServiceError.notFound("Role not found");
  }

  await assertManageRolesAuthority(db, serverId, actorId, {
    targetRole: existingRole,
    requestedPermissions: input.permissions,
    requestedPosition: input.position,
  });

  // Preserve @everyone name for default roles
  const name =
    existingRole.is_default === 1
      ? "@everyone"
      : (input.name ?? (existingRole.name as string));
  const color =
    input.color !== undefined ? input.color : existingRole.color;
  const permissions =
    input.permissions !== undefined
      ? input.permissions
      : existingRole.permissions;
  const position =
    input.position !== undefined ? input.position : existingRole.position;

  await db
    .prepare(
      `UPDATE roles SET name = ?, color = ?, permissions = ?, position = ? WHERE id = ? AND server_id = ?`
    )
    .bind(name, color, permissions, position, roleId, serverId)
    .run();

  // Build changes from explicitly provided input fields (not DB diff)
  const changes: Record<string, unknown> = {};
  if (input.name !== undefined && existingRole.is_default !== 1) changes.name = name;
  if (input.color !== undefined) changes.color = color;
  if (input.permissions !== undefined) changes.permissions = permissions;
  if (input.position !== undefined) changes.position = position;

  // Always emit audit log — the route was explicitly called
  const auditLog: AuditLogDescriptor = {
    serverId,
    actorId,
    actionType: AuditLogAction.ROLE_UPDATE,
    targetId: roleId,
    changes,
  };

  return {
    cacheKeysToInvalidate: [CacheKey.serverMembers(serverId)],
    auditLog,
  };
}

// ─── deleteRole ──────────────────────────────────────────────────────────────

export async function deleteRole(
  db: D1Database,
  serverId: string,
  roleId: string,
  actorId: string
): Promise<{
  cacheKeysToInvalidate: string[];
  auditLog: AuditLogDescriptor;
}> {
  const existingRole = await getRoleRecord(db, serverId, roleId);

  if (!existingRole) {
    throw ServiceError.notFound("Role not found");
  }

  if (existingRole.is_default === 1) {
    throw ServiceError.badRequest("Cannot delete @everyone role");
  }

  await assertManageRolesAuthority(db, serverId, actorId, {
    targetRole: existingRole,
  });

  await db
    .prepare(`DELETE FROM roles WHERE id = ? AND server_id = ?`)
    .bind(roleId, serverId)
    .run();

  return {
    cacheKeysToInvalidate: [CacheKey.serverMembers(serverId)],
    auditLog: {
      serverId,
      actorId,
      actionType: AuditLogAction.ROLE_DELETE,
      targetId: roleId,
      changes: { name: existingRole.name },
    },
  };
}

// ─── updateMemberRoles ───────────────────────────────────────────────────────

export async function updateMemberRoles(
  db: D1Database,
  serverId: string,
  targetUserId: string,
  requesterId: string,
  roleIds: string[]
): Promise<{
  roles: Array<Record<string, unknown>>;
  cacheKeysToInvalidate: string[];
  broadcast: BroadcastDescriptor;
  auditLog: AuditLogDescriptor;
}> {
  // Verify requester has MANAGE_ROLES permission
  await assertManageRolesAuthority(db, serverId, requesterId, {
    targetUserId,
    requestedRoleIds: roleIds,
  });

  // Get all server roles to validate input
  const serverRoles = await db.prepare(
    `SELECT id, is_default FROM roles WHERE server_id = ?`
  ).bind(serverId).all();

  const validRoleIds = new Set(serverRoles.results?.map((r: Record<string, unknown>) => r.id as string) || []);
  const everyoneRole = serverRoles.results?.find((r: Record<string, unknown>) => r.is_default === 1);

  if (!everyoneRole) {
    throw ServiceError.badRequest("Server missing @everyone role");
  }

  // Filter out invalid roles and the @everyone role
  const requestedRoles = roleIds.filter(id => validRoleIds.has(id) && id !== everyoneRole.id);

  const stmts = [
    db.prepare(`DELETE FROM member_roles WHERE server_id = ? AND user_id = ?`).bind(serverId, targetUserId),
    db.prepare(`INSERT INTO member_roles (server_id, user_id, role_id) VALUES (?, ?, ?)`).bind(serverId, targetUserId, everyoneRole.id),
  ];

  for (const roleId of requestedRoles) {
    stmts.push(
      db.prepare(`INSERT INTO member_roles (server_id, user_id, role_id) VALUES (?, ?, ?)`).bind(serverId, targetUserId, roleId)
    );
  }

  await db.batch(stmts);

  // Return the new roles
  const newRoles = await db.prepare(
    `SELECT r.* FROM member_roles mr
     JOIN roles r ON r.id = mr.role_id
     WHERE mr.server_id = ? AND mr.user_id = ?`
  ).bind(serverId, targetUserId).all();

  const roles = (newRoles.results ?? []).map((r: Record<string, unknown>) => ({
      ...r,
      is_default: r.is_default === 1,
    }));

  return {
    roles,
    cacheKeysToInvalidate: [CacheKey.serverMembers(serverId)],
    broadcast: {
      type: "server",
      target: serverId,
      event: "GUILD_MEMBER_UPDATE",
      data: {
        server_id: serverId,
        user_id: targetUserId,
        roles,
      },
    },
    auditLog: {
      serverId,
      actorId: requesterId,
      actionType: AuditLogAction.MEMBER_ROLE_UPDATE,
      targetId: targetUserId,
      changes: { added_roles: requestedRoles },
    },
  };
}
