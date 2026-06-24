/// Windows Graphics Capture (WGC) based screen capture.
/// Produces `ID3D11Texture2D` frames in BGRA format — no CPU readback.
use std::result::Result as StdResult;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;
use windows::core::{Result as WinResult, *};
use windows::Foundation::TypedEventHandler;
use windows::Graphics::Capture::*;
use windows::Graphics::DirectX::DirectXPixelFormat;
use windows::Win32::Foundation::{HWND, LPARAM, RECT};
use windows::Win32::Graphics::Direct3D11::*;
use windows::Win32::Graphics::Dxgi::Common::{DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_SAMPLE_DESC};
use windows::Win32::Graphics::Dxgi::IDXGIDevice;
use windows::Win32::Graphics::Gdi::{EnumDisplayMonitors, HDC, HMONITOR};
use windows::Win32::System::WinRT::Direct3D11::CreateDirect3D11DeviceFromDXGIDevice;
use windows::Win32::System::WinRT::Direct3D11::IDirect3DDxgiInterfaceAccess;
use windows::Win32::System::WinRT::Graphics::Capture::IGraphicsCaptureItemInterop;
// IGraphicsCaptureSession3 provides SetIsBorderRequired (Win11 22H2+).
// Cast is attempted at runtime; failure is silently ignored for Win10 compat.

use crate::d3d_device::D3dDevice;
use crate::native_share::NativeShareStats;
use crate::ring_buffer::{RingBuffer, RingBufferError};

// Hook-origin frame adapter inputs (Req 1.3, 5.3, 7.1, 7.5). `SharedSurface`
// compiles under `native-screen-share` (it is the host-side zero-copy opener's
// output), but `FrameMetadata` lives behind the `game-capture-hook` feature, so
// the hook adapter — and the `FrameOrigin::Hook` variant it builds — are gated
// to that feature. The WGC path needs neither.
#[cfg(feature = "game-capture-hook")]
use crate::game_capture::dx11::SharedSurface;
#[cfg(feature = "game-capture-hook")]
use crate::game_capture::obs_ipc::FrameMetadata;

/// A retention token for a hook-origin frame's [`SharedSurface`].
///
/// When `Capture_Mode == hook`, a [`CapturedFrame`] does not borrow a WGC pool
/// buffer; it carries the shared D3D11 surface the host opened on the
/// `Shared_D3D_Device` from the handle the injected OBS `graphics-hook`
/// published. Holding this guard keeps that opened surface (and its COM ref)
/// alive while the encoder reads it — exactly the role the retained
/// `Direct3D11CaptureFrame` plays for WGC frames.
///
/// On drop/release the guard sets its `release` token, which the hook capture
/// thread watches so it can release the surface's `IDXGIKeyedMutex` (handing
/// the slot back to the hook so its surface supply is not stalled — Req 7.5)
/// and free the retained surface. The guard owns the `SharedSurface` so dropping
/// the `CapturedFrame` COM-releases the opened texture once the encoder is done.
///
/// Gated behind `game-capture-hook` because [`SharedSurface`] only exists when
/// the hook feature is built; the WGC path never constructs one.
#[cfg(feature = "game-capture-hook")]
pub struct HookSurfaceGuard {
    /// The opened shared surface, kept alive for the encoder's fused-blit read.
    /// Dropped (COM-released) when the `CapturedFrame` is dropped.
    #[allow(dead_code)]
    surface: SharedSurface,
    /// Shared release token the hook capture thread watches. Set to `true` on
    /// drop (or by the encoder after the fused blit) so the hook thread can
    /// release the keyed mutex and free the surface (Req 7.5).
    release: Arc<AtomicBool>,
}

#[cfg(feature = "game-capture-hook")]
impl HookSurfaceGuard {
    /// Build a guard retaining `surface`, wired to the hook thread's `release`
    /// token. Setting (or dropping) the token releases the keyed mutex and the
    /// surface.
    pub fn new(surface: SharedSurface, release: Arc<AtomicBool>) -> Self {
        Self { surface, release }
    }
}

#[cfg(feature = "game-capture-hook")]
impl Drop for HookSurfaceGuard {
    fn drop(&mut self) {
        // Signal the hook capture thread that the encoder is done reading the
        // shared surface, so it can release the keyed mutex and free the
        // surface. Idempotent: setting an already-set token is harmless. The
        // owned `SharedSurface` is COM-released as this struct drops.
        self.release.store(true, Ordering::Release);
    }
}

/// Where a [`CapturedFrame`] came from, and what it must keep alive while the
/// encoder reads it. Generalizing the retention into one enum lets the **single**
/// encoder frame path serve both capture origins unchanged (Req 7.1): the
/// encoder reads `CapturedFrame::texture` and drops the frame regardless of
/// origin, and the matching `Drop` releases whichever resource the origin holds.
pub enum FrameOrigin {
    /// A WGC pool frame. Holding the [`Direct3D11CaptureFrame`] keeps the
    /// underlying `Direct3D11CaptureFramePool` buffer checked out so the WGC
    /// texture the frame borrows is not recycled/overwritten before the encoder
    /// reads it (no torn/stale frames — Req 1.2, 1.5). Dropping it releases the
    /// buffer back to the 2-buffer pool.
    Wgc(Direct3D11CaptureFrame),
    /// A hook-origin frame. Holding the [`HookSurfaceGuard`] keeps the opened
    /// shared surface alive for the encoder read; dropping it releases the keyed
    /// mutex and frees the surface (Req 7.5). Gated behind `game-capture-hook`.
    #[cfg(feature = "game-capture-hook")]
    Hook(HookSurfaceGuard),
}

