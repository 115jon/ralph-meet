import { createFileRoute } from '@tanstack/react-router';

import { apiError, apiSuccess, getDB, getEnv, getKV, requireAuth } from "@/lib/api-helpers";
import {
  buildGifProviderCacheKey,
  buildTenorCacheKey,
  DEFAULT_GIF_PROVIDER,
  dedupeGifPickerItems,
  extractTenorConfigFromHtml,
  MAX_GIF_FAVORITES,
  normalizeKlipyCategory,
  normalizeKlipyGifResult,
  normalizeTenorCategory,
  normalizeTenorGifResult,
  type GifProvider,
  type TenorCacheParamValue,
  type TenorConfig,
  type GifPickerItem,
  type GifPickerAsset,
} from "@/lib/gif-picker";

const KLIPY_API_URL = "https://api.klipy.com/v2";
const TENOR_BOOTSTRAP_URL = "https://tenor.com/search/cat-gifs";
const TENOR_CONFIG_KV_KEY = "tenor:v1:config";
const TENOR_CONFIG_SOFT_TTL_MS = 12 * 60 * 60 * 1000;
const TENOR_CONFIG_STALE_TTL_SECONDS = 7 * 24 * 60 * 60;
const TENOR_CATEGORIES_CACHE = { freshTtlSeconds: 12 * 60 * 60, staleTtlSeconds: 7 * 24 * 60 * 60 };
const TENOR_FEATURED_CACHE = { freshTtlSeconds: 5 * 60, staleTtlSeconds: 60 * 60 };
const TENOR_SEARCH_CACHE = { freshTtlSeconds: 10 * 60, staleTtlSeconds: 24 * 60 * 60 };
const AUTOCOMPLETE_CACHE = { freshTtlSeconds: 30 * 60, staleTtlSeconds: 24 * 60 * 60 };
const SUGGESTIONS_CACHE = { freshTtlSeconds: 30 * 60, staleTtlSeconds: 24 * 60 * 60 };
const MAX_TENOR_LIMIT = 30;
const DEMO_MAX_GIF_LIMIT = 12;
const DEMO_MAX_QUERY_LENGTH = 64;
const DEMO_MAX_CURSOR_LENGTH = 256;
const MAX_FAVORITE_IMPORT_COUNT = 100;

type TenorParams = Record<string, TenorCacheParamValue>;
type GifApiParams = Record<string, TenorCacheParamValue>;
type SearchGifProvider = Exclude<GifProvider, "external">;

type StoredGifFavoriteRow = {
  provider: string;
  gif_id: string;
  title: string;
  alt_text: string | null;
  query: string | null;
  source_url: string;
  aspect_ratio: number;
  preview_url: string;
  preview_width: number;
  preview_height: number;
  preview_size_bytes: number;
  preview_content_type: string;
  send_url: string;
  send_width: number;
  send_height: number;
  send_size_bytes: number;
  send_content_type: string;
  duration?: number | null;
};

type FavoriteWriteBody = {
  favorite?: any;
  favorites?: any[];
  provider?: string;
  gif_id?: string;
};

interface KvCacheEntry<T> {
  cachedAt: number;
  data: T;
}

class TenorRequestError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
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
    throw new TenorRequestError(`Tenor request failed with ${res.status}`, res.status);
  }

  return res.json() as Promise<any>;
}

function getGifProvider(input: string | null): SearchGifProvider {
  return input === "tenor" ? "tenor" : DEFAULT_GIF_PROVIDER;
}

function clampString(value: unknown, fallback: string, maxLength: number): string {
  const text = typeof value === "string" ? value.trim() : "";
  return (text || fallback).slice(0, maxLength);
}

function nullableString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text.slice(0, maxLength) : null;
}

