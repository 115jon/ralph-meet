//! Property-based test for the fallback-reason mapping.
//!
//! Feature: universal-game-capture-hook, Property 2: Fallback reason is None
//! exactly when the mode is hook, and otherwise names the first failing gate
//!
//! Validates: Requirements 2.5, 4.5, 5.4, 8.3, 8.4, 9.3, 9.4, 10.4
//!
//! The logic under test is the pure, GPU-/OS-independent
//! `app_lib::game_capture::{select_capture_mode_v2, fallback_reason}`. Both are
//! total functions over a small enum/bool input space, so proptest explores the
//! whole space many times over.
//!
//! The property has two parts:
//!   (a) `fallback_reason(&inp) == None`  IFF  `select_capture_mode_v2(&inp) == Hook`.
//!   (b) when the mode is `Wgc`, `fallback_reason` names the **first** failing
//!       gate in the documented order. We re-implement that ordered check
//!       independently below and assert the implementation agrees with it, then
//!       additionally assert the named reason actually corresponds to a gate
//!       that is unsatisfied for those inputs.
//!
//! The documented first-failing-gate order (design §7 / `game_capture::mod`):
//!   platform (NotWindows) -> monitor source (MonitorSource)
//!   -> hook disabled (HookDisabled) -> backend disabled (BackendDisabled)
//!   -> missing artifact (MissingArtifact)
//!   -> safety deny (Blocklisted / NotAllowlisted)
//!   -> injection (Blocked -> InjectionDenied, Failed/NotAttempted -> InjectionFailed)
//!   -> cross-adapter (CrossAdapter) -> else None.
//!
//! NOTE: This is an integration-test crate, so `game_capture` must be reachable
//! as `app_lib::game_capture` (declared `pub mod game_capture` behind
//! `#[cfg(feature = "native-screen-share")]` in `lib.rs`). Run with:
//!   cargo test --features native-screen-share --test prop_fallback_reason

#![cfg(feature = "native-screen-share")]

use app_lib::game_capture::{
    fallback_reason, select_capture_mode_v2, BackendGate, CaptureMode, FallbackReason,
    GraphicsApiBackend, InjectionOutcome, SafetyDecision, SelectionInputs, SourceKind,
};
use proptest::prelude::*;

/// Strategy generating every `SourceKind` variant.
fn source_kind_strategy() -> impl Strategy<Value = SourceKind> {
    prop_oneof![Just(SourceKind::Monitor), Just(SourceKind::Window)]
}

/// Strategy generating every `GraphicsApiBackend` variant (only `Dx11` is
/// active-capable; the rest are gated).
fn backend_strategy() -> impl Strategy<Value = GraphicsApiBackend> {
    prop_oneof![
        Just(GraphicsApiBackend::Dx11),
        Just(GraphicsApiBackend::Dx12),
        Just(GraphicsApiBackend::Vulkan),
        Just(GraphicsApiBackend::OpenGl),
    ]
}

/// Strategy generating every `InjectionOutcome` variant.
fn injection_outcome_strategy() -> impl Strategy<Value = InjectionOutcome> {
    prop_oneof![
        Just(InjectionOutcome::Success),
        Just(InjectionOutcome::Failed),
        Just(InjectionOutcome::Blocked),
        Just(InjectionOutcome::NotAttempted),
    ]
}

/// Strategy generating a `SafetyDecision`. A real `safety_decision` only ever
/// denies with `Blocklisted` or `NotAllowlisted`, so we constrain the generated
/// deny reason to those two — keeping the input space faithful and the
/// assertions meaningful.
fn safety_strategy() -> impl Strategy<Value = SafetyDecision> {
    prop_oneof![
        Just(SafetyDecision::Allow),
        Just(SafetyDecision::Deny(FallbackReason::Blocklisted)),
        Just(SafetyDecision::Deny(FallbackReason::NotAllowlisted)),
    ]
}

/// Strategy generating an arbitrary `BackendGate` over all 16 on/off combos.
fn gate_strategy() -> impl Strategy<Value = BackendGate> {
    (any::<bool>(), any::<bool>(), any::<bool>(), any::<bool>()).prop_map(
        |(dx11, dx12, vulkan, opengl)| BackendGate {
            dx11,
            dx12,
            vulkan,
            opengl,
        },
    )
}

/// Independent re-implementation of the documented first-failing-gate order.
/// This deliberately mirrors the contract (not the implementation), so the test
/// fails if the production gate order ever drifts from the documented order.
fn expected_reason(inp: &SelectionInputs) -> FallbackReason {
    if !inp.is_windows {
        return FallbackReason::NotWindows;
    }
    if inp.source_kind != SourceKind::Window {
        return FallbackReason::MonitorSource;
    }
    if !inp.hook_enabled {
        return FallbackReason::HookDisabled;
    }
    if !inp.gate.enabled(inp.backend) || !inp.backend.is_active_capable() {
        return FallbackReason::BackendDisabled;
    }
    if !inp.artifact_available {
        return FallbackReason::MissingArtifact;
    }
    if let SafetyDecision::Deny(reason) = inp.safety {
        return reason;
    }
    if !inp.injection.is_success() {
        return match inp.injection {
            InjectionOutcome::Blocked => FallbackReason::InjectionDenied,
            InjectionOutcome::Failed | InjectionOutcome::NotAttempted => {
                FallbackReason::InjectionFailed
            }
            // Unreachable on this branch: `is_success()` is false here.
            InjectionOutcome::Success => FallbackReason::InjectionFailed,
        };
    }
    if !inp.same_adapter {
        return FallbackReason::CrossAdapter;
    }
    FallbackReason::None
}

