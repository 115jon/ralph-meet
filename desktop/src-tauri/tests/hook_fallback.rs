//! Unit tests for the DX11 game-capture hook fallback, user notification, and
//! teardown contract (Tier 3).
//!
//! Validates: Requirements 6.3, 7.4, 7.5
//!   - 6.3: an injection failure / anti-cheat block falls back to WGC and the
//!          session continues rather than terminating.
//!   - 7.4: that fallback ALSO surfaces a user-facing notification that
//!          zero-copy hook capture is unavailable.
//!   - 7.5: on stop the hook detaches and releases its shared surfaces; this is
//!          idempotent and leaks nothing.
//!
//! # Why this models the CONTRACT at the public seams instead of a live session
//!
//! The real fallback lives inside the `start_native_screen_share` Tauri command,
//! which cannot run in CI: it needs a Tauri `AppHandle` (for `emit`), a D3D11
//! GPU device (`D3dDevice::new`), a live WebRTC peer connection, and — for the
//! `hook` path — a real injected payload inside a DX11 game process. None of
//! those exist on a headless runner, and a fully mocked `Dx11Hook` session
//! cannot be *constructed* either: a `Dx11Hook` only comes from
//! `Dx11Hook::try_attach`, whose `Success` arm requires a real `OpenProcess` +
//! `CreateRemoteThread` injection against a live target (the live detach path is
//! therefore exercised by the hardware-gated `integration_dx11_hook.rs`).
//!
//! So this test asserts the *decisions and structural guarantees* the command
//! is built from, at their public, GPU-free seams:
//!   1. Fallback decision (Req 6.3, 7.4): `select_capture_mode(..., Failed)` and
//!      `(..., Blocked)` both resolve to `Wgc` — the session keeps a valid,
//!      reportable mode rather than terminating.
//!   2. Backend guard (Req 7.5 teardown precondition): a non-DX11 backend
//!      `try_attach` is `NotAttempted` and yields **no** hook, so there is
//!      nothing to detach/leak on that path.
//!   3. Notification decision (Req 7.4): the pure
//!      `should_notify_hook_unavailable(outcome)` predicate that drives the
//!      `native-screen-share-status` "hook-unavailable…" emit is true exactly
//!      for `Failed`/`Blocked` across all four `InjectionOutcome` variants.
//!   4. Teardown shape (Req 7.5): a `NotAttempted` `AttachResult` carries
//!      `hook: None`, documenting that the WGC-fallback path holds no hook to
//!      release; the live `detach()` idempotency is covered on hardware by
//!      `integration_dx11_hook.rs`.
//!
//! Run with:
//!   cargo test --features native-screen-share --test hook_fallback

#![cfg(feature = "native-screen-share")]

use app_lib::game_capture::dx11::{AttachResult, Dx11Hook};
use app_lib::game_capture::{
    select_capture_mode, CaptureMode, GraphicsApiBackend, InjectionOutcome, SourceKind,
};
use app_lib::native_share::should_notify_hook_unavailable;

/// Every `InjectionOutcome` variant, so the contract assertions are exhaustive.
const ALL_OUTCOMES: [InjectionOutcome; 4] = [
    InjectionOutcome::Success,
    InjectionOutcome::Failed,
    InjectionOutcome::Blocked,
    InjectionOutcome::NotAttempted,
];

// ── Req 6.3 / 7.4: injection failure or block falls back to WGC ────────────

/// A hook attempt that **failed** must resolve the session's `Capture_Mode` to
/// `Wgc` — proving the session falls back to the proven WGC pipeline rather than
/// terminating (Req 6.3, 7.4). Asserted for a DX11 window with every other hook
/// precondition satisfied, so the *only* reason for the fallback is the failed
/// injection.
#[test]
fn injection_failure_falls_back_to_wgc() {
    let mode = select_capture_mode(
        SourceKind::Window,
        GraphicsApiBackend::Dx11,
        /* hook_enabled */ true,
        /* dx11_ready */ true,
        InjectionOutcome::Failed,
    );
    assert_eq!(
        mode,
        CaptureMode::Wgc,
        "a failed injection must continue the session on the WGC fallback (Req 6.3, 7.4)"
    );
}

/// An anti-cheat **block** must likewise fall back to `Wgc` (Req 6.3, 7.4).
#[test]
fn injection_block_falls_back_to_wgc() {
    let mode = select_capture_mode(
        SourceKind::Window,
        GraphicsApiBackend::Dx11,
        /* hook_enabled */ true,
        /* dx11_ready */ true,
        InjectionOutcome::Blocked,
    );
    assert_eq!(
        mode,
        CaptureMode::Wgc,
        "an anti-cheat block must continue the session on the WGC fallback (Req 6.3, 7.4)"
    );
}

/// Both non-success "attempted" outcomes resolve to a *valid, reportable* mode
/// (`Wgc`) — the session never ends up without a capture mode (Req 6.3).
#[test]
fn failed_and_blocked_both_resolve_to_reportable_wgc() {
    for outcome in [InjectionOutcome::Failed, InjectionOutcome::Blocked] {
        let mode = select_capture_mode(
            SourceKind::Window,
            GraphicsApiBackend::Dx11,
            true,
            true,
            outcome,
        );
        assert_eq!(mode, CaptureMode::Wgc, "{outcome:?} must fall back to WGC");
        // Reportable through NativeShareStats as the stable "wgc" string.
        assert_eq!(mode.as_str(), "wgc");
    }
}

