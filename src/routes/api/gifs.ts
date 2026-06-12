import { createFileRoute } from '@tanstack/react-router';

import { apiError, apiSuccess, requireAuth } from "@/lib/api-helpers";
import { extractTenorConfigFromHtml, normalizeTenorCategory, normalizeTenorGifResult, type TenorConfig } from "@/lib/gif-picker";

const TENOR_BOOTSTRAP_URL = "https://tenor.com/search/cat-gifs";
const TENOR_CONFIG_TTL_MS = 30 * 60 * 1000;

let tenorConfigPromise: Promise<TenorConfig | null> | null = null;
let cachedTenorConfig: TenorConfig | null = null;
let cachedTenorConfigExpiresAt = 0;

async function getTenorConfig(): Promise<TenorConfig | null> {
  const now = Date.now();
  if (cachedTenorConfig && cachedTenorConfigExpiresAt > now) return cachedTenorConfig;

  if (!tenorConfigPromise) {
    tenorConfigPromise = fetchTenorConfig()
      .then((config) => {
        if (config) {
          cachedTenorConfig = config;
          cachedTenorConfigExpiresAt = Date.now() + TENOR_CONFIG_TTL_MS;
          return config;
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

async function fetchTenor(path: string, params: Record<string, string | number | undefined>) {
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

const GET = async ({ request }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;

  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") || "search";

  try {
    if (mode === "categories") {
      const data = await fetchTenor("/categories", {
        limit: Number(url.searchParams.get("limit") || 8),
        contentfilter: "high",
      });

      return apiSuccess({
        categories: Array.isArray(data.tags)
          ? data.tags.map(normalizeTenorCategory).filter(Boolean)
          : [],
      });
    }

    const query = url.searchParams.get("q")?.trim() || undefined;
    const next = url.searchParams.get("next") || undefined;
    const endpoint = query ? "/search" : "/featured";
    const data = await fetchTenor(endpoint, {
      q: query,
      limit: Number(url.searchParams.get("limit") || 24),
      pos: next,
      media_filter: "gif,tinygif,mp4,tinymp4",
      contentfilter: "high",
    });

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
