import { createFileRoute } from '@tanstack/react-router';

import { apiError, apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";
import { requireChannelAccess } from "@/lib/require-channel-access";
import { ServiceError } from "@/lib/service-error";
import { fetchChannelFiles, fetchChannelLinks, fetchChannelMedia } from "@/services/media.service";

// GET /api/channels/:id/media?type=images|links|files&before=cursor&limit=50
const GET = async ({ request, params }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const { id: channelId } = params;

  const accessResult = await requireChannelAccess(userId, channelId);
  if (accessResult instanceof Response) return accessResult;

  const url = new URL(request.url);
  const type = url.searchParams.get("type") ?? "images";
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 100);
  const before = url.searchParams.get("before");

  const db = getDB();

  try {
    switch (type) {
      case "links": {
        const items = await fetchChannelLinks(db, channelId, { limit, before });
        return apiSuccess({ items, type: "links" });
      }
      case "files": {
        const items = await fetchChannelFiles(db, channelId, { limit, before });
        return apiSuccess({ items, type: "files" });
      }
      default: {
        // "images" — includes both images and videos
        const items = await fetchChannelMedia(db, channelId, { limit, before });
        return apiSuccess({ items, type: "images" });
      }
    }
  } catch (e) {
    if (e instanceof ServiceError) {
      return apiError(e.message, e.status, e.code);
    }
    throw e;
  }
};

export const Route = createFileRoute('/api/channels/$id/media')({
  server: {
    handlers: {
      GET,
    }
  }
});