// ── Req 7.4: the fallback emits a user notification ────────────────────────

/// The notification *decision* that drives the `native-screen-share-status`
/// "hook-unavailable…" emit must fire exactly for the two fallback-with-notice
/// outcomes — `Failed` and `Blocked` — and stay silent for `Success` (hook is
/// active) and `NotAttempted` (WGC was always going to be used). Asserted for
/// every `InjectionOutcome` so the predicate is total (Req 7.4).
#[test]
fn notification_fires_exactly_for_failed_and_blocked() {
    for outcome in ALL_OUTCOMES {
        let expected = matches!(
            outcome,
            InjectionOutcome::Failed | InjectionOutcome::Blocked
        );
        assert_eq!(
            should_notify_hook_unavailable(outcome),
            expected,
            "notification decision for {outcome:?} should be {expected}"
        );
    }
}

/// Cross-check: whenever the notification fires, the session is on the WGC
/// fallback (never `hook`) — the notice and the fallback are consistent, so a
/// user is told "zero-copy unavailable" iff zero-copy is in fact not active
/// (Req 6.3, 7.4).
#[test]
fn notification_implies_wgc_fallback() {
    for outcome in ALL_OUTCOMES {
        let mode = select_capture_mode(
            SourceKind::Window,
            GraphicsApiBackend::Dx11,
            true,
            true,
            outcome,
        );
        if should_notify_hook_unavailable(outcome) {
            assert_eq!(
                mode,
                CaptureMode::Wgc,
                "a hook-unavailable notification must coincide with the WGC fallback"
            );
        }
        // A successful injection is the only case that both selects `hook` and
        // is silent.
        if mode == CaptureMode::Hook {
            assert!(
                !should_notify_hook_unavailable(outcome),
                "the active hook mode must not raise the unavailable notification"
            );
        }
    }
}

// ── Req 7.5: teardown — no hook on the fallback path means nothing to leak ──

/// The backend guard in `try_attach` short-circuits a non-DX11 backend to
/// `InjectionOutcome::NotAttempted` *before* touching the GPU or the target
/// process, producing **no** `Dx11Hook`. This is the GPU-free teardown
/// guarantee: on any non-hook path there is no shared surface or process handle
/// to release, so detach is a no-op by construction (Req 7.5, and the backend
/// gating of Req 8.1/8.2).
///
/// `try_attach` takes `&Arc<D3dDevice>`, but the guard returns before the device
/// is dereferenced. We still avoid requiring a GPU by skipping gracefully if a
/// real device cannot be created — though on the guard path it is never used.
#[test]
fn non_dx11_attach_produces_no_hook_to_release() {
    let Some(d3d) = try_create_device() else {
        eprintln!(
            "[hook_fallback] SKIP non_dx11_attach_produces_no_hook_to_release: no D3D11 device \
             (headless CI). The same backend-guard contract is covered GPU-free by the dx11.rs \
             unit tests; the live detach/release path is exercised by integration_dx11_hook.rs."
        );
        return;
    };

    for backend in [
        GraphicsApiBackend::Dx12,
        GraphicsApiBackend::Vulkan,
        GraphicsApiBackend::OpenGl,
    ] {
        let result: AttachResult = Dx11Hook::try_attach(&d3d, /* hwnd */ 0, backend);
        assert_eq!(
            result.outcome,
            InjectionOutcome::NotAttempted,
            "non-DX11 backend {backend:?} must not be attempted"
        );
        assert!(
            result.hook.is_none(),
            "a NotAttempted attach must carry no hook, so there is nothing to detach/release \
             on the WGC fallback path (Req 7.5)"
        );
        assert!(
            !result.detail.is_empty(),
            "a skipped attach should explain why for logs/notifications"
        );
    }
}

/// Documents the teardown invariant in pure form: a `NotAttempted` outcome is
/// never a success and so never authorizes the `hook` mode, which is why the
/// fallback path holds no hook to tear down. The *live* `Dx11Hook::detach`
/// idempotency (detach, then drop, releasing the shared surface + process
/// handle exactly once) requires a real injected session and is asserted by the
/// hardware-gated `integration_dx11_hook.rs::dx11_hook_injects_and_hands_shared_surface_to_encoder`.
#[test]
fn not_attempted_is_not_a_success() {
    assert!(!InjectionOutcome::NotAttempted.is_success());
    assert!(!InjectionOutcome::Failed.is_success());
    assert!(!InjectionOutcome::Blocked.is_success());
    assert!(InjectionOutcome::Success.is_success());
}

/// Try to create the shared D3D11 device. Returns `None` (instead of panicking)
/// when no GPU is available so the GPU-touching test can skip on CI.
fn try_create_device() -> Option<std::sync::Arc<app_lib::d3d_device::D3dDevice>> {
    match app_lib::d3d_device::D3dDevice::new() {
        Ok(d3d) => Some(d3d),
        Err(e) => {
            eprintln!("[hook_fallback] D3dDevice::new() unavailable: {e}");
            None
        }
    }
}
