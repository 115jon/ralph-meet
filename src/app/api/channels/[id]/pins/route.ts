import { broadcastToChannel, getDB, requireAuth } from "@/lib/api-helpers";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
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
  const db = getDB();

  const { results } = await db.prepare(
    `SELECT m.*, u.username as author_username, u.avatar_url as author_avatar_url
     FROM messages m
     LEFT JOIN users u ON u.id = m.author_id
     WHERE m.channel_id = ? AND m.is_pinned = 1
     ORDER BY m.created_at DESC`
  ).bind(channelId).all();

  // Batch-fetch reactions for pinned messages
  const messageIds = (results ?? []).map((r: Record<string, unknown>) => r.id as string);
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

  // Batch-fetch attachments for pinned messages
  let attachmentsByMessage: Record<string, Array<{ id: string; filename: string; file_key: string; content_type: string | null; size_bytes: number; url: string }>> = {};
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
        url: `/api/${r.file_key as string}`,
      });
    }
  }

  const messages = (results ?? []).map((row: Record<string, unknown>) => ({
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
    is_pinned: true,
    created_at: row.created_at,
    updated_at: row.updated_at,
    attachments: attachmentsByMessage[row.id as string] ?? [],
    reactions: (reactionsByMessage[row.id as string] ?? []).map((r) => ({
      emoji: r.emoji,
      count: r.user_ids.length,
      me: r.user_ids.includes(userId),
      users: r.user_ids,
    })),
  }));

  return NextResponse.json(messages);
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
    return NextResponse.json({ error: "message_id required" }, { status: 400 });
  }

  const db = getDB();

  // Verify message exists in this channel
  const msg = await db.prepare(
    `SELECT id, channel_id, is_pinned FROM messages WHERE id = ? AND channel_id = ?`
  ).bind(body.message_id, channelId).first() as { id: string; channel_id: string; is_pinned: number } | null;

  if (!msg) {
    return NextResponse.json({ error: "Message not found" }, { status: 404 });
  }

  // Check permission: verify user has MANAGE_MESSAGES in this server
  const channel = await db.prepare(
    `SELECT server_id FROM channels WHERE id = ?`
  ).bind(channelId).first() as { server_id: string } | null;

  if (channel?.server_id) {
    const memberPerms = await db.prepare(
      `SELECT SUM(r.permissions) as total_perms
       FROM member_roles mr
       JOIN roles r ON r.id = mr.role_id
       WHERE mr.server_id = ? AND mr.user_id = ?`
    ).bind(channel.server_id, userId).first();

    if (!memberPerms || !hasPermission(memberPerms.total_perms as number, PERMISSIONS.MANAGE_MESSAGES)) {
      return NextResponse.json({ error: "Insufficient permissions (MANAGE_MESSAGES required)" }, { status: 403 });
    }
  }

  // Check pin limit (Discord limits to 50 pinned messages per channel)
  if (body.pinned) {
    const { results: pinCount } = await db.prepare(
      `SELECT COUNT(*) as count FROM messages WHERE channel_id = ? AND is_pinned = 1`
    ).bind(channelId).all();
    const count = (pinCount?.[0] as Record<string, unknown>)?.count as number ?? 0;
    if (count >= 50) {
      return NextResponse.json({ error: "Maximum 50 pinned messages per channel" }, { status: 400 });
    }
  }

  const pinValue = body.pinned ? 1 : 0;
  await db.prepare(
    `UPDATE messages SET is_pinned = ? WHERE id = ?`
  ).bind(pinValue, body.message_id).run();

  // Broadcast pin/unpin event
  if (body.pinned) {
    // For pins, broadcast the full message so clients can update their pinned list even if not in history
    const { results } = await db.prepare(
      `SELECT m.*, u.username as author_username, u.avatar_url as author_avatar_url
       FROM messages m
       LEFT JOIN users u ON u.id = m.author_id
       WHERE m.id = ?`
    ).bind(body.message_id).all();

    const row = results?.[0] as Record<string, unknown> | undefined;
    if (row) {
      // Fetch attachments
      const { results: attRows } = await db.prepare(
        `SELECT id, filename, file_key, content_type, size_bytes FROM attachments WHERE message_id = ?`
      ).bind(body.message_id).all();

      const attachments = (attRows ?? []).map((r: Record<string, unknown>) => ({
        id: r.id as string,
        filename: r.filename as string,
        file_key: r.file_key as string,
        content_type: r.content_type as string | null,
        size_bytes: r.size_bytes as number,
        url: `/api/${r.file_key}`
      }));

      const fullMessage = {
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
        is_pinned: true,
        created_at: row.created_at,
        updated_at: row.updated_at,
        attachments,
        reactions: [],
      };

      await broadcastToChannel(channelId, "MESSAGE_PIN", fullMessage);
    }
  } else {
    await broadcastToChannel(channelId, "MESSAGE_UNPIN", {
      id: body.message_id,
      channel_id: channelId,
      is_pinned: false,
    });
  }

  return NextResponse.json({ id: body.message_id, is_pinned: body.pinned });
}
