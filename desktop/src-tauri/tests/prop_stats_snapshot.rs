//! Property-based test for the NativeShareStats → snapshot mapping.
//!
//! Feature: screen-share-zero-overhead, Property 8: Stats snapshot faithfully
//! reflects all recorded state — for any `NativeShareStats` state (arbitrary
//! counters, timing values, active capture mode), the `NativeShareStatsSnapshot`
//! reports every existing counter unchanged, includes fused-GPU/encode-submit
//! timing, and reports the capture-mode string matching the active mode.
//!
//! Validates: Requirements 4.3, 6.5, 9.1, 9.2, 9.4, 9.5
//!
//! The state is built through the public API exactly as the live pipeline does:
//!   * counters are `AtomicU64` fields written with `.store(..)`,
//!   * per-frame timing is fed through `record_fused_gpu_ns` /
//!     `record_encode_submit_ns` (which also fold the sample into an EWMA),
//!   * the active mode is set with `set_capture_mode(CaptureMode)`.
//! Then `snapshot()` is taken and asserted to be a faithful pure mapping of the
//! live atomic state, with timing reported in MICROSECONDS (ns / 1000).
//!
//! NOTE: This is an integration-test crate, so `native_share` must be reachable
//! as `app_lib::native_share` (declared `pub mod native_share` behind
//! `#[cfg(feature = "native-screen-share")]` in `lib.rs`). Run with:
//!   cargo test --features native-screen-share --test prop_stats_snapshot

#![cfg(feature = "native-screen-share")]

use std::sync::atomic::Ordering;

use app_lib::game_capture::CaptureMode;
use app_lib::native_share::NativeShareStats;
use proptest::prelude::*;

/// Reference re-implementation of `NativeShareStats::update_ewma` (alpha = 1/8):
/// a zero EWMA seeds directly to the first sample, otherwise it moves an eighth
/// of the way toward each new sample. Folding the same sample sequence here lets
/// the test confirm the recorded EWMA — and thus the snapshot — is consistent.
fn fold_ewma(samples: &[u64]) -> (u64 /* last */, u64 /* ewma */) {
    let mut last = 0u64;
    let mut ewma = 0u64;
    for &s in samples {
        last = s;
        ewma = if ewma == 0 {
            s
        } else if s >= ewma {
            ewma + ((s - ewma) >> 3)
        } else {
            ewma - ((ewma - s) >> 3)
        };
    }
    (last, ewma)
}

proptest! {
    // Property 8 requires a minimum of 100 iterations; run more for coverage.
    #![proptest_config(ProptestConfig::with_cases(256))]

    /// Feature: screen-share-zero-overhead, Property 8: Stats snapshot faithfully
    /// reflects all recorded state.
    ///
    /// Validates: Requirements 4.3, 6.5, 9.1, 9.2, 9.4, 9.5
    #[test]
    fn snapshot_faithfully_reflects_recorded_state(
        captured_frames in any::<u64>(),
        encoded_frames in any::<u64>(),
        encode_errors in any::<u64>(),
        samples_written in any::<u64>(),
        audio_samples_written in any::<u64>(),
        write_errors in any::<u64>(),
        dropped_frames in any::<u64>(),
        fused_samples in proptest::collection::vec(any::<u64>(), 0..32),
        encode_samples in proptest::collection::vec(any::<u64>(), 0..32),
        hook_mode in any::<bool>(),
    ) {
        let stats = NativeShareStats::default();

        // ── Set arbitrary counter state via the public atomic fields ─────────
        stats.captured_frames.store(captured_frames, Ordering::Relaxed);
        stats.encoded_frames.store(encoded_frames, Ordering::Relaxed);
        stats.encode_errors.store(encode_errors, Ordering::Relaxed);
        stats.samples_written.store(samples_written, Ordering::Relaxed);
        stats.audio_samples_written.store(audio_samples_written, Ordering::Relaxed);
        stats.write_errors.store(write_errors, Ordering::Relaxed);
        stats.dropped_frames.store(dropped_frames, Ordering::Relaxed);

        // ── Feed per-frame timing through the recording API (folds EWMA) ─────
        for &s in &fused_samples {
            stats.record_fused_gpu_ns(s);
        }
        for &s in &encode_samples {
            stats.record_encode_submit_ns(s);
        }

        // ── Set the active capture mode ──────────────────────────────────────
        let mode = if hook_mode { CaptureMode::Hook } else { CaptureMode::Wgc };
        stats.set_capture_mode(mode);

        // Snapshot of the live atomic state.
        let snap = stats.snapshot();

        // (1) Every existing counter is reported unchanged (Req 9.5). Note the
        //     snapshot intentionally surfaces only this subset; audio_samples /
        //     write_errors are internal and not part of the snapshot contract.
        prop_assert_eq!(snap.captured_frames, captured_frames);
        prop_assert_eq!(snap.encoded_frames, encoded_frames);
        prop_assert_eq!(snap.encode_errors, encode_errors);
        prop_assert_eq!(snap.samples_written, samples_written);
        prop_assert_eq!(snap.dropped_frames, dropped_frames);

        // (2) The capture-mode string matches the set mode (Req 6.5, 9.4).
        let expected_mode_str = if hook_mode { "hook" } else { "wgc" };
        prop_assert_eq!(snap.capture_mode.as_str(), expected_mode_str);

        // (3) The snapshot is a faithful pure mapping of the live atomics, with
        //     timing converted ns → µs (Req 9.1, 9.2, 9.4). Reading the raw
        //     atomics back proves the snapshot is exactly state / 1000.
        let raw_last_fused = stats.last_fused_gpu_ns.load(Ordering::Relaxed);
        let raw_last_encode = stats.last_encode_submit_ns.load(Ordering::Relaxed);
        let raw_fused_ewma = stats.fused_gpu_ns_ewma.load(Ordering::Relaxed);
        let raw_encode_ewma = stats.encode_submit_ns_ewma.load(Ordering::Relaxed);

        prop_assert_eq!(snap.last_fused_gpu_us, raw_last_fused / 1_000);
        prop_assert_eq!(snap.last_encode_submit_us, raw_last_encode / 1_000);
        prop_assert_eq!(snap.fused_gpu_us_avg, raw_fused_ewma / 1_000);
        prop_assert_eq!(snap.encode_submit_us_avg, raw_encode_ewma / 1_000);

        // (4) The recorded timing reflects exactly the samples fed in: the last
        //     stored value equals the final sample, and the EWMA equals the
        //     independent fold of the same sequence (Req 9.1, 9.2). This shows
        //     the timing fields are present and internally consistent — not just
        //     mechanically divided.
        let (ref_last_fused, ref_fused_ewma) = fold_ewma(&fused_samples);
        let (ref_last_encode, ref_encode_ewma) = fold_ewma(&encode_samples);
        prop_assert_eq!(raw_last_fused, ref_last_fused);
        prop_assert_eq!(raw_fused_ewma, ref_fused_ewma);
        prop_assert_eq!(raw_last_encode, ref_last_encode);
        prop_assert_eq!(raw_encode_ewma, ref_encode_ewma);

        // And therefore the snapshot's microsecond timing matches the fold too.
        prop_assert_eq!(snap.last_fused_gpu_us, ref_last_fused / 1_000);
        prop_assert_eq!(snap.fused_gpu_us_avg, ref_fused_ewma / 1_000);
        prop_assert_eq!(snap.last_encode_submit_us, ref_last_encode / 1_000);
        prop_assert_eq!(snap.encode_submit_us_avg, ref_encode_ewma / 1_000);
    }
}
