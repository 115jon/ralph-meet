//! Codec-agnostic async Windows Media Foundation encoder worker.
//!
//! # Immediate_Context hold scope (Requirements 4.1, 4.2)
//!
//! This module runs on the `Encoder_Thread`. Together with the
//! `Capture_Thread` (the WGC `FrameArrived` callback in `wgc_capture.rs`) it
//! shares the single `ID3D11DeviceContext` owned by [`D3dDevice`] — the
//! `Immediate_Context`, which is the one serialization point between the two
//! threads (see the module docs in `d3d_device.rs` for the authoritative
//! description). Because that context is `ID3D11Multithread`-protected but not
//! free-threaded for command recording, the encoder must hold it **only for
//! the duration of recording a single frame's GPU commands** and do everything
//! else outside that critical section.
//!
//! Concretely, in [`process_input_frame`] the bounded critical section is just
//! the fused `VideoProcessorBlt` plus the `context.End(query)` that marks it
//! done (one frame's worth of GPU command recording — see
//! [`VideoProcessor::convert_into`]). Everything around it deliberately stays
//! off the shared command-recording path:
//!
//! - NV12 ring-slot acquisition, PTS bookkeeping, and channel sends are
//!   CPU-side and touch no context.
//! - The `GetData` completion poll ([`wait_for_query`]) reads query *status*
//!   with `getdataflags = 0`; it records no commands and forces no flush, so it
//!   is not part of the recording critical section (Requirements 1.2, 1.5).
//! - `MFCreateDXGISurfaceBuffer` + `ProcessInput` hand the finished NV12 slot
//!   to the MFT, which performs its own submission.
//!
//! After the Tier-0/Tier-1 changes the `Capture_Thread` no longer records any
//! per-frame commands on the context at all (no per-frame `Flush`,
//! `CreateTexture2D`, or `CopySubresourceRegion`), so in steady state the
//! encoder is effectively the single writer and contention collapses to that
//! one bounded blit-recording window per frame.
//!
//! # Observability (Requirements 4.3, 9.1)
//!
//! So that the residual `Immediate_Context` contention can actually be
//! observed, [`process_input_frame`] times the fused GPU operation (the blit +
//! its scoped completion query) and records it via
//! `NativeShareStats::record_fused_gpu_ns`, alongside the MFT submit duration
//! via `record_encode_submit_ns`. These per-frame durations are surfaced
//! through the stats snapshot / Tauri command so a rising fused-GPU time (the
//! window during which the shared context is held and waited on) is directly
//! measurable.
use std::result::Result as StdResult;
use std::slice;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use windows::core::{Result as WinResult, *};
use windows::Win32::Graphics::Direct3D11::*;
use windows::Win32::Graphics::Dxgi::Common::{DXGI_FORMAT_NV12, DXGI_SAMPLE_DESC};
use windows::Win32::Media::MediaFoundation::*;
use windows::Win32::System::Com::CoTaskMemFree;

use crate::d3d_device::D3dDevice;
use crate::native_share::NativeShareStats;
use crate::ring_buffer::RingBuffer;
use crate::wgc_capture::CapturedFrame;
use std::time::{Duration, Instant};

// Safety: D3dDevice is only accessed from dedicated threads (encoder + capture)
// and is protected by ID3D11Multithread internally.

// ── Codec selection ────────────────────────────────────────────────────────

#[derive(Clone, Copy, Debug)]
pub enum VideoCodec {
    H264,
    Hevc,
}

impl VideoCodec {
    fn mf_subtype(&self) -> GUID {
        match self {
            VideoCodec::H264 => MFVideoFormat_H264,
            VideoCodec::Hevc => MFVideoFormat_HEVC,
        }
    }
    pub fn mime_type(&self) -> &'static str {
        match self {
            VideoCodec::H264 => "video/H264",
            VideoCodec::Hevc => "video/H265",
        }
    }
    pub fn sdp_fmtp(&self) -> &'static str {
        match self {
            VideoCodec::H264 => {
                "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f"
            }
            VideoCodec::Hevc => "",
        }
    }
}

// ── Public handle ──────────────────────────────────────────────────────────

pub struct MftEncoderWorker {
    pub frame_tx: mpsc::SyncSender<CapturedFrame>,
    stop_flag: Arc<AtomicBool>,
    join: Option<std::thread::JoinHandle<()>>,
}

impl MftEncoderWorker {
    pub fn new(
        codec: VideoCodec,
        // Native WGC capture width (e.g. 1920 for a 1080p monitor).
        src_width: u32,
        // Native WGC capture height.
        src_height: u32,
        // Target encode width (e.g. 1280 for 720p).
        width: u32,
        // Target encode height.
        height: u32,
        fps: u32,
        bitrate: u32,
        d3d: Arc<D3dDevice>,
        output_tx: mpsc::SyncSender<Vec<u8>>,
        stats: Arc<NativeShareStats>,
    ) -> StdResult<Self, String> {
        let (frame_tx, frame_rx) = mpsc::sync_channel::<CapturedFrame>(4);
        let stop_flag = Arc::new(AtomicBool::new(false));
        let stop_clone = Arc::clone(&stop_flag);

        // One-shot channel: thread sends Ok(()) or Err(msg) to confirm MFT init.
        let (init_tx, init_rx) = mpsc::sync_channel::<StdResult<(), String>>(1);

        let join = match std::thread::Builder::new()
            .name("RalphMftEncoder".to_owned())
            .spawn(move || {
                // init_mft runs *inside* the thread — no COM pointers cross the spawn.
                let (encoder_mft, event_gen, provides_samples) =
                    match init_mft(codec, width, height, fps, bitrate, &d3d) {
                        Ok(t) => {
                            let _ = init_tx.send(Ok(()));
                            t
                        }
                        Err(e) => {
                            let _ = init_tx.send(Err(format!(
                                "Init hardware {} MFT: {e}",
                                codec.mime_type()
                            )));
                            return;
                        }
                    };

                log::info!(
                    "[MftEncoder] Worker started codec={:?} {}x{} fps={fps} bitrate={bitrate}",
                    codec,
                    width,
                    height
                );
                run_encoder_loop(
                    encoder_mft,
                    event_gen,
                    provides_samples,
                    frame_rx,
                    output_tx,
                    stop_clone,
                    stats,
                    d3d,
                    src_width,
                    src_height,
                    width,
                    height,
                    fps,
                );
                log::info!("[MftEncoder] Worker stopped");
            }) {
            Ok(h) => h,
            Err(e) => return Err(format!("Spawn encoder thread: {e}")),
        };

        // Wait for MFT init result from the thread.
        match init_rx.recv() {
            Ok(Ok(())) => {}
            Ok(Err(msg)) => return Err(msg),
            Err(_) => return Err("Encoder thread died before reporting init".into()),
        }

        Ok(Self {
            frame_tx,
            stop_flag,
            join: Some(join),
        })
    }

