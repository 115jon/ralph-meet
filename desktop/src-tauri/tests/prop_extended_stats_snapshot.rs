//! Property-based test for the EXTENDED NativeShareStats → snapshot mapping
//! added by task 5.1 (capture policy, capture-unavailable / foreign-hook flags,
//! and negotiated width/height/fps).
//!
//! Feature: owned-game-capture-hook, Property 6: The stats snapshot faithfully
//! reflects recorded policy and negotiated parameters
//!
//! Validates: Requirements 4.4, 5.5, 9.1, 9.4
//!   - 5.5: `snapshot().capture_policy` round-trips the recorded policy to its
//!     stable string (`"hook-exclusive"` | `"wgc-enabled"`).
//!   - 4.4 / 5.3 / 8.2: `capture_unavailable` and the foreign-hook flag reflect
//!     exactly what was set.
//!   - 9.1: negotiated width/height/fps are exposed; fps is carried as milli-fps
//!     (fps × 1000) and divided back to `f64`.
//!   - 9.4: the `0` not-yet-negotiated sentinel maps to `None` for width,
//!     height, and fps; any non-zero value maps to `Some`.
//!
//! The state is recorded through the public setters exactly as the live session
//! orchestration does:
//!   * `set_capture_policy(bool)`,
//!   * `set_capture_unavailable(bool)`,
//!   * `set_foreign_hook(bool)`,
//!   * `set_negotiated_params(width, height, fps)` / `clear_negotiated_params()`.
//! Then `snapshot()` is taken and every new field is asserted against an
//! INDEPENDENTLY re-derived expected value (the test never reuses the snapshot's
//! own mapping helpers), so the property pins the snapshot contract rather than
//! re-using the implementation it verifies.
//!
//! This complements (does not replace) `prop_status_snapshot.rs` (capture mode /
//! backend / encoder / fallback-reason fields) and `prop_stats_snapshot.rs`
//! (counter + EWMA-timing fields).
//!
//! NOTE: This is an integration-test crate, so `native_share` must be reachable
//! as `app_lib::native_share` (declared `pub mod native_share` behind
//! `#[cfg(feature = "native-screen-share")]` in `lib.rs`). Run with:
//!   cargo test --features native-screen-share --test prop_extended_stats_snapshot

#![cfg(feature = "native-screen-share")]

use app_lib::native_share::NativeShareStats;
use proptest::prelude::*;

/// Independently re-derive the expected `capture_policy` string (Req 5.5):
/// `true` (hook-exclusive) → `"hook-exclusive"`, `false` → `"wgc-enabled"`.
/// Deliberately a second definition, NOT a call into the snapshot's mapping.
fn oracle_capture_policy(hook_exclusive: bool) -> &'static str {
    if hook_exclusive {
        "hook-exclusive"
    } else {
        "wgc-enabled"
    }
}

/// Independently re-derive the expected snapshot value for a negotiated
/// width/height: the `0` not-yet-negotiated sentinel maps to `None`, any other
/// value to `Some(value)` (Req 9.4).
fn oracle_dimension(value: u32) -> Option<u32> {
    match value {
        0 => None,
        v => Some(v),
    }
}

/// Independently re-derive the milli-fps quantization the setter applies (Req
/// 9.1): a finite, strictly-positive fps becomes `(fps × 1000).round()` (a
/// `u32`, saturating per Rust's `as` cast), and anything else (zero, negative,
/// non-finite) becomes the `0` not-yet-negotiated sentinel.
fn oracle_fps_milli(fps: f64) -> u32 {
    if fps.is_finite() && fps > 0.0 {
        (fps * 1_000.0).round() as u32
    } else {
        0
    }
}

/// Independently re-derive the expected snapshot `negotiated_fps`: the milli-fps
/// `0` sentinel maps to `None`, otherwise the stored milli-fps divided back to
/// `f64` (Req 9.1, 9.4).
fn oracle_fps_option(fps: f64) -> Option<f64> {
    match oracle_fps_milli(fps) {
        0 => None,
        milli => Some(f64::from(milli) / 1_000.0),
    }
}

