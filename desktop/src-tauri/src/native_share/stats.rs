//! Pipeline counters + the serializable `Capture_Status` snapshot the renderer
//! polls through `get_native_screen_share_stats`.

use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, AtomicU8, Ordering};

use crate::game_capture::{CaptureMode, FallbackReason, GraphicsApiBackend};
use crate::wmf_encoder::EncoderBackend;

// ── Shared stats ───────────────────────────────────────────────────────────

#[derive(Default)]
pub struct NativeShareStats {
    pub captured_frames: AtomicU64,
    pub encoded_frames: AtomicU64,
    pub encode_errors: AtomicU64,
    pub samples_written: AtomicU64,
    pub audio_samples_written: AtomicU64,
    pub write_errors: AtomicU64,
    pub dropped_frames: AtomicU64,
    /// WGC frames skipped by the pacer because they arrived faster than the
    /// share's frame rate. Not losses: the share asked for fewer frames.
    pub paced_frames: AtomicU64,

    // ── Per-frame timing (Req 9.1, 9.2) ──────────────────────────────────
    // Stored as nanoseconds. Written by the encoder worker (task 3.1) on each
    // processed frame; the serializable snapshot + `capture_mode` reporting are
    // layered on top in task 5.1. Added additively so existing counters above
    // are untouched.
    /// Most recent fused GPU capture-and-conversion (VideoProcessorBlt +
    /// scoped completion query) duration, in nanoseconds.
    pub last_fused_gpu_ns: AtomicU64,
    /// Most recent MFT `ProcessInput` submit duration, in nanoseconds.
    pub last_encode_submit_ns: AtomicU64,
    /// Exponentially-weighted moving average (alpha = 1/8) of the fused-GPU
    /// duration, in nanoseconds — a stable value for UI display.
    pub fused_gpu_ns_ewma: AtomicU64,
    /// EWMA (alpha = 1/8) of the encode-submit duration, in nanoseconds.
    pub encode_submit_ns_ewma: AtomicU64,
    /// Raw (un-smoothed) maximum fused-GPU duration observed since the last
    /// stats-log flush, in nanoseconds. Unlike [`fused_gpu_ns_ewma`] this is NOT
    /// smoothed, so a single transient VP-blit spike (the kind that correlates
    /// with a game stutter) is preserved instead of being averaged away. The
    /// hook-stats logger reads and resets it each interval via
    /// [`NativeShareStats::take_fused_gpu_ns_window_max`] (Req 9.1 diagnostics).
    pub fused_gpu_ns_window_max: AtomicU64,

    // ── Active capture mode (Req 6.5, 7.3, 9.4) ──────────────────────────
    /// The active `Capture_Mode` for the current session, encoded as a small
    /// integer so it can live in an atomic alongside the counters:
    /// `0 = wgc` (the guaranteed fallback), `1 = hook` (zero-copy DX11 hook).
    /// Mirrors [`CaptureMode`]; mapped back to its string form in the snapshot.
    /// Defaults to `0` (`wgc`) so a session that never selects the hook reports
    /// the fallback mode, matching the orchestration default.
    pub capture_mode: AtomicU8,

    // ── Active graphics-API backend (Req 7.2, 14.2) ──────────────────────
    /// The active `Graphics_API_Backend` for the current session, encoded as a
    /// small integer so it can live in an atomic alongside the counters.
    /// Mirrors [`GraphicsApiBackend`] via [`active_backend_to_u8`], with a
    /// dedicated [`ACTIVE_BACKEND_NA`] sentinel for "no backend" — the value
    /// reported whenever the active `Capture_Mode` is `wgc` (a backend only
    /// has meaning while the zero-copy `hook` is active, Req 14.2). Defaults to
    /// the `n/a` sentinel so a session that never attaches the hook reports no
    /// backend.
    pub active_backend: AtomicU8,

    // ── Active encoder backend (Req 6.5, 14.3) ───────────────────────────
    /// The active `Hardware_Encoder_Backend` / `Software_Encoder` resolved by
    /// `Encoder_Selection` for the current session, encoded as a small integer.
    /// Mirrors [`EncoderBackend`] via [`encoder_backend_to_u8`]. Defaults to
    /// `0` ([`EncoderBackend::Software`]) — the guaranteed last-resort encoder
    /// (Req 6.3) — so a session reports a valid encoder backend even before
    /// `Encoder_Selection` resolves one.
    pub encoder_backend: AtomicU8,

    // ── Fallback reason (Req 8.5, 14.4) ──────────────────────────────────
    /// Why the session fell back from an intended `hook` to `wgc`, encoded as a
    /// small integer mirroring [`FallbackReason`] via [`fallback_reason_to_u8`].
    /// Defaults to `0` ([`FallbackReason::None`]); the orchestration overrides
    /// it via [`NativeShareStats::set_fallback_reason`] once selection resolves.
    /// `None` is the reported value while the hook is the active mode.
    pub fallback_reason: AtomicU8,

    // ── Resolved capture policy (Req 5.5, 8.2) ───────────────────────────
    /// The `Capture_Policy` resolved for the current session, encoded as a
    /// small integer so it can live in an atomic alongside the counters:
    /// `0 = wgc-enabled` (WGC is available as a fallback), `1 = hook-exclusive`
    /// (the hook is the only path). Mapped back to its stable string
    /// (`"wgc-enabled"` | `"hook-exclusive"`) in the snapshot. Defaults to `0`
    /// (`wgc-enabled`) so a session that never resolves a policy reports the
    /// prior-behavior default (Req 5.1).
    pub capture_policy: AtomicU8,

    /// Set while the resolved policy is `hook-exclusive`, the source is a
    /// hook-eligible window, and the hook is unavailable/failed so no capture
    /// runs (no WGC fallback, Req 5.3, 8.2). Reported as a bool flag in the
    /// snapshot; defaults to `false`.
    pub capture_unavailable: AtomicBool,

    /// Set when a `Foreign_Hook` (a graphics-hook installed by a different host,
    /// e.g. stock OBS) is detected for the target before installing our own
    /// present interception (Req 3.4). Reported as a bool flag in the snapshot;
    /// defaults to `false`.
    pub foreign_hook: AtomicBool,

    // ── Negotiated capture parameters (Req 9.1, 9.4) ─────────────────────
    /// Negotiated capture width in pixels for the session. `0` is the explicit
    /// not-yet-negotiated sentinel, mapped to `None` in the snapshot so the UI
    /// shows a pending indicator rather than a stale/zero value (Req 9.4).
    pub negotiated_width: AtomicU32,

