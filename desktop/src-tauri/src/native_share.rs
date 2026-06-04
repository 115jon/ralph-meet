use bytes::Bytes;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, AtomicU8, Ordering};
use std::sync::{mpsc, Arc};
use tauri::Emitter;
use tokio::sync::{broadcast, Mutex};
use webrtc::api::interceptor_registry::register_default_interceptors;
use webrtc::api::media_engine::MediaEngine;
use webrtc::api::APIBuilder;
use webrtc::ice_transport::ice_credential_type::RTCIceCredentialType;
use webrtc::peer_connection::configuration::RTCConfiguration;
use webrtc::peer_connection::peer_connection_state::RTCPeerConnectionState;
use webrtc::peer_connection::sdp::session_description::RTCSessionDescription;
use webrtc::peer_connection::RTCPeerConnection;
use webrtc::rtp_transceiver::rtp_codec::RTCRtpCodecCapability;
use webrtc::track::track_local::track_local_static_sample::TrackLocalStaticSample;
use webrtc::track::track_local::TrackLocal;

use crate::d3d_device::D3dDevice;
use crate::game_capture::{
    apply_capture_policy, fallback_reason, resolve_capture_policy, select_capture_mode_v2,
    should_notify_unavailable, BackendGate, CaptureMode, CapturePolicy, CaptureResolution,
    FallbackReason, GraphicsApiBackend, InjectionOutcome, SafetyDecision, SelectionInputs,
    SourceKind,
};
use crate::wmf_encoder::{EncoderBackend, MftEncoderWorker, VideoCodec};

fn even_dimension(value: u32) -> u32 {
    value.saturating_sub(value % 2).max(2)
}

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
        self.active_backend
            .store(active_backend_u8_from_hooked(hooked, detected), Ordering::Relaxed);
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
        self.capture_unavailable.store(unavailable, Ordering::Relaxed);
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
        self.negotiated_fps_milli.store(fps_milli, Ordering::Relaxed);
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

// ── Shared Tauri state ─────────────────────────────────────────────────────

#[derive(Default)]
pub struct NativeShareState {
    pub active_connection: Mutex<Option<Arc<RTCPeerConnection>>>,
    pub video_track: Mutex<Option<Arc<TrackLocalStaticSample>>>,
    /// WGC capture session — drop to stop capture.
    pub wgc_capture: Mutex<Option<crate::wgc_capture::WgcCapture>>,
    /// Encoder worker — dropped in stop command.
    pub encoder_worker: Mutex<Option<MftEncoderWorker>>,
    /// Live game-capture hook session (Req 7) when the session resolved to the
    /// zero-copy `hook` Capture_Mode. This owns the background hook capture
    /// thread (which pulls `GameCaptureHook` surfaces and feeds them into the
    /// encoder frame channel in place of WGC) plus its stop flag/join handle;
    /// dropping it (on stop) signals the thread to exit and joins it, which
    /// runs [`GameCaptureHook::detach`] to release the shared surfaces and the
    /// IPC channel (Req 1.6, 7.4, 7.5). `None` whenever the session runs on the
    /// WGC fallback path. Gated behind `game-capture-hook` + `windows`: on the
    /// `native-screen-share`-only build the hook never exists and the session is
    /// pure WGC, so the field is absent (Req 12.5).
    #[cfg(all(feature = "game-capture-hook", windows))]
    pub game_hook: Mutex<Option<HookCaptureSession>>,
    pub audio_running: Arc<std::sync::atomic::AtomicBool>,
    pub stats: Arc<NativeShareStats>,
    /// The active session's native source dimensions `(src_width, src_height)`,
    /// captured at start so a live quality switch can cap encode dims to the
    /// source without re-resolving the WGC item. `None` when no session is
    /// active.
    pub session_src_dims: Mutex<Option<(u32, u32)>>,
    /// Set `true` for the lifetime of an active native share session and flipped
    /// `false` by `stop_native_screen_share`. Lightweight per-session liveness
    /// signal used by background watchers (e.g. the WGC window-close watchdog)
    /// to exit promptly when the share is stopped normally, without each having
    /// to hold a clone of every session resource.
    pub session_active: Arc<std::sync::atomic::AtomicBool>,
    /// The capture-rate cap (ns between frames) the DLL should honor for the
    /// active session, shared with the hook capture loop. A live quality switch
    /// writes the new fps interval here; the loop pushes it into the live
    /// `hook_info.frame_interval` so the DLL's shtex-copy rate matches the new
    /// fps (e.g. 30→60) without re-injection. `0` until a hook session starts.
    #[cfg(all(feature = "game-capture-hook", windows))]
    pub session_frame_interval_ns: Arc<std::sync::atomic::AtomicU64>,
    /// Broadcast sender for encoded H.264 frames. The bridge thread taps this
    /// so a preview PeerConnection can subscribe without touching the SFU path.
    /// `None` when no session is active.
    pub preview_broadcast_tx: Mutex<Option<broadcast::Sender<Vec<u8>>>>,
    /// Preview loopback PeerConnection — carries the same encoded H.264 samples
    /// the SFU receives to a localhost PC for the local preview tile. Created on
    /// demand when the user resumes the preview during a hook share. Torn down
    /// on hide/stop/source-end.
    pub preview_pc: Mutex<Option<Arc<RTCPeerConnection>>>,
}

// ── WASAPI loopback audio (unchanged from original) ───────────────────────

#[cfg(target_os = "windows")]
fn start_wasapi_loopback_audio(
    audio_track: Arc<TrackLocalStaticSample>,
    peer_connection: Arc<RTCPeerConnection>,
    running: Arc<std::sync::atomic::AtomicBool>,
    stats: Arc<NativeShareStats>,
) {
    running.store(true, Ordering::Relaxed);
    let runtime = tokio::runtime::Handle::current();

    std::thread::Builder::new()
        .name("RalphNativeScreenAudio".to_owned())
        .spawn(move || {
            if let Err(err) =
                run_wasapi_loopback_audio(audio_track, peer_connection, running, stats, runtime)
            {
                log::warn!("[NativeShare] WASAPI loopback audio stopped: {err}");
            }
        })
        .ok();
}

#[cfg(target_os = "windows")]
fn run_wasapi_loopback_audio(
    audio_track: Arc<TrackLocalStaticSample>,
    peer_connection: Arc<RTCPeerConnection>,
    running: Arc<std::sync::atomic::AtomicBool>,
    stats: Arc<NativeShareStats>,
    runtime: tokio::runtime::Handle,
) -> Result<(), String> {
    use std::collections::VecDeque;
    use shiguredo_opus::{Application, Encoder as OpusEncoder, EncoderConfig};
    use wasapi::{initialize_mta, DeviceEnumerator, Direction, SampleType, StreamMode, WaveFormat};

    initialize_mta()
        .ok()
        .map_err(|e| format!("Initialize WASAPI MTA failed: {e}"))?;

    let enumerator =
        DeviceEnumerator::new().map_err(|e| format!("Create WASAPI enumerator failed: {e}"))?;
    let device = enumerator
        .get_default_device(&Direction::Render)
        .map_err(|e| format!("Get default render device failed: {e}"))?;
    let mut audio_client = device
        .get_iaudioclient()
        .map_err(|e| format!("Create WASAPI audio client failed: {e}"))?;

    let desired_format = WaveFormat::new(32, 32, &SampleType::Float, 48_000, 2, None);
    let blockalign = desired_format.get_blockalign() as usize;
    let (_default_time, min_time) = audio_client
        .get_device_period()
        .map_err(|e| format!("Get WASAPI device period failed: {e}"))?;
    let mode = StreamMode::EventsShared {
        autoconvert: true,
        buffer_duration_hns: min_time,
    };

    audio_client
        .initialize_client(&desired_format, &Direction::Capture, &mode)
        .map_err(|e| format!("Initialize WASAPI loopback client failed: {e}"))?;
    let event = audio_client
        .set_get_eventhandle()
        .map_err(|e| format!("Create WASAPI event handle failed: {e}"))?;
    let capture_client = audio_client
        .get_audiocaptureclient()
        .map_err(|e| format!("Create WASAPI capture client failed: {e}"))?;

    let mut opus_config = EncoderConfig::new(48_000, 2);
    opus_config.application = Some(Application::Audio);
    opus_config.bitrate = Some(192_000);
    opus_config.vbr = Some(true);
    opus_config.dtx = Some(false);
    let mut encoder =
        OpusEncoder::new(opus_config).map_err(|e| format!("Create Opus encoder failed: {e}"))?;

    let mut sample_queue: VecDeque<u8> = VecDeque::with_capacity(blockalign * 48_000);
    let frame_samples_per_channel = 960usize; // 20 ms at 48 kHz
    let frame_bytes = blockalign * frame_samples_per_channel;
    audio_client
        .start_stream()
        .map_err(|e| format!("Start WASAPI loopback stream failed: {e}"))?;

    while running.load(Ordering::Relaxed) {
        capture_client
            .read_from_device_to_deque(&mut sample_queue)
            .map_err(|e| format!("Read WASAPI loopback packet failed: {e}"))?;

        while sample_queue.len() >= frame_bytes {
            let mut pcm = Vec::with_capacity(frame_samples_per_channel * 2);
            for _ in 0..(frame_samples_per_channel * 2) {
                let b0 = sample_queue.pop_front().unwrap_or(0);
                let b1 = sample_queue.pop_front().unwrap_or(0);
                let b2 = sample_queue.pop_front().unwrap_or(0);
                let b3 = sample_queue.pop_front().unwrap_or(0);
                pcm.push(f32::from_le_bytes([b0, b1, b2, b3]));
            }

            match encoder.encode_f32(&pcm) {
                Ok(packet) if !packet.is_empty() => {
                    let sample = webrtc::media::Sample {
                        data: Bytes::from(packet),
                        duration: std::time::Duration::from_millis(20),
                        ..Default::default()
                    };
                    let track = Arc::clone(&audio_track);
                    let pc = Arc::clone(&peer_connection);
                    let stats = Arc::clone(&stats);
                    runtime.spawn(async move {
                        if pc.connection_state() == RTCPeerConnectionState::Connected {
                            match track.write_sample(&sample).await {
                                Ok(_) => {
                                    stats.audio_samples_written.fetch_add(1, Ordering::Relaxed);
                                }
                                Err(_) => {
                                    stats.write_errors.fetch_add(1, Ordering::Relaxed);
                                }
                            }
                        }
                    });
                }
                Ok(_) => {}
                Err(err) => {
                    log::warn!("[NativeShare] Opus encode failed: {err}");
                }
            }
        }

        let _ = event.wait_for_event(100);
    }

    let _ = audio_client.stop_stream();
    Ok(())
}

// ── Signaling payloads ─────────────────────────────────────────────────────

#[derive(serde::Serialize, serde::Deserialize)]
pub struct SdpOfferPayload {
    pub sdp: String,
    pub r#type: String,
}

#[derive(Clone, Debug, serde::Deserialize)]
pub struct NativeIceServer {
    pub urls: Vec<String>,
    pub username: Option<String>,
    pub credential: Option<String>,
}

// ── Resolve source ID to WGC capture item ─────────────────────────────────

fn resolve_wgc_item(
    source_id: &str,
) -> Result<windows::Graphics::Capture::GraphicsCaptureItem, String> {
    if let Some(raw_idx) = source_id.strip_prefix("monitor-") {
        let idx = raw_idx
            .parse::<usize>()
            .map_err(|_| format!("Invalid monitor source id: {source_id}"))?;
        crate::wgc_capture::capture_item_for_monitor_idx(idx)
            .map_err(|e| format!("Create WGC monitor item: {e}"))
    } else if let Some(raw_hwnd) = source_id.strip_prefix("window-") {
        let hwnd = raw_hwnd
            .parse::<isize>()
            .map_err(|_| format!("Invalid window source id: {source_id}"))?;
        crate::wgc_capture::capture_item_for_hwnd(hwnd)
            .map_err(|e| format!("Create WGC window item: {e}"))
    } else {
        Err(format!("Unsupported native capture source id: {source_id}"))
    }
}

/// Derive the [`SourceKind`] from a native capture `source_id`.
///
/// Source ids are the same strings `resolve_wgc_item` understands: a
/// `"monitor-<idx>"` id is a [`SourceKind::Monitor`] (always WGC, Req 6.2) and a
/// `"window-<hwnd>"` id is a [`SourceKind::Window`] (the only hook candidate,
/// Req 7.1). Any other prefix is treated as a window so it still flows through
/// the (conservative) selection — a non-window/non-monitor id never reaches
/// here because `resolve_wgc_item` rejects it first.
fn source_kind_from_id(source_id: &str) -> SourceKind {
    if source_id.starts_with("monitor-") {
        SourceKind::Monitor
    } else {
        SourceKind::Window
    }
}

/// Parse the raw `HWND` value out of a `"window-<hwnd>"` source id, if present.
/// Returns `None` for a monitor id or a malformed window id (in which case no
/// hook attach is attempted and the session stays on the WGC path).
///
/// `#[allow(dead_code)]`: on the `native-screen-share`-only (hook feature-off)
/// build the only caller is the `game-capture-hook`-gated `prepare_hook`, so the
/// non-test build would otherwise flag this as unused.
#[allow(dead_code)]
fn window_hwnd_from_id(source_id: &str) -> Option<isize> {
    source_id
        .strip_prefix("window-")
        .and_then(|raw| raw.parse::<isize>().ok())
}

/// Resolve the [`GraphicsApiBackend`] label to report for this session's target.
///
/// On the `game-capture-hook` + Windows build for a window source, this opens
/// the target process and inspects its loaded graphics runtimes
/// ([`detect_graphics_api`](crate::game_capture::inject::detect_graphics_api)) so
/// a DX12 game is reported as `dx12` rather than the historical hardcoded
/// `dx11`. DX11 and DX12 capture through the **same** DXGI present hook, so the
/// label never changes which interception path is used — only the
/// `Capture_Status` string and the active-backend gate.
///
/// Falls back to [`GraphicsApiBackend::Dx11`] when detection is unavailable: a
/// monitor source, a non-feature/non-Windows build, a window id that does not
/// resolve to a pid, or a process that loads no known runtime. DX11 is the safe
/// default because it is captured through the identical DXGI hook and was the
/// prior unconditional assumption.
fn detect_target_backend(source_id: &str, source_kind: SourceKind) -> GraphicsApiBackend {
    #[cfg(all(feature = "game-capture-hook", windows))]
    {
        if source_kind == SourceKind::Window {
            if let Some(backend) = window_hwnd_from_id(source_id)
                .and_then(window_pid_from_hwnd)
                .and_then(crate::game_capture::inject::detect_graphics_api)
            {
                return backend;
            }
        }
        GraphicsApiBackend::Dx11
    }
    #[cfg(not(all(feature = "game-capture-hook", windows)))]
    {
        let _ = (source_id, source_kind);
        GraphicsApiBackend::Dx11
    }
}

