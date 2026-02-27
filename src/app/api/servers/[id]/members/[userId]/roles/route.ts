import { getDB, requireAuth } from "@/lib/api-helpers";
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

// PUT /api/servers/:id/members/:userId/roles — update a member's roles
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string, userId: string }> }
) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId: requesterId } = authResult;
  const { id: serverId, userId: targetUserId } = await params;

  const db = getDB();

  // 1. Verify requester has MANAGE_ROLES permission
  const requesterPerms = await getUserServerPermissions(serverId, requesterId, db);
  if (requesterPerms === null || !hasPermission(requesterPerms, PERMISSIONS.MANAGE_ROLES)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  // 2. Validate input (array of role IDs)
  const body = (await request.json()) as { roleIds: string[] };
  if (!Array.isArray(body.roleIds)) {
    return NextResponse.json({ error: "Invalid roleIds array" }, { status: 400 });
  }

  // 3. Prevent modifying the @everyone role assignments manually
  // and ensure all requested roles belong to this server
  const serverRoles = await db.prepare(
    `SELECT id, is_default FROM roles WHERE server_id = ?`
  ).bind(serverId).all();

  const validRoleIds = new Set(serverRoles.results?.map((r: Record<string, unknown>) => r.id as string) || []);
  const everyoneRole = serverRoles.results?.find((r: Record<string, unknown>) => r.is_default === 1);

  if (!everyoneRole) {
    return NextResponse.json({ error: "Server missing @everyone role" }, { status: 500 });
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
    return NextResponse.json({ error: "User is not a member of this server" }, { status: 404 });
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

  return NextResponse.json(
    (newRoles.results ?? []).map((r: Record<string, unknown>) => ({
      ...r,
      is_default: r.is_default === 1
    }))
  );
}
