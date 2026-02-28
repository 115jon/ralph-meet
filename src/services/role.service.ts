/**
 * Role Service — pure business logic for role operations.
 *
 * All functions accept a D1Database, return plain objects, and throw ServiceError
 * for error cases. Side effects are returned declaratively.
 */

import { AuditLogAction } from "@/lib/audit-logger";
import { CacheKey } from "@/lib/cache";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { ServiceError } from "@/lib/service-error";
import type { D1Database } from "@cloudflare/workers-types";
import type {
  AuditLogDescriptor,
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
  const result = (await db
    .prepare(
      `SELECT SUM(r.permissions) as total_perms
       FROM member_roles mr
       JOIN roles r ON r.id = mr.role_id
       WHERE mr.server_id = ? AND mr.user_id = ?`
    )
    .bind(serverId, userId)
    .first()) as { total_perms: number | null } | null;

  return result?.total_perms ?? null;
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

  const totalPerms = await getActorPermissions(db, serverId, actorId);
  if (totalPerms === null || !hasPermission(totalPerms, PERMISSIONS.MANAGE_ROLES)) {
    throw ServiceError.forbidden("Insufficient permissions");
  }

  const roleId = _genId();
  const now = new Date().toISOString();

  const lastRole = (await db
    .prepare(
      `SELECT MAX(position) as max_pos FROM roles WHERE server_id = ? AND is_default = 0`
    )
    .bind(serverId)
    .first()) as { max_pos: number | null } | null;

  const newPosition =
    lastRole && typeof lastRole.max_pos === "number" ? lastRole.max_pos + 1 : 1;

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
  const totalPerms = await getActorPermissions(db, serverId, actorId);
  if (totalPerms === null || !hasPermission(totalPerms, PERMISSIONS.MANAGE_ROLES)) {
    throw ServiceError.forbidden("Insufficient permissions");
  }

  const existingRole = (await db
    .prepare(`SELECT * FROM roles WHERE id = ? AND server_id = ?`)
    .bind(roleId, serverId)
    .first()) as Record<string, unknown> | null;

  if (!existingRole) {
    throw ServiceError.notFound("Role not found");
  }

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
  const totalPerms = await getActorPermissions(db, serverId, actorId);
  if (totalPerms === null || !hasPermission(totalPerms, PERMISSIONS.MANAGE_ROLES)) {
    throw ServiceError.forbidden("Insufficient permissions");
  }

  const existingRole = (await db
    .prepare(`SELECT * FROM roles WHERE id = ? AND server_id = ?`)
    .bind(roleId, serverId)
    .first()) as Record<string, unknown> | null;

  if (!existingRole) {
    throw ServiceError.notFound("Role not found");
  }

  if (existingRole.is_default === 1) {
    throw ServiceError.badRequest("Cannot delete @everyone role");
  }

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
