import { DurableObject } from "cloudflare:workers";
import { clog } from "../src/lib/console-logger";

const log = clog("RateLimiterDO");

interface Env {
  // Bindings
}

interface BucketEntry {
  count: number;
  windowStart: number;
}

/**
 * A generic sliding-window Rate Limiter backed by a Durable Object.
 *
 * Since DOs guarantee single-threaded execution for a given ID, this provides
 * strong, global consistency for rate limiting. State is persisted to the
 * SQLite storage backend so that limits survive DO eviction, code deploys, and
 * crashes — a cold DO no longer hands out a fresh window. The in-memory `Map`
 * is retained purely as a read-through cache for hot keys; the durable source
 * of truth is the `buckets` table.
 */
// @ts-ignore — workerd environment types vs Next.js node types conflict
export class RateLimiterDO extends DurableObject {
  // In-memory cache of the durable buckets table. Fast, but NOT authoritative:
  // it is hydrated from storage on construction and written through on every
  // mutation. Losing it on eviction is fine because storage is reloaded.
  private buckets: Map<string, BucketEntry> = new Map();
  private lastCleanup = Date.now();
  private readonly sql: SqlStorage;
  private static readonly CLEANUP_INTERVAL_MS = 60_000;
  private static readonly MAX_ENTRIES = 5_000;
  private static readonly MAX_AGE_MS = 3_600_000; // keep buckets up to 1h

  constructor(
    public ctx: DurableObjectState,
    public env: Env,
  ) {
    super(ctx, env);
    this.sql = ctx.storage.sql;

    // One-time initialization: create the table and hydrate the cache. Using
    // blockConcurrencyWhile here (not per-request) means the DO refuses to
    // serve requests until its persisted state is loaded, so it can never
    // grant a fresh window off a cold, unhydrated start.
    ctx.blockConcurrencyWhile(async () => {
      this.sql.exec(
        `CREATE TABLE IF NOT EXISTS buckets (
          action TEXT PRIMARY KEY,
          count INTEGER NOT NULL,
          window_start INTEGER NOT NULL
        )`,
      );

      const cursor = this.sql.exec<{
        action: string;
        count: number;
        window_start: number;
      }>("SELECT action, count, window_start FROM buckets");
      for (const row of cursor) {
        this.buckets.set(row.action, {
          count: row.count,
          windowStart: row.window_start,
        });
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    try {
      const { action, limit, windowMs } = (await request.json()) as {
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
        this.setBucket(action, { count: 1, windowStart: now });
        return new Response(
          JSON.stringify({
            allowed: true,
            remaining: limit - 1,
            resetMs: windowMs,
          }),
          { status: 200 },
        );
      }

      const updated: BucketEntry = {
        count: entry.count + 1,
        windowStart: entry.windowStart,
      };
      this.setBucket(action, updated);

      if (updated.count > limit) {
        const resetMs = windowMs - (now - updated.windowStart);
        return new Response(
          JSON.stringify({
            allowed: false,
            remaining: 0,
            resetMs,
          }),
          { status: 200 },
        );
      }

      return new Response(
        JSON.stringify({
          allowed: true,
          remaining: limit - updated.count,
          resetMs: windowMs - (now - updated.windowStart),
        }),
        { status: 200 },
      );
    } catch (e) {
      log.error("Error:", e);
      return new Response("Internal error", { status: 500 });
    }
  }

  /**
   * Write-through update: cache + durable storage. The write is not awaited —
   * the DO output gate holds the response until the write is committed, so the
   * caller never sees an "allowed" decision that isn't yet persisted, while
   * concurrent requests are not blocked.
   */
  private setBucket(action: string, entry: BucketEntry): void {
    this.buckets.set(action, entry);
    this.sql.exec(
      `INSERT INTO buckets (action, count, window_start) VALUES (?, ?, ?)
       ON CONFLICT(action) DO UPDATE SET count = excluded.count, window_start = excluded.window_start`,
      action,
      entry.count,
      entry.windowStart,
    );
  }

  private maybeCleanup() {
    const now = Date.now();
    if (now - this.lastCleanup < RateLimiterDO.CLEANUP_INTERVAL_MS) return;
    this.lastCleanup = now;

    const stale: string[] = [];
    for (const [key, entry] of this.buckets) {
      if (now - entry.windowStart > RateLimiterDO.MAX_AGE_MS) {
        this.buckets.delete(key);
        stale.push(key);
      }
    }

    if (this.buckets.size > RateLimiterDO.MAX_ENTRIES) {
      const sorted = [...this.buckets.entries()]
        .sort((a, b) => a[1].windowStart - b[1].windowStart)
        .slice(0, this.buckets.size - RateLimiterDO.MAX_ENTRIES);
      for (const [key] of sorted) {
        this.buckets.delete(key);
        stale.push(key);
      }
    }

    // Purge evicted keys from durable storage too, so it doesn't grow
    // unbounded. Time-based expiry can also be enforced with a single DELETE.
    this.sql.exec(
      "DELETE FROM buckets WHERE window_start <= ?",
      now - RateLimiterDO.MAX_AGE_MS,
    );
    for (const key of stale) {
      this.sql.exec("DELETE FROM buckets WHERE action = ?", key);
    }
  }
}
