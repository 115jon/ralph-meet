import { apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";
import { requireChannelAccess } from "@/lib/require-channel-access";
import { markChannelAsRead } from "@/services/message.service";
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

  const accessResult = await requireChannelAccess(userId, channelId);
  if (accessResult instanceof NextResponse) return accessResult;

  const db = getDB();
  const result = await markChannelAsRead(db, userId, channelId);

  return apiSuccess(result);
}
