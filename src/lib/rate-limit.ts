// ── API Route Rate Limiter ──────────────────────────────────────────────────
// In-memory sliding window — same approach as the Worker rate limiter but
// keyed by authenticated userId (not IP) for more accurate per-user limits.
//
// In serverless/edge, memory is ephemeral. This provides best-effort
// protection; the worker-level rate limiter provides the hard backstop.

import { NextResponse } from "next/server";

interface BucketEntry {
  count: number;
  windowStart: number;
}

interface RateLimitOptions {
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
  /** General write: 60/min */
  DEFAULT: { limit: 60, windowMs: 60_000 },
} as const;

/**
 * Check rate limit for a user + action combination.
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
