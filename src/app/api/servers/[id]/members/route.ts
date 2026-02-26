import { getDB, requireAuth } from "@/lib/api-helpers";
import { cacheFetch, CacheKey, CacheTTL } from "@/lib/cache";
import { NextResponse } from "next/server";

// GET /api/servers/:id/members — list server members
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;
  const { id: serverId } = await params;

  const db = getDB();

  // Verify membership (security check — always hits D1)
  const member = await db.prepare(
    `SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?`
  ).bind(serverId, userId).first();

  if (!member) {
    return NextResponse.json({ error: "Not a member" }, { status: 403 });
  }

  // Cache-aside: member list for this server (2min TTL since it changes more)
  const members = await cacheFetch(
    CacheKey.serverMembers(serverId),
    CacheTTL.SERVER_MEMBERS,
    async () => {
      const { results } = await db.prepare(
        `SELECT sm.*, u.username, u.avatar_url, u.bio, u.status, u.custom_status
         FROM server_members sm
         LEFT JOIN users u ON u.id = sm.user_id
         WHERE sm.server_id = ?
         ORDER BY sm.role DESC, sm.joined_at ASC`
      ).bind(serverId).all();

      return (results ?? []).map((row: Record<string, unknown>) => ({
        joined_at: row.joined_at,
        role: row.role,
        user: {
          id: row.user_id,
          username: row.username ?? "Unknown",
          avatar_url: row.avatar_url,
          bio: row.bio,
          status: row.status ?? "offline",
          custom_status: row.custom_status,
        },
      }));
    }
  );

  return NextResponse.json(members);
}
