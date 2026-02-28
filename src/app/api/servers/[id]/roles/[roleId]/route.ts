import { getDB, requireAuth } from "@/lib/api-helpers";
import { AuditLogAction, logAuditAction } from "@/lib/audit-logger";
import { cacheDel, CacheKey } from "@/lib/cache";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { type D1Database } from "@cloudflare/workers-types";
import { NextResponse } from "next/server";

// Helper: Get user's total permissions for this server
async function getUserServerPermissions(serverId: string, userId: string, db: D1Database): Promise<number | null> {
  const result = await db.prepare(
    `SELECT SUM(r.permissions) as total_perms
     FROM member_roles mr
     JOIN roles r ON r.id = mr.role_id
     WHERE mr.server_id = ? AND mr.user_id = ?`
  ).bind(serverId, userId).first();

  return result ? (result.total_perms as number) : null;
}

// PATCH /api/servers/:id/roles/:roleId — update a role
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string, roleId: string }> }
) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;
  const { id: serverId, roleId } = await params;

  const db = getDB();

  // Verify permissions (Requires MANAGE_ROLES)
  const totalPerms = await getUserServerPermissions(serverId, userId, db);
  if (totalPerms === null || !hasPermission(totalPerms, PERMISSIONS.MANAGE_ROLES)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  // Prevent modifying the default @everyone role's fundamental properties (like name)
  const existingRole = await db.prepare(
    `SELECT * FROM roles WHERE id = ? AND server_id = ?`
  ).bind(roleId, serverId).first();

  if (!existingRole) {
    return NextResponse.json({ error: "Role not found" }, { status: 404 });
  }

  const updates = await request.json() as {
    name?: string;
    color?: string | null;
    permissions?: number;
    position?: number;
  };

  const name = existingRole.is_default ? '@everyone' : (updates.name ?? existingRole.name);
  const color = updates.color !== undefined ? updates.color : existingRole.color;
  const permissions = updates.permissions !== undefined ? updates.permissions : existingRole.permissions;
  const position = updates.position !== undefined ? updates.position : existingRole.position;

  await db.prepare(
    `UPDATE roles SET name = ?, color = ?, permissions = ?, position = ? WHERE id = ? AND server_id = ?`
  ).bind(name, color, permissions, position, roleId, serverId).run();

  await cacheDel(CacheKey.serverMembers(serverId));

  const updatedRole = await db.prepare(`SELECT * FROM roles WHERE id = ?`).bind(roleId).first() as Record<string, any>;

  // Audit Log
  const changes: Record<string, any> = {};
  if (name !== existingRole.name) changes.name = name;
  if (color !== existingRole.color) changes.color = color;
  if (permissions !== existingRole.permissions) changes.permissions = permissions;

  if (Object.keys(changes).length > 0) {
    await logAuditAction({
      db,
      serverId,
      actorId: userId,
      actionType: AuditLogAction.ROLE_UPDATE,
      targetId: roleId,
      changes
    });
  }

  return NextResponse.json({
    ...updatedRole,
    is_default: updatedRole?.is_default === 1
  });
}

// DELETE /api/servers/:id/roles/:roleId — delete a role
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string, roleId: string }> }
) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;
  const { id: serverId, roleId } = await params;

  const db = getDB();

  // Verify permissions (Requires MANAGE_ROLES)
  const totalPerms = await getUserServerPermissions(serverId, userId, db);
  if (totalPerms === null || !hasPermission(totalPerms, PERMISSIONS.MANAGE_ROLES)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  // Prevent deleting the default @everyone role
  const existingRole = await db.prepare(
    `SELECT * FROM roles WHERE id = ? AND server_id = ?`
  ).bind(roleId, serverId).first();

  if (!existingRole) {
    return NextResponse.json({ error: "Role not found" }, { status: 404 });
  }

  if (existingRole.is_default === 1) {
    return NextResponse.json({ error: "Cannot delete @everyone role" }, { status: 400 });
  }

  // Delete the role (CASCADE handles member_roles table automatically)
  await db.prepare(
    `DELETE FROM roles WHERE id = ? AND server_id = ?`
  ).bind(roleId, serverId).run();

  await cacheDel(CacheKey.serverMembers(serverId));

  // Audit Log
  await logAuditAction({
    db,
    serverId,
    actorId: userId,
    actionType: AuditLogAction.ROLE_DELETE,
    targetId: roleId,
    changes: {
      name: existingRole.name,
    }
  });

  return NextResponse.json({ success: true });
}
