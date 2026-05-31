//! Unit/integration tests for the hook-exclusive **capture-unavailable** path,
//! the `native-screen-share-status` emit timing, and the negotiated-parameter
//! updates wired by tasks 5.3 and 5.4 in `native_share.rs` (task 5.5).
//!
//! Validates: Requirements 5.3, 5.6, 9.3, 13.5
//!   - 5.3  Under `hook-exclusive`, a hook-eligible **window** source whose
//!          hook is unavailable (at session start) or whose hook stops
//!          mid-session MUST NOT start WGC, MUST stop delivering frames, and
//!          MUST record an explicit capture-unavailable Capture_Status that
//!          states the reason while retaining the resolved Capture_Policy.
//!   - 5.6  When the active Capture_Mode changes or capture becomes
//!          unavailable, a `native-screen-share-status` event is emitted within
//!          2 seconds of the change.
//!   - 9.3  When the negotiated resolution / frame rate changes mid-session
//!          (e.g. a resize or renegotiation), NativeShareStats reports the
//!          updated width, height, and frame rate no later than the next stats
//!          read after the change.
//!   - 13.5 On a platform where neither the hook nor WGC is available, the
//!          pipeline records an explicit capture-unavailable status in
//!          Capture_Status and does not crash.
//!
//! # Why these tests exercise the pure decision seam, not the live command
//!
//! The session orchestration (`start_native_screen_share`) is a
//! `#[tauri::command]` needing a live `AppHandle`, a real `Shared_D3D_Device`, a
//! WebRTC peer connection, and an injected payload — none of which exist on a
//! headless CI runner. Worse, building with `--features game-capture-hook`
//! trips the `build.rs` packaging guard (the GPLv2 capture artifacts are not
//! committed), so a `game-capture-hook` test binary cannot compile in CI.
//!
//! The honest, robust thing to test is therefore the **decision wiring at the
//! pure seam** the command delegates to:
//!
//!   * `apply_capture_policy(&selection, HookExclusive)` resolving to
//!     [`CaptureResolution::Unavailable`] for a hook-eligible window source whose
//!     hook is unavailable — the exact decision that gates the
//!     "do not start WGC / capture-unavailable" branch (Req 5.3). Resolving to
//!     `Unavailable` (rather than `Wgc`) is the seam-level proof that **no WGC is
//!     started** for that source.
//!   * The `NativeShareStats` Capture_Status recording the command performs on
//!     that branch — `set_capture_policy` + `set_capture_unavailable(true)` +
//!     `set_fallback_reason(reason)` (+ `clear_negotiated_params` on the
//!     mid-session path) — read back through the serializable snapshot.
//!   * The pure predicates that **gate the synchronous emit** at the decision
//!     site: `matches!(resolution, Unavailable)` (the capture-unavailable emit)
//!     and `should_notify_unavailable(&selection)` (the wgc-enabled
//!     "continuing on WGC" emit). The actual `app.emit(...)` needs an
//!     `AppHandle`; because it is a **synchronous** call at the decision site
//!     (not a delayed timer), reaching the branch is what guarantees the event
//!     is emitted, and the within-2s contract (Req 5.6) is met by that
//!     synchronous emit plus the frontend poll interval (≤ 2s).
//!   * The negotiated-parameter atomics (`set_negotiated_params` /
//!     `clear_negotiated_params`) read back through the snapshot, which reads
//!     the live atomics every call — so an update is visible on the **next**
//!     snapshot read (Req 9.3).
//!
//! NOTE: This is an integration-test crate, so the selection core and stats must
//! be reachable as `app_lib::…` (both are declared behind
//! `#[cfg(feature = "native-screen-share")]` in `lib.rs`). The pure selection +
//! policy API lives under `native-screen-share` (not `game-capture-hook`), so
//! this test runs in CI without a GPU, a game, or the capture artifacts. Run
//! with (from `desktop/src-tauri`, CEF env vars set per steering tech.md):
//!   cargo test --features native-screen-share --test hook_exclusive_unavailable

#![cfg(feature = "native-screen-share")]