/// Strategy for an fps value, biased to cover the cases the spec calls out:
/// the `0` sentinel, fractional broadcast rates (59.94, 29.97, 23.976), common
/// integral rates, a uniform interior, and the clamp-to-sentinel paths
/// (negative / non-finite).
fn fps_strategy() -> impl Strategy<Value = f64> {
    prop_oneof![
        // Not-yet-negotiated sentinel and its neighbours.
        Just(0.0),
        // Fractional broadcast rates that must survive the integer atomic.
        Just(59.94),
        Just(29.97),
        Just(23.976),
        Just(119.88),
        // Common integral rates.
        Just(24.0),
        Just(30.0),
        Just(60.0),
        Just(90.0),
        Just(120.0),
        Just(144.0),
        // Uniform interior over a realistic capture-rate range.
        (0.0f64..1000.0f64),
        // Clamp-to-sentinel inputs: negative, zero-ish, and non-finite.
        Just(-30.0),
        Just(-0.0),
        Just(f64::NAN),
        Just(f64::INFINITY),
        Just(f64::NEG_INFINITY),
    ]
}

proptest! {
    // Property 6 requires a minimum of 100 iterations; 256 keeps comfortably
    // above the floor while covering the (policy × flags × width × height × fps)
    // space, including the 0 sentinels and fractional fps.
    #![proptest_config(ProptestConfig::with_cases(256))]

    /// Feature: owned-game-capture-hook, Property 6: The stats snapshot
    /// faithfully reflects recorded policy and negotiated parameters
    ///
    /// Validates: Requirements 4.4, 5.5, 9.1, 9.4
    ///
    /// For any recorded policy bool, capture-unavailable / foreign-hook flags,
    /// and negotiated width/height/fps (including the `0` sentinels and
    /// fractional fps such as 59.94), `snapshot()` reports: the policy as its
    /// independently re-derived stable string; the two flags exactly as set; the
    /// negotiated width/height with `0` → `None` and any non-zero → `Some`; and
    /// the negotiated fps quantized to milli-fps then divided back to `f64`,
    /// with the `0` sentinel mapping to `None`.
    #[test]
    fn extended_snapshot_faithfully_reflects_policy_and_negotiated_params(
        hook_exclusive in any::<bool>(),
        capture_unavailable in any::<bool>(),
        foreign_hook in any::<bool>(),
        width in any::<u32>(),
        height in any::<u32>(),
        fps in fps_strategy(),
    ) {
        // A fresh, Default `NativeShareStats` per case — the snapshot is a pure
        // function of recorded state with no cross-case carryover.
        let stats = NativeShareStats::default();

        // ── Record the new fields through the public setters ─────────────────
        stats.set_capture_policy(hook_exclusive);
        stats.set_capture_unavailable(capture_unavailable);
        stats.set_foreign_hook(foreign_hook);
        stats.set_negotiated_params(width, height, fps);

        let snap = stats.snapshot();

        // (1) capture_policy round-trips to its stable string (Req 5.5).
        prop_assert_eq!(
            snap.capture_policy.as_str(),
            oracle_capture_policy(hook_exclusive),
            "capture_policy mismatch for hook_exclusive={}",
            hook_exclusive
        );

        // (2) The capture-unavailable and foreign-hook flags reflect exactly
        //     what was set (Req 4.4, 5.3, 8.2, 3.4).
        prop_assert_eq!(snap.capture_unavailable, capture_unavailable);
        prop_assert_eq!(snap.foreign_hook, foreign_hook);

        // (3) Negotiated width/height: `0` sentinel → None, else Some(value)
        //     (Req 9.1, 9.4).
        prop_assert_eq!(snap.negotiated_width, oracle_dimension(width));
        prop_assert_eq!(snap.negotiated_height, oracle_dimension(height));

        // (4) Negotiated fps: milli-fps round-trip with the `0` sentinel → None
        //     (Req 9.1, 9.4).
        prop_assert_eq!(snap.negotiated_fps, oracle_fps_option(fps));

        // (5) For a present, finite, positive fps the round-tripped value must
        //     match the original within the milli-fps quantization step — i.e.
        //     it equals `(fps * 1000).round() / 1000`, so the error is at most
        //     half a milli-fps (0.0005). This pins the fractional-fps fidelity
        //     the spec calls out (e.g. 59.94 survives the integer atomic).
        if let Some(reported) = snap.negotiated_fps {
            let quantized = f64::from(oracle_fps_milli(fps)) / 1_000.0;
            prop_assert!(
                (reported - quantized).abs() < 1e-9,
                "fps {reported} not equal to quantized {quantized} for input {fps}"
            );
            // And the quantization error from the ORIGINAL input is bounded by
            // half a milli-fps — the inherent limit of milli-fps storage.
            prop_assert!(
                (reported - fps).abs() <= 0.0005 + 1e-9,
                "fps {reported} drifted from input {fps} beyond milli-fps quantization"
            );
        }

        // (6) Independence: each new field reflects only its own recorded value,
        //     never bleeding into another. Re-deriving them together guards
        //     against a cross-wired mapping.
        prop_assert_eq!(
            (
                snap.capture_policy.as_str(),
                snap.capture_unavailable,
                snap.foreign_hook,
                snap.negotiated_width,
                snap.negotiated_height,
                snap.negotiated_fps,
            ),
            (
                oracle_capture_policy(hook_exclusive),
                capture_unavailable,
                foreign_hook,
                oracle_dimension(width),
                oracle_dimension(height),
                oracle_fps_option(fps),
            )
        );
    }
}