/// A single captured frame handed to `MFT_Encoder`.
///
/// Per the screen-share-zero-overhead design, the frame no longer owns a
/// freshly-created per-frame copy texture. Instead it **borrows** a texture and
/// carries an `Arc<AtomicBool>` release token plus an [`origin`](Self::origin)
/// retention token that keeps the borrowed texture's backing resource alive
/// until the encoder is done. For WGC frames the texture is a pre-allocated
/// [`TextureRingBuffer`] / WGC pool buffer (no per-frame `CreateTexture2D`,
/// `CopySubresourceRegion`, or `Flush`); for hook frames it is a shared D3D11
/// surface opened on the `Shared_D3D_Device`. When the encoder has finished
/// reading the texture it sets the token (or the token is set on drop), which
/// returns the ring slot to the pool (WGC) so it can be reused. This enforces
/// "do not overwrite a held entry" (Req 2.4), the drop-on-exhaustion contract
/// (Req 2.7), and retain-at-most-one for the hook path (Req 7.5).
pub struct CapturedFrame {
    /// The texture read directly by the encoder's fused blit — a WGC pool
    /// buffer or an opened hook shared surface, depending on [`origin`](Self::origin).
    pub texture: ID3D11Texture2D,
    pub width: u32,
    pub height: u32,
    pub pts_hns: i64,
    /// Release token for this frame's ring slot. Set to `true` once the
    /// encoder has finished reading the texture so the slot can be reused.
    pub release: Arc<AtomicBool>,
    /// What this frame must keep alive while the encoder reads it — a WGC pool
    /// frame or a hook shared-surface guard. Generalized from the prior
    /// `_wgc_frame` field so one encoder path serves both origins (Req 7.1).
    /// Dropping the `CapturedFrame` drops this origin, releasing the WGC buffer
    /// back to the 2-buffer pool or releasing the hook keyed mutex + surface.
    #[allow(dead_code)]
    origin: FrameOrigin,
}

unsafe impl Send for CapturedFrame {}

impl Drop for CapturedFrame {
    fn drop(&mut self) {
        // Guarantee the ring slot is returned to the pool even if the encoder
        // never explicitly released it (e.g. the frame was dropped on the
        // floor). Idempotent: the ring only re-acquires a slot whose token is
        // set, and setting an already-set token is harmless. The retained
        // `origin` is dropped alongside, releasing the WGC pool buffer or the
        // hook surface + keyed mutex (Req 1.2, 1.5, 7.5).
        self.release.store(true, Ordering::Release);
    }
}

// ── Hook-origin frame adapter (`SharedSurface` → `CapturedFrame`) ───────────
// (Req 1.3, 5.3, 7.1, 7.5; design §4 "Frame adapter").

/// Convert an OBS hook QPC timestamp into the encoder's 100-ns PTS.
///
/// **(verify units)** OBS's `hook_info` timestamp is published as a
/// `QueryPerformanceCounter`-derived value, while the encoder's `pts_hns` is in
/// 100-ns units (matching WGC's `SystemRelativeTime().Duration`). A faithful
/// conversion needs the QPC frequency (`QueryPerformanceFrequency`), which this
/// pure adapter does not carry; the design tags the units as to-verify against
/// the pinned OBS source. Until that reconciliation lands the value is passed
/// through unchanged so the timestamp stays monotonic and non-lossy.
///
/// TODO(verify-units): once the OBS timestamp units are confirmed against the
/// pinned `graphics-hook-info.h`, scale QPC ticks to 100-ns here
/// (`ticks.saturating_mul(10_000_000) / qpc_frequency`) instead of passing
/// through.
#[cfg(feature = "game-capture-hook")]
fn hook_pts_hns(timestamp_qpc: i64) -> i64 {
    timestamp_qpc
}

