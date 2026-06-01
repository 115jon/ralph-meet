//! Property-based test for the fallback notification decision.
//!
//! Feature: universal-game-capture-hook, Property 3: Fallback notification fires
//! whenever the user could expect the hook but it is unavailable — including
//! success-but-unsafe
//!
//! Validates: Requirements 8.4, 10.6
//!
//! The decision under test is the pure, GPU-/OS-independent
//! `app_lib::game_capture::should_notify_unavailable`. It returns `true` iff the
//! user could reasonably have expected the zero-copy hook (a window source, on
//! Windows, with the hook enabled and the selected backend's gate on) but the
//! hook is not the active `Capture_Mode`. Crucially this **includes the
//! success-but-unsafe case** (Req 10.6): an injection that reports `Success` but
//! whose target is blocklisted / not-allowlisted must still notify, because the
//! safety gate overrides the reported success and falls back to WGC.
//!
//! Because the function is total over a small enum/bool input space, proptest
//! samples thousands of `SelectionInputs` and checks the result against an
//! **independently re-derived** predicate — `user_expected_hook && (mode != Hook)`
//! — computed here from the raw fields, so the test does not merely echo the
//! implementation.
//!
//! NOTE: This is an integration-test crate, so the `game_capture` module must be
//! reachable as `app_lib::game_capture` (declared `pub mod game_capture` behind
//! `#[cfg(feature = "native-screen-share")]` in `lib.rs`). Run with:
//!   cargo test --features native-screen-share --test prop_notify_unavailable

#![cfg(feature = "native-screen-share")]

use app_lib::game_capture::{
    select_capture_mode_v2, should_notify_unavailable, BackendGate, CaptureMode, FallbackReason,
    GraphicsApiBackend, InjectionOutcome, SafetyDecision, SelectionInputs, SourceKind,
};
use proptest::prelude::*;

// ───────────────────────────────────────────────────────────────────────────
// Strategies — generate the full `SelectionInputs` input space.
// ───────────────────────────────────────────────────────────────────────────

fn source_kind_strategy() -> impl Strategy<Value = SourceKind> {
    prop_oneof![Just(SourceKind::Monitor), Just(SourceKind::Window)]
}

fn backend_strategy() -> impl Strategy<Value = GraphicsApiBackend> {
    prop_oneof![
        Just(GraphicsApiBackend::Dx11),
        Just(GraphicsApiBackend::Dx12),
        Just(GraphicsApiBackend::Vulkan),
        Just(GraphicsApiBackend::OpenGl),
    ]
}

/// Every combination of the four per-backend enablement bits.
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

/// `Allow`, plus the two realistic `Deny` reasons the safety gate produces
/// (`Blocklisted` / `NotAllowlisted`). Any `Deny` makes the hook ineligible, so
/// generating both deny reasons exercises the success-but-unsafe path (Req 10.6).
fn safety_strategy() -> impl Strategy<Value = SafetyDecision> {
    prop_oneof![
        Just(SafetyDecision::Allow),
        Just(SafetyDecision::Deny(FallbackReason::Blocklisted)),
        Just(SafetyDecision::Deny(FallbackReason::NotAllowlisted)),
    ]
}

fn injection_strategy() -> impl Strategy<Value = InjectionOutcome> {
    prop_oneof![
        Just(InjectionOutcome::Success),
        Just(InjectionOutcome::Failed),
        Just(InjectionOutcome::Blocked),
        Just(InjectionOutcome::NotAttempted),
    ]
}

