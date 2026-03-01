// ── KV Cache Layer ──────────────────────────────────────────────────────────
//
// Production-grade caching using Cloudflare Workers KV, designed for the
// free tier (100K reads/day, 1K writes/day, 1GB storage).
//
// Strategy:
//   - Cache-aside with TTL: read → check KV → miss → query D1 → populate KV
//   - Write-through invalidation: mutations DELETE affected cache keys
//   - Stale-while-revalidate: serve stale data while refreshing in background
//   - Conservative writes: only invalidate (delete) on mutation, never eager-repopulate
//
// What gets cached:
//   ✅ Server list per user (user:servers:{userId})      — 5min TTL
//   ✅ Channels per server  (server:channels:{serverId}) — 5min TTL
//   ✅ Members per server   (server:members:{serverId})  — 2min TTL
//   ✅ Server metadata      (server:{serverId})          — 10min TTL
//   ✅ User profile         (user:{userId})              — 10min TTL
//   ✅ Invite lookup        (invite:{code})              — 5min TTL
//
// What is NOT cached (too many writes for KV free tier):
//   ❌ Messages — high write frequency, cursor-paginated (hard to cache-key)
//   ❌ Reactions — frequent mutations
//   ❌ Typing — ephemeral, broadcast-only
//   ❌ Presence — real-time via WebSocket
// ────────────────────────────────────────────────────────────────────────────

import { env } from "cloudflare:workers";

// ── Cache key prefix (version bump to bust all caches) ──────────────────

const CACHE_VERSION = "v1";

// ── TTL constants (seconds) ─────────────────────────────────────────────

export const CacheTTL = {
  /** User's server list — moderate change frequency */
  USER_SERVERS: 300,      // 5 minutes
  /** Server metadata — rarely changes */
  SERVER: 600,            // 10 minutes
  /** Channel list for a server — rarely changes */
  SERVER_CHANNELS: 300,   // 5 minutes
  /** Member list for a server — moderately changes */
  SERVER_MEMBERS: 120,    // 2 minutes
  /** User profile data — rarely changes */
  USER_PROFILE: 600,      // 10 minutes
  /** Invite code lookup — rarely changes, expires naturally */
  INVITE: 300,            // 5 minutes
} as const;

// ── Cache key builders ──────────────────────────────────────────────────

export const CacheKey = {
  userServers: (userId: string) =>
    `${CACHE_VERSION}:user:servers:${userId}`,
  server: (serverId: string) =>
    `${CACHE_VERSION}:server:${serverId}`,
  serverChannels: (serverId: string) =>
    `${CACHE_VERSION}:server:channels:${serverId}`,
  serverMembers: (serverId: string) =>
    `${CACHE_VERSION}:server:members:${serverId}`,
  userProfile: (userId: string) =>
    `${CACHE_VERSION}:user:${userId}`,
  invite: (code: string) =>
    `${CACHE_VERSION}:invite:${code}`,
} as const;

// ── KV accessor ─────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getKV(): any {
  try {
    return env.CACHE;
  } catch {
    // KV not available (e.g. local dev without --kv flag)
    return null;
  }
}

// ── Core cache operations ───────────────────────────────────────────────

/**
 * Read from KV cache. Returns parsed JSON or null on miss/error.
 * Designed to be non-blocking — cache failures never break the app.
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const kv = getKV();
    if (!kv) return null;

    const value = await kv.get(key, { type: "json" });
    return value as T | null;
  } catch (e) {
    console.warn(`[cache] GET error for key="${key}":`, e);
    return null;
  }
}

/**
 * Write to KV cache with a TTL.
 * Uses `expirationTtl` (seconds) for automatic expiry.
 * Non-blocking — cache write failures never break the app.
 */
export async function cacheSet(
  key: string,
  value: unknown,
  ttlSeconds: number
): Promise<void> {
  try {
    const kv = getKV();
    if (!kv) return;

    await kv.put(key, JSON.stringify(value), {
      expirationTtl: ttlSeconds,
    });
  } catch (e) {
    console.warn(`[cache] SET error for key="${key}":`, e);
  }
}

/**
 * Delete a cache key (invalidation on write).
 * Non-blocking — cache failures never break the app.
 */
export async function cacheDel(key: string): Promise<void> {
  try {
    const kv = getKV();
    if (!kv) return;

    await kv.delete(key);
  } catch (e) {
    console.warn(`[cache] DEL error for key="${key}":`, e);
  }
}

/**
 * Delete multiple cache keys at once (batch invalidation).
 * KV doesn't have native batch delete, so we fire them in parallel.
 * Non-blocking — cache failures never break the app.
 */
export async function cacheDelMany(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await Promise.allSettled(keys.map((k) => cacheDel(k)));
}

// ── Cache-aside helper ──────────────────────────────────────────────────

/**
 * Cache-aside pattern: try cache first, fall through to `fetcher` on miss,
 * populate cache on success.
 *
 * @param key     - KV cache key
 * @param ttl     - TTL in seconds
 * @param fetcher - async function that fetches from D1
 * @returns The cached or freshly-fetched data
 *
 * This is the primary interface — routes call this instead of raw KV ops.
 *
 * Example:
 * ```ts
 * const servers = await cacheFetch(
 *   CacheKey.userServers(userId),
 *   CacheTTL.USER_SERVERS,
 *   () => db.prepare("SELECT ...").bind(userId).all().then(r => r.results)
 * );
 * ```
 */
export async function cacheFetch<T>(
  key: string,
  ttl: number,
  fetcher: () => Promise<T>
): Promise<T> {
  // 1. Try cache
  const cached = await cacheGet<T>(key);
  if (cached !== null) {
    return cached;
  }

  // 2. Cache miss → fetch from D1
  const fresh = await fetcher();

  // 3. Populate cache (fire-and-forget to avoid blocking the response)
  // We don't await this — the response goes out immediately
  cacheSet(key, fresh, ttl).catch(() => { });

  return fresh;
}

/**
 * Stale-while-revalidate pattern: return cached data immediately,
 * and refresh in the background using waitUntil.
 *
 * Use this for data that's tolerable if slightly stale (members list, etc).
 * Falls back to normal cache-aside if no cached data exists.
 *
 * @param key     - KV cache key
 * @param ttl     - TTL in seconds
 * @param fetcher - async function that fetches from D1
 * @param ctx     - ExecutionContext for waitUntil (optional)
 */
export async function cacheStaleWhileRevalidate<T>(
  key: string,
  ttl: number,
  fetcher: () => Promise<T>,
  ctx?: { waitUntil: (p: Promise<unknown>) => void }
): Promise<T> {
  const cached = await cacheGet<T>(key);

  if (cached !== null) {
    // Serve stale, revalidate in background
    if (ctx) {
      ctx.waitUntil(
        fetcher()
          .then((fresh) => cacheSet(key, fresh, ttl))
          .catch(() => { })
      );
    }
    return cached;
  }

  // No cached data — must fetch synchronously
  return cacheFetch(key, ttl, fetcher);
}