    /// Negotiated capture height in pixels for the session. `0` is the explicit
    /// not-yet-negotiated sentinel, mapped to `None` in the snapshot (Req 9.4).
    pub negotiated_height: AtomicU32,

    /// Negotiated capture frame rate, stored as **milli-fps** (fps × 1000) so a
    /// fractional rate (e.g. 59.94) survives an integer atomic; divided back to
    /// `f64` in the snapshot. `0` is the explicit not-yet-negotiated sentinel,
    /// mapped to `None` in the snapshot (Req 9.1, 9.4).
    pub negotiated_fps_milli: AtomicU32,
}

impl NativeShareStats {
    /// EWMA smoothing factor denominator (alpha = 1/8). A larger denominator
    /// yields a smoother, slower-moving average.
    const EWMA_SHIFT: u32 = 3;

    /// Record the most recent fused-GPU operation duration (the
    /// `VideoProcessorBlt` + scoped completion query) and fold it into the
    /// EWMA. Called once per processed frame by the encoder worker (Req 9.1).
    pub fn record_fused_gpu_ns(&self, ns: u64) {
        self.last_fused_gpu_ns.store(ns, Ordering::Relaxed);
        Self::update_ewma(&self.fused_gpu_ns_ewma, ns);
        // Track the un-smoothed peak so a single VP-blit spike survives to the
        // next stats-log flush (the EWMA would otherwise average it away).
        self.fused_gpu_ns_window_max
            .fetch_max(ns, Ordering::Relaxed);
    }

    /// Atomically read and reset the raw windowed-max fused-GPU duration (ns).
    /// Called by the hook-stats logger once per interval so each logged
    /// `gpu_max_us` reflects the worst single frame *in that interval only*,
    /// not the all-time peak.
    pub fn take_fused_gpu_ns_window_max(&self) -> u64 {
        self.fused_gpu_ns_window_max.swap(0, Ordering::Relaxed)
    }

    /// Record the most recent MFT `ProcessInput` submit duration and fold it
    /// into the EWMA. Called once per processed frame (Req 9.2).
    pub fn record_encode_submit_ns(&self, ns: u64) {
        self.last_encode_submit_ns.store(ns, Ordering::Relaxed);
        Self::update_ewma(&self.encode_submit_ns_ewma, ns);
    }

    /// Fold `sample` into an EWMA stored in `slot`:
    /// `ewma += (sample - ewma) / 2^EWMA_SHIFT`. A zero EWMA seeds directly to
    /// the first sample so the average converges immediately on session start.
    fn update_ewma(slot: &AtomicU64, sample: u64) {
        let prev = slot.load(Ordering::Relaxed);
        let next = if prev == 0 {
            sample
        } else if sample >= prev {
            prev + ((sample - prev) >> Self::EWMA_SHIFT)
        } else {
            prev - ((prev - sample) >> Self::EWMA_SHIFT)
        };
        slot.store(next, Ordering::Relaxed);
    }

    /// Record the active `Capture_Mode` for the session (Req 6.5, 7.3, 9.4).
    /// Stored as the `CaptureMode` discriminant so the value round-trips back
    /// to the same string in the snapshot.
    pub fn set_capture_mode(&self, mode: CaptureMode) {
        self.capture_mode
            .store(capture_mode_to_u8(mode), Ordering::Relaxed);
    }

    /// Record the active `Graphics_API_Backend` for the session (Req 7.2,
    /// 14.2). Pass `Some(backend)` while the zero-copy `hook` is the active
    /// Capture_Mode, or `None` to report the non-backend `n/a` sentinel (the
    /// value used on the WGC fallback path, where no backend is meaningful).
    /// Stored as the discriminant so it round-trips to the same string in the
    /// snapshot.
    pub fn set_active_backend(&self, backend: Option<GraphicsApiBackend>) {
        self.active_backend
            .store(active_backend_to_u8(backend), Ordering::Relaxed);
    }

    /// Record the **truthful** active backend from the DLL's reported
    /// `hooked_api` (which present interception actually installed), using the
    /// host's module-detected `detected` backend only to distinguish DX11 vs
    /// DX12 within DXGI. This overrides a wrong module guess (e.g. a Vulkan game
    /// that also loads d3d11.dll) so `Capture_Status` shows the real API.
    #[cfg(all(feature = "game-capture-hook", windows))]
    pub fn set_active_backend_hooked(
        &self,
        hooked: crate::game_capture::obs_ipc::HookedApi,
        detected: GraphicsApiBackend,
    ) {
        self.active_backend.store(
            active_backend_u8_from_hooked(hooked, detected),
            Ordering::Relaxed,
        );
    }

    /// Record the active `Hardware_Encoder_Backend` / `Software_Encoder`
    /// resolved by `Encoder_Selection` for the session (Req 6.5, 14.3). Stored
    /// as the [`EncoderBackend`] discriminant so it round-trips to the same
    /// string in the snapshot.
    pub fn set_encoder_backend(&self, backend: EncoderBackend) {
        self.encoder_backend
            .store(encoder_backend_to_u8(backend), Ordering::Relaxed);
    }

    /// Record the reason the session fell back from an intended `hook` to `wgc`
    /// (Req 8.5, 14.4). Pass [`FallbackReason::None`] while the hook is the
    /// active mode. Stored as the [`FallbackReason`] discriminant so it
    /// round-trips to the same string in the snapshot.
    pub fn set_fallback_reason(&self, reason: FallbackReason) {
        self.fallback_reason
            .store(fallback_reason_to_u8(reason), Ordering::Relaxed);
    }

    /// Record the resolved `Capture_Policy` for the session (Req 5.5). Pass
    /// `true` for `hook-exclusive` (the hook is the only path) or `false` for
    /// `wgc-enabled` (WGC is available as a fallback). Stored as a small
    /// discriminant so it round-trips to the same stable string in the
    /// snapshot.
    pub fn set_capture_policy(&self, hook_exclusive: bool) {
        self.capture_policy.store(
            if hook_exclusive {
                CAPTURE_POLICY_HOOK_EXCLUSIVE
            } else {
                CAPTURE_POLICY_WGC_ENABLED
            },
            Ordering::Relaxed,
        );
    }

