//! Property-based test for the status-snapshot mapping (the new capture/encode/
//! fallback status fields added by task 9.1).
//!
//! Feature: universal-game-capture-hook, Property 5: Status snapshot faithfully
//! reflects all recorded capture/encode/fallback state
//!
//! Validates: Requirements 6.5, 7.2, 8.5, 14.1, 14.2, 14.3, 14.4
//!   - 14.1 / 6.5: `snapshot().capture_mode` is the active `Capture_Mode`
//!     string (`"wgc"` | `"hook"`).
//!   - 7.2 / 14.2: `snapshot().active_backend` is the active
//!     `Graphics_API_Backend` string when a backend is set, else the
//!     non-backend `"n/a"` marker.
//!   - 6.5 / 14.3: `snapshot().encoder_backend` is the resolved
//!     `Hardware_Encoder_Backend` / `Software_Encoder` string.
//!   - 8.5 / 14.4: `snapshot().fallback_reason` is the recorded
//!     `FallbackReason` string.
//!
//! The state is recorded through the public setters exactly as the live session
//! orchestration does:
//!   * `set_capture_mode(CaptureMode)`,
//!   * `set_active_backend(Option<GraphicsApiBackend>)`,
//!   * `set_encoder_backend(EncoderBackend)`,
//!   * `set_fallback_reason(FallbackReason)`,
//!   * the `AtomicU64` counter fields written with `.store(..)`,
//!   * the per-frame timing `AtomicU64` fields written with `.store(..)`.
//! Then `snapshot()` is taken and every field is asserted against an
//! INDEPENDENTLY re-derived expected value (the test never calls the enums'
//! own `as_str()`), so the property pins the snapshot's mapping rather than
//! re-using the implementation it verifies.
//!
//! This complements (does not replace) `prop_stats_snapshot.rs` from the prior
//! `screen-share-zero-overhead` spec, which covers the counter + EWMA-timing
//! mapping. This file focuses on the new status fields plus the faithful
//! pass-through of the counters and the ns→µs timing conversion.
//!
//! NOTE: This is an integration-test crate, so `native_share` must be reachable
//! as `app_lib::native_share` (declared `pub mod native_share` behind
//! `#[cfg(feature = "native-screen-share")]` in `lib.rs`). Run with:
//!   cargo test --features native-screen-share --test prop_status_snapshot

#![cfg(feature = "native-screen-share")]

use std::sync::atomic::Ordering;

use app_lib::game_capture::{CaptureMode, FallbackReason, GraphicsApiBackend};
use app_lib::native_share::NativeShareStats;
use app_lib::wmf_encoder::EncoderBackend;
use proptest::prelude::*;

/// Independently re-derive the expected `capture_mode` string (Req 14.1). This
/// is a deliberate second definition, NOT a call to `CaptureMode::as_str`, so
/// the property checks the status contract instead of the implementation.
fn oracle_capture_mode(mode: CaptureMode) -> &'static str {
    match mode {
        CaptureMode::Wgc => "wgc",
        CaptureMode::Hook => "hook",
    }
}

/// Independently re-derive the expected `active_backend` string (Req 7.2,
/// 14.2): the backend string when a backend is active, else the non-backend
/// `"n/a"` marker reported on the WGC fallback path.
fn oracle_active_backend(backend: Option<GraphicsApiBackend>) -> &'static str {
    match backend {
        None => "n/a",
        Some(GraphicsApiBackend::Dx11) => "dx11",
        Some(GraphicsApiBackend::Dx12) => "dx12",
        Some(GraphicsApiBackend::Vulkan) => "vulkan",
        Some(GraphicsApiBackend::OpenGl) => "opengl",
    }
}

/// Independently re-derive the expected `encoder_backend` string (Req 6.5,
/// 14.3).
fn oracle_encoder_backend(backend: EncoderBackend) -> &'static str {
    match backend {
        EncoderBackend::Nvenc => "nvenc",
        EncoderBackend::Amf => "amf",
        EncoderBackend::QuickSync => "quicksync",
        EncoderBackend::GenericHwMft => "generic_hw",
        EncoderBackend::Software => "software",
    }
}

/// Independently re-derive the expected `fallback_reason` string (Req 8.5,
/// 14.4).
fn oracle_fallback_reason(reason: FallbackReason) -> &'static str {
    match reason {
        FallbackReason::None => "none",
        FallbackReason::NotWindows => "not_windows",
        FallbackReason::MonitorSource => "monitor_source",
        FallbackReason::BackendDisabled => "backend_disabled",
        FallbackReason::HookDisabled => "hook_disabled",
        FallbackReason::MissingArtifact => "missing_artifact",
        FallbackReason::Blocklisted => "blocklisted",
        FallbackReason::NotAllowlisted => "not_allowlisted",
        FallbackReason::InjectionDenied => "injection_denied",
        FallbackReason::InjectionFailed => "injection_failed",
        FallbackReason::CrossAdapter => "cross_adapter",
        FallbackReason::InteropFailed => "interop_failed",
        FallbackReason::TargetExited => "target_exited",
        FallbackReason::HookStoppedMidSession => "hook_stopped_mid_session",
    }
}