    pub fn try_send_frame(&self, frame: CapturedFrame) -> bool {
        self.frame_tx.try_send(frame).is_ok()
    }

    pub fn stop(&mut self) {
        self.stop_flag.store(true, Ordering::Relaxed);
        if let Some(h) = self.join.take() {
            let _ = h.join();
        }
    }
}

impl Drop for MftEncoderWorker {
    fn drop(&mut self) {
        self.stop();
    }
}

// ── MFT initialisation ─────────────────────────────────────────────────────

fn init_mft(
    codec: VideoCodec,
    width: u32,
    height: u32,
    fps: u32,
    bitrate: u32,
    d3d: &D3dDevice,
) -> WinResult<(IMFTransform, IMFMediaEventGenerator, bool)> {
    unsafe {
        let input = MFT_REGISTER_TYPE_INFO {
            guidMajorType: MFMediaType_Video,
            guidSubtype: MFVideoFormat_NV12,
        };
        let output = MFT_REGISTER_TYPE_INFO {
            guidMajorType: MFMediaType_Video,
            guidSubtype: codec.mf_subtype(),
        };
        let flags =
            MFT_ENUM_FLAG(MFT_ENUM_FLAG_HARDWARE.0 | MFT_ENUM_FLAG_SORTANDFILTER.0);
        let mut activates = std::ptr::null_mut();
        let mut count = 0u32;
        MFTEnumEx(
            MFT_CATEGORY_VIDEO_ENCODER,
            flags,
            Some(&input),
            Some(&output),
            &mut activates,
            &mut count,
        )?;

        if count == 0 {
            return Err(Error::from_hresult(HRESULT(0xC00D36B3u32 as i32)));
        }

        let activate = slice::from_raw_parts_mut(activates, count as usize)
            .iter_mut()
            .find_map(|item| item.take())
            .ok_or_else(|| Error::from_hresult(HRESULT(0xC00D36B3u32 as i32)))?;

        let encoder_mft: IMFTransform = activate.ActivateObject()?;
        CoTaskMemFree(Some(activates as _));

        if let Ok(attrs) = encoder_mft.GetAttributes() {
            let _ = attrs.SetUINT32(&MF_TRANSFORM_ASYNC_UNLOCK, 1);
        }

        // Attach DXGI device manager for GPU-backed samples.
        encoder_mft.ProcessMessage(
            MFT_MESSAGE_SET_D3D_MANAGER,
            windows::core::Interface::as_raw(&d3d.dxgi_manager) as usize,
        )?;
        log::info!("[MftEncoder] D3D manager attached");

        let frame_rate_packed = ((fps as u64) << 32) | 1;
        let frame_size_packed = ((width as u64) << 32) | (height as u64);

        // Set output type first.
        let out_type: IMFMediaType = MFCreateMediaType()?;
        out_type.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)?;
        out_type.SetGUID(&MF_MT_SUBTYPE, &codec.mf_subtype())?;
        out_type.SetUINT32(&MF_MT_AVG_BITRATE, bitrate)?;
        out_type.SetUINT64(&MF_MT_FRAME_RATE, frame_rate_packed)?;
        out_type.SetUINT64(&MF_MT_FRAME_SIZE, frame_size_packed)?;
        out_type.SetUINT32(&MF_MT_INTERLACE_MODE, 2)?;
        encoder_mft.SetOutputType(0, &out_type, 0)?;

        // Set input type (NV12).
        let in_type: IMFMediaType = MFCreateMediaType()?;
        in_type.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)?;
        in_type.SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_NV12)?;
        in_type.SetUINT64(&MF_MT_FRAME_RATE, frame_rate_packed)?;
        in_type.SetUINT64(&MF_MT_FRAME_SIZE, frame_size_packed)?;
        in_type.SetUINT32(&MF_MT_INTERLACE_MODE, 2)?;
        in_type.SetUINT64(&MF_MT_PIXEL_ASPECT_RATIO, (1u64 << 32) | 1)?;
        // Stride for NV12: width bytes per row (no padding in our aligned texture)
        in_type.SetUINT32(&MF_MT_DEFAULT_STRIDE, width)?;
        encoder_mft.SetInputType(0, &in_type, 0)?;

        encoder_mft.ProcessMessage(MFT_MESSAGE_COMMAND_FLUSH, 0)?;
        encoder_mft.ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0)?;
        encoder_mft.ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0)?;

        let info = encoder_mft.GetOutputStreamInfo(0)?;
        let provides_samples =
            (info.dwFlags & MFT_OUTPUT_STREAM_PROVIDES_SAMPLES.0 as u32) != 0;
        log::info!(
            "[MftEncoder] output_stream flags=0x{:X} provides_samples={provides_samples}",
            info.dwFlags
        );

        let event_gen: IMFMediaEventGenerator = encoder_mft.cast()?;
        Ok((encoder_mft, event_gen, provides_samples))
    }
}

