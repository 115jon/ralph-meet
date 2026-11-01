// ── embed-hydration-cache ───────────────────────────────────────────────────
// TikTok and Instagram cards refresh their signed media through
// /api/tiktok-video and /api/instagram-video. The message list is
// virtualised, so a card remounts every time it scrolls back into view; each
// mount used to fetch again. This module keeps one in-flight request per URL
// for the whole session and remembers every answer:
//   - ok: for as long as its signed URLs stay valid;
//   - missing (the server confirmed the post is gone): 10 minutes;
//   - error: until the server's Retry-After (30 s without one, at most
//     10 minutes), so a failing lookup is not re-asked on every remount.
// `retryEmbedHydration` is the explicit, user-initiated way past an error.

export type EmbedHydrationResult<T> =
  | { status: "ok"; payload: T }
  /** The server confirmed the post is deleted or private (HTTP 404). */
  | { status: "missing" }
  /**
   * The lookup failed. `retryAt` (epoch ms) is the earliest the server wants
   * to be asked again; `transient` says whether asking again may help.
   */
  | { status: "error"; retryAt: number; transient: boolean };

type CacheEntry =
  | { status: "ok"; payload: unknown; expiresAt: number }
  | { status: "missing"; expiresAt: number }
  | { status: "error"; transient: boolean; expiresAt: number };

const SAFETY_WINDOW_MS = 5 * 60 * 1000;
const MAX_POSITIVE_MS = 45 * 60 * 1000;
const DEFAULT_POSITIVE_MS = 10 * 60 * 1000;
export const MISSING_TTL_MS = 10 * 60 * 1000;
export const ERROR_DEFAULT_TTL_MS = 30 * 1000;
const ERROR_MAX_TTL_MS = 10 * 60 * 1000;

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
  if (entry.status === "ok") {
    return { status: "ok", payload: entry.payload as T };
  }
  if (entry.status === "error") {
    return {
      status: "error",
      retryAt: entry.expiresAt,
      transient: entry.transient,
    };
  }
  return { status: "missing" };
}

function retryAfterMs(response: Response): number {
  const header = response.headers.get("Retry-After")?.trim();
  let ms: number | undefined;
  if (header && /^\d+$/.test(header)) {
    ms = Number(header) * 1000;
  } else if (header) {
    const date = Date.parse(header);
    if (!Number.isNaN(date)) ms = date - Date.now();
  }
  if (ms === undefined || !Number.isFinite(ms) || ms <= 0) {
    return ERROR_DEFAULT_TTL_MS;
  }
  return Math.min(ERROR_MAX_TTL_MS, ms);
}

function rememberError(
  key: string,
  ttlMs: number,
  transient: boolean,
): EmbedHydrationResult<unknown> {
  const expiresAt = Date.now() + ttlMs;
  entries.set(key, { status: "error", transient, expiresAt });
  return { status: "error", retryAt: expiresAt, transient };
}

/** Our routes say in the body whether another attempt can help. */
async function readTransientFlag(
  response: Response,
): Promise<boolean | undefined> {
  if (!response.headers.get("Content-Type")?.includes("json")) {
    return undefined;
  }
  try {
    const body = (await response.json()) as { transient?: unknown } | null;
    return typeof body?.transient === "boolean" ? body.transient : undefined;
  } catch {
    return undefined;
  }
}

/** A 404 only means "gone" when our route says so; a stray 404 is an error. */
async function isConfirmedMissing(response: Response): Promise<boolean> {
  if (!response.headers.get("Content-Type")?.includes("json")) return false;
  try {
    const body = (await response.json()) as { unavailable?: unknown } | null;
    return body?.unavailable === true;
  } catch {
    return false;
  }
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
      if (response.status === 404 && (await isConfirmedMissing(response))) {
        entries.set(key, {
          status: "missing",
          expiresAt: Date.now() + MISSING_TTL_MS,
        });
        return { status: "missing" };
      }
      if (!response.ok) {
        const transient =
          (await readTransientFlag(response)) ??
          (response.status === 408 ||
            response.status === 429 ||
            response.status >= 500);
        return rememberError(key, retryAfterMs(response), transient);
      }
      const payload = (await response.json()) as unknown;
      const now = Date.now();
      const expiresAt = positiveExpiry(payload, now);
      if (expiresAt > now) {
        entries.set(key, { status: "ok", payload, expiresAt });
      }
      return { status: "ok", payload };
    } catch {
      // Offline or the request was cut: worth another try, but not at once.
      return rememberError(key, ERROR_DEFAULT_TTL_MS, true);
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, request);
  return request as Promise<EmbedHydrationResult<T>>;
}

/**
 * A user asked to try again: drop a remembered error and fetch once more.
 * Shares an in-flight request like `loadEmbedHydration`.
 */
export function retryEmbedHydration<T>(
  key: string,
  requestUrl: string,
): Promise<EmbedHydrationResult<T>> {
  if (entries.get(key)?.status === "error") entries.delete(key);
  return loadEmbedHydration<T>(key, requestUrl);
}

/** Test hook. */
export function clearEmbedHydrationCache(): void {
  entries.clear();
  inflight.clear();
}
