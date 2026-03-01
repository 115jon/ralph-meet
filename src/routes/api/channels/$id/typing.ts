import { createFileRoute } from '@tanstack/react-router';

import { broadcastToChannel, requireAuth } from "@/lib/api-helpers";
import { requireChannelAccess } from "@/lib/require-channel-access";


// POST /api/channels/:id/typing — send typing indicator
const POST = async ({ request, params }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const { id: channelId } = params;

  // Verify channel access
  const accessResult = await requireChannelAccess(userId, channelId);
  if (accessResult instanceof Response) return accessResult;

  await broadcastToChannel(channelId, "TYPING_START", {
    channel_id: channelId,
    user_id: userId,
  });

  return new Response(null, { status: 204 });
}


export const Route = createFileRoute('/api/channels/$id/typing')({
  server: {
    handlers: {
      POST,
    }
  }
});
