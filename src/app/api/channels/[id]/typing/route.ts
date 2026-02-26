import { broadcastToChannel, requireAuth } from "@/lib/api-helpers";
import { requireChannelAccess } from "@/lib/require-channel-access";
import { currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// POST /api/channels/:id/typing — send typing indicator
export async function POST(
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

  const clerk = await currentUser();

  await broadcastToChannel(channelId, "TYPING_START", {
    channel_id: channelId,
    user_id: clerk?.id,
  });

  return new Response(null, { status: 204 });
}
