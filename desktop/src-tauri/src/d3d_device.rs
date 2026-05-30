//! Shared D3D11 device for the native screen-share pipeline.
//!
//! # Immediate_Context is the serialization point
//!
//! [`D3dDevice`] owns a single `ID3D11DeviceContext` (`context`) — the
//! `Immediate_Context`. It is the one serialization point shared between the
//! two threads of the `Native_Share_Pipeline`:
//!
//! - the `Capture_Thread` (the WGC `FrameArrived` callback), and
//! - the `Encoder_Thread` (the MFT encode loop + `Video_Processor` blit).
//!
//! The immediate context is **not** internally synchronized for concurrent
//! command recording, so it is `ID3D11Multithread`-protected (see
//! [`D3dDevice::new`]). Both threads must therefore treat every use of
//! `context` as a critical section and hold it only for the duration of
//! recording a single frame's GPU commands. Any work that does not need the
//! shared context (CPU-side bookkeeping, ring-slot acquisition, channel sends)
//! must be done outside that critical section to keep contention bounded
//! (Requirements 4.1, 4.2).
//!
//! In the steady-state pipeline this bound is honored as follows: the
//! `Capture_Thread` records **no** per-frame commands on `context` (no
//! per-frame `Flush`, `CreateTexture2D`, or `CopySubresourceRegion`), and the
//! `Encoder_Thread` holds the context only across the fused `VideoProcessorBlt`
//! + its `context.End(query)` — see `VideoProcessor::convert_into` and
//! `process_input_frame` in `wmf_encoder.rs`. The duration of that fused GPU
//! operation is recorded into `NativeShareStats` so the residual contention on
//! this serialization point can be observed (Requirements 4.3, 9.1).
//!
//! # Frame completion ordering without a per-frame flush
//!
//! The pipeline must guarantee that the encoder only reads a destination
//! surface after the GPU operation that produced it has actually finished,
//! but it must do so **without** forcing a full per-frame
//! `ID3D11DeviceContext::Flush` (Requirements 1.1, 1.2, 1.5). Instead it uses
//! a scoped GPU-completion signal: a `D3D11_QUERY_EVENT`
//! ([`D3dDevice::create_event_query`]) or, where supported, an `ID3D11Fence`
//! ([`D3dDevice::create_fence`]). The pure, GPU-independent ordering rule those
//! primitives implement is captured by [`CompletionOrderModel`] so it can be
//! property-tested without hardware. A full `Flush` remains permitted for
//! non-per-frame purposes such as teardown, error recovery, or resource
//! cleanup (Requirement 1.4).

use std::collections::HashMap;
use std::sync::Arc;
use windows::core::{Result as WinResult, *};
use windows::Win32::Graphics::Direct3D::D3D_FEATURE_LEVEL_11_0;
use windows::Win32::Graphics::Direct3D11::*;
use windows::Win32::Graphics::Dxgi::Common::{DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_FORMAT_NV12, DXGI_SAMPLE_DESC};
use windows::Win32::Graphics::Dxgi::*;
use windows::Win32::Media::MediaFoundation::*;

/// Shared D3D11 device + context + DXGI device manager.
/// Passed to both WGC capture and the MFT encoder worker.
pub struct D3dDevice {
    pub device: ID3D11Device,
    pub context: ID3D11DeviceContext,
    pub dxgi_manager: IMFDXGIDeviceManager,
    pub reset_token: u32,
}

unsafe impl Send for D3dDevice {}
unsafe impl Sync for D3dDevice {}

