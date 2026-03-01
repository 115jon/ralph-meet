import { apiError, apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";
import { cacheFetch, CacheKey, CacheTTL } from "@/lib/cache";
import { listServerMembers } from "@/services/server.service";


// GET /api/servers/:id/members — list server members
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
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
    () => listServerMembers(db, serverId)
  );

  return apiSuccess(members);
}
