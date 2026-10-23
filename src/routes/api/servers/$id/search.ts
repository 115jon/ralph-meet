import { createFileRoute } from "@tanstack/react-router";

import { apiError, apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";
import { parseSearchParams } from "@/lib/message-search";
import { getVisibleChannels } from "@/lib/require-permission";
import { searchMessages } from "@/services/message-search.service";

// GET /api/servers/:id/search?q=&from=&mentions=&in=&has=&before=&after=&pinned=&sort=&limit=&offset=
// Searches only the channels the caller can view. See lib/message-search.ts
// for the parameter grammar.
export const GET = async ({ request, params }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;
  const { id: serverId } = params;

  const db = getDB();

  const member = await db
    .prepare(`SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?`)
    .bind(serverId, userId)
    .first();
  if (!member) {
    return apiError("Not a member", 403);
  }

  const parsed = parseSearchParams(new URL(request.url).searchParams);
  if (!parsed.ok) {
    return apiError(parsed.error, 400);
  }

  const { results } = await db
    .prepare(`SELECT id FROM channels WHERE server_id = ?`)
    .bind(serverId)
    .all();
  const channels = ((results ?? []) as Array<{ id: unknown }>).map((row) => ({
    id: String(row.id),
  }));
  const visible = await getVisibleChannels(serverId, userId, channels);

  const result = await searchMessages(
    db,
    { serverId, channelIds: visible.map((channel) => channel.id) },
    parsed.query,
  );

  return apiSuccess(result);
};

export const Route = createFileRoute("/api/servers/$id/search")({
  server: {
    handlers: {
      GET,
    },
  },
});
