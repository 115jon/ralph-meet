import { createFileRoute } from "@tanstack/react-router";

import { apiError, apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";
import { parseSearchParams } from "@/lib/message-search";
import { requireChannelAccess } from "@/lib/require-channel-access";
import { searchMessages } from "@/services/message-search.service";

// GET /api/channels/:id/search — search one channel the caller can read.
// DMs use this; server channels may too. Same grammar as the server search,
// except `in` is fixed to this channel.
export const GET = async ({ request, params }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;
  const { id: channelId } = params;

  const access = await requireChannelAccess(userId, channelId);
  if (access instanceof Response) return access;

  const parsed = parseSearchParams(new URL(request.url).searchParams);
  if (!parsed.ok) {
    return apiError(parsed.error, 400);
  }

  const result = await searchMessages(
    getDB(),
    { serverId: access.serverId, channelIds: [channelId] },
    { ...parsed.query, channelIds: [] },
  );

  return apiSuccess(result);
};

export const Route = createFileRoute("/api/channels/$id/search")({
  server: {
    handlers: {
      GET,
    },
  },
});