/// Whether the DX11 zero-copy game-capture hook may be attempted this session.
///
/// The hook is **additive and opt-in**: WGC is the proven, guaranteed path
/// (Req 6) and must remain the default, so the hook is only attempted when the
/// `RALPH_GAME_CAPTURE_HOOK` environment variable is set to a truthy value
/// (`1`, `true`, `yes`, or `on`, case-insensitive). With the variable unset or
/// any other value, `select_capture_mode` is still called but with
/// `hook_enabled = false`, so it always resolves to `wgc` and default behavior
/// is unchanged.
fn game_capture_hook_enabled() -> bool {
    // When the `game-capture-hook` feature is compiled in, the hook is ON by
    // default in production installs — no env var required. The env var still
    // works as an explicit override in both directions so dev scripts and
    // CI can force a specific state without a rebuild:
    //   RALPH_GAME_CAPTURE_HOOK=0/false/no/off  → force disabled
    //   RALPH_GAME_CAPTURE_HOOK=1/true/yes/on   → force enabled (redundant
    //                                              when the feature is in,
    //                                              useful when it's not)
    let feature_compiled_in = cfg!(feature = "game-capture-hook");
    match std::env::var("RALPH_GAME_CAPTURE_HOOK").ok().as_deref() {
        Some(v) => matches!(
            v.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        ),
        // No env var → honour the compile-time feature flag as the default.
        None => feature_compiled_in,
    }
}

/// The runtime `Capture_Policy` setting for the session, read from the
/// `RALPH_CAPTURE_POLICY` environment variable (Req 5.1).
///
/// The dev script (`scripts/dev-deployed.ps1`) sets this variable so the
/// runtime setting wins over the build-feature default in development:
/// `"hook-exclusive"` ⇒ [`CapturePolicy::HookExclusive`], `"wgc-enabled"` ⇒
/// [`CapturePolicy::WgcEnabled`] (both case-insensitive, surrounding whitespace
/// trimmed). Any other value — including an unset variable — yields `None` so
/// [`resolve_capture_policy`] falls through to the build-feature default and,
/// failing that, the documented `wgc-enabled` default.
fn runtime_capture_policy() -> Option<CapturePolicy> {
    std::env::var("RALPH_CAPTURE_POLICY").ok().and_then(|v| {
        match v.trim().to_ascii_lowercase().as_str() {
            "hook-exclusive" => Some(CapturePolicy::HookExclusive),
            "wgc-enabled" => Some(CapturePolicy::WgcEnabled),
            _ => None,
        }
    })
}

/// The build-feature default `Capture_Policy` (Req 5.1).
///
/// When the `game-capture-hook` feature is compiled in, the production default
/// is `HookExclusive` — a hook build IS the hook product. The runtime env var
/// `RALPH_CAPTURE_POLICY` (set by dev scripts) still wins when present, so
/// dev/CI can override without a rebuild. Without the feature the default
/// remains `None` and [`resolve_capture_policy`] falls through to `wgc-enabled`.
fn feature_default_capture_policy() -> Option<CapturePolicy> {
    if cfg!(feature = "game-capture-hook") {
        Some(CapturePolicy::HookExclusive)
    } else {
        None
    }
}

/// Whether a hook-injection `outcome` must trigger the "zero-copy hook
/// unavailable" user notification.
///
/// This is the pure decision that drives the `native-screen-share-status`
/// `"hook-unavailable…"` emit in [`start_native_screen_share`]: a hook attempt
/// that **failed** or was **blocked** (anti-cheat) falls back to WGC and must
/// notify the user (Req 6.3, 7.4). A [`InjectionOutcome::Success`] (the hook is
/// the active mode) or [`InjectionOutcome::NotAttempted`] (a monitor source or a
/// disabled hook, where WGC was always going to be used) is silent.
///
/// Extracted as a `pub fn` so the notification *decision* can be unit-tested at
/// a public seam without constructing a Tauri `AppHandle` (the `emit` itself
/// needs one and so cannot run in CI).
pub fn should_notify_hook_unavailable(outcome: InjectionOutcome) -> bool {
    matches!(
        outcome,
        InjectionOutcome::Failed | InjectionOutcome::Blocked
    )
}

/// Whether the Game_Capture_Hook may even be considered this session.
///
/// The hook is **doubly gated** (Req 12.2, 12.5): it is only built into the
/// binary behind the `game-capture-hook` Cargo feature, and even then it is
/// opt-in behind the `RALPH_GAME_CAPTURE_HOOK` environment variable
/// ([`game_capture_hook_enabled`]). On a `native-screen-share`-only build this
/// is always `false`, so [`SelectionInputs::hook_enabled`] is `false`, the v2
/// selection resolves to `wgc`, and the unavailable notification stays silent —
/// the session behaves as pure WGC.
fn hook_feature_enabled() -> bool {
    let compiled_in = cfg!(feature = "game-capture-hook");
    let env_on = game_capture_hook_enabled();
    // Loud, explicit diagnostics so a "why is the hook off?" investigation never
    // requires reading source. Each gate is reported independently because they
    // fail for very different reasons (build config vs runtime opt-in).
    if !compiled_in {
        log::info!(
            "[NativeShare] Game_Capture_Hook NOT compiled in (the `game-capture-hook` Cargo \
             feature is off in this build); using WGC. Rebuild with \
             `--features game-capture-hook` to enable the zero-copy hook."
        );
    } else if !env_on {
        // compiled_in is true but the env var was explicitly set to a falsy value.
        log::info!(
            "[NativeShare] Game_Capture_Hook compiled in but DISABLED at runtime \
             (RALPH_GAME_CAPTURE_HOOK explicitly set to a falsy value: 0/false/no/off); \
             using WGC. Unset the variable or set it to 1/true/yes/on to re-enable."
        );
    } else {
        log::info!(
            "[NativeShare] Game_Capture_Hook enabled (feature compiled in{}); the hook will \
             be attempted for an eligible window source.",
            if std::env::var("RALPH_GAME_CAPTURE_HOOK").is_ok() {
                " + RALPH_GAME_CAPTURE_HOOK override"
            } else {
                ", default-on"
            }
        );
    }
    compiled_in && env_on
}

// ───────────────────────────────────────────────────────────────────────────
// Game_Capture_Hook session wiring (task 11.1) — gated behind
// `game-capture-hook` + `windows`. On the feature-off / non-Windows build none
// of this is compiled and the session is pure WGC (Req 12.5, 13.2).
// ───────────────────────────────────────────────────────────────────────────

/// The result of preparing a hook attach: the eligibility/safety/injection
/// facts the v2 selection needs as plain values, plus the live
/// [`GameCaptureHook`](crate::game_capture::dx11::GameCaptureHook) when injection
/// succeeded.
///
/// Built by [`prepare_hook`] before the v2 selection runs so
/// [`select_capture_mode_v2`] / [`fallback_reason`] decide the mode from these
/// values. When the resolved mode is not `hook` the `hook` field is dropped,
/// which detaches the injected payload and stops the IPC channel (Req 7.5).
#[cfg(all(feature = "game-capture-hook", windows))]
struct HookPreparation {
    /// The matching-bitness payload + helper are present next to the binary
    /// (Req 2.5); derived from `plan_injection` feasibility.
    artifact_available: bool,
    /// The anti-cheat blocklist/allowlist decision (Req 10.2, 10.3).
    safety: SafetyDecision,
    /// The outcome of the OBS `inject-helper` run (Req 7.4, 10.4).
    injection: InjectionOutcome,
    /// Whether the target renders on the same GPU adapter as the
    /// `Shared_D3D_Device` (Req 5.4, 9.4). Best-effort — see [`prepare_hook`].
    same_adapter: bool,
    /// The live hook over the OBS IPC reader, present only on a successful
    /// injection. Moved onto the hook capture thread when the mode is `hook`,
    /// or dropped (detached) on the WGC fallback path.
    hook: Option<crate::game_capture::dx11::GameCaptureHook>,
    /// The present offset for the target backend was zero/absent, so the
    /// backend cannot install its Present interception (Req 4.6). When set, no
    /// injection was attempted and the session wiring records
    /// [`FallbackReason::BackendDisabled`] and uses WGC (Req 5.8). Distinct from
    /// an offset-*resolution* failure (helper missing/non-zero/timeout/empty),
    /// which leaves `injection = NotAttempted` so the reason is
    /// `InjectionFailed` instead (Req 4.7).
    missing_offsets: bool,
}

#[cfg(all(feature = "game-capture-hook", windows))]
impl HookPreparation {
    /// A preparation for a session where no injection was attempted (a monitor
    /// source, a disabled/feature-off hook, a non-window id, or a backend whose
    /// gate is off): nothing available, nothing injected, no hook.
    fn not_attempted() -> Self {
        Self {
            artifact_available: false,
            safety: SafetyDecision::Allow,
            injection: InjectionOutcome::NotAttempted,
            same_adapter: true,
            hook: None,
            missing_offsets: false,
        }
    }
}

/// The host process bitness (compile-time): the running binary is 64-bit on a
/// 64-bit target and 32-bit otherwise. Feeds the pure `plan_injection` so the
/// host/target match decides Direct vs CrossBitness injection (Req 2.2, 2.3).
#[cfg(all(feature = "game-capture-hook", windows))]
fn host_bitness() -> crate::game_capture::inject::Bitness {
    use crate::game_capture::inject::Bitness;
    #[cfg(target_pointer_width = "64")]
    {
        Bitness::X64
    }
    #[cfg(not(target_pointer_width = "64"))]
    {
        Bitness::X86
    }
}

/// Resolve the owning process id of a top-level window handle.
///
/// Used to map the selected `"window-<hwnd>"` source to the Target_Process the
/// OBS `inject-helper` injects and the IPC channel binds to. Returns `None` when
/// the handle is invalid (no attach is then attempted).
#[cfg(all(feature = "game-capture-hook", windows))]
fn window_pid_from_hwnd(hwnd: isize) -> Option<u32> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId;
    let mut pid: u32 = 0;
    let thread_id = unsafe { GetWindowThreadProcessId(HWND(hwnd as *mut _), Some(&mut pid)) };
    if thread_id == 0 || pid == 0 {
        None
    } else {
        Some(pid)
    }
}

/// Whether the screen-share `source_id` still refers to a live capture target.
///
/// For a `window-<hwnd>` source this is `IsWindow(hwnd)` — it returns `false`
/// the moment the user closes the shared window, which lets the capture loop
/// stop the share cleanly instead of hanging in `capture-unavailable` (the hook
/// stops delivering frames when its target window is destroyed, but the no-frame
/// watchdog alone cannot tell "window closed" from "transient stall"). Monitor
/// sources (`screen-<idx>`) and any other id are always considered live here —
/// a monitor does not "close", and the WGC `Closed` event handles a monitor that
/// is physically removed. Non-window ids return `true` so they are never
/// spuriously stopped.
#[cfg(windows)]
fn source_still_live(source_id: &str) -> bool {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::IsWindow;
    if let Some(raw) = source_id.strip_prefix("window-") {
        if let Ok(hwnd) = raw.parse::<isize>() {
            // IsWindow returns FALSE once the window is destroyed.
            return unsafe { IsWindow(Some(HWND(hwnd as *mut _))).as_bool() };
        }
    }
    true
}

/// Resolve a process's full executable image path for the anti-cheat safety
/// gate (Req 10.1, 10.2). The blocklist matcher normalizes to the final path
/// component case-insensitively, so the full path is fine. Returns `None` when
/// the process cannot be opened/queried — the caller then treats the target as
/// unidentifiable and **does not** inject (conservative: never inject a target
/// we cannot screen against the blocklist).
#[cfg(all(feature = "game-capture-hook", windows))]
fn process_image_name(pid: u32) -> Option<String> {
    use windows::core::PWSTR;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false.into(), pid).ok()?;
        let mut buf = [0u16; 260];
        let mut size = buf.len() as u32;
        let result = QueryFullProcessImageNameW(
            process,
            PROCESS_NAME_WIN32,
            PWSTR(buf.as_mut_ptr()),
            &mut size,
        );
        let _ = CloseHandle(process);
        result.ok()?;
        Some(String::from_utf16_lossy(&buf[..size as usize]))
    }
}

/// Decide hook eligibility and, when eligible, run the full injection
/// preparation for a window source.
///
/// Eligible only for a window source with the hook enabled and the backend's
/// gate on and active-capable (Req 3.1–3.3, 8.2). Anything else — including a
/// monitor source — returns [`HookPreparation::not_attempted`] (the safe WGC
/// default).
#[cfg(all(feature = "game-capture-hook", windows))]
fn prepare_hook(
    d3d: &Arc<D3dDevice>,
    source_id: &str,
    source_kind: SourceKind,
    backend: GraphicsApiBackend,
    gate: BackendGate,
    hook_enabled: bool,
    foreign_hook_present: bool,
    fps: u32,
) -> HookPreparation {
    let eligible = hook_enabled
        && source_kind == SourceKind::Window
        && gate.enabled(backend)
        && backend.is_active_capable();
    if !eligible {
        return HookPreparation::not_attempted();
    }
    // A competing OBS-derived hook (Discord Go Live / OBS Game Capture) is
    // already present. We still ATTEMPT our hook: two independent Detours hooks
    // on the same present can chain, so coexistence may work. The remedy was
    // logged at the detection site; the DLL's early-pipe diagnostics will now
    // report whether our present hook actually installs and delivers frames
    // alongside the foreign one. (We deliberately do NOT skip here — skipping
    // would guarantee failure whenever Discord is merely running, and would
    // also hide the diagnostic data we need.)
    if foreign_hook_present {
        log::info!(
            "[NativeShare] foreign hook present; attempting our hook anyway (Detours hooks can \
             chain). Watch the [graphics-hook pid N] diagnostics for whether our present hook \
             installs and delivers frames."
        );
    }
    match window_hwnd_from_id(source_id) {
        Some(hwnd) => attempt_hook_injection(d3d, hwnd, backend, fps),
        None => HookPreparation::not_attempted(),
    }
}

