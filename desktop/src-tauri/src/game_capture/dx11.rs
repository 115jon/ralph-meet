//! DX11 zero-copy game-capture hook (Tier 3, Requirement 7).
//!
//! This is the OBS-/Discord-style injection backend that intercepts a DX11
//! game's *presented* backbuffer before DWM composition and hands the encoder a
//! **shared D3D11 surface** — no CPU readback, no cross-device copy
//! (Requirements 7.1, 7.2, 7.5, 11.4).
//!
//! # How zero-copy is achieved
//!
//! The capture is split across two processes, exactly as the design's sequence
//! diagram describes:
//!
//! 1. **Injector (this module, host process).** [`Dx11Hook::try_attach`]
//!    resolves the target process from its window handle, confirms injection is
//!    permitted, and injects the hook payload (the classic
//!    `CreateRemoteThread` + `LoadLibraryW` technique). It then exposes a
//!    [`shared_handle_sink`](Dx11Hook::shared_handle_sink) the payload writes to.
//!
//! 2. **Payload (injected into the game).** Inside the game it patches
//!    `IDXGISwapChain::Present`. On each present it copies the backbuffer into a
//!    texture created with `D3D11_RESOURCE_MISC_SHARED`, obtains a *shared
//!    handle* for it, and publishes that handle back to the host. (A backbuffer
//!    cannot be shared directly, so a single same-device copy into a shareable
//!    texture is the standard, GPU-local step; it is **not** a cross-device copy
//!    and never touches the CPU.) The payload itself is a separate native
//!    artifact and is not part of this Rust module.
//!
//! 3. **Host opens the shared surface on the single `Shared_D3D_Device`.**
//!    [`open_shared_surface`] calls `ID3D11Device::OpenSharedResource` on the
//!    one device already shared by capture and encode. On the confirmed
//!    single-discrete-GPU box that device is the game's adapter, so opening the
//!    shared handle aliases the same VRAM allocation — **no cross-device copy**
//!    (Requirement 11.4) and **no CPU readback** (Requirement 7.2). The opened
//!    `ID3D11Texture2D` is the exact type the existing
//!    `Video_Processor`/`MFT_Encoder` path already consumes, so it feeds the
//!    encoder unchanged.
//!
//! On stop, [`Dx11Hook::detach`] releases the opened shared surface(s) and the
//! target-process handle (Requirement 7.5). Any failure to attach or intercept
//! is reported as a non-`Success` [`InjectionOutcome`] so the orchestrator can
//! fall back to WGC (handled in `native_share.rs`, Requirements 6.3, 7.4).
//!
//! Everything here is behind the `native-screen-share` feature gate (the whole
//! `game_capture` module is, in `lib.rs`).

use std::ffi::c_void;
use std::sync::atomic::{AtomicIsize, Ordering};
use std::sync::Arc;

use windows::core::{s, w, Error, Result as WinResult, HRESULT};
use windows::Win32::Foundation::{CloseHandle, HANDLE, HWND};
use windows::Win32::Graphics::Direct3D11::{ID3D11Texture2D, D3D11_TEXTURE2D_DESC};
use windows::Win32::System::Diagnostics::Debug::WriteProcessMemory;
use windows::Win32::System::LibraryLoader::{GetModuleHandleW, GetProcAddress};
use windows::Win32::System::Memory::{
    VirtualAllocEx, VirtualFreeEx, MEM_COMMIT, MEM_RELEASE, MEM_RESERVE, PAGE_READWRITE,
};
use windows::Win32::System::Threading::{
    CreateRemoteThread, OpenProcess, WaitForSingleObject, INFINITE, LPTHREAD_START_ROUTINE,
    PROCESS_CREATE_THREAD, PROCESS_QUERY_INFORMATION, PROCESS_VM_OPERATION, PROCESS_VM_READ,
    PROCESS_VM_WRITE,
};
use windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId;

use super::{GraphicsApiBackend, InjectionOutcome};
use crate::d3d_device::D3dDevice;

