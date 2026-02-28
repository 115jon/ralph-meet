import { apiError, apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";
import { PERMISSIONS } from "@/lib/permissions";
import { requireChannelPermission } from "@/lib/require-permission";
import { ServiceError } from "@/lib/service-error";
import { deleteChannel } from "@/services/channel.service";
import { executeAuditLog, executeBroadcast, executeInvalidation } from "@/services/service-helpers";
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

  // We need the serverId to check permissions, which deleteChannel also fetches.
  // Quick pre-check: get channel to find serverId
  const channel = await db.prepare(
    `SELECT server_id FROM channels WHERE id = ?`
  ).bind(channelId).first() as { server_id: string } | null;

  if (!channel) {
    return apiError("Channel not found", 404);
  }

  // Verify MANAGE_CHANNELS permission
  const permResult = await requireChannelPermission(channel.server_id, channelId, userId, PERMISSIONS.MANAGE_CHANNELS);
  if (permResult instanceof NextResponse) return permResult;

  try {
    const result = await deleteChannel(db, channelId);

    // Fill in the actorId for audit log
    result.auditLog.actorId = userId;

    await executeInvalidation(result.cacheKeysToInvalidate);
    await executeBroadcast(result.broadcast);
    await executeAuditLog(db, result.auditLog);

    return apiSuccess({ success: true });
  } catch (e) {
    if (e instanceof ServiceError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    }
    throw e;
  }
}
