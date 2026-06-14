//! Game-capture hook (Tier 3) — capture-mode selection and backend gating.
//!
//! This module hosts the `Game_Capture_Hook` machinery and the pure logic that
//! decides which `Capture_Mode` a native share session runs in. The selection
//! itself is GPU- and OS-independent so it can be exhaustively property-tested
//! without hardware (see Property 7).
//!
//! # Capture-mode selection
//!
//! A native share session always resolves to a working `Capture_Mode`. The
//! zero-copy `hook` mode is only chosen for a DX11 window source when the hook
//! is enabled, the DX11 backend is ready, and injection actually succeeds.
//! Every other path — a monitor source, a disabled hook, a not-yet-proven
//! DX12/Vulkan/OpenGL backend, or an injection failure/anti-cheat block — falls
//! back to `wgc`, which is the guaranteed common substrate (Requirements 6.1,
//! 6.2, 8.1, 8.2, 8.3).

/// DX11 zero-copy game-capture hook (Requirement 7). Injects into a DX11 game,
/// intercepts `IDXGISwapChain::Present`, and exposes the presented backbuffer
/// as a shared D3D11 surface opened on the single `Shared_D3D_Device`.
pub mod dx11;

/// Pure, GPU-/IPC-independent model of hook surface retention (retain-at-most-one
/// with re-open on a changed handle, Req 7.5, 9.2) and steady-state delivery over
/// the depth-4 encoder channel (Req 7.3). The hook-surface analogue of
/// `wgc_capture::WgcRetentionTracker`. It carries no Windows dependency, so it
/// compiles under `native-screen-share` and is the target of Properties 6 and 7
/// (`tests/prop_hook_retention.rs`, `tests/prop_hook_delivery_rate.rs`) without a
/// GPU, a game, or the `game-capture-hook` feature.
pub mod hook_retention;

/// Injector orchestration — bitness detection (`IsWow64Process2`), OBS artifact
/// discovery, and the pure injection-strategy planner (Requirement 2). The host
/// never injects a matching-bitness target directly; it plans which reused OBS
/// `graphics-hook` payload and (cross-bitness) `inject-helper` to use, always
/// selecting the target-bitness payload (Requirements 2.1–2.5). Behind the
/// `game-capture-hook` feature on top of `native-screen-share`.
#[cfg(feature = "game-capture-hook")]
pub mod inject;

/// Host-side OBS game-capture IPC reader — the project's own clean-room consumer
/// of OBS's shared-texture IPC protocol (Requirements 1.4, 1.6, 1.7, 9.2, 9.3,
/// 11.4). Behind the `game-capture-hook` feature on top of `native-screen-share`
/// because the reused OBS payload is an additive, default-off fast path.
#[cfg(feature = "game-capture-hook")]
pub mod obs_ipc;

/// Anti-cheat safety gate (Requirement 10). The pure `Process_Blocklist` /
/// `Process_Allowlist` matching that decides whether injection may be attempted
/// for a given target, run before any injection so a protected title is never
/// injected. Gated behind `game-capture-hook` (declared in `lib.rs` by task
/// 13.1); declared here too so the module compiles and is testable now.
#[cfg(feature = "game-capture-hook")]
pub mod blocklist;

/// Implicit-Vulkan-layer registration (Vulkan present interception activation).
/// Vulkan cannot be Detours-hooked like DX/GL; OBS's capture is an implicit
/// Vulkan layer the loader only activates when its JSON manifest is registered
/// under `HKCU\SOFTWARE\Khronos\Vulkan\ImplicitLayers`. This module registers
/// the bundled `obs-vulkan{64,32}.json` so a Vulkan game launched afterward
/// loads our `graphics-hook` layer. Windows + `game-capture-hook` only.
#[cfg(all(feature = "game-capture-hook", windows))]
pub mod vulkan_layer;

/// The active capture strategy for a native share session.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CaptureMode {
    /// Windows Graphics Capture — the guaranteed fallback path (Req 6).
    Wgc,
    /// Zero-copy game-capture hook — only for an injectable DX11 window (Req 7).
    Hook,
}

impl CaptureMode {
    /// Stable string form reported through `NativeShareStats` (Req 6.5, 7.3).
    pub fn as_str(self) -> &'static str {
        match self {
            CaptureMode::Wgc => "wgc",
            CaptureMode::Hook => "hook",
        }
    }
}

/// Graphics APIs the `Game_Capture_Hook` can target.
///
/// DX11 and DX12 both present through the DXGI swapchain, so the injected
/// graphics-hook intercepts the **same** `IDXGISwapChain::Present` path for
/// either — the DLL selects the right device internally (`setup_dxgi` →
/// `d3d11`/`d3d12` capture). Vulkan is intercepted differently: the DLL is an
/// implicit Vulkan layer (`vkQueuePresentKHR`), activated by the loader once its
/// manifest is registered (see `vulkan_layer`) and the game launched afterward,
/// then coordinated with the injected capture thread + IPC objects like the
/// DXGI path. All three are active-capable. OpenGL would need its own validated
/// path and stays gated off until implemented (Req 8.1, 8.2).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GraphicsApiBackend {
    Dx11,
    /// Captured via the shared DXGI present hook (same path as DX11).
    Dx12,
    /// Captured via the implicit Vulkan layer (`vkQueuePresentKHR`) coordinated
    /// with the injected capture thread/IPC; the layer must be registered with
    /// the Vulkan loader (`vulkan_layer`) and the game launched afterward.
    Vulkan,
    /// Gated off until an OpenGL interception is validated (Req 8.2).
    OpenGl,
}

impl GraphicsApiBackend {
    /// Whether this backend may be used as the active `hook` Capture_Mode.
    ///
    /// DX11/DX12 (shared DXGI present hook) and Vulkan (implicit layer + IPC)
    /// are permitted; OpenGL returns `false` so it can exist in the codebase
    /// without ever being selected until its own path is validated (Req 8.1,
    /// 8.2).
    pub fn is_active_capable(self) -> bool {
        matches!(
            self,
            GraphicsApiBackend::Dx11 | GraphicsApiBackend::Dx12 | GraphicsApiBackend::Vulkan
        )
    }