#[cfg(feature = "game-capture-hook")]
impl CapturedFrame {
    /// Build a hook-origin [`CapturedFrame`] from an opened [`SharedSurface`]
    /// and the OBS [`FrameMetadata`] that described it.
    ///
    /// This is the **frame adapter** that lets one encoder frame path serve
    /// both capture origins (Req 7.1): it produces exactly the same
    /// `CapturedFrame` the WGC `FrameArrived` callback produces, so the
    /// encoder's fused blit and completion-ordering work is reused untouched
    /// (Req 1.3, 5.3). The only structural difference is the retention token —
    /// a [`FrameOrigin::Hook`] guard instead of a WGC pool frame.
    ///
    /// Mapping (mirrors the WGC construction site):
    /// - `texture` ← a **clone** of the opened shared surface's COM interface.
    ///   `ID3D11Texture2D` is a refcounted COM pointer, so the clone and the
    ///   `surface` moved into the guard alias the **same** GPU texture — no copy
    ///   and no CPU readback (Req 1.3, 5.3). The encoder reads this field
    ///   directly in its fused blit.
    /// - `width`/`height` ← capped to the encode dimensions exactly as the WGC
    ///   path caps its texture: `min(surface.*, encode_*)`.
    /// - `pts_hns` ← converted from the OBS QPC timestamp via [`hook_pts_hns`]
    ///   **(verify units)**.
    /// - `release` ← a fresh `Arc<AtomicBool>` the encoder sets after the fused
    ///   blit; the hook capture thread watches it to release the keyed mutex and
    ///   free the surface so the hook's supply is not stalled (retain-at-most-one,
    ///   Req 7.5). The **same** token is shared with the [`HookSurfaceGuard`], so
    ///   dropping the frame also signals release.
    /// - `origin` ← [`FrameOrigin::Hook`] holding a [`HookSurfaceGuard`] that
    ///   owns the `SharedSurface`, keeping the opened texture alive for the
    ///   encoder read and COM-releasing it on drop.
    pub fn from_hook_surface(
        surface: SharedSurface,
        meta: &FrameMetadata,
        encode_width: u32,
        encode_height: u32,
    ) -> CapturedFrame {
        // Clone the COM interface for the encoder-read `texture` field; the
        // original `surface` moves into the guard. Both alias the same
        // refcounted GPU texture, so this is a pointer clone, not a copy.
        let texture = surface.texture.clone();

        // Cap to the encode dimensions, mirroring the WGC path's crop.
        let width = surface.width.min(encode_width);
        let height = surface.height.min(encode_height);

        let pts_hns = hook_pts_hns(meta.timestamp_qpc);

        // One shared release token: set by the encoder after the fused blit, or
        // on drop of either the frame or the guard. The hook capture thread
        // watches it to release the keyed mutex and free the surface (Req 7.5).
        let release = Arc::new(AtomicBool::new(false));
        let guard = HookSurfaceGuard::new(surface, Arc::clone(&release));

        CapturedFrame {
            texture,
            width,
            height,
            pts_hns,
            release,
            origin: FrameOrigin::Hook(guard),
        }
    }

    /// Whether this frame carries a hook-origin retention token
    /// ([`FrameOrigin::Hook`]) rather than a WGC pool frame.
    ///
    /// Minimal, test-supporting accessor: [`origin`](Self::origin) is private,
    /// so the integration test crate (`tests/frame_adapter.rs`) cannot pattern
    /// match on it directly to confirm the hook frame adapter wired up a
    /// hook-origin retention token. This exposes just that one boolean fact.
    /// Gated behind `game-capture-hook` because [`FrameOrigin::Hook`] only
    /// exists when the hook feature is built.
    pub fn is_hook_origin(&self) -> bool {
        matches!(self.origin, FrameOrigin::Hook(_))
    }
}

// ── WGC-frame retention bookkeeping (Req 3.7, 3.8 / Property 3) ─────────────

/// Maximum time the pipeline is allowed to keep a retained WGC frame checked
/// out after the session becomes inactive, before the WGC pool is considered
/// stalled (Req 3.8). The actual stop-time release ([`WgcRetentionTracker::stop`]
/// and dropping the [`WgcCapture`] session/pool) is a synchronous in-memory
/// operation that completes far inside this bound; the constant and
/// [`stop_release_meets_deadline`] make the deadline explicit and testable.
pub const STOP_RELEASE_DEADLINE: Duration = Duration::from_millis(100);

/// Monotonic identifier for a single retained WGC capture frame. Handed out by
/// [`WgcRetentionTracker::retain`]; lets callers correlate a retain event with
/// the matching release.
pub type FrameToken = u64;

/// Outcome of asking the tracker to retain a newly arrived WGC frame.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RetainOutcome {
    /// A new frame is now retained. `released_prior` is the token of the frame
    /// that was retained immediately before this one and was released as part
    /// of retaining this one — `None` when no frame was previously retained.
    ///
    /// Because the prior frame is released *before* the new token is recorded,
    /// the tracker never holds two frames at once: "release the prior frame no
    /// later than retaining the next" (Property 3).
    Retained {
        token: FrameToken,
        released_prior: Option<FrameToken>,
    },
    /// The session has stopped; no new frame is retained (the WGC pool is being
    /// torn down). The arriving frame is not tracked.
    Stopped,
}

/// Pure, GPU-independent bookkeeping for the "retain at most one WGC frame at a
/// time" invariant (Req 3.7) and prompt release on session stop (Req 3.8).
///
/// The screen-share-zero-overhead pipeline reads a retained WGC texture
/// directly in the fused blit (no per-frame copy), so it must keep the WGC
/// `Direct3D11CaptureFramePool` buffer checked out until the encoder has read
/// it. The pool only has **two** buffers, so the pipeline may retain **at most
/// one** frame at any instant — otherwise the pool could starve and stall WGC
/// (Req 3.7). This tracker is the GPU-independent model of that rule:
///
/// * [`retain`](Self::retain) records that a freshly arrived frame is now held
///   downstream. If a frame was already retained it is released first, so the
///   retained count never exceeds one.
/// * [`release`](Self::release) records that the encoder finished reading the
///   retained frame (after the fused blit completes — Req 3.5), freeing the
///   pool buffer.
/// * [`stop`](Self::stop) releases any retained frame when the session becomes
///   inactive (Req 3.8) and prevents further retention.
///
/// The struct is `pub` so the property test crate in `tests/`
/// (`tests/prop_wgc_retention.rs`, Property 3) can drive arbitrary sequences of
/// arrivals, completions, and releases and assert the invariant holds.
#[derive(Debug, Clone)]
pub struct WgcRetentionTracker {
    /// The single frame currently retained, if any. `Some(_)` ⇒ exactly one
    /// frame is checked out of the WGC pool.
    retained: Option<FrameToken>,
    /// Next token to hand out; monotonically increasing.
    next_token: FrameToken,
    /// `false` once [`stop`](Self::stop) has been called — no further frames
    /// are retained after the session goes inactive.
    active: bool,
}

