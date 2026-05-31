// Feature: owned-game-capture-hook, Property 7: Computed FPS is always a
// non-negative finite value — for any inputs (prevForwarded, prevAtMs,
// curForwarded, curAtMs), `computeFps` returns a finite, non-negative number;
// it is zero when no time elapsed or the delta is zero/negative.
//
// Validates: Requirements 8.5

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { computeFps } from "@/components/voice/streamingStats";

// Smart generator over the full numeric input space of `computeFps`.
//
// The function accepts any JS `number`, so the generator deliberately mixes:
//  - arbitrary finite doubles (the common case),
//  - the pathological floating-point values the guard must absorb
//    (NaN, ±Infinity), and
//  - boundary/extreme magnitudes (0, ±tiny, ±huge) that exercise the
//    elapsed<=0, delta<=0, and overflow-to-Infinity branches.
const numberArb: fc.Arbitrary<number> = fc.oneof(
  // Finite doubles across a wide range (no NaN / no Infinity here).
  fc.double({ noNaN: true, noDefaultInfinity: true }),
  // Explicit edge cases that the helper must handle without leaking a
  // non-finite or negative result.
  fc.constantFrom(
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    0,
    -0,
    1,
    -1,
    Number.MAX_VALUE,
    -Number.MAX_VALUE,
    Number.MIN_VALUE,
    Number.MAX_SAFE_INTEGER,
    Number.EPSILON,
  ),
);

describe("computeFps — Property 7 (FPS is always non-negative and finite)", () => {
  it("returns a finite, non-negative number for any inputs", () => {
    fc.assert(
      fc.property(
        numberArb,
        numberArb,
        numberArb,
        numberArb,
        (prevForwarded, prevAtMs, curForwarded, curAtMs) => {
          const fps = computeFps(
            prevForwarded,
            prevAtMs,
            curForwarded,
            curAtMs,
          );

          // Core invariant: always a finite, non-negative number.
          expect(typeof fps).toBe("number");
          expect(Number.isFinite(fps)).toBe(true);
          expect(fps).toBeGreaterThanOrEqual(0);

          // Zero exactly when a rate cannot be computed: no/negative elapsed
          // time, a non-advancing/reset forwarded counter, or any non-finite
          // input. (The helper guards non-finite inputs first.)
          const allFinite =
            Number.isFinite(prevForwarded) &&
            Number.isFinite(prevAtMs) &&
            Number.isFinite(curForwarded) &&
            Number.isFinite(curAtMs);
          const elapsedSeconds = (curAtMs - prevAtMs) / 1000;
          const forwardedDelta = curForwarded - prevForwarded;

          if (!allFinite || elapsedSeconds <= 0 || forwardedDelta <= 0) {
            expect(fps).toBe(0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // Concrete anchors documenting representative points of the contract.
  it("computes the forwarded-delta-per-second rate for a normal advance", () => {
    // 60 frames over 1000ms => 60 fps.
    expect(computeFps(100, 1_000, 160, 2_000)).toBeCloseTo(60);
  });

  it("returns 0 when no time has elapsed", () => {
    expect(computeFps(100, 5_000, 160, 5_000)).toBe(0);
  });

  it("returns 0 when the clock goes backwards", () => {
    expect(computeFps(100, 5_000, 160, 4_000)).toBe(0);
  });

  it("returns 0 when the forwarded counter does not advance or resets", () => {
    expect(computeFps(100, 1_000, 100, 2_000)).toBe(0);
    expect(computeFps(100, 1_000, 40, 2_000)).toBe(0);
  });

  it("returns 0 for non-finite inputs", () => {
    expect(computeFps(Number.NaN, 1_000, 160, 2_000)).toBe(0);
    expect(computeFps(100, Number.POSITIVE_INFINITY, 160, 2_000)).toBe(0);
    expect(computeFps(100, 1_000, Number.NEGATIVE_INFINITY, 2_000)).toBe(0);
  });
});
