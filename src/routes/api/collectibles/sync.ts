import { createFileRoute } from "@tanstack/react-router";

import {
  apiError,
  apiSuccess,
  getDB,
  getEnv,
  requireAuth,
} from "@/lib/api-helpers";
import {
  describeError,
  getCollectiblesCatalog,
  getCollectiblesSyncStatus,
  manualSyncRetryAfterMs,
  parseCollectiblesAdminIds,
  syncCollectiblesCatalog,
} from "@/lib/collectibles-catalog";

/**
 * Comma-separated user ids allowed to force an upstream sync. Unset means
 * manual sync is off; the hourly cron keeps the catalog current regardless.
 */
function getCollectiblesAdminIds() {
  const env = getEnv() as unknown as Record<string, unknown>;
  return parseCollectiblesAdminIds(env.COLLECTIBLES_ADMIN_USER_IDS);
}

export const POST = async ({ request }: { request: Request }) => {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  if (!getCollectiblesAdminIds().has(authResult.userId)) {
    return apiError(
      "Only catalog admins can refresh the catalog. It refreshes on its own every hour.",
      403,
      "COLLECTIBLES_SYNC_FORBIDDEN",
      request,
    );
  }

  const db = getDB();
  const status = await getCollectiblesSyncStatus(db);
  const retryAfterMs = manualSyncRetryAfterMs(status);
  if (retryAfterMs > 0) {
    const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);
    const catalog = await getCollectiblesCatalog(db).catch(() => null);
    const response = apiSuccess(
      {
        error: `The catalog synced moments ago. Try again in ${retryAfterSeconds}s.`,
        code: "COLLECTIBLES_SYNC_COOLDOWN",
        retryAfterSeconds,
        catalog,
      },
      429,
      request,
    );
    response.headers.set("Retry-After", String(retryAfterSeconds));
    return response;
  }

  try {
    const catalog = await syncCollectiblesCatalog(db, { trigger: "manual" });
    return apiSuccess({ catalog }, 200, request);
  } catch (error) {
    return apiError(
      `Unable to sync collectibles catalog; kept the last good one. ${describeError(error)}`,
      503,
      "COLLECTIBLES_SYNC_FAILED",
      request,
    );
  }
};

export const Route = createFileRoute("/api/collectibles/sync")({
  server: {
    handlers: {
      POST,
    },
  },
});