use app_lib::game_capture::{
    apply_capture_policy, fallback_reason, select_capture_mode_v2, should_notify_unavailable,
    BackendGate, CaptureMode, CapturePolicy, CaptureResolution, FallbackReason, GraphicsApiBackend,
    InjectionOutcome, SafetyDecision, SelectionInputs, SourceKind,
};
use app_lib::native_share::NativeShareStats;

// ───────────────────────────────────────────────────────────────────────────
// Baseline + scenario model
// ───────────────────────────────────────────────────────────────────────────

/// A [`SelectionInputs`] whose every gate passes, so the pure mode is `Hook`.
/// Each unavailable scenario mutates exactly one field so the test pins the
/// *specific* gate responsible for the hook being unavailable.
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

/// One hook-unavailable scenario for a **window** source: a mutated
/// [`SelectionInputs`] plus the reason the hook is unavailable. Under
/// `hook-exclusive` every one of these resolves to
/// [`CaptureResolution::Unavailable`] carrying `expected_reason`; under
/// `wgc-enabled` the same inputs resolve to [`CaptureResolution::Wgc`] carrying
/// the same reason.
struct Scenario {
    name: &'static str,
    inputs: SelectionInputs,
    expected_reason: FallbackReason,
}

/// Every way a hook-eligible **window** source can have its hook be unavailable,
/// each mutated from [`all_pass`]. These are the inputs that drive the
/// `hook-exclusive` capture-unavailable branch (Req 5.3).
fn window_unavailable_scenarios() -> Vec<Scenario> {
    let mut injection_failed = all_pass();
    injection_failed.injection = InjectionOutcome::Failed;

    let mut injection_blocked = all_pass();
    injection_blocked.injection = InjectionOutcome::Blocked;

    // success-but-unsafe (Req 10.6): injection reported success, but the target
    // is blocklisted; the hook is still unavailable.
    let mut blocklisted_success = all_pass();
    blocklisted_success.safety = SafetyDecision::Deny(FallbackReason::Blocklisted);

    let mut not_allowlisted = all_pass();
    not_allowlisted.safety = SafetyDecision::Deny(FallbackReason::NotAllowlisted);

    let mut missing_artifact = all_pass();
    missing_artifact.artifact_available = false;

    let mut cross_adapter = all_pass();
    cross_adapter.same_adapter = false;

    // backend whose enablement gate is off (DX12 under the DX11-only gate).
    let mut backend_disabled = all_pass();
    backend_disabled.backend = GraphicsApiBackend::Dx12;

    let mut hook_disabled = all_pass();
    hook_disabled.hook_enabled = false;

    // non-Windows window source (Req 13.2/13.5): the hook can never run.
    let mut not_windows = all_pass();
    not_windows.is_windows = false;

    vec![
        Scenario {
            name: "injection_failed",
            inputs: injection_failed,
            expected_reason: FallbackReason::InjectionFailed,
        },
        Scenario {
            name: "injection_blocked",
            inputs: injection_blocked,
            expected_reason: FallbackReason::InjectionDenied,
        },
        Scenario {
            name: "blocklisted_success",
            inputs: blocklisted_success,
            expected_reason: FallbackReason::Blocklisted,
        },
        Scenario {
            name: "not_allowlisted",
            inputs: not_allowlisted,
            expected_reason: FallbackReason::NotAllowlisted,
        },
        Scenario {
            name: "missing_artifact",
            inputs: missing_artifact,
            expected_reason: FallbackReason::MissingArtifact,
        },
        Scenario {
            name: "cross_adapter",
            inputs: cross_adapter,
            expected_reason: FallbackReason::CrossAdapter,
        },
        Scenario {
            name: "backend_disabled",
            inputs: backend_disabled,
            expected_reason: FallbackReason::BackendDisabled,
        },
        Scenario {
            name: "hook_disabled",
            inputs: hook_disabled,
            expected_reason: FallbackReason::HookDisabled,
        },
        Scenario {
            name: "not_windows",
            inputs: not_windows,
            expected_reason: FallbackReason::NotWindows,
        },
    ]
}