    /// Record whether capture is unavailable for the session — set while the
    /// policy is `hook-exclusive`, the source is a hook-eligible window, and the
    /// hook is unavailable/failed so no frames are delivered (Req 5.3, 8.2).
    pub fn set_capture_unavailable(&self, unavailable: bool) {
        self.capture_unavailable
            .store(unavailable, Ordering::Relaxed);
    }

    /// Record whether a `Foreign_Hook` (e.g. a stock OBS graphics-hook) was
    /// detected for the target before installing our own interception
    /// (Req 3.4).
    pub fn set_foreign_hook(&self, present: bool) {
        self.foreign_hook.store(present, Ordering::Relaxed);
    }

    /// Record the negotiated capture parameters for the session (Req 9.1, 9.3).
    /// `fps` is stored as milli-fps (fps × 1000) so a fractional rate survives
    /// the integer atomic; a value of `0` width/height/fps is the explicit
    /// not-yet-negotiated sentinel and is reported as `None` in the snapshot
    /// (Req 9.4). Negative or non-finite `fps` is clamped to the
    /// not-yet-negotiated sentinel.
    pub fn set_negotiated_params(&self, width: u32, height: u32, fps: f64) {
        self.negotiated_width.store(width, Ordering::Relaxed);
        self.negotiated_height.store(height, Ordering::Relaxed);
        let fps_milli = if fps.is_finite() && fps > 0.0 {
            (fps * 1_000.0).round() as u32
        } else {
            0
        };
        self.negotiated_fps_milli
            .store(fps_milli, Ordering::Relaxed);
    }

    /// Reset the negotiated capture parameters to the explicit
    /// not-yet-negotiated state (Req 9.4) — reported as `None` in the snapshot.
    pub fn clear_negotiated_params(&self) {
        self.negotiated_width.store(0, Ordering::Relaxed);
        self.negotiated_height.store(0, Ordering::Relaxed);
        self.negotiated_fps_milli.store(0, Ordering::Relaxed);
    }

    /// Build a serializable [`NativeShareStatsSnapshot`] from the live atomics
    /// (Req 9.3, 9.4, 9.5). Every existing counter is mapped through unchanged;
    /// the per-frame timing values are converted from the stored nanoseconds to
    /// microseconds for UI readability; the capture mode is reported as its
    /// stable string form (`"wgc"` | `"hook"`).
    pub fn snapshot(&self) -> NativeShareStatsSnapshot {
        NativeShareStatsSnapshot {
            capture_mode: capture_mode_from_u8(self.capture_mode.load(Ordering::Relaxed))
                .as_str()
                .to_string(),
            // Active backend (Req 14.2): the backend string while the hook is
            // active, else the non-backend `n/a` marker.
            active_backend: active_backend_from_u8(self.active_backend.load(Ordering::Relaxed)),
            // Active encoder backend (Req 6.5, 14.3).
            encoder_backend: encoder_backend_from_u8(self.encoder_backend.load(Ordering::Relaxed))
                .as_str()
                .to_string(),
            // Fallback reason (Req 8.5, 14.4).
            fallback_reason: fallback_reason_from_u8(self.fallback_reason.load(Ordering::Relaxed))
                .as_str()
                .to_string(),
            // Resolved capture policy (Req 5.5).
            capture_policy: capture_policy_from_u8(self.capture_policy.load(Ordering::Relaxed))
                .to_string(),
            // Capture-unavailable flag (Req 5.3, 8.2) and foreign-hook
            // condition (Req 3.4) — reported as-is.
            capture_unavailable: self.capture_unavailable.load(Ordering::Relaxed),
            foreign_hook: self.foreign_hook.load(Ordering::Relaxed),
            // Negotiated capture parameters (Req 9.1, 9.4): a `0` sentinel maps
            // to `None`/not-yet-negotiated; milli-fps is divided back to `f64`.
            negotiated_width: sentinel_u32_to_option(self.negotiated_width.load(Ordering::Relaxed)),
            negotiated_height: sentinel_u32_to_option(
                self.negotiated_height.load(Ordering::Relaxed),
            ),
            negotiated_fps: match self.negotiated_fps_milli.load(Ordering::Relaxed) {
                0 => None,
                milli => Some(f64::from(milli) / 1_000.0),
            },
            // Existing counters — mapped unchanged (Req 9.5).
            captured_frames: self.captured_frames.load(Ordering::Relaxed),
            encoded_frames: self.encoded_frames.load(Ordering::Relaxed),
            encode_errors: self.encode_errors.load(Ordering::Relaxed),
            samples_written: self.samples_written.load(Ordering::Relaxed),
            dropped_frames: self.dropped_frames.load(Ordering::Relaxed),
            // Per-frame timing — nanoseconds → microseconds (Req 9.1, 9.2).
            last_fused_gpu_us: self.last_fused_gpu_ns.load(Ordering::Relaxed) / 1_000,
            last_encode_submit_us: self.last_encode_submit_ns.load(Ordering::Relaxed) / 1_000,
            fused_gpu_us_avg: self.fused_gpu_ns_ewma.load(Ordering::Relaxed) / 1_000,
            encode_submit_us_avg: self.encode_submit_ns_ewma.load(Ordering::Relaxed) / 1_000,
        }
    }
}

/// Discriminant for `CaptureMode::Wgc` stored in [`NativeShareStats::capture_mode`].
const CAPTURE_MODE_WGC: u8 = 0;
/// Discriminant for `CaptureMode::Hook` stored in [`NativeShareStats::capture_mode`].
const CAPTURE_MODE_HOOK: u8 = 1;

/// Map a [`CaptureMode`] to the `u8` discriminant kept in the atomic.
fn capture_mode_to_u8(mode: CaptureMode) -> u8 {
    match mode {
        CaptureMode::Wgc => CAPTURE_MODE_WGC,
        CaptureMode::Hook => CAPTURE_MODE_HOOK,
    }
}

/// Map a stored `u8` discriminant back to a [`CaptureMode`]. Any unknown value
/// (only `0`/`1` are ever written) defaults to the `wgc` fallback so the
/// reported mode is always valid.
fn capture_mode_from_u8(value: u8) -> CaptureMode {
    match value {
        CAPTURE_MODE_HOOK => CaptureMode::Hook,
        _ => CaptureMode::Wgc,
    }
}

// ── Active graphics-API backend mapping (Req 7.2, 14.2) ─────────────────────

