import { createFileRoute } from '@tanstack/react-router';

import { apiError, apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";
import { PERMISSIONS } from "@/lib/permissions";
import { requireChannelPermission } from "@/lib/require-permission";
import { ServiceError } from "@/lib/service-error";
import { listPermissionOverrides } from "@/services/channel.service";


const GET = async ({ request, params }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const { id: channelId } = params;
  const db = getDB();

  // Need to get serverId for permission check
  const channel = await db
    .prepare(`SELECT server_id FROM channels WHERE id = ?`)
    .bind(channelId)
    .first() as { server_id: string } | null;

  if (!channel || !channel.server_id) {
    return apiError("Channel not found", 404);
  }

  // Must have MANAGE_CHANNELS to view overrides
  const permResult = await requireChannelPermission(
    channel.server_id,
    channelId,
    userId,
    PERMISSIONS.MANAGE_CHANNELS
  );
  if (permResult instanceof Response) return permResult;

  try {
    const overrides = await listPermissionOverrides(db, channelId);
    return apiSuccess(overrides);
  } catch (e) {
    if (e instanceof ServiceError) {
      return apiError(e.message, e.status, e.code);
    }
    throw e;
  }
}


export const Route = createFileRoute('/api/channels/$id/permissions')({
  server: {
    handlers: {
      GET,
    }
  }
});
