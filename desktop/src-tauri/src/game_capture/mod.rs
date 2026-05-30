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

/// Graphics APIs the `Game_Capture_Hook` can target. DX11 is implemented
/// first; the others are present but gated behind a working DX11 hook so the
/// net-new injection functionality ships incrementally (Req 8.1, 8.2).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GraphicsApiBackend {
    Dx11,
    /// Gated behind DX11 success (Req 8.2).
    Dx12,
    /// Gated behind DX11 success (Req 8.2).
    Vulkan,
    /// Gated behind DX11 success (Req 8.2).
    OpenGl,
}

impl GraphicsApiBackend {
    /// Whether this backend may be used as the active `hook` Capture_Mode.
    ///
    /// Only DX11 is permitted until it meets its success criteria; every other
    /// backend returns `false` so it can exist in the codebase without ever
    /// being selected (Req 8.1, 8.2).
    pub fn is_active_capable(self) -> bool {
        matches!(self, GraphicsApiBackend::Dx11)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_dx11_backend_is_active_capable() {
        assert!(GraphicsApiBackend::Dx11.is_active_capable());
        assert!(!GraphicsApiBackend::Dx12.is_active_capable());
        assert!(!GraphicsApiBackend::Vulkan.is_active_capable());
        assert!(!GraphicsApiBackend::OpenGl.is_active_capable());
    }

    #[test]
    fn capture_mode_strings_are_stable() {
        assert_eq!(CaptureMode::Wgc.as_str(), "wgc");
        assert_eq!(CaptureMode::Hook.as_str(), "hook");
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
    fn non_dx11_backends_select_wgc() {
        for backend in [
            GraphicsApiBackend::Dx12,
            GraphicsApiBackend::Vulkan,
            GraphicsApiBackend::OpenGl,
        ] {
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
}
