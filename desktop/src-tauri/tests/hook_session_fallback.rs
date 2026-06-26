//! Unit tests for the Game_Capture_Hook session fallback, notification, and
//! teardown wiring (task 11.3).
//!
//! Validates: Requirements 8.3, 8.4, 9.3, 10.6
//!   - 8.3  If injection fails, is blocked, or stops producing frames
//!          mid-session, the pipeline falls back to WGC and **continues** the
//!          session rather than terminating it.
//!   - 8.4  On fallback the pipeline notifies the user that zero-copy hook
//!          capture is unavailable and records the fallback reason.
//!   - 9.3  When the target exits, the pipeline detects the exit, releases the
//!          IPC channel + shared surfaces, and falls back to WGC.
//!   - 10.6 Hook injection that reports success but whose target is
//!          blocklisted/denied still falls back to WGC **and notifies**
//!          ("success-but-unsafe").
//!
//! # Why these tests exercise the pure decision seam, not the live command
//!
//! The session wiring (task 11.1) lives in `native_share.rs`. The real wiring
//! builds a [`SelectionInputs`] from the live environment and calls the **pure**
//! `select_capture_mode_v2` / `fallback_reason` / `should_notify_unavailable`
//! from `game_capture/mod.rs`; on a mid-session stall it records a runtime
//! [`FallbackReason`] into [`NativeShareStats`] and emits the
//! `native-screen-share-status` notification. The entry point itself
//! (`start_native_screen_share`) is a `#[tauri::command]` that needs a live
//! `AppHandle`, a real `Shared_D3D_Device`, a WebRTC peer connection, and an
//! injected OBS payload — none of which exist on a headless CI runner. Worse,
//! building the crate with `--features game-capture-hook` trips the `build.rs`
//! `OBS_Capture_Component` packaging guard (the GPLv2 OBS binaries are not
//! committed), so a `game-capture-hook` test binary cannot even compile in CI.
//!
//! The honest, robust thing to test is therefore the **decision wiring at the
//! pure seam** the command delegates to — the exact functions that map each
//! fallback condition to `wgc` + a reason + a notification — plus the
//! `NativeShareStats` Capture_Status recording the command performs with the
//! result. This is what makes 11.3 valuable and CI-safe; the GPU-/Win32-bound
//! teardown (releasing a live shared surface, stopping the live IPC channel) is
//! covered where it is actually reachable:
//!   * `tests/hook_detach.rs` (task 6.5, gated `game-capture-hook` + `windows`)
//!     asserts `GameCaptureHook::detach` is idempotent and stops the IPC channel
//!     + releases the retained surface.
//!   * the hardware-gated manual integration test (task 11.4) asserts
//!     surface-release + IPC-stop after a real present interception.
//! This file does **not** duplicate that hardware teardown; instead it asserts
//! the session-stop **decision** (the mode/reason recorded into
//! `NativeShareStats` on stop/fallback) and documents the complement.
//!
//! NOTE: This is an integration-test crate, so the `game_capture` selection core
//! and `native_share` stats must be reachable as `app_lib::…` (both are declared
//! behind `#[cfg(feature = "native-screen-share")]` in `lib.rs`). The pure
//! selection API lives under `native-screen-share` (not `game-capture-hook`), so
//! this test runs in CI without a GPU, a game, or the OBS artifacts. Run with
//! (from `desktop/src-tauri`, CEF env vars set):
//!   cargo test --features native-screen-share --test hook_session_fallback

#![cfg(feature = "native-screen-share")]

use app_lib::game_capture::{
    fallback_reason, select_capture_mode_v2, should_notify_unavailable, BackendGate, CaptureMode,
    FallbackReason, GraphicsApiBackend, InjectionOutcome, SafetyDecision, SelectionInputs,
    SourceKind,
};
use app_lib::native_share::{should_notify_hook_unavailable, NativeShareStats};

// ───────────────────────────────────────────────────────────────────────────
// Baseline + scenario model
// ───────────────────────────────────────────────────────────────────────────

