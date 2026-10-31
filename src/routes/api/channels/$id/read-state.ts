import { createFileRoute } from "@tanstack/react-router";

import {
  apiSuccess,
  broadcastToUser,
  getDB,
  requireAuth,
} from "@/lib/api-helpers";
import { requireChannelAccess } from "@/lib/require-channel-access";
import { safeParse } from "@/lib/schema";
import { Schema } from "effect";
import {
  markChannelAsRead,
  markChannelUnreadFromMessage,
} from "@/services/message.service";

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
  await broadcastToUser(userId, "READ_STATE_UPDATE", result);

  return apiSuccess(result);
};

const readStateBodySchema = Schema.Struct({
  message_id: Schema.optional(Schema.String),
});

// PATCH /api/channels/:id/read-state — mark unread starting at a message
export const PATCH = async ({ request, params }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const { id: channelId } = params;
  const body = safeParse(
    readStateBodySchema,
    await request.json().catch(() => null),
  );
  const messageId = body.success ? (body.data.message_id ?? null) : null;

  if (!messageId) {
    return new Response(JSON.stringify({ error: "message_id is required" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const accessResult = await requireChannelAccess(userId, channelId);
  if (accessResult instanceof Response) return accessResult;

  const db = getDB();
  const result = await markChannelUnreadFromMessage(
    db,
    userId,
    channelId,
    messageId,
  );
  await broadcastToUser(userId, "READ_STATE_UPDATE", result);

  return apiSuccess(result);
};

export const Route = createFileRoute("/api/channels/$id/read-state")({
  server: {
    handlers: {
      PUT,
      PATCH,
    },
  },
});
