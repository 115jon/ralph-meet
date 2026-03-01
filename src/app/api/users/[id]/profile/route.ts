import { apiError, apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";


const MAX_PREVIEW = 6;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId: currentUserId } = authResult;
  const { id: targetUserId } = await params;

  const db = getDB();

  try {
    // 4 queries in parallel:
    // 0 — count mutual servers
    // 1 — limited mutual server details
    // 2 — count mutual friends
    // 3 — limited mutual friend details
    const results = await db.batch([
      db.prepare(`
        SELECT COUNT(*) as count
        FROM server_members sm1
        JOIN server_members sm2 ON sm1.server_id = sm2.server_id
        WHERE sm1.user_id = ? AND sm2.user_id = ?
      `).bind(targetUserId, currentUserId),

      db.prepare(`
        SELECT s.id, s.name, s.icon_url
        FROM servers s
        JOIN server_members sm1 ON s.id = sm1.server_id
        JOIN server_members sm2 ON s.id = sm2.server_id
        WHERE sm1.user_id = ? AND sm2.user_id = ?
        LIMIT ?
      `).bind(targetUserId, currentUserId, MAX_PREVIEW),

      db.prepare(`
        SELECT COUNT(*) as count
        FROM relationships r1
        JOIN relationships r2
          ON r1.target_user_id = r2.target_user_id
        WHERE r1.user_id = ? AND r1.type = 0
          AND r2.user_id = ? AND r2.type = 0
      `).bind(targetUserId, currentUserId),

      db.prepare(`
        SELECT u.id, u.username, u.avatar_url
        FROM users u
        JOIN relationships r1 ON u.id = r1.target_user_id
        JOIN relationships r2 ON u.id = r2.target_user_id
        WHERE r1.user_id = ? AND r1.type = 0
          AND r2.user_id = ? AND r2.type = 0
        LIMIT ?
      `).bind(targetUserId, currentUserId, MAX_PREVIEW),
    ]);

    const serverCount = (results[0].results?.[0] as any)?.count || 0;
    const serverItems = (results[1].results as any[]) || [];
    const friendCount = (results[2].results?.[0] as any)?.count || 0;
    const friendItems = (results[3].results as any[]) || [];

    return apiSuccess({
      userId: targetUserId,
      mutualServers: { count: serverCount, items: serverItems },
      mutualFriends: { count: friendCount, items: friendItems },
    });
  } catch (error) {
    console.error("Failed to fetch user profile:", error);
    return apiError("Failed to fetch profile", 500);
  }
}