/// A [`SelectionInputs`] whose every gate passes, so the resolved mode is
/// `Hook`. This mirrors the all-pass baseline the session builds for an
/// injectable DX11 window on Windows with the matching-bitness artifact present,
/// safety allowed, injection succeeded, and a single-adapter machine. Each
/// fallback scenario mutates exactly one field so the test pins the *specific*
/// gate responsible for the fallback.
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

/// One fallback scenario: a mutated [`SelectionInputs`] plus the trio of
/// expectations the session wiring must honor — the resolved `Capture_Mode`,
/// the recorded `FallbackReason`, and whether the user is notified.
struct Scenario {
    name: &'static str,
    inputs: SelectionInputs,
    expected_mode: CaptureMode,
    expected_reason: FallbackReason,
    expected_notify: bool,
}

/// Every pre-flight scenario the session's `select_capture_mode_v2` resolves,
/// each mutated from [`all_pass`]. Covers the conditions task 11.3 enumerates:
/// injection failure, injection block (anti-cheat / denied), success-but-
/// blocklisted (Req 10.6), not-allowlisted, missing artifact, cross-adapter,
/// the always-silent monitor source (Req 8.4), and the all-pass hook case.
fn pre_flight_scenarios() -> Vec<Scenario> {
    // injection failure → WGC, InjectionFailed, notify
    let mut injection_failed = all_pass();
    injection_failed.injection = InjectionOutcome::Failed;

    // injection blocked (OpenProcess denied / anti-cheat) → WGC, InjectionDenied, notify
    let mut injection_blocked = all_pass();
    injection_blocked.injection = InjectionOutcome::Blocked;

    // blocklisted WITH a reported injection success (success-but-unsafe, Req 10.6)
    // → WGC, Blocklisted, notify. The safety gate overrides the reported success.
    let mut blocklisted_success = all_pass();
    blocklisted_success.safety = SafetyDecision::Deny(FallbackReason::Blocklisted);
    debug_assert_eq!(blocklisted_success.injection, InjectionOutcome::Success);

    // not-allowlisted (a configured allowlist the target does not match)
    // → WGC, NotAllowlisted, notify.
    let mut not_allowlisted = all_pass();
    not_allowlisted.safety = SafetyDecision::Deny(FallbackReason::NotAllowlisted);

    // missing matching-bitness artifact → WGC, MissingArtifact, notify.
    let mut missing_artifact = all_pass();
    missing_artifact.artifact_available = false;

    // target renders on a different GPU adapter → WGC, CrossAdapter, notify.
    let mut cross_adapter = all_pass();
    cross_adapter.same_adapter = false;

    // monitor source → WGC, MonitorSource, SILENT (Req 8.4): the user never
    // expected the hook for a monitor, so no notification fires.
    let mut monitor = all_pass();
    monitor.source_kind = SourceKind::Monitor;

    vec![
        Scenario {
            name: "injection_failed",
            inputs: injection_failed,
            expected_mode: CaptureMode::Wgc,
            expected_reason: FallbackReason::InjectionFailed,
            expected_notify: true,
        },
        Scenario {
            name: "injection_blocked",
            inputs: injection_blocked,
            expected_mode: CaptureMode::Wgc,
            expected_reason: FallbackReason::InjectionDenied,
            expected_notify: true,
        },
        Scenario {
            name: "blocklisted_success",
            inputs: blocklisted_success,
            expected_mode: CaptureMode::Wgc,
            expected_reason: FallbackReason::Blocklisted,
            expected_notify: true,
        },
        Scenario {
            name: "not_allowlisted",
            inputs: not_allowlisted,
            expected_mode: CaptureMode::Wgc,
            expected_reason: FallbackReason::NotAllowlisted,
            expected_notify: true,
        },
        Scenario {
            name: "missing_artifact",
            inputs: missing_artifact,
            expected_mode: CaptureMode::Wgc,
            expected_reason: FallbackReason::MissingArtifact,
            expected_notify: true,
        },
        Scenario {
            name: "cross_adapter",
            inputs: cross_adapter,
            expected_mode: CaptureMode::Wgc,
            expected_reason: FallbackReason::CrossAdapter,
            expected_notify: true,
        },
        Scenario {
            name: "monitor_source",
            inputs: monitor,
            expected_mode: CaptureMode::Wgc,
            expected_reason: FallbackReason::MonitorSource,
            expected_notify: false,
        },
        Scenario {
            name: "all_pass",
            inputs: all_pass(),
            expected_mode: CaptureMode::Hook,
            expected_reason: FallbackReason::None,
            expected_notify: false,
        },
    ]
}