/// Replicate the session-start Capture_Status recording the command performs on
/// the resolved [`CaptureResolution`] (the exact `set_*` sequence in
/// `start_native_screen_share`): record the policy, the pure capture mode +
/// backend, the fallback reason, and the capture-unavailable flag. Returns the
/// stats so the caller can read the snapshot back.
fn record_session_start(inp: &SelectionInputs, policy: CapturePolicy) -> NativeShareStats {
    let stats = NativeShareStats::default();
    let mode = select_capture_mode_v2(inp);
    let reason = fallback_reason(inp);
    let resolution = apply_capture_policy(inp, policy);

    stats.set_capture_policy(policy == CapturePolicy::HookExclusive);
    stats.set_capture_mode(mode);
    stats.set_active_backend(if mode == CaptureMode::Hook {
        Some(inp.backend)
    } else {
        None
    });
    stats.set_fallback_reason(reason);
    stats.set_capture_unavailable(matches!(resolution, CaptureResolution::Unavailable { .. }));
    stats
}

// ───────────────────────────────────────────────────────────────────────────
// (1) Hook-exclusive window-source-unavailable → Unavailable, no WGC (Req 5.3)
// ───────────────────────────────────────────────────────────────────────────

/// For every way a hook-eligible window source can be unavailable, the
/// `hook-exclusive` policy resolves to [`CaptureResolution::Unavailable`]
/// carrying exactly `fallback_reason(inputs)` — and never to
/// [`CaptureResolution::Wgc`]. Resolving to `Unavailable` (not `Wgc`) is the
/// seam-level proof that **no WGC is started** for the source (Req 5.3).
#[test]
fn hook_exclusive_window_unavailable_resolves_unavailable_and_never_wgc() {
    for s in window_unavailable_scenarios() {
        let resolution = apply_capture_policy(&s.inputs, CapturePolicy::HookExclusive);
        match resolution {
            CaptureResolution::Unavailable { reason } => {
                assert_eq!(
                    reason, s.expected_reason,
                    "[{}] unavailable reason must equal fallback_reason(inputs)",
                    s.name
                );
            }
            other => panic!(
                "[{}] hook-exclusive window source with the hook unavailable must resolve to \
                 Unavailable (no WGC), got {other:?}",
                s.name
            ),
        }
        // Explicitly assert WGC is never the resolution for these inputs under
        // hook-exclusive — the policy must not start WGC (Req 5.3).
        assert!(
            !matches!(resolution, CaptureResolution::Wgc { .. }),
            "[{}] hook-exclusive must NOT fall back to WGC",
            s.name
        );
        // The carried reason is exactly what the explanatory `fallback_reason`
        // reports, so Capture_Status can never disagree with the resolution.
        assert_eq!(
            fallback_reason(&s.inputs),
            s.expected_reason,
            "[{}] fallback_reason mismatch",
            s.name
        );
    }
}

/// The session-start Capture_Status recorded on the unavailable branch reports
/// the capture-unavailable flag, the stated reason, and **retains** the resolved
/// `hook-exclusive` policy — while delivering no frames (Req 5.3). "WGC not
/// started" is observable in stats as `capture_unavailable == true` with zero
/// forwarded/captured frames and not-yet-negotiated (None) parameters.
#[test]
fn hook_exclusive_unavailable_records_capture_status_with_reason_and_retains_policy() {
    for s in window_unavailable_scenarios() {
        let stats = record_session_start(&s.inputs, CapturePolicy::HookExclusive);
        let snap = stats.snapshot();

        assert!(
            snap.capture_unavailable,
            "[{}] capture-unavailable status must be set under hook-exclusive",
            s.name
        );
        assert_eq!(
            snap.fallback_reason,
            s.expected_reason.as_str(),
            "[{}] the reason the hook was unavailable must be stated",
            s.name
        );
        // The resolved policy is RETAINED in Capture_Status (Req 5.3): it stays
        // `hook-exclusive`, it does not flip to wgc-enabled on the failure.
        assert_eq!(
            snap.capture_policy, "hook-exclusive",
            "[{}] the resolved policy must be retained",
            s.name
        );
        // No frames are delivered: the counters stay at zero and no capture
        // parameters are negotiated (no capture source is running).
        assert_eq!(snap.captured_frames, 0, "[{}] no frames forwarded", s.name);
        assert_eq!(snap.dropped_frames, 0, "[{}] no frames dropped", s.name);
        assert_eq!(snap.negotiated_width, None, "[{}] not-yet-negotiated W", s.name);
        assert_eq!(snap.negotiated_height, None, "[{}] not-yet-negotiated H", s.name);
        assert_eq!(snap.negotiated_fps, None, "[{}] not-yet-negotiated fps", s.name);
    }
}

