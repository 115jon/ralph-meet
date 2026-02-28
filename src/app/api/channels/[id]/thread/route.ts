import { apiError, apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";
import { requireChannelAccess } from "@/lib/require-channel-access";
import {
  batchFetchAttachments,
  batchFetchReactions,
  formatMessageRow,
} from "@/services/message.service";
import { NextResponse } from "next/server";

// GET /api/channels/:id/thread?message_id=X
// Returns the root message + all replies to it
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const { id: channelId } = await params;

  const accessResult = await requireChannelAccess(userId, channelId);
  if (accessResult instanceof NextResponse) return accessResult;

  const url = new URL(request.url);
  const messageId = url.searchParams.get("message_id");

  if (!messageId) {
    return apiError("message_id required", 400);
  }

  const db = getDB();

  // Fetch the root message
  const root = await db.prepare(
    `SELECT m.*, u.username as author_username, u.avatar_url as author_avatar_url
     FROM messages m
     LEFT JOIN users u ON u.id = m.author_id
     WHERE m.id = ? AND m.channel_id = ?`
  ).bind(messageId, channelId).first();

  if (!root) {
    return apiError("Message not found", 404);
  }

  // Fetch all replies to this message
  const { results: replyRows } = await db.prepare(
    `SELECT m.*, u.username as author_username, u.avatar_url as author_avatar_url
     FROM messages m
     LEFT JOIN users u ON u.id = m.author_id
     WHERE m.reply_to_id = ? AND m.channel_id = ?
     ORDER BY m.created_at ASC`
  ).bind(messageId, channelId).all();

  const allRows = [root, ...(replyRows ?? [])] as Record<string, unknown>[];
  const messageIds = allRows.map((r) => r.id as string);

  // Use shared batch-fetch from message.service
  const [reactionsByMessage, attachmentsByMessage] = await Promise.all([
    batchFetchReactions(db, messageIds),
    batchFetchAttachments(db, messageIds),
  ]);

  const format = (row: Record<string, unknown>) =>
    formatMessageRow(row, userId, reactionsByMessage, attachmentsByMessage);

  return apiSuccess({
    root: format(root as Record<string, unknown>),
    replies: (replyRows ?? []).map(format),
    reply_count: (replyRows ?? []).length,
  });
}
