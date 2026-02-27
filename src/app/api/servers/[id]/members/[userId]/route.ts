import { broadcastToAll, getDB, requireAuth } from "@/lib/api-helpers";
import { cacheDel, CacheKey } from "@/lib/cache";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { NextResponse } from "next/server";

// PATCH /api/servers/:id/members/:userId — update a member's role
// DEPRECATED for RBAC system. Role updates handled in PUT /api/servers/:id/members/:userId/roles
export async function PATCH(
  _request: Request,
  { params: _params }: { params: Promise<{ id: string; userId: string }> }
) {
  return NextResponse.json({ error: "Deprecated. Use /api/servers/:id/members/:userId/roles" }, { status: 400 });
}

// DELETE /api/servers/:id/members/:userId — kick a member
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId: actorId } = authResult;

  const { id: serverId, userId: targetUserId } = await params;
  const db = getDB();

  // Get actor's permissions and highest role position
  const actorPermsResult = await db.prepare(
    `SELECT SUM(r.permissions) as total_perms, MAX(r.position) as max_position
     FROM member_roles mr
     JOIN roles r ON r.id = mr.role_id
     WHERE mr.server_id = ? AND mr.user_id = ?`
  ).bind(serverId, actorId).first() as { total_perms: number | null, max_position: number | null } | null;

  if (!actorPermsResult || !actorPermsResult.total_perms || !hasPermission(actorPermsResult.total_perms, PERMISSIONS.KICK_MEMBERS)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  // Verify target is a member
  const target = await db.prepare(
    `SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?`
  ).bind(serverId, targetUserId).first();

  if (!target) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  // Retrieve target's highest role position
  const targetPermsResult = await db.prepare(
    `SELECT MAX(r.position) as max_position
     FROM member_roles mr
     JOIN roles r ON r.id = mr.role_id
     WHERE mr.server_id = ? AND mr.user_id = ?`
  ).bind(serverId, targetUserId).first() as { max_position: number | null } | null;

  const actorTopRole = actorPermsResult.max_position ?? 0;
  const targetTopRole = targetPermsResult?.max_position ?? 0;

  // Server owners (using ADMINISTRATOR flag) bypass role hierarchy for kicks,
  // but let's do a strict position check (you can't kick someone with an equal or higher role)
  if (targetTopRole >= actorTopRole && !hasPermission(actorPermsResult.total_perms, PERMISSIONS.ADMINISTRATOR)) {
    return NextResponse.json({ error: "Cannot kick a member with equal or higher role" }, { status: 403 });
  }

  await db.prepare(
    `DELETE FROM server_members WHERE server_id = ? AND user_id = ?`
  ).bind(serverId, targetUserId).run();

  // ── Cache invalidation ──
  // Member list changed + the kicked user's server list changed
  await Promise.all([
    cacheDel(CacheKey.serverMembers(serverId)),
    cacheDel(CacheKey.userServers(targetUserId)),
  ]);

  // Broadcast member removal
  await broadcastToAll("GUILD_MEMBER_REMOVE", {
    server_id: serverId,
    user_id: targetUserId,
  });

  return NextResponse.json({ kicked: true });
}