    /// Stable string form of the active `Graphics_API_Backend` reported through
    /// `NativeShareStats` / `Capture_Status` while the hook is the active
    /// Capture_Mode (Req 14.2). These values are part of the status contract
    /// surfaced to the renderer and MUST remain stable.
    pub fn as_str(self) -> &'static str {
        match self {
            GraphicsApiBackend::Dx11 => "dx11",
            GraphicsApiBackend::Dx12 => "dx12",
            GraphicsApiBackend::Vulkan => "vulkan",
            GraphicsApiBackend::OpenGl => "opengl",
        }
    }
}

/// What the selected capture source is. WGC is always used for a monitor
/// source regardless of injection availability (Req 6.2); only a window source
/// is ever a hook candidate.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SourceKind {
    Monitor,
    Window,
}

/// Result of attempting to inject into and intercept the target process.
///
/// Only `Success` permits `hook`; a failure, an anti-cheat block, or a source
/// for which injection was never attempted all fall back to `wgc`
/// (Req 6.3, 7.4, 8.3).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InjectionOutcome {
    /// The hook attached and intercepted the presented backbuffer.
    Success,
    /// Injection was attempted but the process could not be attached/hooked.
    Failed,
    /// Injection was refused, e.g. by anti-cheat.
    Blocked,
    /// Injection was not attempted (e.g. monitor source or hook disabled).
    NotAttempted,
}

impl InjectionOutcome {
    /// True only when the hook actually attached and intercepted a frame.
    pub fn is_success(self) -> bool {
        matches!(self, InjectionOutcome::Success)
    }
}

/// Pure capture-mode selection.
///
/// Returns [`CaptureMode::Hook`] **only** when the source is a DX11 window, the
/// hook is enabled, the DX11 backend is ready, and injection succeeded. Every
/// other combination resolves to [`CaptureMode::Wgc`], the guaranteed fallback.
///
/// This function is intentionally free of any GPU/OS interaction so it can be
/// property-tested over every input combination (Property 7).
///
/// Validates: Requirements 6.1, 6.2, 8.1, 8.2, 8.3 (and feeds 6.3, 7.3, 7.4).
pub fn select_capture_mode(
    source_kind: SourceKind,
    backend: GraphicsApiBackend,
    hook_enabled: bool,
    dx11_ready: bool,
    injection_outcome: InjectionOutcome,
) -> CaptureMode {
    let hook_eligible = source_kind == SourceKind::Window
        && backend.is_active_capable()
        && hook_enabled
        && dx11_ready
        && injection_outcome.is_success();

    if hook_eligible {
        CaptureMode::Hook
    } else {
        CaptureMode::Wgc
    }
}

// ───────────────────────────────────────────────────────────────────────────
// v2 selection — gates, fallback mapping, and the notification decision
//
// The v2 selection extends `select_capture_mode` with the full safety/eligibility
// gate the design requires: platform scope (Req 13.2), monitor sources (Req 8.2),
// the per-backend enablement gate (Req 3.1–3.3, 3.8), matching-bitness artifact
// presence (Req 2.5), the anti-cheat blocklist/allowlist (Req 10.2, 10.3),
// injection outcome incl. denied/anti-cheat (Req 10.4, 7.4), and cross-adapter
// detection (Req 5.4, 9.4). Every input is a plain value so the whole thing is
// pure, total, and GPU-/OS-independent — it is the target of Properties 1–3 and
// runs in CI without hardware.
// ───────────────────────────────────────────────────────────────────────────

/// Per-backend enablement gate (Req 3.2, 3.3).
///
/// DX11 is validated and enabled first; DX12/Vulkan/OpenGL each have an
/// independent gate that stays off until DX11 meets its success criteria
/// (Req 3.1). A backend whose gate is off is never selected as the active
/// `hook` Capture_Mode even though the reused OBS payload can intercept it
/// (Req 3.3, 3.8).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct BackendGate {
    pub dx11: bool,
    pub dx12: bool,
    pub vulkan: bool,
    pub opengl: bool,
}

impl BackendGate {
    /// Whether the given backend's enablement gate is on.
    pub fn enabled(&self, backend: GraphicsApiBackend) -> bool {
        match backend {
            GraphicsApiBackend::Dx11 => self.dx11,
            GraphicsApiBackend::Dx12 => self.dx12,
            GraphicsApiBackend::Vulkan => self.vulkan,
            GraphicsApiBackend::OpenGl => self.opengl,
        }
    }

    /// DX11-first default: only the DX11 gate is on (Req 3.1).
    pub fn dx11_only() -> Self {
        Self {
            dx11: true,
            dx12: false,
            vulkan: false,
            opengl: false,
        }
    }

    /// Production default: DX11, DX12, and Vulkan are on. DX11/DX12 share the
    /// DXGI present hook; Vulkan uses the implicit-layer + IPC path. OpenGL
    /// stays off until its own path is validated (Req 3.1, 8.2).
    pub fn dxgi() -> Self {
        Self {
            dx11: true,
            dx12: true,
            vulkan: true,
            opengl: false,
        }
    }
}

/// The pure anti-cheat safety decision (Req 10.2, 10.3).
///
/// Computed by `game_capture::blocklist::safety_decision` from the target's
/// executable name and the configured blocklist/allowlist; carried into the
/// selection as a plain value. A `Deny` short-circuits selection to `wgc` and
/// names the reason, so a blocklisted target is never injected (Req 10.2) and
/// the blocklist overrides a reported injection success (Req 10.6).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SafetyDecision {
    /// Injection may be attempted for this target.
    Allow,
    /// Injection must not be attempted; the reason is either
    /// [`FallbackReason::Blocklisted`] or [`FallbackReason::NotAllowlisted`].
    Deny(FallbackReason),
}

