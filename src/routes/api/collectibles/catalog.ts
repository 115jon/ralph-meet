import { createFileRoute } from "@tanstack/react-router";

import { apiError, apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";
import { getCollectiblesCatalog } from "@/lib/collectibles-catalog";

const GET = async ({ request }: any) => {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const url = new URL(request.url);
  const refresh = url.searchParams.get("refresh") === "1";

  try {
    const catalog = await getCollectiblesCatalog(getDB(), {
      forceRefresh: refresh,
    });
    return apiSuccess({ catalog }, 200, request);
  } catch {
    return apiError(
      "Unable to load collectibles catalog",
      503,
      "COLLECTIBLES_CATALOG_UNAVAILABLE",
      request,
    );
  }
};

export const Route = createFileRoute("/api/collectibles/catalog")({
  server: {
    handlers: {
      GET,
    },
  },
});