/// Strategy producing either `Capture_Mode` (Req 14.1).
fn capture_mode_strategy() -> impl Strategy<Value = CaptureMode> {
    prop_oneof![Just(CaptureMode::Wgc), Just(CaptureMode::Hook)]
}

/// Strategy producing `None` or `Some(backend)` for every `Graphics_API_Backend`
/// variant (Req 7.2, 14.2).
fn active_backend_strategy() -> impl Strategy<Value = Option<GraphicsApiBackend>> {
    prop_oneof![
        Just(None),
        Just(Some(GraphicsApiBackend::Dx11)),
        Just(Some(GraphicsApiBackend::Dx12)),
        Just(Some(GraphicsApiBackend::Vulkan)),
        Just(Some(GraphicsApiBackend::OpenGl)),
    ]
}

/// Strategy producing every `EncoderBackend` variant (Req 6.5, 14.3).
fn encoder_backend_strategy() -> impl Strategy<Value = EncoderBackend> {
    prop_oneof![
        Just(EncoderBackend::Nvenc),
        Just(EncoderBackend::Amf),
        Just(EncoderBackend::QuickSync),
        Just(EncoderBackend::GenericHwMft),
        Just(EncoderBackend::Software),
    ]
}

/// Strategy producing every `FallbackReason` variant (Req 8.5, 14.4).
fn fallback_reason_strategy() -> impl Strategy<Value = FallbackReason> {
    prop_oneof![
        Just(FallbackReason::None),
        Just(FallbackReason::NotWindows),
        Just(FallbackReason::MonitorSource),
        Just(FallbackReason::BackendDisabled),
        Just(FallbackReason::HookDisabled),
        Just(FallbackReason::MissingArtifact),
        Just(FallbackReason::Blocklisted),
        Just(FallbackReason::NotAllowlisted),
        Just(FallbackReason::InjectionDenied),
        Just(FallbackReason::InjectionFailed),
        Just(FallbackReason::CrossAdapter),
        Just(FallbackReason::InteropFailed),
        Just(FallbackReason::TargetExited),
        Just(FallbackReason::HookStoppedMidSession),
    ]
}