/// Why a session fell back from an intended `hook` to `wgc` (Req 8.4, 14.4).
///
/// `None` means the hook is active and there was no fallback. Every other
/// variant names a concrete gate that blocked the hook. Variants
/// [`FallbackReason::InteropFailed`], [`FallbackReason::TargetExited`], and
/// [`FallbackReason::HookStoppedMidSession`] describe *runtime* fallbacks raised
/// by the session orchestration mid-session rather than by the pure pre-flight
/// selection, but they live here so `NativeShareStats` can report any reason
/// from one enum.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FallbackReason {
    /// The hook is the active Capture_Mode; no fallback occurred.
    None,
    /// The platform is not Windows (Req 13.2).
    NotWindows,
    /// The selected source is a monitor; monitors are always WGC (Req 8.2).
    MonitorSource,
    /// The selected backend's enablement gate is off or the backend is not yet
    /// active-capable (Req 3.3, 3.8).
    BackendDisabled,
    /// The Game_Capture_Hook feature/flag is disabled.
    HookDisabled,
    /// The matching-bitness Hook_Payload / Inject_Helper artifact is missing
    /// (Req 2.5, 12.6).
    MissingArtifact,
    /// The target matches the Process_Blocklist (Req 10.2, 10.6).
    Blocklisted,
    /// A Process_Allowlist is configured and the target does not match it
    /// (Req 10.3).
    NotAllowlisted,
    /// `OpenProcess`/injection was denied, treated as an anti-cheat block
    /// (Req 10.4).
    InjectionDenied,
    /// Injection was attempted but failed (Req 7.4).
    InjectionFailed,
    /// The target renders on a different GPU adapter than the Shared_D3D_Device
    /// (Req 5.4, 9.4).
    CrossAdapter,
    /// Cross_API_Interop could not copy a backbuffer into a Shared_Surface
    /// (Req 4.5).
    InteropFailed,
    /// The target process exited mid-session (Req 9.3).
    TargetExited,
    /// The hook stopped producing frames mid-session (Req 8.3).
    HookStoppedMidSession,
}

impl FallbackReason {
    /// Stable string form reported through `NativeShareStats` (Req 8.4, 14.4).
    pub fn as_str(self) -> &'static str {
        match self {
            FallbackReason::None => "none",
            FallbackReason::NotWindows => "not_windows",
            FallbackReason::MonitorSource => "monitor_source",
            FallbackReason::BackendDisabled => "backend_disabled",
            FallbackReason::HookDisabled => "hook_disabled",
            FallbackReason::MissingArtifact => "missing_artifact",
            FallbackReason::Blocklisted => "blocklisted",
            FallbackReason::NotAllowlisted => "not_allowlisted",
            FallbackReason::InjectionDenied => "injection_denied",
            FallbackReason::InjectionFailed => "injection_failed",
            FallbackReason::CrossAdapter => "cross_adapter",
            FallbackReason::InteropFailed => "interop_failed",
            FallbackReason::TargetExited => "target_exited",
            FallbackReason::HookStoppedMidSession => "hook_stopped_mid_session",
        }
    }
}

/// Everything the v2 selection needs, as pure values (no GPU/OS calls).
///
/// The session orchestration in `native_share.rs` resolves each field from the
/// live environment (platform, the selected source, the backend gate, the
/// feature flag, artifact discovery, the blocklist/allowlist decision, the
/// injection attempt, and the adapter-LUID comparison) and hands this struct to
/// the pure selection so the decision logic stays exhaustively testable.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SelectionInputs {
    /// The host platform is Windows (Req 13.2).
    pub is_windows: bool,
    /// The selected capture source kind (Req 8.2).
    pub source_kind: SourceKind,
    /// The target's graphics backend.
    pub backend: GraphicsApiBackend,
    /// Per-backend enablement gate (Req 3.2, 3.3).
    pub gate: BackendGate,
    /// The Game_Capture_Hook feature/flag is enabled.
    pub hook_enabled: bool,
    /// The matching-bitness payload + helper are present next to the binary
    /// (Req 2.5).
    pub artifact_available: bool,
    /// The anti-cheat blocklist/allowlist decision (Req 10.2, 10.3).
    pub safety: SafetyDecision,
    /// The outcome of the injection attempt (Req 7.4, 10.4).
    pub injection: InjectionOutcome,
    /// The target renders on the same GPU adapter as the Shared_D3D_Device
    /// (Req 5.4, 9.4).
    pub same_adapter: bool,
}

impl SelectionInputs {
    /// Whether every gate required for the `hook` Capture_Mode passes.
    ///
    /// This is the single source of truth shared by [`select_capture_mode_v2`]
    /// and [`fallback_reason`] so the two can never disagree: the mode is
    /// `Hook` exactly when this is `true`, and `fallback_reason` is
    /// [`FallbackReason::None`] exactly then too.
    fn hook_eligible(&self) -> bool {
        self.is_windows
            && self.source_kind == SourceKind::Window
            && self.gate.enabled(self.backend)
            && self.backend.is_active_capable()
            && self.hook_enabled
            && self.artifact_available
            && self.safety == SafetyDecision::Allow
            && self.injection.is_success()
            && self.same_adapter
    }
}

/// Pure, total v2 capture-mode selection.
///
/// Returns [`CaptureMode::Hook`] iff the platform is Windows, the source is a
/// window, the backend's gate is on and the backend is active-capable, the hook
/// is enabled, the matching-bitness artifact is present, the safety gate
/// allows it, injection succeeded, and the target shares the Shared_D3D_Device
/// adapter. Every other combination resolves to [`CaptureMode::Wgc`], the
/// guaranteed fallback.
///
/// A `safety == Deny` short-circuits to `wgc` regardless of the injection
/// outcome, so the blocklist overrides a reported injection success (Req 10.6).
///
/// Validates: Requirements 2.5, 3.1, 3.2, 3.3, 3.8, 4.5, 5.4, 8.1, 8.2, 8.3,
/// 9.4, 10.2, 10.3, 10.4, 13.2.
pub fn select_capture_mode_v2(inp: &SelectionInputs) -> CaptureMode {
    if inp.hook_eligible() {
        CaptureMode::Hook
    } else {
        CaptureMode::Wgc
    }
}

