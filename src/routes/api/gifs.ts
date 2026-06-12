import { createFileRoute } from '@tanstack/react-router';

import { apiError, apiSuccess, getKV, requireAuth } from "@/lib/api-helpers";
import {
  buildTenorCacheKey,
  extractTenorConfigFromHtml,
  normalizeTenorCategory,
  normalizeTenorGifResult,
  type TenorCacheParamValue,
  type TenorConfig,
} from "@/lib/gif-picker";

const TENOR_BOOTSTRAP_URL = "https://tenor.com/search/cat-gifs";
const TENOR_CONFIG_KV_KEY = "tenor:v1:config";
const TENOR_CONFIG_SOFT_TTL_MS = 12 * 60 * 60 * 1000;
const TENOR_CONFIG_STALE_TTL_SECONDS = 7 * 24 * 60 * 60;
const TENOR_CATEGORIES_CACHE = { freshTtlSeconds: 12 * 60 * 60, staleTtlSeconds: 7 * 24 * 60 * 60 };
const TENOR_FEATURED_CACHE = { freshTtlSeconds: 5 * 60, staleTtlSeconds: 60 * 60 };
const TENOR_SEARCH_CACHE = { freshTtlSeconds: 10 * 60, staleTtlSeconds: 24 * 60 * 60 };
const MAX_TENOR_LIMIT = 30;

type TenorParams = Record<string, TenorCacheParamValue>;

interface KvCacheEntry<T> {
  cachedAt: number;
  data: T;
}

let tenorConfigPromise: Promise<TenorConfig | null> | null = null;
let cachedTenorConfig: TenorConfig | null = null;
let cachedTenorConfigExpiresAt = 0;
const inFlightTenorRequests = new Map<string, Promise<any>>();

async function readKvJson<T>(key: string): Promise<T | null> {
  try {
    return await getKV().get<T>(key, "json");
  } catch {
    return null;
  }
}

async function writeKvJson<T>(key: string, value: T, expirationTtl: number): Promise<void> {
  try {
    await getKV().put(key, JSON.stringify(value), { expirationTtl: Math.max(60, expirationTtl) });
  } catch {
    // KV is an optimization only; Tenor requests should still work without it.
  }
}

function rememberTenorConfig(config: TenorConfig, ttlMs = TENOR_CONFIG_SOFT_TTL_MS): TenorConfig {
  cachedTenorConfig = config;
  cachedTenorConfigExpiresAt = Date.now() + ttlMs;
  return config;
}

async function getTenorConfig(): Promise<TenorConfig | null> {
  const now = Date.now();
  if (cachedTenorConfig && cachedTenorConfigExpiresAt > now) return cachedTenorConfig;

  const kvConfig = await readKvJson<KvCacheEntry<TenorConfig>>(TENOR_CONFIG_KV_KEY);
  if (kvConfig?.data && now - kvConfig.cachedAt < TENOR_CONFIG_SOFT_TTL_MS) {
    return rememberTenorConfig(kvConfig.data);
  }

  if (!tenorConfigPromise) {
    tenorConfigPromise = fetchTenorConfig()
      .then(async (config) => {
        if (config) {
          const entry: KvCacheEntry<TenorConfig> = { cachedAt: Date.now(), data: config };
          await writeKvJson(TENOR_CONFIG_KV_KEY, entry, TENOR_CONFIG_STALE_TTL_SECONDS);
          return rememberTenorConfig(config);
        }

        if (kvConfig?.data) {
          return rememberTenorConfig(kvConfig.data, 5 * 60 * 1000);
        }

        return cachedTenorConfig;
      })
      .finally(() => {
        tenorConfigPromise = null;
      });
  }
  return tenorConfigPromise;
}

async function fetchTenorConfig(): Promise<TenorConfig | null> {
  try {
    const res = await fetch(TENOR_BOOTSTRAP_URL, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; RalphMeet/1.0; +https://ralph.dev)",
      },
    });
    if (!res.ok) return null;

    const html = await res.text();
    return extractTenorConfigFromHtml(html);
  } catch {
    return null;
  }
}

async function fetchTenor(path: string, params: TenorParams) {
  const config = await getTenorConfig();
  if (!config) {
    throw new Error("Failed to resolve Tenor configuration");
  }

  const url = new URL(`${config.API_V2_URL}${path}`);
  url.searchParams.set("key", config.API_V2_KEY);
  url.searchParams.set("client_key", config.API_V2_CLIENT_KEY || "tenor_web");

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }

  const res = await fetch(url.toString(), {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; RalphMeet/1.0; +https://ralph.dev)",
    },
  });

  if (!res.ok) {
    throw new Error(`Tenor request failed with ${res.status}`);
  }

  return res.json() as Promise<any>;
}

async function fetchTenorCached(
  path: string,
  params: TenorParams,
  cache: { freshTtlSeconds: number; staleTtlSeconds: number }
) {
  const cacheKey = buildTenorCacheKey(path, params);
  const cached = await readKvJson<KvCacheEntry<any>>(cacheKey);
  const now = Date.now();
  if (cached?.data && now - cached.cachedAt < cache.freshTtlSeconds * 1000) {
    return cached.data;
  }

  let request = inFlightTenorRequests.get(cacheKey);
  if (!request) {
    request = fetchTenor(path, params)
      .then(async (data) => {
        await writeKvJson(cacheKey, { cachedAt: Date.now(), data }, cache.staleTtlSeconds);
        return data;
      })
      .finally(() => {
        inFlightTenorRequests.delete(cacheKey);
      });
    inFlightTenorRequests.set(cacheKey, request);
  }

  try {
    return await request;
  } catch (error) {
    if (cached?.data) return cached.data;
    throw error;
  }
}

function parseTenorLimit(raw: string | null, fallback: number): number {
  const parsed = Number(raw || fallback);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(Math.floor(parsed), MAX_TENOR_LIMIT);
}

const GET = async ({ request }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;

  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") || "search";

  try {
    if (mode === "categories") {
      const data = await fetchTenorCached("/categories", {
        limit: parseTenorLimit(url.searchParams.get("limit"), MAX_TENOR_LIMIT),
        contentfilter: "high",
      }, TENOR_CATEGORIES_CACHE);

      return apiSuccess({
        categories: Array.isArray(data.tags)
          ? data.tags.map(normalizeTenorCategory).filter(Boolean)
          : [],
      });
    }

    const query = url.searchParams.get("q")?.trim().slice(0, 80) || undefined;
    const next = url.searchParams.get("next") || undefined;
    const endpoint = query ? "/search" : "/featured";
    const data = await fetchTenorCached(endpoint, {
      q: query,
      limit: parseTenorLimit(url.searchParams.get("limit"), 24),
      pos: next,
      media_filter: "gif,tinygif,mp4,tinymp4",
      contentfilter: "high",
    }, query ? TENOR_SEARCH_CACHE : TENOR_FEATURED_CACHE);

    return apiSuccess({
      results: Array.isArray(data.results)
        ? data.results.map(normalizeTenorGifResult).filter(Boolean)
        : [],
      next: data.next || null,
    });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Failed to fetch GIFs", 502);
  }
};

export const Route = createFileRoute('/api/gifs')({
  server: {
    handlers: {
      GET,
    }
  }
});
