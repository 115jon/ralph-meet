import { beforeEach, describe, expect, it } from "vitest";
import { RateLimiter } from "./rate-limiter";

describe("RateLimiter", () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter();
  });

  it("allows requests under the limit", () => {
    const result = limiter.check("1.2.3.4", "GET", "/api/servers");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBeGreaterThan(0);
  });

  it("blocks requests over the limit", () => {
    // Default limit is 60/min for GET /api/servers
    for (let i = 0; i < 60; i++) {
      limiter.check("1.2.3.4", "GET", "/api/servers");
    }
    const result = limiter.check("1.2.3.4", "GET", "/api/servers");
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.resetMs).toBeGreaterThan(0);
  });

  it("applies route-specific limits", () => {
    // POST /api/servers has a 5/hour limit
    for (let i = 0; i < 5; i++) {
      const r = limiter.check("1.2.3.4", "POST", "/api/servers");
      expect(r.allowed).toBe(true);
    }
    const result = limiter.check("1.2.3.4", "POST", "/api/servers");
    expect(result.allowed).toBe(false);
  });

  it("tracks IPs independently", () => {
    // Exhaust one IP
    for (let i = 0; i < 60; i++) {
      limiter.check("1.2.3.4", "GET", "/api/servers");
    }
    // Different IP should still be allowed
    const result = limiter.check("5.6.7.8", "GET", "/api/servers");
    expect(result.allowed).toBe(true);
  });

  it("normalizes dynamic path segments", () => {
    // These should share the same bucket
    for (let i = 0; i < 30; i++) {
      limiter.check("1.2.3.4", "POST", "/api/channels/abc123/messages");
    }
    // Should be blocked even with a different channel ID (same normalized pattern)
    const result = limiter.check("1.2.3.4", "POST", "/api/channels/xyz789/messages");
    expect(result.allowed).toBe(false);
  });

  it("returns correct remaining count", () => {
    // POST /api/servers -> 5/hr limit
    const r1 = limiter.check("1.2.3.4", "POST", "/api/servers");
    expect(r1.remaining).toBe(4);
    const r2 = limiter.check("1.2.3.4", "POST", "/api/servers");
    expect(r2.remaining).toBe(3);
  });

  it("matches upload route before messages route", () => {
    // Upload route has a 10/min limit, not 30
    for (let i = 0; i < 10; i++) {
      limiter.check("1.2.3.4", "POST", "/api/channels/abc/messages/upload");
    }
    const result = limiter.check("1.2.3.4", "POST", "/api/channels/abc/messages/upload");
    expect(result.allowed).toBe(false);
  });
});