/// Derive the fallback reason from the same inputs — the explanatory
/// counterpart to [`select_capture_mode_v2`].
///
/// Returns [`FallbackReason::None`] iff the resolved mode is `Hook`; otherwise
/// it names the **first** failing gate in this fixed order: platform, monitor
/// source, hook disabled, backend disabled, missing artifact, safety
/// (blocklist/allowlist), injection (denied/failed), cross-adapter. The order
/// is part of the contract (Property 2) so the reported reason is deterministic.
///
/// Validates: Requirements 2.5, 4.5, 5.4, 8.3, 8.4, 9.3, 9.4, 10.4.
pub fn fallback_reason(inp: &SelectionInputs) -> FallbackReason {
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
            // `OpenProcess`/injection denied is treated as an anti-cheat block
            // (Req 10.4).
            InjectionOutcome::Blocked => FallbackReason::InjectionDenied,
            // A real attempt that failed, or a not-attempted state that slipped
            // through every prior gate, both map to a failed injection (Req 7.4).
            InjectionOutcome::Failed | InjectionOutcome::NotAttempted => {
                FallbackReason::InjectionFailed
            }
            // Unreachable: `is_success()` is false on this branch.
            InjectionOutcome::Success => FallbackReason::InjectionFailed,
        };
    }
    if !inp.same_adapter {
        return FallbackReason::CrossAdapter;
    }

    // Every gate passed: the hook is the active mode (Req 8.1 inverse).
    FallbackReason::None
}

/// Whether to show the "zero-copy hook capture is unavailable" notification
/// (Req 8.4, 10.6).
///
/// Returns `true` iff the user could reasonably have expected the hook — a
/// window source, on Windows, with the hook enabled and the backend's gate on —
/// but it is unavailable. This **includes** the success-but-unsafe case where
/// injection reported success yet the safety gate denied it (Req 10.6). It is
/// deliberately silent for monitor sources and for a disabled hook/feature,
/// where the user never expected the hook in the first place.
///
/// Validates: Requirements 8.4, 10.6.
pub fn should_notify_unavailable(inp: &SelectionInputs) -> bool {
    let user_expected_hook = inp.is_windows
        && inp.source_kind == SourceKind::Window
        && inp.hook_enabled
        && inp.gate.enabled(inp.backend);

    user_expected_hook && select_capture_mode_v2(inp) != CaptureMode::Hook
}

// ───────────────────────────────────────────────────────────────────────────
// Capture policy — the optional-WGC capability layer (Requirement 5)
//
// The pure `select_capture_mode_v2` above is unchanged: it returns `Hook` iff
// every hook gate passes. The `Capture_Policy` only governs the **else** branch
// for a source that could have used the hook but did not — fall back to WGC
// (`wgc-enabled`, the prior behavior) or report capture-unavailable
// (`hook-exclusive`). Monitor sources always use WGC regardless of policy
// because they are never hook candidates (Req 4.5, 5.4). Like the selection
// above, this layer is pure, total, and free of any GPU/OS interaction, so it
// is exhaustively property-testable (Properties 2 and 3).
// ───────────────────────────────────────────────────────────────────────────

/// Whether `WGC_Capture` is available as a capability for a session (Req 5).
///
/// Resolved once per session from a runtime setting and/or a build-feature
/// default (see [`resolve_capture_policy`]). The string form returned by
/// [`CapturePolicy::as_str`] is part of the `Capture_Status` contract surfaced
/// through `NativeShareStats` (Req 5.5).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CapturePolicy {
    /// The hook is the only capture path. If the hook is unavailable or fails,
    /// capture fails explicitly and is reported, with no WGC fallback (Req 5.3).
    HookExclusive,
    /// `WGC_Capture` is available; the session falls back to it when the hook is
    /// unavailable or fails (the prior behavior, Req 5.2).
    WgcEnabled,
}

impl CapturePolicy {
    /// Stable string form reported through `NativeShareStats` / `Capture_Status`
    /// (Req 5.5). These values are part of the status contract surfaced to the
    /// renderer and MUST remain stable.
    pub fn as_str(self) -> &'static str {
        match self {
            CapturePolicy::HookExclusive => "hook-exclusive",
            CapturePolicy::WgcEnabled => "wgc-enabled",
        }
    }
}

/// Initial hook startup watchdog in milliseconds.
///
/// `wgc-enabled` treats the hook as a speculative fast path: if no first frame
/// arrives quickly, WGC should start without making viewers wait for the long
/// hook-only diagnostic window. `hook-exclusive` keeps the longer bound because
/// there is no fallback capture path and slower game startup is still useful to
/// tolerate.
pub fn initial_hook_first_frame_timeout_ms(policy: CapturePolicy) -> u64 {
    match policy {
        CapturePolicy::WgcEnabled => 1_500,
        CapturePolicy::HookExclusive => 8_000,
    }
}

/// Resolve exactly one [`CapturePolicy`] for a session (Req 5.1).
///
/// Precedence is fixed and total: the `runtime` setting wins when present,
/// otherwise the build-feature default when present, otherwise
/// [`CapturePolicy::WgcEnabled`] (the documented default when neither
/// specifies a policy).
///
/// Validates: Requirement 5.1.
pub fn resolve_capture_policy(
    runtime: Option<CapturePolicy>,
    feature_default: Option<CapturePolicy>,
) -> CapturePolicy {
    runtime
        .or(feature_default)
        .unwrap_or(CapturePolicy::WgcEnabled)
}

