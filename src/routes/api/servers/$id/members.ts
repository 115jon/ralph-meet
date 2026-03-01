import { createFileRoute } from '@tanstack/react-router';

import { apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";
import { cacheFetch, CacheKey, CacheTTL } from "@/lib/cache";
import { listServerMembers } from "@/services/server.service";


// GET /api/servers/:id/members — list server members
const GET = async ({ request, params }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;
  const { id: serverId } = params;

  const db = getDB();

  // Verify membership (security check — always hits D1)
  const member = await db.prepare(
    `SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?`
  ).bind(serverId, userId).first();


  // Cache-aside: member list for this server (2min TTL since it changes more)
  const members = await cacheFetch(
    CacheKey.serverMembers(serverId),
    CacheTTL.SERVER_MEMBERS,
    () => listServerMembers(db, serverId)
  );

  return apiSuccess(members);
}


export const Route = createFileRoute('/api/servers/$id/members')({
  server: {
    handlers: {
      GET,
    }
  }
});
