// In-memory Sliding Window Rate Limiter
// Works on the free tier — no KV, D1, or Durable Objects required.
// Counters live in Worker memory and reset on Worker restarts/redeployments.

interface RateLimitConfig {
  limit: number;
  windowMs: number;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetMs: number;
}

interface BucketEntry {
  count: number;
  windowStart: number;
}

const RATE_LIMITS: Record<string, RateLimitConfig> = {
  "POST:/api/channels/*/messages": { limit: 30, windowMs: 60_000 },
  "POST:/api/channels/*/messages/upload": { limit: 10, windowMs: 60_000 },
  "POST:/api/channels/*/typing": { limit: 10, windowMs: 10_000 },
  "POST:/api/servers": { limit: 5, windowMs: 3_600_000 },
  "POST:/api/invites/*/join": { limit: 10, windowMs: 600_000 },
  "DEFAULT": { limit: 60, windowMs: 60_000 },
};

// Pre-compile regex patterns at module load to avoid creating new RegExp per request
const COMPILED_RATE_LIMITS: Array<{ method: string; regex: RegExp; config: RateLimitConfig }> = [];
for (const [pattern, config] of Object.entries(RATE_LIMITS)) {
  if (pattern === "DEFAULT") continue;
  const [configMethod, ...pathParts] = pattern.split(":");
  const configPath = pathParts.join(":");
  const regexStr = "^" + configPath.replace(/\*/g, "[^/]+") + "$";
  COMPILED_RATE_LIMITS.push({ method: configMethod, regex: new RegExp(regexStr), config });
}

export class RateLimiter {
  private buckets: Map<string, BucketEntry> = new Map();
  private lastCleanup = Date.now();
  private static readonly CLEANUP_INTERVAL_MS = 5 * 60_000;
  private static readonly MAX_ENTRIES = 10_000;

  check(clientIP: string, method: string, pathname: string): RateLimitResult {
    this.maybeCleanup();

    const config = this.matchConfig(method, pathname);
    const key = `${clientIP}:${method}:${this.normalizePattern(pathname)}`;
    const now = Date.now();

    const entry = this.buckets.get(key);

    if (!entry || now - entry.windowStart >= config.windowMs) {
      this.buckets.set(key, { count: 1, windowStart: now });
      return { allowed: true, remaining: config.limit - 1, resetMs: config.windowMs };
    }

    entry.count++;

    if (entry.count > config.limit) {
      const resetMs = config.windowMs - (now - entry.windowStart);
      return { allowed: false, remaining: 0, resetMs };
    }

    return {
      allowed: true,
      remaining: config.limit - entry.count,
      resetMs: config.windowMs - (now - entry.windowStart),
    };
  }

  private matchConfig(method: string, pathname: string): RateLimitConfig {
    for (const { method: configMethod, regex, config } of COMPILED_RATE_LIMITS) {
      if (configMethod !== method) continue;
      if (regex.test(pathname)) return config;
    }
    return RATE_LIMITS["DEFAULT"];
  }

  private normalizePattern(pathname: string): string {
    return pathname
      .replace(/\/api\/channels\/[^/]+/g, "/api/channels/*")
      .replace(/\/api\/servers\/[^/]+/g, "/api/servers/*")
      .replace(/\/api\/invites\/[^/]+/g, "/api/invites/*");
  }

  private maybeCleanup() {
    const now = Date.now();
    if (now - this.lastCleanup < RateLimiter.CLEANUP_INTERVAL_MS) return;
    this.lastCleanup = now;

    for (const [key, entry] of this.buckets) {
      if (now - entry.windowStart > 3_600_000) {
        this.buckets.delete(key);
      }
    }

    if (this.buckets.size > RateLimiter.MAX_ENTRIES) {
      const sorted = [...this.buckets.entries()]
        .sort((a, b) => a[1].windowStart - b[1].windowStart)
        .slice(0, this.buckets.size - RateLimiter.MAX_ENTRIES);
      for (const [key] of sorted) {
        this.buckets.delete(key);
      }
    }
  }
}
