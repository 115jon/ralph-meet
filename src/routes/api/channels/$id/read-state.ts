import { createFileRoute } from '@tanstack/react-router';

import { apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";
import { requireChannelAccess } from "@/lib/require-channel-access";
import { markChannelAsRead, markChannelUnreadFromMessage } from "@/services/message.service";


// PUT /api/channels/:id/read-state — mark channel as read (upsert)
const PUT = async ({ params }: any) => {
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

// PATCH /api/channels/:id/read-state — mark unread starting at a message
const PATCH = async ({ request, params }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const { id: channelId } = params;
  const body = await request.json().catch(() => ({}));
  const messageId = typeof body.message_id === "string" ? body.message_id : null;

  if (!messageId) {
    return new Response(JSON.stringify({ error: "message_id is required" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const accessResult = await requireChannelAccess(userId, channelId);
  if (accessResult instanceof Response) return accessResult;

  const db = getDB();
  const result = await markChannelUnreadFromMessage(db, userId, channelId, messageId);

  return apiSuccess(result);
}


export const Route = createFileRoute('/api/channels/$id/read-state')({
  server: {
    handlers: {
      PUT,
      PATCH,
    }
  }
});
