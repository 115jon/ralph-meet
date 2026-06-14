//! Shared-surface opener + the OBS IPC-backed game-capture hook handle
//! (Requirements 1.3, 1.6, 4.1, 4.3, 5.3, 7.5, 8.3, 9.2, 9.3).
//!
//! This module owns the **host-side, zero-copy** half of the Game_Capture_Hook:
//!
//! 1. [`open_shared_surface`] — the zero-copy step. It calls
//!    `ID3D11Device::OpenSharedResource` on the single `Shared_D3D_Device` to
//!    alias the DXGI shared texture the injected OBS `graphics-hook` published.
//!    On the confirmed single-adapter box that device is the game's adapter, so
//!    opening the handle aliases the same VRAM allocation — **no cross-device
//!    copy** (Req 4.3, 5.3) and **no CPU readback** (Req 1.3). The opened
//!    `ID3D11Texture2D` is exactly the type the `Video_Processor`/`MFT_Encoder`
//!    path already consumes, so it feeds the encoder unchanged.
//!
//! 2. [`GameCaptureHook`] — the lifecycle handle over an [`ObsIpcChannel`]. It
//!    pulls frame metadata from the channel, opens a **new** shared handle only
//!    when the hook republishes a changed handle (swapchain resize/recreate,
//!    Req 9.2), retains **at most one** surface at a time (Req 7.5), and on stop
//!    signals the hook and releases the surface + IPC (Req 1.6, 9.3). A bounded
//!    `next_metadata` wait keeps the no-frame watchdog responsive (Req 8.3).
//!
//! # The pivot away from the legacy custom injector
//!
//! The prior `screen-share-zero-overhead` scaffolding shipped a **custom**
//! injector here (`CreateRemoteThread` + `LoadLibraryW` of a nonexistent
//! `ralph_dx11_hook.dll`, plus an `AtomicIsize` shared-handle stub nothing ever
//! wrote). That whole machinery is **removed**. Injection now runs as a
//! separate-process OBS `inject-helper` (`game_capture::inject::run_inject_helper`,
//! task 3.2), and frames arrive over the project's own clean-room OBS IPC reader
//! (`game_capture::obs_ipc::ObsIpcChannel`, task 4.2). [`GameCaptureHook`] simply
//! turns the handles that channel reports into zero-copy [`SharedSurface`]s.
//!
//! # Feature gating
//!
//! [`SharedSurface`] and [`open_shared_surface`] compile under
//! `native-screen-share` (the whole `game_capture` module is declared there in
//! `lib.rs`) because the opener is reused by the WGC-adjacent paths.
//! [`GameCaptureHook`] is gated behind `game-capture-hook` **and** `windows`
//! because it owns an [`ObsIpcChannel`], which is Windows-only and lives behind
//! that feature.
//!
//! The legacy [`Dx11Hook`]/[`AttachResult`] types are retained as a thin,
//! injection-free **transitional shim** so `native_share.rs` keeps compiling on
//! the `native-screen-share`-only path until task 11.1 rewires the session to
//! use [`GameCaptureHook`]; they no longer perform any injection.

use std::sync::Arc;

use windows::core::Result as WinResult;
use windows::Win32::Foundation::HANDLE;
use windows::Win32::Graphics::Direct3D11::{ID3D11Texture2D, D3D11_TEXTURE2D_DESC};

use super::{GraphicsApiBackend, InjectionOutcome};
use crate::d3d_device::D3dDevice;

/// A shared D3D11 surface opened on the [`Shared_D3D_Device`](D3dDevice).
///
/// The `texture` aliases the game's presented backbuffer copy on the **same**
/// device used for capture and encode (single-GPU, no cross-device copy). It is
/// handed straight to the encoder's video processor with no CPU readback.
pub struct SharedSurface {
    pub texture: ID3D11Texture2D,
    pub width: u32,
    pub height: u32,
}

// The COM texture is only touched from the dedicated capture/encode threads and
// is protected by the device's ID3D11Multithread, mirroring `CapturedFrame`.
unsafe impl Send for SharedSurface {}

