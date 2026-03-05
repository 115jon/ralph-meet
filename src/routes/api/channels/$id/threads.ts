import { createFileRoute } from '@tanstack/react-router';

import { apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";
import { requireChannelAccess } from "@/lib/require-channel-access";

// GET /api/channels/:id/threads?limit=50&before=cursor
// Returns messages that have replies (thread starters), ordered by most recent reply activity.
const GET = async ({ request, params }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const { id: channelId } = params;

  const accessResult = await requireChannelAccess(userId, channelId);
  if (accessResult instanceof Response) return accessResult;

  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "30"), 50);

  const db = getDB();

  // Find messages that have at least one reply, with the latest reply timestamp
  const { results } = await db.prepare(
    `SELECT m.id, m.content, m.author_id, m.created_at,
            u.username as author_username, u.avatar_url as author_avatar_url,
            COUNT(r.id) as reply_count,
            MAX(r.created_at) as last_reply_at
     FROM messages m
     LEFT JOIN users u ON u.id = m.author_id
     INNER JOIN messages r ON r.reply_to_id = m.id
     WHERE m.channel_id = ?
     GROUP BY m.id
     ORDER BY last_reply_at DESC
     LIMIT ?`
  ).bind(channelId, limit).all();

  const threads = (results ?? []).map((row: Record<string, unknown>) => ({
    id: row.id,
    content: (row.content as string).slice(0, 200),
    author: {
      id: row.author_id,
      username: row.author_username ?? "Unknown",
      avatar_url: row.author_avatar_url ?? null,
    },
    reply_count: row.reply_count,
    last_reply_at: row.last_reply_at,
    created_at: row.created_at,
  }));

  return apiSuccess({ threads });
};

export const Route = createFileRoute('/api/channels/$id/threads')({
  server: {
    handlers: {
      GET,
    }
  }
});