/// The capture resolution a session acts on once the pure mode and the policy
/// are both known — the policy-aware counterpart to [`CaptureMode`].
///
/// Unlike [`CaptureMode`] (which only distinguishes `hook`/`wgc`), this carries
/// the third outcome the `hook-exclusive` policy introduces: an explicit
/// capture-unavailable state with the reason the hook could not be used
/// (Req 5.3). The `Wgc` and `Unavailable` variants both carry the
/// [`FallbackReason`] that [`fallback_reason`] reports for the same inputs.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CaptureResolution {
    /// Run on the zero-copy hook. The pure selection chose `Hook`, so the
    /// session never starts WGC for this source regardless of policy (Req 4.2).
    Hook,
    /// Run on `WGC_Capture` — either a monitor source (always WGC, Req 4.5,
    /// 5.4) or a hook-eligible window source under `wgc-enabled` falling back
    /// to WGC (Req 5.2). `reason` is why the hook was not used.
    Wgc { reason: FallbackReason },
    /// A hook-eligible window source under `hook-exclusive` with the hook
    /// unavailable: do not start WGC, report capture-unavailable, and state the
    /// reason the hook could not be used (Req 5.3).
    Unavailable { reason: FallbackReason },
}

/// Apply the resolved [`CapturePolicy`] on top of the pure
/// [`select_capture_mode_v2`] to produce the session's [`CaptureResolution`].
///
/// This wraps — and never changes — the pure selection:
///
/// - When the pure mode is [`CaptureMode::Hook`], return [`CaptureResolution::Hook`]
///   for **both** policies, and never start WGC for that source (Req 4.2).
/// - When the source is a monitor, return [`CaptureResolution::Wgc`] for **either**
///   policy, because monitors are not hook candidates (Req 4.5, 5.4).
/// - Otherwise the source is a hook-eligible window whose pure mode is `Wgc`:
///   under [`CapturePolicy::WgcEnabled`] return [`CaptureResolution::Wgc`]
///   (fall back to WGC, Req 5.2); under [`CapturePolicy::HookExclusive`] return
///   [`CaptureResolution::Unavailable`] (no WGC, capture-unavailable, Req 5.3).
///
/// Every `Wgc`/`Unavailable` variant carries exactly the reason
/// [`fallback_reason`] reports for the same inputs, so the carried reason can
/// never disagree with the selection's explanatory output.
///
/// The function is pure and total — no GPU/OS interaction — so it is the target
/// of Property 2.
///
/// Validates: Requirements 3.5, 4.2, 4.5, 4.6, 5.2, 5.3, 5.4.
pub fn apply_capture_policy(inp: &SelectionInputs, policy: CapturePolicy) -> CaptureResolution {
    // The pure selection is the single source of truth for whether the hook is
    // chosen; the policy only governs what happens when it is not.
    if select_capture_mode_v2(inp) == CaptureMode::Hook {
        return CaptureResolution::Hook;
    }

    // The pure mode is `Wgc` from here on. Carry the same reason the selection
    // would report for these inputs so the two can never drift (Property 2).
    let reason = fallback_reason(inp);

    // A monitor source is never a hook candidate, so it always uses WGC
    // regardless of the policy (Req 4.5, 5.4).
    if inp.source_kind == SourceKind::Monitor {
        return CaptureResolution::Wgc { reason };
    }

    // A hook-eligible window source whose pure mode is `Wgc`: the policy decides
    // whether WGC is available as a fallback (Req 5.2) or capture is reported
    // unavailable (Req 5.3).
    match policy {
        CapturePolicy::WgcEnabled => CaptureResolution::Wgc { reason },
        CapturePolicy::HookExclusive => CaptureResolution::Unavailable { reason },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dxgi_and_vulkan_backends_are_active_capable() {
        // DX11/DX12 share the DXGI present hook; Vulkan uses the implicit-layer
        // + IPC path. All three may be the active hook backend.
        assert!(GraphicsApiBackend::Dx11.is_active_capable());
        assert!(GraphicsApiBackend::Dx12.is_active_capable());
        assert!(GraphicsApiBackend::Vulkan.is_active_capable());
        // OpenGL stays gated off until its own path is validated.
        assert!(!GraphicsApiBackend::OpenGl.is_active_capable());
    }

    #[test]
    fn capture_mode_strings_are_stable() {
        assert_eq!(CaptureMode::Wgc.as_str(), "wgc");
        assert_eq!(CaptureMode::Hook.as_str(), "hook");
    }

    #[test]
    fn graphics_api_backend_strings_are_stable() {
        // Status contract strings consumed by `NativeShareStats` (Req 14.2).
        assert_eq!(GraphicsApiBackend::Dx11.as_str(), "dx11");
        assert_eq!(GraphicsApiBackend::Dx12.as_str(), "dx12");
        assert_eq!(GraphicsApiBackend::Vulkan.as_str(), "vulkan");
        assert_eq!(GraphicsApiBackend::OpenGl.as_str(), "opengl");
    }

    #[test]
    fn dx11_window_with_successful_injection_selects_hook() {
        let mode = select_capture_mode(
            SourceKind::Window,
            GraphicsApiBackend::Dx11,
            true,
            true,
            InjectionOutcome::Success,
        );
        assert_eq!(mode, CaptureMode::Hook);
    }

    #[test]
    fn monitor_source_always_selects_wgc() {
        // Even with every hook precondition satisfied, a monitor is WGC (Req 6.2).
        let mode = select_capture_mode(
            SourceKind::Monitor,
            GraphicsApiBackend::Dx11,
            true,
            true,
            InjectionOutcome::Success,
        );
        assert_eq!(mode, CaptureMode::Wgc);
    }

    #[test]
    fn disabled_hook_selects_wgc() {
        let mode = select_capture_mode(
            SourceKind::Window,
            GraphicsApiBackend::Dx11,
            false,
            true,
            InjectionOutcome::Success,
        );
        assert_eq!(mode, CaptureMode::Wgc);
    }

    #[test]
    fn dx11_not_ready_selects_wgc() {
        let mode = select_capture_mode(
            SourceKind::Window,
            GraphicsApiBackend::Dx11,
            true,
            false,
            InjectionOutcome::Success,
        );
        assert_eq!(mode, CaptureMode::Wgc);
    }

    #[test]
    fn injection_failure_or_block_selects_wgc() {
        for outcome in [
            InjectionOutcome::Failed,
            InjectionOutcome::Blocked,
            InjectionOutcome::NotAttempted,
        ] {
            let mode = select_capture_mode(
                SourceKind::Window,
                GraphicsApiBackend::Dx11,
                true,
                true,
                outcome,
            );
            assert_eq!(mode, CaptureMode::Wgc, "outcome {outcome:?} must fall back");
        }
    }

    #[test]
    fn unimplemented_backends_select_wgc() {
        // OpenGL has no validated path yet, so it is never the active hook mode
        // even with a successful injection. (DX11/DX12 share the DXGI present
        // hook and Vulkan uses the implicit layer — all active-capable, covered
        // elsewhere.)
        for backend in [GraphicsApiBackend::OpenGl] {
            let mode = select_capture_mode(
                SourceKind::Window,
                backend,
                true,
                true,
                InjectionOutcome::Success,
            );
            assert_eq!(mode, CaptureMode::Wgc, "backend {backend:?} is gated");
        }
    }

    #[test]
    fn dx12_window_selects_hook() {
        // DX12 presents through the same DXGI swapchain as DX11, so a DX12
        // window with a successful injection resolves to the zero-copy hook.
        let mode = select_capture_mode(
            SourceKind::Window,
            GraphicsApiBackend::Dx12,
            true,
            true,
            InjectionOutcome::Success,
        );
        assert_eq!(mode, CaptureMode::Hook);
    }

    // ── v2 selection ────────────────────────────────────────────────────

    /// A `SelectionInputs` whose every gate passes, so the resolved mode is
    /// `Hook`. Tests mutate individual fields to drive each fallback.
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

    #[test]
    fn backend_gate_enabled_maps_each_backend() {
        let gate = BackendGate {
            dx11: true,
            dx12: false,
            vulkan: true,
            opengl: false,
        };
        assert!(gate.enabled(GraphicsApiBackend::Dx11));
        assert!(!gate.enabled(GraphicsApiBackend::Dx12));
        assert!(gate.enabled(GraphicsApiBackend::Vulkan));
        assert!(!gate.enabled(GraphicsApiBackend::OpenGl));
    }

    #[test]
    fn dx11_only_gate_enables_only_dx11() {
        let gate = BackendGate::dx11_only();
        assert!(gate.enabled(GraphicsApiBackend::Dx11));
        assert!(!gate.enabled(GraphicsApiBackend::Dx12));
        assert!(!gate.enabled(GraphicsApiBackend::Vulkan));
        assert!(!gate.enabled(GraphicsApiBackend::OpenGl));
    }

    #[test]
    fn fallback_reason_strings_are_stable() {
        assert_eq!(FallbackReason::None.as_str(), "none");
        assert_eq!(FallbackReason::NotWindows.as_str(), "not_windows");
        assert_eq!(FallbackReason::MonitorSource.as_str(), "monitor_source");
        assert_eq!(FallbackReason::BackendDisabled.as_str(), "backend_disabled");
        assert_eq!(FallbackReason::HookDisabled.as_str(), "hook_disabled");
        assert_eq!(FallbackReason::MissingArtifact.as_str(), "missing_artifact");
        assert_eq!(FallbackReason::Blocklisted.as_str(), "blocklisted");
        assert_eq!(FallbackReason::NotAllowlisted.as_str(), "not_allowlisted");
        assert_eq!(FallbackReason::InjectionDenied.as_str(), "injection_denied");
        assert_eq!(FallbackReason::InjectionFailed.as_str(), "injection_failed");
        assert_eq!(FallbackReason::CrossAdapter.as_str(), "cross_adapter");
        assert_eq!(FallbackReason::InteropFailed.as_str(), "interop_failed");
        assert_eq!(FallbackReason::TargetExited.as_str(), "target_exited");
        assert_eq!(
            FallbackReason::HookStoppedMidSession.as_str(),
            "hook_stopped_mid_session"
        );
    }

    #[test]
    fn v2_all_gates_pass_selects_hook() {
        let inp = all_pass();
        assert_eq!(select_capture_mode_v2(&inp), CaptureMode::Hook);
        assert_eq!(fallback_reason(&inp), FallbackReason::None);
        // The hook is active, so there is nothing to notify about.
        assert!(!should_notify_unavailable(&inp));
    }

    #[test]
    fn v2_non_windows_falls_back_silently() {
        let mut inp = all_pass();
        inp.is_windows = false;
        assert_eq!(select_capture_mode_v2(&inp), CaptureMode::Wgc);
        assert_eq!(fallback_reason(&inp), FallbackReason::NotWindows);
        // Not Windows ⇒ the user never expected the hook ⇒ silent.
        assert!(!should_notify_unavailable(&inp));
    }

    #[test]
    fn v2_monitor_source_falls_back_silently() {
        let mut inp = all_pass();
        inp.source_kind = SourceKind::Monitor;
        assert_eq!(select_capture_mode_v2(&inp), CaptureMode::Wgc);
        assert_eq!(fallback_reason(&inp), FallbackReason::MonitorSource);
        assert!(!should_notify_unavailable(&inp));
    }

    #[test]
    fn v2_hook_disabled_falls_back_silently() {
        let mut inp = all_pass();
        inp.hook_enabled = false;
        assert_eq!(select_capture_mode_v2(&inp), CaptureMode::Wgc);
        assert_eq!(fallback_reason(&inp), FallbackReason::HookDisabled);
        assert!(!should_notify_unavailable(&inp));
    }

    #[test]
    fn v2_backend_gate_off_falls_back_silently() {
        // DX12 source while only DX11 is gated on: the backend gate is an
        // internal incremental-rollout detail (like a disabled hook), so the
        // user is not treated as having expected the hook — silent (design §7:
        // notification precondition requires "backend gated on").
        let mut inp = all_pass();
        inp.backend = GraphicsApiBackend::Dx12;
        assert_eq!(select_capture_mode_v2(&inp), CaptureMode::Wgc);
        assert_eq!(fallback_reason(&inp), FallbackReason::BackendDisabled);
        assert!(!should_notify_unavailable(&inp));
    }

    #[test]
    fn v2_missing_artifact_falls_back_and_notifies() {
        let mut inp = all_pass();
        inp.artifact_available = false;
        assert_eq!(select_capture_mode_v2(&inp), CaptureMode::Wgc);
        assert_eq!(fallback_reason(&inp), FallbackReason::MissingArtifact);
        assert!(should_notify_unavailable(&inp));
    }

    #[test]
    fn v2_blocklisted_overrides_injection_success_and_notifies() {
        // Success-but-unsafe (Req 10.6): injection reported Success but the
        // target is blocklisted, so we still fall back AND notify.
        let mut inp = all_pass();
        inp.safety = SafetyDecision::Deny(FallbackReason::Blocklisted);
        assert_eq!(inp.injection, InjectionOutcome::Success);
        assert_eq!(select_capture_mode_v2(&inp), CaptureMode::Wgc);
        assert_eq!(fallback_reason(&inp), FallbackReason::Blocklisted);
        assert!(should_notify_unavailable(&inp));
    }

    #[test]
    fn v2_not_allowlisted_falls_back_and_notifies() {
        let mut inp = all_pass();
        inp.safety = SafetyDecision::Deny(FallbackReason::NotAllowlisted);
        assert_eq!(select_capture_mode_v2(&inp), CaptureMode::Wgc);
        assert_eq!(fallback_reason(&inp), FallbackReason::NotAllowlisted);
        assert!(should_notify_unavailable(&inp));
    }

    #[test]
    fn v2_injection_denied_maps_to_injection_denied() {
        let mut inp = all_pass();
        inp.injection = InjectionOutcome::Blocked;
        assert_eq!(select_capture_mode_v2(&inp), CaptureMode::Wgc);
        assert_eq!(fallback_reason(&inp), FallbackReason::InjectionDenied);
        assert!(should_notify_unavailable(&inp));
    }

    #[test]
    fn v2_injection_failed_maps_to_injection_failed() {
        for outcome in [InjectionOutcome::Failed, InjectionOutcome::NotAttempted] {
            let mut inp = all_pass();
            inp.injection = outcome;
            assert_eq!(select_capture_mode_v2(&inp), CaptureMode::Wgc);
            assert_eq!(
                fallback_reason(&inp),
                FallbackReason::InjectionFailed,
                "outcome {outcome:?}"
            );
            assert!(should_notify_unavailable(&inp));
        }
    }

    #[test]
    fn v2_cross_adapter_falls_back_and_notifies() {
        let mut inp = all_pass();
        inp.same_adapter = false;
        assert_eq!(select_capture_mode_v2(&inp), CaptureMode::Wgc);
        assert_eq!(fallback_reason(&inp), FallbackReason::CrossAdapter);
        assert!(should_notify_unavailable(&inp));
    }

    #[test]
    fn v2_fallback_reason_respects_first_failing_gate_order() {
        // Platform beats every later gate: even with a monitor source, a
        // disabled hook, and a failed injection, NotWindows wins.
        let mut inp = all_pass();
        inp.is_windows = false;
        inp.source_kind = SourceKind::Monitor;
        inp.hook_enabled = false;
        inp.injection = InjectionOutcome::Failed;
        assert_eq!(fallback_reason(&inp), FallbackReason::NotWindows);

        // Monitor beats hook-disabled and later gates.
        let mut inp = all_pass();
        inp.source_kind = SourceKind::Monitor;
        inp.hook_enabled = false;
        inp.artifact_available = false;
        assert_eq!(fallback_reason(&inp), FallbackReason::MonitorSource);

        // Hook-disabled beats backend/artifact/safety/injection gates.
        let mut inp = all_pass();
        inp.hook_enabled = false;
        inp.backend = GraphicsApiBackend::Dx12;
        inp.artifact_available = false;
        assert_eq!(fallback_reason(&inp), FallbackReason::HookDisabled);

        // Backend beats artifact, safety, and injection.
        let mut inp = all_pass();
        inp.backend = GraphicsApiBackend::Vulkan;
        inp.artifact_available = false;
        inp.safety = SafetyDecision::Deny(FallbackReason::Blocklisted);
        assert_eq!(fallback_reason(&inp), FallbackReason::BackendDisabled);

        // Artifact beats safety and injection.
        let mut inp = all_pass();
        inp.artifact_available = false;
        inp.safety = SafetyDecision::Deny(FallbackReason::Blocklisted);
        inp.injection = InjectionOutcome::Failed;
        assert_eq!(fallback_reason(&inp), FallbackReason::MissingArtifact);

        // Safety beats injection and cross-adapter.
        let mut inp = all_pass();
        inp.safety = SafetyDecision::Deny(FallbackReason::Blocklisted);
        inp.injection = InjectionOutcome::Failed;
        inp.same_adapter = false;
        assert_eq!(fallback_reason(&inp), FallbackReason::Blocklisted);

        // Injection beats cross-adapter.
        let mut inp = all_pass();
        inp.injection = InjectionOutcome::Blocked;
        inp.same_adapter = false;
        assert_eq!(fallback_reason(&inp), FallbackReason::InjectionDenied);
    }

    #[test]
    fn v2_select_and_fallback_agree() {
        // The mode is Hook iff fallback_reason is None, across the single-field
        // perturbations of an all-pass baseline.
        let base = all_pass();
        let perturbations: [SelectionInputs; 8] = [
            SelectionInputs {
                is_windows: false,
                ..base
            },
            SelectionInputs {
                source_kind: SourceKind::Monitor,
                ..base
            },
            SelectionInputs {
                hook_enabled: false,
                ..base
            },
            SelectionInputs {
                backend: GraphicsApiBackend::Dx12,
                ..base
            },
            SelectionInputs {
                artifact_available: false,
                ..base
            },
            SelectionInputs {
                safety: SafetyDecision::Deny(FallbackReason::Blocklisted),
                ..base
            },
            SelectionInputs {
                injection: InjectionOutcome::Failed,
                ..base
            },
            SelectionInputs {
                same_adapter: false,
                ..base
            },
        ];
        // Baseline: Hook ⇔ None.
        assert_eq!(select_capture_mode_v2(&base), CaptureMode::Hook);
        assert_eq!(fallback_reason(&base), FallbackReason::None);
        for inp in perturbations {
            assert_eq!(select_capture_mode_v2(&inp), CaptureMode::Wgc);
            assert_ne!(fallback_reason(&inp), FallbackReason::None);
        }
    }

    // ── capture policy ──────────────────────────────────────────────────

    #[test]
    fn capture_policy_strings_are_stable() {
        // Status contract strings consumed by `NativeShareStats` (Req 5.5).
        assert_eq!(CapturePolicy::HookExclusive.as_str(), "hook-exclusive");
        assert_eq!(CapturePolicy::WgcEnabled.as_str(), "wgc-enabled");
    }

    #[test]
    fn wgc_enabled_uses_short_initial_hook_timeout() {
        assert_eq!(
            initial_hook_first_frame_timeout_ms(CapturePolicy::WgcEnabled),
            1_500
        );
        assert_eq!(
            initial_hook_first_frame_timeout_ms(CapturePolicy::HookExclusive),
            8_000
        );
    }

    #[test]
    fn resolve_policy_runtime_wins_over_feature_default() {
        // Runtime setting wins when present, regardless of the feature default
        // (Req 5.1).
        assert_eq!(
            resolve_capture_policy(
                Some(CapturePolicy::HookExclusive),
                Some(CapturePolicy::WgcEnabled)
            ),
            CapturePolicy::HookExclusive
        );
        assert_eq!(
            resolve_capture_policy(
                Some(CapturePolicy::WgcEnabled),
                Some(CapturePolicy::HookExclusive)
            ),
            CapturePolicy::WgcEnabled
        );
        // Runtime wins even when there is no feature default.
        assert_eq!(
            resolve_capture_policy(Some(CapturePolicy::HookExclusive), None),
            CapturePolicy::HookExclusive
        );
    }

    #[test]
    fn resolve_policy_falls_back_to_feature_default_then_wgc() {
        // No runtime ⇒ the feature default applies (Req 5.1).
        assert_eq!(
            resolve_capture_policy(None, Some(CapturePolicy::HookExclusive)),
            CapturePolicy::HookExclusive
        );
        assert_eq!(
            resolve_capture_policy(None, Some(CapturePolicy::WgcEnabled)),
            CapturePolicy::WgcEnabled
        );
        // Neither specified ⇒ default to `wgc-enabled` (Req 5.1).
        assert_eq!(
            resolve_capture_policy(None, None),
            CapturePolicy::WgcEnabled
        );
    }

    #[test]
    fn apply_policy_hook_stays_hook_for_both_policies() {
        // When the pure mode is Hook, the resolution is Hook regardless of the
        // policy and WGC is never chosen (Req 4.2).
        let inp = all_pass();
        assert_eq!(select_capture_mode_v2(&inp), CaptureMode::Hook);
        for policy in [CapturePolicy::HookExclusive, CapturePolicy::WgcEnabled] {
            assert_eq!(
                apply_capture_policy(&inp, policy),
                CaptureResolution::Hook,
                "policy {policy:?} must keep Hook"
            );
        }
    }

    #[test]
    fn apply_policy_monitor_is_wgc_for_both_policies() {
        // A monitor source always resolves to WGC under either policy, carrying
        // the monitor-source reason (Req 4.5, 5.4).
        let mut inp = all_pass();
        inp.source_kind = SourceKind::Monitor;
        for policy in [CapturePolicy::HookExclusive, CapturePolicy::WgcEnabled] {
            assert_eq!(
                apply_capture_policy(&inp, policy),
                CaptureResolution::Wgc {
                    reason: FallbackReason::MonitorSource
                },
                "policy {policy:?} must keep monitor on WGC"
            );
        }
    }

    #[test]
    fn apply_policy_hook_eligible_window_fallback_depends_on_policy() {
        // A hook-eligible window whose hook is unavailable: wgc-enabled falls
        // back to WGC with the reason (Req 5.2); hook-exclusive reports
        // capture-unavailable with the same reason (Req 5.3).
        let mut inp = all_pass();
        inp.injection = InjectionOutcome::Failed;
        assert_eq!(select_capture_mode_v2(&inp), CaptureMode::Wgc);
        let reason = fallback_reason(&inp);
        assert_eq!(reason, FallbackReason::InjectionFailed);

        assert_eq!(
            apply_capture_policy(&inp, CapturePolicy::WgcEnabled),
            CaptureResolution::Wgc { reason }
        );
        assert_eq!(
            apply_capture_policy(&inp, CapturePolicy::HookExclusive),
            CaptureResolution::Unavailable { reason }
        );
    }

    #[test]
    fn apply_policy_carries_exact_fallback_reason() {
        // The reason carried by Wgc/Unavailable is exactly what `fallback_reason`
        // reports for the same inputs, across single-field perturbations.
        let base = all_pass();
        let perturbations: [SelectionInputs; 4] = [
            SelectionInputs {
                artifact_available: false,
                ..base
            },
            SelectionInputs {
                safety: SafetyDecision::Deny(FallbackReason::Blocklisted),
                ..base
            },
            SelectionInputs {
                injection: InjectionOutcome::Blocked,
                ..base
            },
            SelectionInputs {
                same_adapter: false,
                ..base
            },
        ];
        for inp in perturbations {
            let reason = fallback_reason(&inp);
            assert_eq!(
                apply_capture_policy(&inp, CapturePolicy::WgcEnabled),
                CaptureResolution::Wgc { reason }
            );
            assert_eq!(
                apply_capture_policy(&inp, CapturePolicy::HookExclusive),
                CaptureResolution::Unavailable { reason }
            );
        }
    }
}