/// Concrete, documented examples that complement the property. These pin
/// specific outcomes the stats contract depends on, including the fractional
/// 59.94 fps round-trip, the not-yet-negotiated sentinels, and the explicit
/// `clear_negotiated_params()` reset (Req 5.5, 9.1, 9.4).
#[test]
fn documented_extended_snapshot_examples() {
    // Default state: wgc-enabled policy, no flags set, nothing negotiated yet.
    let stats = NativeShareStats::default();
    let snap = stats.snapshot();
    assert_eq!(snap.capture_policy, "wgc-enabled");
    assert!(!snap.capture_unavailable);
    assert!(!snap.foreign_hook);
    assert_eq!(snap.negotiated_width, None);
    assert_eq!(snap.negotiated_height, None);
    assert_eq!(snap.negotiated_fps, None);

    // Hook-exclusive policy with a fractional 59.94 fps negotiated at 1080p.
    let stats = NativeShareStats::default();
    stats.set_capture_policy(true);
    stats.set_negotiated_params(1920, 1080, 59.94);
    let snap = stats.snapshot();
    assert_eq!(snap.capture_policy, "hook-exclusive");
    assert_eq!(snap.negotiated_width, Some(1920));
    assert_eq!(snap.negotiated_height, Some(1080));
    // 59.94 → 59940 milli-fps → 59.94 fps exactly.
    assert_eq!(snap.negotiated_fps, Some(59.94));

    // Capture-unavailable (hook-exclusive window with the hook down) plus a
    // detected foreign hook; resolution negotiated but fps still pending.
    let stats = NativeShareStats::default();
    stats.set_capture_policy(true);
    stats.set_capture_unavailable(true);
    stats.set_foreign_hook(true);
    stats.set_negotiated_params(1280, 720, 0.0);
    let snap = stats.snapshot();
    assert!(snap.capture_unavailable);
    assert!(snap.foreign_hook);
    assert_eq!(snap.negotiated_width, Some(1280));
    assert_eq!(snap.negotiated_height, Some(720));
    assert_eq!(snap.negotiated_fps, None); // 0 fps sentinel → pending.

    // clear_negotiated_params resets all three back to not-yet-negotiated.
    let stats = NativeShareStats::default();
    stats.set_negotiated_params(2560, 1440, 144.0);
    stats.clear_negotiated_params();
    let snap = stats.snapshot();
    assert_eq!(snap.negotiated_width, None);
    assert_eq!(snap.negotiated_height, None);
    assert_eq!(snap.negotiated_fps, None);

    // A negative / invalid fps clamps to the not-yet-negotiated sentinel.
    let stats = NativeShareStats::default();
    stats.set_negotiated_params(640, 480, -30.0);
    let snap = stats.snapshot();
    assert_eq!(snap.negotiated_fps, None);
}
