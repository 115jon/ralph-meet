// Feature: owned-game-capture-hook, Property 9: The backend conditionally
// renders the graphics-API backend (carried) — for any
// NativeShareStatsSnapshot, the pure helper `graphicsBackendLabel` yields the
// active Graphics_API_Backend (uppercased) EXACTLY while the active capture
// mode is `hook` (and capture is not in the explicit unavailable state) with a
// real backend value, and omits it (returns `null`) in every other mode.
//
// Validates: Requirements 8.3

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { graphicsBackendLabel } from "@/components/voice/streamingStats";
import type { NativeShareStatsSnapshot } from "@/types/native-share-stats";

// ── Smart generators over the fields that drive the conditional ────────────
//
// Only `capture_mode`, `capture_unavailable`, and `active_backend` decide the
// outcome of `graphicsBackendLabel`. The generators below constrain those to
// the meaningful equivalence classes while still exercising the edges:
//
//  - capture_mode: the two serialized modes (`hook` drives the value; `wgc`
//    must omit it).
//  - capture_unavailable: both flags (a `true` flag must omit the value even
//    while the mode is `hook`).
//  - active_backend: real backends in assorted casing/whitespace (which must
//    surface, uppercased and trimmed) AND the omit-cases the helper must
//    suppress — the `"n/a"` marker in mixed case, empty, and whitespace-only.

const captureModeArb: fc.Arbitrary<NativeShareStatsSnapshot["capture_mode"]> =
  fc.constantFrom("hook", "wgc");

// Real, surface-able backends — including mixed case and padding so the test
// also pins the trim()+toUpperCase() normalization the property requires.
const realBackendArb: fc.Arbitrary<string> = fc.constantFrom(
  "dx11",
  "dx12",
  "vulkan",
  "opengl",
  "DX11",
  "Vulkan",
  "  dx12  ",
  "d3d9",
);

// Backends that MUST be omitted: the non-backend marker in assorted casing,
// plus empty / whitespace-only values.
const omittedBackendArb: fc.Arbitrary<string> = fc.constantFrom(
  "n/a",
  "N/A",
  "N/a",
  "  n/a  ",
  "",
  "   ",
);

const activeBackendArb: fc.Arbitrary<string> = fc.oneof(
  realBackendArb,
  omittedBackendArb,
);

// Build a full snapshot. The non-conditional fields are filled with plausible
// constants — they have no bearing on `graphicsBackendLabel` but keep the value
// a faithful `NativeShareStatsSnapshot`.
const snapshotArb: fc.Arbitrary<NativeShareStatsSnapshot> = fc.record({
  capture_mode: captureModeArb,
  capture_policy: fc.constantFrom("hook-exclusive", "wgc-enabled"),
  capture_unavailable: fc.boolean(),
  foreign_hook: fc.boolean(),
  active_backend: activeBackendArb,
  encoder_backend: fc.constantFrom("nvenc", "amf", "quicksync", "software"),
  fallback_reason: fc.constantFrom("none", "no_frame", "monitor_source"),
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
  negotiated_fps: fc.option(fc.double({ noNaN: true, min: 0, max: 240 }), {
    nil: null,
  }),
});

describe("graphicsBackendLabel — Property 9 (conditional backend rendering)", () => {
  it("surfaces the backend EXACTLY in hook mode with a real backend, omits it otherwise", () => {
    fc.assert(
      fc.property(snapshotArb, (data) => {
        const label = graphicsBackendLabel(data);

        // Independent re-derivation of the property's "real backend" predicate
        // (trimmed, non-empty, not the `n/a` marker — case-insensitive).
        const trimmed = (data.active_backend ?? "").trim();
        const isRealBackend =
          trimmed.length > 0 && trimmed.toLowerCase() !== "n/a";

        // The value is shown EXACTLY when the mode is `hook`, capture is not
        // explicitly unavailable, and the backend is real (Req 8.3).
        const expectShown =
          data.capture_mode === "hook" &&
          !data.capture_unavailable &&
          isRealBackend;

        if (expectShown) {
          // Non-null and normalized: trimmed + uppercased.
          expect(label).not.toBeNull();
          expect(label).toBe(trimmed.toUpperCase());
        } else {
          // Every non-hook / unavailable / non-real case omits the value.
          expect(label).toBeNull();
        }
      }),
      { numRuns: 100 },
    );
  });

  // Concrete anchors documenting representative points of the contract.
  it("shows the uppercased backend while mode is hook", () => {
    const base = makeSnapshot({
      capture_mode: "hook",
      active_backend: "dx11",
    });
    expect(graphicsBackendLabel(base)).toBe("DX11");
  });

  it("omits the backend while mode is wgc", () => {
    const base = makeSnapshot({
      capture_mode: "wgc",
      active_backend: "dx11",
    });
    expect(graphicsBackendLabel(base)).toBeNull();
  });

  it("omits the backend while capture is explicitly unavailable", () => {
    const base = makeSnapshot({
      capture_mode: "hook",
      capture_unavailable: true,
      active_backend: "dx11",
    });
    expect(graphicsBackendLabel(base)).toBeNull();
  });

  it("omits the backend when the value is the n/a marker (any case)", () => {
    for (const marker of ["n/a", "N/A", "  n/a  "]) {
      const base = makeSnapshot({
        capture_mode: "hook",
        active_backend: marker,
      });
      expect(graphicsBackendLabel(base)).toBeNull();
    }
  });
});

// Minimal builder for the concrete anchors: a valid hook snapshot overridden by
// the fields under test.
function makeSnapshot(
  overrides: Partial<NativeShareStatsSnapshot>,
): NativeShareStatsSnapshot {
  return {
    capture_mode: "hook",
    capture_policy: "hook-exclusive",
    capture_unavailable: false,
    foreign_hook: false,
    active_backend: "dx11",
    encoder_backend: "nvenc",
    fallback_reason: "none",
    captured_frames: 0,
    encoded_frames: 0,
    encode_errors: 0,
    samples_written: 0,
    dropped_frames: 0,
    last_fused_gpu_us: 0,
    last_encode_submit_us: 0,
    fused_gpu_us_avg: 0,
    encode_submit_us_avg: 0,
    negotiated_width: null,
    negotiated_height: null,
    negotiated_fps: null,
    ...overrides,
  };
}