impl Default for WgcRetentionTracker {
    fn default() -> Self {
        Self::new()
    }
}

impl WgcRetentionTracker {
    /// Create a tracker for an active session that is retaining nothing yet.
    pub fn new() -> Self {
        Self {
            retained: None,
            next_token: 0,
            active: true,
        }
    }

    /// Retain a newly arrived WGC frame, releasing the previously retained
    /// frame first so at most one frame is ever held (Req 3.7, Property 3).
    ///
    /// Returns [`RetainOutcome::Stopped`] without retaining anything if the
    /// session has already stopped.
    pub fn retain(&mut self) -> RetainOutcome {
        if !self.active {
            return RetainOutcome::Stopped;
        }
        // Release the prior frame *before* recording the new one, so the
        // retained count transitions 1 -> 0 -> 1 and never reaches 2.
        let released_prior = self.retained.take();
        let token = self.next_token;
        self.next_token += 1;
        self.retained = Some(token);
        RetainOutcome::Retained {
            token,
            released_prior,
        }
    }

    /// Record that the retained frame `token` has been released (the encoder
    /// finished reading it after the fused blit — Req 3.5), freeing its WGC
    /// pool buffer. Releasing a stale/unknown token is a harmless no-op so the
    /// encoder can release without coordinating with the capture thread.
    pub fn release(&mut self, token: FrameToken) {
        if self.retained == Some(token) {
            self.retained = None;
        }
    }

    /// Mark the session inactive and release any retained frame (Req 3.8).
    ///
    /// Returns the token that was released, if a frame was still retained. This
    /// is a synchronous in-memory operation; the matching physical release
    /// (dropping the [`WgcCapture`] session/pool) is likewise immediate, so the
    /// 100 ms [`STOP_RELEASE_DEADLINE`] is met with wide margin.
    pub fn stop(&mut self) -> Option<FrameToken> {
        self.active = false;
        self.retained.take()
    }

    /// The token of the currently retained frame, if any.
    pub fn retained(&self) -> Option<FrameToken> {
        self.retained
    }

    /// Number of WGC frames currently retained — always 0 or 1 (Req 3.7).
    pub fn retained_count(&self) -> usize {
        self.retained.is_some() as usize
    }

    /// Whether the session is still active (has not been [`stop`](Self::stop)ped).
    pub fn is_active(&self) -> bool {
        self.active
    }
}

/// Whether a stop-time release that took `elapsed` met the 100 ms deadline that
/// keeps the WGC pool from stalling on session stop (Req 3.8).
pub fn stop_release_meets_deadline(elapsed: Duration) -> bool {
    elapsed <= STOP_RELEASE_DEADLINE
}

/// Fixed-size (2 or 3) pool of reusable BGRA capture textures.
///
/// Wraps the GPU-independent [`RingBuffer`] state machine around real
/// `ID3D11Texture2D` resources allocated once at session start (Req 2.1). Each
/// slot carries a shared release token (`Arc<AtomicBool>`): the slot is handed
/// downstream alongside a [`CapturedFrame`], and once the consumer sets the
/// token the slot becomes eligible for re-acquisition. Acquiring a slot first
/// reaps any slots whose tokens have been set, so a released slot is reused
/// instead of allocating a new texture (Req 2.2, 2.3).
///
/// Per the design's reconciliation of Req 2 and Req 3, in the steady-state WGC
/// path the encoder reads the retained WGC texture **directly** (no
/// intermediate BGRA copy), so the BGRA ring degenerates to slot accounting:
/// it bounds how many frames are in flight, enforces "do not overwrite a held
/// entry" (Req 2.4), and drives drop-on-exhaustion (Req 2.7). The pre-allocated
/// textures remain the landing-texture reserve required by Req 2.1 for sources
/// that cannot be read directly.
struct TextureRingBuffer {
    ring: RingBuffer<RingTexture>,
}

// SAFETY: the ring's `ID3D11Texture2D` handles are only ever touched on the
// single WGC capture thread (inside the `FrameArrived` callback). The struct is
// kept behind a `Mutex` when shared with that callback.
unsafe impl Send for TextureRingBuffer {}

/// One BGRA texture slot plus its shared release token.
struct RingTexture {
    /// Pre-allocated landing-texture reserve (Req 2.1). Unused in the
    /// steady-state direct-read path, where the encoder reads the WGC texture
    /// directly; retained so the ring can hold a full capture frame if a
    /// future source requires an intermediate copy.
    #[allow(dead_code)]
    texture: ID3D11Texture2D,
    /// Shared with the [`CapturedFrame`] handed downstream. `true` once the
    /// consumer has finished reading, meaning the slot may be re-acquired.
    release: Arc<AtomicBool>,
}

impl TextureRingBuffer {
    /// Allocate `count` (2 or 3) BGRA textures sized for the capture resolution.
    ///
    /// Returns `Err` if any `CreateTexture2D` fails so session startup can be
    /// aborted before any frame is processed (Req 2.8).
    fn new(d3d: &D3dDevice, width: u32, height: u32, count: usize) -> StdResult<Self, String> {
        let payloads = Self::allocate_textures(d3d, width, height, count)?;
        let ring =
            RingBuffer::new(payloads, width, height).map_err(|e: RingBufferError| e.to_string())?;
        Ok(Self { ring })
    }