/// Sentinel stored in [`NativeShareStats::active_backend`] meaning "no active
/// backend". Reported as the `"n/a"` string in the snapshot. This is the value
/// while the active `Capture_Mode` is `wgc`, where no `Graphics_API_Backend` is
/// meaningful (a backend only applies to the zero-copy `hook` path, Req 14.2).
const ACTIVE_BACKEND_NA: u8 = 0;
/// Discriminant for [`GraphicsApiBackend::Dx11`].
const ACTIVE_BACKEND_DX11: u8 = 1;
/// Discriminant for [`GraphicsApiBackend::Dx12`].
const ACTIVE_BACKEND_DX12: u8 = 2;
/// Discriminant for [`GraphicsApiBackend::Vulkan`].
const ACTIVE_BACKEND_VULKAN: u8 = 3;
/// Discriminant for [`GraphicsApiBackend::OpenGl`].
const ACTIVE_BACKEND_OPENGL: u8 = 4;
/// Discriminant for a DLL-reported Direct3D 9 hook (truthful `hooked_api`).
const ACTIVE_BACKEND_D3D9: u8 = 5;
/// Discriminant for a DLL-reported Direct3D 8 hook (truthful `hooked_api`).
const ACTIVE_BACKEND_D3D8: u8 = 6;

/// The non-backend marker string reported when no backend is active (Req 14.2).
const ACTIVE_BACKEND_NA_STR: &str = "n/a";

/// Map an optional [`GraphicsApiBackend`] to the `u8` discriminant kept in the
/// atomic. `None` (the WGC fallback path) maps to the [`ACTIVE_BACKEND_NA`]
/// sentinel so the snapshot reports the non-backend `"n/a"` marker.
fn active_backend_to_u8(backend: Option<GraphicsApiBackend>) -> u8 {
    match backend {
        None => ACTIVE_BACKEND_NA,
        Some(GraphicsApiBackend::Dx11) => ACTIVE_BACKEND_DX11,
        Some(GraphicsApiBackend::Dx12) => ACTIVE_BACKEND_DX12,
        Some(GraphicsApiBackend::Vulkan) => ACTIVE_BACKEND_VULKAN,
        Some(GraphicsApiBackend::OpenGl) => ACTIVE_BACKEND_OPENGL,
    }
}

/// Map the DLL's truthful [`HookedApi`] to the active-backend discriminant,
/// using the host's finer module-based `detected` backend to distinguish DX11
/// vs DX12 (the DLL's present hook can only report "DXGI" for both, since
/// D3D10/11/12 all present through the DXGI swapchain). Vulkan / D3D9 / D3D8 /
/// OpenGL are reported exactly as the DLL hooked them — overriding any wrong
/// module guess. [`HookedApi::None`] keeps the prior `detected` value (the hook
/// has not reported yet).
#[cfg(all(feature = "game-capture-hook", windows))]
fn active_backend_u8_from_hooked(
    hooked: crate::game_capture::obs_ipc::HookedApi,
    detected: GraphicsApiBackend,
) -> u8 {
    use crate::game_capture::obs_ipc::HookedApi;
    match hooked {
        HookedApi::None => active_backend_to_u8(Some(detected)),
        // DXGI covers D3D10/11/12 — keep the finer host detection if it already
        // says DX12, else report DX11 (the common case).
        HookedApi::Dxgi => {
            if detected == GraphicsApiBackend::Dx12 {
                ACTIVE_BACKEND_DX12
            } else {
                ACTIVE_BACKEND_DX11
            }
        }
        HookedApi::Vulkan => ACTIVE_BACKEND_VULKAN,
        HookedApi::OpenGl => ACTIVE_BACKEND_OPENGL,
        HookedApi::D3d9 => ACTIVE_BACKEND_D3D9,
        HookedApi::D3d8 => ACTIVE_BACKEND_D3D8,
    }
}

/// Map a stored `u8` discriminant back to the active-backend string. The
/// [`ACTIVE_BACKEND_NA`] sentinel and any unknown value report the non-backend
/// `"n/a"` marker; a known backend reports its stable string form (Req 14.2).
fn active_backend_from_u8(value: u8) -> String {
    match value {
        ACTIVE_BACKEND_DX11 => GraphicsApiBackend::Dx11.as_str().to_string(),
        ACTIVE_BACKEND_DX12 => GraphicsApiBackend::Dx12.as_str().to_string(),
        ACTIVE_BACKEND_VULKAN => GraphicsApiBackend::Vulkan.as_str().to_string(),
        ACTIVE_BACKEND_OPENGL => GraphicsApiBackend::OpenGl.as_str().to_string(),
        ACTIVE_BACKEND_D3D9 => "d3d9".to_string(),
        ACTIVE_BACKEND_D3D8 => "d3d8".to_string(),
        _ => ACTIVE_BACKEND_NA_STR.to_string(),
    }
}

// ── Encoder backend mapping (Req 6.5, 14.3) ─────────────────────────────────

/// Discriminant for [`EncoderBackend::Software`] — also the default, so a
/// never-resolved session reports the guaranteed last-resort encoder (Req 6.3).
const ENCODER_BACKEND_SOFTWARE: u8 = 0;
/// Discriminant for [`EncoderBackend::Nvenc`].
const ENCODER_BACKEND_NVENC: u8 = 1;
/// Discriminant for [`EncoderBackend::Amf`].
const ENCODER_BACKEND_AMF: u8 = 2;
/// Discriminant for [`EncoderBackend::QuickSync`].
const ENCODER_BACKEND_QUICKSYNC: u8 = 3;
/// Discriminant for [`EncoderBackend::GenericHwMft`].
const ENCODER_BACKEND_GENERIC_HW: u8 = 4;

/// Map an [`EncoderBackend`] to the `u8` discriminant kept in the atomic.
fn encoder_backend_to_u8(backend: EncoderBackend) -> u8 {
    match backend {
        EncoderBackend::Software => ENCODER_BACKEND_SOFTWARE,
        EncoderBackend::Nvenc => ENCODER_BACKEND_NVENC,
        EncoderBackend::Amf => ENCODER_BACKEND_AMF,
        EncoderBackend::QuickSync => ENCODER_BACKEND_QUICKSYNC,
        EncoderBackend::GenericHwMft => ENCODER_BACKEND_GENERIC_HW,
    }
}

