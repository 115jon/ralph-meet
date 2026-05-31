// Feature: owned-game-capture-hook, Property 8: The panel preserves the last
// good stats and flags staleness on failure — the reducer preserves the last
// good stats and flags staleness on failure. A successful poll replaces `data`
// and clears `stale`; a failed or empty poll keeps the last good `data` and
// sets `stale = true`.
//
// Validates: Requirements 8.10

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  initialStatsReducerState,
  reduceStatsState,
  type StatsPollEvent,
  type StatsReducerState,
} from "@/hooks/useNativeShareStats";
import type { NativeShareStatsSnapshot } from "@/types/native-share-stats";

// ── Smart generators ───────────────────────────────────────────────────────

// Arbitrary snapshot constrained to the `NativeShareStatsSnapshot` shape:
// each field is generated from its own value space (the string unions from
// their literal sets, counters/timing as non-negative-ish numbers, negotiated
// params as `number | null`). The reducer treats the snapshot opaquely, so the
// shape only needs to be type-faithful, not semantically constrained.
const snapshotArb: fc.Arbitrary<NativeShareStatsSnapshot> = fc.record({
  capture_mode: fc.constantFrom("hook", "wgc"),
  capture_policy: fc.constantFrom("hook-exclusive", "wgc-enabled"),
  capture_unavailable: fc.boolean(),
  foreign_hook: fc.boolean(),
  active_backend: fc.constantFrom("dx11", "dx12", "vulkan", "opengl", "n/a"),
  encoder_backend: fc.constantFrom(
    "nvenc",
    "amf",
    "quicksync",
    "generic_hw",
    "software",
  ),
  fallback_reason: fc.constantFrom("none", "watchdog_timeout", "monitor_source"),
  captured_frames: fc.nat(),
  encoded_frames: fc.nat(),
  encode_errors: fc.nat(),
  samples_written: fc.nat(),
  dropped_frames: fc.nat(),
  last_fused_gpu_us: fc.nat(),
  last_encode_submit_us: fc.nat(),
  fused_gpu_us_avg: fc.nat(),
  encode_submit_us_avg: fc.nat(),
  negotiated_width: fc.option(fc.nat(), { nil: null }),
  negotiated_height: fc.option(fc.nat(), { nil: null }),
  negotiated_fps: fc.option(fc.double({ min: 0, max: 240, noNaN: true }), {
    nil: null,
  }),
});

// Arbitrary poll event over the full discriminated union: `ok` carries an
// arbitrary snapshot, `empty`/`error` carry nothing.
const pollEventArb: fc.Arbitrary<StatsPollEvent> = fc.oneof(
  snapshotArb.map((data) => ({ type: "ok", data }) as StatsPollEvent),
  fc.constant({ type: "empty" } as StatsPollEvent),
  fc.constant({ type: "error" } as StatsPollEvent),
);

describe("reduceStatsState — Property 8 (preserve last good stats, flag staleness)", () => {
  it("ok replaces data & clears stale; empty/error keeps prior data & flags stale", () => {
    fc.assert(
      fc.property(
        // Arbitrary sequences of poll events folded through the reducer.
        fc.array(pollEventArb, { minLength: 1, maxLength: 50 }),
        (events) => {
          let prev: StatsReducerState = initialStatsReducerState;

          for (const event of events) {
            const next = reduceStatsState(prev, event);

            if (event.type === "ok") {
              // A successful poll replaces `data` and clears `stale`.
              expect(next.data).toBe(event.data);
              expect(next.stale).toBe(false);
            } else {
              // A failed/empty poll keeps the last good `data` and sets stale.
              expect(next.data).toBe(prev.data);
              expect(next.stale).toBe(true);
            }

            prev = next;
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // Concrete anchors documenting the two transitions from a known prior state.
  it("ok: replaces data and clears stale even when prior was stale", () => {
    const data = {} as NativeShareStatsSnapshot;
    const prev: StatsReducerState = { data: null, stale: true };
    expect(reduceStatsState(prev, { type: "ok", data })).toEqual({
      data,
      stale: false,
    });
  });

  it("empty/error: preserves the last good data and flags stale", () => {
    const good = {} as NativeShareStatsSnapshot;
    const prev: StatsReducerState = { data: good, stale: false };
    expect(reduceStatsState(prev, { type: "empty" })).toEqual({
      data: good,
      stale: true,
    });
    expect(reduceStatsState(prev, { type: "error" })).toEqual({
      data: good,
      stale: true,
    });
  });
});