    /// Build `count` BGRA textures sized to `(width, height)`. Any allocation
    /// failure short-circuits with `Err` (Req 2.8).
    fn allocate_textures(
        d3d: &D3dDevice,
        width: u32,
        height: u32,
        count: usize,
    ) -> StdResult<Vec<RingTexture>, String> {
        let desc = bgra_capture_desc(width, height);
        let mut textures = Vec::with_capacity(count);
        for _ in 0..count {
            let mut tex = None;
            unsafe {
                d3d.device
                    .CreateTexture2D(&desc, None, Some(&mut tex))
                    .map_err(|e| format!("CreateTexture2D (ring slot): {e}"))?;
            }
            textures.push(RingTexture {
                texture: tex.unwrap(),
                release: Arc::new(AtomicBool::new(false)),
            });
        }
        Ok(textures)
    }

    /// Reap slots whose release token has been set, marking them `Free` so they
    /// can be acquired again. Called before every acquire so a consumed slot is
    /// reused instead of dropping the frame while a free buffer exists.
    fn reap_released(&mut self) {
        let capacity = self.ring.capacity();
        for slot in 0..capacity {
            if self.ring.is_in_use(slot) {
                let released = self
                    .ring
                    .get(slot)
                    .map(|entry| entry.release.load(Ordering::Acquire))
                    .unwrap_or(false);
                if released {
                    self.ring.release(slot);
                }
            }
        }
    }

    /// Acquire the next free slot for an incoming frame, returning a fresh
    /// release token wired to that slot. Returns `None` on exhaustion (every
    /// slot still held downstream — Req 2.7); on exhaustion the underlying ring
    /// leaves all in-use slots untouched and the caller increments
    /// `dropped_frames`.
    fn acquire(&mut self) -> Option<Arc<AtomicBool>> {
        self.reap_released();
        let slot = self.ring.acquire()?;
        let entry = self.ring.get_mut(slot)?;
        // Reset the token for this fresh hand-off and share it with the frame.
        let release = Arc::new(AtomicBool::new(false));
        entry.release = Arc::clone(&release);
        Some(release)
    }
}

/// BGRA texture descriptor used for ring-buffer capture slots. Mirrors the
/// previous per-frame copy texture: shader-resource + render-target bind flags
/// so the encoder's video processor can read it as an input view.
fn bgra_capture_desc(width: u32, height: u32) -> D3D11_TEXTURE2D_DESC {
    D3D11_TEXTURE2D_DESC {
        Width: width,
        Height: height,
        MipLevels: 1,
        ArraySize: 1,
        Format: DXGI_FORMAT_B8G8R8A8_UNORM,
        SampleDesc: DXGI_SAMPLE_DESC {
            Count: 1,
            Quality: 0,
        },
        Usage: D3D11_USAGE_DEFAULT,
        BindFlags: (D3D11_BIND_SHADER_RESOURCE.0 | D3D11_BIND_RENDER_TARGET.0) as u32,
        CPUAccessFlags: 0,
        MiscFlags: 0,
    }
}

/// Active WGC session handle. Drop to stop capture.
pub struct WgcCapture {
    _session: GraphicsCaptureSession,
    _pool: Direct3D11CaptureFramePool,
    _frame_gate: Arc<AtomicBool>,
}

unsafe impl Send for WgcCapture {}

// ── Capture item helpers ───────────────────────────────────────────────────

/// Create a WGC capture item for a monitor by index (0 = primary).
pub fn capture_item_for_monitor_idx(idx: usize) -> WinResult<GraphicsCaptureItem> {
    struct State {
        target_idx: usize,
        current: usize,
        result: Option<HMONITOR>,
    }

    unsafe extern "system" fn cb(
        hmon: HMONITOR,
        _: HDC,
        _: *mut RECT,
        lparam: LPARAM,
    ) -> windows::core::BOOL {
        let state = &mut *(lparam.0 as *mut State);
        if state.current == state.target_idx {
            state.result = Some(hmon);
        }
        state.current += 1;
        windows::core::BOOL(1)
    }

    let mut state = State {
        target_idx: idx,
        current: 0,
        result: None,
    };

    unsafe {
        EnumDisplayMonitors(None, None, Some(cb), LPARAM(&mut state as *mut _ as isize));
    }

    let hmon = state
        .result
        .ok_or_else(|| Error::from_hresult(HRESULT(0x80070057u32 as i32)))?;

    unsafe {
        let interop: IGraphicsCaptureItemInterop =
            windows::core::factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()?;
        interop.CreateForMonitor(hmon)
    }
}

/// Create a WGC capture item for a window by HWND value.
pub fn capture_item_for_hwnd(hwnd: isize) -> WinResult<GraphicsCaptureItem> {
    unsafe {
        let interop: IGraphicsCaptureItemInterop =
            windows::core::factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()?;
        interop.CreateForWindow(HWND(hwnd as *mut _))
    }
}

// ── One-shot WGC snapshot (for screen-picker thumbnails) ────────────────────
//
// Windows Graphics Capture is the modern, DWM-composited capture path. Unlike
// GDI `PrintWindow`/`BitBlt` (what the `xcap` crate uses), it does NOT pump a
// `WM_PRINT`/`WM_PRINTCLIENT` message into the target window's message loop, so
// snapshotting a busy game window for a thumbnail does not stall that game's
// render thread — eliminating the in-game FPS dip the picker used to cause.
//
// This is a self-contained, synchronous one-shot: create an own short-lived
// D3D11 device + a single-buffer free-threaded frame pool, wait for the first
// `FrameArrived`, copy that BGRA surface into a CPU-readable staging texture,
// read the bytes, and tear everything down. It deliberately does NOT reuse the
// `Shared_D3D_Device` (that device is owned by an active share session); a
// throwaway device keeps thumbnail capture fully independent of any live share.

