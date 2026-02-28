import { apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";
import { requireChannelAccess } from "@/lib/require-channel-access";
import { NextResponse } from "next/server";

// PUT /api/channels/:id/read-state — mark channel as read (upsert)
export async function PUT(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const { id: channelId } = await params;

  // Verify channel access
  const accessResult = await requireChannelAccess(userId, channelId);
  if (accessResult instanceof NextResponse) return accessResult;

  const now = new Date().toISOString();

  const db = getDB();

  await db.prepare(
    `INSERT INTO read_states (user_id, channel_id, last_read_at)
     VALUES (?, ?, ?)
     ON CONFLICT(user_id, channel_id) DO UPDATE SET last_read_at = excluded.last_read_at`
  ).bind(userId, channelId, now).run();

  return apiSuccess({ channel_id: channelId, last_read_at: now });
}