#[cfg(all(feature = "game-capture-hook", windows))]
impl SharedSurface {
    /// Produce another [`SharedSurface`] that aliases the **same** GPU texture.
    ///
    /// `ID3D11Texture2D` is a refcounted COM interface, so `.clone()` is an
    /// `AddRef` (a pointer/refcount bump), not a GPU copy. This lets the hook
    /// keep a cached, already-opened surface and hand the encoder a fresh alias
    /// per frame without re-running `OpenSharedResource` (a kernel handle
    /// duplication + resource open) on the steady-state path. Both the cached
    /// original and the clone point at the identical VRAM the DLL writes each
    /// present — still strictly zero-copy.
    pub fn clone_alias(&self) -> SharedSurface {
        SharedSurface {
            texture: self.texture.clone(),
            width: self.width,
            height: self.height,
        }
    }
}

/// Open a shared D3D11 resource handle on the single `Shared_D3D_Device`.
///
/// This is the host-side zero-copy step: `OpenSharedResource` aliases the
/// already-resident backbuffer copy onto our device without any CPU readback
/// and, on the single-GPU target, without a cross-device copy
/// (Requirements 1.3, 4.3, 5.3).
pub fn open_shared_surface(d3d: &D3dDevice, shared_handle: HANDLE) -> WinResult<SharedSurface> {
    unsafe {
        let mut texture: Option<ID3D11Texture2D> = None;
        d3d.device
            .OpenSharedResource::<ID3D11Texture2D>(shared_handle, &mut texture)?;
        let texture = texture.unwrap();

        let mut desc = D3D11_TEXTURE2D_DESC::default();
        texture.GetDesc(&mut desc);

        Ok(SharedSurface {
            texture,
            width: desc.Width,
            height: desc.Height,
        })
    }
}

// ───────────────────────────────────────────────────────────────────────────
// GameCaptureHook — the OBS IPC-backed shared-surface source (task 6.1)
//
// Gated behind `game-capture-hook` + `windows` because it owns an
// `ObsIpcChannel`, which is Windows-only and lives behind that feature.
// ───────────────────────────────────────────────────────────────────────────

#[cfg(all(feature = "game-capture-hook", windows))]
use crate::game_capture::obs_ipc::{IpcError, ObsIpcChannel};

/// Convert an [`IpcError`] from the OBS IPC reader into a `windows` error so
/// [`GameCaptureHook::next_surface`] can surface it through its `WinResult`.
///
/// A real Win32 failure backing the channel preserves its `HRESULT`/code; a
/// malformed `hook_info` payload maps to `E_UNEXPECTED`. Either way the session
/// can fall back to WGC and record the reason (Req 9.3).
#[cfg(all(feature = "game-capture-hook", windows))]
fn ipc_error_to_win(err: IpcError) -> windows::core::Error {
    use windows::core::{Error, HRESULT};
    match err {
        IpcError::Os { context, code } => {
            log::warn!("[GameCaptureHook] OBS IPC call {context} failed (code {code:#010x})");
            Error::from_hresult(HRESULT(code))
        }
        IpcError::MalformedHookInfo { got, expected } => {
            let msg = format!("malformed OBS hook_info: expected {expected} bytes, got {got}");
            Error::new(HRESULT(0x8000_FFFFu32 as i32), msg.as_str()) // E_UNEXPECTED
        }
    }
}

/// A live game-capture hook backed by the OBS IPC reader.
///
/// Evolved from the legacy `Dx11Hook`, but instead of a custom injector + a
/// shared-handle stub it owns an [`ObsIpcChannel`] (the project's clean-room
/// consumer of OBS's shared-texture protocol) and turns the handles that channel
/// reports into zero-copy [`SharedSurface`]s on the `Shared_D3D_Device`.
///
/// Retains **at most one** surface at a time (Req 7.5): [`next_surface`] opens a
/// new shared handle only when the hook republishes a changed handle
/// (swapchain resize/recreate, Req 9.2), releasing the prior surface first. On
/// stop, [`detach`] signals the hook, releases the surface, and stops the IPC
/// channel; it is idempotent and runs from [`Drop`] (Req 1.6).
///
/// [`next_surface`]: Self::next_surface
/// [`detach`]: Self::detach
#[cfg(all(feature = "game-capture-hook", windows))]
pub struct GameCaptureHook {
    /// The single `Shared_D3D_Device` shared by capture and encode; shared
    /// handles are opened on it (zero-copy, single-adapter).
    d3d: Arc<D3dDevice>,
    /// The live OBS IPC channel supplying frame metadata + shared handles.
    ipc: ObsIpcChannel,
    /// The target's graphics backend (DX11 first; others gated upstream).
    backend: GraphicsApiBackend,
    /// The single retained shared surface, or `None` before the first frame /
    /// after [`detach`](Self::detach). Replacing it drops (COM-releases) the
    /// prior surface, enforcing retain-at-most-one (Req 7.5).
    current: Option<SharedSurface>,
    /// The shared handle currently open, for diagnostics/status. The
    /// authoritative resize/recreate detection lives in the channel
    /// ([`ObsIpcChannel::handle_changed`]/`mark_handle_opened`).
    last_handle: u64,
    /// The target process id (for stats/logging).
    target_pid: u32,
    /// Whether the hook is currently attached; cleared by [`detach`](Self::detach).
    attached: bool,
}

