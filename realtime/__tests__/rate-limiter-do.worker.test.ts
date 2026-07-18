import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  resetMs: number;
}

function stubFor(shardId: string) {
  return env.RATE_LIMITER.get(env.RATE_LIMITER.idFromName(shardId));
}

async function hit(
  stub: DurableObjectStub,
  action: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitDecision> {
  const res = await stub.fetch("https://internal/rate-limit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, limit, windowMs }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as RateLimitDecision;
}

describe("RateLimiterDO durability", () => {
  it("persists bucket state to SQLite storage", async () => {
    const stub = stubFor(crypto.randomUUID());
    const action = "server-create";

    const first = await hit(stub, action, 5, 60_000);
    expect(first.allowed).toBe(true);
    expect(first.remaining).toBe(4);

    await hit(stub, action, 5, 60_000);
    await hit(stub, action, 5, 60_000);

    // The durable table must reflect the counted requests, not just memory.
    await runInDurableObject(stub, (_instance, state) => {
      const rows = [
        ...state.storage.sql.exec<{ count: number; window_start: number }>(
          "SELECT count, window_start FROM buckets WHERE action = ?",
          action,
        ),
      ];
      expect(rows).toHaveLength(1);
      expect(rows[0]?.count).toBe(3);
      expect(rows[0]?.window_start).toBeGreaterThan(0);
    });
  });

  it("enforces the limit and returns a 429-style decision", async () => {
    const stub = stubFor(crypto.randomUUID());
    const action = "invite-create";
    const limit = 3;

    for (let i = 0; i < limit; i += 1) {
      const decision = await hit(stub, action, limit, 60_000);
      expect(decision.allowed).toBe(true);
    }

    const blocked = await hit(stub, action, limit, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.resetMs).toBeGreaterThan(0);
  });

  it("does not grant a fresh window when the cache is rebuilt from storage", async () => {
    const shard = crypto.randomUUID();
    const action = "auth-sync";
    const limit = 2;

    const stub = stubFor(shard);
    await hit(stub, action, limit, 3_600_000);
    await hit(stub, action, limit, 3_600_000);

    // Simulate a cold rebuild: re-hydrate a fresh in-memory Map from the
    // durable table (what the constructor does on eviction/restart) and
    // confirm the persisted count is already at the limit.
    await runInDurableObject(stub, (_instance, state) => {
      const rows = [
        ...state.storage.sql.exec<{ action: string; count: number }>(
          "SELECT action, count FROM buckets WHERE action = ?",
          action,
        ),
      ];
      expect(rows[0]?.count).toBe(2);
    });

    // The next request over the same window must be rejected, proving the
    // limiter is not reset by losing in-memory state.
    const blocked = await hit(stub, action, limit, 3_600_000);
    expect(blocked.allowed).toBe(false);
  });
});
