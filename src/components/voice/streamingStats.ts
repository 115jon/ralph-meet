// Pure helpers for the Streaming_Stats_Panel (owned-game-capture-hook spec).
//
// This module holds OS-/React-independent logic so it can be unit- and
// property-tested in isolation, and imported by both the `useNativeShareStats`
// hook (src/hooks/) and the `StreamingStatsPanel` component (src/components/voice/).

/**
 * Compute a frames-per-second value from two forwarded-frame samples.
 *
 * fps = (forwarded delta) / (elapsed seconds), clamped to >= 0 (Req 8.5).
 *
 * Returns `0` when:
 *  - no time has elapsed or the clock appears to have gone backwards
 *    (`curAtMs <= prevAtMs`), or
 *  - the forwarded-frame counter did not advance or appears to have reset
 *    (`curForwarded <= prevForwarded`), or
 *  - any input is non-finite (NaN / ±Infinity).
 *
 * The result is always a finite, non-negative number (validated by Property 7).
 *
 * @param prevForwarded cumulative forwarded-frame count at the previous sample
 * @param prevAtMs      timestamp (ms) of the previous sample
 * @param curForwarded  cumulative forwarded-frame count at the current sample
 * @param curAtMs       timestamp (ms) of the current sample
 */
export function computeFps(
  prevForwarded: number,
  prevAtMs: number,
  curForwarded: number,
  curAtMs: number,
): number {
  // Guard against non-finite inputs (NaN, ±Infinity) up front so the result is
  // always a finite, non-negative number (Req 8.5).
  if (
    !Number.isFinite(prevForwarded) ||
    !Number.isFinite(prevAtMs) ||
    !Number.isFinite(curForwarded) ||
    !Number.isFinite(curAtMs)
  ) {
    return 0;
  }

  const elapsedSeconds = (curAtMs - prevAtMs) / 1000;
  // No time elapsed (or the clock went backwards): a rate cannot be computed.
  if (elapsedSeconds <= 0) {
    return 0;
  }

  const forwardedDelta = curForwarded - prevForwarded;
  // Counter did not advance (or appears to have reset/decreased): 0 fps.
  if (forwardedDelta <= 0) {
    return 0;
  }

  const fps = forwardedDelta / elapsedSeconds;
  // Final clamp: guarantee a strictly non-negative, finite value even if the
  // division overflowed to Infinity for extreme inputs.
  return Number.isFinite(fps) && fps > 0 ? fps : 0;
}

// ── Streaming_Stats_Panel display helpers (pure) ───────────────────────────
//
// These derive display strings / flags from a NativeShareStatsSnapshot so the
// StreamingStatsPanel stays a thin renderer and the formatting logic is
// unit-testable without React (task 11.3).

import type { NativeShareStatsSnapshot } from "@/types/native-share-stats";

/** Visual tone for the capture-mode badge. */
export type CaptureModeTone = "hook" | "wgc" | "unavailable";

/** A capture-mode label plus the tone the panel uses to color it (Req 8.2). */
export interface CaptureModeDisplay {
  text: string;
  tone: CaptureModeTone;
}

/**
 * Map a snapshot to its capture-mode label/tone (Req 8.2).
 *
 * `capture_unavailable` takes precedence (hook-exclusive window with the hook
 * unavailable — Req 5.3, 8.2); otherwise the active `capture_mode` decides.
 */
export function captureModeDisplay(
  data: NativeShareStatsSnapshot,
): CaptureModeDisplay {
  if (data.capture_unavailable) {
    return { text: "Unavailable", tone: "unavailable" };
  }
  if (data.capture_mode === "hook") {
    return { text: "Hook", tone: "hook" };
  }
  return { text: "WGC", tone: "wgc" };
}

/**
 * The Graphics_API_Backend label to show, or `null` when it must be omitted.
 *
 * Per Req 8.3 the backend is shown ONLY while the active capture mode is
 * `hook` (and capture is not in the explicit unavailable state). In every other
 * mode the value is omitted entirely — the backend marker (`"n/a"`) is never
 * surfaced.
 */
export function graphicsBackendLabel(
  data: NativeShareStatsSnapshot,
): string | null {
  if (data.capture_unavailable) return null;
  if (data.capture_mode !== "hook") return null;
  const backend = data.active_backend?.trim();
  if (!backend || backend.toLowerCase() === "n/a") return null;
  return backend.toUpperCase();
}

/**
 * Convert a microsecond timing value to a millisecond display string with one
 * decimal place (Req 8.6). Non-finite / non-positive inputs render as `"0.0"`.
 */
export function usToMs(us: number): string {
  if (!Number.isFinite(us) || us <= 0) return "0.0";
  return (us / 1000).toFixed(1);
}

/**
 * The negotiated resolution as `"{w}×{h}"`, or `null` while not yet negotiated
 * (either dimension `null`) so the panel can show a pending indicator
 * (Req 9.2, 9.5).
 */
export function formatResolution(
  width: number | null,
  height: number | null,
): string | null {
  if (width == null || height == null) return null;
  return `${width}×${height}`;
}

/**
 * The negotiated frame rate as a short string, or `null` while not yet
 * negotiated so the panel can show a pending indicator (Req 9.2, 9.5).
 * Fractional rates (e.g. 59.94) keep two decimals; integral rates are bare.
 */
export function formatNegotiatedFps(fps: number | null): string | null {
  if (fps == null || !Number.isFinite(fps)) return null;
  return Number.isInteger(fps) ? String(fps) : fps.toFixed(2);
}

/**
 * The connection-state label that the static "Stable" markup produced, kept
 * here so both the panel's no-native-data path and the headers stay in sync
 * (Req 8.9, 8.11, 13.3).
 *
 * Unifies the two prior inline ternaries: a `connected` connection or a
 * `joined` session reads as "Stable"; `connecting`/`new` read as connecting;
 * `failed` reads as "Failed"; anything else falls through to the raw state.
 */
export function connectionStateLabel(
  connectionState: string,
  joined: boolean,
): string {
  if (connectionState === "connected" || joined) return "Stable";
  if (connectionState === "connecting") return "Connecting";
  if (connectionState === "new") return "Connecting…";
  if (connectionState === "failed") return "Failed";
  return connectionState;
}

/**
 * Whether the snapshot reflects an active native share session worth showing
 * live stats for (Req 8.2 vs 8.11).
 *
 * The `get_native_screen_share_stats` command always returns a snapshot, so an
 * idle session and an active one are distinguished heuristically: capture being
 * explicitly unavailable, any forwarded/dropped frames, a negotiated parameter,
 * or a non-`none` fallback reason all indicate an active/attempting session.
 * Used as the default when the panel is not given an explicit `shareActive`.
 */
export function hasLiveCaptureActivity(
  data: NativeShareStatsSnapshot | null,
): boolean {
  if (!data) return false;
  return (
    data.capture_unavailable ||
    data.captured_frames > 0 ||
    data.dropped_frames > 0 ||
    data.negotiated_width != null ||
    data.negotiated_height != null ||
    data.negotiated_fps != null ||
    data.fallback_reason !== "none"
  );
}
