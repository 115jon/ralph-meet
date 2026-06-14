import { createFileRoute } from "@tanstack/react-router";

import { apiError, apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";
import { cacheFetch, CacheKey, CacheTTL } from "@/lib/cache";
import { listServerSoundboardSounds } from "@/services/soundboard.service";

// GET /api/servers/:id/soundboard — list server soundboard clips
const GET = async ({ request, params }: any) => {
  const authResult = await requireAuth(request);
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

  const sounds = await cacheFetch(
    CacheKey.serverSoundboard(serverId),
    CacheTTL.SERVER_SOUNDBOARD,
    () => listServerSoundboardSounds(db, serverId)
  );

  return apiSuccess(sounds);
};

export const Route = createFileRoute("/api/servers/$id/soundboard")({
  server: {
    handlers: {
      GET,
    },
  },
});