impl D3dDevice {
    pub fn new() -> WinResult<Arc<Self>> {
        unsafe {
            // Media Foundation must be initialised before MFCreateDXGIDeviceManager.
            let _ = MFStartup(MF_VERSION, MFSTARTUP_NOSOCKET);

            let mut device: Option<ID3D11Device> = None;
            let mut context: Option<ID3D11DeviceContext> = None;
            let feature_levels = [D3D_FEATURE_LEVEL_11_0];

            D3D11CreateDevice(
                None,
                windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_HARDWARE,
                windows::Win32::Foundation::HMODULE::default(),
                D3D11_CREATE_DEVICE_BGRA_SUPPORT | D3D11_CREATE_DEVICE_VIDEO_SUPPORT,
                Some(&feature_levels),
                D3D11_SDK_VERSION,
                Some(&mut device),
                None,
                Some(&mut context),
            )?;

            let device = device.unwrap();
            let context = context.unwrap();

            // Multithread-protect the device context (required for MF + D3D11 interop).
            if let Ok(mt) = device.cast::<ID3D11Multithread>() {
                mt.SetMultithreadProtected(true);
            }

            let mut reset_token: u32 = 0;
            let mut dxgi_manager: Option<IMFDXGIDeviceManager> = None;
            MFCreateDXGIDeviceManager(&mut reset_token, &mut dxgi_manager)?;
            let dxgi_manager = dxgi_manager.unwrap();

            let dxgi_device: IDXGIDevice = device.cast()?;
            dxgi_manager.ResetDevice(&dxgi_device, reset_token)?;

            Ok(Arc::new(Self {
                device,
                context,
                dxgi_manager,
                reset_token,
            }))
        }
    }

    /// Create a one-shot GPU-completion query (`D3D11_QUERY_EVENT`).
    ///
    /// This is the scoped alternative to a per-frame `Flush`: the encoder
    /// records the fused blit, calls `context.End(&query)` to mark "this blit
    /// is done", and then polls `context.GetData(&query, .., 0)` (no forced
    /// flush) until it signals before letting the MFT read the destination
    /// slot. Only the work that produced *this* frame is waited on; the GPU
    /// still batches command submission naturally (Requirements 1.2, 1.5).
    pub fn create_event_query(&self) -> WinResult<ID3D11Query> {
        unsafe {
            let desc = D3D11_QUERY_DESC {
                Query: D3D11_QUERY_EVENT,
                MiscFlags: 0,
            };
            let mut query: Option<ID3D11Query> = None;
            self.device.CreateQuery(&desc, Some(&mut query))?;
            Ok(query.unwrap())
        }
    }

    /// Optional fast path: create an `ID3D11Fence` for GPU completion signaling.
    ///
    /// Fences require `ID3D11Device5` (Windows 10 Creators Update / feature
    /// reported via `D3D11_FEATURE_D3D11_OPTIONS5`). On the existing
    /// `D3D_FEATURE_LEVEL_11_0` device this capability is not guaranteed, so
    /// this returns `None` when the device cannot be cast to `ID3D11Device5`
    /// or fence creation fails — callers then fall back to
    /// [`create_event_query`](Self::create_event_query).
    pub fn create_fence(&self) -> Option<ID3D11Fence> {
        unsafe {
            // Gate on ID3D11Device5 (the OPTIONS5-era device interface).
            let device5 = self.device.cast::<ID3D11Device5>().ok()?;
            let mut fence: Option<ID3D11Fence> = None;
            device5
                .CreateFence::<ID3D11Fence>(0, D3D11_FENCE_FLAG_NONE, &mut fence)
                .ok()?;
            fence
        }
    }

    /// Create an NV12 texture suitable as MFT output / video-processor destination.
    pub fn create_nv12_texture(&self, width: u32, height: u32) -> WinResult<ID3D11Texture2D> {
        unsafe {
            let desc = D3D11_TEXTURE2D_DESC {
                Width: width,
                Height: height,
                MipLevels: 1,
                ArraySize: 1,
                Format: DXGI_FORMAT_NV12,
                SampleDesc: DXGI_SAMPLE_DESC {
                    Count: 1,
                    Quality: 0,
                },
                Usage: D3D11_USAGE_DEFAULT,
                BindFlags: (D3D11_BIND_RENDER_TARGET.0 | D3D11_BIND_DECODER.0) as u32,
                CPUAccessFlags: 0,
                MiscFlags: 0,
            };
            let mut tex = None;
            self.device.CreateTexture2D(&desc, None, Some(&mut tex))?;
            Ok(tex.unwrap())
        }
    }

