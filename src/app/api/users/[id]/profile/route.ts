import { getDB, requireAuth } from "@/lib/api-helpers";
import { NextResponse } from "next/server";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId: currentUserId } = authResult;
  const { id: targetUserId } = await params;

  const db = getDB();

  try {
    // We run two queries in parallel via batch:
    // 1. Count mutual servers
    // 2. Count mutual friends
    const results = await db.batch([
      db.prepare(`
        SELECT COUNT(*) as count
        FROM server_members
        WHERE user_id = ? AND server_id IN (
            SELECT server_id FROM server_members WHERE user_id = ?
        )
      `).bind(targetUserId, currentUserId),
      db.prepare(`
        SELECT COUNT(*) as count
        FROM relationships r1
        WHERE r1.user_id = ? AND r1.type = 'friend' AND r1.target_user_id IN (
            SELECT target_user_id FROM relationships r2 WHERE r2.user_id = ? AND r2.type = 'friend'
        )
      `).bind(targetUserId, currentUserId)
    ]);

    const mutualServers = (results[0].results?.[0] as any)?.count || 0;
    const mutualFriends = (results[1].results?.[0] as any)?.count || 0;

    return NextResponse.json({
      userId: targetUserId,
      mutualServers,
      mutualFriends
    });
  } catch (error) {
    console.error("Failed to fetch user profile:", error);
    return NextResponse.json({ error: "Failed to fetch profile" }, { status: 500 });
  }
}