/// Map a stored `u8` discriminant back to an [`EncoderBackend`]. Any unknown
/// value defaults to [`EncoderBackend::Software`] so the reported encoder is
/// always a valid backend (Req 6.3).
fn encoder_backend_from_u8(value: u8) -> EncoderBackend {
    match value {
        ENCODER_BACKEND_NVENC => EncoderBackend::Nvenc,
        ENCODER_BACKEND_AMF => EncoderBackend::Amf,
        ENCODER_BACKEND_QUICKSYNC => EncoderBackend::QuickSync,
        ENCODER_BACKEND_GENERIC_HW => EncoderBackend::GenericHwMft,
        _ => EncoderBackend::Software,
    }
}

// ── Fallback-reason mapping (Req 8.5, 14.4) ─────────────────────────────────

/// Discriminant for [`FallbackReason::None`] — the default while the hook is
/// the active mode.
const FALLBACK_REASON_NONE: u8 = 0;
const FALLBACK_REASON_NOT_WINDOWS: u8 = 1;
const FALLBACK_REASON_MONITOR_SOURCE: u8 = 2;
const FALLBACK_REASON_BACKEND_DISABLED: u8 = 3;
const FALLBACK_REASON_HOOK_DISABLED: u8 = 4;
const FALLBACK_REASON_MISSING_ARTIFACT: u8 = 5;
const FALLBACK_REASON_BLOCKLISTED: u8 = 6;
const FALLBACK_REASON_NOT_ALLOWLISTED: u8 = 7;
const FALLBACK_REASON_INJECTION_DENIED: u8 = 8;
const FALLBACK_REASON_INJECTION_FAILED: u8 = 9;
const FALLBACK_REASON_CROSS_ADAPTER: u8 = 10;
const FALLBACK_REASON_INTEROP_FAILED: u8 = 11;
const FALLBACK_REASON_TARGET_EXITED: u8 = 12;
const FALLBACK_REASON_HOOK_STOPPED_MID_SESSION: u8 = 13;
const FALLBACK_REASON_HOOK_NO_FIRST_FRAME: u8 = 14;

/// Map a [`FallbackReason`] to the `u8` discriminant kept in the atomic.
fn fallback_reason_to_u8(reason: FallbackReason) -> u8 {
    match reason {
        FallbackReason::None => FALLBACK_REASON_NONE,
        FallbackReason::NotWindows => FALLBACK_REASON_NOT_WINDOWS,
        FallbackReason::MonitorSource => FALLBACK_REASON_MONITOR_SOURCE,
        FallbackReason::BackendDisabled => FALLBACK_REASON_BACKEND_DISABLED,
        FallbackReason::HookDisabled => FALLBACK_REASON_HOOK_DISABLED,
        FallbackReason::MissingArtifact => FALLBACK_REASON_MISSING_ARTIFACT,
        FallbackReason::Blocklisted => FALLBACK_REASON_BLOCKLISTED,
        FallbackReason::NotAllowlisted => FALLBACK_REASON_NOT_ALLOWLISTED,
        FallbackReason::InjectionDenied => FALLBACK_REASON_INJECTION_DENIED,
        FallbackReason::InjectionFailed => FALLBACK_REASON_INJECTION_FAILED,
        FallbackReason::CrossAdapter => FALLBACK_REASON_CROSS_ADAPTER,
        FallbackReason::InteropFailed => FALLBACK_REASON_INTEROP_FAILED,
        FallbackReason::TargetExited => FALLBACK_REASON_TARGET_EXITED,
        FallbackReason::HookStoppedMidSession => FALLBACK_REASON_HOOK_STOPPED_MID_SESSION,
        FallbackReason::HookNoFirstFrame => FALLBACK_REASON_HOOK_NO_FIRST_FRAME,
    }
}

/// Map a stored `u8` discriminant back to a [`FallbackReason`]. Any unknown
/// value defaults to [`FallbackReason::None`] so the reported reason is always
/// valid.
fn fallback_reason_from_u8(value: u8) -> FallbackReason {
    match value {
        FALLBACK_REASON_NOT_WINDOWS => FallbackReason::NotWindows,
        FALLBACK_REASON_MONITOR_SOURCE => FallbackReason::MonitorSource,
        FALLBACK_REASON_BACKEND_DISABLED => FallbackReason::BackendDisabled,
        FALLBACK_REASON_HOOK_DISABLED => FallbackReason::HookDisabled,
        FALLBACK_REASON_MISSING_ARTIFACT => FallbackReason::MissingArtifact,
        FALLBACK_REASON_BLOCKLISTED => FallbackReason::Blocklisted,
        FALLBACK_REASON_NOT_ALLOWLISTED => FallbackReason::NotAllowlisted,
        FALLBACK_REASON_INJECTION_DENIED => FallbackReason::InjectionDenied,
        FALLBACK_REASON_INJECTION_FAILED => FallbackReason::InjectionFailed,
        FALLBACK_REASON_CROSS_ADAPTER => FallbackReason::CrossAdapter,
        FALLBACK_REASON_INTEROP_FAILED => FallbackReason::InteropFailed,
        FALLBACK_REASON_TARGET_EXITED => FallbackReason::TargetExited,
        FALLBACK_REASON_HOOK_STOPPED_MID_SESSION => FallbackReason::HookStoppedMidSession,
        FALLBACK_REASON_HOOK_NO_FIRST_FRAME => FallbackReason::HookNoFirstFrame,
        _ => FallbackReason::None,
    }
}

// ── Capture-policy mapping (Req 5.5) ────────────────────────────────────────

/// Discriminant for `wgc-enabled` stored in [`NativeShareStats::capture_policy`]
/// — also the default, so a session that never resolves a policy reports the
/// prior-behavior default (Req 5.1).
const CAPTURE_POLICY_WGC_ENABLED: u8 = 0;
/// Discriminant for `hook-exclusive` stored in
/// [`NativeShareStats::capture_policy`].
const CAPTURE_POLICY_HOOK_EXCLUSIVE: u8 = 1;

/// The stable `wgc-enabled` policy string reported in the snapshot.
const CAPTURE_POLICY_WGC_ENABLED_STR: &str = "wgc-enabled";
/// The stable `hook-exclusive` policy string reported in the snapshot.
const CAPTURE_POLICY_HOOK_EXCLUSIVE_STR: &str = "hook-exclusive";