proptest! {
    // Property 5 requires a minimum of 100 iterations; 256 keeps comfortably
    // above the floor while covering the (mode × backend × encoder × reason ×
    // counters × timing) space.
    #![proptest_config(ProptestConfig::with_cases(256))]

    /// Feature: universal-game-capture-hook, Property 5: Status snapshot
    /// faithfully reflects all recorded capture/encode/fallback state
    ///
    /// Validates: Requirements 6.5, 7.2, 8.5, 14.1, 14.2, 14.3, 14.4
    ///
    /// For any recorded status state — an arbitrary active capture mode, active
    /// backend (including "none"), encoder backend, fallback reason, plus
    /// arbitrary counter and per-frame timing values — the `snapshot()` reports
    /// every status field as the independently re-derived expected string and
    /// passes the counters through unchanged with the ns→µs timing conversion.
    #[test]
    fn status_snapshot_faithfully_reflects_recorded_state(
        mode in capture_mode_strategy(),
        active_backend in active_backend_strategy(),
        encoder_backend in encoder_backend_strategy(),
        fallback_reason in fallback_reason_strategy(),
        captured_frames in any::<u64>(),
        encoded_frames in any::<u64>(),
        encode_errors in any::<u64>(),
        samples_written in any::<u64>(),
        dropped_frames in any::<u64>(),
        last_fused_gpu_ns in any::<u64>(),
        last_encode_submit_ns in any::<u64>(),
        fused_gpu_ns_ewma in any::<u64>(),
        encode_submit_ns_ewma in any::<u64>(),
    ) {
        // A fresh, Default `NativeShareStats` per case (Req: the snapshot is a
        // pure function of recorded state — no cross-case carryover).
        let stats = NativeShareStats::default();

        // ── Record the status fields through the public setters ───────────────
        stats.set_capture_mode(mode);
        stats.set_active_backend(active_backend);
        stats.set_encoder_backend(encoder_backend);
        stats.set_fallback_reason(fallback_reason);

        // ── Record arbitrary counter state via the public atomic fields ───────
        stats.captured_frames.store(captured_frames, Ordering::Relaxed);
        stats.encoded_frames.store(encoded_frames, Ordering::Relaxed);
        stats.encode_errors.store(encode_errors, Ordering::Relaxed);
        stats.samples_written.store(samples_written, Ordering::Relaxed);
        stats.dropped_frames.store(dropped_frames, Ordering::Relaxed);

        // ── Record arbitrary per-frame timing (nanoseconds) directly so the
        //    snapshot's ns→µs conversion is exercised over the full u64 range,
        //    independent of the EWMA folding (covered by prop_stats_snapshot). ─
        stats.last_fused_gpu_ns.store(last_fused_gpu_ns, Ordering::Relaxed);
        stats.last_encode_submit_ns.store(last_encode_submit_ns, Ordering::Relaxed);
        stats.fused_gpu_ns_ewma.store(fused_gpu_ns_ewma, Ordering::Relaxed);
        stats.encode_submit_ns_ewma.store(encode_submit_ns_ewma, Ordering::Relaxed);

        let snap = stats.snapshot();

        // (1) capture_mode reflects the set mode (Req 14.1, 6.5).
        prop_assert_eq!(
            snap.capture_mode.as_str(),
            oracle_capture_mode(mode),
            "capture_mode mismatch for {:?}",
            mode
        );

        // (2) active_backend reflects the set backend, or "n/a" when none
        //     (Req 7.2, 14.2).
        prop_assert_eq!(
            snap.active_backend.as_str(),
            oracle_active_backend(active_backend),
            "active_backend mismatch for {:?}",
            active_backend
        );

        // (3) encoder_backend reflects the resolved encoder (Req 6.5, 14.3).
        prop_assert_eq!(
            snap.encoder_backend.as_str(),
            oracle_encoder_backend(encoder_backend),
            "encoder_backend mismatch for {:?}",
            encoder_backend
        );

        // (4) fallback_reason reflects the recorded reason (Req 8.5, 14.4).
        prop_assert_eq!(
            snap.fallback_reason.as_str(),
            oracle_fallback_reason(fallback_reason),
            "fallback_reason mismatch for {:?}",
            fallback_reason
        );

        // (5) Existing counters pass through unchanged — recording the new
        //     status fields must not perturb the counter mapping.
        prop_assert_eq!(snap.captured_frames, captured_frames);
        prop_assert_eq!(snap.encoded_frames, encoded_frames);
        prop_assert_eq!(snap.encode_errors, encode_errors);
        prop_assert_eq!(snap.samples_written, samples_written);
        prop_assert_eq!(snap.dropped_frames, dropped_frames);

        // (6) Per-frame timing is reported in microseconds (ns / 1000), exactly
        //     as the snapshot maps it, over the full input range.
        prop_assert_eq!(snap.last_fused_gpu_us, last_fused_gpu_ns / 1_000);
        prop_assert_eq!(snap.last_encode_submit_us, last_encode_submit_ns / 1_000);
        prop_assert_eq!(snap.fused_gpu_us_avg, fused_gpu_ns_ewma / 1_000);
        prop_assert_eq!(snap.encode_submit_us_avg, encode_submit_ns_ewma / 1_000);

        // (7) The status fields are mutually independent: each reflects only its
        //     own recorded value, never bleeding into another. Re-deriving all
        //     four together guards against a cross-wired mapping.
        prop_assert_eq!(
            (
                snap.capture_mode.as_str(),
                snap.active_backend.as_str(),
                snap.encoder_backend.as_str(),
                snap.fallback_reason.as_str(),
            ),
            (
                oracle_capture_mode(mode),
                oracle_active_backend(active_backend),
                oracle_encoder_backend(encoder_backend),
                oracle_fallback_reason(fallback_reason),
            )
        );
    }
}

/// Concrete, documented examples that complement the property (Req 14.1, 14.2,
/// 14.3, 14.4). These pin specific status outcomes the renderer contract
/// depends on, including the "no active backend → n/a" marker on the WGC path.
#[test]
fn documented_status_examples() {
    // Default state: wgc / n/a / software / none (the guaranteed-fallback
    // defaults a session reports before anything is resolved).
    let stats = NativeShareStats::default();
    let snap = stats.snapshot();
    assert_eq!(snap.capture_mode, "wgc");
    assert_eq!(snap.active_backend, "n/a");
    assert_eq!(snap.encoder_backend, "software");
    assert_eq!(snap.fallback_reason, "none");

    // A live hook session on DX11 with a vendor encoder and no fallback.
    let stats = NativeShareStats::default();
    stats.set_capture_mode(CaptureMode::Hook);
    stats.set_active_backend(Some(GraphicsApiBackend::Dx11));
    stats.set_encoder_backend(EncoderBackend::Nvenc);
    stats.set_fallback_reason(FallbackReason::None);
    let snap = stats.snapshot();
    assert_eq!(snap.capture_mode, "hook");
    assert_eq!(snap.active_backend, "dx11");
    assert_eq!(snap.encoder_backend, "nvenc");
    assert_eq!(snap.fallback_reason, "none");

    // A WGC fallback after an anti-cheat block: no active backend, a recorded
    // reason, and a generic-hardware encoder.
    let stats = NativeShareStats::default();
    stats.set_capture_mode(CaptureMode::Wgc);
    stats.set_active_backend(None);
    stats.set_encoder_backend(EncoderBackend::GenericHwMft);
    stats.set_fallback_reason(FallbackReason::Blocklisted);
    let snap = stats.snapshot();
    assert_eq!(snap.capture_mode, "wgc");
    assert_eq!(snap.active_backend, "n/a");
    assert_eq!(snap.encoder_backend, "generic_hw");
    assert_eq!(snap.fallback_reason, "blocklisted");
}