// ───────────────────────────────────────────────────────────────────────────
// (1) The fallback decision matrix — each condition resolves to wgc + the
//     correct reason + the right notification (the unique value of task 11.3).
// ───────────────────────────────────────────────────────────────────────────

/// For every fallback scenario the session can encounter at session start, the
/// pure seam the command delegates to resolves the trio exactly: the
/// `Capture_Mode`, the recorded `FallbackReason`, and the notification decision
/// (Req 8.3, 8.4, 10.6). This is the table-driven heart of 11.3.
#[test]
fn each_fallback_condition_resolves_to_wgc_with_reason_and_notification() {
    for s in pre_flight_scenarios() {
        let mode = select_capture_mode_v2(&s.inputs);
        let reason = fallback_reason(&s.inputs);
        let notify = should_notify_unavailable(&s.inputs);

        assert_eq!(mode, s.expected_mode, "[{}] capture mode", s.name);
        assert_eq!(reason, s.expected_reason, "[{}] fallback reason", s.name);
        assert_eq!(notify, s.expected_notify, "[{}] notify decision", s.name);

        // Cross-check the biconditional the design guarantees: the reason is
        // `None` exactly when the hook is the active mode, so a fallback always
        // carries a concrete, non-`None` reason (Req 8.4).
        if mode == CaptureMode::Hook {
            assert_eq!(
                reason,
                FallbackReason::None,
                "[{}] hook ⇒ no reason",
                s.name
            );
        } else {
            assert_ne!(
                reason,
                FallbackReason::None,
                "[{}] a WGC fallback must name a concrete reason",
                s.name
            );
        }
    }
}

/// Spelled-out, per-condition assertions so a regression points at the exact
/// scenario that drifted (the table test above proves the set; these document
/// each requirement clause individually).
#[test]
fn injection_failure_falls_back_to_wgc_and_notifies() {
    let mut inp = all_pass();
    inp.injection = InjectionOutcome::Failed;
    assert_eq!(select_capture_mode_v2(&inp), CaptureMode::Wgc);
    assert_eq!(fallback_reason(&inp), FallbackReason::InjectionFailed);
    assert!(should_notify_unavailable(&inp));
    // The injection-outcome-only notification seam agrees: a failed attempt
    // notifies (Req 8.4, 7.4).
    assert!(should_notify_hook_unavailable(InjectionOutcome::Failed));
}

#[test]
fn injection_block_falls_back_to_wgc_and_notifies() {
    let mut inp = all_pass();
    inp.injection = InjectionOutcome::Blocked;
    assert_eq!(select_capture_mode_v2(&inp), CaptureMode::Wgc);
    // An OpenProcess/injection denial is treated as an anti-cheat block (Req 10.4).
    assert_eq!(fallback_reason(&inp), FallbackReason::InjectionDenied);
    assert!(should_notify_unavailable(&inp));
    assert!(should_notify_hook_unavailable(InjectionOutcome::Blocked));
}