// ── D3D11 Video Processor (BGRA → NV12 on GPU) ────────────────────────────

/// One NV12 destination slot: a texture plus its video-processor output view.
/// Slots live in the [`Nv12RingBuffer`] and are the blit destination for the
/// fused BGRA→NV12 + downscale pass.
struct Nv12Slot {
    texture: ID3D11Texture2D,
    output_view: ID3D11VideoProcessorOutputView,
}

/// Pre-allocated, fixed-size (2 or 3) pool of NV12 destination textures
/// (Req 3.3). Wraps the GPU-independent [`RingBuffer`] state machine around
/// real `ID3D11Texture2D` + output-view pairs.
///
/// The encoder thread processes one frame at a time, so the ring is used as a
/// `count`-deep rotation: each frame blits into the slot that was acquired
/// `count` frames ago, giving NVENC that many frame-times of headroom before a
/// slot is reused. This enforces "do not overwrite a slot still held by the
/// MFT" (Req 3.9): a slot is only re-acquired after the oldest in-flight slot
/// is released, never while it is the freshest hand-off to `ProcessInput`.
struct Nv12RingBuffer {
    ring: RingBuffer<Nv12Slot>,
    /// Slot indices currently handed to the MFT, oldest first. Bounds the
    /// rotation depth to the ring capacity.
    in_flight: std::collections::VecDeque<usize>,
}

impl Nv12RingBuffer {
    /// Acquire the next destination slot, rotating through the ring so a slot
    /// is reused only after `capacity` frames. When every slot is in flight the
    /// oldest is released first (it has had the most GPU headroom), so a free
    /// slot is always available for the synchronous encode loop. Returns the
    /// acquired slot index, or `None` only if the underlying ring is somehow
    /// exhausted (Req 3.10 — never expected in the one-at-a-time encoder loop).
    fn acquire_rotating(&mut self) -> Option<usize> {
        if self.in_flight.len() >= self.ring.capacity() {
            if let Some(oldest) = self.in_flight.pop_front() {
                self.ring.release(oldest);
            }
        }
        let slot = self.ring.acquire()?;
        self.in_flight.push_back(slot);
        Some(slot)
    }
}

struct VideoProcessor {
    vp: ID3D11VideoProcessor,
    vp_enum: ID3D11VideoProcessorEnumerator,
    video_ctx: ID3D11VideoContext,
    video_dev: ID3D11VideoDevice,
    /// Fallback single NV12 destination, retained for the first-frame-before-
    /// ring case (Req 3.4): if the ring is unavailable the frame is converted
    /// into this texture rather than dropping the session.
    fallback_tex: ID3D11Texture2D,
    fallback_view: ID3D11VideoProcessorOutputView,
    /// Pre-allocated NV12 ring (Req 3.3). `None` only if ring allocation failed
    /// at session start, in which case the fallback texture is used.
    nv12_ring: Option<Nv12RingBuffer>,
    /// Source rectangle — full native capture frame (e.g. 1920×1080).
    src_width: u32,
    src_height: u32,
    /// Destination rectangle — target encode resolution (e.g. 1280×720).
    dst_width: u32,
    dst_height: u32,
}

unsafe impl Send for VideoProcessor {}

/// Number of NV12 ring slots (Req 3.3 mandates "exactly 2 or 3"). Three gives a
/// little pipelining headroom so NVENC can still be reading slot N while the
/// next blit targets slot N+1.
const NV12_RING_SLOTS: usize = 3;

impl VideoProcessor {
    /// Create a video processor that scales from `src_w×src_h` (native capture)
    /// to `dst_w×dst_h` (target encode resolution) while converting BGRA→NV12.
    fn new(d3d: &D3dDevice, src_w: u32, src_h: u32, dst_w: u32, dst_h: u32) -> WinResult<Self> {
        unsafe {
            let video_dev: ID3D11VideoDevice = d3d.device.cast()?;
            let video_ctx: ID3D11VideoContext = d3d.context.cast()?;

            // Align to 16×2 for NV12 HW requirements.
            let aligned_src_w = (src_w + 15) & !15;
            let aligned_src_h = (src_h + 1) & !1;
            let aligned_dst_w = (dst_w + 15) & !15;
            let aligned_dst_h = (dst_h + 1) & !1;

            // The content descriptor drives internal VP resource sizing.
            // Use the larger source dims for Input, target dims for Output.
            let content_desc = D3D11_VIDEO_PROCESSOR_CONTENT_DESC {
                InputFrameFormat: D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE,
                InputWidth: aligned_src_w,
                InputHeight: aligned_src_h,
                OutputWidth: aligned_dst_w,
                OutputHeight: aligned_dst_h,
                Usage: D3D11_VIDEO_USAGE_OPTIMAL_SPEED,
                InputFrameRate: windows::Win32::Graphics::Dxgi::Common::DXGI_RATIONAL {
                    Numerator: 30,
                    Denominator: 1,
                },
                OutputFrameRate: windows::Win32::Graphics::Dxgi::Common::DXGI_RATIONAL {
                    Numerator: 30,
                    Denominator: 1,
                },
            };
            let vp_enum = video_dev.CreateVideoProcessorEnumerator(&content_desc)
                .map_err(|e| { log::error!("[VP] CreateVideoProcessorEnumerator failed: {e}"); e })?;
            let vp = video_dev.CreateVideoProcessor(&vp_enum, 0)
                .map_err(|e| { log::error!("[VP] CreateVideoProcessor failed: {e}"); e })?;

            // Fallback single NV12 destination (Req 3.4).
            let fallback_slot =
                Self::create_nv12_slot(d3d, &video_dev, &vp_enum, aligned_dst_w, aligned_dst_h)
                    .map_err(|e| { log::error!("[VP] fallback NV12 slot failed: {e}"); e })?;
            let fallback_tex = fallback_slot.texture;
            let fallback_view = fallback_slot.output_view;

            // Pre-allocate the NV12 ring at the encode resolution (Req 3.3). A
            // failure here is non-fatal: we keep the fallback texture and run
            // without the ring (Req 3.4).
            let nv12_ring = match Self::allocate_ring(
                d3d,
                &video_dev,
                &vp_enum,
                aligned_dst_w,
                aligned_dst_h,
                NV12_RING_SLOTS,
            ) {
                Ok(ring) => Some(ring),
                Err(e) => {
                    log::warn!(
                        "[VP] NV12 ring allocation failed ({e}); using fallback texture only"
                    );
                    None
                }
            };

            log::info!(
                "[VP] Created D3D11 video processor {}x{} → {}x{} (BGRA→NV12 + scale), nv12_ring={}",
                aligned_src_w, aligned_src_h, aligned_dst_w, aligned_dst_h,
                nv12_ring.as_ref().map(|r| r.ring.capacity()).unwrap_or(0)
            );

            Ok(Self {
                vp,
                vp_enum,
                video_ctx,
                video_dev,
                fallback_tex,
                fallback_view,
                nv12_ring,
                src_width: aligned_src_w,
                src_height: aligned_src_h,
                dst_width: aligned_dst_w,
                dst_height: aligned_dst_h,
            })
        }
    }