    /// Copy a BGRA texture into a CPU-readable staging texture and return the
    /// raw bytes. Used as a fallback when the video processor path is not
    /// available. (Still GPU-side copy, then one CPU readback per frame.)
    pub fn read_texture_bgra(
        &self,
        src: &ID3D11Texture2D,
        width: u32,
        height: u32,
    ) -> WinResult<Vec<u8>> {
        unsafe {
            let desc = D3D11_TEXTURE2D_DESC {
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
            let mut staging = None;
            self.device.CreateTexture2D(&desc, None, Some(&mut staging))?;
            let staging = staging.unwrap();

            self.context
                .CopyResource(&staging, src);

            let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
            self.context
                .Map(&staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped))?;

            let row_pitch = mapped.RowPitch as usize;
            let row_bytes = width as usize * 4;
            let mut out = Vec::with_capacity(row_bytes * height as usize);
            let ptr = mapped.pData as *const u8;
            for row in 0..height as usize {
                let src_slice =
                    std::slice::from_raw_parts(ptr.add(row * row_pitch), row_bytes);
                out.extend_from_slice(src_slice);
            }

            self.context.Unmap(&staging, 0);
            Ok(out)
        }
    }
}

/// Identifier for a destination surface/slot in the completion-ordering model
/// (e.g. an `NV12_Ring_Buffer` slot index).
pub type SlotId = u64;

/// Identifier for a single submitted GPU operation and its associated
/// completion signal (a `D3D11_QUERY_EVENT` instance or an `ID3D11Fence`
/// value). Monotonically increasing per [`CompletionOrderModel`].
pub type OpId = u64;

/// Result of attempting a destination read in [`CompletionOrderModel`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReadOutcome {
    /// The producing operation has signaled completion; the read is permitted
    /// and the destination holds the fully produced contents.
    Permitted,
    /// The most recent producing operation has not signaled yet. The read must
    /// be deferred until it signals so no torn, partial, or stale frame is read
    /// (Requirement 1.5).
    Deferred,
    /// No operation has produced this slot yet — there is nothing to read.
    Unproduced,
}

/// Pure, GPU-independent model of the per-frame completion-ordering rule the
/// encoder follows when it replaces the per-frame `Flush` with a scoped
/// completion signal.
///
/// The real pipeline does: record the fused blit into a destination slot
/// (`submit`), insert a `D3D11_QUERY_EVENT` / `ID3D11Fence` and let the GPU
/// reach it (`signal`), then read the slot only once that signal has fired
/// (`read`). This struct captures exactly that ordering contract with no D3D11
/// dependency so it can be exhaustively property-tested (Property 4):
///
/// > For any interleaving of submissions (each followed by a completion
/// > query/fence insertion) and reads, the encoder never reads a destination
/// > slot before that slot's producing operation has signaled completion, and
/// > the ordering is achieved without a full per-frame command-buffer flush.
///
/// A full [`flush`](Self::flush) is modeled separately and is **never** needed
/// to make a per-frame read permitted; it exists only for non-per-frame
/// purposes such as teardown or error recovery (Requirements 1.1, 1.4).
#[derive(Debug, Default, Clone)]
pub struct CompletionOrderModel {
    /// Next op id to hand out.
    next_op: OpId,
    /// For each destination slot, the op that most recently produced it.
    producer: HashMap<SlotId, OpId>,
    /// Ops that have signaled completion.
    signaled: HashMap<OpId, bool>,
    /// Number of full command-buffer flushes performed. Must remain `0` across
    /// per-frame submit/signal/read activity (the whole point of the scoped
    /// query/fence). Only [`flush`](Self::flush) increments it.
    flush_count: u64,
}

impl CompletionOrderModel {
    /// Create an empty model with no outstanding operations.
    pub fn new() -> Self {
        Self::default()
    }