/// Run the OBS `inject-helper` + start the IPC reader for a window target, and
/// report the facts the v2 selection needs.
///
/// Flow (design §"Capture-mode and safety-gate selection"):
/// 1. Resolve the Target_Process id from the window (else `Failed`).
/// 2. Discover the OBS artifacts next to the binary and detect the target
///    bitness (`IsWow64Process2`); a detection failure is `Failed`.
/// 3. Pure `plan_injection` — its `Ok`/`Err(MissingArtifact)` is exactly the
///    `artifact_available` fact (Req 2.5).
/// 4. Resolve the target exe and run the **pure** `safety_decision` against the
///    default blocklist (no allowlist configured) — a `Deny` short-circuits
///    **before** injection so a blocklisted title is never injected (Req 10.2).
/// 5. Only on `Allow`: run the OBS `inject-helper` as a separate child process
///    (Req 1.1, 11.1) and, on success, start the [`ObsIpcChannel`] and build the
///    [`GameCaptureHook`].
///
/// `same_adapter` is best-effort: the target's render-adapter LUID is only
/// available through deeper OBS `hook_info` integration, so on the validated
/// single-GPU target this defaults to `true` (the `Shared_D3D_Device` is the
/// game's adapter). The multi-GPU cross-adapter hard-check via
/// [`d3d_device::same_adapter`](crate::d3d_device::same_adapter) is a known
/// integration limitation validated by the manual integration tests (task 11.4).
///
/// [`ObsIpcChannel`]: crate::game_capture::obs_ipc::ObsIpcChannel
/// [`GameCaptureHook`]: crate::game_capture::dx11::GameCaptureHook
#[cfg(all(feature = "game-capture-hook", windows))]
fn attempt_hook_injection(
    d3d: &Arc<D3dDevice>,
    hwnd: isize,
    backend: GraphicsApiBackend,
    fps: u32,
) -> HookPreparation {
    use crate::game_capture::blocklist::{default_blocklist, safety_decision};
    use crate::game_capture::dx11::GameCaptureHook;
    use crate::game_capture::inject::{
        detect_bitness, load_all_graphics_offsets, plan_injection, run_inject_helper, ObsArtifacts,
    };
    use crate::game_capture::obs_ipc::ObsIpcChannel;

    let mut prep = HookPreparation::not_attempted();

    // 1. Target PID from the window handle.
    let Some(target_pid) = window_pid_from_hwnd(hwnd) else {
        prep.injection = InjectionOutcome::Failed;
        return prep;
    };

    // 2. Discover the OBS_Capture_Component artifacts + detect target bitness.
    let artifacts = ObsArtifacts::discover_next_to_binary();
    let target_bitness = match detect_bitness(target_pid) {
        Ok(bitness) => bitness,
        Err(err) => {
            log::warn!("[NativeShare] bitness detection failed for pid {target_pid}: {err}");
            prep.injection = InjectionOutcome::Failed;
            return prep;
        }
    };

    // 3. Pure injection planning. Ok ⇒ the matching-bitness payload (+ helper)
    //    are present (artifact_available); Err(MissingArtifact) ⇒ they are not
    //    (Req 2.5) — leave injection NotAttempted so the reason is
    //    MissingArtifact.
    let strategy = match plan_injection(host_bitness(), target_bitness, &artifacts) {
        Ok(strategy) => {
            prep.artifact_available = true;
            strategy
        }
        Err(reason) => {
            log::info!(
                "[NativeShare] OBS artifacts unavailable for {:?} target (pid {target_pid}): {}",
                target_bitness,
                reason.as_str()
            );
            return prep;
        }
    };

    // 4. Anti-cheat safety gate (pure). Resolve the target exe first; if it
    //    cannot be identified, do NOT inject (conservative — Req 10.1).
    let Some(target_exe) = process_image_name(target_pid) else {
        log::warn!("[NativeShare] could not resolve target exe for pid {target_pid}; skipping injection");
        prep.injection = InjectionOutcome::Failed;
        return prep;
    };
    // No operator allowlist is configured here; an empty allowlist means
    // "allow any not-blocklisted target" (Req 10.3).
    prep.safety = safety_decision(&target_exe, &default_blocklist(), &[]);
    if let SafetyDecision::Deny(reason) = prep.safety {
        // Never inject a blocklisted / non-allowlisted target. The Deny drives
        // the fallback reason; injection stays NotAttempted (Req 10.2, 10.6).
        log::info!(
            "[NativeShare] safety gate denied injection for {target_exe} (pid {target_pid}): {}",
            reason.as_str()
        );
        return prep;
    }

    // 5. Resolve the hook vtable offsets for ALL backends for the TARGET
    //    bitness by running the bundled get-graphics-offsets<bits>.exe (OBS
    //    load-graphics-offsets.c). The injected DLL cannot install its Present
    //    interception without these. Two distinct failure modes feed two
    //    different fallback reasons (design §"Error Handling"):
    //
    //    a) `None` — the helper is missing, exited non-zero, timed out (>5s), or
    //       produced no parseable output (Req 4.7). Leave `injection =
    //       NotAttempted` so the pure `fallback_reason` reports
    //       `InjectionFailed`. The helper itself logs the precise reason +
    //       target PID (Req 6.7), so do not inject and bail to WGC here.
    //    b) `Some` but the present offset for the target backend is zero/absent
    //       (Req 4.6): the backend cannot hook, so record `missing_offsets` (the
    //       wiring maps it to `FallbackReason::BackendDisabled`, Req 5.8), skip
    //       injection, and fall back to WGC.
    let Some(all_offsets) = load_all_graphics_offsets(&artifacts, target_bitness, target_pid)
    else {
        // Offset *resolution* failed; the loader already logged the reason and
        // PID. Do not inject — leave injection NotAttempted ⇒ InjectionFailed.
        log::warn!(
            "[NativeShare] graphics offset resolution failed for pid {target_pid} ({:?}); \
             skipping injection and falling back to WGC",
            target_bitness,
        );
        return prep;
    };

    // The present offset that gates this backend. For the DXGI backends (DX11,
    // and DX12 which still presents through the DXGI swapchain) the gate is the
    // DXGI `present` offset (and `resize`, via `dxgi.hookable()`); Vulkan/OpenGL
    // do not hook via hook_info offsets, so they are gated upstream by the
    // BackendGate / `is_active_capable` (only DX11 is active-capable today) and
    // never reach here with an expectation of an offset.
    let backend_hookable = match backend {
        GraphicsApiBackend::Dx11 | GraphicsApiBackend::Dx12 => all_offsets.dxgi.hookable(),
        // Vulkan/OpenGL: no hook_info offset gate. Their enablement is decided
        // by the BackendGate upstream; do not block injection on a DXGI offset.
        GraphicsApiBackend::Vulkan | GraphicsApiBackend::OpenGl => true,
    };
    if !backend_hookable {
        // Present offset for the target backend is zero/absent (Req 4.6): the
        // DLL would log "no DXGI hook address found" and never capture. Skip
        // injection and record the disabled-backend reason (Req 5.8).
        log::warn!(
            "[NativeShare] {} hook offsets are not hookable for pid {target_pid} \
             (dxgi.present={:#x}, dxgi.resize={:#x}); skipping injection and falling back to WGC \
             (backend_disabled)",
            backend.as_str(),
            all_offsets.dxgi.present,
            all_offsets.dxgi.resize,
        );
        prep.missing_offsets = true;
        return prep;
    }

    // 6. Run the OBS inject-helper as a SEPARATE child process (no GPL linkage,
    //    Req 11.1, 11.2). The pure safety gate above guarantees we never reach
    //    here for a blocklisted target.
    let outcome = run_inject_helper(strategy, &artifacts, target_pid);
    prep.injection = outcome;
    log::info!(
        "[NativeShare] inject-helper for pid {target_pid} ({:?}) -> {:?}",
        target_bitness,
        outcome
    );

    // 7. On a successful injection, start the IPC reader (publishing ALL backend
    //    offsets into hook_info) and build the hook. The frame interval caps the
    //    DLL's per-present shared-texture copy at the negotiated encode rate, so
    //    a high-fps game does not burn GPU copying frames the encoder will not
    //    use; the host's present-accurate frame-count watch then forwards only
    //    genuinely new captures, so a game running below the rate yields no
    //    duplicate re-encodes. `fps == 0` means "no cap" (interval 0 ⇒ the DLL
    //    captures every present).
    if outcome.is_success() {
        let frame_interval_ns = if fps > 0 {
            1_000_000_000u64 / fps as u64
        } else {
            0
        };
        match ObsIpcChannel::start_with_all_offsets(
            target_pid,
            all_offsets,
            frame_interval_ns,
            crate::game_capture::obs_ipc::DEFAULT_FRAME_WAIT_MS,
        ) {
            Ok(ipc) => {
                prep.hook = Some(GameCaptureHook::new(
                    Arc::clone(d3d),
                    ipc,
                    backend,
                    target_pid,
                ));
            }
            Err(err) => {
                log::warn!(
                    "[NativeShare] OBS IPC channel failed to start for pid {target_pid}: {err}; \
                     falling back to WGC"
                );
                // A successful injection we cannot read from is a failed attempt.
                prep.injection = InjectionOutcome::Failed;
            }
        }
    }

    prep
}

/// A live Game_Capture_Hook capture session: the background thread that pulls
/// hook surfaces and feeds them into the encoder frame channel in place of WGC,
/// plus the stop flag/join handle used to tear it down.
///
/// Non-generic (it stores only a stop flag + `JoinHandle<()>`), so it lives in
/// the non-generic [`NativeShareState`]. Dropping it (on session stop) signals
/// the thread to exit and joins it; the thread runs
/// [`GameCaptureHook::detach`](crate::game_capture::dx11::GameCaptureHook::detach)
/// on the way out, releasing the shared surface + IPC channel (Req 1.6, 7.4),
/// and drops any WGC capture it started on a mid-session fallback.
#[cfg(all(feature = "game-capture-hook", windows))]
pub struct HookCaptureSession {
    stop_flag: Arc<std::sync::atomic::AtomicBool>,
    join: Option<std::thread::JoinHandle<()>>,
}

#[cfg(all(feature = "game-capture-hook", windows))]
impl HookCaptureSession {
    /// Signal the capture thread to stop and join it. Idempotent.
    fn stop(&mut self) {
        self.stop_flag.store(true, Ordering::Relaxed);
        if let Some(handle) = self.join.take() {
            let _ = handle.join();
        }
    }
}