    /// Build an NV12 texture + its video-processor output view sized to
    /// `(w, h)` (already aligned). Used for both ring slots and the fallback.
    fn create_nv12_slot(
        d3d: &D3dDevice,
        video_dev: &ID3D11VideoDevice,
        vp_enum: &ID3D11VideoProcessorEnumerator,
        w: u32,
        h: u32,
    ) -> WinResult<Nv12Slot> {
        unsafe {
            let nv12_desc = D3D11_TEXTURE2D_DESC {
                Width: w,
                Height: h,
                MipLevels: 1,
                ArraySize: 1,
                Format: DXGI_FORMAT_NV12,
                SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
                Usage: D3D11_USAGE_DEFAULT,
                BindFlags: (D3D11_BIND_RENDER_TARGET.0 | D3D11_BIND_VIDEO_ENCODER.0) as u32,
                CPUAccessFlags: 0,
                MiscFlags: D3D11_RESOURCE_MISC_SHARED.0 as u32,
            };
            let mut texture = None;
            d3d.device
                .CreateTexture2D(&nv12_desc, None, Some(&mut texture))
                .map_err(|e| { log::error!("[VP] CreateTexture2D(NV12) failed: {e}"); e })?;
            let texture = texture.unwrap();

            let output_view_desc = D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC {
                ViewDimension: D3D11_VPOV_DIMENSION_TEXTURE2D,
                Anonymous: D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC_0 {
                    Texture2D: D3D11_TEX2D_VPOV { MipSlice: 0 },
                },
            };
            let mut output_view = None;
            video_dev.CreateVideoProcessorOutputView(
                &texture,
                vp_enum,
                &output_view_desc,
                Some(&mut output_view),
            ).map_err(|e| { log::error!("[VP] CreateVideoProcessorOutputView failed: {e}"); e })?;
            let output_view = output_view.unwrap();

            Ok(Nv12Slot { texture, output_view })
        }
    }

    /// Allocate the NV12 ring (`count` slots sized to the encode resolution).
    fn allocate_ring(
        d3d: &D3dDevice,
        video_dev: &ID3D11VideoDevice,
        vp_enum: &ID3D11VideoProcessorEnumerator,
        w: u32,
        h: u32,
        count: usize,
    ) -> StdResult<Nv12RingBuffer, String> {
        let mut slots = Vec::with_capacity(count);
        for _ in 0..count {
            let slot = Self::create_nv12_slot(d3d, video_dev, vp_enum, w, h)
                .map_err(|e| format!("CreateTexture2D (NV12 ring slot): {e}"))?;
            slots.push(slot);
        }
        let ring = RingBuffer::new(slots, w, h).map_err(|e| e.to_string())?;
        Ok(Nv12RingBuffer {
            ring,
            in_flight: std::collections::VecDeque::with_capacity(count),
        })
    }

