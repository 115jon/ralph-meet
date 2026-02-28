import { getDB, requireAuth } from "@/lib/api-helpers";
import { PERMISSIONS } from "@/lib/permissions";
import { requireChannelPermission } from "@/lib/require-permission";
import { NextResponse } from "next/server";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const { id: channelId } = await params;
  const db = getDB();

  const channel = await db
    .prepare(`SELECT server_id FROM channels WHERE id = ?`)
    .bind(channelId)
    .first() as { server_id: string } | null;

  if (!channel || !channel.server_id) {
    return NextResponse.json({ error: "Channel not found" }, { status: 404 });
  }

  // Must have MANAGE_CHANNELS to view overrides
  const permResult = await requireChannelPermission(
    channel.server_id,
    channelId,
    userId,
    PERMISSIONS.MANAGE_CHANNELS
  );
  if (permResult instanceof NextResponse) return permResult;

  // Fetch overrides
  const { results: overrides } = await db
    .prepare(`
      SELECT id, target_id, target_type, allow, deny
      FROM channel_permission_overrides
      WHERE channel_id = ?
    `)
    .bind(channelId)
    .all();

  return NextResponse.json(overrides || []);
}
