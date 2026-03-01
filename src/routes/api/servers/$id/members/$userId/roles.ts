import { createFileRoute } from '@tanstack/react-router';

import { apiSuccess, apiError, getDB, requireAuth } from "@/lib/api-helpers";
import { AuditLogAction, logAuditAction } from "@/lib/audit-logger";
import { cacheDel, CacheKey } from "@/lib/cache";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { type D1Database } from "@cloudflare/workers-types";


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

// PUT /api/servers/:id/members/:userId/roles — update a member's roles
const PUT = async ({ request, params }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId: requesterId } = authResult;
  const { id: serverId, userId: targetUserId } = params;

  const db = getDB();

  // 1. Verify requester has MANAGE_ROLES permission
  const requesterPerms = await getUserServerPermissions(serverId, requesterId, db);
  if (requesterPerms === null || !hasPermission(requesterPerms, PERMISSIONS.MANAGE_ROLES)) {
    return apiError("Insufficient permissions", 403);
  }

  // 2. Validate input (array of role IDs)
  const body = (await request.json()) as { roleIds: string[] };
  if (!Array.isArray(body.roleIds)) {
    return apiError("Invalid roleIds array", 400);
  }

  // 3. Prevent modifying the @everyone role assignments manually
  // and ensure all requested roles belong to this server
  const serverRoles = await db.prepare(
    `SELECT id, is_default FROM roles WHERE server_id = ?`
  ).bind(serverId).all();

  const validRoleIds = new Set(serverRoles.results?.map((r: Record<string, unknown>) => r.id as string) || []);
  const everyoneRole = serverRoles.results?.find((r: Record<string, unknown>) => r.is_default === 1);

  if (!everyoneRole) {
    return apiError("Server missing @everyone role", 500);
  }

  // Filter out invalid roles and the @everyone role from the incoming request
  const requestedRoles = body.roleIds.filter(id => validRoleIds.has(id) && id !== everyoneRole.id);

  // 4. Update member_roles table
  // We clear existing custom roles and re-insert the new ones + the @everyone role

  // First, verify the target user is actually a member of the server
  const targetMember = await db.prepare(
    `SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?`
  ).bind(serverId, targetUserId).first();

  if (!targetMember) {
    return apiError("User is not a member of this server", 404);
  }

  const stmts = [
    // Delete all existing roles for this user in this server
    db.prepare(`DELETE FROM member_roles WHERE server_id = ? AND user_id = ?`).bind(serverId, targetUserId),

    // Always re-add the @everyone role
    db.prepare(`INSERT INTO member_roles (server_id, user_id, role_id) VALUES (?, ?, ?)`).bind(serverId, targetUserId, everyoneRole.id)
  ];

  // Add the requested custom roles
  for (const roleId of requestedRoles) {
    stmts.push(
      db.prepare(`INSERT INTO member_roles (server_id, user_id, role_id) VALUES (?, ?, ?)`).bind(serverId, targetUserId, roleId)
    );
  }

  await db.batch(stmts);

  // Invalidate members cache
  await cacheDel(CacheKey.serverMembers(serverId));

  // Return the new roles assigned to the user
  const newRoles = await db.prepare(
    `SELECT r.* FROM member_roles mr
     JOIN roles r ON r.id = mr.role_id
     WHERE mr.server_id = ? AND mr.user_id = ?`
  ).bind(serverId, targetUserId).all();

  // Audit Log
  await logAuditAction({
    db,
    serverId,
    actorId: requesterId,
    actionType: AuditLogAction.MEMBER_ROLE_UPDATE,
    targetId: targetUserId,
    changes: {
      added_roles: requestedRoles,
    }
  });

  return apiSuccess((newRoles.results ?? []).map((r: Record<string, unknown>) => ({
      ...r,
      is_default: r.is_default === 1
    }))
  );
}


export const Route = createFileRoute('/api/servers/$id/members/$userId/roles')({
  server: {
    handlers: {
      PUT,
    }
  }
});
