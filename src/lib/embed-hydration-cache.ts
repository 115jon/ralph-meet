// ── embed-hydration-cache ───────────────────────────────────────────────────
// TikTok and Instagram cards refresh their signed media through
// /api/tiktok-video and /api/instagram-video. The message list is
// virtualised, so a card remounts every time it scrolls back into view; each
// mount used to fetch again. This module keeps one in-flight request per URL
// and remembers the answer for as long as its signed URLs stay valid, plus a
// short negative entry for posts the server reports as gone. Errors are not
// remembered, so the next mount retries.

export type EmbedHydrationResult<T> =
  | { status: "ok"; payload: T }
  /** The server confirmed the post is deleted or private (HTTP 404). */
  | { status: "missing" }
  | { status: "error" };

type CacheEntry =
  | { status: "ok"; payload: unknown; expiresAt: number }
  | { status: "missing"; expiresAt: number };

const SAFETY_WINDOW_MS = 5 * 60 * 1000;
const MAX_POSITIVE_MS = 45 * 60 * 1000;
const DEFAULT_POSITIVE_MS = 10 * 60 * 1000;
export const MISSING_TTL_MS = 10 * 60 * 1000;

const entries = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<EmbedHydrationResult<unknown>>>();

/**
 * Earliest signature expiry in a payload, in epoch ms: TikTok's `x-expires`
 * (epoch seconds) and Instagram's `oe` (epoch seconds, hex).
 */
export function earliestSignedUrlExpiry(payload: unknown): number | null {
  let text: string;
  try {
    text = JSON.stringify(payload) ?? "";
  } catch {
    return null;
  }
  let earliest: number | null = null;
  for (const match of text.matchAll(/[?&]x-expires=(\d{9,11})/g)) {
    const ms = Number(match[1]) * 1000;
    if (earliest === null || ms < earliest) earliest = ms;
  }
  for (const match of text.matchAll(/[?&]oe=([0-9a-fA-F]{8})/g)) {
    const ms = Number.parseInt(match[1], 16) * 1000;
    if (Number.isFinite(ms) && (earliest === null || ms < earliest)) {
      earliest = ms;
    }
  }
  return earliest;
}

function positiveExpiry(payload: unknown, now: number): number {
  const expiry = earliestSignedUrlExpiry(payload);
  if (expiry === null) return now + DEFAULT_POSITIVE_MS;
  return Math.min(now + MAX_POSITIVE_MS, expiry - SAFETY_WINDOW_MS);
}

/** Synchronous read so a remounting card can render hydrated at once. */
export function peekEmbedHydration<T>(
  key: string,
  now = Date.now(),
): EmbedHydrationResult<T> | null {
  const entry = entries.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    entries.delete(key);
    return null;
  }
  return entry.status === "ok"
    ? { status: "ok", payload: entry.payload as T }
    : { status: "missing" };
}

export function hydrationKey(endpoint: string, url: string): string {
  return `${endpoint}?videoUrl=${encodeURIComponent(url)}`;
}

/**
 * Fetch `requestUrl` once per key. Callers that unmount simply ignore the
 * result; the shared request is never aborted on their behalf.
 */
export function loadEmbedHydration<T>(
  key: string,
  requestUrl: string,
): Promise<EmbedHydrationResult<T>> {
  const cached = peekEmbedHydration<T>(key);
  if (cached) return Promise.resolve(cached);

  const existing = inflight.get(key);
  if (existing) return existing as Promise<EmbedHydrationResult<T>>;

  const request = (async (): Promise<EmbedHydrationResult<unknown>> => {
    try {
      const response = await fetch(requestUrl);
      if (response.status === 404) {
        entries.set(key, {
          status: "missing",
          expiresAt: Date.now() + MISSING_TTL_MS,
        });
        return { status: "missing" };
      }
      if (!response.ok) return { status: "error" };
      const payload = (await response.json()) as unknown;
      const now = Date.now();
      const expiresAt = positiveExpiry(payload, now);
      if (expiresAt > now) {
        entries.set(key, { status: "ok", payload, expiresAt });
      }
      return { status: "ok", payload };
    } catch {
      return { status: "error" };
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, request);
  return request as Promise<EmbedHydrationResult<T>>;
}

/** Test hook. */
export function clearEmbedHydrationCache(): void {
  entries.clear();
  inflight.clear();
}
