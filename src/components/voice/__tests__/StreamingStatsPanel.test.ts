// Unit tests for the StreamingStatsPanel render states (owned-game-capture-hook
// spec, task 11.3).
//
// Validates: Requirements 8.1, 8.2, 8.4, 8.6, 8.7, 8.9, 8.11, 9.2, 9.5, 13.3
//
// Testing approach:
//   The repo's vitest setup runs in the "node" environment with no DOM testing
//   stack installed (no jsdom / happy-dom / @testing-library), and the vitest
//   `include` only matches `*.test.ts`. So — mirroring the existing
//   `participantCardPreview.test.ts` — these tests render the REAL
//   `StreamingStatsPanel` with `react-dom/server`'s `renderToStaticMarkup`
//   (via `React.createElement`, since JSX is unavailable in a `.ts` file) and
//   assert on the produced markup.
//
//   The panel pulls its live stats from `useNativeShareStats()` internally, so
//   that hook is mocked with `vi.mock` to return a controlled
//   `{ data, stale, isDesktop }` for each render state. `useEffect` does not run
//   under server rendering, so the locally-tracked fps stays at its initial 0 —
//   the fps-from-delta math itself is covered by the `computeFps` property test
//   (streamingStats.test.ts / Property 7); here we only assert the panel renders
//   the fps slot without erroring.
//
//   The pure display helpers in `streamingStats.ts` (captureModeDisplay,
//   graphicsBackendLabel, usToMs, formatResolution, formatNegotiatedFps,
//   connectionStateLabel, hasLiveCaptureActivity) deterministically drive every
//   panel state and are additionally exercised directly below so each state of
//   the matrix is pinned without depending on render internals.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type {
  NativeShareStatsSnapshot,
} from "@/types/native-share-stats";
import type { NativeShareStatsState } from "@/hooks/useNativeShareStats";

// ── Mock the live-stats hook so we control every render state ───────────────
const useNativeShareStatsMock = vi.fn<() => NativeShareStatsState>();
vi.mock("@/hooks/useNativeShareStats", () => ({
  useNativeShareStats: () => useNativeShareStatsMock(),
}));

// Imported AFTER the mock is registered.
import { StreamingStatsPanel } from "@/components/voice/StreamingStatsPanel";
import {
  captureModeDisplay,
  connectionStateLabel,
  formatNegotiatedFps,
  formatResolution,
  graphicsBackendLabel,
  hasLiveCaptureActivity,
  usToMs,
} from "@/components/voice/streamingStats";

// A fully-populated, type-faithful snapshot; tests override only what matters.
function makeSnapshot(
  overrides: Partial<NativeShareStatsSnapshot> = {},
): NativeShareStatsSnapshot {
  return {
    capture_mode: "hook",
    capture_policy: "hook-exclusive",
    capture_unavailable: false,
    foreign_hook: false,
    active_backend: "dx11",
    encoder_backend: "nvenc",
    fallback_reason: "none",
    captured_frames: 91,
    encoded_frames: 91,
    encode_errors: 0,
    samples_written: 91,
    dropped_frames: 4,
    last_fused_gpu_us: 3200,
    last_encode_submit_us: 1800,
    fused_gpu_us_avg: 3000,
    encode_submit_us_avg: 1700,
    negotiated_width: 1920,
    negotiated_height: 1080,
    negotiated_fps: 60,
    ...overrides,
  };
}

function setHook(state: Partial<NativeShareStatsState>): void {
  useNativeShareStatsMock.mockReturnValue({
    data: null,
    stale: false,
    isDesktop: true,
    ...state,
  });
}

