import { apiError, apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";
import { PERMISSIONS } from "@/lib/permissions";
import { requireChannelAccess } from "@/lib/require-channel-access";
import { requirePermission } from "@/lib/require-permission";
import { ServiceError } from "@/lib/service-error";
import {
  batchFetchAttachments,
  batchFetchReactions,
  formatMessageRow,
  pinMessage,
  unpinMessage,
} from "@/services/message.service";
import { executeBroadcast } from "@/services/service-helpers";
import { NextResponse } from "next/server";

// GET /api/channels/:id/pins — get all pinned messages in the channel
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const { id: channelId } = await params;

  const accessResult = await requireChannelAccess(userId, channelId);
  if (accessResult instanceof NextResponse) return accessResult;

  const db = getDB();

  const { results } = await db.prepare(
    `SELECT m.*, u.username as author_username, u.avatar_url as author_avatar_url
     FROM messages m
     LEFT JOIN users u ON u.id = m.author_id
     WHERE m.channel_id = ? AND m.is_pinned = 1
     ORDER BY m.created_at DESC`
  ).bind(channelId).all();

  const messageIds = (results ?? []).map((r: Record<string, unknown>) => r.id as string);

  // Use shared batch-fetch from message.service
  const [reactionsByMessage, attachmentsByMessage] = await Promise.all([
    batchFetchReactions(db, messageIds),
    batchFetchAttachments(db, messageIds),
  ]);

  const messages = (results ?? []).map((row: Record<string, unknown>) =>
    formatMessageRow(row, userId, reactionsByMessage, attachmentsByMessage)
  );

  return apiSuccess(messages);
}

// PUT /api/channels/:id/pins — pin or unpin a message
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const { id: channelId } = await params;
  const body = await request.json() as { message_id: string; pinned: boolean };

  if (!body.message_id) {
    return apiError("message_id required", 400);
  }

  const db = getDB();

  // Check permission: verify user has MANAGE_MESSAGES in this server
  const channel = await db.prepare(
    `SELECT server_id FROM channels WHERE id = ?`
  ).bind(channelId).first() as { server_id: string } | null;

  if (channel?.server_id) {
    const permResult = await requirePermission(
      channel.server_id, userId, PERMISSIONS.MANAGE_MESSAGES,
      "Insufficient permissions (MANAGE_MESSAGES required)"
    );
    if (permResult instanceof NextResponse) return permResult;
  }

  try {
    if (body.pinned) {
      const result = await pinMessage(db, channelId, body.message_id);

      // For pin broadcasts, fetch the full message for clients
      const { results } = await db.prepare(
        `SELECT m.*, u.username as author_username, u.avatar_url as author_avatar_url
         FROM messages m
         LEFT JOIN users u ON u.id = m.author_id
         WHERE m.id = ?`
      ).bind(body.message_id).all();

      const row = results?.[0] as Record<string, unknown> | undefined;
      if (row) {
        const [reactions, attachments] = await Promise.all([
          batchFetchReactions(db, [body.message_id]),
          batchFetchAttachments(db, [body.message_id]),
        ]);
        const fullMessage = formatMessageRow(row, userId, reactions, attachments);
        fullMessage.is_pinned = true;

        const { broadcastToChannel } = await import("@/lib/api-helpers");
        await broadcastToChannel(channelId, "MESSAGE_PIN", fullMessage);
      }
    } else {
      const result = await unpinMessage(db, channelId, body.message_id);
      await executeBroadcast(result.broadcast);
    }

    return apiSuccess({ id: body.message_id, is_pinned: body.pinned });
  } catch (e) {
    if (e instanceof ServiceError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    }
    throw e;
  }
}
