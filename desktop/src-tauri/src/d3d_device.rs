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
use windows::Win32::Foundation::LUID;
use windows::Win32::Graphics::Direct3D::D3D_FEATURE_LEVEL_11_0;
use windows::Win32::Graphics::Direct3D11::*;
use windows::Win32::Graphics::Dxgi::Common::{DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_FORMAT_NV12, DXGI_SAMPLE_DESC};
use windows::Win32::Graphics::Dxgi::*;
use windows::Win32::Media::MediaFoundation::*;

/// A locally-unique identifier (LUID) for a GPU adapter, captured as a single
/// comparable value.
///
/// Windows reports an adapter's identity through `DXGI_ADAPTER_DESC::AdapterLuid`,
/// a `LUID { LowPart: u32, HighPart: i32 }`. A LUID is only meaningful as an
/// opaque, equality-comparable token: two `IDXGIAdapter`s refer to the **same**
/// physical adapter if and only if their LUIDs are bitwise-equal. This newtype
/// packs the two halves into one `i64` (`HighPart` in the upper 32 bits,
/// `LowPart` in the lower 32) so the comparison is a single integer equality and
/// the value is trivially `Copy`/`Hash`/serializable.
///
/// # Why this exists (cross-adapter detection — Requirements 5.4, 9.4)
///
/// On a multi-GPU machine the `Game_Capture_Hook`'s target may render on a
/// different adapter than the [`Shared_D3D_Device`](D3dDevice) that opens the
/// shared surface. Opening a DXGI shared handle across adapters does not yield a
/// usable zero-copy alias and would produce a corrupted frame. The session
/// therefore compares the `Shared_D3D_Device`'s adapter LUID (read with
/// [`D3dDevice::adapter_luid`]) against the target's render-adapter LUID using
/// the pure [`same_adapter`] helper; a mismatch drives the
/// [`FallbackReason::CrossAdapter`](crate::game_capture::FallbackReason::CrossAdapter)
/// fallback to WGC **instead of** attempting a cross-adapter open.
///
/// ## Obtaining the target's render-adapter LUID
///
/// This task provides the `Shared_D3D_Device` side and the pure comparison. The
/// target's render-adapter LUID is acquired by the session wiring (task 11.1):
/// the OBS `hook_info` IPC payload identifies the target's device, from which an
/// `IDXGIAdapter` LUID can be read the same way [`D3dDevice::adapter_luid`] reads
/// this device's LUID (`IDXGIDevice` → `IDXGIAdapter` → `GetDesc`). Whichever
/// path supplies it, the value is wrapped in an [`AdapterLuid`] and passed to
/// [`same_adapter`]; the comparison itself never touches the GPU.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct AdapterLuid(pub i64);

impl AdapterLuid {
    /// Pack a Win32 `LUID` (`LowPart: u32`, `HighPart: i32`) into a single
    /// comparable `i64`. The packing is lossless and reversible, so equality of
    /// the packed value is equivalent to equality of both LUID halves.
    pub fn from_luid(luid: LUID) -> Self {
        let packed = ((luid.HighPart as i64) << 32) | (luid.LowPart as i64 & 0xFFFF_FFFF);
        Self(packed)
    }

    /// The packed LUID as a raw `i64` (e.g. for storing in an atomic or a stats
    /// snapshot).
    pub fn raw(self) -> i64 {
        self.0
    }
}