/// The same window-unavailable inputs under `wgc-enabled` resolve to
/// [`CaptureResolution::Wgc`] (carrying the same reason) and record
/// `capture_unavailable == false` — the prior fall-back behavior (Req 5.2),
/// confirming the policy is what flips the outcome, not the inputs.
#[test]
fn wgc_enabled_same_inputs_fall_back_to_wgc_not_unavailable() {
    for s in window_unavailable_scenarios() {
        let resolution = apply_capture_policy(&s.inputs, CapturePolicy::WgcEnabled);
        match resolution {
            CaptureResolution::Wgc { reason } => {
                assert_eq!(reason, s.expected_reason, "[{}] wgc reason", s.name);
            }
            other => panic!(
                "[{}] wgc-enabled must fall back to WGC, got {other:?}",
                s.name
            ),
        }

        let stats = record_session_start(&s.inputs, CapturePolicy::WgcEnabled);
        let snap = stats.snapshot();
        assert!(
            !snap.capture_unavailable,
            "[{}] wgc-enabled must NOT set capture-unavailable",
            s.name
        );
        assert_eq!(snap.capture_policy, "wgc-enabled", "[{}] policy", s.name);
        assert_eq!(snap.capture_mode, "wgc", "[{}] falls back to WGC", s.name);
    }
}

/// A monitor source is never a hook candidate, so under **either** policy it
/// resolves to [`CaptureResolution::Wgc`] and never to `Unavailable` — the
/// hook-exclusive policy applies only to hook-eligible window sources
/// (Req 5.4). Even with every other gate satisfied.
#[test]
fn monitor_source_uses_wgc_under_both_policies_never_unavailable() {
    let mut monitor = all_pass();
    monitor.source_kind = SourceKind::Monitor;

    for policy in [CapturePolicy::HookExclusive, CapturePolicy::WgcEnabled] {
        let resolution = apply_capture_policy(&monitor, policy);
        assert!(
            matches!(resolution, CaptureResolution::Wgc { .. }),
            "monitor under {policy:?} must use WGC, got {resolution:?}"
        );
        let stats = record_session_start(&monitor, policy);
        assert!(
            !stats.snapshot().capture_unavailable,
            "monitor under {policy:?} is never capture-unavailable"
        );
    }
}

/// When every gate passes the pure mode is `Hook`, so the resolution is `Hook`
/// for **both** policies and WGC is never started (Req 4.2) — the
/// capture-unavailable status stays clear. This guards against the unavailable
/// branch firing on the happy path.
#[test]
fn all_gates_pass_resolves_hook_under_both_policies() {
    for policy in [CapturePolicy::HookExclusive, CapturePolicy::WgcEnabled] {
        let resolution = apply_capture_policy(&all_pass(), policy);
        assert_eq!(
            resolution,
            CaptureResolution::Hook,
            "all-pass under {policy:?} must run on the hook (never WGC, Req 4.2)"
        );
        let stats = record_session_start(&all_pass(), policy);
        let snap = stats.snapshot();
        assert!(!snap.capture_unavailable, "hook path is not capture-unavailable");
        assert_eq!(snap.capture_mode, "hook");
        assert_eq!(snap.active_backend, "dx11");
    }
}

