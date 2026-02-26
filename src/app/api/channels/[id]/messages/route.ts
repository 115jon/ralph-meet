import { broadcastToChannel, genId, getDB, requireAuth } from "@/lib/api-helpers";
import { requireChannelAccess } from "@/lib/require-channel-access";
import { currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// GET /api/channels/:id/messages — get message history (paginated)
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const { id: channelId } = await params;

  // Verify the user is a member of the server that owns this channel
  const accessResult = await requireChannelAccess(userId, channelId);
  if (accessResult instanceof NextResponse) return accessResult;

  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 100);
  const before = url.searchParams.get("before"); // cursor-based pagination

  const db = getDB();

  let query: string;
  const bindings: (string | number)[] = [channelId];

  if (before) {
    query = `SELECT m.*, u.username as author_username, u.avatar_url as author_avatar_url
             FROM messages m
             LEFT JOIN users u ON u.id = m.author_id
             WHERE m.channel_id = ? AND m.created_at < ?
             ORDER BY m.created_at DESC
             LIMIT ?`;
    bindings.push(before, limit);
  } else {
    query = `SELECT m.*, u.username as author_username, u.avatar_url as author_avatar_url
             FROM messages m
             LEFT JOIN users u ON u.id = m.author_id
             WHERE m.channel_id = ?
             ORDER BY m.created_at DESC
             LIMIT ?`;
    bindings.push(limit);
  }

  const { results } = await db.prepare(query).bind(...bindings).all();

  // Reverse so oldest first in the array
  const rows = (results ?? []).reverse();
  const messageIds = rows.map((r: Record<string, unknown>) => r.id as string);

  // Batch-fetch reactions for all loaded messages
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

    // Group by message_id + emoji
    for (const r of reactionRows ?? []) {
      const msgId = r.message_id as string;
      const emoji = r.emoji as string;
      const userId = r.user_id as string;
      if (!reactionsByMessage[msgId]) reactionsByMessage[msgId] = [];
      let existing = reactionsByMessage[msgId].find((e) => e.emoji === emoji);
      if (!existing) {
        existing = { emoji, user_ids: [] };
        reactionsByMessage[msgId].push(existing);
      }
      existing.user_ids.push(userId);
    }
  }

  // Batch-fetch reply-to preview data
  const replyToIds = rows
    .map((r: Record<string, unknown>) => r.reply_to_id as string | null)
    .filter((id: string | null): id is string => !!id);
  let repliesById: Record<string, { id: string; content: string; author_id: string; author_username: string; author_avatar_url: string | null }> = {};
  if (replyToIds.length > 0) {
    const uniqueReplyIds = [...new Set(replyToIds)];
    const replyPlaceholders = uniqueReplyIds.map(() => "?").join(",");
    const { results: replyRows } = await db
      .prepare(
        `SELECT m.id, m.content, m.author_id, u.username as author_username, u.avatar_url as author_avatar_url
         FROM messages m
         LEFT JOIN users u ON u.id = m.author_id
         WHERE m.id IN (${replyPlaceholders})`
      )
      .bind(...uniqueReplyIds)
      .all();
    for (const r of replyRows ?? []) {
      repliesById[r.id as string] = {
        id: r.id as string,
        content: r.content as string,
        author_id: r.author_id as string,
        author_username: (r.author_username as string) ?? "Unknown",
        author_avatar_url: (r.author_avatar_url as string) ?? null,
      };
    }
  }

  // Batch-fetch attachments for all loaded messages
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

  const messages = rows.map((row: Record<string, unknown>) => {
    const replyData = row.reply_to_id ? repliesById[row.reply_to_id as string] : null;
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
      reply_to: replyData ? {
        id: replyData.id,
        content: replyData.content.slice(0, 200),
        author_id: replyData.author_id,
        author: {
          id: replyData.author_id,
          username: replyData.author_username,
          avatar_url: replyData.author_avatar_url,
        },
      } : undefined,
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
  });

  return NextResponse.json(messages);
}