    /// Fused convert + downscale from the WGC texture `src` **directly** into
    /// the NV12 destination behind `output_view` (a ring slot or the fallback),
    /// in a single `VideoProcessorBlt` — no intermediate BGRA copy (Req 3.1,
    /// 3.2). The blit is recorded on the `Immediate_Context`; the caller is
    /// responsible for the completion query and waiting before the MFT reads
    /// the slot.
    ///
    /// This call (plus the caller's `context.End(query)`) is the **entire**
    /// per-frame critical section on the shared `Immediate_Context` for the
    /// encoder thread — it records one frame's GPU commands and nothing more,
    /// holding the serialization point only for that duration (Req 4.2). It
    /// performs no completion wait of its own, so the bounded hold does not
    /// extend across the `GetData` poll.
    fn convert_into(
        &self,
        src: &ID3D11Texture2D,
        output_view: &ID3D11VideoProcessorOutputView,
    ) -> WinResult<()> {
        unsafe {
            let input_view_desc = D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC {
                FourCC: 0,
                ViewDimension: D3D11_VPIV_DIMENSION_TEXTURE2D,
                Anonymous: D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC_0 {
                    Texture2D: D3D11_TEX2D_VPIV {
                        MipSlice: 0,
                        ArraySlice: 0,
                    },
                },
            };
            let mut input_view = None;
            self.video_dev.CreateVideoProcessorInputView(
                src,
                &self.vp_enum,
                &input_view_desc,
                Some(&mut input_view),
            )?;
            let input_view = input_view.unwrap();

            // Source rect = full native capture frame.
            let src_rect = windows::Win32::Foundation::RECT {
                left: 0,
                top: 0,
                right: self.src_width as i32,
                bottom: self.src_height as i32,
            };
            // Destination rect = target encode resolution (VP scales in hardware).
            let dst_rect = windows::Win32::Foundation::RECT {
                left: 0,
                top: 0,
                right: self.dst_width as i32,
                bottom: self.dst_height as i32,
            };

            // Wrap in ManuallyDrop to satisfy the D3D11_VIDEO_PROCESSOR_STREAM layout.
            // SAFETY: We explicitly drop pInputSurface after VideoProcessorBlt to
            // release the COM ref immediately — without this, each frame leaks one
            // ID3D11VideoProcessorInputView reference.
            let mut stream = D3D11_VIDEO_PROCESSOR_STREAM {
                Enable: true.into(),
                OutputIndex: 0,
                InputFrameOrField: 0,
                PastFrames: 0,
                FutureFrames: 0,
                ppPastSurfaces: std::ptr::null_mut(),
                pInputSurface: std::mem::ManuallyDrop::new(Some(input_view)),
                ppFutureSurfaces: std::ptr::null_mut(),
                ppPastSurfacesRight: std::ptr::null_mut(),
                pInputSurfaceRight: std::mem::ManuallyDrop::new(None),
                ppFutureSurfacesRight: std::ptr::null_mut(),
            };

            // Stream source = full native input frame.
            self.video_ctx.VideoProcessorSetStreamSourceRect(
                &self.vp, 0, true, Some(&src_rect),
            );
            // Stream dest = target size (hardware downscale).
            self.video_ctx.VideoProcessorSetStreamDestRect(
                &self.vp, 0, true, Some(&dst_rect),
            );
            // Output target = destination size.
            self.video_ctx.VideoProcessorSetOutputTargetRect(
                &self.vp, true, Some(&dst_rect),
            );

            // SAFETY: We borrow `stream` without moving it (from_raw_parts), so
            // pInputSurface is still accessible for the explicit ManuallyDrop::drop
            // afterwards. This releases the COM ref every frame, preventing leaks.
            let result = unsafe {
                self.video_ctx.VideoProcessorBlt(
                    &self.vp,
                    output_view,
                    0,
                    std::slice::from_raw_parts(&stream, 1),
                )
            };

            // Explicitly release the input view COM ref to prevent per-frame leaks.
            // ManuallyDrop::drop() calls the destructor without moving the value.
            // SAFETY: stream is still valid here (not moved); this is the only drop.
            unsafe { std::mem::ManuallyDrop::drop(&mut stream.pInputSurface) };

            result?;
            Ok(())
        }
    }
}

// ── Annex-B normalisation ──────────────────────────────────────────────────

fn ensure_annexb(data: &[u8]) -> Vec<u8> {
    if data.len() >= 4
        && (data.starts_with(&[0, 0, 0, 1]) || data.starts_with(&[0, 0, 1]))
    {
        return data.to_vec();
    }

    // Assume AVCC: [4-byte big-endian NAL length][NAL data]...
    let mut out = Vec::with_capacity(data.len() + 16);
    let mut i = 0usize;
    while i + 4 <= data.len() {
        let nal_len = u32::from_be_bytes([data[i], data[i + 1], data[i + 2], data[i + 3]])
            as usize;
        i += 4;
        if nal_len == 0 || i + nal_len > data.len() {
            break;
        }
        out.extend_from_slice(&[0, 0, 0, 1]);
        out.extend_from_slice(&data[i..i + nal_len]);
        i += nal_len;
    }

    if out.is_empty() {
        log::warn!(
            "[MftEncoder] Unknown encoded payload format, first bytes: {:02X?}",
            &data[..data.len().min(8)]
        );
        data.to_vec()
    } else {
        out
    }
}

// ── CPU BGRA→NV12 conversion (fallback when GPU video processor unavailable) ──

fn bgra_to_nv12(bgra: &[u8], width: u32, height: u32) -> Vec<u8> {
    let w = width as usize;
    let h = height as usize;
    // Align to 16-wide, 2-tall for NV12 plane layout.
    let aw = (w + 15) & !15;
    let ah = (h + 1) & !1;
    let mut out = vec![0u8; aw * ah * 3 / 2]; // Y plane + interleaved UV

    // BT.601 limited-range coefficients (matches what hardware encoders expect)
    for row in 0..h {
        for col in 0..w {
            let b = bgra[(row * w + col) * 4] as f32;
            let g = bgra[(row * w + col) * 4 + 1] as f32;
            let r = bgra[(row * w + col) * 4 + 2] as f32;
            let y = (16.0 + 0.257 * r + 0.504 * g + 0.098 * b).clamp(16.0, 235.0) as u8;
            out[row * aw + col] = y;

            if row % 2 == 0 && col % 2 == 0 {
                let u = (128.0 - 0.148 * r - 0.291 * g + 0.439 * b).clamp(16.0, 240.0) as u8;
                let v = (128.0 + 0.439 * r - 0.368 * g - 0.071 * b).clamp(16.0, 240.0) as u8;
                let uv_base = aw * ah + (row / 2) * aw + col;
                out[uv_base] = u;
                out[uv_base + 1] = v;
            }
        }
    }
    out
}

// ── Encoder loop ───────────────────────────────────────────────────────────

