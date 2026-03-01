import { createFileRoute } from '@tanstack/react-router';

import { apiError, apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";
import { searchMessages } from "@/services/server.service";


// GET /api/servers/:id/search?q=query&limit=25&offset=0
const GET = async ({ request, params }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;
  const { id: serverId } = params;

  const db = getDB();

  // Verify membership
  const member = await db.prepare(
    `SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?`
  ).bind(serverId, userId).first();

  if (!member) {
    return apiError("Not a member", 403);
  }

  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim();
  if (!query || query.length < 2) {
    return apiError("Query must be at least 2 characters", 400);
  }

  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "25"), 50);
  const offset = parseInt(url.searchParams.get("offset") ?? "0");

  const result = await searchMessages(db, serverId, query, limit, offset);

  return apiSuccess(result);
}


export const Route = createFileRoute('/api/servers/$id/search')({
  server: {
    handlers: {
      GET,
    }
  }
});