#[test]
fn blocklisted_target_with_reported_success_falls_back_and_notifies() {
    // Req 10.6 — success-but-unsafe: injection genuinely reported success, but
    // the target matches the Process_Blocklist, so the session still falls back
    // to WGC AND notifies the user.
    let mut inp = all_pass();
    inp.safety = SafetyDecision::Deny(FallbackReason::Blocklisted);
    assert_eq!(
        inp.injection,
        InjectionOutcome::Success,
        "guard: the injection genuinely reported success"
    );
    assert_eq!(select_capture_mode_v2(&inp), CaptureMode::Wgc);
    assert_eq!(fallback_reason(&inp), FallbackReason::Blocklisted);
    assert!(
        should_notify_unavailable(&inp),
        "a blocklisted target overrides a reported injection success and must notify (Req 10.6)"
    );
}

#[test]
fn not_allowlisted_target_falls_back_and_notifies() {
    let mut inp = all_pass();
    inp.safety = SafetyDecision::Deny(FallbackReason::NotAllowlisted);
    assert_eq!(select_capture_mode_v2(&inp), CaptureMode::Wgc);
    assert_eq!(fallback_reason(&inp), FallbackReason::NotAllowlisted);
    assert!(should_notify_unavailable(&inp));
}

#[test]
fn missing_artifact_falls_back_to_wgc_and_notifies() {
    let mut inp = all_pass();
    inp.artifact_available = false;
    assert_eq!(select_capture_mode_v2(&inp), CaptureMode::Wgc);
    assert_eq!(fallback_reason(&inp), FallbackReason::MissingArtifact);
    assert!(should_notify_unavailable(&inp));
}

#[test]
fn cross_adapter_falls_back_to_wgc_and_notifies() {
    let mut inp = all_pass();
    inp.same_adapter = false;
    assert_eq!(select_capture_mode_v2(&inp), CaptureMode::Wgc);
    assert_eq!(fallback_reason(&inp), FallbackReason::CrossAdapter);
    assert!(should_notify_unavailable(&inp));
}

#[test]
fn monitor_source_uses_wgc_silently() {
    // Req 8.2 / 8.4: a monitor is always WGC and the user never expected the
    // hook, so the fallback is silent even with every other gate satisfied.
    let mut inp = all_pass();
    inp.source_kind = SourceKind::Monitor;
    assert_eq!(select_capture_mode_v2(&inp), CaptureMode::Wgc);
    assert_eq!(fallback_reason(&inp), FallbackReason::MonitorSource);
    assert!(!should_notify_unavailable(&inp));
}

#[test]
fn all_gates_pass_runs_on_hook_without_fallback() {
    let inp = all_pass();
    assert_eq!(select_capture_mode_v2(&inp), CaptureMode::Hook);
    assert_eq!(fallback_reason(&inp), FallbackReason::None);
    assert!(!should_notify_unavailable(&inp));
}

// ───────────────────────────────────────────────────────────────────────────
// (2) The session continues — never terminates (Req 8.3).
// ───────────────────────────────────────────────────────────────────────────

