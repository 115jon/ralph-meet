import { getDB, requireAuth } from "@/lib/api-helpers";
import { NextResponse } from "next/server";

// GET /api/servers/:id/search?q=query&limit=25&offset=0
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;
  const { id: serverId } = await params;

  const db = getDB();

  // Verify membership
  const member = await db.prepare(
    `SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?`
  ).bind(serverId, userId).first();

  if (!member) {
    return NextResponse.json({ error: "Not a member" }, { status: 403 });
  }

  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim();
  if (!query || query.length < 2) {
    return NextResponse.json({ error: "Query must be at least 2 characters" }, { status: 400 });
  }

  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "25"), 50);
  const offset = parseInt(url.searchParams.get("offset") ?? "0");

  // Search messages in all channels of this server using LIKE
  const { results } = await db.prepare(
    `SELECT m.id, m.channel_id, m.author_id, m.content, m.created_at, m.is_pinned,
            u.username as author_username, u.avatar_url as author_avatar_url,
            c.name as channel_name
     FROM messages m
     JOIN channels c ON c.id = m.channel_id AND c.server_id = ?
     LEFT JOIN users u ON u.id = m.author_id
     WHERE m.content LIKE ?
     ORDER BY m.created_at DESC
     LIMIT ? OFFSET ?`
  ).bind(serverId, `%${query}%`, limit, offset).all();

  // Get total count for pagination
  const countRow = await db.prepare(
    `SELECT COUNT(*) as total
     FROM messages m
     JOIN channels c ON c.id = m.channel_id AND c.server_id = ?
     WHERE m.content LIKE ?`
  ).bind(serverId, `%${query}%`).first() as { total: number } | null;

  const messages = (results ?? []).map((row: Record<string, unknown>) => ({
    id: row.id,
    channel_id: row.channel_id,
    channel_name: row.channel_name,
    author_id: row.author_id,
    author: {
      id: row.author_id,
      username: row.author_username ?? "Unknown",
      avatar_url: row.author_avatar_url,
    },
    content: row.content,
    is_pinned: !!row.is_pinned,
    created_at: row.created_at,
  }));

  return NextResponse.json({
    messages,
    total: countRow?.total ?? 0,
    limit,
    offset,
  });
}
