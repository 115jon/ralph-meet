// ============================================================================
// Native screen-share stats snapshot (frontend mirror of the Rust type)
//
// This interface mirrors `NativeShareStatsSnapshot` serialized by the desktop
// backend (`desktop/src-tauri/src/native_share.rs`) and returned by the
// `get_native_screen_share_stats` Tauri command. Field names and types match
// the serde-serialized JSON exactly so the renderer can read it without an
// extra mapping layer.
//
// Negotiated capture parameters use `number | null`: the backend maps its
// not-yet-negotiated sentinel (`0`) to `null`, so the UI can show a pending
// indicator rather than a stale/zero value (Req 9.4, 9.5).
// ============================================================================

/** Resolved capture policy for a session (Req 5.5). */
export type CapturePolicy = "hook-exclusive" | "wgc-enabled";

/** Active capture strategy for a session (Req 4.4, 8.2). */
export type CaptureMode = "hook" | "wgc";

/**
 * Serialized snapshot of the native screen-share pipeline stats.
 *
 * Mirrors `NativeShareStatsSnapshot` in `native_share.rs`. Every field is
 * sourced from `get_native_screen_share_stats`.
 */
export interface NativeShareStatsSnapshot {
  /** Active capture mode: `"hook"` (zero-copy) or `"wgc"` (fallback). */
  capture_mode: CaptureMode;
  /** Resolved policy for the session (Req 5.5). */
  capture_policy: CapturePolicy;
  /**
   * `true` when the policy is `hook-exclusive`, the source is a hook-eligible
   * window, and the hook is unavailable — capture is explicitly unavailable
   * and no WGC fallback is started (Req 5.3, 8.2).
   */
  capture_unavailable: boolean;
  /** `true` when a foreign graphics-hook was detected for the target (Req 3.4). */
  foreign_hook: boolean;
  /**
   * Active `Graphics_API_Backend` while the mode is `hook`
   * (`"dx11"` | `"dx12"` | `"vulkan"` | `"opengl"`), or the non-backend
   * marker `"n/a"` otherwise (Req 7.2, 14.2).
   */
  active_backend: string;
  /**
   * Active encoder backend resolved by `Encoder_Selection`
   * (`"nvenc"` | `"amf"` | `"quicksync"` | `"generic_hw"` | `"software"`).
   */
  encoder_backend: string;
  /** Fallback reason as a stable string (`"none"` while the hook is active). */
  fallback_reason: string;
  // ── Frame counters (reported unchanged from the backend) ───────────────
  /** Cumulative forwarded-frame count (frames handed to the encoder). */
  captured_frames: number;
  encoded_frames: number;
  encode_errors: number;
  samples_written: number;
  /** Cumulative dropped-frame count. */
  dropped_frames: number;
  // ── Per-frame timing in microseconds ───────────────────────────────────
  /** Most recent fused GPU capture-and-conversion duration, in microseconds. */
  last_fused_gpu_us: number;
  /** Most recent MFT `ProcessInput` submit duration, in microseconds. */
  last_encode_submit_us: number;
  /** Smoothed (EWMA) fused-GPU duration, in microseconds. */
  fused_gpu_us_avg: number;
  /** Smoothed (EWMA) encode-submit duration, in microseconds. */
  encode_submit_us_avg: number;
  // ── Negotiated capture parameters (Req 9.1, 9.4) ───────────────────────
  /** Negotiated capture width in px, or `null` while not yet negotiated. */
  negotiated_width: number | null;
  /** Negotiated capture height in px, or `null` while not yet negotiated. */
  negotiated_height: number | null;
  /** Negotiated frame rate in fps, or `null` while not yet negotiated. */
  negotiated_fps: number | null;
}