// SAFETY: the contained `ObsIpcChannel` and `SharedSurface` are each `Send` (the
// COM texture is multithread-protected by the device; the channel's handles are
// owned solely by this hook), and the `Arc<D3dDevice>` is shared exactly as in
// `WgcCapture`. The hook is moved onto the single capture thread the session
// owns, so transferring ownership across the thread boundary is sound.
#[cfg(all(feature = "game-capture-hook", windows))]
unsafe impl Send for GameCaptureHook {}

#[cfg(all(feature = "game-capture-hook", windows))]
impl GameCaptureHook {
    /// Build a hook over an already-started [`ObsIpcChannel`] for `target_pid`.
    ///
    /// The actual injection orchestration (running the OBS `inject-helper` and
    /// starting the channel) is the session's job in task 11.1; this constructor
    /// just adopts the live channel as the surface source. The hook starts
    /// `attached` with no retained surface.
    pub fn new(
        d3d: Arc<D3dDevice>,
        ipc: ObsIpcChannel,
        backend: GraphicsApiBackend,
        target_pid: u32,
    ) -> Self {
        Self {
            d3d,
            ipc,
            backend,
            current: None,
            last_handle: 0,
            target_pid,
            attached: true,
        }
    }

    /// Pull the next zero-copy [`SharedSurface`], opening a new shared handle
    /// **only** when the hook republished a changed handle.
    ///
    /// Flow (Req 7.5, 9.2):
    /// - `Ok(None)` when no frame has been published this round (the channel's
    ///   bounded wait timed out, the mapping is not up yet, or the channel was
    ///   stopped) — the caller's watchdog handles a persistent `None` (Req 8.3).
    /// - When metadata arrives and its shared handle **changed**
    ///   ([`ObsIpcChannel::handle_changed`]): release the prior surface first
    ///   (retain-at-most-one), open the new handle on the `Shared_D3D_Device`,
    ///   record it ([`ObsIpcChannel::mark_handle_opened`]), and return it.
    /// - When the handle is **unchanged**: reuse the already-open surface.
    ///
    /// `Err` only on a genuine Win32/IPC failure (mapped from [`IpcError`]) or a
    /// failed `OpenSharedResource`, so the session can fall back to WGC (Req 9.3).
    pub fn next_surface(&mut self) -> WinResult<Option<&SharedSurface>> {
        if !self.attached {
            return Ok(None);
        }

        let meta = match self.ipc.next_metadata() {
            Ok(Some(meta)) => meta,
            Ok(None) => return Ok(None),
            Err(e) => return Err(ipc_error_to_win(e)),
        };

        // Defensive: a published handle of 0 is "no shared texture yet" — there
        // is nothing to open, so report no frame rather than failing the open.
        if meta.shared_handle == 0 {
            return Ok(None);
        }

        if self.ipc.handle_changed(&meta) {
            // Retain-at-most-one (Req 7.5): release the prior surface BEFORE
            // opening the next, so we never hold two shared surfaces at once.
            self.current = None;

            let handle = HANDLE(meta.shared_handle as *mut core::ffi::c_void);
            let surface = open_shared_surface(&self.d3d, handle)?;
            self.current = Some(surface);
            self.last_handle = meta.shared_handle;

            // Record the open so frames with the same handle reuse the surface
            // and only a genuine resize/recreate re-opens (Req 9.2).
            self.ipc.mark_handle_opened(&meta);
        }
        // else: the handle is unchanged — reuse the currently retained surface.

        Ok(self.current.as_ref())
    }