#[cfg(all(feature = "game-capture-hook", windows))]
impl Drop for HookCaptureSession {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Spawn the background hook capture thread and return its [`HookCaptureSession`]
/// handle (task 11.1).
#[cfg(all(feature = "game-capture-hook", windows))]
#[allow(clippy::too_many_arguments)]
fn spawn_hook_capture_session<R: tauri::Runtime>(
    hook: crate::game_capture::dx11::GameCaptureHook,
    d3d: Arc<D3dDevice>,
    source_id: String,
    src_width: u32,
    src_height: u32,
    encode_width: u32,
    encode_height: u32,
    fps: u32,
    frame_tx: mpsc::SyncSender<crate::wgc_capture::CapturedFrame>,
    stats: Arc<NativeShareStats>,
    frame_interval_ns: Arc<std::sync::atomic::AtomicU64>,
    hook_exclusive: bool,
    app: tauri::AppHandle<R>,
) -> HookCaptureSession {
    let stop_flag = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let stop_clone = Arc::clone(&stop_flag);
    let join = std::thread::Builder::new()
        .name("RalphHookCapture".into())
        .spawn(move || {
            run_hook_capture_loop(
                hook,
                d3d,
                source_id,
                src_width,
                src_height,
                encode_width,
                encode_height,
                fps,
                frame_tx,
                stats,
                frame_interval_ns,
                stop_clone,
                hook_exclusive,
                app,
            );
        })
        .ok();
    HookCaptureSession { stop_flag, join }
}

/// Why the hook capture loop ([`run_hook_capture_loop`]) stopped delivering
/// frames — drives whether the share continues, falls back, or ends.
#[cfg(all(feature = "game-capture-hook", windows))]
enum HookLoopOutcome {
    /// The session's stop flag was set (the user stopped the share, or the
    /// session is being torn down). Nothing more to do.
    CleanStop,
    /// The captured source is gone for good — the shared window was closed or
    /// the target process exited. Neither the hook nor WGC can capture a source
    /// that no longer exists, so the share is ENDED (the renderer is signalled
    /// to tear it down) rather than falling back or hanging in
    /// `capture-unavailable`. Carries the reason for stats/diagnostics.
    SourceGone(FallbackReason),
    /// The hook stopped delivering frames while the source is still alive (a
    /// transient stall, an IPC error, or a no-frame watchdog timeout). This is
    /// recoverable: under `wgc-enabled` the session falls back to WGC; under
    /// `hook-exclusive` it transitions to `capture-unavailable`. Carries the
    /// reason.
    FallbackToWgc(FallbackReason),
}

/// The hook capture loop: pull zero-copy hook surfaces, feed the encoder frame
/// channel in place of WGC (Req 7.1), and apply the resolved `Capture_Policy`
/// mid-session on a target exit or a no-frame watchdog timeout without ever
/// terminating the session.
///
/// Retain-at-most-one (Req 7.5) is enforced by waiting for each delivered
/// frame's release token (set by the encoder after its fused-blit read, or on
/// frame drop) before pulling the next surface, so exactly one opened surface is
/// live at a time. A run of no-frame results (or an IPC error, or a detected
/// target exit) past the watchdog deadline detaches the hook and then applies
/// the resolved policy (Req 5.2, 5.3):
///
///   * `wgc-enabled` (`hook_exclusive == false`) — start WGC as the guaranteed
///     fallback, record the reason, and notify the user (the prior behavior).
///   * `hook-exclusive` (`hook_exclusive == true`) — do NOT start WGC; set the
///     capture-unavailable status with the reason, stop delivering frames,
///     retain the resolved policy in stats, and park until stop (Req 5.3).
///
/// Negotiated capture parameters (Req 9.1, 9.3): the loop populates the
/// negotiated width/height/fps in `NativeShareStats` from the first forwarded
/// hook surface's dimensions (the size the encoder receives) and the session
/// `fps`, and re-publishes them whenever a later surface arrives at different
/// dimensions (a swapchain resize/renegotiation, Req 10.6) so the reported
/// parameters update no later than the next stats read. Until the first surface
/// resolves, the not-yet-negotiated sentinel cleared at session start stands
/// (Req 9.4).
///
/// This is GPU/IPC-bound host wiring; the real injection/IPC/zero-copy behavior
/// is validated by the manual integration tests (task 11.4). The control flow
/// (watchdog → detach → policy branch → park until stop) is what those tests
/// exercise on hardware.
#[cfg(all(feature = "game-capture-hook", windows))]
#[allow(clippy::too_many_arguments)]
fn run_hook_capture_loop<R: tauri::Runtime>(
    mut hook: crate::game_capture::dx11::GameCaptureHook,
    d3d: Arc<D3dDevice>,
    source_id: String,
    src_width: u32,
    src_height: u32,
    encode_width: u32,
    encode_height: u32,
    fps: u32,
    frame_tx: mpsc::SyncSender<crate::wgc_capture::CapturedFrame>,
    stats: Arc<NativeShareStats>,
    frame_interval_ns: Arc<std::sync::atomic::AtomicU64>,
    stop_flag: Arc<std::sync::atomic::AtomicBool>,
    hook_exclusive: bool,
    app: tauri::AppHandle<R>,
) {
    use std::sync::atomic::Ordering as AtomicOrdering;
    use std::time::{Duration, Instant};

    /// Encoder-stall watchdog: how long to wait for the encoder to RELEASE a
    /// delivered frame's shared surface before concluding the **encoder** (not
    /// the hook) is wedged and falling back. This guards only the
    /// retain-at-most-one release wait — a frame was captured and handed off,
    /// but the encoder never finished with it. Generous, because a brief encoder
    /// hitch (GPU contention, a quality reconfigure) is recoverable and should
    /// not tear down the session.
    const ENCODER_STALL_TIMEOUT: Duration = Duration::from_secs(5);
    /// Initial-hook watchdog: how long to wait for the FIRST frame after
    /// `Initialize` before concluding the hook never installed (dead/foreign-
    /// blocked) and falling back. Once any frame has arrived, present stalls are
    /// treated as transient (loading screens, alt-tab, paused game, swapchain
    /// recreation) and never tear the hook down while the source is alive —
    /// source/process death is detected explicitly at the loop top instead.
    const FIRST_FRAME_TIMEOUT: Duration = Duration::from_secs(8);
    /// Poll interval while waiting for the encoder to release a delivered frame.
    const RELEASE_POLL: Duration = Duration::from_millis(2);

    // Defensive COM init: the mid-session WGC fallback below re-creates a WGC
    // capture item (a WinRT activation) on this thread. Harmless if COM is
    // already initialised (RPC_E_CHANGED_MODE is ignored). The actual
    // mid-session WGC restart is validated by the hardware-gated integration
    // tests (task 11.4).
    unsafe {
        use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }

    // Target interval for the periodic hook-stats log entry (Req 6.5, 10.4).
    const STATS_LOG_INTERVAL: Duration = Duration::from_millis(1000);

    // Cumulative delivery counters for the periodic stats log (Req 6.5):
    // `frames_received` counts surfaces pulled from the hook, `frames_forwarded`
    // counts surfaces handed to the encoder channel.
    let mut frames_received: u64 = 0;
    let mut frames_forwarded: u64 = 0;
    let mut last_stats_log = Instant::now();
    // Backend / pid are fixed for the session; snapshot them once so the
    // periodic log can read them without re-borrowing `hook` (which is borrowed
    // mutably by `next_captured_frame` inside the loop).
    let hook_pid = hook.target_pid();
    let hook_backend = hook.backend();
    // The truthful active backend the DLL actually hooked (Vulkan/DXGI/D3D9/…),
    // read live from `hook_info.hooked_api`. Starts as the host's module-based
    // guess and is corrected to the real API the moment the DLL reports it (so
    // a Vulkan game mis-guessed as dx11 is relabeled). Tracked here so the
    // periodic stats log shows the real backend and `set_active_backend_hooked`
    // updates `Capture_Status` once.
    let mut reported_hooked_api = crate::game_capture::obs_ipc::HookedApi::None;
    // The capture-rate cap last pushed into the live `hook_info.frame_interval`.
    // A live quality switch updates the shared `frame_interval_ns` atomic; when
    // it differs from this we write it into the DLL mapping so the DLL's
    // shtex-copy rate follows the new fps (e.g. 30→60) without re-injection.
    // Seeded so the first loop iteration syncs the session's initial interval.
    let mut applied_frame_interval_ns: u64 = u64::MAX;

    // Emit the periodic stats entry when the cadence has elapsed (Req 6.5,
    // 10.4). Invoked both at the top of the outer loop and inside the
    // release-wait below so that a long encoder wait (up to NO_FRAME_TIMEOUT)
    // never leaves more than ~2000ms between consecutive entries. Kept DRY as a
    // local macro because it must borrow the loop-local counters by value.
    macro_rules! maybe_log_hook_stats {
        () => {
            if last_stats_log.elapsed() >= STATS_LOG_INTERVAL {
                // Surface per-frame GPU + encode timing (EWMA, ns→µs) alongside
                // the delivery counts so the capture overhead is profilable from
                // logs alone: `gpu_us` is the fused VideoProcessorBlt
                // (BGRA→NV12 + scale) cost on the shared D3D device (this is the
                // work that competes with the game's GPU), `enc_us` is the MFT
                // ProcessInput submit cost. A spike in `gpu_us` points at the VP
                // normalize-copy path; high `enc_us` points at the encoder.
                let gpu_us = stats.fused_gpu_ns_ewma.load(AtomicOrdering::Relaxed) / 1000;
                let enc_us = stats.encode_submit_ns_ewma.load(AtomicOrdering::Relaxed) / 1000;
                let dropped = stats.dropped_frames.load(AtomicOrdering::Relaxed);
                let backend_label = if reported_hooked_api.is_hooked() {
                    reported_hooked_api.as_str()
                } else {
                    hook_backend.as_str()
                };
                log::info!(
                    "[NativeShare] hook stats (pid {}, backend {}): received={}, forwarded={}, \
                     dropped={}, gpu_us={}, enc_us={}",
                    hook_pid,
                    backend_label,
                    frames_received,
                    frames_forwarded,
                    dropped,
                    gpu_us,
                    enc_us
                );
                last_stats_log = Instant::now();
            }
        };
    }

    let mut last_progress = Instant::now();
    // Present-accurate delivery: the IPC channel returns `Some` exactly once per
    // genuinely-new captured present (it watches the DLL's per-present
    // `hook_info.frame_count`), and `None` otherwise. So the loop simply
    // forwards whatever the channel yields — the cadence is the game's true
    // present rate, capped at the negotiated encode rate by the DLL's
    // `frame_interval`. No wall-clock pacer: we never re-encode a duplicate of a
    // frame the game did not actually present, and we never sleep past a real
    // new frame. A short idle sleep on `None` keeps the poll from busy-spinning.
    /// Idle poll interval when no new present is available this round.
    const IDLE_POLL: Duration = Duration::from_millis(1);
    // Last negotiated capture dimensions published to `NativeShareStats`
    // (Req 9.1, 9.3). `None` until the first hook surface resolves — until then
    // the not-yet-negotiated sentinel cleared at session start stands (Req 9.4).
    // Re-published whenever a later surface arrives at different dimensions (a
    // swapchain resize/renegotiation, Req 10.6) so the reported parameters
    // update no later than the next stats read.
    let mut negotiated_dims: Option<(u32, u32)> = None;
    // The loop yields a `HookLoopOutcome` describing why hook delivery ended:
    // a clean session stop, a recoverable fallback-to-WGC, or a terminal
    // source-gone that should END the whole share (the shared window was closed
    // / the target process exited — neither the hook nor WGC can capture a
    // source that no longer exists, so hanging in `capture-unavailable` or
    // flipping to a dead WGC item is wrong; we stop the share like Discord does).
    let outcome: HookLoopOutcome = loop {
        // Periodic delivery stats on a ~1000ms cadence (Req 6.5, 10.4).
        maybe_log_hook_stats!();

        // Live capture-rate sync: a quality switch updates the shared interval
        // atomic; push any change into the DLL's `hook_info.frame_interval` so
        // its shtex-copy rate follows the new fps (e.g. 30→60) without a
        // re-injection or stream restart. Cheap unsynchronized read; only writes
        // the mapping when the value actually changed.
        let desired_interval = frame_interval_ns.load(AtomicOrdering::Relaxed);
        if desired_interval != applied_frame_interval_ns {
            hook.set_capture_frame_interval(desired_interval);
            applied_frame_interval_ns = desired_interval;
            log::info!(
                "[NativeShare] capture frame_interval updated to {} ns (DLL copy-rate cap follows fps)",
                desired_interval
            );
        }

        if stop_flag.load(AtomicOrdering::Relaxed) {
            break HookLoopOutcome::CleanStop; // clean session stop
        }
        // Source window closed by the user → the share's source is gone for
        // good; end the share (do not fall back to a WGC item that can no longer
        // resolve the window). Detected directly via IsWindow, so we don't wait
        // out the no-frame watchdog or mislabel it as a transient stall.
        if !source_still_live(&source_id) {
            log::info!(
                "[NativeShare] shared source {} closed (window destroyed); ending screen share",
                source_id
            );
            break HookLoopOutcome::SourceGone(FallbackReason::TargetExited);
        }
        // Target process exited → the source is gone; end the share (Req 9.3 said
        // fall back to WGC, but a window whose owning process exited cannot be
        // WGC-captured either — the correct production behavior is to stop).
        if hook.target_exited() {
            log::info!(
                "[NativeShare] target process for source {} exited; ending screen share",
                source_id
            );
            break HookLoopOutcome::SourceGone(FallbackReason::TargetExited);
        }

        match hook.next_captured_frame(encode_width, encode_height) {
            Ok(Some(frame)) => {
                frames_received += 1;
                last_progress = Instant::now();
                // Correct the reported backend to the API the DLL actually
                // hooked (truthful, no module guessing). Cheap volatile read;
                // only act when it first becomes known or changes.
                let live_api = hook.hooked_api();
                if live_api != reported_hooked_api && live_api.is_hooked() {
                    reported_hooked_api = live_api;
                    stats.set_active_backend_hooked(live_api, hook_backend);
                    log::info!(
                        "[NativeShare] active backend resolved from hook: {} (host module guess was {})",
                        live_api.as_str(),
                        hook_backend.as_str(),
                    );
                }
                // Publish the negotiated capture parameters (Req 9.1, 9.3) from
                // the dimensions the encoder will receive (capped to the encode
                // size in `from_hook_surface`). On the first surface this
                // replaces the not-yet-negotiated sentinel (Req 9.4); on a later
                // surface whose dimensions changed (a swapchain resize /
                // renegotiation, Req 10.6) it re-publishes so the reported
                // parameters update no later than the next stats read.
                let frame_dims = (frame.width, frame.height);
                if negotiated_dims != Some(frame_dims) {
                    stats.set_negotiated_params(frame_dims.0, frame_dims.1, f64::from(fps));
                    negotiated_dims = Some(frame_dims);
                }
                let release = Arc::clone(&frame.release);
                if frame_tx.try_send(frame).is_ok() {
                    frames_forwarded += 1;
                } else {
                    // Encoder channel full or closed — the returned frame is
                    // dropped here, which sets `release` (Req 7.5 never blocks
                    // the hook's surface supply). Count the drop.
                    stats.dropped_frames.fetch_add(1, AtomicOrdering::Relaxed);
                }
                // Retain-at-most-one (Req 7.5): do NOT open the next surface
                // until the encoder has finished reading this one (its release
                // token fires after the fused blit, or immediately on the drop
                // above). The encoder must keep up; if its release never fires
                // within the watchdog window the ENCODER (not the hook) has
                // genuinely stalled — fall back rather than loop (which would
                // open a second surface and break retain-at-most-one).
                let mut stalled = false;
                while !release.load(AtomicOrdering::Acquire) {
                    if stop_flag.load(AtomicOrdering::Relaxed) {
                        break;
                    }
                    if last_progress.elapsed() > ENCODER_STALL_TIMEOUT {
                        stalled = true;
                        break;
                    }
                    // Keep the stats cadence alive during a long release wait so
                    // the gap between entries stays under 2000ms (Req 6.5).
                    maybe_log_hook_stats!();
                    std::thread::sleep(RELEASE_POLL);
                }
                if stalled {
                    log::warn!(
                        "[NativeShare] encoder did not release a frame within {}s — encoder \
                         stalled; falling back",
                        ENCODER_STALL_TIMEOUT.as_secs()
                    );
                    break HookLoopOutcome::FallbackToWgc(FallbackReason::HookStoppedMidSession);
                }
                // No wall-clock pacing: `next_captured_frame` already gates on
                // the DLL's per-present counter, so the next pull blocks (via
                // the channel's poll) until the game actually presents a new
                // frame. Loop straight back to pull the next genuine present.
            }
            Ok(None) => {
                // No new present this round. This is NORMAL and expected for
                // long stretches: a game between presents, a loading screen, a
                // paused/minimized game, an alt-tab, or a swapchain recreation
                // (resolution/format change) all stop presents for seconds at a
                // time. The DLL keeps its present interception installed across
                // all of these (a Vulkan swapchain recreate re-inits via
                // OBS_CreateSwapchainKHR), so `frame_count` simply resumes
                // advancing when the game presents again — and we deliver again.
                //
                // Therefore, once the hook has delivered at least one frame, a
                // present stall is NOT a hook failure as long as the source
                // window and target process are still alive (both checked at the
                // loop top, which END the share when they genuinely go away). We
                // do NOT tear the hook down here — doing so was the
                // "hook died at the loading screen" bug: a few seconds of no
                // presents permanently flipped the session to capture-unavailable
                // even though the game was about to resume. We just idle and keep
                // waiting; delivery resumes the instant the game presents.
                //
                // The ONLY watchdog that still fires is the INITIAL one: until
                // the first frame ever arrives, a bounded wait distinguishes a
                // genuinely dead/never-installing hook (→ fall back) from one
                // still settling. After that, source-liveness is the authority.
                if frames_received == 0 && last_progress.elapsed() > FIRST_FRAME_TIMEOUT {
                    log::warn!(
                        "[NativeShare] no first frame within {}s of Initialize — hook never \
                         delivered; falling back",
                        FIRST_FRAME_TIMEOUT.as_secs()
                    );
                    break HookLoopOutcome::FallbackToWgc(FallbackReason::HookStoppedMidSession);
                }
                std::thread::sleep(IDLE_POLL);
            }
            Err(err) => {
                log::warn!("[NativeShare] hook capture error: {err}; falling back to WGC");
                break HookLoopOutcome::FallbackToWgc(FallbackReason::HookStoppedMidSession);
            }
        }
    };

    // Tear the hook down (release the shared surface + stop the IPC channel)
    // before either returning or starting the WGC fallback (Req 1.6, 7.4).
    hook.detach();

    let reason = match outcome {
        HookLoopOutcome::CleanStop => {
            // Clean stop — the session is being torn down; nothing more to do.
            return;
        }
        HookLoopOutcome::SourceGone(reason) => {
            // The shared window was closed / the target process exited. The
            // source no longer exists, so neither the hook nor WGC can capture
            // it — end the share entirely (the production-correct behavior,
            // matching Discord) instead of hanging in `capture-unavailable` or
            // flipping to a dead WGC item. Signal the frontend to tear the share
            // down via a dedicated event; the session's frames simply stop.
            log::info!(
                "[NativeShare] source gone (reason={}, frames_received={}, frames_forwarded={}); \
                 ending native screen share",
                reason.as_str(),
                frames_received,
                frames_forwarded,
            );
            stats.set_capture_unavailable(false);
            stats.set_fallback_reason(reason);
            stats.clear_negotiated_params();
            // Tell the renderer the share ended because its source went away, so
            // it stops the share (drops tracks, clears UI) rather than showing a
            // stuck "unavailable" tile. Carries the reason for logging/UX.
            let _ = app.emit(
                "native-screen-share-ended",
                format!("source-closed: {}", reason.as_str()),
            );
            // Park until the renderer's stop tears the session down (it calls
            // stop_native_screen_share, which flips the stop flag). No frame
            // source runs in the meantime.
            while !stop_flag.load(AtomicOrdering::Relaxed) {
                std::thread::sleep(Duration::from_millis(100));
            }
            return;
        }
        HookLoopOutcome::FallbackToWgc(reason) => reason,
    };

    // Mid-session the resolved `Capture_Policy` decides what happens when the
    // hook stops delivering frames (Req 5.2, 5.3). Derive the last completed
    // handshake step from the delivery counters for diagnostics (Req 6.6): a
    // forwarded frame implies the full path
    // (offsets → Initialize → HookReady → shtex → forward) completed at least
    // once; a received-but-not-forwarded frame implies the shtex surface
    // resolved but the encoder channel rejected it; zero received implies the
    // handshake completed (Initialize signaled) but no HookReady/shtex ever
    // resolved before the watchdog tripped.
    let last_handshake_step = if frames_forwarded > 0 {
        "frame_forwarded_to_encoder"
    } else if frames_received > 0 {
        "shtex_resolved"
    } else {
        "initialize_signaled_no_hookready"
    };

    if hook_exclusive {
        // ── hook-exclusive (Req 5.3) ─────────────────────────────────────
        // Do NOT start WGC. Transition to capture-unavailable, record the
        // reason, stop delivering frames, and retain the resolved policy in
        // stats. The negotiated parameters are reset to the not-yet-negotiated
        // sentinel since no capture is running (Req 9.4). The peer connection
        // and encoder stay up; the session simply produces no further video
        // until it is stopped.
        log::warn!(
            "[NativeShare] zero-copy hook stopped mid-session (reason={}, last_handshake_step={}, \
             frames_received={}, frames_forwarded={}); hook-exclusive policy — capture is now \
             unavailable (no WGC fallback)",
            reason.as_str(),
            last_handshake_step,
            frames_received,
            frames_forwarded,
        );
        // Keep the active mode/backend as the hook's (it was the resolved mode);
        // the capture-unavailable flag + reason convey that no frames flow.
        stats.set_capture_unavailable(true);
        stats.set_fallback_reason(reason);
        stats.clear_negotiated_params();
        let _ = app.emit(
            "native-screen-share-status",
            format!(
                "capture-unavailable: zero-copy game-capture hook stopped ({}); \
                 capture is unavailable under the hook-exclusive policy (no WGC fallback)",
                reason.as_str()
            ),
        );

        // Park until the session stops — no frame source runs (Req 5.3).
        while !stop_flag.load(AtomicOrdering::Relaxed) {
            std::thread::sleep(Duration::from_millis(100));
        }
        return;
    }

    // ── wgc-enabled (Req 5.2) ────────────────────────────────────────────
    // Fall back to the guaranteed WGC path — continue the session, record the
    // reason, and notify the user (Req 8.4, 8.5, 14.4).
    log::warn!(
        "[NativeShare] zero-copy hook stopped mid-session (reason={}, last_handshake_step={}, \
         frames_received={}, frames_forwarded={}); continuing on WGC",
        reason.as_str(),
        last_handshake_step,
        frames_received,
        frames_forwarded,
    );
    stats.set_capture_mode(CaptureMode::Wgc);
    stats.set_active_backend(None);
    stats.set_fallback_reason(reason);
    // The negotiated parameters are re-published by the WGC capture path as it
    // delivers frames; reset to the not-yet-negotiated sentinel until WGC
    // negotiates (Req 9.4) so a stale hook resolution is not reported as the
    // WGC negotiated size.
    stats.clear_negotiated_params();
    let _ = app.emit(
        "native-screen-share-status",
        format!(
            "hook-unavailable: zero-copy game-capture hook stopped ({}); continuing screen share on WGC",
            reason.as_str()
        ),
    );

    // Start WGC as the live frame source and hold it for the rest of the
    // session. WGC captures at the native size; the encoder's video processor
    // scales to the encode dimensions, exactly as the up-front WGC path does.
    // Publish the WGC negotiated parameters (native source size + session fps,
    // Req 9.1) so the stats report a negotiated resolution on the fallback path.
    let wgc = match resolve_wgc_item(&source_id).and_then(|item| {
        crate::wgc_capture::start_wgc_capture(
            item,
            &d3d,
            src_width,
            src_height,
            frame_tx,
            Arc::clone(&stats),
        )
    }) {
        Ok(capture) => {
            stats.set_negotiated_params(encode_width, encode_height, f64::from(fps));
            Some(capture)
        }
        Err(err) => {
            log::error!("[NativeShare] mid-session WGC fallback failed to start: {err}");
            None
        }
    };

    // Park until the session stops, keeping the WGC capture alive. Also end the
    // share if the source window is closed while on the WGC fallback — a closed
    // window cannot be WGC-captured either, so stop rather than stream nothing.
    while !stop_flag.load(AtomicOrdering::Relaxed) {
        if !source_still_live(&source_id) {
            log::info!(
                "[NativeShare] shared source {} closed while on WGC fallback; ending screen share",
                source_id
            );
            stats.set_fallback_reason(FallbackReason::TargetExited);
            stats.clear_negotiated_params();
            let _ = app.emit(
                "native-screen-share-ended",
                "source-closed: target_exited".to_string(),
            );
            break;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    drop(wgc);
}

// ── start_native_screen_share ──────────────────────────────────────────────

/// Resolved encode parameters for a given quality preset.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct QualityParams {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub bitrate: u32,
}

/// Map a quality preset string (e.g. `"1080p30"`) to encode width/height/fps/
/// bitrate, capping the dimensions to the native source size (no upscaling).
/// Single source of truth shared by session start and the live quality switch
/// so both paths resolve identical parameters.
pub fn parse_quality_params(quality: &str, src_width: u32, src_height: u32) -> QualityParams {
    let fps: u32 = if quality.ends_with("60") { 60 } else { 30 };
    let (w, h, bitrate): (u32, u32, u32) = match quality {
        "480p30" | "480p60" => (854, 480, 2_000_000),
        "720p30" => (1280, 720, 4_000_000),
        "720p60" => (1280, 720, 6_000_000),
        "1080p30" => (1920, 1080, 8_000_000),
        "1080p60" => (1920, 1080, 12_000_000),
        "1440p30" => (2560, 1440, 16_000_000),
        "1440p60" => (2560, 1440, 24_000_000),
        "4k30" => (3840, 2160, 28_000_000),
        "4k60" => (3840, 2160, 45_000_000),
        _ => (1920, 1080, 8_000_000),
    };
    QualityParams {
        width: w.min(src_width),
        height: h.min(src_height),
        fps,
        bitrate,
    }
}

#[tauri::command]
pub async fn start_native_screen_share<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, NativeShareState>,
    source_id: String,
    source_name: Option<String>,
    quality: Option<String>,
    track_name: Option<String>,
    audio_track_name: Option<String>,
    with_audio: Option<bool>,
    ice_servers: Option<Vec<NativeIceServer>>,
) -> Result<SdpOfferPayload, String> {
    let _ = source_name; // not needed with WGC (HWND / monitor index is sufficient)

    // 1. Resolve capture item synchronously (WGC item creation is not async).
    let wgc_item = resolve_wgc_item(&source_id)?;

    // Get the item's native size (WGC always captures at the monitor's physical resolution).
    let item_size = wgc_item.Size().map_err(|e| e.to_string())?;
    let src_width = even_dimension(item_size.Width as u32);
    let src_height = even_dimension(item_size.Height as u32);

    // 2. Select codec — prefer H.264, fall back to HEVC (not currently used but wired).
    let codec = VideoCodec::H264;

    // 3. Parse quality → fps + target encode resolution + bitrate.
    //    WGC captures at native resolution; the D3D11 Video Processor scales to the target.
    let quality = quality.unwrap_or_else(|| "720p30".to_string());
    let params = parse_quality_params(&quality, src_width, src_height);
    let fps = params.fps;
    let encode_width = params.width;
    let encode_height = params.height;
    let bitrate = params.bitrate;
    log::info!(
        "[NativeShare] source={}x{}  target={}x{}  fps={}  bitrate={}",
        src_width, src_height, encode_width, encode_height, fps, bitrate
    );

    // 4. Create shared D3D11 device.
    let d3d = D3dDevice::new().map_err(|e| format!("Create D3D11 device: {e}"))?;

    // 5. Reset stats.
    let stats = Arc::clone(&state.stats);
    stats.captured_frames.store(0, Ordering::Relaxed);
    stats.encoded_frames.store(0, Ordering::Relaxed);
    stats.encode_errors.store(0, Ordering::Relaxed);
    stats.samples_written.store(0, Ordering::Relaxed);
    stats.audio_samples_written.store(0, Ordering::Relaxed);
    stats.write_errors.store(0, Ordering::Relaxed);
    stats.dropped_frames.store(0, Ordering::Relaxed);
    // New per-frame timing fields (Req 9.1, 9.2) — reset alongside the counters.
    stats.last_fused_gpu_ns.store(0, Ordering::Relaxed);
    stats.last_encode_submit_ns.store(0, Ordering::Relaxed);
    stats.fused_gpu_ns_ewma.store(0, Ordering::Relaxed);
    stats.encode_submit_ns_ewma.store(0, Ordering::Relaxed);
    // Capture mode (Req 6.5, 7.3, 9.4) — default to the `wgc` fallback at
    // session start; task 7.3 overrides it via `set_capture_mode` once the
    // capture-mode selection resolves (e.g. a successful DX11 hook attach).
    stats
        .capture_mode
        .store(CAPTURE_MODE_WGC, Ordering::Relaxed);
    // Active backend (Req 7.2, 14.2), encoder backend (Req 6.5, 14.3), and
    // fallback reason (Req 8.5, 14.4) — reset to their session-start defaults
    // (no backend / software / none). Task 11.1 overrides these via the
    // `set_active_backend` / `set_encoder_backend` / `set_fallback_reason`
    // setters once selection and encoder enumeration resolve.
    stats
        .active_backend
        .store(ACTIVE_BACKEND_NA, Ordering::Relaxed);
    stats
        .encoder_backend
        .store(ENCODER_BACKEND_SOFTWARE, Ordering::Relaxed);
    stats
        .fallback_reason
        .store(FALLBACK_REASON_NONE, Ordering::Relaxed);
    // Capture-unavailable (Req 5.3, 8.2) and foreign-hook (Req 3.4) flags, and
    // the negotiated capture parameters (Req 9.4) — reset to their clean
    // session-start state so a prior session's status never leaks into this one.
    // The capture-unavailable flag is set below only on the hook-exclusive
    // capture-unavailable path; the foreign-hook flag is set by the probe.
    stats.set_capture_unavailable(false);
    stats.set_foreign_hook(false);
    stats.clear_negotiated_params();

    // ── Resolve the session Capture_Policy (Req 5.1, 5.5) ────────────────
    // Runtime setting (RALPH_CAPTURE_POLICY, set by the dev script) wins over
    // the build-feature default; absent both, the documented `wgc-enabled`
    // default applies. Recorded in stats so `Capture_Status` reports it (Req
    // 5.5), and consumed by `apply_capture_policy` below to decide what happens
    // when the hook is not the selected mode for a hook-eligible window source.
    let policy = resolve_capture_policy(runtime_capture_policy(), feature_default_capture_policy());
    stats.set_capture_policy(policy == CapturePolicy::HookExclusive);
    log::info!(
        "[NativeShare] resolved capture policy: {} (runtime={:?})",
        policy.as_str(),
        runtime_capture_policy(),
    );

    // ── Capture-mode + safety-gate selection (Req 7/8/9/10/13) ───────────
    // WGC is the guaranteed, proven path (Req 8.1) and stays the default frame
    // source. The zero-copy hook is additive and opt-in: it is only built behind
    // the `game-capture-hook` feature and only attempted when
    // `RALPH_GAME_CAPTURE_HOOK` is set (`hook_feature_enabled`). The whole
    // decision is made by the pure `select_capture_mode_v2` from plain values, so
    // a monitor source, non-Windows, a disabled hook/backend, a missing artifact,
    // a blocklisted/denied target, a failed injection, or a cross-adapter target
    // all resolve to `wgc` (Req 8.2, 8.3, 10.2, 13.2).
    let source_kind = source_kind_from_id(&source_id);
    // Detect the target's real graphics API so the reported Graphics_API_Backend
    // is truthful (Req 7.2, 14.2). DX11 and DX12 both present through the DXGI
    // swapchain and share the injected hook's interception path, so either is a
    // valid active backend; the detection only decides the *label*. A window
    // source whose API cannot be resolved (monitor source, access denied, or no
    // known runtime loaded) defaults to DX11 — the historical assumption — which
    // is also captured through the same DXGI hook. Vulkan/OpenGL resolve their
    // real label but remain gated off (not active-capable) and fall back to WGC.
    let backend = detect_target_backend(&source_id, source_kind);
    let gate = BackendGate::dxgi(); // DX11 + DX12 share the DXGI present hook (Req 3.1).
    log::info!(
        "[NativeShare] detected target graphics backend: {} (source_kind={:?})",
        backend.as_str(),
        source_kind,
    );
    let hook_enabled = hook_feature_enabled();
    let is_windows = cfg!(windows); // Req 13.2.

    // ── Foreign-hook detection (Req 3.4) ─────────────────────────────────
    // Before installing our own present interception, run the read-only
    // `foreign_obs_hook_present` probe for a hook-eligible window source: a
    // stock OBS install hooking the SAME target publishes its `CaptureHook_*`
    // objects (disjoint from our Private_Namespace), which the probe detects by
    // opening — never creating/signaling — them (Req 3.3). The condition is
    // recorded in `Capture_Status` (`foreign_hook = true`); the session does
    // not terminate the target (Req 3.5) — it proceeds to selection + policy
    // below, where a hook that cannot be installed safely degrades per policy.
    #[cfg(all(feature = "game-capture-hook", windows))]
    let foreign_hook_present = {
        if hook_enabled && source_kind == SourceKind::Window {
            let present = window_hwnd_from_id(&source_id)
                .and_then(window_pid_from_hwnd)
                .map(crate::game_capture::obs_ipc::foreign_obs_hook_present)
                .unwrap_or(false);
            if present {
                log::warn!(
                    "[NativeShare] Foreign_Hook detected: another OBS-derived game-capture hook \
                     (CaptureHook_* objects) is ALREADY injected into the target process. This is \
                     almost always Discord (Go Live / Stream / overlay) or OBS Studio with a Game \
                     Capture source on the same window — both ship the OBS graphics-hook under \
                     C:\\ProgramData\\obs-studio-hook\\. Two graphics hooks Detours-patching the \
                     same IDXGISwapChain::Present conflict, which typically prevents our hook from \
                     ever delivering a frame (the 'initialize_signaled_no_hookready' / 0-frame \
                     symptom). To use the zero-copy hook, CLOSE the other capturer (stop Discord \
                     Go Live/streaming and disable its overlay for this game, and/or stop OBS's \
                     Game Capture), then re-share. Proceeding with the attempt and degrading per \
                     policy without terminating the target (Req 3.4, 3.5)."
                );
            }
            present
        } else {
            false
        }
    };
    #[cfg(not(all(feature = "game-capture-hook", windows)))]
    let foreign_hook_present = false;
    stats.set_foreign_hook(foreign_hook_present);

    // Run the injection preparation (feature- + Windows-gated). On the
    // feature-off / non-Windows build there is no hook and these are the
    // NotAttempted defaults, so the selection below resolves to `wgc` and the
    // session is pure WGC (Req 12.5, 13.2).
    #[cfg(all(feature = "game-capture-hook", windows))]
    let (
        artifact_available,
        safety,
        injection_outcome,
        same_adapter,
        missing_offsets,
        mut prepared_hook,
    ) = {
        let prep = prepare_hook(
            &d3d,
            &source_id,
            source_kind,
            backend,
            gate,
            hook_enabled,
            foreign_hook_present,
            fps,
        );
        (
            prep.artifact_available,
            prep.safety,
            prep.injection,
            prep.same_adapter,
            prep.missing_offsets,
            prep.hook,
        )
    };
    #[cfg(not(all(feature = "game-capture-hook", windows)))]
    let (artifact_available, safety, injection_outcome, same_adapter, missing_offsets) = (
        false,
        SafetyDecision::Allow,
        InjectionOutcome::NotAttempted,
        true,
        false,
    );

    let selection = SelectionInputs {
        is_windows,
        source_kind,
        backend,
        gate,
        hook_enabled,
        artifact_available,
        safety,
        injection: injection_outcome,
        same_adapter,
    };

    // Resolve the active Capture_Mode + fallback reason from the pure selection
    // and record them in stats (Req 7.2, 8.5, 14.1, 14.2, 14.4). `hook` is only
    // chosen when every gate passes; the active backend is reported only while
    // the hook is active.
    let capture_mode = select_capture_mode_v2(&selection);
    let mut reason = fallback_reason(&selection);
    // When injection was skipped because the target backend's present offset was
    // zero/absent (Req 4.6), the pure selection sees `injection = NotAttempted`
    // and would report `InjectionFailed`. Override it to the more precise
    // `BackendDisabled` (Req 5.8) — the backend cannot hook with no offsets.
    // Only meaningful when the resolved mode is WGC (it always is in this case,
    // since a skipped injection can never be a hook success).
    if missing_offsets && capture_mode != CaptureMode::Hook {
        reason = FallbackReason::BackendDisabled;
    }
    stats.set_capture_mode(capture_mode);
    stats.set_active_backend(if capture_mode == CaptureMode::Hook {
        Some(backend)
    } else {
        None
    });
    stats.set_fallback_reason(reason);

    // ── Apply the resolved Capture_Policy (Req 4.2, 4.5, 5.2, 5.3, 5.4) ──
    // The pure `apply_capture_policy` wraps the selection above: `Hook` stays
    // `Hook` (never WGC, Req 4.2); a monitor source is always `Wgc` (Req 4.5,
    // 5.4); a hook-eligible window whose pure mode is `Wgc` becomes `Wgc` under
    // `wgc-enabled` (fall back, Req 5.2) or `Unavailable` under `hook-exclusive`
    // (no WGC, capture-unavailable, Req 5.3). The carried reason equals
    // `fallback_reason(&selection)`; we keep the local `reason` (with the
    // `missing_offsets` → `BackendDisabled` refinement) as the reported reason,
    // and use the resolution only to route Hook/Wgc/Unavailable.
    let resolution = apply_capture_policy(&selection, policy);
    let capture_unavailable = matches!(resolution, CaptureResolution::Unavailable { .. });
    stats.set_capture_unavailable(capture_unavailable);
    log::info!(
        "[NativeShare] capture_mode={} reason={} policy={} resolution={} (source_kind={:?}, hook_enabled={}, injection={:?}, foreign_hook={})",
        capture_mode.as_str(),
        reason.as_str(),
        policy.as_str(),
        match resolution {
            CaptureResolution::Hook => "hook",
            CaptureResolution::Wgc { .. } => "wgc",
            CaptureResolution::Unavailable { .. } => "unavailable",
        },
        source_kind,
        hook_enabled,
        injection_outcome,
        foreign_hook_present,
    );

    // Notify the UI of the resolved capture state within 2 seconds of the
    // change, reusing the existing `native-screen-share-status` emit site
    // (Req 5.6). Two distinct cases:
    //
    //   * `hook-exclusive` window source with the hook unavailable
    //     (`CaptureResolution::Unavailable`): report the capture-unavailable
    //     state stating the reason. No WGC is started and no frames are
    //     delivered (Req 5.3) — the message must NOT promise a WGC fallback.
    //   * `wgc-enabled` window source where the user could have expected the
    //     hook but it is unavailable (`should_notify_unavailable`): report the
    //     WGC fallback with the reason (the prior behavior, Req 5.2).
    if capture_unavailable {
        log::warn!(
            "[NativeShare] capture unavailable under hook-exclusive policy ({}); \
             not starting WGC and delivering no frames (Req 5.3)",
            reason.as_str()
        );
        let _ = app.emit(
            "native-screen-share-status",
            format!(
                "capture-unavailable: zero-copy game-capture hook unavailable ({}); \
                 capture is unavailable under the hook-exclusive policy (no WGC fallback)",
                reason.as_str()
            ),
        );
    } else if should_notify_unavailable(&selection) {
        log::warn!(
            "[NativeShare] zero-copy hook unavailable ({}); continuing on WGC fallback",
            reason.as_str()
        );
        let _ = app.emit(
            "native-screen-share-status",
            format!(
                "hook-unavailable: zero-copy game-capture hook unavailable ({}); continuing screen share on WGC",
                reason.as_str()
            ),
        );
    }

    // On the feature build: detach any injected-but-unused hook (e.g. a
    // cross-adapter fallback where injection reported success but the mode is
    // still `wgc`) so we never leave an idle payload running on the WGC path
    // (Req 7.5). When the mode is `hook` the live hook is carried to the frame
    // source step below.
    #[cfg(all(feature = "game-capture-hook", windows))]
    if capture_mode != CaptureMode::Hook {
        if let Some(mut hook) = prepared_hook.take() {
            hook.detach();
        }
    }
    let mut m = MediaEngine::default();
    m.register_default_codecs().map_err(|e| e.to_string())?;
    let mut registry = webrtc::interceptor::registry::Registry::new();
    registry = register_default_interceptors(registry, &mut m).map_err(|e| e.to_string())?;
    let api = APIBuilder::new()
        .with_media_engine(m)
        .with_interceptor_registry(registry)
        .build();

    let mut rtc_ice_servers: Vec<webrtc::ice_transport::ice_server::RTCIceServer> = ice_servers
        .unwrap_or_default()
        .into_iter()
        .filter(|s| !s.urls.is_empty())
        .map(|s| webrtc::ice_transport::ice_server::RTCIceServer {
            urls: s.urls,
            username: s.username.unwrap_or_default(),
            credential: s.credential.unwrap_or_default(),
            credential_type: RTCIceCredentialType::Password,
            ..Default::default()
        })
        .collect();
    if rtc_ice_servers.is_empty() {
        rtc_ice_servers.push(webrtc::ice_transport::ice_server::RTCIceServer {
            urls: vec!["stun:stun.l.google.com:19302".to_owned()],
            ..Default::default()
        });
    }

    let peer_connection = Arc::new(
        api.new_peer_connection(RTCConfiguration {
            ice_servers: rtc_ice_servers,
            ..Default::default()
        })
        .await
        .map_err(|e| e.to_string())?,
    );

    let app_for_pc = app.clone();
    peer_connection.on_peer_connection_state_change(Box::new(move |s| {
        let _ = app_for_pc.emit("native-screen-share-status", format!("pc:{s}"));
        Box::pin(async {})
    }));

    // 7. Create video track.
    let native_track_name = track_name.unwrap_or_else(|| "screen_share".to_owned());
    let video_track = Arc::new(TrackLocalStaticSample::new(
        RTCRtpCodecCapability {
            mime_type: codec.mime_type().to_owned(),
            clock_rate: 90_000,
            sdp_fmtp_line: codec.sdp_fmtp().to_owned(),
            ..Default::default()
        },
        native_track_name,
        "screen".to_owned(),
    ));
    // Add the video track and capture its RTP sender so we can read inbound
    // RTCP (PLI/FIR for on-demand keyframes; later TWCC for adaptive bitrate).
    // The SFU forwards a PLI/FIR when a subscriber needs a fresh keyframe (late
    // join, packet loss, simulcast layer switch); we respond by forcing an IDR.
    let video_rtp_sender = peer_connection
        .add_track(Arc::clone(&video_track) as Arc<dyn TrackLocal + Send + Sync>)
        .await
        .map_err(|e| e.to_string())?;

    // 8. Optional audio track.
    let audio_track = if with_audio.unwrap_or(false) {
        let name = audio_track_name.unwrap_or_else(|| "screen_audio".to_owned());
        let t = Arc::new(TrackLocalStaticSample::new(
            RTCRtpCodecCapability {
                mime_type: "audio/opus".to_owned(),
                clock_rate: 48_000,
                channels: 2,
                sdp_fmtp_line: "minptime=10;useinbandfec=1;stereo=1;sprop-stereo=1;usedtx=0"
                    .to_owned(),
                ..Default::default()
            },
            name,
            "screen".to_owned(),
        ));
        peer_connection
            .add_track(Arc::clone(&t) as Arc<dyn TrackLocal + Send + Sync>)
            .await
            .map_err(|e| e.to_string())?;
        Some(t)
    } else {
        None
    };

    // 9. ICE candidate forwarding.
    let app_clone = app.clone();
    peer_connection.on_ice_candidate(Box::new(
        move |candidate| {
            if let Some(c) = candidate {
                let _ = app_clone.emit("native-ice-candidate", c.to_json().ok());
            }
            Box::pin(async {})
        },
    ));

    // 10. Create SDP offer.
    let offer = peer_connection
        .create_offer(None)
        .await
        .map_err(|e| e.to_string())?;
    let mut gather_complete = peer_connection.gathering_complete_promise().await;
    peer_connection
        .set_local_description(offer.clone())
        .await
        .map_err(|e| e.to_string())?;

    // Wait for ICE gathering, but only up to a short deadline rather than the
    // full gather (which can take several seconds when TURN relay candidates are
    // probed). The host/srflx candidates needed to connect are typically ready
    // within a few hundred ms; any candidates gathered after we return still
    // reach the peer via the `native-ice-candidate` trickle event above, so
    // bounding this wait shaves seconds off go-live with no connectivity loss.
    const ICE_GATHER_BUDGET: std::time::Duration = std::time::Duration::from_millis(700);
    let _ = tokio::time::timeout(ICE_GATHER_BUDGET, gather_complete.recv()).await;

    // 11. Spawn async writer: encoder output → WebRTC track.
    // Use tokio mpsc as the async-friendly bridge; a blocking thread drains the
    // sync SyncReceiver and forwards into the tokio channel.
    let (encoded_tx, encoded_rx) = mpsc::sync_channel::<Vec<u8>>(8);
    let (async_tx, mut async_rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
    // Broadcast channel for the preview loopback PC — taps the same encoded
    // frames the SFU receives without touching the SFU path. Capacity is
    // deliberately large so a slow preview consumer never back-pressures the
    // encoder; stale frames are simply skipped by lagging receivers.
    let (preview_broadcast_tx, _) = broadcast::channel::<Vec<u8>>(64);
    let preview_broadcast_tx_for_bridge = preview_broadcast_tx.clone();
    let writer_track = Arc::clone(&video_track);
    let writer_pc = Arc::clone(&peer_connection);
    let writer_stats = Arc::clone(&stats);
    let writer_fps_fallback = fps.max(1);

    // Blocking bridge thread: drains sync Receiver → async sender + preview broadcast.
    std::thread::Builder::new()
        .name("RalphEncoderBridge".into())
        .spawn(move || {
            while let Ok(data) = encoded_rx.recv() {
                // Fan-out: tap to preview broadcast (non-blocking, ignore if no
                // receivers). Clone is cheap for Vec<u8>; the SFU path is
                // byte-for-byte unchanged.
                let _ = preview_broadcast_tx_for_bridge.send(data.clone());
                if async_tx.send(data).is_err() {
                    break;
                }
            }
        })
        .ok();

    tokio::spawn(async move {
        // The WebRTC sample `duration` is what TrackLocalStaticSample uses to
        // advance the RTP media clock (duration × 90 kHz ticks per sample). It
        // MUST track REAL elapsed time between encoded frames, NOT a fixed fps.
        //
        // The old code stamped every sample with `1000/initial_fps` ms. After a
        // live 30→60 quality switch the encoder emitted 60 frames/s but each was
        // still stamped as 33 ms (30 fps), so the receiver's timestamps advanced
        // at half real-time — it played ~30 fps and buffered the surplus →
        // slow-motion / skipped frames until a viewer reload renegotiated the
        // clock. Measuring the actual wall-clock delta per sample makes the RTP
        // timestamps match real time exactly, so ANY fps (a live switch, a
        // variable frame rate, or a present-accurate game running below target)
        // is paced correctly with no slow-motion and no per-switch reload.
        let mut last_write = std::time::Instant::now();
        let mut first = true;
        // Sanity clamp so a long pause (loading screen) or a startup hiccup does
        // not stamp one absurd duration: cap to [1ms, 250ms]. The fallback for
        // the very first sample is one initial-fps frame time.
        let min_dur = std::time::Duration::from_millis(1);
        let max_dur = std::time::Duration::from_millis(250);
        let first_dur = std::time::Duration::from_millis(1_000 / writer_fps_fallback as u64);
        while let Some(data) = async_rx.recv().await {
            if writer_pc.connection_state() != RTCPeerConnectionState::Connected {
                // Keep the clock base aligned to real time while not sending, so
                // the first sample after (re)connection is not stamped with a
                // huge gap.
                last_write = std::time::Instant::now();
                first = true;
                continue;
            }
            let now = std::time::Instant::now();
            let duration = if first {
                first = false;
                first_dur
            } else {
                (now - last_write).clamp(min_dur, max_dur)
            };
            last_write = now;
            let sample = webrtc::media::Sample {
                data: Bytes::from(data),
                duration,
                ..Default::default()
            };
            match writer_track.write_sample(&sample).await {
                Ok(_) => { writer_stats.samples_written.fetch_add(1, Ordering::Relaxed); }
                Err(_) => { writer_stats.write_errors.fetch_add(1, Ordering::Relaxed); }
            }
        }
    });

    // 12. Start the encoder worker (dedicated OS thread with async MFT pump).
    let encoder_worker = MftEncoderWorker::new(
        codec,
        src_width,
        src_height,
        encode_width,
        encode_height,
        fps,
        bitrate,
        Arc::clone(&d3d),
        encoded_tx,
        Arc::clone(&stats),
    )
    .map_err(|e| format!("Start encoder worker: {e}"))?;

    // Report the encoder backend `Encoder_Selection` resolved for this session
    // (Req 6.5, 14.3). Independent of the capture mode (Req 6.6).
    stats.set_encoder_backend(encoder_worker.selected_backend());

    // ── Inbound RTCP reader: on-demand keyframes (Phase 1, Req 2) ────────────
    // Read RTCP from the video RTP sender. When the SFU forwards a PLI (Picture
    // Loss Indication) or FIR (Full Intra Request) — late join, packet loss, or
    // a simulcast layer switch — force the encoder to emit a keyframe so the
    // affected viewer recovers in ~1 frame instead of waiting for the periodic
    // GOP keyframe. Keyframe requests are debounced to at most one per second so
    // a PLI burst does not spike the bitrate (Req 2.3). The task exits cleanly
    // when the sender's RTCP stream ends (PC closed, Req 2.5).
    {
        use webrtc::rtcp::payload_feedbacks::full_intra_request::FullIntraRequest;
        use webrtc::rtcp::payload_feedbacks::picture_loss_indication::PictureLossIndication;

        let control = encoder_worker.control_handle();
        let rtcp_sender = Arc::clone(&video_rtp_sender);
        const KEYFRAME_DEBOUNCE: std::time::Duration = std::time::Duration::from_secs(1);
        tokio::spawn(async move {
            log::info!("[NativeShare] RTCP keyframe reader started for screen-share video sender");
            let mut last_keyframe = std::time::Instant::now()
                .checked_sub(KEYFRAME_DEBOUNCE)
                .unwrap_or_else(std::time::Instant::now);
            let mut pli_total: u64 = 0;
            let mut forced_total: u64 = 0;
            loop {
                match rtcp_sender.read_rtcp().await {
                    Ok((packets, _attrs)) => {
                        let mut wants_keyframe = false;
                        for pkt in &packets {
                            let any = pkt.as_any();
                            if any.downcast_ref::<PictureLossIndication>().is_some()
                                || any.downcast_ref::<FullIntraRequest>().is_some()
                            {
                                wants_keyframe = true;
                            }
                        }
                        if wants_keyframe {
                            pli_total += 1;
                            if last_keyframe.elapsed() >= KEYFRAME_DEBOUNCE {
                                control.request_keyframe();
                                last_keyframe = std::time::Instant::now();
                                forced_total += 1;
                                log::info!(
                                    "[NativeShare] RTCP PLI/FIR → forced keyframe \
                                     (pli_total={pli_total}, forced_total={forced_total})"
                                );
                            } else {
                                log::debug!(
                                    "[NativeShare] RTCP PLI/FIR debounced \
                                     (pli_total={pli_total}, forced_total={forced_total})"
                                );
                            }
                        }
                    }
                    Err(e) => {
                        log::info!(
                            "[NativeShare] RTCP keyframe reader exiting ({e}); \
                             pli_total={pli_total}, forced_total={forced_total}"
                        );
                        break;
                    }
                }
            }
        });
    }

    // 13. Start the frame source.
    //
    //   * `hook`  — feed `GameCaptureHook` surfaces into the encoder frame
    //               channel IN PLACE OF WGC (Req 7.1). A background capture
    //               thread pulls surfaces (retain-at-most-one, Req 7.5) and
    //               falls back to WGC mid-session on target-exit / no-frame
    //               watchdog without terminating the session (Req 8.3, 9.3).
    //   * `wgc`   — the guaranteed path: WGC captures at the native size and the
    //               encoder's video processor scales to the encode dims.
    //   * capture-unavailable — under `hook-exclusive` with a hook-eligible
    //               window source whose hook is unavailable: start NEITHER the
    //               hook NOR WGC, so no frames are delivered (Req 5.3). The
    //               peer connection and encoder stay up (the status is already
    //               emitted above); the session simply produces no video until
    //               stopped or a mid-session transition occurs.
    //
    // Monitor sources and non-Windows always resolve to `wgc` above, so this
    // branch only ever runs the hook for a window source on Windows (Req 8.2).
    let mut wgc: Option<crate::wgc_capture::WgcCapture> = None;
    #[cfg(all(feature = "game-capture-hook", windows))]
    let mut hook_session: Option<HookCaptureSession> = None;

    #[cfg(all(feature = "game-capture-hook", windows))]
    let start_hook = capture_mode == CaptureMode::Hook && prepared_hook.is_some();
    #[cfg(not(all(feature = "game-capture-hook", windows)))]
    let start_hook = false;

    if start_hook {
        #[cfg(all(feature = "game-capture-hook", windows))]
        {
            let hook = prepared_hook
                .take()
                .expect("start_hook implies a prepared hook is present");
            log::info!("[NativeShare] feeding encoder from the zero-copy hook (in place of WGC)");
            // Seed the shared capture-rate cap with this session's fps so the
            // loop syncs it into the DLL, and so a later live quality switch can
            // raise/lower it. `0` fps means "no cap".
            let initial_interval_ns = if fps > 0 {
                1_000_000_000u64 / fps as u64
            } else {
                0
            };
            state
                .session_frame_interval_ns
                .store(initial_interval_ns, Ordering::Relaxed);
            hook_session = Some(spawn_hook_capture_session(
                hook,
                Arc::clone(&d3d),
                source_id.clone(),
                src_width,
                src_height,
                encode_width,
                encode_height,
                fps,
                encoder_worker.frame_tx.clone(),
                Arc::clone(&stats),
                Arc::clone(&state.session_frame_interval_ns),
                policy == CapturePolicy::HookExclusive,
                app.clone(),
            ));
        }
    } else if capture_unavailable {
        // Hook-exclusive capture-unavailable path (Req 5.3): do NOT start WGC.
        // The session keeps its peer connection + encoder but delivers no
        // frames; the resolved policy is retained in `Capture_Status` and the
        // capture-unavailable status was already emitted above. `wgc` stays
        // `None`, so `state.wgc_capture` records no live capture for the
        // session.
        log::warn!(
            "[NativeShare] hook-exclusive policy with the hook unavailable: not starting WGC; \
             no frames will be delivered for this session (Req 5.3)"
        );
    } else {
        // WGC frame source (the guaranteed fallback). Captures at the NATIVE
        // resolution; the D3D11 VP in the encoder worker scales down to
        // encode_width×encode_height.
        wgc = Some(crate::wgc_capture::start_wgc_capture(
            wgc_item,
            &d3d,
            src_width,
            src_height,
            encoder_worker.frame_tx.clone(),
            Arc::clone(&stats),
        )?);
        // Publish the negotiated capture parameters for the WGC path (Req 9.1):
        // the encoder receives frames cropped to the encode dimensions (WGC
        // crops the native capture to `min(native, encode)` = the encode size
        // since encode is already capped to the native size), and the session
        // `fps` is the negotiated frame rate. Reporting the encode dimensions
        // keeps the negotiated resolution consistent with the hook path, which
        // reports the same encoder-received frame dimensions. This replaces the
        // not-yet-negotiated sentinel cleared at session start (Req 9.4). On the
        // `hook` path above the negotiated parameters stay at the sentinel until
        // the hook delivers its first surface (the capture loop publishes them
        // then, Req 9.3).
        stats.set_negotiated_params(encode_width, encode_height, f64::from(fps));
    }

    // 14. Optional WASAPI audio.
    #[cfg(target_os = "windows")]
    if let Some(track) = audio_track {
        start_wasapi_loopback_audio(
            track,
            Arc::clone(&peer_connection),
            Arc::clone(&state.audio_running),
            Arc::clone(&stats),
        );
    }

    // 15. Store state.
    *state.active_connection.lock().await = Some(Arc::clone(&peer_connection));
    *state.video_track.lock().await = Some(Arc::clone(&video_track));
    // The WGC capture is present unless the hook is the active frame source; on
    // a mid-session hook→WGC fallback the hook capture thread owns its own WGC
    // capture, so this stays `None` for the hook path (Req 8.3).
    *state.wgc_capture.lock().await = wgc;
    *state.encoder_worker.lock().await = Some(encoder_worker);
    // Keep the hook capture session alive for the session when it is the active
    // mode; stopping the session drops it, which signals + joins the hook
    // capture thread and runs `GameCaptureHook::detach` (Req 1.6, 7.4, 7.5).
    // `None` on the WGC fallback path. Feature-/Windows-gated.
    #[cfg(all(feature = "game-capture-hook", windows))]
    {
        *state.game_hook.lock().await = hook_session;
    }
    // Record the native source dims so a live quality switch can cap encode
    // dims without re-resolving the WGC item.
    *state.session_src_dims.lock().await = Some((src_width, src_height));
    // Mark the session active so background watchers exit when it stops.
    state.session_active.store(true, Ordering::Relaxed);
    // Expose the broadcast sender so the preview loopback PC can subscribe.
    *state.preview_broadcast_tx.lock().await = Some(preview_broadcast_tx);

    // Window-liveness watchdog for the pure-WGC window path. The hook path's
    // capture loop already detects a closed source and ends the share; but a
    // window captured directly via WGC (hook ineligible/disabled) has no such
    // loop, so without this a closed window would silently stream nothing. This
    // lightweight task polls `IsWindow` and emits `native-screen-share-ended`
    // when the shared window goes away, so the renderer tears the share down.
    // Monitor sources are skipped (a monitor does not "close"; WGC's own item
    // Closed event covers physical removal). Exits when the session stops
    // (`session_active` cleared by `stop_native_screen_share`) or the window is
    // gone — so it never leaks past the session.
    #[cfg(windows)]
    if !start_hook && source_id.starts_with("window-") {
        let watch_source = source_id.clone();
        let watch_app = app.clone();
        let session_active = Arc::clone(&state.session_active);
        std::thread::Builder::new()
            .name("RalphWgcSourceWatch".into())
            .spawn(move || {
                while session_active.load(Ordering::Relaxed) {
                    std::thread::sleep(std::time::Duration::from_millis(500));
                    if !session_active.load(Ordering::Relaxed) {
                        break; // session stopped normally
                    }
                    if !source_still_live(&watch_source) {
                        log::info!(
                            "[NativeShare] shared window {} closed (WGC path); ending screen share",
                            watch_source
                        );
                        let _ = watch_app.emit(
                            "native-screen-share-ended",
                            "source-closed: target_exited".to_string(),
                        );
                        break;
                    }
                }
            })
            .ok();
    }

    Ok(SdpOfferPayload {
        sdp: offer.sdp,
        r#type: "offer".to_string(),
    })
}

// ── handle_sdp_answer ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn handle_sdp_answer(
    state: tauri::State<'_, NativeShareState>,
    sdp: String,
) -> Result<(), String> {
    let st = state.active_connection.lock().await;
    let pc = st.as_ref().ok_or("No active WebRTC connection")?;

    let mut answer = RTCSessionDescription::default();
    answer.sdp = sdp;
    answer.sdp_type = webrtc::peer_connection::sdp::sdp_type::RTCSdpType::Answer;

    pc.set_remote_description(answer)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ── wait_native_screen_share_connected ────────────────────────────────────

#[tauri::command]
pub async fn wait_native_screen_share_connected(
    state: tauri::State<'_, NativeShareState>,
    timeout_ms: Option<u64>,
) -> Result<String, String> {
    let timeout_ms = timeout_ms.unwrap_or(15_000);
    let deadline =
        std::time::Instant::now() + std::time::Duration::from_millis(timeout_ms);

    loop {
        let pc = {
            let st = state.active_connection.lock().await;
            st.as_ref()
                .cloned()
                .ok_or_else(|| "No active WebRTC connection".to_string())?
        };

        let connection_state = pc.connection_state();
        let samples_written = state.stats.samples_written.load(Ordering::Relaxed);
        let audio_samples_written = state.stats.audio_samples_written.load(Ordering::Relaxed);
        let captured_frames = state.stats.captured_frames.load(Ordering::Relaxed);
        let encoded_frames = state.stats.encoded_frames.load(Ordering::Relaxed);
        let encode_errors = state.stats.encode_errors.load(Ordering::Relaxed);

        match connection_state {
            RTCPeerConnectionState::Connected if samples_written >= 3 => {
                return Ok(format!(
                    "connected;samples_written={samples_written};audio_samples_written={audio_samples_written}"
                ));
            }
            RTCPeerConnectionState::Failed | RTCPeerConnectionState::Closed => {
                return Err(format!(
                    "Native WebRTC connection ended before media could flow: {connection_state}"
                ));
            }
            _ => {}
        }

        if captured_frames >= 30 && encoded_frames == 0 && encode_errors >= 25 {
            return Err(format!(
                "Native hardware video encoder failed; connection={connection_state}, captured_frames={captured_frames}, encoded_frames={encoded_frames}, encode_errors={encode_errors}, samples_written={samples_written}, audio_samples_written={audio_samples_written}, write_errors={}, dropped_frames={}",
                state.stats.write_errors.load(Ordering::Relaxed),
                state.stats.dropped_frames.load(Ordering::Relaxed),
            ));
        }

        if std::time::Instant::now() >= deadline {
            return Err(format!(
                "Timed out waiting for native media; connection={connection_state}, captured_frames={captured_frames}, encoded_frames={encoded_frames}, encode_errors={encode_errors}, samples_written={samples_written}, audio_samples_written={audio_samples_written}, write_errors={}, dropped_frames={}",
                state.stats.write_errors.load(Ordering::Relaxed),
                state.stats.dropped_frames.load(Ordering::Relaxed),
            ));
        }

        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
}

// ── stop_native_screen_share ───────────────────────────────────────────────

#[tauri::command]
pub async fn stop_native_screen_share(
    state: tauri::State<'_, NativeShareState>,
) -> Result<(), String> {
    state.audio_running.store(false, Ordering::Relaxed);
    // Signal background watchers (WGC window-close watchdog) to exit promptly.
    state.session_active.store(false, Ordering::Relaxed);
    // Drop the preview broadcast sender so any loopback receiver sees the
    // channel close and tears down cleanly.
    *state.preview_broadcast_tx.lock().await = None;

    // Stop and drop encoder worker first (signals the encode thread to exit).
    let mut ew = state.encoder_worker.lock().await;
    if let Some(mut worker) = ew.take() {
        worker.stop();
    }

    // Drop WGC session (stops FrameArrived callbacks).
    *state.wgc_capture.lock().await = None;

    // Detach and release the game-capture hook session, if one is active. Taking
    // it here drops the `HookCaptureSession`, whose `Drop`/`stop` signals and
    // joins the hook capture thread; that thread runs `GameCaptureHook::detach`
    // on exit, releasing the shared surface and the IPC channel (Req 1.6, 7.4,
    // 7.5). Feature-/Windows-gated — absent on the WGC-only build.
    #[cfg(all(feature = "game-capture-hook", windows))]
    {
        let mut hook = state.game_hook.lock().await;
        if let Some(mut session) = hook.take() {
            session.stop();
        }
    }

    // Close WebRTC peer connection.
    let mut st = state.active_connection.lock().await;
    if let Some(pc) = st.take() {
        let _ = pc.close().await;
    }

    // Tear down the preview loopback PC if it is still live.
    if let Some(preview) = state.preview_pc.lock().await.take() {
        let _ = preview.close().await;
    }

    *state.video_track.lock().await = None;
    *state.session_src_dims.lock().await = None;
    Ok(())
}

// ── update_native_screen_quality ───────────────────────────────────────────

/// Seamlessly change the encode quality (resolution / fps / bitrate) of the
/// LIVE native screen share **in place** — no re-injection of the game-capture
/// hook, no new WGC session, no WebRTC renegotiation, no peer-connection or
/// track teardown. The running encoder worker rebuilds its GPU VideoProcessor
/// output and resets the MFT output type at the next frame boundary and emits a
/// fresh keyframe at the new resolution, which the existing track carries.
///
/// This is the zero-overhead quality switch: the capture path (hook surface or
/// WGC frame) is untouched — only the downscale target and encoder bitrate
/// move — so there is no extra copy, no recapture, and no dropped session.
///
/// Returns an error if no session/encoder is active (the caller should fall
/// back to a full restart in that case).
#[tauri::command]
pub async fn update_native_screen_quality(
    state: tauri::State<'_, NativeShareState>,
    quality: String,
) -> Result<(), String> {
    let (src_width, src_height) = state
        .session_src_dims
        .lock()
        .await
        .ok_or("No active native screen share to reconfigure")?;

    let params = parse_quality_params(&quality, src_width, src_height);

    let ew = state.encoder_worker.lock().await;
    let worker = ew
        .as_ref()
        .ok_or("No active encoder worker to reconfigure")?;

    worker
        .reconfigure(crate::wmf_encoder::EncoderReconfig {
            width: params.width,
            height: params.height,
            fps: params.fps,
            bitrate: params.bitrate,
        })
        .map_err(|e| format!("encoder reconfigure failed: {e}"))?;

    // Update the DLL's capture-rate cap to match the new fps so the hook copies
    // frames at the new rate (e.g. 30→60). Without this the encoder is
    // reconfigured to 60 but the DLL keeps copying at the injection-time 30, so
    // viewers get the new resolution at the OLD framerate. The hook capture loop
    // observes this atomic and writes it into the live `hook_info.frame_interval`
    // (no-op on the WGC path, which is not rate-capped by the DLL).
    #[cfg(all(feature = "game-capture-hook", windows))]
    {
        let interval_ns = if params.fps > 0 {
            1_000_000_000u64 / params.fps as u64
        } else {
            0
        };
        state
            .session_frame_interval_ns
            .store(interval_ns, Ordering::Relaxed);
    }

    // Publish the new negotiated parameters so the stats/UI reflect the switch.
    state
        .stats
        .set_negotiated_params(params.width, params.height, f64::from(params.fps));

    log::info!(
        "[NativeShare] live quality switch → {} ({}x{} @ {}fps, {} bps)",
        quality, params.width, params.height, params.fps, params.bitrate
    );
    Ok(())
}

/// Return a serializable [`NativeShareStatsSnapshot`] of the current native
/// share session's pipeline stats so the renderer can read internal per-frame
/// timing and counters (Req 9.3, 9.4, 9.5, 10.2).
///
/// `state.stats` is a live `Arc<NativeShareStats>` on the managed state, so the
/// snapshot is always available: during an active session it reflects populated
/// counters + timing + the active `Capture_Mode`; with no session active it
/// reports the zeroed/`wgc` defaults (acceptable per Req 9.3/9.4/9.5). Reading
/// is lock-free — `snapshot()` loads the atomics directly — so this command
/// never contends with the capture/encoder threads.
#[tauri::command]
pub async fn get_native_screen_share_stats(
    state: tauri::State<'_, NativeShareState>,
) -> Result<NativeShareStatsSnapshot, String> {
    Ok(state.stats.snapshot())
}

// ── Preview loopback PeerConnection ────────────────────────────────────────
//
// When a window is shared via the game-capture hook, the local preview tile is
// fed from a second localhost RTCPeerConnection that receives the SAME encoded
// H.264 samples the SFU track already gets — one encoder, two consumers. No
// second WGC capture, no capture border, no extra encode cost.
//
// The three commands below mirror the SFU-side flow:
//   start  → create preview PC + track + offer + writer → return SDP offer
//   answer → set the JS-side SDP answer on the preview PC
//   stop   → tear down the preview PC (also in stop_native_screen_share)

#[tauri::command]
pub async fn start_preview_loopback<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, NativeShareState>,
) -> Result<SdpOfferPayload, String> {
    // Tear down any stale preview PC from a previous resume cycle.
    if let Some(old) = state.preview_pc.lock().await.take() {
        let _ = old.close().await;
    }

    let broadcast_tx = state
        .preview_broadcast_tx
        .lock()
        .await
        .as_ref()
        .cloned()
        .ok_or("No active broadcast channel — is a native share session running?")?;

    // Borrow the encoder control handle so the preview RTCP reader can force
    // keyframes on PLI/FIR (shared with the SFU path).
    let control = {
        let ew = state.encoder_worker.lock().await;
        ew.as_ref()
            .ok_or("No active encoder worker")?
            .control_handle()
    };

    // Build a localhost-only RTCPeerConnection — no STUN/TURN, instant gather.
    // The MediaEngine MUST register codecs (H.264 et al.) and interceptors,
    // exactly like the SFU PC above. With a bare `APIBuilder::new().build()`
    // the offer's m=video section carries zero codecs, so the JS peer's
    // createAnswer fails with "unable to populate media section, RTPSender
    // created with no codecs" and the preview never connects.
    let mut preview_m = MediaEngine::default();
    preview_m
        .register_default_codecs()
        .map_err(|e| e.to_string())?;
    let mut preview_registry = webrtc::interceptor::registry::Registry::new();
    preview_registry = register_default_interceptors(preview_registry, &mut preview_m)
        .map_err(|e| e.to_string())?;
    let api = APIBuilder::new()
        .with_media_engine(preview_m)
        .with_interceptor_registry(preview_registry)
        .build();
    let preview_pc = Arc::new(
        api.new_peer_connection(RTCConfiguration {
            ice_servers: vec![],
            ..Default::default()
        })
        .await
        .map_err(|e| format!("Create preview PC: {e}"))?,
    );

    // Mirror the SFU track parameters (codec, clock rate, fmtp) so Chromium
    // HW-decodes the H.264 bitstream identically.
    let preview_track = Arc::new(TrackLocalStaticSample::new(
        RTCRtpCodecCapability {
            mime_type: "video/h264".to_owned(),
            clock_rate: 90_000,
            ..Default::default()
        },
        "preview_loopback".to_owned(),
        "screen".to_owned(),
    ));
    preview_pc
        .add_track(Arc::clone(&preview_track) as Arc<dyn TrackLocal + Send + Sync>)
        .await
        .map_err(|e| e.to_string())?;

    // ICE candidate forwarding — trickle to JS via Tauri event.
    let app_clone = app.clone();
    preview_pc.on_ice_candidate(Box::new(move |candidate| {
        if let Some(c) = candidate {
            let _ = app_clone.emit("native-preview-ice-candidate", c.to_json().ok());
        }
        Box::pin(async {})
    }));

    // SDP offer (video only — audio is not echoed in the preview).
    let offer = preview_pc
        .create_offer(None)
        .await
        .map_err(|e| e.to_string())?;
    let mut gather_complete = preview_pc.gathering_complete_promise().await;
    preview_pc
        .set_local_description(offer.clone())
        .await
        .map_err(|e| e.to_string())?;

    // Short ICE gather budget (host candidates only, typically <50ms).
    let _ = tokio::time::timeout(
        std::time::Duration::from_millis(200),
        gather_complete.recv(),
    )
    .await;

    // ── Writer: broadcast → preview track ──────────────────────────────────
    // Subscribes to the same encoded H.264 samples the SFU writer receives.
    // Wall-clock pacing mirrors the SFU writer for correct RTP timestamps.
    {
        let mut rx = broadcast_tx.subscribe();
        let writer_track = Arc::clone(&preview_track);
        let writer_pc = Arc::clone(&preview_pc);
        tokio::spawn(async move {
            let mut last_write = std::time::Instant::now();
            let mut first = true;
            let min_dur = std::time::Duration::from_millis(1);
            let max_dur = std::time::Duration::from_millis(250);
            let first_dur = std::time::Duration::from_millis(33); // ~30fps fallback
            loop {
                match rx.recv().await {
                    Ok(data) => {
                        if writer_pc.connection_state()
                            != RTCPeerConnectionState::Connected
                        {
                            last_write = std::time::Instant::now();
                            first = true;
                            continue;
                        }
                        let now = std::time::Instant::now();
                        let duration = if first {
                            first = false;
                            first_dur
                        } else {
                            (now - last_write).clamp(min_dur, max_dur)
                        };
                        last_write = now;
                        let sample = webrtc::media::Sample {
                            data: Bytes::from(data),
                            duration,
                            ..Default::default()
                        };
                        let _ = writer_track.write_sample(&sample).await;
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => {
                        // Slow consumer — skip to latest; next frame is fresher.
                        continue;
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        });
    }

    // ── RTCP reader: keyframe on PLI/FIR from the preview PC ───────────────
    {
        let rtcp_sender = preview_pc
            .get_senders()
            .await
            .into_iter()
            .next()
            .ok_or("No RTP sender on preview PC")?;
        let control_rtcp = control.clone();
        tokio::spawn(async move {
            use webrtc::rtcp::payload_feedbacks::full_intra_request::FullIntraRequest;
            use webrtc::rtcp::payload_feedbacks::picture_loss_indication::PictureLossIndication;
            let mut last_kf = std::time::Instant::now()
                .checked_sub(std::time::Duration::from_secs(1))
                .unwrap_or_else(std::time::Instant::now);
            loop {
                match rtcp_sender.read_rtcp().await {
                    Ok((packets, _)) => {
                        let mut wants_kf = false;
                        for pkt in &packets {
                            let any = pkt.as_any();
                            if any.downcast_ref::<PictureLossIndication>().is_some()
                                || any.downcast_ref::<FullIntraRequest>().is_some()
                            {
                                wants_kf = true;
                            }
                        }
                        if wants_kf && last_kf.elapsed() >= std::time::Duration::from_secs(1) {
                            control_rtcp.request_keyframe();
                            last_kf = std::time::Instant::now();
                        }
                    }
                    Err(_) => break,
                }
            }
        });
    }

    // ── Force an immediate keyframe so the first paint is instant ───────────
    {
        let control_kf = control.clone();
        let pc_for_state = Arc::clone(&preview_pc);
        tokio::spawn(async move {
            // Wait until the preview PC is connected, then force an IDR.
            loop {
                if pc_for_state.connection_state() == RTCPeerConnectionState::Connected {
                    control_kf.request_keyframe();
                    break;
                }
                if pc_for_state.connection_state() == RTCPeerConnectionState::Failed
                    || pc_for_state.connection_state() == RTCPeerConnectionState::Closed
                {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(25)).await;
            }
        });
    }

    // Store the preview PC so it can be torn down on stop/hide.
    *state.preview_pc.lock().await = Some(Arc::clone(&preview_pc));

    log::info!("[NativeShare] preview loopback PC created");
    // Return the gathered local description (host candidates inline), NOT the
    // pre-gather `offer.sdp`. This is a localhost-only pair using non-trickle
    // (vanilla) ICE: the JS peer answers with its host candidates inline too,
    // so neither side needs the trickle path (Rust→JS events would arrive
    // before the JS listener exists, and JS→Rust trickle is a no-op). Without
    // candidates in the SDP the PCs never learn each other's transport
    // addresses and ICE never connects.
    let local = preview_pc
        .local_description()
        .await
        .ok_or("Preview PC has no local description after ICE gather")?;
    Ok(SdpOfferPayload {
        sdp: local.sdp,
        r#type: "offer".to_string(),
    })
}

#[tauri::command]
pub async fn handle_preview_loopback_answer(
    state: tauri::State<'_, NativeShareState>,
    sdp: String,
) -> Result<(), String> {
    let st = state.preview_pc.lock().await;
    let pc = st.as_ref().ok_or("No preview loopback PC")?;

    let mut answer = RTCSessionDescription::default();
    answer.sdp = sdp;
    answer.sdp_type = webrtc::peer_connection::sdp::sdp_type::RTCSdpType::Answer;

    pc.set_remote_description(answer)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn handle_preview_loopback_ice_candidate(
    _candidate: serde_json::Value,
) -> Result<(), String> {
    // No-op: for localhost-only connections the Rust-side gather window produces
    // host candidates fast enough that JS→Rust trickle isn't needed.
    Ok(())
}

#[tauri::command]
pub async fn stop_preview_loopback(
    state: tauri::State<'_, NativeShareState>,
) -> Result<(), String> {
    if let Some(pc) = state.preview_pc.lock().await.take() {
        let _ = pc.close().await;
        log::info!("[NativeShare] preview loopback PC stopped");
    }
    Ok(())
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
        assert_eq!(capture_policy_from_u8(CAPTURE_POLICY_HOOK_EXCLUSIVE), "hook-exclusive");
        assert_eq!(capture_policy_from_u8(CAPTURE_POLICY_WGC_ENABLED), "wgc-enabled");
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
        ] {
            assert_eq!(fallback_reason_from_u8(fallback_reason_to_u8(reason)), reason);
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

    // ── get_native_screen_share_stats command (task 5.2) ─────────────────

    #[test]
    fn state_default_snapshot_is_zeroed_wgc() {
        // The command returns `state.stats.snapshot()`; with no active session
        // the managed state's live stats Arc yields the zeroed/`wgc` default
        // (acceptable per Req 9.3/9.4/9.5).
        let state = NativeShareState::default();
        assert_eq!(state.stats.snapshot(), NativeShareStats::default().snapshot());
    }

    #[test]
    fn state_snapshot_reflects_live_session_stats() {
        // The stats Arc is shared with the capture/encoder threads; the command
        // reads it live, so mutations made during a session are visible in the
        // snapshot the command would return (Req 9.4, 9.5, 10.2).
        let state = NativeShareState::default();
        let shared = Arc::clone(&state.stats);
        shared.captured_frames.store(120, Ordering::Relaxed);
        shared.encoded_frames.store(118, Ordering::Relaxed);
        shared.dropped_frames.store(2, Ordering::Relaxed);
        shared.record_fused_gpu_ns(450_000); // 450 us
        shared.record_encode_submit_ns(1_200_000); // 1200 us
        shared.set_capture_mode(CaptureMode::Hook);

        let snap = state.stats.snapshot();
        assert_eq!(snap.capture_mode, "hook");
        assert_eq!(snap.captured_frames, 120);
        assert_eq!(snap.encoded_frames, 118);
        assert_eq!(snap.dropped_frames, 2);
        assert_eq!(snap.last_fused_gpu_us, 450);
        assert_eq!(snap.last_encode_submit_us, 1_200);
    }
}

// ── Unit tests for capture-mode orchestration helpers (task 7.3) ───────────

#[cfg(test)]
mod capture_mode_wiring_tests {
    use super::*;
    // The legacy `select_capture_mode` is still exercised here for the
    // orchestration helper tests; it is no longer imported at module scope (the
    // session now uses `select_capture_mode_v2`), so bring it in locally.
    use crate::game_capture::select_capture_mode;

    #[test]
    fn source_kind_derives_monitor_from_monitor_id() {
        assert_eq!(source_kind_from_id("monitor-0"), SourceKind::Monitor);
        assert_eq!(source_kind_from_id("monitor-3"), SourceKind::Monitor);
    }

    #[test]
    fn source_kind_derives_window_from_window_id() {
        assert_eq!(source_kind_from_id("window-12345"), SourceKind::Window);
        // Any non-monitor id is treated conservatively as a window candidate.
        assert_eq!(source_kind_from_id("other-xyz"), SourceKind::Window);
    }

    #[test]
    fn window_hwnd_parsed_only_for_window_ids() {
        assert_eq!(window_hwnd_from_id("window-12345"), Some(12345));
        assert_eq!(window_hwnd_from_id("window--7"), Some(-7));
        // Monitor ids and malformed window ids yield no hwnd (no attach attempt).
        assert_eq!(window_hwnd_from_id("monitor-0"), None);
        assert_eq!(window_hwnd_from_id("window-notanumber"), None);
        assert_eq!(window_hwnd_from_id("garbage"), None);
    }

    #[test]
    fn monitor_source_always_selects_wgc_even_with_success() {
        // Mirrors the orchestration call: a monitor source forces WGC (Req 6.2)
        // regardless of the (irrelevant) injection outcome.
        let mode = select_capture_mode(
            source_kind_from_id("monitor-1"),
            GraphicsApiBackend::Dx11,
            true,
            true,
            InjectionOutcome::Success,
        );
        assert_eq!(mode, CaptureMode::Wgc);
    }

    #[test]
    fn window_source_with_disabled_hook_selects_wgc() {
        // Default behavior (flag off ⇒ hook_enabled false, NotAttempted) keeps
        // the proven WGC pipeline (Req 6.1).
        let mode = select_capture_mode(
            source_kind_from_id("window-42"),
            GraphicsApiBackend::Dx11,
            false,
            true,
            InjectionOutcome::NotAttempted,
        );
        assert_eq!(mode, CaptureMode::Wgc);
    }

    #[test]
    fn window_source_with_successful_injection_selects_hook() {
        let mode = select_capture_mode(
            source_kind_from_id("window-42"),
            GraphicsApiBackend::Dx11,
            true,
            true,
            InjectionOutcome::Success,
        );
        assert_eq!(mode, CaptureMode::Hook);
    }

    #[test]
    fn failed_or_blocked_injection_falls_back_to_wgc() {
        for outcome in [InjectionOutcome::Failed, InjectionOutcome::Blocked] {
            let mode = select_capture_mode(
                source_kind_from_id("window-42"),
                GraphicsApiBackend::Dx11,
                true,
                true,
                outcome,
            );
            assert_eq!(mode, CaptureMode::Wgc, "{outcome:?} must fall back to WGC");
        }
    }

    #[test]
    fn hook_enable_flag_respects_env_override() {
        // Explicit truthy values always enable regardless of compile features.
        let truthy = ["1", "true", "TRUE", "Yes", "on", " on "];
        // Explicit falsy values always disable regardless of compile features.
        let falsy = ["0", "false", "no", "off", "", "enabled?", "2"];

        for v in truthy {
            std::env::set_var("RALPH_GAME_CAPTURE_HOOK", v);
            assert!(game_capture_hook_enabled(), "{v:?} should enable the hook");
        }
        for v in falsy {
            std::env::set_var("RALPH_GAME_CAPTURE_HOOK", v);
            assert!(!game_capture_hook_enabled(), "{v:?} should not enable the hook");
        }
        // When no env var is set, the result matches the compile-time feature flag.
        // In a `game-capture-hook` build the hook is on by default (production
        // installs don't set env vars); in a bare `native-screen-share` build it
        // stays off.
        std::env::remove_var("RALPH_GAME_CAPTURE_HOOK");
        let expected = cfg!(feature = "game-capture-hook");
        assert_eq!(
            game_capture_hook_enabled(),
            expected,
            "unset env var should default to the compile-time feature flag ({})",
            if expected { "on" } else { "off" }
        );
    }
}