fn run_encoder_loop(
    encoder_mft: IMFTransform,
    event_gen: IMFMediaEventGenerator,
    provides_samples: bool,
    frame_rx: mpsc::Receiver<CapturedFrame>,
    output_tx: mpsc::SyncSender<Vec<u8>>,
    stop_flag: Arc<AtomicBool>,
    stats: Arc<NativeShareStats>,
    d3d: Arc<D3dDevice>,
    // Native WGC capture dims — VP reads from these.
    src_width: u32,
    src_height: u32,
    // Target encode dims — VP writes to these; MFT encodes at this resolution.
    width: u32,
    height: u32,
    fps: u32,
) {
    // GPU video processor converts BGRA→NV12 AND downscales to the target resolution.
    let mut vp: Option<VideoProcessor> = match VideoProcessor::new(&d3d, src_width, src_height, width, height) {
        Ok(v) => {
            log::info!("[MftEncoder] GPU video processor ready");
            Some(v)
        }
        Err(e) => {
            log::warn!("[MftEncoder] GPU video processor unavailable ({e}), falling back to CPU BGRA→NV12");
            None
        }
    };

    // One reusable GPU-completion query (`D3D11_QUERY_EVENT`) used per frame to
    // confirm the fused blit finished before the MFT reads the NV12 slot —
    // replaces the per-frame `context.Flush()` (Req 1.1, 1.2, 1.5). Only needed
    // on the GPU path; the CPU fallback's readback is implicitly synchronous.
    let event_query: Option<ID3D11Query> = if vp.is_some() {
        match d3d.create_event_query() {
            Ok(q) => Some(q),
            Err(e) => {
                log::warn!("[MftEncoder] create_event_query failed ({e}); proceeding without scoped completion query");
                None
            }
        }
    } else {
        None
    };

    let duration_hns: i64 = 10_000_000i64 / fps.max(1) as i64;
    let mut pts: i64 = 0;
    let mut needs_input = false;
    let mut event_log_count = 0u32;
    let frame_wait = std::time::Duration::from_millis(2);

    loop {
        if stop_flag.load(Ordering::Relaxed) {
            break;
        }

        // ── When the encoder is hungry for a frame, prioritise frame delivery ──
        // Use non-blocking GetEvent so we can spin on frame_rx without getting
        // stuck waiting for an event that will never come (the MFT won't fire
        // METransformNeedInput again until we call ProcessInput).
        if needs_input {
            // Try to push a frame first.
            match frame_rx.recv_timeout(frame_wait) {
                Ok(frame) => {
                    match process_input_frame(
                        &encoder_mft,
                        &mut vp,
                        event_query.as_ref(),
                        &d3d,
                        frame,
                        pts,
                        duration_hns,
                        &stats,
                    ) {
                        Ok(()) => {
                            pts = pts.saturating_add(duration_hns);
                            needs_input = false;
                        }
                        Err(e) => {
                            stats.encode_errors.fetch_add(1, Ordering::Relaxed);
                            // Only log first few errors to avoid spam.
                            if stats.encode_errors.load(Ordering::Relaxed) <= 3 {
                                log::warn!("[MftEncoder] ProcessInput error: {e}");
                            } else if stats.encode_errors.load(Ordering::Relaxed) == 4 {
                                log::warn!("[MftEncoder] ProcessInput errors suppressed after 3");
                            }
                        }
                    }
                }
                Err(_) => {
                    // No frame yet — check if the MFT has output ready (non-blocking).
                }
            }

            // Drain any pending output even while waiting for the next input frame.
            let maybe_event = unsafe {
                event_gen.GetEvent(MF_EVENT_FLAG_NO_WAIT).ok()
            };
            if let Some(event) = maybe_event {
                let event_type = unsafe { event.GetType().unwrap_or(0) };
                if event_type == METransformHaveOutput.0 as u32 {
                    drain_output_loop(&encoder_mft, provides_samples, &output_tx, &stats);
                }
            }
            continue;
        }

        // ── When idle, block in GetEvent to avoid spinning ───────────────────
        let event = unsafe {
            match event_gen.GetEvent(MF_EVENT_FLAG_NO_WAIT) {
                Ok(e) => e,
                Err(e) if e.code() == MF_E_NO_EVENTS_AVAILABLE => {
                    std::thread::sleep(std::time::Duration::from_millis(1));
                    continue;
                }
                Err(e) => {
                    log::error!("[MftEncoder] GetEvent error: {e}");
                    break;
                }
            }
        };

        let event_type = unsafe { event.GetType().unwrap_or(0) };
        let event_status = unsafe { event.GetStatus().unwrap_or(HRESULT(0)) };

        if event_log_count < 30 {
            log::info!(
                "[MftEncoder] event type={event_type} status=0x{:08X}",
                event_status.0 as u32
            );
            event_log_count += 1;
        }

        match event_type {
            // METransformNeedInput = 601
            t if t == METransformNeedInput.0 as u32 => {
                needs_input = true;
                // Immediately try to satisfy the request without another loop iteration.
                if let Ok(frame) = frame_rx.try_recv() {
                    match process_input_frame(
                        &encoder_mft,
                        &mut vp,
                        event_query.as_ref(),
                        &d3d,
                        frame,
                        pts,
                        duration_hns,
                        &stats,
                    ) {
                        Ok(()) => {
                            pts = pts.saturating_add(duration_hns);
                            needs_input = false;
                        }
                        Err(e) => {
                            log::warn!("[MftEncoder] ProcessInput error: {e}");
                            stats.encode_errors.fetch_add(1, Ordering::Relaxed);
                        }
                    }
                }
            }

            // METransformHaveOutput = 602
            t if t == METransformHaveOutput.0 as u32 => {
                drain_output_loop(&encoder_mft, provides_samples, &output_tx, &stats);
            }

            _ => {}
        }
    }

    unsafe {
        let _ = encoder_mft.ProcessMessage(MFT_MESSAGE_NOTIFY_END_OF_STREAM, 0);
        let _ = encoder_mft.ProcessMessage(MFT_MESSAGE_COMMAND_FLUSH, 0);
    }
}