    /// Pull the next frame as an **owned** [`CapturedFrame`](crate::wgc_capture::CapturedFrame)
    /// ready for the encoder frame channel, via the hook-surface frame adapter
    /// (Req 1.3, 5.3, 7.1).
    ///
    /// This is the session-orchestration entry point (task 11.1) — distinct from
    /// [`next_surface`](Self::next_surface), which returns a borrow the hook
    /// retains internally. The session feeds owned `CapturedFrame`s into the
    /// encoder's `frame_tx`, so this opens the published shared handle on the
    /// `Shared_D3D_Device` and hands the resulting [`SharedSurface`] to
    /// [`CapturedFrame::from_hook_surface`](crate::wgc_capture::CapturedFrame::from_hook_surface),
    /// which wraps it (zero-copy, no CPU readback) and caps its reported
    /// dimensions to `cap_width`/`cap_height`.
    ///
    /// Retain-at-most-one (Req 7.5) is enforced by the **caller**: the session
    /// pump pulls the next frame only after the prior delivered frame's release
    /// token has fired (the encoder finished its fused-blit read and dropped the
    /// frame), so at most one opened surface is ever live at a time. Because the
    /// caller gates on release, this opens a fresh alias of the shared resource
    /// per delivered frame rather than retaining one in `self.current`.
    ///
    /// Returns `Ok(None)` when no frame is published this round (a bounded IPC
    /// wait timed out, the mapping is not up yet, the published handle is `0`, the
    /// texture-access lock could not be acquired within 100 ms (Req 3.4/3.7 — the
    /// frame is skipped rather than read torn), or the hook was detached) — the
    /// caller's no-frame watchdog handles a persistent `None` (Req 8.3). `Err`
    /// only on a genuine Win32/IPC failure or a failed `OpenSharedResource`, so
    /// the session can fall back to WGC (Req 9.3). The actual zero-copy delivery
    /// is hardware-gated and validated by the manual integration tests
    /// (task 11.4); this method is the host-side wiring those tests exercise.
    #[cfg(all(feature = "game-capture-hook", windows))]
    pub fn next_captured_frame(
        &mut self,
        cap_width: u32,
        cap_height: u32,
    ) -> WinResult<Option<crate::wgc_capture::CapturedFrame>> {
        if !self.attached {
            return Ok(None);
        }

        let meta = match self.ipc.next_metadata() {
            Ok(Some(meta)) => meta,
            Ok(None) => return Ok(None),
            Err(e) => return Err(ipc_error_to_win(e)),
        };

        // A published handle of 0 is "no shared texture yet" — report no frame.
        if meta.shared_handle == 0 {
            return Ok(None);
        }

        // Open the published shared handle ONCE per handle (not per frame):
        // OBS writes every present into the SAME shared texture between resizes,
        // so the handle is stable and `OpenSharedResource` (a kernel handle
        // duplication + GPU resource open) only needs to run when the handle
        // actually changes (a swapchain resize/recreate republishes a new one —
        // Req 9.2). Caching the opened `ID3D11Texture2D` and handing the encoder
        // a cheap COM clone (an AddRef) per frame removes a per-frame kernel/GPU
        // open from the steady-state path — measurable overhead at high frame
        // rates — while still aliasing the exact same VRAM (zero copy).
        if self.ipc.handle_changed(&meta) {
            self.current = None; // release the prior alias before opening the new
            let handle = HANDLE(meta.shared_handle as *mut core::ffi::c_void);
            // Acquire the texture-access lock only around the open (the DLL may
            // be mid-republish on a resize). On timeout, skip this frame.
            if !self.ipc.acquire_texture_lock(100) {
                log::warn!(
                    "[GameCaptureHook] texture lock acquisition timed out (100ms) for pid {} \
                     during surface open — skipping frame",
                    self.target_pid
                );
                return Ok(None);
            }
            let opened = open_shared_surface(&self.d3d, handle);
            self.ipc.release_texture_lock();
            let surface = match opened {
                Ok(surface) => surface,
                Err(e) => return Err(e),
            };
            self.current = Some(surface);
            self.last_handle = meta.shared_handle;
            self.ipc.mark_handle_opened(&meta);
        }

        // Reuse the cached surface: hand the encoder a COM clone (AddRef), which
        // aliases the same GPU texture — no re-open, no copy. The DLL keeps
        // copying each present into this texture; the per-frame texture-access
        // mutex below serialises the host read against that copy so no torn
        // frame is sampled.
        let Some(cached) = self.current.as_ref() else {
            return Ok(None);
        };

        // Acquire the OBS 32.1.2 texture-access lock (TextureMutex1) before
        // building the frame the encoder will read, waiting at most 100 ms
        // (Req 3.4). On timeout skip this frame rather than read a
        // torn/partially-written surface (Req 3.7), dropping only that frame
        // (Req 1.8) — the no-frame watchdog handles a persistent skip.
        if !self.ipc.acquire_texture_lock(100) {
            log::warn!(
                "[GameCaptureHook] texture lock acquisition timed out (100ms) for pid {} \
                 — skipping frame",
                self.target_pid
            );
            return Ok(None);
        }

        // Clone the cached surface (COM AddRef on the same GPU texture — no copy,
        // no kernel open) and adapt it into the single encoder frame path
        // (Req 7.1). The clone keeps the texture alive for the encoder's async
        // read; the cached original stays for the next frame.
        let surface_clone = cached.clone_alias();
        let frame = crate::wgc_capture::CapturedFrame::from_hook_surface(
            surface_clone,
            &meta,
            cap_width,
            cap_height,
        );

        // The host-side read/alias is complete — release the texture lock before
        // handing the frame off (Req 3.4: release after the read completes).
        self.ipc.release_texture_lock();
        Ok(Some(frame))
    }