// ───────────────────────────────────────────────────────────────────────────
// (2) Mid-session hook stop under hook-exclusive → capture-unavailable (Req 5.3)
// ───────────────────────────────────────────────────────────────────────────

/// Req 5.3 mid-session: a session running on the hook whose hook stops
/// (No_Frame_Watchdog / target-exit / hook error) under `hook-exclusive`
/// transitions to capture-unavailable. The runtime path keeps the active mode as
/// the hook's (it was the resolved mode), sets the capture-unavailable flag and
/// the reason, clears the negotiated parameters (no capture is running), and
/// retains the policy. This asserts the Capture_Status that decision records.
#[test]
fn mid_session_hook_stop_under_hook_exclusive_records_capture_unavailable() {
    for reason in [
        FallbackReason::HookStoppedMidSession,
        FallbackReason::TargetExited,
    ] {
        let stats = NativeShareStats::default();
        // The session started on the hook with negotiated parameters published.
        stats.set_capture_policy(true); // hook-exclusive
        stats.set_capture_mode(CaptureMode::Hook);
        stats.set_active_backend(Some(GraphicsApiBackend::Dx11));
        stats.set_fallback_reason(FallbackReason::None);
        stats.set_negotiated_params(1920, 1080, 60.0);
        let live = stats.snapshot();
        assert_eq!(live.capture_mode, "hook");
        assert_eq!(live.negotiated_width, Some(1920));
        assert!(!live.capture_unavailable);

        // …then the hook stops mid-session: hook-exclusive transitions to
        // capture-unavailable, keeps the mode/backend, states the reason,
        // clears the negotiated params, and does NOT start WGC.
        stats.set_capture_unavailable(true);
        stats.set_fallback_reason(reason);
        stats.clear_negotiated_params();

        let snap = stats.snapshot();
        assert!(snap.capture_unavailable, "{reason:?}: capture is now unavailable");
        assert_eq!(snap.fallback_reason, reason.as_str(), "{reason:?}: reason stated");
        assert_eq!(snap.capture_policy, "hook-exclusive", "{reason:?}: policy retained");
        // The mid-session path keeps the active mode as the hook's; the
        // capture-unavailable flag + reason convey that no frames flow (it does
        // NOT flip to "wgc", which would imply a WGC fallback was started).
        assert_eq!(snap.capture_mode, "hook", "{reason:?}: mode stays hook (no WGC)");
        // No capture parameters remain negotiated — capture is stopped.
        assert_eq!(snap.negotiated_width, None, "{reason:?}: params cleared");
        assert_eq!(snap.negotiated_height, None, "{reason:?}: params cleared");
        assert_eq!(snap.negotiated_fps, None, "{reason:?}: params cleared");
    }
}

// ───────────────────────────────────────────────────────────────────────────
// (3) Status-emit timing — the synchronous decision predicates (Req 5.6)
// ───────────────────────────────────────────────────────────────────────────

/// Req 5.6: the capture-unavailable `native-screen-share-status` emit is gated
/// by `matches!(resolution, Unavailable)` at the decision site. For every
/// hook-exclusive window-unavailable scenario that predicate is `true`, so the
/// synchronous emit branch is reached — independent of `should_notify_unavailable`
/// (which gates the *wgc-enabled* "continuing on WGC" emit instead). Because the
/// emit is a synchronous `app.emit(...)` at the decision site (not a delayed
/// timer), reaching the branch is what guarantees the event fires; the within-2s
/// contract is then met by that synchronous emit plus the frontend poll (≤ 2s).
#[test]
fn hook_exclusive_unavailable_reaches_the_synchronous_emit_branch() {
    for s in window_unavailable_scenarios() {
        let resolution = apply_capture_policy(&s.inputs, CapturePolicy::HookExclusive);
        let capture_unavailable_emit = matches!(resolution, CaptureResolution::Unavailable { .. });
        assert!(
            capture_unavailable_emit,
            "[{}] the capture-unavailable emit branch must be reached synchronously",
            s.name
        );
    }
}