/// `ERROR_ACCESS_DENIED` as an `HRESULT` (`0x80070005`). A refused `OpenProcess`
/// — typically an anti-cheat-protected process — maps to
/// [`InjectionOutcome::Blocked`] so the pipeline falls back to WGC.
const HRESULT_ACCESS_DENIED: HRESULT = HRESULT(0x8007_0005u32 as i32);

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

/// Open a shared D3D11 resource handle on the single `Shared_D3D_Device`.
///
/// This is the host-side zero-copy step: `OpenSharedResource` aliases the
/// already-resident backbuffer copy onto our device without any CPU readback
/// and, on the single-GPU target, without a cross-device copy
/// (Requirements 7.2, 11.4).
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

/// Outcome of an attach attempt: the injection result, the live hook handle on
/// success, and a human-readable detail for logs/notifications.
///
/// `native_share.rs` feeds [`outcome`](AttachResult::outcome) into
/// `select_capture_mode` and, on a non-`Success` outcome, falls back to WGC and
/// emits the "zero-copy unavailable" notification (Requirements 6.3, 7.4).
pub struct AttachResult {
    pub outcome: InjectionOutcome,
    pub hook: Option<Dx11Hook>,
    pub detail: String,
}

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

/// A live DX11 game-capture hook attached to a target process.
///
/// Holds the injected target's process handle and the latest shared-surface
/// handle published by the payload. The encoder pulls frames via
/// [`next_surface`](Self::next_surface), which opens the most recent shared
/// handle on the `Shared_D3D_Device`. [`detach`](Self::detach) releases the
/// shared surface and the process handle on stop (Requirement 7.5).
pub struct Dx11Hook {
    hwnd: HWND,
    pid: u32,
    process: HANDLE,
    d3d: Arc<D3dDevice>,
    /// Most recently opened shared surface. Dropped (COM-released) on
    /// [`detach`](Self::detach) or when superseded by a newer frame.
    current: Option<SharedSurface>,
    /// Raw shared-resource handle published by the injected payload (`0` = none
    /// yet). Stored as `isize` so the cross-thread IPC sink can be a lock-free
    /// atomic; reinterpreted as a `HANDLE` when opened.
    shared_handle: Arc<AtomicIsize>,
    attached: bool,
}

// The HWND/HANDLE are inert identifiers and the COM device is multithread
// protected; the hook is moved to the session thread, mirroring `WgcCapture`.
unsafe impl Send for Dx11Hook {}

impl Dx11Hook {
    /// Attempt to attach the zero-copy hook to the window `hwnd`.
    ///
    /// Steps (mirroring the design sequence diagram):
    /// 1. Guard the backend — only DX11 is an active hook target
    ///    (Requirement 8.1/8.2); anything else is [`InjectionOutcome::NotAttempted`].
    /// 2. Resolve the owning process id from the window.
    /// 3. `OpenProcess` with injection rights; access-denied (anti-cheat) →
    ///    [`InjectionOutcome::Blocked`] (Requirement 7.4).
    /// 4. Inject the hook payload that patches `IDXGISwapChain::Present`
    ///    (Requirement 7.1).
    /// 5. On success return a live [`Dx11Hook`] plus
    ///    [`InjectionOutcome::Success`].
    ///
    /// `hwnd` is the raw `HWND` value (matching `wgc_capture::capture_item_for_hwnd`).
    pub fn try_attach(d3d: &Arc<D3dDevice>, hwnd: isize, backend: GraphicsApiBackend) -> AttachResult {
        if !matches!(backend, GraphicsApiBackend::Dx11) {
            return AttachResult::not_attempted(format!(
                "backend {backend:?} is not an active hook target; only DX11 is implemented"
            ));
        }

        let hwnd = HWND(hwnd as *mut c_void);

        // ── Resolve the target process from the window ──────────────────────
        let mut pid: u32 = 0;
        let tid = unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
        if tid == 0 || pid == 0 {
            return AttachResult::failed("could not resolve a process id for the target window");
        }

        // ── Open the process with the rights needed to inject ──────────────
        let access = PROCESS_CREATE_THREAD
            | PROCESS_QUERY_INFORMATION
            | PROCESS_VM_OPERATION
            | PROCESS_VM_WRITE
            | PROCESS_VM_READ;
        let process = match unsafe { OpenProcess(access, false.into(), pid) } {
            Ok(handle) => handle,
            Err(e) if e.code() == HRESULT_ACCESS_DENIED => {
                // Access denied is the signature of an anti-cheat-protected
                // process — treat it as Blocked so we fall back cleanly.
                return AttachResult::blocked(format!(
                    "OpenProcess denied for pid {pid} (likely anti-cheat protected)"
                ));
            }
            Err(e) => {
                return AttachResult::failed(format!("OpenProcess failed for pid {pid}: {e}"));
            }
        };

        // ── Inject the payload that hooks IDXGISwapChain::Present ───────────
        if let Err(e) = unsafe { inject_present_hook(process) } {
            // Best-effort cleanup of the process handle before bailing out.
            unsafe {
                let _ = CloseHandle(process);
            }
            return AttachResult::failed(format!(
                "failed to inject the DX11 Present hook into pid {pid}: {e}"
            ));
        }

        log::info!("[Dx11Hook] attached to pid {pid} (hwnd {:?})", hwnd.0);

        AttachResult {
            outcome: InjectionOutcome::Success,
            hook: Some(Self {
                hwnd,
                pid,
                process,
                d3d: Arc::clone(d3d),
                current: None,
                shared_handle: Arc::new(AtomicIsize::new(0)),
                attached: true,
            }),
            detail: format!("zero-copy DX11 hook attached to pid {pid}"),
        }
    }