/// A captured CPU-side BGRA snapshot: tightly-packed `width*height*4` bytes plus
/// the dimensions, ready to hand to an image encoder.
pub struct WgcSnapshot {
    pub width: u32,
    pub height: u32,
    /// Row-major, tightly packed BGRA8 (stride == width*4).
    pub bgra: Vec<u8>,
}

/// Capture a single frame from `item` via WGC and read it back to CPU BGRA.
///
/// Blocks up to `timeout` for the first frame to arrive. Returns `None` on any
/// failure (device/pool/session creation, no frame within the timeout, or
/// readback failure) so the caller can fall back to another capture path.
///
/// This runs on a blocking thread (the caller uses `spawn_blocking`); it creates
/// and destroys its own D3D11 device so it never contends with a live share's
/// `Shared_D3D_Device`.
pub fn capture_wgc_snapshot(
    item: &GraphicsCaptureItem,
    timeout: Duration,
) -> WinResult<WgcSnapshot> {
    unsafe {
        // 1. Throwaway D3D11 device (BGRA support for WGC's B8G8R8A8 frames).
        let mut device: Option<ID3D11Device> = None;
        let mut context: Option<ID3D11DeviceContext> = None;
        D3D11CreateDevice(
            None,
            windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_HARDWARE,
            windows::Win32::Foundation::HMODULE::default(),
            D3D11_CREATE_DEVICE_BGRA_SUPPORT,
            None,
            D3D11_SDK_VERSION,
            Some(&mut device),
            None,
            Some(&mut context),
        )?;
        let device = device.unwrap();
        let context = context.unwrap();

        // 2. Wrap as WinRT IDirect3DDevice for the frame pool.
        let dxgi: IDXGIDevice = device.cast()?;
        let inspectable = CreateDirect3D11DeviceFromDXGIDevice(&dxgi)?;
        let winrt_device: windows::Graphics::DirectX::Direct3D11::IDirect3DDevice =
            inspectable.cast()?;

        let size = item.Size()?;

        // 3. Single-buffer free-threaded pool — we only need one frame.
        let pool = Direct3D11CaptureFramePool::CreateFreeThreaded(
            &winrt_device,
            DirectXPixelFormat::B8G8R8A8UIntNormalized,
            1,
            size,
        )?;
        let session = pool.CreateCaptureSession(item)?;
        let _ = session.SetIsBorderRequired(false);

        // 4. Signal a channel from the FrameArrived callback so we can block
        //    with a timeout instead of spinning.
        let (tx, rx) = mpsc::sync_channel::<()>(1);
        let token = pool.FrameArrived(&TypedEventHandler::<
            Direct3D11CaptureFramePool,
            IInspectable,
        >::new(move |_pool, _| {
            // Non-blocking notify; only the first matters.
            let _ = tx.try_send(());
            Ok(())
        }))?;

        session.StartCapture()?;

        // 5. Wait for the first frame (bounded), then drain it.
        let got = rx.recv_timeout(timeout).is_ok();
        let snapshot = if got {
            read_first_frame_bgra(&pool, &device, &context)
        } else {
            Err(Error::new(
                HRESULT(0x8000_000Bu32 as i32), // E_BOUNDS-ish: timed out
                "WGC snapshot timed out waiting for first frame",
            ))
        };

        // 6. Teardown (best-effort; order matters: stop callbacks first).
        let _ = pool.RemoveFrameArrived(token);
        let _ = session.Close();
        let _ = pool.Close();

        snapshot
    }
}

/// Pull the next available frame from `pool` and copy it into a CPU-readable
/// staging texture, returning tightly-packed BGRA bytes.
unsafe fn read_first_frame_bgra(
    pool: &Direct3D11CaptureFramePool,
    device: &ID3D11Device,
    context: &ID3D11DeviceContext,
) -> WinResult<WgcSnapshot> {
    let frame = pool.TryGetNextFrame()?;
    let surface = frame.Surface()?;
    let access: IDirect3DDxgiInterfaceAccess = surface.cast()?;
    let texture: ID3D11Texture2D = access.GetInterface()?;

    let mut desc = D3D11_TEXTURE2D_DESC::default();
    texture.GetDesc(&mut desc);
    let width = desc.Width;
    let height = desc.Height;

    // CPU-readable staging copy of the captured BGRA texture.
    let staging_desc = D3D11_TEXTURE2D_DESC {
        Width: width,
        Height: height,
        MipLevels: 1,
        ArraySize: 1,
        Format: DXGI_FORMAT_B8G8R8A8_UNORM,
        SampleDesc: DXGI_SAMPLE_DESC {
            Count: 1,
            Quality: 0,
        },
        Usage: D3D11_USAGE_STAGING,
        BindFlags: 0,
        CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
        MiscFlags: 0,
    };
    let mut staging: Option<ID3D11Texture2D> = None;
    device.CreateTexture2D(&staging_desc, None, Some(&mut staging))?;
    let staging = staging.unwrap();

    context.CopyResource(&staging, &texture);

    let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
    context.Map(&staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped))?;

    let row_bytes = (width as usize) * 4;
    let mut bgra = Vec::with_capacity(row_bytes * height as usize);
    let src = mapped.pData as *const u8;
    let src_pitch = mapped.RowPitch as usize;
    for row in 0..height as usize {
        let row_slice = std::slice::from_raw_parts(src.add(row * src_pitch), row_bytes);
        bgra.extend_from_slice(row_slice);
    }
    context.Unmap(&staging, 0);

    Ok(WgcSnapshot {
        width,
        height,
        bgra,
    })
}