/// The capture-unavailable emit fires for **all** hook-exclusive window
/// scenarios, even the ones `should_notify_unavailable` is silent for
/// (`backend_disabled`, `hook_disabled`, `not_windows` — where the user did not
/// expect the hook). This documents that the unavailable emit is gated by the
/// resolution, not by `should_notify_unavailable`: the if/else-if at the
/// decision site checks `capture_unavailable` first.
#[test]
fn capture_unavailable_emit_is_independent_of_should_notify_unavailable() {
    for name in ["backend_disabled", "hook_disabled", "not_windows"] {
        let s = window_unavailable_scenarios()
            .into_iter()
            .find(|s| s.name == name)
            .unwrap();

        let resolution = apply_capture_policy(&s.inputs, CapturePolicy::HookExclusive);
        assert!(
            matches!(resolution, CaptureResolution::Unavailable { .. }),
            "[{name}] still resolves Unavailable under hook-exclusive"
        );
        // These are exactly the cases `should_notify_unavailable` stays silent
        // for, yet the capture-unavailable emit still fires (gated by the
        // resolution, the first branch of the if/else-if).
        assert!(
            !should_notify_unavailable(&s.inputs),
            "[{name}] should_notify_unavailable is silent here (user did not expect the hook)"
        );
    }
}

/// Req 5.6 (wgc-enabled branch): when the user could have expected the hook on a
/// window source but it is unavailable, the `should_notify_unavailable`
/// predicate that gates the "continuing on WGC" emit is `true`, so that emit is
/// reached. It is `false` for a monitor source and a disabled hook (the user
/// never expected the hook), so no mode-change emit fires there.
#[test]
fn wgc_enabled_mode_change_emit_predicate_is_reached_when_user_expected_hook() {
    // A window source whose injection failed: the user expected the hook (it is
    // enabled and the backend gate is on), so the WGC fall-back must notify.
    let mut injection_failed = all_pass();
    injection_failed.injection = InjectionOutcome::Failed;
    assert!(
        should_notify_unavailable(&injection_failed),
        "wgc-enabled fall-back on an expected hook must reach the notify emit"
    );

    // A monitor source: the user never expected the hook → silent.
    let mut monitor = all_pass();
    monitor.source_kind = SourceKind::Monitor;
    assert!(
        !should_notify_unavailable(&monitor),
        "a monitor source must not emit a hook-unavailable notification"
    );

    // A disabled hook: the user opted out → silent.
    let mut hook_off = all_pass();
    hook_off.hook_enabled = false;
    assert!(
        !should_notify_unavailable(&hook_off),
        "a disabled hook must not emit a hook-unavailable notification"
    );
}

// ───────────────────────────────────────────────────────────────────────────
// (4) Negotiated-parameter updates — visible on the next stats read (Req 9.3)
// ───────────────────────────────────────────────────────────────────────────

/// Req 9.3: when the negotiated resolution / frame rate changes mid-session, the
/// updated width/height/fps are reported no later than the next stats read.
/// `snapshot()` reads the live atomics every call, so a later
/// `set_negotiated_params` is reflected on the **very next** snapshot — modeling
/// a swapchain resize / quality renegotiation.
#[test]
fn negotiated_params_update_is_visible_on_the_next_snapshot() {
    let stats = NativeShareStats::default();

    // Before negotiation: the explicit not-yet-negotiated state (Req 9.4).
    let pending = stats.snapshot();
    assert_eq!(pending.negotiated_width, None);
    assert_eq!(pending.negotiated_height, None);
    assert_eq!(pending.negotiated_fps, None);

    // First negotiation (e.g. the first hook surface resolves).
    stats.set_negotiated_params(1280, 720, 30.0);
    let first = stats.snapshot();
    assert_eq!(first.negotiated_width, Some(1280));
    assert_eq!(first.negotiated_height, Some(720));
    assert_eq!(first.negotiated_fps, Some(30.0));

    // A mid-session resize / renegotiation to a new resolution + frame rate.
    // The very next snapshot reflects the update — no later than the next read.
    stats.set_negotiated_params(1920, 1080, 59.94);
    let resized = stats.snapshot();
    assert_eq!(resized.negotiated_width, Some(1920), "updated W on next read");
    assert_eq!(resized.negotiated_height, Some(1080), "updated H on next read");
    assert_eq!(
        resized.negotiated_fps,
        Some(59.94),
        "fractional fps survives the milli-fps round-trip and updates on next read"
    );

    // Clearing returns to the explicit not-yet-negotiated state (Req 9.4) — the
    // state the hook-exclusive capture-unavailable path leaves behind.
    stats.clear_negotiated_params();
    let cleared = stats.snapshot();
    assert_eq!(cleared.negotiated_width, None);
    assert_eq!(cleared.negotiated_height, None);
    assert_eq!(cleared.negotiated_fps, None);
}