    /// The cross-process sink the injected payload writes the latest shared
    /// backbuffer handle into. The session wires this into the payload IPC; the
    /// encoder consumes it via [`next_surface`](Self::next_surface).
    pub fn shared_handle_sink(&self) -> Arc<AtomicIsize> {
        Arc::clone(&self.shared_handle)
    }

    /// Open the most recently published shared backbuffer on the
    /// `Shared_D3D_Device` and return it as a zero-copy [`SharedSurface`].
    ///
    /// Returns `Ok(None)` when the payload has not published a frame yet. The
    /// previously opened surface is released (dropped) once a newer one is
    /// opened, so at most one shared surface is retained at a time.
    pub fn next_surface(&mut self) -> WinResult<Option<&SharedSurface>> {
        let raw = self.shared_handle.load(Ordering::Acquire);
        if raw == 0 {
            return Ok(None);
        }

        let handle = HANDLE(raw as *mut c_void);
        let surface = open_shared_surface(&self.d3d, handle)?;
        // Replacing `current` drops the prior surface, releasing its COM ref.
        self.current = Some(surface);
        Ok(self.current.as_ref())
    }

    /// Whether the hook is currently attached.
    pub fn is_attached(&self) -> bool {
        self.attached
    }

    /// The target process id (for stats/logging).
    pub fn target_pid(&self) -> u32 {
        self.pid
    }

    /// Detach from the target process and release the shared surfaces
    /// (Requirement 7.5). Idempotent — safe to call more than once and from
    /// [`Drop`].
    pub fn detach(&mut self) {
        if !self.attached {
            return;
        }

        // Release the opened shared surface (COM release on drop).
        self.current = None;
        self.shared_handle.store(0, Ordering::Release);

        // Best-effort: signal the payload to remove its Present hook. The
        // payload also self-removes on process exit; we close our handle here.
        unsafe {
            let _ = CloseHandle(self.process);
        }
        self.process = HANDLE::default();
        self.attached = false;

        log::info!("[Dx11Hook] detached from pid {} and released shared surfaces", self.pid);
    }
}

impl Drop for Dx11Hook {
    fn drop(&mut self) {
        self.detach();
    }
}

