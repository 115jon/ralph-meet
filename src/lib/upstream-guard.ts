// ── upstream-guard ──────────────────────────────────────────────────────────
// Request hygiene for third-party upstreams (TikTok, tikwm, Instagram, X
// mirrors, ...). Two pieces, both per isolate:
//
//   - A circuit breaker per provider. A 429 (or a status the caller names,
//     such as tikwm's "Free Api Limit" or a 403 bot wall) opens the circuit
//     for the upstream's Retry-After, or for an exponential backoff when it
//     sends none. Repeated network errors and 5xx open it too. While it is
//     open, calls fail fast with `UpstreamBlockedError` instead of reaching
//     the upstream, and callers treat that as a transient miss.
//   - A small TTL memo for short negative results ("this lookup failed a
//     minute ago"), so a burst of identical requests does not each go out.
//
// Workers reuse an isolate for many requests, so isolate state already
// absorbs bursts. Longer-lived answers (a post that is gone, a resolved
// lookup) belong in KV through `@/lib/cache`; this module never writes KV.

import { safeFetch, type SafeFetchOptions } from "@/lib/safe-fetch";
import { clog } from "@/lib/console-logger";

const log = clog("upstream-guard");

/** Every guard and memo in the isolate, so tests can start clean. */
const resettables = new Set<{ reset(): void }>();

/** Test hook: forget every breaker state and memoized result. */
export function resetUpstreamState(): void {
  for (const item of resettables) item.reset();
}

/** First open window when an upstream answers 429 without Retry-After. */
const BASE_OPEN_MS = 30_000;
/** Longest an upstream is skipped in one go. */
const MAX_OPEN_MS = 10 * 60_000;
/** Consecutive network errors or 5xx before the circuit opens. */
const FAILURE_THRESHOLD = 3;

/** Thrown instead of calling an upstream whose circuit is open. */
export class UpstreamBlockedError extends Error {
  constructor(
    readonly provider: string,
    readonly retryAfterSeconds: number,
  ) {
    super(`${provider} is backing off for ${retryAfterSeconds}s`);
    this.name = "UpstreamBlockedError";
  }
}

/** Seconds from a Retry-After header (delta-seconds or an HTTP date). */
export function parseRetryAfter(
  value: string | null | undefined,
  now = Date.now(),
): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, Math.ceil((date - now) / 1000));
}

interface BreakerState {
  /** Consecutive soft failures (network, 5xx). */
  failures: number;
  /** Times the circuit opened in a row; drives the backoff. */
  trips: number;
  openUntil: number;
}

export interface GuardedFetchOptions extends SafeFetchOptions {
  /** Statuses that open the circuit at once. 429 always does. */
  tripOn?: ReadonlyArray<number>;
}

export interface UpstreamGuard {
  /** Milliseconds until the provider may be called again; 0 when closed. */
  remainingMs(provider: string): number;
  /** Throws `UpstreamBlockedError` when the provider's circuit is open. */
  assertClosed(provider: string): void;
  recordSuccess(provider: string): void;
  /** A soft failure (network error, 5xx); opens after a few in a row. */
  recordFailure(provider: string): void;
  /** Open the circuit now (429, a bot wall, an API's rate-limit code). */
  trip(provider: string, retryAfterSeconds?: number): void;
  /**
   * `safeFetch` behind the provider's circuit. Statuses are returned to the
   * caller as usual; the guard only watches them.
   */
  fetch(
    provider: string,
    input: string | URL,
    init?: RequestInit,
    options?: GuardedFetchOptions,
  ): Promise<Response>;
  /** Test hook. */
  reset(): void;
}

export function createUpstreamGuard(
  now: () => number = () => Date.now(),
): UpstreamGuard {
  const states = new Map<string, BreakerState>();

  const stateOf = (provider: string): BreakerState => {
    let state = states.get(provider);
    if (!state) {
      state = { failures: 0, trips: 0, openUntil: 0 };
      states.set(provider, state);
    }
    return state;
  };

  const remainingMs = (provider: string): number => {
    const state = states.get(provider);
    if (!state) return 0;
    return Math.max(0, state.openUntil - now());
  };

  const trip = (provider: string, retryAfterSeconds?: number): void => {
    const state = stateOf(provider);
    state.trips += 1;
    state.failures = 0;
    const backoff = Math.min(
      MAX_OPEN_MS,
      BASE_OPEN_MS * 2 ** Math.min(state.trips - 1, 8),
    );
    const requested =
      retryAfterSeconds !== undefined && retryAfterSeconds > 0
        ? Math.min(MAX_OPEN_MS, retryAfterSeconds * 1000)
        : undefined;
    state.openUntil = now() + (requested ?? backoff);
    log.warn("Upstream circuit opened", {
      provider,
      openForMs: state.openUntil - now(),
      trips: state.trips,
    });
  };

  const recordSuccess = (provider: string): void => {
    const state = states.get(provider);
    if (!state) return;
    state.failures = 0;
    state.trips = 0;
    state.openUntil = 0;
  };

  const recordFailure = (provider: string): void => {
    const state = stateOf(provider);
    state.failures += 1;
    if (state.failures >= FAILURE_THRESHOLD) trip(provider);
  };

  const assertClosed = (provider: string): void => {
    const remaining = remainingMs(provider);
    if (remaining > 0) {
      throw new UpstreamBlockedError(provider, Math.ceil(remaining / 1000));
    }
  };

  const guard: UpstreamGuard = {
    remainingMs,
    assertClosed,
    recordSuccess,
    recordFailure,
    trip,
    async fetch(provider, input, init, options) {
      assertClosed(provider);
      let response: Response;
      try {
        response = await safeFetch(input, init, options);
      } catch (error) {
        recordFailure(provider);
        throw error;
      }
      const status = response.status;
      if (status === 429 || options?.tripOn?.includes(status)) {
        trip(provider, parseRetryAfter(response.headers.get("Retry-After")));
      } else if (status >= 500) {
        recordFailure(provider);
      } else {
        recordSuccess(provider);
      }
      return response;
    },
    reset() {
      states.clear();
    },
  };
  resettables.add(guard);
  return guard;
}

/** The isolate's guard. */
export const upstreamGuard = createUpstreamGuard();

// ── TTL memo ────────────────────────────────────────────────────────────────

/** A bounded in-memory map whose entries expire. Oldest entries go first. */
export class TtlMemo<T> {
  private readonly entries = new Map<string, { value: T; expiresAt: number }>();

  constructor(
    private readonly maxEntries = 500,
    private readonly now: () => number = () => Date.now(),
  ) {
    resettables.add(this);
  }

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T, ttlMs: number): void {
    if (ttlMs <= 0) return;
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  reset(): void {
    this.entries.clear();
  }
}
