import { createFileRoute } from '@tanstack/react-router';

import { apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";
import { requireChannelAccess } from "@/lib/require-channel-access";
import { fetchChannelThreads } from "@/services/message.service";

// GET /api/channels/:id/threads?limit=50
// Returns messages that have replies (thread starters), ordered by most recent reply activity.
const GET = async ({ request, params }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const { id: channelId } = params;

  const accessResult = await requireChannelAccess(userId, channelId);
  if (accessResult instanceof Response) return accessResult;

  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "30"), 50);

  const db = getDB();
  const threads = await fetchChannelThreads(db, channelId, { limit });

  return apiSuccess({ threads });
};

export const Route = createFileRoute('/api/channels/$id/threads')({
  server: {
    handlers: {
      GET,
    }
  }
});