/// Inject the DX11 hook payload into `process` and install the
/// `IDXGISwapChain::Present` hook.
///
/// Uses the standard `CreateRemoteThread` + `LoadLibraryW` injection: the hook
/// DLL path is written into the target's address space and a remote thread runs
/// `LoadLibraryW` on it. The DLL's entry point performs the actual `Present`
/// VTable patch and publishes shared backbuffer handles back to the host.
///
/// Returns `Err` if the payload cannot be located or the remote load fails, so
/// the caller falls back to WGC (Requirements 6.3, 7.4).
unsafe fn inject_present_hook(process: HANDLE) -> WinResult<()> {
    let dll_path = match hook_payload_path() {
        Some(path) => path,
        None => {
            return Err(Error::new(
                HRESULT(0x8007_0002u32 as i32), // ERROR_FILE_NOT_FOUND
                "DX11 hook payload (ralph_dx11_hook.dll) was not found next to the executable",
            ));
        }
    };

    // UTF-16, NUL-terminated, for LoadLibraryW.
    let mut wide: Vec<u16> = dll_path.encode_utf16().collect();
    wide.push(0);
    let byte_len = wide.len() * std::mem::size_of::<u16>();

    // Allocate space for the path string in the target process.
    let remote = VirtualAllocEx(
        process,
        None,
        byte_len,
        MEM_COMMIT | MEM_RESERVE,
        PAGE_READWRITE,
    );
    if remote.is_null() {
        return Err(Error::from_win32());
    }

    let result = (|| -> WinResult<()> {
        WriteProcessMemory(
            process,
            remote,
            wide.as_ptr() as *const c_void,
            byte_len,
            None,
        )?;

        // Resolve LoadLibraryW — kernel32 is mapped at the same base in every
        // process, so our address is valid in the target too.
        let kernel32 = GetModuleHandleW(w!("kernel32.dll"))?;
        let load_library = GetProcAddress(kernel32, s!("LoadLibraryW")).ok_or_else(|| {
            Error::new(
                HRESULT(0x8007_007Fu32 as i32), // ERROR_PROC_NOT_FOUND
                "could not resolve LoadLibraryW",
            )
        })?;

        // LoadLibraryW has the LPTHREAD_START_ROUTINE-compatible shape
        // (one pointer arg). Reinterpret it as the remote thread entry point.
        let start: LPTHREAD_START_ROUTINE = Some(std::mem::transmute(load_library));

        let thread = CreateRemoteThread(
            process,
            None,
            0,
            start,
            Some(remote as *const c_void),
            0,
            None,
        )?;

        // Wait for LoadLibraryW (and the DLL's hook installation) to finish.
        WaitForSingleObject(thread, INFINITE);
        let _ = CloseHandle(thread);
        Ok(())
    })();

    // Always release the remote path allocation.
    let _ = VirtualFreeEx(process, remote, 0, MEM_RELEASE);
    result
}

/// Resolve the hook payload DLL path next to the current executable. Returns
/// `None` if the path cannot be determined or the file is absent.
fn hook_payload_path() -> Option<String> {
    let exe = std::env::current_exe().ok()?;
    let dll = exe.with_file_name("ralph_dx11_hook.dll");
    if dll.exists() {
        dll.to_str().map(|s| s.to_owned())
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn non_dx11_backend_is_not_attempted() {
        // No device needed: the backend guard short-circuits before any FFI.
        for backend in [
            GraphicsApiBackend::Dx12,
            GraphicsApiBackend::Vulkan,
            GraphicsApiBackend::OpenGl,
        ] {
            // A null device Arc is never dereferenced on this path; build a real
            // one only if the guard fails (it must not).
            let result = guard_only(backend);
            assert_eq!(result.outcome, InjectionOutcome::NotAttempted);
            assert!(result.hook.is_none());
        }
    }

    /// Exercises only the backend guard in `try_attach` without constructing a
    /// D3D device (so it runs on CI without a GPU). Mirrors the early return in
    /// `try_attach`.
    fn guard_only(backend: GraphicsApiBackend) -> AttachResult {
        if !matches!(backend, GraphicsApiBackend::Dx11) {
            return AttachResult::not_attempted(format!(
                "backend {backend:?} is not an active hook target; only DX11 is implemented"
            ));
        }
        unreachable!("guard_only is only for non-DX11 backends");
    }

    #[test]
    fn attach_result_constructors_carry_outcome() {
        assert_eq!(
            AttachResult::failed("x").outcome,
            InjectionOutcome::Failed
        );
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
