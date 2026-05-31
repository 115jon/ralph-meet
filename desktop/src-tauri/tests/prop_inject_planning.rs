//! Property-based test for bitness injection planning.
//!
//! Feature: universal-game-capture-hook, Property 9: Bitness injection planning
//! always selects a target-bitness payload and uses the helper exactly when
//! bitness differs
//!
//! Validates: Requirements 2.2, 2.3, 2.4, 2.5
//!
//! The function under test is the pure, GPU/OS-independent
//! `app_lib::game_capture::inject::plan_injection`. It takes the host
//! [`Bitness`], the target [`Bitness`], and an [`ObsArtifacts`] (whose four
//! `Option<PathBuf>` fields stand in for on-disk presence) and returns the
//! [`InjectStrategy`] or `Err(`[`FallbackReason::MissingArtifact`]`)`. Because it
//! is a total function over a small input space (2 host bitnesses * 2 target
//! bitnesses * 2^4 artifact-presence combinations = 64 cases) proptest explores
//! every combination many times over across well above the 100-iteration floor.
//!
//! NOTE: This is an integration-test crate, so the `game_capture::inject` module
//! must be reachable as `app_lib::game_capture::inject` (declared
//! `pub mod inject` behind `#[cfg(feature = "game-capture-hook")]`). Run with:
//!   cargo test --features game-capture-hook --test prop_inject_planning

#![cfg(feature = "game-capture-hook")]

use std::path::PathBuf;

use app_lib::game_capture::inject::{plan_injection, Bitness, InjectStrategy, ObsArtifacts};
use app_lib::game_capture::FallbackReason;
use proptest::prelude::*;

/// Strategy generating both `Bitness` variants.
fn bitness_strategy() -> impl Strategy<Value = Bitness> {
    prop_oneof![Just(Bitness::X86), Just(Bitness::X64)]
}

/// Turn a presence flag into the `Option<PathBuf>` an artifact field carries.
/// The concrete path value is irrelevant to planning — only presence matters —
/// so a fixed sentinel name is used when present.
fn artifact(present: bool, name: &str) -> Option<PathBuf> {
    present.then(|| PathBuf::from(name))
}

/// The presence of the artifact (payload or helper) for a given bitness,
/// re-derived directly from the four presence flags rather than from the struct
/// under test, so the oracle is independent of `ObsArtifacts`' accessors.
fn payload_present(b: Bitness, hook64: bool, hook32: bool) -> bool {
    match b {
        Bitness::X64 => hook64,
        Bitness::X86 => hook32,
    }
}

fn helper_present(b: Bitness, helper64: bool, helper32: bool) -> bool {
    match b {
        Bitness::X64 => helper64,
        Bitness::X86 => helper32,
    }
}

proptest! {
    // Property 9 requires a minimum of 100 iterations. The full input space is
    // only 2 * 2 * 2^4 = 64 combinations, so 1024 cases covers it many times
    // over while staying well above the 100-iteration floor.
    #![proptest_config(ProptestConfig::with_cases(1024))]

    /// Feature: universal-game-capture-hook, Property 9: Bitness injection
    /// planning always selects a target-bitness payload and uses the helper
    /// exactly when bitness differs
    ///
    /// Validates: Requirements 2.2, 2.3, 2.4, 2.5
    #[test]
    fn injection_planning_selects_target_bitness_payload_and_helper_on_mismatch(
        host in bitness_strategy(),
        target in bitness_strategy(),
        hook64 in any::<bool>(),
        hook32 in any::<bool>(),
        helper64 in any::<bool>(),
        helper32 in any::<bool>(),
    ) {
        let artifacts = ObsArtifacts::new(
            artifact(hook64, "graphics-hook64.dll"),
            artifact(hook32, "graphics-hook32.dll"),
            artifact(helper64, "inject-helper64.exe"),
            artifact(helper32, "inject-helper32.exe"),
        );

        let result = plan_injection(host, target, &artifacts);

        // ── Independently re-derive the expected outcome from the raw inputs ──
        //
        // The Injector always selects the payload whose bitness equals the
        // Target_Bitness (Req 2.4). The required artifacts are:
        //   - the target-bitness payload, always (Req 2.5);
        //   - additionally, for the cross-bitness case (host != target), the
        //     target-bitness inject-helper (Req 2.3, 2.5).
        // The payload presence is checked before the helper, so a missing
        // payload is the reason whenever the payload is absent.
        let cross_bitness = host != target;
        let target_payload_present = payload_present(target, hook64, hook32);
        let target_helper_present = helper_present(target, helper64, helper32);

        if !target_payload_present {
            // Required payload absent → MissingArtifact regardless of strategy.
            prop_assert_eq!(
                result,
                Err(FallbackReason::MissingArtifact),
                "missing target-bitness payload must yield MissingArtifact \
                 (host={:?}, target={:?}, hook64={}, hook32={})",
                host, target, hook64, hook32
            );
        } else if cross_bitness && !target_helper_present {
            // Cross-bitness with the payload present but the helper absent →
            // MissingArtifact (Req 2.3, 2.5).
            prop_assert_eq!(
                result,
                Err(FallbackReason::MissingArtifact),
                "cross-bitness with a missing target-bitness helper must yield \
                 MissingArtifact (host={:?}, target={:?}, helper64={}, helper32={})",
                host, target, helper64, helper32
            );
        } else {
            // All required artifacts present → Ok with a target-bitness payload.
            let strategy = result.expect(
                "required artifacts present, so planning must succeed",
            );

            // (Req 2.4) The selected payload bitness ALWAYS equals the target.
            prop_assert_eq!(
                strategy.payload(),
                target,
                "selected payload bitness must equal the Target_Bitness \
                 (host={:?}, target={:?})",
                host, target
            );

            if cross_bitness {
                // (Req 2.3) host != target → CrossBitness, helper == target.
                prop_assert_eq!(
                    strategy,
                    InjectStrategy::CrossBitness { payload: target, helper: target },
                    "differing bitness must plan a CrossBitness strategy with a \
                     target-bitness payload and helper (host={:?}, target={:?})",
                    host, target
                );
                prop_assert_eq!(
                    strategy.helper(),
                    Some(target),
                    "cross-bitness strategy must use the target-bitness helper"
                );
            } else {
                // (Req 2.2) host == target → Direct, no helper used.
                prop_assert_eq!(
                    strategy,
                    InjectStrategy::Direct { payload: target },
                    "matching bitness must plan a Direct strategy with a \
                     target-bitness payload (host={:?}, target={:?})",
                    host, target
                );
                prop_assert_eq!(
                    strategy.helper(),
                    None,
                    "a Direct strategy uses no inject-helper"
                );
            }

            // Cross-cutting biconditional (Req 2.2 vs 2.3): the helper is used
            // EXACTLY when host and target bitness differ.
            prop_assert_eq!(
                strategy.helper().is_some(),
                cross_bitness,
                "the inject-helper must be used exactly when bitness differs \
                 (host={:?}, target={:?})",
                host, target
            );
        }
    }
}