/// Map a stored `u8` discriminant back to the stable `Capture_Policy` string.
/// Any unknown value (only `0`/`1` are ever written) defaults to `wgc-enabled`
/// so the reported policy is always valid (Req 5.1, 5.5).
fn capture_policy_from_u8(value: u8) -> &'static str {
    match value {
        CAPTURE_POLICY_HOOK_EXCLUSIVE => CAPTURE_POLICY_HOOK_EXCLUSIVE_STR,
        _ => CAPTURE_POLICY_WGC_ENABLED_STR,
    }
}

/// Map a negotiated-parameter atomic value to its snapshot `Option`: the `0`
/// not-yet-negotiated sentinel becomes `None`, any other value becomes
/// `Some(value)` (Req 9.4).
fn sentinel_u32_to_option(value: u32) -> Option<u32> {
    match value {
        0 => None,
        v => Some(v),
    }
}

/// Serializable snapshot of [`NativeShareStats`] returned by the stats Tauri
/// command (Req 9.3, 9.4, 9.5). Counters are reported as-is; per-frame timing
/// is expressed in **microseconds** for UI readability, and the capture mode is
/// the stable string form of the active [`CaptureMode`].
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct NativeShareStatsSnapshot {
    /// Active capture mode: `"wgc"` (fallback) or `"hook"` (zero-copy DX11).
    pub capture_mode: String,
    /// Active `Graphics_API_Backend` while the hook is the active mode
    /// (`"dx11"`/`"dx12"`/`"vulkan"`/`"opengl"`), or the non-backend marker
    /// `"n/a"` on the WGC fallback path (Req 7.2, 14.2).
    pub active_backend: String,
    /// Active encoder backend resolved by `Encoder_Selection`:
    /// `"nvenc"`/`"amf"`/`"quicksync"`/`"generic_hw"`/`"software"`
    /// (Req 6.5, 14.3).
    pub encoder_backend: String,
    /// Why the session fell back from an intended `hook` to `wgc`, as the
    /// stable [`FallbackReason`] string (`"none"` while the hook is active)
    /// (Req 8.5, 14.4).
    pub fallback_reason: String,
    /// The resolved `Capture_Policy` for the session: `"wgc-enabled"` (WGC is
    /// available as a fallback) or `"hook-exclusive"` (the hook is the only
    /// path) (Req 5.5).
    pub capture_policy: String,
    /// `true` while the policy is `hook-exclusive`, the source is a
    /// hook-eligible window, and the hook is unavailable/failed so no capture
    /// runs (no WGC fallback) (Req 5.3, 8.2).
    pub capture_unavailable: bool,
    /// `true` when a `Foreign_Hook` (e.g. a stock OBS graphics-hook) was
    /// detected for the target (Req 3.4).
    pub foreign_hook: bool,
    // ── Existing counters (Req 9.5 — reported unchanged) ─────────────────
    pub captured_frames: u64,
    pub encoded_frames: u64,
    pub encode_errors: u64,
    pub samples_written: u64,
    pub dropped_frames: u64,
    // ── Per-frame timing in microseconds (Req 9.1, 9.2, 9.4) ─────────────
    /// Most recent fused GPU capture-and-conversion duration, in microseconds.
    pub last_fused_gpu_us: u64,
    /// Most recent MFT `ProcessInput` submit duration, in microseconds.
    pub last_encode_submit_us: u64,
    /// Smoothed (EWMA) fused-GPU duration, in microseconds.
    pub fused_gpu_us_avg: u64,
    /// Smoothed (EWMA) encode-submit duration, in microseconds.
    pub encode_submit_us_avg: u64,
    // ── Negotiated capture parameters (Req 9.1, 9.4) ─────────────────────
    /// Negotiated capture width in pixels, or `None` while not yet negotiated
    /// (the `0` sentinel) so the UI shows a pending indicator (Req 9.4).
    pub negotiated_width: Option<u32>,
    /// Negotiated capture height in pixels, or `None` while not yet negotiated
    /// (the `0` sentinel) (Req 9.4).
    pub negotiated_height: Option<u32>,
    /// Negotiated capture frame rate in frames per second (carried internally
    /// as milli-fps and divided back to `f64`), or `None` while not yet
    /// negotiated (Req 9.1, 9.4).
    pub negotiated_fps: Option<f64>,
}

/// Reset every counter, timing value, and status flag to its session-start
/// default so a prior session's status never leaks into the next one.
pub(crate) fn reset_native_share_stats(stats: &NativeShareStats) {
    stats.captured_frames.store(0, Ordering::Relaxed);
    stats.encoded_frames.store(0, Ordering::Relaxed);
    stats.encode_errors.store(0, Ordering::Relaxed);
    stats.samples_written.store(0, Ordering::Relaxed);
    stats.audio_samples_written.store(0, Ordering::Relaxed);
    stats.write_errors.store(0, Ordering::Relaxed);
    stats.dropped_frames.store(0, Ordering::Relaxed);
    stats.paced_frames.store(0, Ordering::Relaxed);
    stats.last_fused_gpu_ns.store(0, Ordering::Relaxed);
    stats.last_encode_submit_ns.store(0, Ordering::Relaxed);
    stats.fused_gpu_ns_ewma.store(0, Ordering::Relaxed);
    stats.encode_submit_ns_ewma.store(0, Ordering::Relaxed);
    stats.fused_gpu_ns_window_max.store(0, Ordering::Relaxed);
    stats
        .capture_mode
        .store(CAPTURE_MODE_WGC, Ordering::Relaxed);
    stats
        .active_backend
        .store(ACTIVE_BACKEND_NA, Ordering::Relaxed);
    stats
        .encoder_backend
        .store(ENCODER_BACKEND_SOFTWARE, Ordering::Relaxed);
    stats
        .fallback_reason
        .store(FALLBACK_REASON_NONE, Ordering::Relaxed);
    stats.set_capture_unavailable(false);
    stats.set_foreign_hook(false);
    stats.clear_negotiated_params();
}

#[cfg(test)]
mod stats_snapshot_tests {
    use super::*;

