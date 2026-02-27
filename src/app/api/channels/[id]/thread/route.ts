import { getDB, requireAuth } from "@/lib/api-helpers";
import { requireChannelAccess } from "@/lib/require-channel-access";
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

  // Verify channel access
  const accessResult = await requireChannelAccess(userId, channelId);
  if (accessResult instanceof NextResponse) return accessResult;

  const url = new URL(request.url);
  const messageId = url.searchParams.get("message_id");

  if (!messageId) {
    return NextResponse.json({ error: "message_id required" }, { status: 400 });
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
    return NextResponse.json({ error: "Message not found" }, { status: 404 });
  }

  // Fetch all replies to this message
  const { results: replyRows } = await db.prepare(
    `SELECT m.*, u.username as author_username, u.avatar_url as author_avatar_url
     FROM messages m
     LEFT JOIN users u ON u.id = m.author_id
     WHERE m.reply_to_id = ? AND m.channel_id = ?
     ORDER BY m.created_at ASC`
  ).bind(messageId, channelId).all();

  const allRows = [root, ...(replyRows ?? [])];
  const messageIds = allRows.map((r: Record<string, unknown>) => r.id as string);

  // Batch-fetch reactions
  let reactionsByMessage: Record<string, Array<{ emoji: string; user_ids: string[] }>> = {};
  if (messageIds.length > 0) {
    const placeholders = messageIds.map(() => "?").join(",");
    const { results: reactionRows } = await db
      .prepare(
        `SELECT message_id, emoji, user_id FROM message_reactions
         WHERE message_id IN (${placeholders})
         ORDER BY created_at ASC`
      )
      .bind(...messageIds)
      .all();

    for (const r of reactionRows ?? []) {
      const msgId = r.message_id as string;
      const emoji = r.emoji as string;
      const uid = r.user_id as string;
      if (!reactionsByMessage[msgId]) reactionsByMessage[msgId] = [];
      let existing = reactionsByMessage[msgId].find((e) => e.emoji === emoji);
      if (!existing) {
        existing = { emoji, user_ids: [] };
        reactionsByMessage[msgId].push(existing);
      }
      existing.user_ids.push(uid);
    }
  }

  // Batch-fetch attachments
  let attachmentsByMessage: Record<string, Array<{ id: string; filename: string; file_key: string; content_type: string | null; size_bytes: number }>> = {};
  if (messageIds.length > 0) {
    const attPlaceholders = messageIds.map(() => "?").join(",");
    const { results: attRows } = await db
      .prepare(
        `SELECT id, message_id, filename, file_key, content_type, size_bytes
         FROM attachments
         WHERE message_id IN (${attPlaceholders})
         ORDER BY created_at ASC`
      )
      .bind(...messageIds)
      .all();
    for (const r of attRows ?? []) {
      const msgId = r.message_id as string;
      if (!attachmentsByMessage[msgId]) attachmentsByMessage[msgId] = [];
      attachmentsByMessage[msgId].push({
        id: r.id as string,
        filename: r.filename as string,
        file_key: r.file_key as string,
        content_type: r.content_type as string | null,
        size_bytes: r.size_bytes as number,
      });
    }
  }

  // Shape messages
  const format = (row: Record<string, unknown>) => {
    const msgAttachments = (attachmentsByMessage[row.id as string] ?? []).map((a) => ({
      ...a,
      url: `/api/${a.file_key}`,
    }));
    return {
      id: row.id,
      channel_id: row.channel_id,
      author_id: row.author_id,
      author: {
        id: row.author_id,
        username: row.author_username ?? "Unknown",
        avatar_url: row.author_avatar_url,
      },
      content: row.content,
      reply_to_id: row.reply_to_id,
      is_pinned: !!row.is_pinned,
      created_at: row.created_at,
      updated_at: row.updated_at,
      attachments: msgAttachments,
      reactions: (reactionsByMessage[row.id as string] ?? []).map((r) => ({
        emoji: r.emoji,
        count: r.user_ids.length,
        me: r.user_ids.includes(userId),
        users: r.user_ids,
      })),
    };
  };

  return NextResponse.json({
    root: format(root),
    replies: (replyRows ?? []).map(format),
    reply_count: (replyRows ?? []).length,
  });
}