    /// Record that a GPU operation producing `slot` has been submitted (the
    /// fused blit recorded on the `Immediate_Context`) together with its
    /// completion signal. The returned [`OpId`] identifies the signal that
    /// [`signal`](Self::signal) will later fire. The destination becomes the
    /// most-recent producer of `slot` and is **not** yet readable.
    pub fn submit(&mut self, slot: SlotId) -> OpId {
        let op = self.next_op;
        self.next_op += 1;
        self.producer.insert(slot, op);
        self.signaled.insert(op, false);
        op
    }

    /// Mark the completion signal for `op` as fired (the GPU reached the
    /// inserted `D3D11_QUERY_EVENT` / `ID3D11Fence` value). Reads of any slot
    /// whose latest producer is `op` become permitted. Unknown ops are ignored.
    pub fn signal(&mut self, op: OpId) {
        if let Some(done) = self.signaled.get_mut(&op) {
            *done = true;
        }
    }

    /// Whether the most recent operation that produced `slot` has signaled.
    pub fn is_ready(&self, slot: SlotId) -> bool {
        matches!(self.read_outcome(slot), ReadOutcome::Permitted)
    }

    /// Inspect — without consuming — whether reading `slot` is permitted.
    pub fn read_outcome(&self, slot: SlotId) -> ReadOutcome {
        match self.producer.get(&slot) {
            None => ReadOutcome::Unproduced,
            Some(op) => {
                if *self.signaled.get(op).unwrap_or(&false) {
                    ReadOutcome::Permitted
                } else {
                    ReadOutcome::Deferred
                }
            }
        }
    }

    /// Attempt to read `slot`. A read is permitted **only** after the most
    /// recent producing operation has signaled completion; otherwise the read
    /// is deferred (Requirements 1.2, 1.5). This never performs or requires a
    /// flush. Returns the outcome so the caller can defer and retry.
    pub fn read(&self, slot: SlotId) -> ReadOutcome {
        self.read_outcome(slot)
    }

    /// Number of full command-buffer flushes performed so far. Used by tests to
    /// assert that per-frame ordering is achieved without flushing.
    pub fn flush_count(&self) -> u64 {
        self.flush_count
    }

    /// Perform a full command-buffer flush. Permitted only for non-per-frame
    /// purposes (teardown, error recovery, resource cleanup — Requirement 1.4).
    /// A flush also makes every outstanding operation's contents available, so
    /// it marks all known ops as signaled.
    pub fn flush(&mut self) {
        self.flush_count += 1;
        for done in self.signaled.values_mut() {
            *done = true;
        }
    }
}

#[cfg(test)]
mod completion_order_tests {
    use super::*;

    #[test]
    fn read_is_deferred_until_signal() {
        let mut model = CompletionOrderModel::new();
        let op = model.submit(0);
        // Before the signal fires, the read must be deferred (no torn/stale read).
        assert_eq!(model.read(0), ReadOutcome::Deferred);
        assert!(!model.is_ready(0));

        model.signal(op);
        assert_eq!(model.read(0), ReadOutcome::Permitted);
        assert!(model.is_ready(0));
        // Ordering achieved with no per-frame flush.
        assert_eq!(model.flush_count(), 0);
    }

    #[test]
    fn unproduced_slot_is_not_readable() {
        let model = CompletionOrderModel::new();
        assert_eq!(model.read(7), ReadOutcome::Unproduced);
    }

    #[test]
    fn resubmitting_a_slot_requires_the_new_signal() {
        let mut model = CompletionOrderModel::new();
        let first = model.submit(1);
        model.signal(first);
        assert!(model.is_ready(1));

        // A new blit into the same slot makes it pending again; the stale
        // first signal must not authorize a read of the new contents.
        let _second = model.submit(1);
        assert_eq!(model.read(1), ReadOutcome::Deferred);
        assert_eq!(model.flush_count(), 0);
    }

    #[test]
    fn flush_is_only_path_that_increments_flush_count() {
        let mut model = CompletionOrderModel::new();
        let op = model.submit(2);
        model.signal(op);
        let _ = model.read(2);
        assert_eq!(model.flush_count(), 0);

        // Teardown / error-recovery flush is allowed and accounted separately.
        model.flush();
        assert_eq!(model.flush_count(), 1);
    }
}