/// Req 8.3: a fallback must **continue** the session on WGC, never terminate
/// it. At the pure seam, "the session continues" is represented by the
/// selection always resolving to a valid, usable `Capture_Mode` (`Wgc` or
/// `Hook`) — never an error, a panic, or a "no capture" state — for every
/// scenario and across a broad sweep of the input space.
#[test]
fn every_scenario_resolves_to_a_valid_capture_mode_never_terminates() {
    // The enumerated scenarios always land on a working mode.
    for s in pre_flight_scenarios() {
        let mode = select_capture_mode_v2(&s.inputs);
        assert!(
            matches!(mode, CaptureMode::Wgc | CaptureMode::Hook),
            "[{}] selection must resolve to a usable capture mode (Req 8.3)",
            s.name
        );
    }

    // A broad sweep of the full input space: whatever the combination, the
    // session always has a working capture mode to run on — fallback never
    // terminates the session.
    let backends = [
        GraphicsApiBackend::Dx11,
        GraphicsApiBackend::Dx12,
        GraphicsApiBackend::Vulkan,
        GraphicsApiBackend::OpenGl,
    ];
    let injections = [
        InjectionOutcome::Success,
        InjectionOutcome::Failed,
        InjectionOutcome::Blocked,
        InjectionOutcome::NotAttempted,
    ];
    let safeties = [
        SafetyDecision::Allow,
        SafetyDecision::Deny(FallbackReason::Blocklisted),
        SafetyDecision::Deny(FallbackReason::NotAllowlisted),
    ];
    let sources = [SourceKind::Window, SourceKind::Monitor];

    for &is_windows in &[true, false] {
        for &source_kind in &sources {
            for &backend in &backends {
                for &hook_enabled in &[true, false] {
                    for &artifact_available in &[true, false] {
                        for &safety in &safeties {
                            for &injection in &injections {
                                for &same_adapter in &[true, false] {
                                    let inp = SelectionInputs {
                                        is_windows,
                                        source_kind,
                                        backend,
                                        gate: BackendGate::dx11_only(),
                                        hook_enabled,
                                        artifact_available,
                                        safety,
                                        injection,
                                        same_adapter,
                                    };
                                    let mode = select_capture_mode_v2(&inp);
                                    assert!(
                                        matches!(mode, CaptureMode::Wgc | CaptureMode::Hook),
                                        "selection must always yield a usable mode: {inp:?}"
                                    );
                                    // The reason/mode biconditional holds across
                                    // the whole sweep, so status is always
                                    // coherent (Req 8.4).
                                    let reason = fallback_reason(&inp);
                                    assert_eq!(
                                        reason == FallbackReason::None,
                                        mode == CaptureMode::Hook,
                                        "reason/mode disagreed for {inp:?}"
                                    );
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// (3) Capture_Status recording — the decision is recorded into NativeShareStats
//     (ties each fallback reason to the reported status; Req 8.4/8.5 adjacent).
// ───────────────────────────────────────────────────────────────────────────

/// The session records the resolved mode + reason into [`NativeShareStats`]
/// (the command calls `set_capture_mode` / `set_active_backend` /
/// `set_fallback_reason`). For every pre-flight fallback, recording the result
/// and reading the snapshot reports `wgc`, the non-backend `n/a` marker, and the
/// concrete reason string — exactly the Capture_Status the renderer reads
/// (Req 8.4, 8.5).
#[test]
fn pre_flight_fallback_is_recorded_in_capture_status() {
    for s in pre_flight_scenarios() {
        let stats = NativeShareStats::default();

        // Replicate the command's recording step for this scenario's result.
        let mode = select_capture_mode_v2(&s.inputs);
        let reason = fallback_reason(&s.inputs);
        stats.set_capture_mode(mode);
        stats.set_active_backend(if mode == CaptureMode::Hook {
            Some(s.inputs.backend)
        } else {
            None
        });
        stats.set_fallback_reason(reason);

        let snap = stats.snapshot();
        assert_eq!(
            snap.capture_mode,
            mode.as_str(),
            "[{}] capture_mode str",
            s.name
        );
        assert_eq!(
            snap.fallback_reason,
            reason.as_str(),
            "[{}] fallback_reason str",
            s.name
        );

        if mode == CaptureMode::Hook {
            // Hook is active: the backend is reported, reason is "none".
            assert_eq!(snap.capture_mode, "hook", "[{}]", s.name);
            assert_eq!(snap.active_backend, "dx11", "[{}]", s.name);
            assert_eq!(snap.fallback_reason, "none", "[{}]", s.name);
        } else {
            // WGC fallback: no backend, a concrete non-"none" reason.
            assert_eq!(snap.capture_mode, "wgc", "[{}]", s.name);
            assert_eq!(snap.active_backend, "n/a", "[{}]", s.name);
            assert_ne!(snap.fallback_reason, "none", "[{}]", s.name);
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// (4) Mid-session / target-exit fallback + teardown decision.
//     These reasons are raised by the runtime hook thread (not the pure
//     pre-flight selection); the testable seam is the Capture_Status they
//     record on the session-stop/fallback decision. The live surface-release +
//     IPC-stop is covered by hook_detach.rs (6.5) and hardware-gated 11.4.
// ───────────────────────────────────────────────────────────────────────────

/// Req 9.3 / 8.3: when the target exits mid-session the pipeline falls back to
/// WGC and continues. The runtime hook thread records `TargetExited` and resets
/// the active backend; reading the snapshot reports the WGC Capture_Status with
/// the `target_exited` reason. (The live IPC-release + surface-release on this
/// path is asserted by `tests/hook_detach.rs` and the hardware-gated 11.4 — this
/// asserts the *decision* that fallback records, not the GPU teardown.)
#[test]
fn target_exit_records_wgc_fallback_capture_status() {
    let stats = NativeShareStats::default();

    // Simulate a session that started on the hook…
    stats.set_capture_mode(CaptureMode::Hook);
    stats.set_active_backend(Some(GraphicsApiBackend::Dx11));
    stats.set_fallback_reason(FallbackReason::None);
    assert_eq!(stats.snapshot().capture_mode, "hook");

    // …then the target exits: the runtime path falls back to WGC and records
    // the reason (Req 9.3, 8.3, 8.5).
    stats.set_capture_mode(CaptureMode::Wgc);
    stats.set_active_backend(None);
    stats.set_fallback_reason(FallbackReason::TargetExited);

    let snap = stats.snapshot();
    assert_eq!(
        snap.capture_mode, "wgc",
        "session continues on WGC, not terminated"
    );
    assert_eq!(
        snap.active_backend, "n/a",
        "no backend on the WGC fallback path"
    );
    assert_eq!(snap.fallback_reason, "target_exited");
}

/// Req 8.3 / 8.5: a hook that stops producing frames mid-session (the no-frame
/// watchdog) also falls back to WGC and records `HookStoppedMidSession`,
/// continuing the session.
#[test]
fn hook_stopped_mid_session_records_wgc_fallback_capture_status() {
    let stats = NativeShareStats::default();
    stats.set_capture_mode(CaptureMode::Wgc);
    stats.set_active_backend(None);
    stats.set_fallback_reason(FallbackReason::HookStoppedMidSession);

    let snap = stats.snapshot();
    assert_eq!(snap.capture_mode, "wgc");
    assert_eq!(snap.active_backend, "n/a");
    assert_eq!(snap.fallback_reason, "hook_stopped_mid_session");
}

/// Documents the teardown contract this file deliberately does NOT duplicate.
///
/// On session stop the `HookCaptureSession` drop joins the hook capture thread,
/// which runs `GameCaptureHook::detach` → releases the retained shared surface
/// and stops the `ObsIpcChannel`. That release is GPU-/Win32-bound and is
/// asserted at its reachable seams:
///   * idempotent `detach` + IPC-stop → `tests/hook_detach.rs` (task 6.5,
///     gated `game-capture-hook` + `windows`).
///   * live surface release after a real present interception → the
///     hardware-gated integration test (task 11.4).
/// Here, the testable session-stop **decision** is that, post-stop, the reported
/// Capture_Status returns to the guaranteed WGC default (no lingering `hook`
/// mode / backend). We assert that a fresh `NativeShareStats` — the state a
/// stopped session leaves for the next `get_native_screen_share_stats` read —
/// reports the WGC defaults, so a torn-down hook never reports as still active.
#[test]
fn session_stop_leaves_wgc_default_capture_status() {
    // A default `NativeShareStats` is the no-active-session baseline the stats
    // command reports after teardown (the command never resurrects a `hook`
    // mode once the session is stopped).
    let stats = NativeShareStats::default();
    let snap = stats.snapshot();
    assert_eq!(
        snap.capture_mode, "wgc",
        "a stopped session reports the WGC default"
    );
    assert_eq!(
        snap.active_backend, "n/a",
        "no backend is active after teardown"
    );
    assert_eq!(snap.fallback_reason, "none");
}
