import { createFileRoute } from '@tanstack/react-router';

import { apiSuccess, apiError, getDB, requireAuth } from "@/lib/api-helpers";
import { PERMISSIONS } from "@/lib/permissions";
import { requireChannelPermission } from "@/lib/require-permission";


const GET = async ({ request, params }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const { id: channelId } = params;
  const db = getDB();

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

  // Fetch overrides
  const { results: overrides } = await db
    .prepare(`
      SELECT id, target_id, target_type, allow, deny
      FROM channel_permission_overrides
      WHERE channel_id = ?
    `)
    .bind(channelId)
    .all();

  return apiSuccess(overrides || []);
}


export const Route = createFileRoute('/api/channels/$id/permissions')({
  server: {
    handlers: {
      GET,
    }
  }
});