function render(
  props: Partial<{
    connectionState: string;
    joined: boolean;
    emphasized: boolean;
    shareActive: boolean;
  }> = {},
): string {
  return renderToStaticMarkup(
    React.createElement(StreamingStatsPanel, {
      connectionState: "connected",
      joined: true,
      ...props,
    }),
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

beforeEach(() => {
  // Default: desktop, no data — individual tests override.
  setHook({ data: null, stale: false, isDesktop: true });
});

// ── Panel render states (rendered through the real component) ───────────────

describe("StreamingStatsPanel — render states", () => {
  it("hook mode: shows mode + backend + encoder + counts + timing + negotiated res/fps (Req 8.2, 8.4, 8.6, 9.2)", () => {
    setHook({ data: makeSnapshot(), stale: false });

    const markup = render();

    // Capture mode (Req 8.2)
    expect(markup).toContain("Hook");
    // Graphics_API_Backend shown only while mode is hook (Req 8.3 positive case)
    expect(markup).toContain("DX11");
    // Encoder backend (Req 8.4)
    expect(markup).toContain("nvenc");
    // Forwarded / dropped counts (Req 8.5 — values rendered)
    expect(markup).toContain("91");
    expect(markup).toContain("fwd");
    expect(markup).toContain("4");
    expect(markup).toContain("drop");
    // fps slot present (value computed via useEffect, which server render skips)
    expect(markup).toContain("fps");
    // Capture (fused-GPU) + encode timing in ms (Req 8.6): 3200us -> 3.2, 1800us -> 1.8
    expect(markup).toContain("gpu");
    expect(markup).toContain("3.2");
    expect(markup).toContain("enc");
    expect(markup).toContain("1.8");
    // Negotiated resolution + fps (Req 9.2)
    expect(markup).toContain("1920");
    expect(markup).toContain("1080");
    expect(markup).toContain("@60");
    expect(markup).not.toContain("negotiating");
  });

  it("wgc mode: omits the graphics backend and shows the fallback reason (Req 8.3 negative, 8.7)", () => {
    setHook({
      data: makeSnapshot({
        capture_mode: "wgc",
        active_backend: "dx11", // present in data but must be omitted for non-hook
        fallback_reason: "watchdog_timeout",
        captured_frames: 30,
      }),
      stale: false,
    });

    const markup = render();

    expect(markup).toContain("WGC");
    // Backend omitted while mode is not hook (Req 8.3)
    expect(markup).not.toContain("DX11");
    // Fallback reason surfaced when non-`none` (Req 8.7)
    expect(markup).toContain("watchdog_timeout");
  });

  it("capture-unavailable: shows the explicit unavailable state and omits the backend (Req 8.2)", () => {
    setHook({
      data: makeSnapshot({
        capture_mode: "hook",
        capture_unavailable: true,
      }),
      stale: false,
    });

    const markup = render();

    expect(markup).toContain("Unavailable");
    // Backend is omitted in the unavailable state even though mode reads "hook".
    expect(markup).not.toContain("DX11");
  });

  it("pending negotiated params: shows a pending indicator instead of stale/zero (Req 9.5)", () => {
    setHook({
      data: makeSnapshot({
        negotiated_width: null,
        negotiated_height: null,
        negotiated_fps: null,
        // Force an active session even though no params negotiated yet.
        captured_frames: 0,
        dropped_frames: 0,
        fallback_reason: "none",
      }),
      stale: false,
    });

    const markup = render({ shareActive: true });

    expect(markup).toContain("negotiating");
    // No bogus resolution rendered while pending.
    expect(markup).not.toContain("1920");
  });

  it("stale state: shows the stale indicator while keeping the stats row (Req 8.10)", () => {
    setHook({ data: makeSnapshot(), stale: true });

    const markup = render();

    expect(markup).toContain("stale");
    // Still rendering the live stats alongside the stale flag.
    expect(markup).toContain("Hook");
  });

  it("off-desktop / non-Windows: renders just the connection state without errors (Req 8.9, 8.11, 13.3)", () => {
    // Off-desktop shape returned by useNativeShareStats (no native data).
    setHook({ data: null, stale: false, isDesktop: false });

    const markup = render({ connectionState: "connected", joined: true });

    // Falls back to the old "Stable" connection label, no stats row.
    expect(markup).toContain("Stable");
    expect(markup).not.toContain("fwd");
    expect(markup).not.toContain("nvenc");
  });

  it("in-shell, connected, no active share: shows only the connection state (Req 8.11)", () => {
    // Idle snapshot present but no capture activity -> not an active share.
    setHook({
      data: makeSnapshot({
        capture_unavailable: false,
        captured_frames: 0,
        dropped_frames: 0,
        negotiated_width: null,
        negotiated_height: null,
        negotiated_fps: null,
        fallback_reason: "none",
      }),
      stale: false,
    });

    const markup = render({ connectionState: "connected", joined: true });

    expect(markup).toContain("Stable");
    expect(markup).not.toContain("fwd");
  });

  it("connection-state passthrough when no native data (connecting / failed)", () => {
    setHook({ data: null, stale: false, isDesktop: true });

    expect(render({ connectionState: "connecting", joined: false })).toContain(
      "Connecting",
    );
    expect(render({ connectionState: "failed", joined: false })).toContain(
      "Failed",
    );
  });

  it("renders without throwing for every state in the matrix", () => {
    const states: Array<Partial<NativeShareStatsState>> = [
      { data: makeSnapshot(), stale: false, isDesktop: true }, // hook
      { data: makeSnapshot({ capture_mode: "wgc" }), stale: false }, // wgc
      { data: makeSnapshot({ capture_unavailable: true }), stale: false }, // unavailable
      {
        data: makeSnapshot({
          negotiated_width: null,
          negotiated_height: null,
          negotiated_fps: null,
        }),
        stale: false,
      }, // pending
      { data: makeSnapshot(), stale: true }, // stale
      { data: null, stale: false, isDesktop: false }, // off-desktop
    ];

    for (const state of states) {
      setHook(state);
      expect(() => render({ shareActive: true })).not.toThrow();
      expect(() => render({ emphasized: true, shareActive: true })).not.toThrow();
    }
  });
});

// ── Pure display helpers driving each panel state (no DOM) ──────────────────
//
// These pin the same hook/wgc/unavailable/pending state matrix at the helper
// level so the behavior is verified deterministically independent of the
// renderer.

describe("streamingStats display helpers — state matrix", () => {
  it("captureModeDisplay maps each mode (Req 8.2)", () => {
    expect(captureModeDisplay(makeSnapshot({ capture_mode: "hook" }))).toEqual({
      text: "Hook",
      tone: "hook",
    });
    expect(captureModeDisplay(makeSnapshot({ capture_mode: "wgc" }))).toEqual({
      text: "WGC",
      tone: "wgc",
    });
    expect(
      captureModeDisplay(makeSnapshot({ capture_unavailable: true })),
    ).toEqual({ text: "Unavailable", tone: "unavailable" });
    // capture_unavailable takes precedence over capture_mode.
    expect(
      captureModeDisplay(
        makeSnapshot({ capture_mode: "hook", capture_unavailable: true }),
      ).tone,
    ).toBe("unavailable");
  });

  it("graphicsBackendLabel shows the backend only for hook mode (Req 8.3)", () => {
    expect(graphicsBackendLabel(makeSnapshot({ capture_mode: "hook" }))).toBe(
      "DX11",
    );
    expect(
      graphicsBackendLabel(
        makeSnapshot({ capture_mode: "wgc", active_backend: "dx11" }),
      ),
    ).toBeNull();
    expect(
      graphicsBackendLabel(makeSnapshot({ capture_unavailable: true })),
    ).toBeNull();
    // "n/a" marker is never surfaced.
    expect(
      graphicsBackendLabel(
        makeSnapshot({ capture_mode: "hook", active_backend: "n/a" }),
      ),
    ).toBeNull();
  });

  it("usToMs converts microseconds to ms with one decimal (Req 8.6)", () => {
    expect(usToMs(3200)).toBe("3.2");
    expect(usToMs(1800)).toBe("1.8");
    expect(usToMs(0)).toBe("0.0");
    expect(usToMs(-5)).toBe("0.0");
    expect(usToMs(Number.NaN)).toBe("0.0");
  });

  it("formatResolution / formatNegotiatedFps yield null while pending (Req 9.2, 9.5)", () => {
    expect(formatResolution(1920, 1080)).toBe("1920\u00d71080");
    expect(formatResolution(null, 1080)).toBeNull();
    expect(formatResolution(1920, null)).toBeNull();
    expect(formatNegotiatedFps(60)).toBe("60");
    expect(formatNegotiatedFps(59.94)).toBe("59.94");
    expect(formatNegotiatedFps(null)).toBeNull();
  });

  it("connectionStateLabel reproduces the old 'Stable' label states (Req 8.9, 8.11, 13.3)", () => {
    expect(connectionStateLabel("connected", false)).toBe("Stable");
    expect(connectionStateLabel("new", true)).toBe("Stable"); // joined wins
    expect(connectionStateLabel("connecting", false)).toBe("Connecting");
    expect(connectionStateLabel("failed", false)).toBe("Failed");
  });

  it("hasLiveCaptureActivity distinguishes active vs idle sessions (Req 8.2 vs 8.11)", () => {
    expect(hasLiveCaptureActivity(null)).toBe(false);
    expect(
      hasLiveCaptureActivity(
        makeSnapshot({
          captured_frames: 0,
          dropped_frames: 0,
          negotiated_width: null,
          negotiated_height: null,
          negotiated_fps: null,
          fallback_reason: "none",
          capture_unavailable: false,
        }),
      ),
    ).toBe(false);
    expect(
      hasLiveCaptureActivity(makeSnapshot({ captured_frames: 5 })),
    ).toBe(true);
    expect(
      hasLiveCaptureActivity(makeSnapshot({ capture_unavailable: true })),
    ).toBe(true);
  });
});
