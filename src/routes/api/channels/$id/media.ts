import { createFileRoute } from '@tanstack/react-router';

import { apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";
import { requireChannelAccess } from "@/lib/require-channel-access";

// GET /api/channels/:id/media?type=images|links|files&before=cursor&limit=50
// Returns attachments or link-containing messages for the channel, grouped by type.
const GET = async ({ request, params }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const { id: channelId } = params;

  const accessResult = await requireChannelAccess(userId, channelId);
  if (accessResult instanceof Response) return accessResult;

  const url = new URL(request.url);
  const type = url.searchParams.get("type") ?? "images"; // images | links | files
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 100);
  const before = url.searchParams.get("before"); // cursor for pagination

  const db = getDB();

  if (type === "links") {
    // Extract messages containing URLs
    const cursorClause = before ? "AND m.created_at < ?" : "";
    const bindings: (string | number)[] = [channelId];
    if (before) bindings.push(before);
    bindings.push(limit);

    const { results } = await db.prepare(
      `SELECT m.id, m.content, m.author_id, m.created_at,
              u.username as author_username, u.avatar_url as author_avatar_url
       FROM messages m
       LEFT JOIN users u ON u.id = m.author_id
       WHERE m.channel_id = ? ${cursorClause}
         AND (m.content LIKE '%http://%' OR m.content LIKE '%https://%')
       ORDER BY m.created_at DESC
       LIMIT ?`
    ).bind(...bindings).all();

    const items = (results ?? []).map((row: Record<string, unknown>) => ({
      id: row.id,
      message_id: row.id,
      content: row.content,
      author: {
        id: row.author_id,
        username: row.author_username ?? "Unknown",
        avatar_url: row.author_avatar_url ?? null,
      },
      created_at: row.created_at,
    }));

    return apiSuccess({ items, type: "links" });
  }

  // For images and files, query the attachments table
  let contentTypeFilter: string;
  if (type === "images") {
    contentTypeFilter = "AND a.content_type LIKE 'image/%'";
  } else if (type === "files") {
    // files = everything that is NOT an image and NOT a video
    contentTypeFilter = "AND a.content_type NOT LIKE 'image/%' AND a.content_type NOT LIKE 'video/%'";
  } else {
    // Default to all attachments
    contentTypeFilter = "";
  }

  const cursorClause = before ? "AND a.created_at < ?" : "";
  const bindings: (string | number)[] = [channelId];
  if (before) bindings.push(before);
  bindings.push(limit);

  const { results } = await db.prepare(
    `SELECT a.id, a.filename, a.file_key, a.content_type, a.size_bytes, a.created_at,
            a.message_id, m.author_id,
            u.username as author_username, u.avatar_url as author_avatar_url
     FROM attachments a
     LEFT JOIN messages m ON m.id = a.message_id
     LEFT JOIN users u ON u.id = m.author_id
     WHERE m.channel_id = ? ${contentTypeFilter} ${cursorClause}
     ORDER BY a.created_at DESC
     LIMIT ?`
  ).bind(...bindings).all();

  const items = (results ?? []).map((row: Record<string, unknown>) => ({
    id: row.id,
    message_id: row.message_id,
    filename: row.filename,
    url: `/api/${row.file_key as string}`,
    content_type: row.content_type,
    size_bytes: row.size_bytes,
    author: {
      id: row.author_id,
      username: row.author_username ?? "Unknown",
      avatar_url: row.author_avatar_url ?? null,
    },
    created_at: row.created_at,
  }));

  return apiSuccess({ items, type });
};

export const Route = createFileRoute('/api/channels/$id/media')({
  server: {
    handlers: {
      GET,
    }
  }
});