// ── Start capture ─────────────────────────────────────────────────────────

/// Number of reusable BGRA capture textures in the [`TextureRingBuffer`].
/// Requirements 2.1 / 3.3 mandate "exactly 2 or 3"; 3 gives a little
/// pipelining headroom over the WGC `Direct3D11CaptureFramePool`'s 2 buffers.
const RING_SLOTS: usize = 3;

/// Start WGC capture. Frames delivered through `frame_tx` (non-blocking try_send).
///
/// At session start a [`TextureRingBuffer`] of [`RING_SLOTS`] BGRA textures is
/// allocated at the capture resolution; if any `CreateTexture2D` fails the
/// session aborts before any frame is processed (Req 2.8). The `FrameArrived`
/// callback no longer copies, allocates, or flushes per frame (Req 1.1, 2.3):
/// it acquires a ring slot, hands the WGC texture downstream behind a release
/// token, and drops + counts the frame when every slot is still held (Req 2.7).
pub fn start_wgc_capture(
    item: GraphicsCaptureItem,
    d3d: &Arc<D3dDevice>,
    encode_width: u32,
    encode_height: u32,
    frame_tx: mpsc::SyncSender<CapturedFrame>,
    stats: Arc<NativeShareStats>,
    frame_gate: Arc<AtomicBool>,
) -> StdResult<WgcCapture, String> {
    // Wrap D3D11 device as WinRT IDirect3DDevice.
    let winrt_device = unsafe {
        let dxgi: IDXGIDevice = d3d.device.cast().map_err(|e| e.to_string())?;
        let inspectable = CreateDirect3D11DeviceFromDXGIDevice(&dxgi).map_err(|e| e.to_string())?;
        // Cast the IInspectable to the WinRT IDirect3DDevice interface.
        let device: windows::Graphics::DirectX::Direct3D11::IDirect3DDevice =
            inspectable.cast().map_err(|e| e.to_string())?;
        device
    };

    let size = item.Size().map_err(|e| e.to_string())?;
    let pool = Direct3D11CaptureFramePool::CreateFreeThreaded(
        &winrt_device,
        DirectXPixelFormat::B8G8R8A8UIntNormalized,
        2,
        size,
    )
    .map_err(|e| e.to_string())?;

    let session = pool
        .CreateCaptureSession(&item)
        .map_err(|e| e.to_string())?;

    // Suppress the yellow highlight border (Win11 22H2+ only; silently skipped on Win10).
    // In windows-rs 0.61, IGraphicsCaptureSession3 methods are projected directly onto
    // GraphicsCaptureSession — the runtime cast happens inside the method.
    let _ = session.SetIsBorderRequired(false);

    // Pre-allocate the BGRA Texture_Ring_Buffer at the capture resolution
    // (Req 2.1). Allocation failure aborts startup before any frame is
    // processed (Req 2.8).
    let ring = Arc::new(Mutex::new(TextureRingBuffer::new(
        d3d,
        encode_width,
        encode_height,
        RING_SLOTS,
    )?));

    let callback_frame_gate = Arc::clone(&frame_gate);

    match pool.FrameArrived(
        &TypedEventHandler::<Direct3D11CaptureFramePool, IInspectable>::new(move |pool_ref, _| {
            if !callback_frame_gate.load(Ordering::Acquire) {
                return Ok(());
            }
            // pool_ref is &Option<Direct3D11CaptureFramePool>
            let pool_inner = match pool_ref.as_ref() {
                Some(p) => p,
                None => return Ok(()),
            };
            let frame = match pool_inner.TryGetNextFrame() {
                Ok(f) => f,
                Err(_) => return Ok(()),
            };

            let surface = frame.Surface()?;

            // QI IDirect3DSurface → IDirect3DDxgiInterfaceAccess → ID3D11Texture2D.
            // This is the WGC-provided texture; the encoder's fused blit reads it
            // directly — no per-frame CreateTexture2D, no CopySubresourceRegion,
            // no per-frame Flush (Req 1.1, 2.3, 3.2).
            let access: IDirect3DDxgiInterfaceAccess = surface.cast()?;
            let texture: ID3D11Texture2D = unsafe { access.GetInterface()? };

            let mut desc = D3D11_TEXTURE2D_DESC::default();
            unsafe { texture.GetDesc(&mut desc) };
            let frame_width = desc.Width;
            let frame_height = desc.Height;

            let crop_width = frame_width.min(encode_width);
            let crop_height = frame_height.min(encode_height);

            // Acquire a ring slot instead of allocating a texture (Req 2.2).
            // The slot reuses a buffer already released downstream; on
            // exhaustion (every slot still held by the encoder) drop the
            // frame, count it, and leave in-use slots untouched (Req 2.7).
            let release = match ring.lock() {
                Ok(mut ring) => match ring.acquire() {
                    Some(token) => token,
                    None => {
                        stats.dropped_frames.fetch_add(1, Ordering::Relaxed);
                        return Ok(());
                    }
                },
                Err(_) => return Ok(()),
            };

            let pts_hns = frame.SystemRelativeTime().map(|t| t.Duration).unwrap_or(0);

            // Hand the WGC texture downstream. The frame retains the WGC
            // capture frame so the texture stays valid until the encoder is
            // done; setting `release` (or dropping the frame) returns the
            // ring slot and recycles the WGC buffer. Prompt release after
            // the fused blit and the ≤1-retained bound are wired in tasks
            // 3.1 / 3.2.
            let _ = frame_tx.try_send(CapturedFrame {
                texture,
                width: crop_width,
                height: crop_height,
                pts_hns,
                release,
                origin: FrameOrigin::Wgc(frame),
            });

            Ok(())
        }),
    ) {
        Ok(_) => {}
        Err(e) => return Err(e.to_string()),
    }

    match session.StartCapture() {
        Ok(_) => {}
        Err(e) => return Err(e.to_string()),
    }

    Ok(WgcCapture {
        _session: session,
        _pool: pool,
        _frame_gate: frame_gate,
    })
}

