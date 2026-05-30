//! Property-based test for capture-mode selection.
//!
//! Feature: screen-share-zero-overhead, Property 7: Capture-mode selection
//! always resolves to a valid, reportable mode — returns `Hook` only when the
//! source is a DX11 window with the hook enabled, DX11 ready, and injection
//! succeeded; in every other case it returns `Wgc`.
//!
//! Validates: Requirements 6.1, 6.2, 6.3, 7.3, 7.4, 8.2, 8.3
//!
//! The selection logic under test is the pure, GPU/OS-independent
//! `app_lib::game_capture::select_capture_mode`. Because it is a total function
//! over a small enum/bool input space, proptest exhaustively explores every
//! combination across at least 100 iterations.
//!
//! NOTE: This is an integration-test crate, so the `game_capture` module must be
//! reachable as `app_lib::game_capture` (it is declared `pub mod game_capture`
//! behind `#[cfg(feature = "native-screen-share")]` in `lib.rs`). Run with:
//!   cargo test --features native-screen-share --test prop_capture_mode_selection

#![cfg(feature = "native-screen-share")]

use app_lib::game_capture::{
    select_capture_mode, CaptureMode, GraphicsApiBackend, InjectionOutcome, SourceKind,
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

proptest! {
    // Property 7 requires a minimum of 100 iterations. The full input space is
    // 2 * 4 * 2 * 2 * 4 = 128 combinations, so 1024 cases covers it many times
    // over while staying well above the 100-iteration floor.
    #![proptest_config(ProptestConfig::with_cases(1024))]

    /// Feature: screen-share-zero-overhead, Property 7: Capture-mode selection
    /// always resolves to a valid, reportable mode.
    ///
    /// Validates: Requirements 6.1, 6.2, 6.3, 7.3, 7.4, 8.2, 8.3
    #[test]
    fn capture_mode_selection_resolves_to_valid_reportable_mode(
        source_kind in source_kind_strategy(),
        backend in backend_strategy(),
        hook_enabled in any::<bool>(),
        dx11_ready in any::<bool>(),
        injection_outcome in injection_outcome_strategy(),
    ) {
        let mode = select_capture_mode(
            source_kind,
            backend,
            hook_enabled,
            dx11_ready,
            injection_outcome,
        );

        // (1) Totality / reportability: the result is always a valid CaptureMode
        // whose stable string form is one of the two documented values. Because
        // `CaptureMode` is a closed enum this also proves the function never
        // panics or fails to resolve for any input (Req 6.1, 6.5, 7.3).
        prop_assert!(matches!(mode, CaptureMode::Wgc | CaptureMode::Hook));
        prop_assert!(matches!(mode.as_str(), "wgc" | "hook"));

        // The exact conditions under which `hook` is the *only* correct answer
        // (Req 7.3): a DX11 window, hook enabled, DX11 ready, injection success.
        let expected_hook = source_kind == SourceKind::Window
            && backend == GraphicsApiBackend::Dx11
            && hook_enabled
            && dx11_ready
            && injection_outcome == InjectionOutcome::Success;

        // (2) Hook-iff condition: `Hook` is returned if and only if every hook
        // precondition holds; otherwise `Wgc`. This single biconditional
        // captures every fallback clause:
        //   - monitor source             -> Wgc (Req 6.2)
        //   - hook disabled              -> Wgc (Req 6.1)
        //   - non-DX11 / DX11 not proven -> Wgc (Req 8.2, 8.3)
        //   - injection fail/block/none  -> Wgc (Req 6.3, 7.4)
        if expected_hook {
            prop_assert_eq!(
                mode,
                CaptureMode::Hook,
                "all hook preconditions held but selection was not Hook"
            );
        } else {
            prop_assert_eq!(
                mode,
                CaptureMode::Wgc,
                "a hook precondition was unmet but selection was not the Wgc fallback \
                 (source={:?}, backend={:?}, hook_enabled={}, dx11_ready={}, injection={:?})",
                source_kind,
                backend,
                hook_enabled,
                dx11_ready,
                injection_outcome
            );
        }

        // (3) Hook is never selected for any case the requirements forbid,
        // restated as direct invariants for clarity and stronger localization
        // of a counterexample.
        if mode == CaptureMode::Hook {
            prop_assert_eq!(source_kind, SourceKind::Window, "Req 6.2: monitor must be Wgc");
            prop_assert_eq!(backend, GraphicsApiBackend::Dx11, "Req 8.2/8.3: non-DX11 must be Wgc");
            prop_assert!(backend.is_active_capable(), "Req 8.1/8.2: backend must be active-capable");
            prop_assert!(hook_enabled, "Req 6.1: disabled hook must be Wgc");
            prop_assert!(dx11_ready, "Req 8.2: DX11 not proven must be Wgc");
            prop_assert_eq!(
                injection_outcome,
                InjectionOutcome::Success,
                "Req 6.3/7.4: failed/blocked/not-attempted injection must be Wgc"
            );
        }
    }
}
