import { createFileRoute } from '@tanstack/react-router';

import { apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";
import { requireChannelAccess } from "@/lib/require-channel-access";
import { markChannelAsRead } from "@/services/message.service";


// PUT /api/channels/:id/read-state — mark channel as read (upsert)
const PUT = async ({ request, params }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const { id: channelId } = params;

  const accessResult = await requireChannelAccess(userId, channelId);
  if (accessResult instanceof Response) return accessResult;

  const db = getDB();
  const result = await markChannelAsRead(db, userId, channelId);

  return apiSuccess(result);
}


export const Route = createFileRoute('/api/channels/$id/read-state')({
  server: {
    handlers: {
      PUT,
    }
  }
});