fn process_input_frame(
    encoder_mft: &IMFTransform,
    vp: &mut Option<VideoProcessor>,
    event_query: Option<&ID3D11Query>,
    d3d: &D3dDevice,
    frame: CapturedFrame,
    pts: i64,
    duration_hns: i64,
    stats: &NativeShareStats,
) -> WinResult<()> {
    unsafe {
        let sample: IMFSample = MFCreateSample()?;
        sample.SetSampleTime(pts)?;
        sample.SetSampleDuration(duration_hns)?;

        match vp.as_mut() {
            Some(vp) => {
                // ── GPU path: single fused blit BGRA→NV12 + downscale, read
                //    directly from the WGC texture into a pooled NV12 slot ──
                let fused_start = Instant::now();

                // Acquire the NV12 destination slot from the rotating ring, or
                // fall back to the single retained texture if the ring is not
                // available (first-frame-before-ring / alloc failure — Req 3.4).
                let slot_idx = match vp.nv12_ring.as_mut() {
                    Some(ring) => ring.acquire_rotating(),
                    None => None,
                };

                // Resolve the destination output view + texture. Both are shared
                // borrows of `vp` and coexist with the shared borrow taken by
                // `convert_into` below.
                let (output_view, nv12_tex): (
                    &ID3D11VideoProcessorOutputView,
                    &ID3D11Texture2D,
                ) = match slot_idx.and_then(|i| vp.nv12_ring.as_ref().map(|r| (i, r))) {
                    Some((i, ring)) => {
                        let slot = ring
                            .ring
                            .get(i)
                            .expect("just-acquired NV12 slot must exist");
                        (&slot.output_view, &slot.texture)
                    }
                    None => (&vp.fallback_view, &vp.fallback_tex),
                };

                // 1. Fused convert + downscale into the NV12 destination — a
                //    single VideoProcessorBlt, no intermediate BGRA copy
                //    (Req 3.1, 3.2).
                //
                //    ── Immediate_Context critical section START (Req 4.2) ──
                //    `convert_into` records the VideoProcessorBlt on the shared
                //    Immediate_Context; `context.End(query)` below closes out
                //    that single frame's GPU command recording. This window is
                //    the *only* per-frame use of the shared context on the
                //    encoder thread, and the capture thread records nothing on
                //    it in steady state — so contention is bounded to exactly
                //    this blit-recording span.
                vp.convert_into(&frame.texture, output_view)
                    .map_err(|e| { log::warn!("[MftEncoder] VP convert_into failed: {e}"); e })?;

                // 2. Mark "blit done" with a scoped completion query — NOT a
                //    per-frame Flush (Req 1.1). This is the last command
                //    recorded for this frame, so it ends the bounded critical
                //    section.
                //    ── Immediate_Context critical section END (Req 4.2) ──
                if let Some(q) = event_query {
                    d3d.context.End(q);
                }

                // 3. Wait for THIS blit to finish before touching the slot or
                //    releasing the source, polling GetData with no forced flush
                //    (Req 1.2, 1.5). Note: this poll reads query *status* only
                //    and records no GPU commands, so it is intentionally
                //    *outside* the bounded recording critical section above —
                //    the wait does not extend how long the shared context is
                //    held for command recording. The WGC texture is the blit
                //    *source*, so it must not be released back to the 2-buffer
                //    pool until the GPU has finished reading it — otherwise the
                //    pool could recycle the buffer and the compositor overwrite
                //    it mid-read, tearing the source frame. On a completion-query
                //    timeout treat it as an encode error and drop the frame
                //    (released at scope exit) rather than encode torn/stale
                //    contents.
                if let Some(q) = event_query {
                    if !wait_for_query(d3d, q) {
                        stats.encode_errors.fetch_add(1, Ordering::Relaxed);
                        log::warn!(
                            "[MftEncoder] GPU completion query timed out; dropping frame"
                        );
                        return Ok(());
                    }
                }

                // 4. The completion query has signalled, so the GPU has finished
                //    reading the WGC source. Release the WGC frame promptly now
                //    that the blit is done so the 2-buffer WGC pool can recycle
                //    the buffer (Req 3.5, 3.7). Dropping the CapturedFrame sets
                //    its release token and frees the retained
                //    Direct3D11CaptureFrame.
                drop(frame);

                // The fused GPU operation (blit + completion) is now done.
                // Record its duration so the residual Immediate_Context
                // contention is observable: this span covers the bounded
                // command-recording critical section plus the completion wait,
                // i.e. how long this frame occupied / waited on the shared
                // context. A rising value surfaces contention (Req 4.3, 9.1).
                stats.record_fused_gpu_ns(fused_start.elapsed().as_nanos() as u64);

                // 5. Wrap the pooled NV12 slot as an MF buffer and submit it.
                let buffer: IMFMediaBuffer =
                    MFCreateDXGISurfaceBuffer(&ID3D11Texture2D::IID, nv12_tex, 0, false)
                    .map_err(|e| { log::warn!("[MftEncoder] MFCreateDXGISurfaceBuffer failed: {e}"); e })?;
                sample.AddBuffer(&buffer)?;

                let submit_start = Instant::now();
                encoder_mft.ProcessInput(0, &sample, 0)
                    .map_err(|e| { log::warn!("[MftEncoder] encoder ProcessInput failed: {e}"); e })?;
                stats.record_encode_submit_ns(submit_start.elapsed().as_nanos() as u64);

                // 7. The NV12 slot stays InUse until the ring rotation releases
                //    it on a future acquire (Req 3.9); the MFT has consumed it.
                log::trace!("[MftEncoder] ProcessInput ok pts={pts}");
                stats.captured_frames.fetch_add(1, Ordering::Relaxed);
                Ok(())
            }
            None => {
                // ── CPU fallback: readback BGRA, convert, upload via memory buffer ──
                let bgra = d3d.read_texture_bgra(&frame.texture, frame.width, frame.height)?;
                let nv12 = bgra_to_nv12(&bgra, frame.width, frame.height);
                // The WGC texture has been read back; release the frame so the
                // pool can recycle the buffer.
                drop(frame);
                let buffer = MFCreateMemoryBuffer(nv12.len() as u32)?;
                let mut ptr = std::ptr::null_mut::<u8>();
                buffer.Lock(&mut ptr, None, None)?;
                std::ptr::copy_nonoverlapping(nv12.as_ptr(), ptr, nv12.len());
                buffer.Unlock()?;
                buffer.SetCurrentLength(nv12.len() as u32)?;
                sample.AddBuffer(&buffer)?;

                let submit_start = Instant::now();
                encoder_mft.ProcessInput(0, &sample, 0)
                    .map_err(|e| { log::warn!("[MftEncoder] encoder ProcessInput failed: {e}"); e })?;
                stats.record_encode_submit_ns(submit_start.elapsed().as_nanos() as u64);
                log::trace!("[MftEncoder] ProcessInput ok pts={pts}");
                stats.captured_frames.fetch_add(1, Ordering::Relaxed);
                Ok(())
            }
        }
    }
}

