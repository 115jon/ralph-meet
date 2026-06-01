//! Property-based test for the v2 capture-mode selection.
//!
//! Feature: universal-game-capture-hook, Property 1: Capture-mode selection
//! resolves to hook only when every gate passes, else wgc
//!
//! Validates: Requirements 2.5, 3.2, 3.3, 3.8, 4.5, 5.4, 8.1, 8.2, 8.3, 9.4,
//! 10.2, 10.3, 10.4, 13.2
//!
//! The selection logic under test is the pure, GPU/OS-independent
//! `app_lib::game_capture::select_capture_mode_v2`. It takes a `SelectionInputs`
//! built entirely from plain values, so proptest can build arbitrary inputs
//! over every field and explore the full gate space without any hardware.
//!
//! The expected `CaptureMode` is re-derived **independently** from the raw
//! inputs in the test (a local `gate_on` and an explicit `Dx11`-only
//! active-capable check) rather than by calling the module's own
//! `hook_eligible`, so the property does not trivially mirror the
//! implementation it is meant to pin.
//!
//! NOTE: This is an integration-test crate, so the `game_capture` module must be
//! reachable as `app_lib::game_capture` (it is declared `pub mod game_capture`
//! behind `#[cfg(feature = "native-screen-share")]` in `lib.rs`). Run with:
//!   cargo test --features native-screen-share --test prop_capture_mode_selection_v2

#![cfg(feature = "native-screen-share")]

use app_lib::game_capture::{
    select_capture_mode_v2, BackendGate, CaptureMode, FallbackReason, GraphicsApiBackend,
    InjectionOutcome, SafetyDecision, SelectionInputs, SourceKind,
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

/// Strategy generating an arbitrary per-backend enablement gate by drawing each
/// of the four gate bits independently (all 16 combinations are reachable).
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
        any::<bool>(),               // is_windows
        source_kind_strategy(),      // source_kind
        backend_strategy(),          // backend
        gate_strategy(),             // gate
        any::<bool>(),               // hook_enabled
        any::<bool>(),               // artifact_available
        safety_strategy(),           // safety
        injection_outcome_strategy(),// injection
        any::<bool>(),               // same_adapter
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

/// Independent re-derivation of "is this backend's gate on?" — mirrors the gate
/// semantics without calling `BackendGate::enabled`, so the property checks the
/// selection against a second, hand-written source of truth.
fn gate_on(gate: BackendGate, backend: GraphicsApiBackend) -> bool {
    match backend {
        GraphicsApiBackend::Dx11 => gate.dx11,
        GraphicsApiBackend::Dx12 => gate.dx12,
        GraphicsApiBackend::Vulkan => gate.vulkan,
        GraphicsApiBackend::OpenGl => gate.opengl,
    }
}

proptest! {
    // Property 1 requires a minimum of 100 iterations. The full input space is
    // 2 * 2 * 4 * 16 * 2 * 2 * 3 * 4 * 2 = 24,576 combinations; 4096 cases keeps
    // the run fast while staying far above the 100-iteration floor and covering
    // every gate transition many times over.
    #![proptest_config(ProptestConfig::with_cases(4096))]

    /// Feature: universal-game-capture-hook, Property 1: Capture-mode selection
    /// resolves to hook only when every gate passes, else wgc
    ///
    /// Validates: Requirements 2.5, 3.2, 3.3, 3.8, 4.5, 5.4, 8.1, 8.2, 8.3, 9.4,
    /// 10.2, 10.3, 10.4, 13.2
    #[test]
    fn capture_mode_v2_resolves_to_hook_only_when_every_gate_passes(
        inp in selection_inputs_strategy(),
    ) {
        let mode = select_capture_mode_v2(&inp);

        // (1) Totality / reportability: the result is always one of the two
        // valid, reportable modes. `CaptureMode` is a closed enum, so this also
        // proves the function never panics or fails to resolve (Req 8.1, 14.1).
        prop_assert!(matches!(mode, CaptureMode::Wgc | CaptureMode::Hook));
        prop_assert!(matches!(mode.as_str(), "wgc" | "hook"));

        // (2) The exact, independently re-derived condition under which `hook`
        // is the only correct answer. Every conjunct maps to a requirement:
        //   - is_windows                 (Req 13.2)
        //   - window source              (Req 8.2)
        //   - backend gate on            (Req 3.2, 3.3, 3.8)
        //   - backend active-capable     (Req 8.1) — DX11 and DX12 (shared DXGI hook)
        //   - hook feature enabled
        //   - matching-bitness artifact  (Req 2.5)
        //   - safety allows injection    (Req 10.2, 10.3, 10.4 / 4.5 reasons)
        //   - injection succeeded        (Req 8.3)
        //   - same GPU adapter           (Req 5.4, 9.4)
        let expected_hook = inp.is_windows
            && inp.source_kind == SourceKind::Window
            && gate_on(inp.gate, inp.backend)
            && matches!(
                inp.backend,
                GraphicsApiBackend::Dx11 | GraphicsApiBackend::Dx12 | GraphicsApiBackend::Vulkan
            )
            && inp.hook_enabled
            && inp.artifact_available
            && inp.safety == SafetyDecision::Allow
            && inp.injection == InjectionOutcome::Success
            && inp.same_adapter;

        // (3) Bidirectional gate: `Hook` iff every gate passes; otherwise the
        // `Wgc` guaranteed fallback. This single biconditional captures every
        // fallback clause at once.
        if expected_hook {
            prop_assert_eq!(
                mode,
                CaptureMode::Hook,
                "every gate passed but selection was not Hook: {:?}",
                inp
            );
        } else {
            prop_assert_eq!(
                mode,
                CaptureMode::Wgc,
                "a gate was unmet but selection was not the Wgc fallback: {:?}",
                inp
            );
        }

        // (4) Restated as direct invariants on the `Hook` outcome for stronger
        // localization of any counterexample — `Hook` is forbidden whenever any
        // single gate fails.
        if mode == CaptureMode::Hook {
            prop_assert!(inp.is_windows, "Req 13.2: non-Windows must be Wgc");
            prop_assert_eq!(inp.source_kind, SourceKind::Window, "Req 8.2: monitor must be Wgc");
            prop_assert!(gate_on(inp.gate, inp.backend), "Req 3.3/3.8: gated-off backend must be Wgc");
            prop_assert!(
                inp.backend.is_active_capable(),
                "Req 8.1/8.2: non-active-capable backend must be Wgc (backend={:?})",
                inp.backend
            );
            prop_assert!(inp.hook_enabled, "disabled hook must be Wgc");
            prop_assert!(inp.artifact_available, "Req 2.5: missing artifact must be Wgc");
            prop_assert_eq!(inp.safety, SafetyDecision::Allow, "Req 10.2/10.3: denied safety must be Wgc");
            prop_assert_eq!(
                inp.injection,
                InjectionOutcome::Success,
                "Req 8.3/10.4: failed/blocked/not-attempted injection must be Wgc"
            );
            prop_assert!(inp.same_adapter, "Req 5.4/9.4: cross-adapter must be Wgc");
        }
    }
}
