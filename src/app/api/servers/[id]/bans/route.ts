import { broadcastToAll, getDB, requireAuth } from "@/lib/api-helpers";
import { AuditLogAction, logAuditAction } from "@/lib/audit-logger";
import { cacheDel, CacheKey } from "@/lib/cache";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { NextResponse } from "next/server";

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getUserServerPermissions(serverId: string, userId: string) {
  const db = getDB();
  const result = await db
    .prepare(
      `SELECT SUM(r.permissions) as total_perms, MAX(r.position) as max_position
       FROM member_roles mr
       JOIN roles r ON r.id = mr.role_id
       WHERE mr.server_id = ? AND mr.user_id = ?`
    )
    .bind(serverId, userId)
    .first() as { total_perms: number | null; max_position: number | null } | null;

  return result;
}

// ── GET /api/servers/:id/bans — list banned users ────────────────────────────

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const { id: serverId } = await params;
  const db = getDB();

  // Require MANAGE_SERVER or BAN_MEMBERS to view bans
  const perms = await getUserServerPermissions(serverId, userId);
  if (
    !perms?.total_perms ||
    (!hasPermission(perms.total_perms, PERMISSIONS.BAN_MEMBERS) &&
      !hasPermission(perms.total_perms, PERMISSIONS.MANAGE_SERVER) &&
      !hasPermission(perms.total_perms, PERMISSIONS.ADMINISTRATOR))
  ) {
    return NextResponse.json(
      { error: "Insufficient permissions" },
      { status: 403 }
    );
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

  return NextResponse.json(results ?? []);
}

// ── POST /api/servers/:id/bans — ban a user ──────────────────────────────────

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId: actorId } = authResult;

  const { id: serverId } = await params;

  // Rate limit
  const rl = checkRateLimit(actorId, "ban", RATE_LIMITS.DEFAULT);
  if (rl) return rl;

  const body = (await request.json()) as {
    user_id: string;
    reason?: string;
  };

  if (!body.user_id) {
    return NextResponse.json(
      { error: "user_id is required" },
      { status: 400 }
    );
  }

  const targetUserId = body.user_id;
  const db = getDB();

  // Get actor's permissions + role hierarchy
  const actorPerms = await getUserServerPermissions(serverId, actorId);
  if (
    !actorPerms?.total_perms ||
    (!hasPermission(actorPerms.total_perms, PERMISSIONS.BAN_MEMBERS) &&
      !hasPermission(actorPerms.total_perms, PERMISSIONS.ADMINISTRATOR))
  ) {
    return NextResponse.json(
      { error: "Insufficient permissions (BAN_MEMBERS required)" },
      { status: 403 }
    );
  }

  // Cannot ban yourself
  if (targetUserId === actorId) {
    return NextResponse.json(
      { error: "You cannot ban yourself" },
      { status: 400 }
    );
  }

  // Check server ownership — can't ban the owner
  const server = (await db
    .prepare(`SELECT owner_id FROM servers WHERE id = ?`)
    .bind(serverId)
    .first()) as { owner_id: string } | null;

  if (server?.owner_id === targetUserId) {
    return NextResponse.json(
      { error: "Cannot ban the server owner" },
      { status: 400 }
    );
  }

  // Role hierarchy check — can't ban someone with equal or higher role
  const targetPerms = await getUserServerPermissions(serverId, targetUserId);
  const actorTopRole = actorPerms.max_position ?? 0;
  const targetTopRole = targetPerms?.max_position ?? 0;

  if (
    targetTopRole >= actorTopRole &&
    !hasPermission(actorPerms.total_perms, PERMISSIONS.ADMINISTRATOR)
  ) {
    return NextResponse.json(
      { error: "Cannot ban a member with equal or higher role" },
      { status: 403 }
    );
  }

  const now = new Date().toISOString();

  // Ban + remove from server in a batch
  await db.batch([
    db
      .prepare(
        `INSERT OR REPLACE INTO server_bans (server_id, user_id, reason, banned_by, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(serverId, targetUserId, body.reason ?? null, actorId, now),
    db
      .prepare(
        `DELETE FROM server_members WHERE server_id = ? AND user_id = ?`
      )
      .bind(serverId, targetUserId),
    db
      .prepare(
        `DELETE FROM member_roles WHERE server_id = ? AND user_id = ?`
      )
      .bind(serverId, targetUserId),
  ]);

  // Cache invalidation
  await Promise.all([
    cacheDel(CacheKey.serverMembers(serverId)),
    cacheDel(CacheKey.userServers(targetUserId)),
  ]);

  // Broadcast member removal
  await broadcastToAll("GUILD_MEMBER_REMOVE", {
    server_id: serverId,
    user_id: targetUserId,
    banned: true,
  });

  // Audit Log
  await logAuditAction({
    db,
    serverId,
    actorId,
    actionType: AuditLogAction.MEMBER_BAN,
    targetId: targetUserId,
    reason: body.reason,
  });

  return NextResponse.json(
    { banned: true, user_id: targetUserId },
    { status: 201 }
  );
}

// ── DELETE /api/servers/:id/bans — unban a user ──────────────────────────────

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId: actorId } = authResult;

  const { id: serverId } = await params;

  const body = (await request.json()) as { user_id: string };

  if (!body.user_id) {
    return NextResponse.json(
      { error: "user_id is required" },
      { status: 400 }
    );
  }

  const db = getDB();

  // Require BAN_MEMBERS or ADMINISTRATOR
  const actorPerms = await getUserServerPermissions(serverId, actorId);
  if (
    !actorPerms?.total_perms ||
    (!hasPermission(actorPerms.total_perms, PERMISSIONS.BAN_MEMBERS) &&
      !hasPermission(actorPerms.total_perms, PERMISSIONS.ADMINISTRATOR))
  ) {
    return NextResponse.json(
      { error: "Insufficient permissions" },
      { status: 403 }
    );
  }

  await db
    .prepare(
      `DELETE FROM server_bans WHERE server_id = ? AND user_id = ?`
    )
    .bind(serverId, body.user_id)
    .run();

  // Audit Log
  await logAuditAction({
    db,
    serverId,
    actorId,
    actionType: AuditLogAction.MEMBER_UNBAN,
    targetId: body.user_id,
  });

  return NextResponse.json({ unbanned: true, user_id: body.user_id });
}