/// Poll a `D3D11_QUERY_EVENT` until the GPU signals completion (`S_OK`),
/// **without** forcing a flush (`getdataflags = 0`). Returns `true` once the
/// blit finished, or `false` if the bounded wait elapses — the caller treats a
/// timeout as an encode error so a torn/stale NV12 slot is never encoded
/// (Req 1.5).
///
/// The safe `GetData` wrapper collapses `S_OK` and `S_FALSE` into `Ok(())`, so
/// this calls the raw vtable to distinguish "done" (`S_OK == 0`) from "still
/// pending" (`S_FALSE == 1`).
fn wait_for_query(d3d: &D3dDevice, query: &ID3D11Query) -> bool {
    // ~100 ms is far beyond a 33 ms (30 fps) frame budget, so reaching it means
    // a wedged GPU rather than normal backpressure.
    let deadline = Instant::now() + Duration::from_millis(100);
    loop {
        let hr = unsafe {
            let vtable = windows::core::Interface::vtable(&d3d.context);
            (vtable.GetData)(
                windows::core::Interface::as_raw(&d3d.context),
                windows::core::Interface::as_raw(query),
                std::ptr::null_mut(),
                0,
                // 0 = poll the status; never set a flag that forces a flush.
                0,
            )
        };
        // S_OK (0) → blit finished; S_FALSE (1) → still pending.
        if hr.0 == 0 {
            return true;
        }
        if hr.0 < 0 {
            log::warn!(
                "[MftEncoder] GetData(event query) failed: 0x{:08X}",
                hr.0 as u32
            );
            return false;
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::yield_now();
    }
}

fn drain_output_loop(
    encoder_mft: &IMFTransform,
    provides_samples: bool,
    output_tx: &mpsc::SyncSender<Vec<u8>>,
    stats: &NativeShareStats,
) {
    loop {
        let out_sample: Option<IMFSample> = if provides_samples {
            None
        } else {
            unsafe {
                match (|| -> WinResult<IMFSample> {
                    let s = MFCreateSample()?;
                    let b = MFCreateMemoryBuffer(4 * 1024 * 1024)?;
                    s.AddBuffer(&b)?;
                    Ok(s)
                })() {
                    Ok(s) => Some(s),
                    Err(e) => {
                        log::warn!("[MftEncoder] Alloc output sample error: {e}");
                        return;
                    }
                }
            }
        };

        let mut status_flags = 0u32;
        let mut buffers = [MFT_OUTPUT_DATA_BUFFER {
            dwStreamID: 0,
            pSample: std::mem::ManuallyDrop::new(out_sample),
            dwStatus: 0,
            pEvents: std::mem::ManuallyDrop::new(None),
        }];

        let result = unsafe {
            encoder_mft.ProcessOutput(0, &mut buffers, &mut status_flags)
        };

        match result {
            Err(e) if e.code().0 == 0xC00D6D72u32 as i32 => break, // NEED_MORE_INPUT
            Err(e) => {
                log::warn!("[MftEncoder] ProcessOutput error: {e}");
                break;
            }
            Ok(()) => {}
        }

        if let Some(sample) = (&*buffers[0].pSample).as_ref() {
            match extract_sample_bytes(sample) {
                Ok(raw) if !raw.is_empty() => {
                    let annexb = ensure_annexb(&raw);
                    log::debug!(
                        "[MftEncoder] encoded {} bytes → annexb {} bytes",
                        raw.len(),
                        annexb.len()
                    );
                    stats.encoded_frames.fetch_add(1, Ordering::Relaxed);
                    let _ = output_tx.try_send(annexb);
                }
                Ok(_) => {}
                Err(e) => log::warn!("[MftEncoder] Extract sample error: {e}"),
            }
        }

        // SAFETY: Explicitly release COM refs held in ManuallyDrop fields.
        // Without this every ProcessOutput call leaks one IMFSample and one
        // IMFCollection (pEvents), directly causing the observed 2 GB memory growth.
        unsafe {
            std::mem::ManuallyDrop::drop(&mut buffers[0].pSample);
            std::mem::ManuallyDrop::drop(&mut buffers[0].pEvents);
        }

        // MFT_OUTPUT_DATA_BUFFER_INCOMPLETE = 0x00A → more output waiting
        if buffers[0].dwStatus & 0x00A == 0 {
            break;
        }
    }
}

fn extract_sample_bytes(sample: &IMFSample) -> WinResult<Vec<u8>> {
    unsafe {
        let buf = sample.ConvertToContiguousBuffer()?;
        let mut ptr = std::ptr::null_mut();
        let mut cur_len = 0u32;
        buf.Lock(&mut ptr, None, Some(&mut cur_len))?;
        let bytes = std::slice::from_raw_parts(ptr as *const u8, cur_len as usize).to_vec();
        buf.Unlock()?;
        Ok(bytes)
    }
}