    /// Whether the target signaled exit or the IPC channel was stopped
    /// (Req 9.3). The session pump polls this to fall back to WGC mid-session
    /// when the target process exits.
    #[cfg(all(feature = "game-capture-hook", windows))]
    pub fn target_exited(&self) -> bool {
        self.ipc.target_exited()
    }

    /// Detach: release the retained surface and stop the IPC channel (Req 1.6,
    /// 7.4, 9.3). Idempotent — safe to call more than once and from [`Drop`].
    pub fn detach(&mut self) {
        if !self.attached {
            return;
        }

        // Release the retained shared surface (COM release on drop).
        self.current = None;
        // Signal the hook to stop and release the IPC events + mapping. The
        // channel's own `stop` is idempotent.
        self.ipc.stop();
        self.last_handle = 0;
        self.attached = false;

        log::info!(
            "[GameCaptureHook] detached from pid {} ({:?}); released shared surface + IPC",
            self.target_pid,
            self.backend
        );
    }

    /// Whether the hook is currently attached.
    pub fn is_attached(&self) -> bool {
        self.attached
    }

    /// The target process id (for stats/logging).
    pub fn target_pid(&self) -> u32 {
        self.target_pid
    }

    /// The target's graphics backend (reported in status when `hook` is active).
    pub fn backend(&self) -> GraphicsApiBackend {
        self.backend
    }

    /// The graphics API the injected DLL **actually** hooked, read live from
    /// `hook_info.hooked_api`. This is the truthful backend (Vulkan/DXGI/D3D9/
    /// …) — the DLL records which present interception installed — so the host
    /// can label `Capture_Status` accurately instead of guessing from loaded
    /// modules. [`HookedApi::None`] until the DLL installs a hook.
    pub fn hooked_api(&self) -> crate::game_capture::obs_ipc::HookedApi {
        self.ipc.read_hooked_api()
    }

    /// Update the DLL's capture-rate cap (`hook_info.frame_interval`) live, so a
    /// mid-session fps change (e.g. 30→60 on a quality switch) actually raises
    /// the number of frames the DLL copies — without this the capture stays at
    /// the injection-time fps even though the encoder was reconfigured higher.
    pub fn set_capture_frame_interval(&mut self, frame_interval_ns: u64) {
        self.ipc.set_frame_interval(frame_interval_ns);
    }

    /// The shared handle currently open (for diagnostics/status); `0` when no
    /// surface is retained.
    pub fn last_handle(&self) -> u64 {
        self.last_handle
    }
}

