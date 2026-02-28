import { apiSuccess, apiError, getDB, requireAuth } from "@/lib/api-helpers";
import { NextResponse } from "next/server";

// GET /api/notifications — fetch user's notifications (most recent first)
export async function GET(request: Request) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 100);
  const unreadOnly = url.searchParams.get("unread") === "true";

  const db = getDB();

  const whereClause = unreadOnly
    ? "WHERE n.user_id = ? AND n.is_read = 0"
    : "WHERE n.user_id = ?";

  const { results } = await db
    .prepare(
      `SELECT n.*,
              u.username as from_username, u.avatar_url as from_avatar_url,
              c.name as channel_name,
              s.name as server_name
       FROM notifications n
       LEFT JOIN users u ON u.id = n.from_user_id
       LEFT JOIN channels c ON c.id = n.channel_id
       LEFT JOIN servers s ON s.id = n.server_id
       ${whereClause}
       ORDER BY n.created_at DESC
       LIMIT ?`
    )
    .bind(...(unreadOnly ? [userId] : [userId]), limit)
    .all();

  // Get unread count separately (always useful for badge)
  const countRow = await db
    .prepare(
      `SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0`
    )
    .bind(userId)
    .first() as { count: number } | null;

  const notifications = (results ?? []).map(
    (r: Record<string, unknown>) => ({
      id: r.id,
      type: r.type,
      channel_id: r.channel_id,
      server_id: r.server_id,
      message_id: r.message_id,
      from_user: {
        id: r.from_user_id,
        username: r.from_username ?? "Unknown",
        avatar_url: r.from_avatar_url,
      },
      content: r.content,
      is_read: !!r.is_read,
      created_at: r.created_at,
      channel_name: r.channel_name,
      server_name: r.server_name,
    })
  );

  return NextResponse.json({
    notifications,
    unread_count: countRow?.count ?? 0,
  });
}

// PATCH /api/notifications — mark notifications as read
export async function PATCH(request: Request) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const body = (await request.json()) as {
    ids?: string[];
    all?: boolean;
  };

  const db = getDB();

  if (body.all) {
    await db
      .prepare(
        `UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0`
      )
      .bind(userId)
      .run();
  } else if (body.ids && body.ids.length > 0) {
    const placeholders = body.ids.map(() => "?").join(",");
    await db
      .prepare(
        `UPDATE notifications SET is_read = 1 WHERE user_id = ? AND id IN (${placeholders})`
      )
      .bind(userId, ...body.ids)
      .run();
  } else {
    return apiError("Provide ids array or all: true", 400);
  }

  return apiSuccess({ success: true });
}

// DELETE /api/notifications — clear all notifications
export async function DELETE() {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const db = getDB();
  await db
    .prepare(`DELETE FROM notifications WHERE user_id = ?`)
    .bind(userId)
    .run();

  return apiSuccess({ cleared: true });
}
