//! Property-based test for capture-policy resolution precedence.
//!
//! Feature: owned-game-capture-hook, Property 3: Capture-policy resolution
//! respects precedence and is total
//!
//! Validates: Requirements 5.1
//!
//! The logic under test is the pure, GPU-/OS-independent
//! `app_lib::game_capture::resolve_capture_policy`. It maps an optional runtime
//! policy and an optional build-feature default policy to exactly one
//! `CapturePolicy` using a fixed precedence:
//!
//!   runtime (when present)
//!     else feature_default (when present)
//!       else WgcEnabled (the documented default when neither specifies one).
//!
//! `Option<CapturePolicy>` ranges over `{ None, Some(HookExclusive),
//! Some(WgcEnabled) }`, so the entire input space is 3 * 3 = 9 combinations.
//! proptest samples that space far above the required 100-iteration floor, and
//! the expected outcome is re-derived independently below (mirroring the
//! contract, not the implementation) so the property pins behavior rather than
//! restating it.
//!
//! NOTE: This is an integration-test crate, so `game_capture` must be reachable
//! as `app_lib::game_capture` (declared `pub mod game_capture` behind
//! `#[cfg(feature = "native-screen-share")]` in `lib.rs`). Run with:
//!   cargo test --features native-screen-share --test prop_capture_policy_resolution

#![cfg(feature = "native-screen-share")]

use app_lib::game_capture::{resolve_capture_policy, CapturePolicy};
use proptest::prelude::*;

/// Strategy generating every `Option<CapturePolicy>` value: `None`, or `Some`
/// of either policy variant. Covers the full optional-policy input space.
fn opt_policy_strategy() -> impl Strategy<Value = Option<CapturePolicy>> {
    prop_oneof![
        Just(None),
        Just(Some(CapturePolicy::HookExclusive)),
        Just(Some(CapturePolicy::WgcEnabled)),
    ]
}

/// Independent re-derivation of the documented precedence: runtime wins when
/// present, else the feature default when present, else `WgcEnabled`. Written
/// by hand (not by calling `resolve_capture_policy`) so the property checks the
/// implementation against a second source of truth.
fn expected_policy(
    runtime: Option<CapturePolicy>,
    feature_default: Option<CapturePolicy>,
) -> CapturePolicy {
    match runtime {
        Some(p) => p,
        None => match feature_default {
            Some(p) => p,
            None => CapturePolicy::WgcEnabled,
        },
    }
}

proptest! {
    // Property 3 requires a minimum of 100 iterations. The full input space is
    // only 3 * 3 = 9 combinations, so 1024 cases exhausts it many times over
    // while staying well above the 100-iteration floor.
    #![proptest_config(ProptestConfig::with_cases(1024))]

    /// Feature: owned-game-capture-hook, Property 3: Capture-policy resolution
    /// respects precedence and is total
    ///
    /// Validates: Requirements 5.1
    #[test]
    fn resolve_capture_policy_respects_precedence_and_is_total(
        runtime in opt_policy_strategy(),
        feature_default in opt_policy_strategy(),
    ) {
        let resolved = resolve_capture_policy(runtime, feature_default);

        // (1) Totality: the result is always exactly one of the two valid,
        // reportable policies. `CapturePolicy` is a closed enum, so this also
        // proves the function never panics or fails to resolve (Req 5.1).
        prop_assert!(matches!(
            resolved,
            CapturePolicy::HookExclusive | CapturePolicy::WgcEnabled
        ));
        prop_assert!(matches!(resolved.as_str(), "hook-exclusive" | "wgc-enabled"));

        // (2) Precedence: the resolved policy equals the independently
        // re-derived expectation for these inputs.
        prop_assert_eq!(
            resolved,
            expected_policy(runtime, feature_default),
            "resolve_capture_policy disagreed with the documented precedence: \
             runtime={:?}, feature_default={:?}",
            runtime,
            feature_default
        );

        // (3) Restated as the three precedence clauses for stronger
        // localization of any counterexample.
        match runtime {
            // Runtime present ⇒ runtime wins regardless of the feature default.
            Some(rt) => prop_assert_eq!(
                resolved,
                rt,
                "runtime policy present but not chosen: runtime={:?}, feature_default={:?}",
                runtime,
                feature_default
            ),
            None => match feature_default {
                // No runtime, feature default present ⇒ feature default wins.
                Some(fd) => prop_assert_eq!(
                    resolved,
                    fd,
                    "feature default present (no runtime) but not chosen: feature_default={:?}",
                    feature_default
                ),
                // Neither present ⇒ the documented `WgcEnabled` default.
                None => prop_assert_eq!(
                    resolved,
                    CapturePolicy::WgcEnabled,
                    "neither runtime nor feature default present but resolved was not WgcEnabled"
                ),
            },
        }
    }
}
