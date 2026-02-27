import { broadcastToAll, getDB, requireAuth } from "@/lib/api-helpers";
import { cacheDelMany, CacheKey } from "@/lib/cache";
import { PERMISSIONS } from "@/lib/permissions";
import { requirePermission } from "@/lib/require-permission";
import { UpdateServerSchema } from "@/lib/validations";
import { NextResponse } from "next/server";

// PATCH /api/servers/:id/settings — update server settings
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const { id: serverId } = await params;

  const raw = await request.json();
  const parsed = UpdateServerSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const body = parsed.data;

  const db = getDB();

  // Verify RBAC: requires MANAGE_SERVER permission
  const permResult = await requirePermission(
    serverId, userId, PERMISSIONS.MANAGE_SERVER,
    "Insufficient permissions (MANAGE_SERVER required)"
  );
  if (permResult instanceof NextResponse) return permResult;

  const updates: string[] = [];
  const values: (string | null)[] = [];

  if (body.name?.trim()) {
    updates.push("name = ?");
    values.push(body.name.trim());
  }
  if (body.icon_url !== undefined) {
    updates.push("icon_url = ?");
    values.push(body.icon_url);
  }

  if (updates.length === 0) {
    return NextResponse.json({ error: "No changes" }, { status: 400 });
  }

  values.push(serverId);
  await db.prepare(
    `UPDATE servers SET ${updates.join(", ")} WHERE id = ?`
  ).bind(...values).run();

  const server = await db.prepare(
    `SELECT * FROM servers WHERE id = ?`
  ).bind(serverId).first();

  // ── Cache invalidation ──
  // Server metadata changed — invalidate the server cache.
  // Also bust every member's server list since the name/icon may have changed.
  // We fetch member user IDs to invalidate their user:servers caches.
  const { results: memberRows } = await db.prepare(
    `SELECT user_id FROM server_members WHERE server_id = ?`
  ).bind(serverId).all();

  const keysToInvalidate = [
    CacheKey.server(serverId),
    ...(memberRows ?? []).map((r: Record<string, unknown>) =>
      CacheKey.userServers(r.user_id as string)
    ),
  ];
  await cacheDelMany(keysToInvalidate);

  // Broadcast GUILD_UPDATE to all connected clients
  await broadcastToAll("GUILD_UPDATE", server);

  return NextResponse.json(server);
}

// DELETE /api/servers/:id/settings — delete a server (owner only)
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const { id: serverId } = await params;
  const db = getDB();

  // Verify owner
  const server = await db.prepare(
    `SELECT owner_id FROM servers WHERE id = ?`
  ).bind(serverId).first() as { owner_id: string } | null;

  if (!server || server.owner_id !== userId) {
    return NextResponse.json({ error: "Only the owner can delete" }, { status: 403 });
  }

  // Fetch all member user IDs BEFORE deleting (for cache invalidation)
  const { results: memberRows } = await db.prepare(
    `SELECT user_id FROM server_members WHERE server_id = ?`
  ).bind(serverId).all();

  await db.prepare(`DELETE FROM servers WHERE id = ?`).bind(serverId).run();

  // ── Cache invalidation ──
  // Server deleted — bust server, channels, members, and all member server lists
  const keysToInvalidate = [
    CacheKey.server(serverId),
    CacheKey.serverChannels(serverId),
    CacheKey.serverMembers(serverId),
    ...(memberRows ?? []).map((r: Record<string, unknown>) =>
      CacheKey.userServers(r.user_id as string)
    ),
  ];
  await cacheDelMany(keysToInvalidate);

  // Broadcast GUILD_DELETE to all connected clients
  await broadcastToAll("GUILD_DELETE", { id: serverId });

  return NextResponse.json({ deleted: true });
}