/// A uniformly-sampled `SelectionInputs` over the whole 24,576-combination space
/// (2 × 2 × 4 × 16 × 2 × 2 × 3 × 4 × 2).
fn selection_inputs_strategy() -> impl Strategy<Value = SelectionInputs> {
    (
        any::<bool>(),
        source_kind_strategy(),
        backend_strategy(),
        gate_strategy(),
        any::<bool>(),
        any::<bool>(),
        safety_strategy(),
        injection_strategy(),
        any::<bool>(),
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

// ───────────────────────────────────────────────────────────────────────────
// Independent re-derivation of the predicate — computed from the raw fields so
// the test is not a copy of the implementation under test.
// ───────────────────────────────────────────────────────────────────────────

/// Re-derive the per-backend gate bit by hand (independent of `BackendGate::enabled`).
fn gate_enabled(gate: &BackendGate, backend: GraphicsApiBackend) -> bool {
    match backend {
        GraphicsApiBackend::Dx11 => gate.dx11,
        GraphicsApiBackend::Dx12 => gate.dx12,
        GraphicsApiBackend::Vulkan => gate.vulkan,
        GraphicsApiBackend::OpenGl => gate.opengl,
    }
}

/// DX11, DX12, and Vulkan are active-capable (independent of
/// `GraphicsApiBackend::is_active_capable`). DX11/DX12 share the DXGI present
/// hook; Vulkan uses the implicit-layer + IPC path. OpenGL is not yet
/// active-capable.
fn active_capable(backend: GraphicsApiBackend) -> bool {
    matches!(
        backend,
        GraphicsApiBackend::Dx11 | GraphicsApiBackend::Dx12 | GraphicsApiBackend::Vulkan
    )
}

/// Whether every gate the `hook` Capture_Mode requires passes — i.e. `mode == Hook`.
/// Independent re-derivation of `select_capture_mode_v2`'s eligibility.
fn hook_eligible(inp: &SelectionInputs) -> bool {
    inp.is_windows
        && inp.source_kind == SourceKind::Window
        && gate_enabled(&inp.gate, inp.backend)
        && active_capable(inp.backend)
        && inp.hook_enabled
        && inp.artifact_available
        && inp.safety == SafetyDecision::Allow
        && matches!(inp.injection, InjectionOutcome::Success)
        && inp.same_adapter
}

/// The user could reasonably have expected the hook: window source, on Windows,
/// hook enabled, and the selected backend's gate on. (Monitor sources and a
/// disabled hook/feature/backend-gate mean the user never expected it.)
fn user_expected_hook(inp: &SelectionInputs) -> bool {
    inp.is_windows
        && inp.source_kind == SourceKind::Window
        && inp.hook_enabled
        && gate_enabled(&inp.gate, inp.backend)
}

/// The independently re-derived notification predicate: notify iff the user
/// expected the hook AND the hook is unavailable (`mode != Hook`).
fn expected_notify(inp: &SelectionInputs) -> bool {
    user_expected_hook(inp) && !hook_eligible(inp)
}

proptest! {
    // Property 3 requires a minimum of 100 iterations. 2048 random cases sample
    // the 24,576-combination space heavily while staying far above the floor.
    #![proptest_config(ProptestConfig::with_cases(2048))]

    /// Feature: universal-game-capture-hook, Property 3: Fallback notification
    /// fires whenever the user could expect the hook but it is unavailable —
    /// including success-but-unsafe.
    ///
    /// Validates: Requirements 8.4, 10.6
    #[test]
    fn fallback_notification_matches_expected_predicate(inp in selection_inputs_strategy()) {
        let got = should_notify_unavailable(&inp);
        let expected = expected_notify(&inp);

        // (1) Core equivalence: the decision equals the independently re-derived
        // predicate `user_expected_hook && (mode != Hook)` for every input.
        prop_assert_eq!(
            got,
            expected,
            "notify decision disagreed with re-derived predicate for inp={:?}",
            inp
        );

        // (2) Whenever we notify, the user expected the hook and it is in fact
        // unavailable — the session is on the WGC fallback, never `hook`
        // (Req 8.4). Cross-checked against the real selection function.
        if got {
            prop_assert!(
                user_expected_hook(&inp),
                "notified without the user expecting the hook: {:?}",
                inp
            );
            prop_assert!(
                !hook_eligible(&inp),
                "notified while the hook was actually eligible: {:?}",
                inp
            );
            prop_assert_eq!(
                select_capture_mode_v2(&inp),
                CaptureMode::Wgc,
                "a notification must coincide with the WGC fallback: {:?}",
                inp
            );
        }

        // (3) Silent cases (Req 8.4): a monitor source, a non-Windows platform,
        // a disabled hook, or a backend whose gate is off all mean the user
        // never expected the hook, so the decision must be silent regardless of
        // any later gate.
        if inp.source_kind == SourceKind::Monitor
            || !inp.is_windows
            || !inp.hook_enabled
            || !gate_enabled(&inp.gate, inp.backend)
        {
            prop_assert!(!got, "expected silence for a not-expected-hook input: {:?}", inp);
        }

        // (4) A genuinely-available hook (mode == Hook) never notifies.
        if hook_eligible(&inp) {
            prop_assert!(!got, "notified while the hook was active: {:?}", inp);
            prop_assert_eq!(select_capture_mode_v2(&inp), CaptureMode::Hook);
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Targeted explicit cases — pin down the specific scenarios the requirements
// call out, alongside the randomized property above.
// ───────────────────────────────────────────────────────────────────────────

/// A `SelectionInputs` whose every gate passes, so the hook is the active mode.
/// Targeted cases mutate one field to drive a specific (un)availability.
fn all_pass() -> SelectionInputs {
    SelectionInputs {
        is_windows: true,
        source_kind: SourceKind::Window,
        backend: GraphicsApiBackend::Dx11,
        gate: BackendGate::dx11_only(),
        hook_enabled: true,
        artifact_available: true,
        safety: SafetyDecision::Allow,
        injection: InjectionOutcome::Success,
        same_adapter: true,
    }
}

/// Success-but-unsafe (Req 10.6): injection reported `Success`, but the target
/// is blocklisted, so the session falls back to WGC and the user IS notified.
#[test]
fn success_but_blocklisted_notifies() {
    let mut inp = all_pass();
    inp.safety = SafetyDecision::Deny(FallbackReason::Blocklisted);
    assert_eq!(
        inp.injection,
        InjectionOutcome::Success,
        "guard: the injection genuinely reported success"
    );
    assert_eq!(select_capture_mode_v2(&inp), CaptureMode::Wgc);
    assert!(
        should_notify_unavailable(&inp),
        "a blocklisted target with a reported injection success must still notify (Req 10.6)"
    );
}

/// Success-but-unsafe variant: a configured allowlist the target does not match
/// (Req 10.6) also notifies despite a reported injection success.
#[test]
fn success_but_not_allowlisted_notifies() {
    let mut inp = all_pass();
    inp.safety = SafetyDecision::Deny(FallbackReason::NotAllowlisted);
    assert_eq!(inp.injection, InjectionOutcome::Success);
    assert!(should_notify_unavailable(&inp));
}

/// A monitor source is always WGC and the user never expected the hook, so it
/// never notifies — even with every other gate satisfied (Req 8.4).
#[test]
fn monitor_source_never_notifies() {
    let mut inp = all_pass();
    inp.source_kind = SourceKind::Monitor;
    assert!(!should_notify_unavailable(&inp));
}

/// A non-Windows platform never attempts the hook and never notifies (Req 13.2 / 8.4).
#[test]
fn non_windows_never_notifies() {
    let mut inp = all_pass();
    inp.is_windows = false;
    assert!(!should_notify_unavailable(&inp));
}

/// A disabled hook means the user never expected it — silent (Req 8.4).
#[test]
fn disabled_hook_never_notifies() {
    let mut inp = all_pass();
    inp.hook_enabled = false;
    assert!(!should_notify_unavailable(&inp));
}

/// A backend whose enablement gate is off is an internal incremental-rollout
/// detail, so the user is not treated as having expected the hook — silent.
#[test]
fn disabled_backend_gate_never_notifies() {
    // Selected backend is DX11 but its gate bit is off.
    let mut inp = all_pass();
    inp.gate = BackendGate {
        dx11: false,
        dx12: false,
        vulkan: false,
        opengl: false,
    };
    assert!(!should_notify_unavailable(&inp));

    // Also: a DX12 source while only DX11 is gated on.
    let mut inp = all_pass();
    inp.backend = GraphicsApiBackend::Dx12;
    inp.gate = BackendGate::dx11_only();
    assert!(!should_notify_unavailable(&inp));
}

/// A genuinely-available hook (every gate passes ⇒ mode == Hook) does not notify.
#[test]
fn available_hook_does_not_notify() {
    let inp = all_pass();
    assert_eq!(select_capture_mode_v2(&inp), CaptureMode::Hook);
    assert!(!should_notify_unavailable(&inp));
}

/// An unavailable-but-expected hook from a missing artifact notifies (Req 8.4).
#[test]
fn missing_artifact_notifies() {
    let mut inp = all_pass();
    inp.artifact_available = false;
    assert_eq!(select_capture_mode_v2(&inp), CaptureMode::Wgc);
    assert!(should_notify_unavailable(&inp));
}

/// An anti-cheat / denied injection on an expected hook notifies (Req 8.4, 10.4).
#[test]
fn injection_denied_notifies() {
    let mut inp = all_pass();
    inp.injection = InjectionOutcome::Blocked;
    assert!(should_notify_unavailable(&inp));
}

/// A cross-adapter fallback on an expected hook notifies (Req 8.4, 9.4).
#[test]
fn cross_adapter_notifies() {
    let mut inp = all_pass();
    inp.same_adapter = false;
    assert_eq!(select_capture_mode_v2(&inp), CaptureMode::Wgc);
    assert!(should_notify_unavailable(&inp));
}
