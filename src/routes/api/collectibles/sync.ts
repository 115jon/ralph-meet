import { createFileRoute } from "@tanstack/react-router";

import { apiError, apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";
import { syncCollectiblesCatalog } from "@/lib/collectibles-catalog";

const POST = async ({ request }: any) => {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  try {
    const catalog = await syncCollectiblesCatalog(getDB());
    return apiSuccess({ catalog }, 200, request);
  } catch {
    return apiError("Unable to sync collectibles catalog", 503, "COLLECTIBLES_SYNC_FAILED", request);
  }
};

export const Route = createFileRoute("/api/collectibles/sync")({
  server: {
    handlers: {
      POST,
    },
  },
});