#[cfg(all(feature = "game-capture-hook", windows))]
impl Drop for GameCaptureHook {
    fn drop(&mut self) {
        self.detach();
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Legacy transitional shim (removed in task 11.1)
//
// `native_share.rs` still names `Dx11Hook`/`AttachResult` on the
// `native-screen-share`-only path. The custom `CreateRemoteThread`/`LoadLibraryW`
// injector and the `AtomicIsize` shared-handle stub are GONE; injection now runs
// through `game_capture::inject::run_inject_helper` and frames flow through
// `GameCaptureHook`. This shim performs no injection: `try_attach` always reports
// `NotAttempted` so the session cleanly uses WGC until task 11.1 rewires it onto
// `GameCaptureHook`.
// ───────────────────────────────────────────────────────────────────────────

/// Outcome of a (now injection-free) legacy attach attempt.
///
/// Retained so `native_share.rs` keeps compiling until task 11.1. The session
/// feeds [`outcome`](Self::outcome) into `select_capture_mode`; a non-`Success`
/// outcome falls back to WGC.
#[allow(dead_code)]
pub struct AttachResult {
    pub outcome: InjectionOutcome,
    pub hook: Option<Dx11Hook>,
    pub detail: String,
}

#[allow(dead_code)]
impl AttachResult {
    fn failed(detail: impl Into<String>) -> Self {
        Self {
            outcome: InjectionOutcome::Failed,
            hook: None,
            detail: detail.into(),
        }
    }

    fn blocked(detail: impl Into<String>) -> Self {
        Self {
            outcome: InjectionOutcome::Blocked,
            hook: None,
            detail: detail.into(),
        }
    }

    fn not_attempted(detail: impl Into<String>) -> Self {
        Self {
            outcome: InjectionOutcome::NotAttempted,
            hook: None,
            detail: detail.into(),
        }
    }
}

/// Legacy hook handle, retained only as a transitional type until task 11.1
/// rewires `native_share.rs` onto [`GameCaptureHook`]. It performs no injection
/// and never yields a surface.
#[allow(dead_code)]
pub struct Dx11Hook {
    pid: u32,
    attached: bool,
}

// Mirrors the historical `Send` marker so the type can still live in the
// session's `Mutex<Option<Dx11Hook>>` field.
unsafe impl Send for Dx11Hook {}

#[allow(dead_code)]
impl Dx11Hook {
    /// Legacy entry point. The custom injector has been removed, so this always
    /// reports [`InjectionOutcome::NotAttempted`] with no hook; the session
    /// resolves that to the WGC fallback. The real hook path is built in task
    /// 11.1 via [`GameCaptureHook`] over the OBS `inject-helper` + IPC reader.
    pub fn try_attach(
        _d3d: &Arc<D3dDevice>,
        _hwnd: isize,
        backend: GraphicsApiBackend,
    ) -> AttachResult {
        AttachResult::not_attempted(format!(
            "legacy Dx11Hook injector removed; {backend:?} capture now flows through the OBS \
             inject-helper + GameCaptureHook (game_capture::inject / dx11::GameCaptureHook). \
             This shim is retained only until native_share.rs is rewired (task 11.1)."
        ))
    }

    /// No surface is ever produced by the shim; the real source is
    /// [`GameCaptureHook::next_surface`].
    pub fn next_surface(&mut self) -> WinResult<Option<&SharedSurface>> {
        Ok(None)
    }

    /// Whether the (shim) hook is attached. Always `false` in practice since
    /// [`try_attach`](Self::try_attach) never produces one.
    pub fn is_attached(&self) -> bool {
        self.attached
    }

    /// The target process id (always `0` for the shim).
    pub fn target_pid(&self) -> u32 {
        self.pid
    }

    /// Idempotent no-op detach (the shim holds no resources).
    pub fn detach(&mut self) {
        self.attached = false;
    }
}

#[allow(dead_code)]
impl Drop for Dx11Hook {
    fn drop(&mut self) {
        self.detach();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn non_dx11_backend_is_not_attempted() {
        // The legacy shim never attempts injection; every backend resolves to
        // `NotAttempted` with no hook, so the session uses the WGC fallback.
        for backend in [
            GraphicsApiBackend::Dx11,
            GraphicsApiBackend::Dx12,
            GraphicsApiBackend::Vulkan,
            GraphicsApiBackend::OpenGl,
        ] {
            let result = shim_attach(backend);
            assert_eq!(result.outcome, InjectionOutcome::NotAttempted);
            assert!(result.hook.is_none());
            assert!(!result.detail.is_empty());
        }
    }

    /// Mirror of the shim's `try_attach` decision without constructing a
    /// `D3dDevice` (so it runs on CI without a GPU).
    fn shim_attach(backend: GraphicsApiBackend) -> AttachResult {
        AttachResult::not_attempted(format!(
            "legacy Dx11Hook injector removed; {backend:?} now flows through GameCaptureHook"
        ))
    }

    #[test]
    fn attach_result_constructors_carry_outcome() {
        assert_eq!(AttachResult::failed("x").outcome, InjectionOutcome::Failed);
        assert_eq!(
            AttachResult::blocked("x").outcome,
            InjectionOutcome::Blocked
        );
        assert_eq!(
            AttachResult::not_attempted("x").outcome,
            InjectionOutcome::NotAttempted
        );
    }
}