/// Pure, GPU-independent comparison of two adapter LUIDs (Requirements 5.4, 9.4).
///
/// Returns `true` iff `a` and `b` identify the **same** GPU adapter. This is the
/// single decision the cross-adapter gate is built on: the caller reads the
/// [`Shared_D3D_Device`](D3dDevice)'s LUID with [`D3dDevice::adapter_luid`] and
/// the target's render-adapter LUID (see [`AdapterLuid`]), then a `false` result
/// means the shared handle must **not** be opened cross-adapter and the session
/// falls back to WGC with reason `CrossAdapter`.
///
/// Kept free of any D3D11/DXGI dependency so it is exhaustively testable without
/// a GPU.
pub fn same_adapter(a: AdapterLuid, b: AdapterLuid) -> bool {
    a == b
}

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

    /// Read the adapter LUID of this `Shared_D3D_Device` (Requirements 5.4, 9.4).
    ///
    /// Walks `ID3D11Device` → `IDXGIDevice` → `IDXGIAdapter` and reads
    /// `DXGI_ADAPTER_DESC::AdapterLuid`, packing it into a comparable
    /// [`AdapterLuid`]. This is the value the cross-adapter gate compares (via
    /// [`same_adapter`]) against the target's render-adapter LUID before opening
    /// a shared surface; a mismatch means the host must fall back to WGC rather
    /// than open a cross-adapter handle that would corrupt frames.
    ///
    /// This call is GPU-bound (it queries the live DXGI adapter) and so is only
    /// smoke-testable on a machine with a GPU; the comparison it feeds
    /// ([`same_adapter`]) is pure and unit-tested without hardware.
    pub fn adapter_luid(&self) -> WinResult<AdapterLuid> {
        unsafe {
            let dxgi_device: IDXGIDevice = self.device.cast()?;
            let adapter: IDXGIAdapter = dxgi_device.GetAdapter()?;
            let desc = adapter.GetDesc()?;
            Ok(AdapterLuid::from_luid(desc.AdapterLuid))
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
mod adapter_luid_tests {
    use super::*;
    use windows::Win32::Foundation::LUID;

    fn luid(low: u32, high: i32) -> LUID {
        LUID {
            LowPart: low,
            HighPart: high,
        }
    }

    #[test]
    fn same_adapter_is_true_for_equal_luids() {
        let a = AdapterLuid::from_luid(luid(0x1234_5678, 0x09AB_CDEF));
        let b = AdapterLuid::from_luid(luid(0x1234_5678, 0x09AB_CDEF));
        assert!(same_adapter(a, b));
    }

    #[test]
    fn same_adapter_is_false_when_low_part_differs() {
        let a = AdapterLuid::from_luid(luid(1, 7));
        let b = AdapterLuid::from_luid(luid(2, 7));
        assert!(!same_adapter(a, b));
    }

    #[test]
    fn same_adapter_is_false_when_high_part_differs() {
        let a = AdapterLuid::from_luid(luid(42, 1));
        let b = AdapterLuid::from_luid(luid(42, 2));
        assert!(!same_adapter(a, b));
    }

    #[test]
    fn packing_preserves_both_halves_distinctly() {
        // Two LUIDs that share a LowPart but differ in HighPart (and vice versa)
        // must never collide once packed — i.e. the pack is injective over the
        // (LowPart, HighPart) pair.
        let only_low = AdapterLuid::from_luid(luid(0xFFFF_FFFF, 0));
        let only_high = AdapterLuid::from_luid(luid(0, 1));
        assert_ne!(only_low, only_high);
        // The all-low value must not bleed into the high 32 bits.
        assert_eq!(only_low.raw(), 0x0000_0000_FFFF_FFFFu64 as i64);
    }

    #[test]
    fn negative_high_part_round_trips() {
        // HighPart is an i32 and can legitimately be negative; packing must keep
        // distinct negative high parts distinct.
        let a = AdapterLuid::from_luid(luid(0xDEAD_BEEF, -1));
        let b = AdapterLuid::from_luid(luid(0xDEAD_BEEF, -2));
        assert_ne!(a, b);
        assert!(!same_adapter(a, b));
        // HighPart = -1, LowPart = 0xDEADBEEF -> 0xFFFFFFFF_DEADBEEF.
        assert_eq!(a.raw(), 0xFFFF_FFFF_DEAD_BEEFu64 as i64);
    }

    #[test]
    fn same_adapter_is_reflexive() {
        let a = AdapterLuid::from_luid(luid(7, 7));
        assert!(same_adapter(a, a));
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
