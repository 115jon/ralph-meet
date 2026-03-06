import { createFileRoute } from '@tanstack/react-router';

import { apiError, apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";
import { PERMISSIONS } from "@/lib/permissions";
import { requireChannelPermission } from "@/lib/require-permission";
import { ServiceError } from "@/lib/service-error";
import { deletePermissionOverride, upsertPermissionOverride } from "@/services/channel.service";
import { executeBroadcast } from "@/services/service-helpers";


// PUT /api/channels/:id/permissions/:targetId — create or update an override
const PUT = async ({ request, params }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const { id: channelId, targetId } = params;

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

  const permResult = await requireChannelPermission(
    channel.server_id,
    channelId,
    userId,
    PERMISSIONS.MANAGE_CHANNELS
  );
  if (permResult instanceof Response) return permResult;

  try {
    const result = await upsertPermissionOverride(db, channelId, targetId, body.target_type, body.allow, body.deny);
    await executeBroadcast(result.broadcast);
    return apiSuccess({ success: true });
  } catch (e) {
    if (e instanceof ServiceError) {
      return apiError(e.message, e.status, e.code);
    }
    throw e;
  }
}

// DELETE /api/channels/:id/permissions/:targetId — remove an override
const DELETE = async ({ request, params }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const { id: channelId, targetId } = params;
  const db = getDB();

  const channel = await db
    .prepare(`SELECT server_id FROM channels WHERE id = ?`)
    .bind(channelId)
    .first() as { server_id: string } | null;

  if (!channel || !channel.server_id) {
    return apiError("Channel not found", 404);
  }

  const permResult = await requireChannelPermission(
    channel.server_id,
    channelId,
    userId,
    PERMISSIONS.MANAGE_CHANNELS
  );
  if (permResult instanceof Response) return permResult;

  try {
    const result = await deletePermissionOverride(db, channelId, targetId);
    await executeBroadcast(result.broadcast);
    return apiSuccess({ success: true });
  } catch (e) {
    if (e instanceof ServiceError) {
      return apiError(e.message, e.status, e.code);
    }
    throw e;
  }
}


export const Route = createFileRoute('/api/channels/$id/permissions/$targetId')({
  server: {
    handlers: {
      PUT,
      DELETE,
    }
  }
});
