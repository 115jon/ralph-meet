import { broadcastToAll, getDB, requireAuth } from "@/lib/api-helpers";
import { cacheDel, CacheKey } from "@/lib/cache";
import { UpdateRoleSchema } from "@/lib/validations";
import { NextResponse } from "next/server";

// PATCH /api/servers/:id/members/:userId — update a member's role
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId: actorId } = authResult;

  const { id: serverId, userId: targetUserId } = await params;

  const raw = await request.json();
  const parsed = UpdateRoleSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const { role } = parsed.data;

  const db = getDB();

  // Get actor's role
  const actor = await db.prepare(
    `SELECT role FROM server_members WHERE server_id = ? AND user_id = ?`
  ).bind(serverId, actorId).first() as { role: number } | null;

  if (!actor || actor.role < 2) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  // Get target's current role
  const target = await db.prepare(
    `SELECT role FROM server_members WHERE server_id = ? AND user_id = ?`
  ).bind(serverId, targetUserId).first() as { role: number } | null;

  if (!target) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  // Can't modify someone with equal or higher role
  if (target.role >= actor.role) {
    return NextResponse.json({ error: "Cannot modify a member with equal or higher role" }, { status: 403 });
  }

  // Can't assign a role equal to or higher than your own
  if (role >= actor.role) {
    return NextResponse.json({ error: "Cannot assign a role equal to or higher than your own" }, { status: 403 });
  }

  await db.prepare(
    `UPDATE server_members SET role = ? WHERE server_id = ? AND user_id = ?`
  ).bind(role, serverId, targetUserId).run();

  // ── Cache invalidation ──
  // Member list changed
  await cacheDel(CacheKey.serverMembers(serverId));

  // Broadcast role change
  await broadcastToAll("GUILD_MEMBER_UPDATE", {
    server_id: serverId,
    user_id: targetUserId,
    role,
  });

  return NextResponse.json({ updated: true });
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

  // Get actor's role
  const actor = await db.prepare(
    `SELECT role FROM server_members WHERE server_id = ? AND user_id = ?`
  ).bind(serverId, actorId).first() as { role: number } | null;

  if (!actor || actor.role < 1) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  // Get target's role
  const target = await db.prepare(
    `SELECT role FROM server_members WHERE server_id = ? AND user_id = ?`
  ).bind(serverId, targetUserId).first() as { role: number } | null;

  if (!target) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  // Can't kick someone with equal or higher role
  if (target.role >= actor.role) {
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
