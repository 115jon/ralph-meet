// ── API Route Rate Limiter ──────────────────────────────────────────────────
// In-memory sliding window — same approach as the Worker rate limiter but
// keyed by authenticated userId (not IP) for more accurate per-user limits.
//
// In serverless/edge, memory is ephemeral. This provides best-effort
// protection; the worker-level rate limiter provides the hard backstop.

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextResponse } from "next/server";

interface BucketEntry {
  count: number;
  windowStart: number;
}

export interface RateLimitOptions {
  /** Max requests allowed within `windowMs`. */
  limit: number;
  /** Window size in milliseconds. */
  windowMs: number;
}

// Global in-memory store — shared across requests within the same instance
const buckets = new Map<string, BucketEntry>();
let lastCleanup = Date.now();
const CLEANUP_INTERVAL_MS = 60_000; // 1 min
const MAX_ENTRIES = 5_000;

/** Default rate limit presets by route action. */
export const RATE_LIMITS = {
  /** Sending messages: 30/min */
  MESSAGE_SEND: { limit: 30, windowMs: 60_000 },
  /** File uploads: 10/min */
  FILE_UPLOAD: { limit: 10, windowMs: 60_000 },
  /** Reactions: 20/min */
  REACTION: { limit: 20, windowMs: 60_000 },
  /** Creating servers: 5/hr */
  SERVER_CREATE: { limit: 5, windowMs: 3_600_000 },
  /** Creating invites: 10/10min */
  INVITE_CREATE: { limit: 10, windowMs: 600_000 },
  /** Typing indicator: 10/10s */
  TYPING: { limit: 10, windowMs: 10_000 },
  /** Auth routes / login abuse: 10/min */
  AUTH_SYNC: { limit: 10, windowMs: 60_000 },
  /** General write: 60/min */
  DEFAULT: { limit: 60, windowMs: 60_000 },
} as const;

/**
 * Check rate limit globally using a Durable Object token bucket.
 * This guarantees true global consistency, immune to edge node fragmentation.
 * Use for heavy mutations (server creation, auth routes).
 *
 * @param shardId - ID to shard the DO on (e.g. userId or IP address).
 * @param action - Action key (e.g. "server-create").
 * @param opts   - Rate limit configuration.
 */
export async function checkRateLimitDO(
  shardId: string,
  action: string,
  opts: RateLimitOptions = RATE_LIMITS.DEFAULT
): Promise<NextResponse | null> {
  const { env } = getCloudflareContext();

  // We use `idFromName` to deterministically route all requests for this
  // shardId (user/IP) to the exact same global Durable Object instance.
  const id = env.RATE_LIMITER.idFromName(shardId);
  const stub = env.RATE_LIMITER.get(id);

  try {
    const res = await stub.fetch("https://internal/rate-limit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        limit: opts.limit,
        windowMs: opts.windowMs
      }),
    });

    if (!res.ok) {
      console.warn(`[RateLimiterDO] Error response: ${res.status}`);
      return null; // Fail open
    }

    const result = await res.json() as {
      allowed: boolean;
      remaining: number;
      resetMs: number;
    };

    if (!result.allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Please slow down." },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil(result.resetMs / 1000)),
          },
        }
      );
    }

    return null;
  } catch (err) {
    console.error("[RateLimiterDO] Fetch failed directly:", err);
    return null; // Fail open
  }
}

/**
 * Check rate limit for a user + action combination.
 * This uses an ephemeral in-memory store. Best-effort protection.
 *
 * @param userId - The authenticated user's ID.
 * @param action - A string key identifying the action (e.g. route path or preset name).
 * @param opts   - Rate limit configuration.
 *
 * @returns `null` if allowed, or a `NextResponse` (429) if rate-limited.
 */
export function checkRateLimit(
  userId: string,
  action: string,
  opts: RateLimitOptions = RATE_LIMITS.DEFAULT
): NextResponse | null {
  maybeCleanup();

  const key = `${userId}:${action}`;
  const now = Date.now();
  const entry = buckets.get(key);

  // New window
  if (!entry || now - entry.windowStart >= opts.windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    return null;
  }

  entry.count++;

  if (entry.count > opts.limit) {
    const retryAfterMs = opts.windowMs - (now - entry.windowStart);
    return NextResponse.json(
      { error: "Rate limit exceeded. Please slow down." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(retryAfterMs / 1000)),
        },
      }
    );
  }

  return null;
}

function maybeCleanup(): void {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;

  for (const [key, entry] of buckets) {
    if (now - entry.windowStart > 3_600_000) {
      buckets.delete(key);
    }
  }

  if (buckets.size > MAX_ENTRIES) {
    const sorted = [...buckets.entries()]
      .sort((a, b) => a[1].windowStart - b[1].windowStart)
      .slice(0, buckets.size - MAX_ENTRIES);
    for (const [key] of sorted) {
      buckets.delete(key);
    }
  }
}