    #[test]
    fn default_snapshot_reports_wgc_and_zeroes() {
        let stats = NativeShareStats::default();
        let snap = stats.snapshot();
        assert_eq!(snap.capture_mode, "wgc");
        // New status fields default to no-backend / software / no-fallback.
        assert_eq!(snap.active_backend, "n/a");
        assert_eq!(snap.encoder_backend, "software");
        assert_eq!(snap.fallback_reason, "none");
        assert_eq!(snap.captured_frames, 0);
        assert_eq!(snap.encoded_frames, 0);
        assert_eq!(snap.encode_errors, 0);
        assert_eq!(snap.samples_written, 0);
        assert_eq!(snap.dropped_frames, 0);
        assert_eq!(snap.last_fused_gpu_us, 0);
        assert_eq!(snap.last_encode_submit_us, 0);
        assert_eq!(snap.fused_gpu_us_avg, 0);
        assert_eq!(snap.encode_submit_us_avg, 0);
    }

    #[test]
    fn snapshot_maps_existing_counters_unchanged() {
        let stats = NativeShareStats::default();
        stats.captured_frames.store(101, Ordering::Relaxed);
        stats.encoded_frames.store(97, Ordering::Relaxed);
        stats.encode_errors.store(2, Ordering::Relaxed);
        stats.samples_written.store(95, Ordering::Relaxed);
        stats.dropped_frames.store(4, Ordering::Relaxed);

        let snap = stats.snapshot();
        assert_eq!(snap.captured_frames, 101);
        assert_eq!(snap.encoded_frames, 97);
        assert_eq!(snap.encode_errors, 2);
        assert_eq!(snap.samples_written, 95);
        assert_eq!(snap.dropped_frames, 4);
    }

    #[test]
    fn snapshot_converts_timing_ns_to_us() {
        let stats = NativeShareStats::default();
        // 1_500_000 ns = 1500 us; integer division truncates sub-microsecond.
        stats.last_fused_gpu_ns.store(1_500_000, Ordering::Relaxed);
        stats.last_encode_submit_ns.store(2_999, Ordering::Relaxed); // -> 2 us
        stats.fused_gpu_ns_ewma.store(1_234_567, Ordering::Relaxed); // -> 1234 us
        stats.encode_submit_ns_ewma.store(500, Ordering::Relaxed); // -> 0 us

        let snap = stats.snapshot();
        assert_eq!(snap.last_fused_gpu_us, 1_500);
        assert_eq!(snap.last_encode_submit_us, 2);
        assert_eq!(snap.fused_gpu_us_avg, 1_234);
        assert_eq!(snap.encode_submit_us_avg, 0);
    }

    #[test]
    fn snapshot_reports_capture_mode_string() {
        let stats = NativeShareStats::default();
        stats.set_capture_mode(CaptureMode::Hook);
        assert_eq!(stats.snapshot().capture_mode, "hook");
        stats.set_capture_mode(CaptureMode::Wgc);
        assert_eq!(stats.snapshot().capture_mode, "wgc");
    }

    #[test]
    fn capture_mode_u8_round_trips() {
        for mode in [CaptureMode::Wgc, CaptureMode::Hook] {
            assert_eq!(capture_mode_from_u8(capture_mode_to_u8(mode)), mode);
        }
        // Unknown discriminants fall back to the wgc default.
        assert_eq!(capture_mode_from_u8(42), CaptureMode::Wgc);
    }

    #[test]
    fn snapshot_reports_active_backend_string() {
        // While the hook is active the snapshot names the backend (Req 14.2);
        // `None` (the WGC fallback path) reports the non-backend `n/a` marker.
        let stats = NativeShareStats::default();
        stats.set_active_backend(Some(GraphicsApiBackend::Dx11));
        assert_eq!(stats.snapshot().active_backend, "dx11");
        stats.set_active_backend(Some(GraphicsApiBackend::Dx12));
        assert_eq!(stats.snapshot().active_backend, "dx12");
        stats.set_active_backend(Some(GraphicsApiBackend::Vulkan));
        assert_eq!(stats.snapshot().active_backend, "vulkan");
        stats.set_active_backend(Some(GraphicsApiBackend::OpenGl));
        assert_eq!(stats.snapshot().active_backend, "opengl");
        stats.set_active_backend(None);
        assert_eq!(stats.snapshot().active_backend, "n/a");
    }

    #[test]
    fn snapshot_reports_encoder_backend_string() {
        // The active encoder backend round-trips to its stable string (Req 14.3).
        let stats = NativeShareStats::default();
        for (backend, expected) in [
            (EncoderBackend::Nvenc, "nvenc"),
            (EncoderBackend::Amf, "amf"),
            (EncoderBackend::QuickSync, "quicksync"),
            (EncoderBackend::GenericHwMft, "generic_hw"),
            (EncoderBackend::Software, "software"),
        ] {
            stats.set_encoder_backend(backend);
            assert_eq!(stats.snapshot().encoder_backend, expected);
        }
    }

    #[test]
    fn snapshot_reports_fallback_reason_string() {
        // The recorded fallback reason round-trips to its stable string (Req 14.4).
        let stats = NativeShareStats::default();
        stats.set_fallback_reason(FallbackReason::Blocklisted);
        assert_eq!(stats.snapshot().fallback_reason, "blocklisted");
        stats.set_fallback_reason(FallbackReason::CrossAdapter);
        assert_eq!(stats.snapshot().fallback_reason, "cross_adapter");
        stats.set_fallback_reason(FallbackReason::None);
        assert_eq!(stats.snapshot().fallback_reason, "none");
    }

    #[test]
    fn snapshot_defaults_new_fields() {
        // A fresh stats struct reports the prior-behavior policy default, no
        // capture-unavailable / foreign-hook condition, and a not-yet-negotiated
        // (None) resolution/fps (Req 5.1, 5.5, 9.4, 8.2, 3.4).
        let snap = NativeShareStats::default().snapshot();
        assert_eq!(snap.capture_policy, "wgc-enabled");
        assert!(!snap.capture_unavailable);
        assert!(!snap.foreign_hook);
        assert_eq!(snap.negotiated_width, None);
        assert_eq!(snap.negotiated_height, None);
        assert_eq!(snap.negotiated_fps, None);
    }

    #[test]
    fn snapshot_reports_capture_policy_string() {
        // The resolved policy round-trips to its stable string (Req 5.5).
        let stats = NativeShareStats::default();
        stats.set_capture_policy(true);
        assert_eq!(stats.snapshot().capture_policy, "hook-exclusive");
        stats.set_capture_policy(false);
        assert_eq!(stats.snapshot().capture_policy, "wgc-enabled");
    }

