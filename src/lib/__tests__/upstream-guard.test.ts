import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createUpstreamGuard,
  parseRetryAfter,
  TtlMemo,
  UpstreamBlockedError,
} from "../upstream-guard";

function clock(start = 1_000_000) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

function stubFetchStatus(...statuses: Array<number | Response>) {
  const queue = [...statuses];
  const fetchMock = vi.fn(async () => {
    const next = queue.shift() ?? 200;
    return typeof next === "number" ? new Response("", { status: next }) : next;
  });
  vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseRetryAfter", () => {
  it("reads delta seconds and HTTP dates", () => {
    expect(parseRetryAfter("120")).toBe(120);
    expect(
      parseRetryAfter(
        "Wed, 21 Oct 2026 07:28:30 GMT",
        Date.UTC(2026, 9, 21, 7, 28),
      ),
    ).toBe(30);
    expect(parseRetryAfter("soon")).toBeUndefined();
    expect(parseRetryAfter(null)).toBeUndefined();
  });
});

describe("upstream circuit breaker", () => {
  it("opens on a 429 for the upstream's Retry-After and fails fast meanwhile", async () => {
    const time = clock();
    const guard = createUpstreamGuard(time.now);
    const fetchMock = stubFetchStatus(
      new Response("", { status: 429, headers: { "Retry-After": "90" } }),
    );

    const first = await guard.fetch("tikwm", "https://tikwm.example/api/");
    expect(first.status).toBe(429);

    await expect(
      guard.fetch("tikwm", "https://tikwm.example/api/"),
    ).rejects.toBeInstanceOf(UpstreamBlockedError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(guard.remainingMs("tikwm")).toBe(90_000);

    time.advance(90_000);
    await guard.fetch("tikwm", "https://tikwm.example/api/");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("backs off exponentially while an upstream keeps refusing, and resets on success", async () => {
    const time = clock();
    const guard = createUpstreamGuard(time.now);
    stubFetchStatus(403, 403, 403, 200, 403);
    const call = () =>
      guard.fetch("player", "https://p.example/", undefined, {
        tripOn: [403],
      });

    await call();
    expect(guard.remainingMs("player")).toBe(30_000);
    time.advance(30_000);
    await call();
    expect(guard.remainingMs("player")).toBe(60_000);
    time.advance(60_000);
    await call();
    expect(guard.remainingMs("player")).toBe(120_000);
    time.advance(120_000);
    await call(); // 200
    expect(guard.remainingMs("player")).toBe(0);
    await call(); // 403 again starts from the base window
    expect(guard.remainingMs("player")).toBe(30_000);
  });

  it("caps the backoff at ten minutes", () => {
    const time = clock();
    const guard = createUpstreamGuard(time.now);
    for (let index = 0; index < 12; index += 1) {
      guard.trip("x");
      time.advance(guard.remainingMs("x"));
    }
    guard.trip("x");
    expect(guard.remainingMs("x")).toBe(10 * 60_000);
  });

  it("opens after three network errors or 5xx in a row, not on one", async () => {
    const time = clock();
    const guard = createUpstreamGuard(time.now);
    stubFetchStatus(503, 502);
    await guard.fetch("page", "https://page.example/");
    await guard.fetch("page", "https://page.example/");
    expect(guard.remainingMs("page")).toBe(0);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network down");
      }) as unknown as typeof fetch,
    );
    await expect(guard.fetch("page", "https://page.example/")).rejects.toThrow(
      "network down",
    );
    expect(guard.remainingMs("page")).toBe(30_000);
  });

  it("keeps providers independent", () => {
    const guard = createUpstreamGuard(clock().now);
    guard.trip("tikwm", 60);
    expect(() => guard.assertClosed("tikwm")).toThrow(UpstreamBlockedError);
    expect(() => guard.assertClosed("tiktok-page")).not.toThrow();
  });
});

describe("TtlMemo", () => {
  it("expires entries and evicts the oldest past its size", () => {
    const time = clock();
    const memo = new TtlMemo<string>(2, time.now);
    memo.set("a", "1", 1_000);
    memo.set("b", "2", 5_000);
    time.advance(1_000);
    expect(memo.get("a")).toBeUndefined();
    expect(memo.get("b")).toBe("2");

    memo.set("c", "3", 5_000);
    memo.set("d", "4", 5_000);
    expect(memo.get("b")).toBeUndefined();
    expect(memo.get("c")).toBe("3");
    expect(memo.get("d")).toBe("4");
  });

  it("ignores non-positive lifetimes", () => {
    const memo = new TtlMemo<string>(10, clock().now);
    memo.set("a", "1", 0);
    expect(memo.get("a")).toBeUndefined();
  });
});
