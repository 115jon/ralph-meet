import { DurableObject } from "cloudflare:workers";

interface Env {
  // Bindings
}

interface RateLimitConfig {
  limit: number;
  windowMs: number;
}

interface BucketEntry {
  count: number;
  windowStart: number;
}

/**
 * A generic sliding-window Rate Limiter backed by a Durable Object.
 * Since DOs guarantee single-threaded execution for a given ID,
 * this provides strong, global consistency for rate limiting.
 */
// @ts-ignore — workerd environment types vs Next.js node types conflict
export class RateLimiterDO extends DurableObject {
  // We keep state entirely in memory for extreme speed.
  // Rate limits are ephemeral; losing them on a DO evict is acceptable,
  // because DOs only evict after prolonged periods of inactivity anyway.
  private buckets: Map<string, BucketEntry> = new Map();
  private lastCleanup = Date.now();
  private static readonly CLEANUP_INTERVAL_MS = 60_000;
  private static readonly MAX_ENTRIES = 5_000;

  constructor(public ctx: DurableObjectState, public env: Env) {
    super(ctx, env);
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    try {
      const { action, limit, windowMs } = await request.json() as {
        action: string;
        limit: number;
        windowMs: number;
      };

      if (!action || !limit || !windowMs) {
        return new Response("Missing required fields", { status: 400 });
      }

      this.maybeCleanup();

      const now = Date.now();
      const entry = this.buckets.get(action);

      // New window
      if (!entry || now - entry.windowStart >= windowMs) {
        this.buckets.set(action, { count: 1, windowStart: now });
        return new Response(JSON.stringify({
          allowed: true,
          remaining: limit - 1,
          resetMs: windowMs
        }), { status: 200 });
      }

      entry.count++;

      if (entry.count > limit) {
        const resetMs = windowMs - (now - entry.windowStart);
        return new Response(JSON.stringify({
          allowed: false,
          remaining: 0,
          resetMs
        }), { status: 200 });
      }

      return new Response(JSON.stringify({
        allowed: true,
        remaining: limit - entry.count,
        resetMs: windowMs - (now - entry.windowStart)
      }), { status: 200 });

    } catch (e) {
      console.error("[RateLimiterDO] Error:", e);
      return new Response("Internal error", { status: 500 });
    }
  }

  private maybeCleanup() {
    const now = Date.now();
    if (now - this.lastCleanup < RateLimiterDO.CLEANUP_INTERVAL_MS) return;
    this.lastCleanup = now;

    for (const [key, entry] of this.buckets) {
      if (now - entry.windowStart > 3_600_000) { // Keep up to 1h
        this.buckets.delete(key);
      }
    }

    if (this.buckets.size > RateLimiterDO.MAX_ENTRIES) {
      const sorted = [...this.buckets.entries()]
        .sort((a, b) => a[1].windowStart - b[1].windowStart)
        .slice(0, this.buckets.size - RateLimiterDO.MAX_ENTRIES);
      for (const [key] of sorted) {
        this.buckets.delete(key);
      }
    }
  }
}
