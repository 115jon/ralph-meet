import { createFileRoute } from '@tanstack/react-router';

import { apiError, apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";
import { PERMISSIONS } from "@/lib/permissions";
import { requireChannelPermission } from "@/lib/require-permission";
import { ServiceError } from "@/lib/service-error";
import { deleteChannel, updateChannel } from "@/services/channel.service";
import { executeAuditLog, executeBroadcast, executeInvalidation } from "@/services/service-helpers";


// PATCH /api/channels/:id — update channel name/description
const PATCH = async ({ request, params }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;
  const { id: channelId } = params;

  const db = getDB();

  const channel = await db.prepare(
    `SELECT server_id FROM channels WHERE id = ?`
  ).bind(channelId).first() as { server_id: string } | null;

  if (!channel) {
    return apiError("Channel not found", 404);
  }

  const permResult = await requireChannelPermission(channel.server_id, channelId, userId, PERMISSIONS.MANAGE_CHANNELS);
  if (permResult instanceof Response) return permResult;

  try {
    const body = await request.json();
    const { name, description, allow_public_shares } = body as { name?: string; description?: string | null; allow_public_shares?: boolean | null };

    if (name === undefined && description === undefined && allow_public_shares === undefined) {
      return apiError("Nothing to update", 400);
    }

    const result = await updateChannel(db, channelId, userId, { name, description, allow_public_shares });

    await executeInvalidation(result.cacheKeysToInvalidate);
    await executeBroadcast(result.broadcast);
    await executeAuditLog(db, result.auditLog);

    return apiSuccess(result.channel);
  } catch (e) {
    if (e instanceof ServiceError) {
      return Response.json({ error: e.message, code: e.code }, { status: e.status });
    }
    throw e;
  }
};

// DELETE /api/channels/:id — delete a channel
const DELETE = async ({ request, params }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;
  const { id: channelId } = params;

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
  if (permResult instanceof Response) return permResult;

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
      return Response.json({ error: e.message, code: e.code }, { status: e.status });
    }
    throw e;
  }
}


export const Route = createFileRoute('/api/channels/$id')({
  server: {
    handlers: {
      PATCH,
      DELETE,
    }
  }
});
