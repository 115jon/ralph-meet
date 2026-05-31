//! Property-based test for capture-policy application (Property 2).
//!
//! Feature: owned-game-capture-hook, Property 2: Capture-policy application is
//! total and routes every case correctly
//!
//! Validates: Requirements 3.5, 4.2, 4.5, 4.6, 5.2, 5.3, 5.4
//!
//! The logic under test is the pure, GPU-/OS-independent
//! `app_lib::game_capture::apply_capture_policy`, which wraps the unchanged
//! `select_capture_mode_v2` and consults the resolved `CapturePolicy` only for
//! the *else* branch (a source that could have used the hook but did not).
//! Because every input is a plain value, proptest explores the full
//! `SelectionInputs` × `CapturePolicy` space many times over without hardware.
//!
//! The property statement (design §Correctness Properties, Property 2):
//!   For any `SelectionInputs` and for any `CapturePolicy`,
//!   `apply_capture_policy` returns exactly one `CaptureResolution` such that:
//!     - it returns `Hook` whenever `select_capture_mode_v2` returns `Hook`
//!       (for *both* policies, never starting WGC in that case);
//!     - it returns `Wgc` for a monitor source under *either* policy;
//!     - for a hook-eligible window source whose pure mode is `Wgc` it returns
//!       `Wgc` carrying `fallback_reason(inputs)` under `wgc-enabled` and
//!       `Unavailable` carrying `fallback_reason(inputs)` under `hook-exclusive`;
//!     - any reason it carries is exactly the reason `fallback_reason` reports
//!       for those inputs.
//!
//! The expected `CaptureResolution` is re-derived **independently** below from
//! the documented routing contract (described in terms of `select_capture_mode_v2`
//! and `fallback_reason`, exactly as the property is stated), and the test also
//! asserts each individual clause of the property so a counterexample localizes
//! to the specific routing rule it breaks.
//!
//! NOTE: This is an integration-test crate, so `game_capture` must be reachable
//! as `app_lib::game_capture` (declared `pub mod game_capture` behind
//! `#[cfg(feature = "native-screen-share")]` in `lib.rs`). Run with:
//!   cargo test --features native-screen-share --test prop_capture_policy

#![cfg(feature = "native-screen-share")]

use app_lib::game_capture::{
    apply_capture_policy, fallback_reason, select_capture_mode_v2, BackendGate, CaptureMode,
    CapturePolicy, CaptureResolution, FallbackReason, GraphicsApiBackend, InjectionOutcome,
    SafetyDecision, SelectionInputs, SourceKind,
};
use proptest::prelude::*;

// ───────────────────────────────────────────────────────────────────────────
// Strategies — generate the full `SelectionInputs` × `CapturePolicy` space.
// (Mirrors the strategies used by the sibling v2-selection / fallback-reason
// property tests so the input coverage is identical.)
// ───────────────────────────────────────────────────────────────────────────

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

