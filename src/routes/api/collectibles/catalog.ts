import { createFileRoute } from "@tanstack/react-router";
import * as cloudflareWorkers from "cloudflare:workers";

import {
  apiError,
  apiSuccess,
  getDB,
  getEnv,
  requireAuth,
} from "@/lib/api-helpers";
import {
  getCollectiblesCatalog,
  parseCollectiblesAdminIds,
} from "@/lib/collectibles-catalog";

type WaitUntil = (promise: Promise<unknown>) => void;

/** workerd exports waitUntil from cloudflare:workers; absent in tests/shims. */
function getWaitUntil(): WaitUntil | undefined {
  const candidate = (cloudflareWorkers as { waitUntil?: unknown }).waitUntil;
  return typeof candidate === "function" ? (candidate as WaitUntil) : undefined;
}

export const GET = async ({ request }: { request: Request }) => {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  // ?refresh=1 forces an upstream fetch; only admins may do that. Everyone
  // else gets the cached catalog (refreshed by cron or in the background).
  const url = new URL(request.url);
  const refresh =
    url.searchParams.get("refresh") === "1" &&
    parseCollectiblesAdminIds(
      (getEnv() as unknown as Record<string, unknown>)
        .COLLECTIBLES_ADMIN_USER_IDS,
    ).has(authResult.userId);

  try {
    const catalog = await getCollectiblesCatalog(getDB(), {
      forceRefresh: refresh,
      waitUntil: getWaitUntil(),
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
