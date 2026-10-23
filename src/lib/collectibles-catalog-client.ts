import { apiGet, apiPost } from "@/lib/api-client";
import type { CollectiblesCatalog } from "@/lib/collectibles-catalog";

type CatalogListener = (catalog: CollectiblesCatalog) => void;

let cachedCatalog: CollectiblesCatalog | null = null;
let cachedAtMs = 0;
let loadPromise: Promise<CollectiblesCatalog> | null = null;
let syncPromise: Promise<CollectiblesCatalog> | null = null;
const listeners = new Set<CatalogListener>();

/** Re-ask the server this often while its copy is fresh (it's a cache read). */
const FRESH_RECHECK_MS = 1000 * 60 * 30;
/**
 * When the server says its catalog is stale (upstream down), don't hammer
 * it: the server already refreshes in the background. Re-ask at most this
 * often.
 */
const STALE_RECHECK_MS = 1000 * 60 * 10;

export class CollectiblesSyncError extends Error {
  readonly status: number | undefined;
  readonly code: string | undefined;

  constructor(message: string, status?: number, code?: string) {
    super(message);
    this.name = "CollectiblesSyncError";
    this.status = status;
    this.code = code;
  }
}

function shouldReuse(catalog: CollectiblesCatalog, now = Date.now()) {
  const age = now - cachedAtMs;
  return age < (catalog.stale ? STALE_RECHECK_MS : FRESH_RECHECK_MS);
}

function publishCatalog(catalog: CollectiblesCatalog) {
  cachedCatalog = catalog;
  cachedAtMs = Date.now();
  for (const listener of listeners) {
    listener(catalog);
  }
  return catalog;
}

export function getCachedCollectiblesCatalog() {
  return cachedCatalog;
}

export function subscribeCollectiblesCatalog(listener: CatalogListener) {
  listeners.add(listener);
  if (cachedCatalog) {
    listener(cachedCatalog);
  }
  return () => {
    listeners.delete(listener);
  };
}

export async function loadCollectiblesCatalog(
  options: {
    /** Admin only on the server; ignored for everyone else. */
    forceRefresh?: boolean;
  } = {},
) {
  if (!options.forceRefresh && cachedCatalog && shouldReuse(cachedCatalog)) {
    return cachedCatalog;
  }

  if (!options.forceRefresh && loadPromise) {
    return loadPromise;
  }

  const path = options.forceRefresh
    ? "/api/collectibles/catalog?refresh=1"
    : "/api/collectibles/catalog";

  const request = apiGet<{ catalog: CollectiblesCatalog }>(path)
    .then((data) => publishCatalog(data.catalog))
    .finally(() => {
      if (loadPromise === request) {
        loadPromise = null;
      }
    });

  loadPromise = request;
  return request;
}

/**
 * Forces an upstream sync. Only catalog admins may (403 otherwise) and only
 * once per cooldown (429). Both reject with a CollectiblesSyncError whose
 * message is ready to show.
 */
export async function syncCollectiblesCatalogClient() {
  if (syncPromise) {
    return syncPromise;
  }

  const request = apiPost<{ catalog: CollectiblesCatalog }>(
    "/api/collectibles/sync",
    {},
  )
    .then((data) => publishCatalog(data.catalog))
    .catch((error: unknown) => {
      const status =
        typeof (error as { status?: unknown })?.status === "number"
          ? ((error as { status: number }).status as number)
          : undefined;
      const code =
        typeof (error as { code?: unknown })?.code === "string"
          ? ((error as { code: string }).code as string)
          : undefined;
      const message =
        status === 403
          ? "Only catalog admins can refresh the catalog. It refreshes on its own every hour."
          : status === 429
            ? error instanceof Error && error.message
              ? error.message
              : "The catalog synced moments ago. Try again in a few minutes."
            : error instanceof Error
              ? error.message
              : "Unable to refresh collectibles.";
      throw new CollectiblesSyncError(message, status, code);
    })
    .finally(() => {
      if (syncPromise === request) {
        syncPromise = null;
      }
    });

  syncPromise = request;
  return request;
}

export function primeCollectiblesCatalogCache(catalog: CollectiblesCatalog) {
  return publishCatalog(catalog);
}

/** Test hook. */
export function resetCollectiblesCatalogClient() {
  cachedCatalog = null;
  cachedAtMs = 0;
  loadPromise = null;
  syncPromise = null;
  listeners.clear();
}
