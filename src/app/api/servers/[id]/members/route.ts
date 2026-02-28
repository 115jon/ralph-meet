import { apiSuccess, apiError, getDB, requireAuth } from "@/lib/api-helpers";
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
    return apiError("Not a member", 403);
  }

  // Cache-aside: member list for this server (2min TTL since it changes more)
  const members = await cacheFetch(
    CacheKey.serverMembers(serverId),
    CacheTTL.SERVER_MEMBERS,
    async () => {
      const { results } = await db.prepare(
        `SELECT
           sm.user_id,
           sm.joined_at,
           u.username,
           u.avatar_url,
           u.bio,
           u.status,
           u.custom_status,
           (
             SELECT json_group_array(json_object(
               'id', r.id,
               'server_id', r.server_id,
               'name', r.name,
               'color', r.color,
               'permissions', r.permissions,
               'position', r.position,
               'is_default', r.is_default,
               'created_at', r.created_at
             ))
             FROM member_roles mr
             JOIN roles r ON r.id = mr.role_id
             WHERE mr.user_id = sm.user_id AND mr.server_id = sm.server_id
             ORDER BY r.position DESC
           ) as roles_json
         FROM server_members sm
         LEFT JOIN users u ON u.id = sm.user_id
         WHERE sm.server_id = ?
         ORDER BY sm.joined_at ASC`
      ).bind(serverId).all();

      return (results ?? []).map((row: Record<string, unknown>) => ({
        joined_at: row.joined_at,
        roles: JSON.parse((row.roles_json as string) || "[]").map((r: any) => ({
          ...r,
          is_default: r.is_default === 1
        })),
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

  return apiSuccess(members);
}
