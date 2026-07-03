import { apiGet, apiPost } from "@/lib/api-client";
import type { CollectiblesCatalog } from "@/lib/collectibles-catalog";

type CatalogListener = (catalog: CollectiblesCatalog) => void;

let cachedCatalog: CollectiblesCatalog | null = null;
let loadPromise: Promise<CollectiblesCatalog> | null = null;
let syncPromise: Promise<CollectiblesCatalog> | null = null;
const listeners = new Set<CatalogListener>();

function publishCatalog(catalog: CollectiblesCatalog) {
  cachedCatalog = catalog;
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

export async function loadCollectiblesCatalog(options: {
  forceRefresh?: boolean;
} = {}) {
  if (!options.forceRefresh && cachedCatalog) {
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

export async function syncCollectiblesCatalogClient() {
  if (syncPromise) {
    return syncPromise;
  }

  const request = apiPost<{ catalog: CollectiblesCatalog }>("/api/collectibles/sync", {})
    .then((data) => publishCatalog(data.catalog))
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