// POST /api/channels/:id/messages — send a message (Discord-style REST mutation)
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const { id: channelId } = await params;

  // Verify the user is a member of the server that owns this channel
  const accessResult = await requireChannelAccess(userId, channelId);
  if (accessResult instanceof NextResponse) return accessResult;

  const body = await request.json() as {
    content: string;
    reply_to_id?: string;
    nonce?: string;
    attachment_ids?: string[];
  };

  const hasContent = body.content?.trim();
  const hasAttachments = body.attachment_ids && body.attachment_ids.length > 0;

  if (!hasContent && !hasAttachments) {
    return NextResponse.json({ error: "Content or attachments required" }, { status: 400 });
  }

  const db = getDB();
  const messageId = genId();
  const now = new Date().toISOString();

  await db.prepare(
    `INSERT INTO messages (id, channel_id, author_id, content, reply_to_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(messageId, channelId, userId, (body.content ?? "").trim(), body.reply_to_id ?? null, now).run();

  // Link pre-uploaded attachments to this message
  let attachments: Array<{
    id: string;
    filename: string;
    file_key: string;
    content_type: string | null;
    size_bytes: number;
    url: string;
  }> = [];

  if (hasAttachments) {
    const attIds = body.attachment_ids!;
    // Update all pending attachments to link to this message
    const placeholders = attIds.map(() => "?").join(",");
    await db.prepare(
      `UPDATE attachments SET message_id = ? WHERE id IN (${placeholders}) AND user_id = ?`
    ).bind(messageId, ...attIds, userId).run();

    // Fetch attachment details for the broadcast
    const { results: attRows } = await db.prepare(
      `SELECT id, filename, file_key, content_type, size_bytes FROM attachments WHERE id IN (${placeholders})`
    ).bind(...attIds).all();

    attachments = (attRows ?? []).map((r: Record<string, unknown>) => ({
      id: r.id as string,
      filename: r.filename as string,
      file_key: r.file_key as string,
      content_type: r.content_type as string | null,
      size_bytes: r.size_bytes as number,
      url: `/api/${r.file_key as string}`,
    }));
  }

  // Get author info
  const clerk = await currentUser();

  // If replying, fetch the referenced message preview
  let replyTo: { id: string; content: string; author_id: string; author: { id: string; username: string; avatar_url: string | null } } | undefined;
  if (body.reply_to_id) {
    const replyRow = await db.prepare(
      `SELECT m.id, m.content, m.author_id, u.username as author_username, u.avatar_url as author_avatar_url
       FROM messages m LEFT JOIN users u ON u.id = m.author_id
       WHERE m.id = ?`
    ).bind(body.reply_to_id).first() as Record<string, unknown> | null;
    if (replyRow) {
      replyTo = {
        id: replyRow.id as string,
        content: (replyRow.content as string).slice(0, 200),
        author_id: replyRow.author_id as string,
        author: {
          id: replyRow.author_id as string,
          username: (replyRow.author_username as string) ?? "Unknown",
          avatar_url: (replyRow.author_avatar_url as string) ?? null,
        },
      };
    }
  }

  const message = {
    id: messageId,
    channel_id: channelId,
    author_id: userId,
    author: {
      id: userId,
      username: clerk?.username ?? clerk?.firstName ?? "User",
      avatar_url: clerk?.imageUrl ?? null,
    },
    content: (body.content ?? "").trim(),
    reply_to_id: body.reply_to_id ?? null,
    reply_to: replyTo,
    is_pinned: false,
    created_at: now,
    updated_at: null,
    nonce: body.nonce,
    attachments,
    reactions: [],
  };

  // Broadcast MESSAGE_CREATE to all subscribed WS clients
  await broadcastToChannel(channelId, "MESSAGE_CREATE", message);

  return NextResponse.json(message, { status: 201 });
}

// PATCH /api/channels/:id/messages — edit a message
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const { id: channelId } = await params;

  // Verify the user is a member of the server that owns this channel
  const accessResult = await requireChannelAccess(userId, channelId);
  if (accessResult instanceof NextResponse) return accessResult;

  const body = await request.json() as { message_id: string; content: string };

  if (!body.message_id || !body.content?.trim()) {
    return NextResponse.json({ error: "message_id and content required" }, { status: 400 });
  }

  const db = getDB();
  const now = new Date().toISOString();

  // Verify ownership
  const msg = await db.prepare(
    `SELECT author_id FROM messages WHERE id = ? AND channel_id = ?`
  ).bind(body.message_id, channelId).first() as { author_id: string } | null;

  if (!msg) {
    return NextResponse.json({ error: "Message not found" }, { status: 404 });
  }
  if (msg.author_id !== userId) {
    return NextResponse.json({ error: "Not your message" }, { status: 403 });
  }

  await db.prepare(
    `UPDATE messages SET content = ?, updated_at = ? WHERE id = ?`
  ).bind(body.content.trim(), now, body.message_id).run();

  const update = {
    id: body.message_id,
    channel_id: channelId,
    content: body.content.trim(),
    updated_at: now,
  };

  await broadcastToChannel(channelId, "MESSAGE_UPDATE", update);

  return NextResponse.json(update);
}

// DELETE /api/channels/:id/messages — delete a message
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const { id: channelId } = await params;

  // Verify the user is a member of the server that owns this channel
  const accessResult = await requireChannelAccess(userId, channelId);
  if (accessResult instanceof NextResponse) return accessResult;

  const body = await request.json() as { message_id: string };

  if (!body.message_id) {
    return NextResponse.json({ error: "message_id required" }, { status: 400 });
  }

  const db = getDB();

  // Verify ownership (or server moderator — future enhancement)
  const msg = await db.prepare(
    `SELECT author_id FROM messages WHERE id = ? AND channel_id = ?`
  ).bind(body.message_id, channelId).first() as { author_id: string } | null;

  if (!msg) {
    return NextResponse.json({ error: "Message not found" }, { status: 404 });
  }
  if (msg.author_id !== userId) {
    return NextResponse.json({ error: "Not your message" }, { status: 403 });
  }

  await db.prepare(`DELETE FROM messages WHERE id = ?`).bind(body.message_id).run();

  await broadcastToChannel(channelId, "MESSAGE_DELETE", {
    id: body.message_id,
    channel_id: channelId,
  });

  return NextResponse.json({ deleted: true });
}