proptest! {
    // Property 2 requires a minimum of 100 iterations. The full input space is
    // 2 * 2 * 4 * 16 * 2 * 2 * 3 * 4 * 2 = 24_576 combinations, so 4096 cases
    // sample it broadly while staying far above the 100-iteration floor.
    #![proptest_config(ProptestConfig::with_cases(4096))]

    /// Feature: universal-game-capture-hook, Property 2: Fallback reason is None
    /// exactly when the mode is hook, and otherwise names the first failing gate
    ///
    /// Validates: Requirements 2.5, 4.5, 5.4, 8.3, 8.4, 9.3, 9.4, 10.4
    #[test]
    fn fallback_reason_is_none_iff_hook_else_first_failing_gate(
        is_windows in any::<bool>(),
        source_kind in source_kind_strategy(),
        backend in backend_strategy(),
        gate in gate_strategy(),
        hook_enabled in any::<bool>(),
        artifact_available in any::<bool>(),
        safety in safety_strategy(),
        injection in injection_outcome_strategy(),
        same_adapter in any::<bool>(),
    ) {
        let inp = SelectionInputs {
            is_windows,
            source_kind,
            backend,
            gate,
            hook_enabled,
            artifact_available,
            safety,
            injection,
            same_adapter,
        };

        let mode = select_capture_mode_v2(&inp);
        let reason = fallback_reason(&inp);

        // (a) Biconditional: `fallback_reason` is `None` iff the mode is `Hook`.
        prop_assert_eq!(
            reason == FallbackReason::None,
            mode == CaptureMode::Hook,
            "reason/mode disagreed: reason={:?}, mode={:?}, inputs={:?}",
            reason, mode, inp
        );

        if mode == CaptureMode::Hook {
            // Hook ⇒ no fallback reason.
            prop_assert_eq!(reason, FallbackReason::None);
        } else {
            // (b) Wgc ⇒ a concrete reason that matches the documented
            // first-failing-gate order (independently recomputed).
            prop_assert_ne!(reason, FallbackReason::None);
            prop_assert_eq!(
                reason,
                expected_reason(&inp),
                "fallback_reason disagreed with the documented gate order for inputs={:?}",
                inp
            );

            // The named reason must correspond to a gate that is *actually*
            // unsatisfied for these inputs — never an arbitrary label.
            match reason {
                FallbackReason::NotWindows => {
                    prop_assert!(!inp.is_windows);
                }
                FallbackReason::MonitorSource => {
                    prop_assert!(inp.is_windows);
                    prop_assert_eq!(inp.source_kind, SourceKind::Monitor);
                }
                FallbackReason::HookDisabled => {
                    prop_assert!(inp.is_windows);
                    prop_assert_eq!(inp.source_kind, SourceKind::Window);
                    prop_assert!(!inp.hook_enabled);
                }
                FallbackReason::BackendDisabled => {
                    prop_assert!(inp.is_windows);
                    prop_assert_eq!(inp.source_kind, SourceKind::Window);
                    prop_assert!(inp.hook_enabled);
                    prop_assert!(
                        !inp.gate.enabled(inp.backend) || !inp.backend.is_active_capable()
                    );
                }
                FallbackReason::MissingArtifact => {
                    prop_assert!(!inp.artifact_available);
                }
                FallbackReason::Blocklisted => {
                    prop_assert_eq!(
                        inp.safety,
                        SafetyDecision::Deny(FallbackReason::Blocklisted)
                    );
                }
                FallbackReason::NotAllowlisted => {
                    prop_assert_eq!(
                        inp.safety,
                        SafetyDecision::Deny(FallbackReason::NotAllowlisted)
                    );
                }
                FallbackReason::InjectionDenied => {
                    prop_assert_eq!(inp.safety, SafetyDecision::Allow);
                    prop_assert_eq!(inp.injection, InjectionOutcome::Blocked);
                }
                FallbackReason::InjectionFailed => {
                    prop_assert_eq!(inp.safety, SafetyDecision::Allow);
                    prop_assert!(matches!(
                        inp.injection,
                        InjectionOutcome::Failed | InjectionOutcome::NotAttempted
                    ));
                }
                FallbackReason::CrossAdapter => {
                    // Every earlier gate passed; only the adapter differs.
                    prop_assert!(inp.is_windows);
                    prop_assert_eq!(inp.source_kind, SourceKind::Window);
                    prop_assert!(inp.hook_enabled);
                    prop_assert!(inp.gate.enabled(inp.backend));
                    prop_assert!(inp.backend.is_active_capable());
                    prop_assert!(inp.artifact_available);
                    prop_assert_eq!(inp.safety, SafetyDecision::Allow);
                    prop_assert!(inp.injection.is_success());
                    prop_assert!(!inp.same_adapter);
                }
                // These reasons are raised by runtime orchestration mid-session,
                // never by the pure pre-flight selection, so they must not be
                // produced by `fallback_reason`.
                FallbackReason::InteropFailed
                | FallbackReason::TargetExited
                | FallbackReason::HookStoppedMidSession
                | FallbackReason::None => {
                    prop_assert!(
                        false,
                        "fallback_reason produced an unexpected reason {:?} for inputs={:?}",
                        reason, inp
                    );
                }
            }
        }
    }
}