/// Strategy generating an arbitrary per-backend enablement gate over all 16
/// on/off combinations.
fn gate_strategy() -> impl Strategy<Value = BackendGate> {
    (
        any::<bool>(),
        any::<bool>(),
        any::<bool>(),
        any::<bool>(),
    )
        .prop_map(|(dx11, dx12, vulkan, opengl)| BackendGate {
            dx11,
            dx12,
            vulkan,
            opengl,
        })
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

/// Strategy generating the safety decision: `Allow`, or one of the two
/// realistic `Deny` reasons (blocklisted / not-allowlisted) the design assigns
/// to the safety gate (Req 10.2, 10.3).
fn safety_strategy() -> impl Strategy<Value = SafetyDecision> {
    prop_oneof![
        Just(SafetyDecision::Allow),
        Just(SafetyDecision::Deny(FallbackReason::Blocklisted)),
        Just(SafetyDecision::Deny(FallbackReason::NotAllowlisted)),
    ]
}

/// Strategy generating an arbitrary `SelectionInputs` over the full field space.
fn selection_inputs_strategy() -> impl Strategy<Value = SelectionInputs> {
    (
        any::<bool>(),                // is_windows
        source_kind_strategy(),       // source_kind
        backend_strategy(),           // backend
        gate_strategy(),              // gate
        any::<bool>(),                // hook_enabled
        any::<bool>(),                // artifact_available
        safety_strategy(),            // safety
        injection_outcome_strategy(), // injection
        any::<bool>(),                // same_adapter
    )
        .prop_map(
            |(
                is_windows,
                source_kind,
                backend,
                gate,
                hook_enabled,
                artifact_available,
                safety,
                injection,
                same_adapter,
            )| SelectionInputs {
                is_windows,
                source_kind,
                backend,
                gate,
                hook_enabled,
                artifact_available,
                safety,
                injection,
                same_adapter,
            },
        )
}

/// Strategy generating both `CapturePolicy` settings.
fn policy_strategy() -> impl Strategy<Value = CapturePolicy> {
    prop_oneof![
        Just(CapturePolicy::HookExclusive),
        Just(CapturePolicy::WgcEnabled),
    ]
}

/// Independent re-derivation of the documented routing contract, expressed in
/// terms of `select_capture_mode_v2` and `fallback_reason` exactly as the
/// property is stated. This is the oracle the implementation is checked
/// against.
fn expected_resolution(inp: &SelectionInputs, policy: CapturePolicy) -> CaptureResolution {
    // Hook stays Hook for both policies (never WGC) — Req 4.2.
    if select_capture_mode_v2(inp) == CaptureMode::Hook {
        return CaptureResolution::Hook;
    }
    // The carried reason is exactly what `fallback_reason` reports.
    let reason = fallback_reason(inp);
    // Monitor sources are never hook candidates: WGC under either policy
    // (Req 4.5, 5.4).
    if inp.source_kind == SourceKind::Monitor {
        return CaptureResolution::Wgc { reason };
    }
    // Hook-eligible window whose pure mode is `Wgc`: the policy decides.
    match policy {
        CapturePolicy::WgcEnabled => CaptureResolution::Wgc { reason }, // Req 5.2
        CapturePolicy::HookExclusive => CaptureResolution::Unavailable { reason }, // Req 5.3
    }
}

/// Assert every clause of Property 2 for one `(inp, policy)` pair. Factored out
/// so the test can also exercise *both* policies on the same inputs (to pin the
/// "for both policies" / "under either policy" sub-clauses directly).
fn assert_property(inp: &SelectionInputs, policy: CapturePolicy) -> Result<(), TestCaseError> {
    let resolution = apply_capture_policy(inp, policy);
    let pure_mode = select_capture_mode_v2(inp);
    let reason = fallback_reason(inp);

    // (0) Totality: the result is always exactly one of the three closed
    // `CaptureResolution` variants — the function never panics or fails to
    // resolve, for any input/policy pair. (An explicit message is supplied so
    // `prop_assert!` does not stringify the `matches!` pattern; the `{ .. }`
    // brace patterns would otherwise be misread as format placeholders.)
    let is_valid_variant = matches!(
        resolution,
        CaptureResolution::Hook
            | CaptureResolution::Wgc { .. }
            | CaptureResolution::Unavailable { .. }
    );
    prop_assert!(
        is_valid_variant,
        "apply_capture_policy did not return a valid CaptureResolution variant for inputs={:?}, policy={:?}",
        inp,
        policy
    );

    // (1) Agreement with the independently re-derived oracle (the whole
    // contract at once).
    prop_assert_eq!(
        resolution,
        expected_resolution(inp, policy),
        "apply_capture_policy disagreed with the documented routing for inputs={:?}, policy={:?}",
        inp,
        policy
    );

    // (2) Individual clauses of the property, for sharper counterexample
    // localization:
    match resolution {
        CaptureResolution::Hook => {
            // Hook is returned only when the pure selection is Hook (Req 4.2),
            // and in that case WGC is never started — the resolution carries no
            // fallback reason at all.
            prop_assert_eq!(
                pure_mode,
                CaptureMode::Hook,
                "resolution was Hook but the pure mode was not Hook: inputs={:?}",
                inp
            );
        }
        CaptureResolution::Wgc { reason: carried } => {
            // WGC is only reached when the pure mode is not Hook.
            prop_assert_eq!(
                pure_mode,
                CaptureMode::Wgc,
                "resolution was Wgc but the pure mode was Hook: inputs={:?}",
                inp
            );
            // The carried reason is exactly `fallback_reason(inp)`.
            prop_assert_eq!(
                carried,
                reason,
                "Wgc carried a reason that disagreed with fallback_reason for inputs={:?}",
                inp
            );
            // Wgc arises in exactly two situations: a monitor source (under
            // either policy) or a hook-eligible window under `wgc-enabled`
            // (Req 4.5, 5.2, 5.4).
            let monitor = inp.source_kind == SourceKind::Monitor;
            let window_wgc_enabled =
                inp.source_kind == SourceKind::Window && policy == CapturePolicy::WgcEnabled;
            prop_assert!(
                monitor || window_wgc_enabled,
                "Wgc resolved for an unexpected (source, policy) combination: inputs={:?}, policy={:?}",
                inp,
                policy
            );
        }
        CaptureResolution::Unavailable { reason: carried } => {
            // Unavailable is only reached when the pure mode is not Hook.
            prop_assert_eq!(
                pure_mode,
                CaptureMode::Wgc,
                "resolution was Unavailable but the pure mode was Hook: inputs={:?}",
                inp
            );
            // The carried reason is exactly `fallback_reason(inp)`.
            prop_assert_eq!(
                carried,
                reason,
                "Unavailable carried a reason that disagreed with fallback_reason for inputs={:?}",
                inp
            );
            // Unavailable arises only for a hook-eligible window source under
            // `hook-exclusive` (Req 5.3); never for a monitor source, and never
            // under `wgc-enabled`.
            prop_assert_eq!(
                inp.source_kind,
                SourceKind::Window,
                "Unavailable resolved for a non-window source: inputs={:?}",
                inp
            );
            prop_assert_eq!(
                policy,
                CapturePolicy::HookExclusive,
                "Unavailable resolved under a non-hook-exclusive policy: inputs={:?}",
                inp
            );
        }
    }

    Ok(())
}

proptest! {
    // Property 2 requires a minimum of 100 iterations. The `SelectionInputs`
    // space is 2 * 2 * 4 * 16 * 2 * 2 * 3 * 4 * 2 = 24,576 combinations, and we
    // additionally fan each case out over both policies, so 4096 generated
    // cases sample the space broadly while staying far above the 100-iteration
    // floor.
    #![proptest_config(ProptestConfig::with_cases(4096))]

    /// Feature: owned-game-capture-hook, Property 2: Capture-policy application
    /// is total and routes every case correctly
    ///
    /// Validates: Requirements 3.5, 4.2, 4.5, 4.6, 5.2, 5.3, 5.4
    #[test]
    fn capture_policy_application_is_total_and_routes_every_case(
        inp in selection_inputs_strategy(),
        policy in policy_strategy(),
    ) {
        // Check the generated (inputs, policy) pair.
        assert_property(&inp, policy)?;

        // Additionally pin the "for both policies" / "under either policy"
        // sub-clauses by exercising the *same* inputs under both policies:
        //   - when the pure mode is Hook, the resolution is Hook regardless of
        //     policy (Req 4.2);
        //   - a monitor source resolves to the same Wgc regardless of policy
        //     (Req 4.5, 5.4).
        let hook_excl = apply_capture_policy(&inp, CapturePolicy::HookExclusive);
        let wgc_en = apply_capture_policy(&inp, CapturePolicy::WgcEnabled);

        if select_capture_mode_v2(&inp) == CaptureMode::Hook {
            prop_assert_eq!(hook_excl, CaptureResolution::Hook, "Hook must hold under hook-exclusive: {:?}", inp);
            prop_assert_eq!(wgc_en, CaptureResolution::Hook, "Hook must hold under wgc-enabled: {:?}", inp);
        } else if inp.source_kind == SourceKind::Monitor {
            let expected = CaptureResolution::Wgc { reason: fallback_reason(&inp) };
            prop_assert_eq!(hook_excl, expected, "monitor must be Wgc under hook-exclusive: {:?}", inp);
            prop_assert_eq!(wgc_en, expected, "monitor must be Wgc under wgc-enabled: {:?}", inp);
        } else {
            // A hook-eligible window whose pure mode is Wgc: the two policies
            // must split — wgc-enabled falls back to WGC (Req 5.2), while
            // hook-exclusive reports capture-unavailable (Req 5.3) — and both
            // carry the same fallback reason.
            let reason = fallback_reason(&inp);
            prop_assert_eq!(wgc_en, CaptureResolution::Wgc { reason }, "window under wgc-enabled must fall back to Wgc: {:?}", inp);
            prop_assert_eq!(hook_excl, CaptureResolution::Unavailable { reason }, "window under hook-exclusive must be Unavailable: {:?}", inp);
        }
    }
}