function positiveInteger(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function positiveNumber(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function normalizeFavoriteProvider(value: unknown): GifProvider {
  if (value === "tenor") return "tenor";
  if (value === "external") return "external";
  return "klipy";
}

function normalizeFavoriteContentType(value: unknown): "image/gif" | "image/apng" | "image/webp" | "video/mp4" {
  const mime = typeof value === "string" ? value.toLowerCase().split(";")[0].trim() : "";
  if (mime === "image/apng") return "image/apng";
  if (mime === "image/webp") return "image/webp";
  if (mime === "video/mp4" || mime.startsWith("video/")) return "video/mp4";
  return "image/gif";
}

function normalizeKlipyNativeResult(result: any, mediaType: "gifs" | "stickers" | "clips"): GifPickerItem | null {
  if (!result || (!result.id && !result.slug)) return null;

  const id = String(result.id || result.slug);
  const title = String(result.title || result.slug || (mediaType === "stickers" ? "Sticker" : "Clip"));

  let previewUrl = "";
  let previewWidth = 320;
  let previewHeight = 320;
  let previewSize = 0;
  let previewType: GifPickerAsset["contentType"] = "image/gif";

  let sendUrl = "";
  let sendWidth = 320;
  let sendHeight = 320;
  let sendSize = 0;
  let sendType: GifPickerAsset["contentType"] = "image/gif";

  if (mediaType === "clips") {
    const file = result.file || {};
    const fileMeta = result.file_meta || {};

    const mp4Url = file.mp4 || file.hd?.mp4?.url || file.md?.mp4?.url;
    const webpUrl = file.webp || file.hd?.webp?.url || file.md?.webp?.url;
    const gifUrl = file.gif || file.hd?.gif?.url || file.md?.gif?.url;

    const mp4Meta = fileMeta.mp4 || file.hd?.mp4 || file.md?.mp4 || {};
    const webpMeta = fileMeta.webp || file.hd?.webp || file.md?.webp || {};
    const gifMeta = fileMeta.gif || file.hd?.gif || file.md?.gif || {};

    sendUrl = mp4Url || webpUrl || gifUrl || "";
    sendWidth = mp4Meta.width || webpMeta.width || gifMeta.width || 320;
    sendHeight = mp4Meta.height || webpMeta.height || gifMeta.height || 320;
    sendSize = mp4Meta.size || webpMeta.size || gifMeta.size || 0;
    sendType = mp4Url ? "video/mp4" : webpUrl ? "image/webp" : "image/gif";

    previewUrl = webpUrl || mp4Url || gifUrl || "";
    previewWidth = webpMeta.width || mp4Meta.width || gifMeta.width || 320;
    previewHeight = webpMeta.height || mp4Meta.height || gifMeta.height || 320;
    previewSize = webpMeta.size || mp4Meta.size || gifMeta.size || 0;
    previewType = webpUrl ? "image/webp" : mp4Url ? "video/mp4" : "image/gif";
  } else {
    const file = result.file || {};
    const hd = file.hd || {};
    const md = file.md || file.sm || hd || {};

    const sendAsset = hd.webp || hd.png || hd.gif || md.webp || md.png || md.gif || {};
    const previewAsset = md.webp || md.png || md.gif || hd.webp || hd.png || hd.gif || {};

    sendUrl = sendAsset.url || "";
    sendWidth = sendAsset.width || 320;
    sendHeight = sendAsset.height || 320;
    sendSize = sendAsset.size || 0;
    sendType = sendAsset.url && sendUrl.includes(".png")
      ? "image/apng"
      : sendAsset.url && sendUrl.includes(".webp")
        ? "image/webp"
        : "image/gif";

    previewUrl = previewAsset.url || "";
    previewWidth = previewAsset.width || 320;
    previewHeight = previewAsset.height || 320;
    previewSize = previewAsset.size || 0;
    previewType = previewAsset.url && previewUrl.includes(".png")
      ? "image/apng"
      : previewAsset.url && previewUrl.includes(".webp")
        ? "image/webp"
        : "image/gif";
  }

  if (!sendUrl || !previewUrl) return null;

  return {
    id,
    title,
    provider: "klipy",
    preview: {
      url: previewUrl,
      width: previewWidth,
      height: previewHeight,
      sizeBytes: previewSize,
      contentType: previewType,
    },
    send: {
      url: sendUrl,
      width: sendWidth,
      height: sendHeight,
      sizeBytes: sendSize,
      contentType: sendType,
    },
    sourceUrl: sendUrl,
    aspectRatio: previewWidth / previewHeight,
    duration: mediaType === "clips" ? (typeof result.duration === "number" ? result.duration : (typeof result.duration === "string" && !isNaN(parseFloat(result.duration)) ? parseFloat(result.duration) : undefined)) : undefined,
  };
}


function normalizeSuggestions(data: any): string[] {
  if (Array.isArray(data)) {
    return data.map(String);
  }
  if (data && Array.isArray(data.data)) {
    return data.data.map(String);
  }
  if (data && Array.isArray(data.results)) {
    return data.results.map(String);
  }
  if (data && typeof data === "object") {
    const arr = Object.values(data).find(Array.isArray);
    if (arr) return arr.map(String);
  }
  return [];
}

function isSafeFavoriteUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  const url = value.trim();
  if (url.startsWith("/api/attachments/") || url.startsWith("/api/proxy-media?") || url.startsWith("attachments/")) return true;

  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function normalizeFavorite(raw: any): StoredGifFavoriteRow | null {
  if (!raw || typeof raw !== "object") return null;
  const preview = raw.preview && typeof raw.preview === "object" ? raw.preview : null;
  const send = raw.send && typeof raw.send === "object" ? raw.send : null;
  const sourceUrl = raw.sourceUrl;
  const previewUrl = preview?.url;
  const sendUrl = send?.url;
  if (!isSafeFavoriteUrl(sourceUrl) || !isSafeFavoriteUrl(previewUrl) || !isSafeFavoriteUrl(sendUrl)) return null;

  const provider = normalizeFavoriteProvider(raw.provider);
  const width = positiveInteger(preview?.width ?? send?.width, 320);
  const height = positiveInteger(preview?.height ?? send?.height, 320);
  const duration = typeof raw.duration === "number" ? raw.duration : (typeof raw.duration === "string" && !isNaN(parseFloat(raw.duration)) ? parseFloat(raw.duration) : null);

  return {
    provider,
    gif_id: clampString(raw.id, sendUrl, 512),
    title: clampString(raw.title, "Saved GIF", 200),
    alt_text: nullableString(raw.altText, 500),
    query: nullableString(raw.query, 100),
    source_url: sourceUrl.trim(),
    aspect_ratio: positiveNumber(raw.aspectRatio, width / height),
    preview_url: previewUrl.trim(),
    preview_width: width,
    preview_height: height,
    preview_size_bytes: Math.max(0, positiveInteger(preview?.sizeBytes, 0)),
    preview_content_type: normalizeFavoriteContentType(preview?.contentType),
    send_url: sendUrl.trim(),
    send_width: positiveInteger(send?.width, width),
    send_height: positiveInteger(send?.height, height),
    send_size_bytes: Math.max(0, positiveInteger(send?.sizeBytes, 0)),
    send_content_type: normalizeFavoriteContentType(send?.contentType),
    duration: duration && duration > 0 ? duration : null,
  };
}

function toGifPickerItem(row: StoredGifFavoriteRow) {
  return {
    id: row.gif_id,
    title: row.title,
    provider: normalizeFavoriteProvider(row.provider),
    altText: row.alt_text || undefined,
    query: row.query || undefined,
    preview: {
      url: row.preview_url,
      width: row.preview_width,
      height: row.preview_height,
      sizeBytes: row.preview_size_bytes,
      contentType: normalizeFavoriteContentType(row.preview_content_type),
    },
    send: {
      url: row.send_url,
      width: row.send_width,
      height: row.send_height,
      sizeBytes: row.send_size_bytes,
      contentType: normalizeFavoriteContentType(row.send_content_type),
    },
    sourceUrl: row.source_url,
    aspectRatio: row.aspect_ratio,
    duration: row.duration ?? undefined,
  };
}

async function listGifFavorites(userId: string) {
  const { results } = await getDB().prepare(
    `SELECT provider, gif_id, title, alt_text, query, source_url, aspect_ratio,
            preview_url, preview_width, preview_height, preview_size_bytes, preview_content_type,
            send_url, send_width, send_height, send_size_bytes, send_content_type, duration
     FROM gif_favorites
     WHERE user_id = ?
     ORDER BY created_at DESC
     LIMIT ?`
  ).bind(userId, MAX_GIF_FAVORITES).all<StoredGifFavoriteRow>();

  return (results ?? []).map(toGifPickerItem);
}

async function pruneGifFavorites(userId: string) {
  const { results } = await getDB().prepare(
    `SELECT provider, gif_id
     FROM gif_favorites
     WHERE user_id = ?
     ORDER BY created_at DESC
     LIMIT 1000 OFFSET ?`
  ).bind(userId, MAX_GIF_FAVORITES).all<{ provider: string; gif_id: string }>();

  for (const row of results ?? []) {
    await getDB().prepare(
      `DELETE FROM gif_favorites WHERE user_id = ? AND provider = ? AND gif_id = ?`
    ).bind(userId, row.provider, row.gif_id).run();
  }
}

async function upsertGifFavorite(userId: string, favorite: StoredGifFavoriteRow, createdAt = new Date().toISOString()) {
  const updatedAt = new Date().toISOString();
  await getDB().prepare(
    `INSERT INTO gif_favorites (
       user_id, provider, gif_id, title, alt_text, query, source_url, aspect_ratio,
       preview_url, preview_width, preview_height, preview_size_bytes, preview_content_type,
       send_url, send_width, send_height, send_size_bytes, send_content_type, duration, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, provider, gif_id) DO UPDATE SET
       title = excluded.title,
       alt_text = excluded.alt_text,
       query = excluded.query,
       source_url = excluded.source_url,
       aspect_ratio = excluded.aspect_ratio,
       preview_url = excluded.preview_url,
       preview_width = excluded.preview_width,
       preview_height = excluded.preview_height,
       preview_size_bytes = excluded.preview_size_bytes,
       preview_content_type = excluded.preview_content_type,
       send_url = excluded.send_url,
       send_width = excluded.send_width,
       send_height = excluded.send_height,
       send_size_bytes = excluded.send_size_bytes,
       send_content_type = excluded.send_content_type,
       duration = excluded.duration,
       created_at = excluded.created_at,
       updated_at = excluded.updated_at`
  ).bind(
    userId,
    favorite.provider,
    favorite.gif_id,
    favorite.title,
    favorite.alt_text,
    favorite.query,
    favorite.source_url,
    favorite.aspect_ratio,
    favorite.preview_url,
    favorite.preview_width,
    favorite.preview_height,
    favorite.preview_size_bytes,
    favorite.preview_content_type,
    favorite.send_url,
    favorite.send_width,
    favorite.send_height,
    favorite.send_size_bytes,
    favorite.send_content_type,
    favorite.duration ?? null,
    createdAt,
    updatedAt
  ).run();

  await pruneGifFavorites(userId);
}

function getKlipyApiKey(): string | null {
  const env = getEnv() as unknown as { KLIPY_API_KEY?: string };
  return typeof env.KLIPY_API_KEY === "string" && env.KLIPY_API_KEY.trim() ? env.KLIPY_API_KEY.trim() : null;
}

async function fetchKlipy(path: string, params: GifApiParams) {
  const apiKey = getKlipyApiKey();
  if (!apiKey) {
    throw new Error("KLIPY API key is not configured");
  }

  let urlString: string;
  if (path.startsWith("/api/v1/")) {
    const replacedPath = path.replace("{app_key}", apiKey);
    urlString = `https://api.klipy.com${replacedPath}`;
  } else {
    urlString = `${KLIPY_API_URL}${path}`;
  }

  const url = new URL(urlString);
  if (!path.startsWith("/api/v1/")) {
    url.searchParams.set("key", apiKey);
  }

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
    throw new TenorRequestError(`KLIPY request failed with ${res.status}`, res.status);
  }

  return res.json() as Promise<any>;
}

async function registerKlipyShare(id: string, query: string | undefined) {
  await fetchKlipy("/registershare", {
    id,
    q: query,
  });
}

async function fetchGifProviderCached(
  provider: SearchGifProvider,
  path: string,
  params: GifApiParams,
  cache: { freshTtlSeconds: number; staleTtlSeconds: number }
) {
  const cacheKey =
    provider === "tenor"
      ? buildTenorCacheKey(path, params)
      : buildGifProviderCacheKey(provider, path, params);
  const cached = await readKvJson<KvCacheEntry<any>>(cacheKey);
  const now = Date.now();
  if (cached?.data && now - cached.cachedAt < cache.freshTtlSeconds * 1000) {
    return cached.data;
  }

  let request = inFlightTenorRequests.get(cacheKey);
  if (!request) {
    request = (provider === "tenor" ? fetchTenor(path, params) : fetchKlipy(path, params))
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

function parseTenorLimit(raw: string | null, fallback: number, max = MAX_TENOR_LIMIT): number {
  const parsed = Number(raw || fallback);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(Math.floor(parsed), max);
}

const GET = async ({ request }: any) => {
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") || "search";
  const provider = getGifProvider(url.searchParams.get("provider"));
  const isDemoRequest = url.searchParams.get("demo") === "1";
  let userId: string | null = null;

  if (isDemoRequest) {
    const requestedProvider = url.searchParams.get("provider");
    if (requestedProvider && requestedProvider !== "klipy" && requestedProvider !== "tenor") {
      return apiError("Unsupported GIF provider", 400);
    }

    if (mode !== "categories" && mode !== "search" && mode !== "autocomplete" && mode !== "suggestions") {
      return apiError("Demo GIF access only supports browsing, search, autocomplete, and suggestions", 403);
    }

    const cursor = url.searchParams.get("next");
    if (cursor && cursor.length > DEMO_MAX_CURSOR_LENGTH) {
      return apiError("GIF cursor is too long", 400);
    }
  } else {
    const authResult = await requireAuth();
    if (authResult instanceof Response) return authResult;
    userId = authResult.userId;
  }

  try {
    if (mode === "register-share") {
      const id = url.searchParams.get("id")?.trim();
      if (!id) {
        return apiError("GIF id is required", 400);
      }

      if (provider === "klipy") {
        await registerKlipyShare(id, url.searchParams.get("q")?.trim() || undefined);
      }

      return apiSuccess({ ok: true });
    }

    if (mode === "favorites") {
      if (!userId) return apiError("Authentication required", 401);
      return apiSuccess({ favorites: await listGifFavorites(userId) });
    }

    if (mode === "categories") {
      const data = await fetchGifProviderCached(
        provider,
        "/categories",
        {
          limit: parseTenorLimit(
            url.searchParams.get("limit"),
            isDemoRequest ? DEMO_MAX_GIF_LIMIT : MAX_TENOR_LIMIT,
            isDemoRequest ? DEMO_MAX_GIF_LIMIT : MAX_TENOR_LIMIT
          ),
          contentfilter: "high",
          type: "featured",
        },
        TENOR_CATEGORIES_CACHE
      );

      return apiSuccess({
        categories: Array.isArray(data.tags)
          ? data.tags.map(provider === "tenor" ? normalizeTenorCategory : normalizeKlipyCategory).filter(Boolean)
          : [],
      });
    }

    if (mode === "autocomplete") {
      const q = url.searchParams.get("q")?.trim() || "";
      if (q.length < 2) {
        return apiSuccess({ results: [] });
      }

      let results: string[] = [];
      if (provider === "klipy") {
        const data = await fetchGifProviderCached(
          provider,
          `/api/v1/{app_key}/autocomplete/${encodeURIComponent(q)}`,
          {},
          AUTOCOMPLETE_CACHE
        );
        results = normalizeSuggestions(data);
      } else {
        const data = await fetchGifProviderCached(
          provider,
          "/autocomplete",
          { q, limit: 10 },
          AUTOCOMPLETE_CACHE
        );
        results = normalizeSuggestions(data);
      }
      return apiSuccess({ results });
    }

    if (mode === "suggestions") {
      const q = url.searchParams.get("q")?.trim() || "";
      if (q.length < 2) {
        return apiSuccess({ results: [] });
      }

      let results: string[] = [];
      if (provider === "klipy") {
        const data = await fetchGifProviderCached(
          provider,
          `/api/v1/{app_key}/search-suggestions/${encodeURIComponent(q)}`,
          {},
          SUGGESTIONS_CACHE
        );
        results = normalizeSuggestions(data);
      } else {
        const data = await fetchGifProviderCached(
          provider,
          "/search_suggestions",
          { q, limit: 10 },
          SUGGESTIONS_CACHE
        );
        results = normalizeSuggestions(data);
      }
      return apiSuccess({ results });
    }

    const query = url.searchParams.get("q")?.trim().slice(0, isDemoRequest ? DEMO_MAX_QUERY_LENGTH : 80) || undefined;
    const mediaType = (url.searchParams.get("mediaType") || "gifs") as "gifs" | "stickers" | "clips";

    if (provider === "tenor" && mediaType === "clips") {
      return apiSuccess({ results: [], next: null });
    }

    if (isDemoRequest && !query && mediaType === "gifs") {
      return apiSuccess({ results: [], next: null });
    }

    const next = url.searchParams.get("next") || undefined;
    const limit = parseTenorLimit(
      url.searchParams.get("limit"),
      isDemoRequest ? DEMO_MAX_GIF_LIMIT : 24,
      isDemoRequest ? DEMO_MAX_GIF_LIMIT : MAX_TENOR_LIMIT
    );

    let endpoint = "";
    let params: GifApiParams = {};
    const cacheConfig = query ? TENOR_SEARCH_CACHE : TENOR_FEATURED_CACHE;

    if (provider === "klipy" && (mediaType === "stickers" || mediaType === "clips")) {
      const pageNumber = next ? parseInt(next, 10) : 1;
      params.page = pageNumber;
      params.per_page = limit;
      if (query) {
        params.q = query;
        endpoint = `/api/v1/{app_key}/${mediaType}/search`;
      } else {
        endpoint = `/api/v1/{app_key}/${mediaType}/trending`;
      }
    } else {
      endpoint = query ? "/search" : "/featured";
      params.q = query;
      params.limit = limit;
      params.pos = next;
      params.contentfilter = "high";

      if (provider === "tenor" && mediaType === "stickers") {
        params.searchfilter = "sticker";
      } else if (mediaType === "gifs") {
        params.media_filter = "gif,mediumgif,tinygif,mp4,tinymp4";
      }
    }

    const data = await fetchGifProviderCached(
      provider,
      endpoint,
      params,
      cacheConfig
    );

    let results: GifPickerItem[] = [];
    let nextCursor: string | null = null;

    if (provider === "klipy" && (mediaType === "stickers" || mediaType === "clips")) {
      const resultsArray = data.data?.data || [];
      results = resultsArray
        .map((item: any) => normalizeKlipyNativeResult(item, mediaType))
        .filter((item: any): item is GifPickerItem => item !== null);

      if (data.data?.has_next) {
        const currentPage = data.data?.current_page || 1;
        nextCursor = String(currentPage + 1);
      }
    } else {
      const resultsArray = data.results || [];
      results = resultsArray
        .map(provider === "tenor" ? normalizeTenorGifResult : normalizeKlipyGifResult)
        .filter((item: any): item is GifPickerItem => item !== null);
      nextCursor = data.next || null;
    }

    return apiSuccess({
      results: dedupeGifPickerItems(results),
      next: nextCursor,
    });
  } catch (error) {
    if (error instanceof TenorRequestError && error.status === 429) {
      return apiError(
        `${provider === "tenor" ? "Tenor" : "KLIPY"} is rate limited. Try again shortly.`,
        429,
        provider === "tenor" ? "TENOR_RATE_LIMITED" : "KLIPY_RATE_LIMITED"
      );
    }

    return apiError(error instanceof Error ? error.message : "Failed to fetch GIFs", 502);
  }
};

const POST = async ({ request }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") || "favorite";

  try {
    const body = await request.json() as FavoriteWriteBody;

    if (mode === "favorites/import") {
      const favorites = Array.isArray(body.favorites) ? body.favorites.slice(0, MAX_FAVORITE_IMPORT_COUNT) : [];
      for (const [index, rawFavorite] of favorites.entries()) {
        const favorite = normalizeFavorite(rawFavorite);
        if (!favorite) continue;
        await upsertGifFavorite(userId, favorite, new Date(Date.now() - index).toISOString());
      }
      return apiSuccess({ favorites: await listGifFavorites(userId) });
    }

    const favorite = normalizeFavorite(body.favorite);
    if (!favorite) return apiError("Invalid GIF favorite", 400, "INVALID_GIF_FAVORITE");

    await upsertGifFavorite(userId, favorite);
    return apiSuccess({ favorite: toGifPickerItem(favorite), favorites: await listGifFavorites(userId) }, 201);
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Failed to save GIF favorite", 400);
  }
};

const DELETE = async ({ request }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  try {
    const body = await request.json().catch(() => ({})) as FavoriteWriteBody;
    const provider = normalizeFavoriteProvider(body.provider);
    const gifId = clampString(body.gif_id, "", 512);
    if (!gifId) return apiError("GIF favorite id is required", 400, "MISSING_GIF_ID");

    await getDB().prepare(
      `DELETE FROM gif_favorites WHERE user_id = ? AND provider = ? AND gif_id = ?`
    ).bind(userId, provider, gifId).run();

    return apiSuccess({ favorites: await listGifFavorites(userId) });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Failed to remove GIF favorite", 400);
  }
};

export const Route = createFileRoute('/api/gifs')({
  server: {
    handlers: {
      GET,
      POST,
      DELETE,
    }
  }
});