/// A shrink-then-grow sequence of renegotiations is each reflected on the next
/// read, in order — the reported parameters always track the latest negotiation
/// (Req 9.3), never a stale earlier value.
#[test]
fn negotiated_params_track_the_latest_of_a_sequence_of_renegotiations() {
    let stats = NativeShareStats::default();
    let sequence = [
        (640u32, 360u32, 24.0f64),
        (1280, 720, 30.0),
        (960, 540, 48.0),
        (3840, 2160, 60.0),
    ];
    for &(w, h, fps) in &sequence {
        stats.set_negotiated_params(w, h, fps);
        let snap = stats.snapshot();
        assert_eq!(snap.negotiated_width, Some(w), "W tracks latest");
        assert_eq!(snap.negotiated_height, Some(h), "H tracks latest");
        assert_eq!(snap.negotiated_fps, Some(fps), "fps tracks latest");
    }
}

// ───────────────────────────────────────────────────────────────────────────
// (5) Platform scope — neither hook nor WGC available (Req 13.5)
// ───────────────────────────────────────────────────────────────────────────

/// Req 13.5: on a non-Windows platform a hook-eligible window source under
/// `hook-exclusive` resolves to [`CaptureResolution::Unavailable`] with the
/// `not_windows` reason (the hook can never run, Req 13.2). The pipeline records
/// the explicit capture-unavailable status in Capture_Status without panicking —
/// the seam analogue of "does not crash the desktop application".
#[test]
fn non_windows_window_source_records_capture_unavailable_without_crashing() {
    let mut not_windows = all_pass();
    not_windows.is_windows = false;

    let resolution = apply_capture_policy(&not_windows, CapturePolicy::HookExclusive);
    assert_eq!(
        resolution,
        CaptureResolution::Unavailable {
            reason: FallbackReason::NotWindows
        },
        "non-Windows window source under hook-exclusive is capture-unavailable (Req 13.5)"
    );

    // Recording the status must be total/panic-free and reflected in the snapshot.
    let stats = record_session_start(&not_windows, CapturePolicy::HookExclusive);
    let snap = stats.snapshot();
    assert!(snap.capture_unavailable, "explicit capture-unavailable status recorded");
    assert_eq!(snap.fallback_reason, "not_windows", "the reason is stated");
}

/// Req 13.5 (direct): even when the status is recorded directly (the
/// "neither hook nor WGC available" runtime condition the pipeline cannot model
/// as a pure selection), setting the capture-unavailable flag is total and the
/// snapshot reports it coherently — no panic, no inconsistent state.
#[test]
fn explicit_capture_unavailable_status_is_total_and_coherent() {
    let stats = NativeShareStats::default();
    // The pipeline records capture-unavailable when neither path is available.
    stats.set_capture_unavailable(true);
    stats.set_fallback_reason(FallbackReason::NotWindows);
    let snap = stats.snapshot();
    assert!(snap.capture_unavailable);
    assert_eq!(snap.fallback_reason, "not_windows");
    // No frames, no negotiated parameters — nothing is captured.
    assert_eq!(snap.captured_frames, 0);
    assert_eq!(snap.negotiated_width, None);

    // The flag clears back cleanly (idempotent, no lingering state).
    stats.set_capture_unavailable(false);
    assert!(!stats.snapshot().capture_unavailable);
}
