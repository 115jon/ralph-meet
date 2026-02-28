import { broadcastToAll, getDB, requireAuth } from "@/lib/api-helpers";
import { AuditLogAction, logAuditAction } from "@/lib/audit-logger";
import { cacheDel, CacheKey } from "@/lib/cache";
import { PERMISSIONS } from "@/lib/permissions";
import { requireChannelPermission } from "@/lib/require-permission";
import { NextResponse } from "next/server";

// DELETE /api/channels/:id — delete a channel
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;
  const { id: channelId } = await params;

  const db = getDB();

  // 1. Get channel to find serverId and verify permissions
  const channel = await db.prepare(
    `SELECT server_id, name, channel_type FROM channels WHERE id = ?`
  ).bind(channelId).first() as { server_id: string; name: string; channel_type: string } | null;

  if (!channel) {
    return NextResponse.json({ error: "Channel not found" }, { status: 404 });
  }

  const serverId = channel.server_id;

  // 2. Verify permission (must have MANAGE_CHANNELS in this channel)
  const permResult = await requireChannelPermission(serverId, channelId, userId, PERMISSIONS.MANAGE_CHANNELS);
  if (permResult instanceof NextResponse) return permResult;

  // 3. Delete the channel (cascades to messages, etc. via D1 schema)
  await db.prepare(`DELETE FROM channels WHERE id = ?`).bind(channelId).run();

  // 4. Invalidate cache and broadcast
  await cacheDel(CacheKey.serverChannels(serverId));
  await broadcastToAll("CHANNEL_DELETE", { id: channelId, server_id: serverId });

  // Audit Log
  await logAuditAction({
    db,
    serverId,
    actorId: userId,
    actionType: AuditLogAction.CHANNEL_DELETE,
    targetId: channelId,
    changes: {
      name: channel.name,
      channel_type: channel.channel_type,
    }
  });

  return NextResponse.json({ success: true });
}
