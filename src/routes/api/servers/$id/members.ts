import { createFileRoute } from "@tanstack/react-router";

import { apiError, apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";
import { cacheFetch, CacheKey, CacheTTL } from "@/lib/cache";
import { listServerMembers } from "@/services/server.service";

// GET /api/servers/:id/members — list server members
export const GET = async ({ request, params }: any) => {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;
  const { id: serverId } = params;

  const db = getDB();

  // Verify membership (security check — always hits D1)
  const member = await db
    .prepare(`SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?`)
    .bind(serverId, userId)
    .first();

  if (!member) {
    return apiError("Not a member", 403);
  }

  // Cache-aside: member list for this server (2min TTL since it changes more)
  const members = await cacheFetch(
    CacheKey.serverMembers(serverId),
    CacheTTL.SERVER_MEMBERS,
    () => listServerMembers(db, serverId),
  );

  let presenceRows: Array<Record<string, unknown>>;
  try {
    const result = await db
      .prepare(
        `SELECT sm.user_id, u.status, u.custom_status
           FROM server_members sm
           LEFT JOIN users u ON u.id = sm.user_id
          WHERE sm.server_id = ?`,
      )
      .bind(serverId)
      .all();
    presenceRows = (result.results ?? []) as Array<Record<string, unknown>>;
  } catch {
    return apiError("Failed to load member presence", 500);
  }

  const freshPresence = new Map(
    presenceRows.map((row) => [row.user_id as string, row]),
  );
  const freshMembers = members.map((member) => {
    const presence = freshPresence.get(String(member.user.id));
    return {
      ...member,
      user: {
        ...member.user,
        status: (presence?.status as string) ?? "online",
        custom_status: presence?.custom_status ?? null,
      },
    };
  });

  return apiSuccess(freshMembers);
};

export const Route = createFileRoute("/api/servers/$id/members")({
  server: {
    handlers: {
      GET,
    },
  },
});
