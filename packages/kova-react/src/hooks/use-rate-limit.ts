/**
 * useRateLimit — rate-limit countdown state for auth forms.
 *
 * Consumes the `Retry-After` header value from a 429 response and manages a
 * live countdown that re-enables the form exactly when the server window resets.
 *
 * Design goals:
 *  - Zero-dependency: only React hooks, no external timers library.
 *  - Drift-free: uses `Date.now()` endpoints, not cumulative intervals.
 *  - Persistent: survives re-renders (state, not ref-only).
 *  - Multiple calls safe: each `recordRateLimit` restarts the timer from scratch.
 *
 * @example
 * ```tsx
 * const { isRateLimited, secondsRemaining, recordRateLimit } = useRateLimit();
 *
 * // When a 429 is received:
 * recordRateLimit(retryAfterSeconds);
 *
 * // In JSX:
 * <SubmitButton disabled={isRateLimited || isLoading}>…</SubmitButton>
 * {isRateLimited && <RateLimitBanner secondsRemaining={secondsRemaining} />}
 * ```
 */

import { useCallback, useEffect, useRef, useState } from "react";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface UseRateLimitReturn {
  /**
   * `true` while the rate-limit window is active (secondsRemaining > 0).
   * Subscribe to this to disable submit buttons and block re-submission.
   */
  isRateLimited: boolean;

  /**
   * Whole-number countdown in seconds.  Starts at the Retry-After value and
   * ticks down to 0, at which point `isRateLimited` becomes `false`.
   */
  secondsRemaining: number;

  /**
   * Call this when a 429 response is received.
   * Pass the `Retry-After` header value in seconds.
   * Accepts floats (from fractional server values) — always rounded up.
   *
   * @param retryAfterSeconds - Number of seconds to wait.  Must be ≥ 1.
   */
  recordRateLimit: (retryAfterSeconds: number) => void;

  /**
   * Imperatively clear the rate-limit state (e.g., when the user navigates
   * away from the form or the component unmounts unexpectedly).
   */
  clearRateLimit: () => void;
}

// ── Implementation ─────────────────────────────────────────────────────────────

const TICK_INTERVAL_MS = 200; // 5 Hz — smooth enough, not wasteful

export function useRateLimit(): UseRateLimitReturn {
  // Unix-ms timestamp when the rate limit expires (null = not limited)
  const [expiresAt, setExpiresAt] = useState<number | null>(null);

  // Derived display value from expiresAt (recomputed every tick)
  const [secondsRemaining, setSecondsRemaining] = useState(0);

  // Stable ref to the setInterval ID so we can clear across re-renders
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── countdown loop ────────────────────────────────────────────────────────

  const stopTimer = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (expiresAt === null) {
      stopTimer();
      setSecondsRemaining(0);
      return;
    }

    // Immediately compute on mount / expiresAt change
    const tick = () => {
      const remaining = Math.max(0, expiresAt - Date.now());
      const secs = Math.ceil(remaining / 1000);
      setSecondsRemaining(secs);
      if (remaining <= 0) {
        setExpiresAt(null); // triggers cleanup via next effect run
      }
    };

    tick(); // run immediately — don't wait for first tick

    stopTimer(); // clear any previous interval before starting a new one
    intervalRef.current = setInterval(tick, TICK_INTERVAL_MS);

    return () => {
      stopTimer();
    };
  }, [expiresAt, stopTimer]);

  // ── public API ────────────────────────────────────────────────────────────

  const recordRateLimit = useCallback((retryAfterSeconds: number) => {
    // Clamp to a minimum of 1 second to avoid edge cases with < 0 values
    const clampedSecs = Math.max(1, Math.ceil(retryAfterSeconds));
    setExpiresAt(Date.now() + clampedSecs * 1000);
  }, []);

  const clearRateLimit = useCallback(() => {
    setExpiresAt(null);
  }, []);

  return {
    isRateLimited: expiresAt !== null && secondsRemaining > 0,
    secondsRemaining,
    recordRateLimit,
    clearRateLimit,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Extracts the `Retry-After` value (in seconds) from a Better Auth / HTTP
 * error response.  Returns `null` if the value is absent or unparseable.
 *
 * Better Auth emits `Retry-After` as an integer-seconds HTTP header.
 * Some responses also include `x-ratelimit-reset` (Unix epoch seconds) —
 * we support both and prefer `Retry-After`.
 *
 * Called in hook error-path so it must never throw.
 */
export function extractRetryAfter(err: unknown): number | null {
  if (!err || typeof err !== "object") return null;

  // Better Auth surfaces the raw Response on some adapters
  const asAny = err as Record<string, unknown>;

  // Pattern A: { response: Response }  (Better Auth fetch error shape)
  const response = asAny["response"] as Response | undefined;
  if (response instanceof Response) {
    return parseRetryAfterResponse(response);
  }

  // Pattern B: { status: 429, headers: Headers }  (some wrapper shapes)
  if (asAny["status"] === 429) {
    const rh = asAny["headers"];
    if (rh && typeof (rh as Headers).get === "function") {
      return parseRetryAfterHeaders(rh as Headers);
    }

    // Pattern C: { status: 429, retryAfter: number }  (pre-parsed)
    const pre = asAny["retryAfter"];
    if (typeof pre === "number" && pre > 0) return pre;
  }

  // Pattern D: error.error.status / error.error.headers (Better Auth client shape)
  const inner = asAny["error"] as Record<string, unknown> | undefined;
  if (inner && typeof inner === "object") {
    if (inner["status"] === 429) {
      const ih = inner["headers"];
      if (ih && typeof (ih as Headers).get === "function") {
        return parseRetryAfterHeaders(ih as Headers);
      }
      const pre = inner["retryAfter"];
      if (typeof pre === "number" && pre > 0) return pre;
    }
  }

  return null;
}

function parseRetryAfterResponse(response: Response): number | null {
  return parseRetryAfterHeaders(response.headers);
}

function parseRetryAfterHeaders(headers: Headers): number | null {
  const ra = headers.get("retry-after") ?? headers.get("Retry-After");
  if (!ra) {
    // Fallback to x-ratelimit-reset (epoch seconds)
    const reset = headers.get("x-ratelimit-reset");
    if (reset) {
      const epochSec = parseInt(reset, 10);
      if (!isNaN(epochSec)) {
        const nowSec = Math.floor(Date.now() / 1000);
        const delta = epochSec - nowSec;
        return delta > 0 ? delta : 1;
      }
    }
    return null;
  }

  // Retry-After can be an integer seconds value or an HTTP-date string
  const asNum = parseInt(ra, 10);
  if (!isNaN(asNum) && asNum >= 0) return Math.max(1, asNum);

  // HTTP-date format: "Wed, 21 Oct 2025 07:28:00 GMT"
  const dateSec = Date.parse(ra);
  if (!isNaN(dateSec)) {
    const delta = Math.ceil((dateSec - Date.now()) / 1000);
    return delta > 0 ? delta : 1;
  }

  return null;
}

/**
 * Returns a user-friendly message for rate-limited states.
 * Used in `RateLimitBanner` to avoid hardcoding strings in the component.
 */
export function rateLimitMessage(secondsRemaining: number): string {
  if (secondsRemaining <= 0) return "You can try again now.";
  if (secondsRemaining === 1) return "Too many attempts. Try again in 1 second.";
  return `Too many attempts. Try again in ${secondsRemaining}s.`;
}