    #[test]
    fn capture_policy_from_u8_defaults_to_wgc_enabled() {
        assert_eq!(
            capture_policy_from_u8(CAPTURE_POLICY_HOOK_EXCLUSIVE),
            "hook-exclusive"
        );
        assert_eq!(
            capture_policy_from_u8(CAPTURE_POLICY_WGC_ENABLED),
            "wgc-enabled"
        );
        // Unknown discriminants fall back to the wgc-enabled default.
        assert_eq!(capture_policy_from_u8(200), "wgc-enabled");
    }

    #[test]
    fn snapshot_reports_capture_unavailable_and_foreign_hook_flags() {
        let stats = NativeShareStats::default();
        stats.set_capture_unavailable(true);
        stats.set_foreign_hook(true);
        let snap = stats.snapshot();
        assert!(snap.capture_unavailable);
        assert!(snap.foreign_hook);

        stats.set_capture_unavailable(false);
        stats.set_foreign_hook(false);
        let snap = stats.snapshot();
        assert!(!snap.capture_unavailable);
        assert!(!snap.foreign_hook);
    }

    #[test]
    fn snapshot_maps_negotiated_params_with_sentinel() {
        let stats = NativeShareStats::default();
        // 0 width/height/fps is the not-yet-negotiated sentinel -> None.
        assert_eq!(stats.snapshot().negotiated_width, None);

        // A fractional fps survives the milli-fps round-trip.
        stats.set_negotiated_params(1920, 1080, 59.94);
        let snap = stats.snapshot();
        assert_eq!(snap.negotiated_width, Some(1920));
        assert_eq!(snap.negotiated_height, Some(1080));
        assert_eq!(snap.negotiated_fps, Some(59.94));

        // Clearing returns to the explicit not-yet-negotiated state.
        stats.clear_negotiated_params();
        let snap = stats.snapshot();
        assert_eq!(snap.negotiated_width, None);
        assert_eq!(snap.negotiated_height, None);
        assert_eq!(snap.negotiated_fps, None);
    }

    #[test]
    fn set_negotiated_params_clamps_non_finite_or_negative_fps() {
        let stats = NativeShareStats::default();
        // Non-finite / non-positive fps is clamped to the not-yet-negotiated
        // sentinel rather than producing a bogus negotiated rate (Req 9.4).
        stats.set_negotiated_params(1280, 720, -1.0);
        assert_eq!(stats.snapshot().negotiated_fps, None);
        stats.set_negotiated_params(1280, 720, f64::NAN);
        assert_eq!(stats.snapshot().negotiated_fps, None);
        stats.set_negotiated_params(1280, 720, 0.0);
        assert_eq!(stats.snapshot().negotiated_fps, None);
        // Width/height are still recorded.
        assert_eq!(stats.snapshot().negotiated_width, Some(1280));
        assert_eq!(stats.snapshot().negotiated_height, Some(720));
    }

    #[test]
    fn sentinel_u32_to_option_maps_zero_to_none() {
        assert_eq!(sentinel_u32_to_option(0), None);
        assert_eq!(sentinel_u32_to_option(1), Some(1));
        assert_eq!(sentinel_u32_to_option(1920), Some(1920));
    }

    #[test]
    fn active_backend_u8_round_trips() {
        // Every backend (and the no-backend sentinel) round-trips to its string.
        for backend in [
            GraphicsApiBackend::Dx11,
            GraphicsApiBackend::Dx12,
            GraphicsApiBackend::Vulkan,
            GraphicsApiBackend::OpenGl,
        ] {
            assert_eq!(
                active_backend_from_u8(active_backend_to_u8(Some(backend))),
                backend.as_str()
            );
        }
        assert_eq!(active_backend_from_u8(active_backend_to_u8(None)), "n/a");
        // Unknown discriminants report the non-backend marker.
        assert_eq!(active_backend_from_u8(200), "n/a");
    }

    #[test]
    fn encoder_backend_u8_round_trips() {
        for backend in [
            EncoderBackend::Nvenc,
            EncoderBackend::Amf,
            EncoderBackend::QuickSync,
            EncoderBackend::GenericHwMft,
            EncoderBackend::Software,
        ] {
            assert_eq!(
                encoder_backend_from_u8(encoder_backend_to_u8(backend)),
                backend
            );
        }
        // Unknown discriminants fall back to the software default.
        assert_eq!(encoder_backend_from_u8(200), EncoderBackend::Software);
    }

    #[test]
    fn fallback_reason_u8_round_trips() {
        for reason in [
            FallbackReason::None,
            FallbackReason::NotWindows,
            FallbackReason::MonitorSource,
            FallbackReason::BackendDisabled,
            FallbackReason::HookDisabled,
            FallbackReason::MissingArtifact,
            FallbackReason::Blocklisted,
            FallbackReason::NotAllowlisted,
            FallbackReason::InjectionDenied,
            FallbackReason::InjectionFailed,
            FallbackReason::CrossAdapter,
            FallbackReason::InteropFailed,
            FallbackReason::TargetExited,
            FallbackReason::HookStoppedMidSession,
            FallbackReason::HookNoFirstFrame,
        ] {
            assert_eq!(
                fallback_reason_from_u8(fallback_reason_to_u8(reason)),
                reason
            );
        }
        // Unknown discriminants fall back to `None`.
        assert_eq!(fallback_reason_from_u8(200), FallbackReason::None);
    }

    #[test]
    fn snapshot_serializes_to_json() {
        let stats = NativeShareStats::default();
        stats.captured_frames.store(7, Ordering::Relaxed);
        stats.last_fused_gpu_ns.store(3_000, Ordering::Relaxed);
        let json = serde_json::to_value(stats.snapshot()).unwrap();
        assert_eq!(json["capture_mode"], "wgc");
        assert_eq!(json["active_backend"], "n/a");
        assert_eq!(json["encoder_backend"], "software");
        assert_eq!(json["fallback_reason"], "none");
        assert_eq!(json["captured_frames"], 7);
        assert_eq!(json["last_fused_gpu_us"], 3);
        // New additive fields are present on the IPC payload (Req 5.5, 8.2,
        // 3.4, 9.1, 9.4). Negotiated params serialize as JSON null while not
        // yet negotiated.
        assert_eq!(json["capture_policy"], "wgc-enabled");
        assert_eq!(json["capture_unavailable"], false);
        assert_eq!(json["foreign_hook"], false);
        assert!(json["negotiated_width"].is_null());
        assert!(json["negotiated_height"].is_null());
        assert!(json["negotiated_fps"].is_null());
    }
}