#[cfg(test)]
mod retention_tests {
    use super::*;

    #[test]
    fn new_tracker_retains_nothing_and_is_active() {
        let tracker = WgcRetentionTracker::new();
        assert_eq!(tracker.retained(), None);
        assert_eq!(tracker.retained_count(), 0);
        assert!(tracker.is_active());
    }

    #[test]
    fn first_retain_records_a_frame_with_no_prior() {
        let mut tracker = WgcRetentionTracker::new();
        match tracker.retain() {
            RetainOutcome::Retained {
                token,
                released_prior,
            } => {
                assert_eq!(released_prior, None);
                assert_eq!(tracker.retained(), Some(token));
            }
            RetainOutcome::Stopped => panic!("active tracker must retain"),
        }
        assert_eq!(tracker.retained_count(), 1);
    }

    #[test]
    fn retaining_the_next_frame_releases_the_prior_and_never_holds_two() {
        let mut tracker = WgcRetentionTracker::new();
        let first = match tracker.retain() {
            RetainOutcome::Retained { token, .. } => token,
            RetainOutcome::Stopped => panic!("expected retain"),
        };
        // Retaining again must release the prior frame as part of the same call,
        // so the count transitions through 0 and never reaches 2 (Property 3).
        match tracker.retain() {
            RetainOutcome::Retained {
                token,
                released_prior,
            } => {
                assert_eq!(released_prior, Some(first));
                assert_ne!(token, first);
            }
            RetainOutcome::Stopped => panic!("expected retain"),
        }
        assert_eq!(tracker.retained_count(), 1);
    }

    #[test]
    fn retained_count_never_exceeds_one_across_many_arrivals() {
        let mut tracker = WgcRetentionTracker::new();
        for _ in 0..50 {
            tracker.retain();
            assert!(tracker.retained_count() <= 1);
        }
    }

    #[test]
    fn release_of_current_token_frees_the_pool_buffer() {
        let mut tracker = WgcRetentionTracker::new();
        let token = match tracker.retain() {
            RetainOutcome::Retained { token, .. } => token,
            RetainOutcome::Stopped => panic!("expected retain"),
        };
        tracker.release(token);
        assert_eq!(tracker.retained(), None);
        assert_eq!(tracker.retained_count(), 0);
    }

    #[test]
    fn release_of_stale_token_is_a_noop() {
        let mut tracker = WgcRetentionTracker::new();
        let first = match tracker.retain() {
            RetainOutcome::Retained { token, .. } => token,
            RetainOutcome::Stopped => panic!("expected retain"),
        };
        // Advance to a second frame; releasing the now-stale first token must
        // not drop the currently retained frame.
        let second = match tracker.retain() {
            RetainOutcome::Retained { token, .. } => token,
            RetainOutcome::Stopped => panic!("expected retain"),
        };
        tracker.release(first);
        assert_eq!(tracker.retained(), Some(second));
        assert_eq!(tracker.retained_count(), 1);
    }

    #[test]
    fn stop_releases_any_retained_frame_and_blocks_further_retention() {
        let mut tracker = WgcRetentionTracker::new();
        let token = match tracker.retain() {
            RetainOutcome::Retained { token, .. } => token,
            RetainOutcome::Stopped => panic!("expected retain"),
        };
        assert_eq!(tracker.stop(), Some(token));
        assert_eq!(tracker.retained(), None);
        assert_eq!(tracker.retained_count(), 0);
        assert!(!tracker.is_active());
        // No retention after stop (Req 3.8).
        assert_eq!(tracker.retain(), RetainOutcome::Stopped);
        assert_eq!(tracker.retained_count(), 0);
    }

    #[test]
    fn stop_with_nothing_retained_returns_none() {
        let mut tracker = WgcRetentionTracker::new();
        assert_eq!(tracker.stop(), None);
        assert!(!tracker.is_active());
    }

    #[test]
    fn stop_release_meets_100ms_deadline() {
        assert!(stop_release_meets_deadline(Duration::from_millis(0)));
        assert!(stop_release_meets_deadline(Duration::from_millis(100)));
        assert!(!stop_release_meets_deadline(Duration::from_millis(101)));
        assert_eq!(STOP_RELEASE_DEADLINE, Duration::from_millis(100));
    }
}
