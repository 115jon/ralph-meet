import { apiSuccess, apiError, broadcastToAll, genId, getDB, requireAuth } from "@/lib/api-helpers";
import { PERMISSIONS } from "@/lib/permissions";
import { requireChannelPermission } from "@/lib/require-permission";
import { NextResponse } from "next/server";

// PUT /api/channels/:id/permissions/:targetId — create or update an override
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string; targetId: string }> }
) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const { id: channelId, targetId } = await params;

  const body = await request.json() as {
    target_type: 'role' | 'user';
    allow: number;
    deny: number;
  };

  if (!['role', 'user'].includes(body.target_type) || typeof body.allow !== 'number' || typeof body.deny !== 'number') {
    return apiError("Invalid payload", 400);
  }

  const db = getDB();

  const channel = await db
    .prepare(`SELECT server_id FROM channels WHERE id = ?`)
    .bind(channelId)
    .first() as { server_id: string } | null;

  if (!channel || !channel.server_id) {
    return apiError("Channel not found", 404);
  }

  // Must have MANAGE_CHANNELS
  const permResult = await requireChannelPermission(
    channel.server_id,
    channelId,
    userId,
    PERMISSIONS.MANAGE_CHANNELS
  );
  if (permResult instanceof NextResponse) return permResult;

  const id = genId();

  await db.prepare(
    `INSERT INTO channel_permission_overrides (id, channel_id, target_id, target_type, allow, deny)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(channel_id, target_id) DO UPDATE SET allow = excluded.allow, deny = excluded.deny`
  ).bind(id, channelId, targetId, body.target_type, body.allow, body.deny).run();

  await broadcastToAll("CHANNEL_UPDATE", { server_id: channel.server_id, id: channelId });

  return apiSuccess({ success: true });
}

// DELETE /api/channels/:id/permissions/:targetId — remove an override
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; targetId: string }> }
) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const { id: channelId, targetId } = await params;
  const db = getDB();

  const channel = await db
    .prepare(`SELECT server_id FROM channels WHERE id = ?`)
    .bind(channelId)
    .first() as { server_id: string } | null;

  if (!channel || !channel.server_id) {
    return apiError("Channel not found", 404);
  }

  // Must have MANAGE_CHANNELS
  const permResult = await requireChannelPermission(
    channel.server_id,
    channelId,
    userId,
    PERMISSIONS.MANAGE_CHANNELS
  );
  if (permResult instanceof NextResponse) return permResult;

  await db.prepare(
    `DELETE FROM channel_permission_overrides WHERE channel_id = ? AND target_id = ?`
  ).bind(channelId, targetId).run();

  await broadcastToAll("CHANNEL_UPDATE", { server_id: channel.server_id, id: channelId });

  return apiSuccess({ success: true });
}
