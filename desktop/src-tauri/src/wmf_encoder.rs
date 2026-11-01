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
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::time::{Duration, Instant};
use windows::core::{Result as WinResult, *};
use windows::Win32::Graphics::Direct3D11::*;
use windows::Win32::Graphics::Dxgi::Common::{DXGI_FORMAT_NV12, DXGI_SAMPLE_DESC};
use windows::Win32::Media::MediaFoundation::*;

use crate::d3d_device::{D3dDevice, GpuCompletionSignal};
use crate::hardware_encoder::{enumerate_hardware_encoder_activates, read_activate_string};
use crate::native_share::quality::{even_dimension, fit_within, ResizeDebouncer};
use crate::native_share::NativeShareStats;
use crate::ring_buffer::RingBuffer;
use crate::wgc_capture::CapturedFrame;

// Safety: D3dDevice is only accessed from dedicated threads (encoder + capture)
// and is protected by ID3D11Multithread internally.

// ── Codec selection ────────────────────────────────────────────────────────

/// The codec the native publisher encodes. H.264 is the only one the SFU
/// path negotiates today.
#[derive(Clone, Copy, Debug)]
pub enum VideoCodec {
    H264,
}

impl VideoCodec {
    fn mf_subtype(&self) -> GUID {
        match self {
            VideoCodec::H264 => MFVideoFormat_H264,
        }
    }
    pub fn mime_type(&self) -> &'static str {
        match self {
            VideoCodec::H264 => "video/H264",
        }
    }
    /// SDP fmtp for the WebRTC track. NOTE: `profile-level-id=42e01f`
    /// advertises Constrained Baseline level 3.1 even when encoding 1080p+;
    /// changing it affects SFU negotiation, so it is intentionally untouched.
    pub fn sdp_fmtp(&self) -> &'static str {
        match self {
            VideoCodec::H264 => {
                "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f"
            }
        }
    }
}

// ── Encoder_Selection (vendor-neutral) ───────────────────────────────────────
//
// Pure, GPU-/OS-independent layer that decides which encoder family the
// `MFT_Encoder` uses for a session. It performs no Media Foundation, D3D, or OS
// calls, so Property 4 can exercise it exhaustively in CI without a GPU or any
// vendor SDK (Requirements 6.1, 6.2, 6.3, 6.6).
//
// `init_mft` (task 8.2, separate) will enumerate hardware MFTs via
// `MFTEnumEx(MFT_CATEGORY_VIDEO_ENCODER, MFT_ENUM_FLAG_HARDWARE | …)`,
// `classify_mft` each enumerated activate from its friendly name / vendor id,
// then call `select_encoder` to pick the winning backend. None of that wiring
// lives here — this is only the pure selection core.

/// A concrete encoder family the `MFT_Encoder` can select for a session
/// (Requirement 6). Capture-vendor-agnosticism and encode-vendor-agnosticism
/// are independent (Req 6.6): this enum describes only the *encode* side and is
/// chosen without any reference to which GPU produced the captured frame.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EncoderBackend {
    /// NVIDIA NVENC.
    Nvenc,
    /// AMD AMF / VCE.
    Amf,
    /// Intel QuickSync.
    QuickSync,
    /// Any `MFT_ENUM_FLAG_HARDWARE` MFT not matched to a specific vendor — a
    /// usable hardware encoder of unknown vendor (Req 6.2).
    GenericHwMft,
    /// No hardware backend. `select_encoder` still resolves to this (it is
    /// total), but the native pipeline refuses to start on it: the renderer
    /// only takes the native path when a hardware H.264 encoder was probed and
    /// otherwise captures through CEF. Also the stats default before selection.
    Software,
}

impl EncoderBackend {
    /// Stable string form reported through `NativeShareStats` / `Capture_Status`
    /// (Req 6.5; consumed by task 9.1). These values are part of the status
    /// contract surfaced to the renderer and MUST remain stable.
    pub fn as_str(self) -> &'static str {
        match self {
            EncoderBackend::Nvenc => "nvenc",
            EncoderBackend::Amf => "amf",
            EncoderBackend::QuickSync => "quicksync",
            EncoderBackend::GenericHwMft => "generic_hw",
            EncoderBackend::Software => "software",
        }
    }

    /// Selection rank — **lower is more preferred**. This single total order
    /// encodes both the category preference *and* the vendor tiebreak required
    /// by Req 6.1/6.2/6.3:
    ///
    /// - vendor hardware (`Nvenc` < `Amf` < `QuickSync`) is preferred over
    /// - a generic hardware MFT (`GenericHwMft`), which is preferred over
    /// - the software encoder (`Software`).
    ///
    /// The vendor tiebreak is a **fixed documented priority** (NVENC > AMF >
    /// QuickSync) so that, among multiple vendor-HW candidates, selection is
    /// deterministic and independent of enumeration order (Property 4).
    fn preference_rank(self) -> u8 {
        match self {
            EncoderBackend::Nvenc => 0,
            EncoderBackend::Amf => 1,
            EncoderBackend::QuickSync => 2,
            EncoderBackend::GenericHwMft => 3,
            EncoderBackend::Software => 4,
        }
    }
}

/// One enumerated encoder candidate (produced from a single `MFTEnumEx`
/// activate by `classify_mft`), carrying the fields used to classify and order
/// it. `friendly_name` / `is_hardware` come from the activate attributes
/// (e.g. `MFT_FRIENDLY_NAME_Attribute`, `MFT_ENUM_FLAG_HARDWARE`)
/// (verify exact attribute keys against the Media Foundation headers when
/// wiring `init_mft` in task 8.2).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EncoderCandidate {
    /// The backend family this candidate was classified into.
    pub backend: EncoderBackend,
    /// Human-readable MFT name (retained for diagnostics/logging).
    pub friendly_name: String,
    /// Whether the MFT was enumerated as a hardware transform.
    pub is_hardware: bool,
}

// PCI vendor IDs used to classify an enumerated hardware MFT (Req 6.1).
const VENDOR_ID_NVIDIA: u32 = 0x10DE;
const VENDOR_ID_AMD: u32 = 0x1002;
const VENDOR_ID_INTEL: u32 = 0x8086;

/// Classify one enumerated MFT into an [`EncoderBackend`] from its hardware
/// flag, vendor id, and friendly name (Req 6.1, 6.2, 6.3).
///
/// Rules, in order:
/// 1. A non-hardware MFT is always [`EncoderBackend::Software`] (Req 6.3).
/// 2. The authoritative PCI `vendor_id` is preferred when present: NVIDIA
///    (`0x10DE`) → `Nvenc`, AMD (`0x1002`) → `Amf`, Intel (`0x8086`) →
///    `QuickSync` (Req 6.1).
/// 3. Otherwise the friendly name is matched case-insensitively against the
///    well-known vendor markers.
/// 4. A hardware MFT that matches none of the above is [`EncoderBackend::GenericHwMft`]
///    — usable, but of unknown vendor (Req 6.2).
///
/// Pure and total: no Media Foundation / D3D / OS calls.
/// (verify exact attribute keys — `MFT_ENUM_HARDWARE_VENDOR_ID_Attribute` /
/// `MFT_FRIENDLY_NAME_Attribute` — against the pinned headers in task 8.2.)
pub fn classify_mft(
    friendly_name: &str,
    vendor_id: Option<u32>,
    is_hardware: bool,
) -> EncoderBackend {
    // 1. Non-hardware transforms are software encoders regardless of vendor/name.
    if !is_hardware {
        return EncoderBackend::Software;
    }

    // 2. Prefer the authoritative PCI vendor id when present.
    if let Some(id) = vendor_id {
        match id {
            VENDOR_ID_NVIDIA => return EncoderBackend::Nvenc,
            VENDOR_ID_AMD => return EncoderBackend::Amf,
            VENDOR_ID_INTEL => return EncoderBackend::QuickSync,
            _ => {}
        }
    }

    // 3. Fall back to a case-insensitive friendly-name match.
    let name = friendly_name.to_ascii_lowercase();
    if name.contains("nvidia") || name.contains("nvenc") {
        EncoderBackend::Nvenc
    } else if name.contains("amd") || name.contains("amf") || name.contains("radeon") {
        EncoderBackend::Amf
    } else if name.contains("intel") || name.contains("quicksync") || name.contains("quick sync") {
        EncoderBackend::QuickSync
    } else {
        // 4. Unknown hardware MFT — usable but unattributed.
        EncoderBackend::GenericHwMft
    }
}

/// Pure, total, deterministic selection of the session's encoder backend from
/// the enumerated `candidates` (Req 6.1, 6.2, 6.3, 6.6).
///
/// Preference order (most → least preferred): vendor hardware
/// (`Nvenc` > `Amf` > `QuickSync`) > `GenericHwMft` > `Software`, as encoded by
/// [`EncoderBackend::preference_rank`].
///
/// Guarantees (Property 4):
/// - **Total**: always returns exactly one backend; an empty slice yields
///   [`EncoderBackend::Software`] (Req 6.3 — never fail to pick).
/// - **Deterministic**: equal input slices yield the same choice, independent
///   of candidate order, because the winner is the unique minimum
///   `preference_rank` present.
/// - **Capture-independent**: takes no capture-side input (Req 6.6).
pub fn select_encoder(candidates: &[EncoderCandidate]) -> EncoderBackend {
    candidates
        .iter()
        .map(|c| c.backend)
        .min_by_key(|b| b.preference_rank())
        .unwrap_or(EncoderBackend::Software)
}

// ── Public handle ──────────────────────────────────────────────────────────

/// A live, in-place reconfiguration request: the quality preset changed. The
/// worker refits the source aspect ratio inside the new box and applies it at
/// the next frame boundary WITHOUT tearing down the encoder thread, the WebRTC
/// peer connection, the track, or the live game-capture hook.
#[derive(Debug, Clone, Copy)]
pub struct EncoderReconfig {
    /// The preset's bounding box width (the encode width is the source aspect
    /// ratio fitted inside `max_width × max_height`).
    pub max_width: u32,
    /// The preset's bounding box height.
    pub max_height: u32,
    /// New target frame rate (fps). The GOP follows it (~1 s).
    pub fps: u32,
    /// New target average bitrate (bits/sec).
    pub bitrate: u32,
}

/// A control message applied to the running encoder at a frame boundary.
#[derive(Debug, Clone, Copy)]
pub enum EncoderControl {
    /// Quality preset change (box / fps / bitrate).
    Reconfig(EncoderReconfig),
    /// Force the encoder to emit a keyframe (IDR) on the next frame, via
    /// `CODECAPI_AVEncVideoForceKeyFrame`. Driven by inbound RTCP PLI/FIR; the
    /// sender debounces so a PLI burst yields at most one IDR per window.
    RequestKeyframe,
}

/// Everything that wakes the encoder thread. Frames, MFT events, control
/// messages, and stop all funnel through one bounded channel so the thread
/// blocks in exactly one place (no busy poll, no blocking `GetEvent`).
pub enum WorkerInput {
    Frame(CapturedFrame),
    /// Something else is ready (an MFT event, a control message, or stop).
    Wake,
}

/// Cloneable sender that capture sources (WGC callback, hook thread) use to
/// hand frames to the encoder. Never blocks: a full queue drops the frame,
/// which releases it back to its source immediately.
#[derive(Clone)]
pub struct FrameSender {
    tx: mpsc::SyncSender<WorkerInput>,
}

impl FrameSender {
    /// Queue `frame` for encoding. Returns `false` (and drops the frame) when
    /// the encoder queue is full or the encoder has exited.
    pub fn try_send(&self, frame: CapturedFrame) -> bool {
        self.tx.try_send(WorkerInput::Frame(frame)).is_ok()
    }
}

/// A cloneable, `Send` handle to a running encoder's control channel, for
/// components that do not own the [`MftEncoderWorker`] (the RTCP readers on
/// the WebRTC peer connections). Sends never block and are silently ignored
/// once the encoder thread has exited.
#[derive(Clone)]
pub struct EncoderControlHandle {
    tx: mpsc::Sender<EncoderControl>,
    wake: mpsc::SyncSender<WorkerInput>,
}

impl EncoderControlHandle {
    /// Request a keyframe (IDR) on the next frame. No-op if the encoder is gone.
    pub fn request_keyframe(&self) {
        let _ = self.tx.send(EncoderControl::RequestKeyframe);
        let _ = self.wake.try_send(WorkerInput::Wake);
    }
}

/// Encoded H.264 access units (Annex-B) leave the encoder on this bounded
/// channel. `try_send` from the encoder thread: a full queue drops the frame,
/// counts it, and forces a keyframe so the decoder chain recovers (B18).
pub type EncodedSender = tokio::sync::mpsc::Sender<Vec<u8>>;

/// How long `MftEncoderWorker::new` waits for the encoder thread to finish MFT
/// and VideoProcessor setup before giving up (B13: never block forever).
const ENCODER_INIT_TIMEOUT: Duration = Duration::from_secs(10);
/// Upper bound on how long the encoder thread sleeps with nothing to do. Every
/// real event wakes it immediately; this only bounds stop/debounce latency.
const IDLE_WAKE: Duration = Duration::from_millis(100);
/// Frames queued between capture and the encoder thread.
const FRAME_QUEUE: usize = 4;

pub struct MftEncoderWorker {
    frames: FrameSender,
    control_tx: mpsc::Sender<EncoderControl>,
    stop_flag: Arc<AtomicBool>,
    join: Option<std::thread::JoinHandle<()>>,
    /// The vendor-neutral hardware encoder backend selected for this session
    /// (Req 6.5), reported back over the init channel.
    selected_backend: EncoderBackend,
}

impl MftEncoderWorker {
    /// Start the encoder thread. `src_*` is the capture source size and
    /// `max_*` the quality preset box; the encode size is the source aspect
    /// ratio fitted inside the box (and refitted whenever the source resizes).
    ///
    /// Blocks the calling thread for MFT setup (bounded by
    /// [`ENCODER_INIT_TIMEOUT`]); call it from a blocking context.
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        codec: VideoCodec,
        src_width: u32,
        src_height: u32,
        max_width: u32,
        max_height: u32,
        fps: u32,
        bitrate: u32,
        d3d: Arc<D3dDevice>,
        output_tx: EncodedSender,
        stats: Arc<NativeShareStats>,
    ) -> StdResult<Self, String> {
        let (input_tx, input_rx) = mpsc::sync_channel::<WorkerInput>(FRAME_QUEUE);
        let (control_tx, control_rx) = mpsc::channel::<EncoderControl>();
        let stop_flag = Arc::new(AtomicBool::new(false));
        let stop_clone = Arc::clone(&stop_flag);
        let wake_tx = input_tx.clone();

        // One-shot channel: the thread reports Ok(backend) or Err(msg) once MFT
        // + VideoProcessor setup finishes.
        let (init_tx, init_rx) = mpsc::sync_channel::<StdResult<EncoderBackend, String>>(1);

        let config = EncoderSettings {
            codec,
            src: (src_width, src_height),
            max: (max_width, max_height),
            fps,
            bitrate,
        };
        let join = std::thread::Builder::new()
            .name("RalphMftEncoder".to_owned())
            .spawn(move || {
                // COM objects are created and used only on this thread.
                let mut encoder = match Encoder::init(config, d3d, stats, output_tx, wake_tx) {
                    Ok(encoder) => encoder,
                    Err(e) => {
                        let _ = init_tx.send(Err(format!(
                            "Init hardware {} encoder: {e}",
                            codec.mime_type()
                        )));
                        return;
                    }
                };
                if stop_clone.load(Ordering::Relaxed) {
                    // `new` already gave up waiting (init timeout).
                    encoder.shutdown();
                    return;
                }
                let _ = init_tx.send(Ok(encoder.backend));
                encoder.run(&input_rx, &control_rx, &stop_clone);
                encoder.shutdown();
                log::info!("[MftEncoder] Worker stopped");
            })
            .map_err(|e| format!("Spawn encoder thread: {e}"))?;

        let selected_backend = match init_rx.recv_timeout(ENCODER_INIT_TIMEOUT) {
            Ok(Ok(backend)) => backend,
            Ok(Err(msg)) => return Err(msg),
            Err(mpsc::RecvTimeoutError::Timeout) => {
                // Detach: the thread notices the flag after init and exits.
                stop_flag.store(true, Ordering::Relaxed);
                return Err(format!(
                    "Encoder init timed out after {}s",
                    ENCODER_INIT_TIMEOUT.as_secs()
                ));
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Err("Encoder thread died before reporting init".into())
            }
        };

        Ok(Self {
            frames: FrameSender { tx: input_tx },
            control_tx,
            stop_flag,
            join: Some(join),
            selected_backend,
        })
    }

    /// The vendor-neutral [`EncoderBackend`] chosen for this session (Req 6.5).
    pub fn selected_backend(&self) -> EncoderBackend {
        self.selected_backend
    }

    /// Sender capture sources use to feed frames to this encoder.
    pub fn frame_sender(&self) -> FrameSender {
        self.frames.clone()
    }

    /// Apply a quality preset change in place (see [`EncoderReconfig`]).
    /// Returns an error only if the encoder thread has already exited.
    pub fn reconfigure(&self, cfg: EncoderReconfig) -> StdResult<(), String> {
        self.control_tx
            .send(EncoderControl::Reconfig(cfg))
            .map_err(|_| "encoder worker thread is no longer running".to_string())?;
        let _ = self.frames.tx.try_send(WorkerInput::Wake);
        Ok(())
    }

    /// Cloneable control handle for components that do not own the worker.
    pub fn control_handle(&self) -> EncoderControlHandle {
        EncoderControlHandle {
            tx: self.control_tx.clone(),
            wake: self.frames.tx.clone(),
        }
    }

    /// Signal the encoder thread to exit and join it. The thread wakes within
    /// [`IDLE_WAKE`] at most; joining can still block if the driver is stuck
    /// inside an MFT call, so callers run this off the async runtime.
    pub fn stop(&mut self) {
        self.stop_flag.store(true, Ordering::Relaxed);
        let _ = self.frames.tx.try_send(WorkerInput::Wake);
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

// ── Hardware encoder enumeration + selection ───────────────────────────────

/// Build an [`EncoderCandidate`] from one enumerated hardware `IMFActivate` by
/// reading its friendly name + vendor id and classifying it (Req 6.1, 6.2).
unsafe fn read_encoder_candidate(activate: &IMFActivate) -> EncoderCandidate {
    let friendly_name =
        read_activate_string(activate, &MFT_FRIENDLY_NAME_Attribute).unwrap_or_default();
    let vendor_id = read_activate_string(activate, &MFT_ENUM_HARDWARE_VENDOR_ID_Attribute)
        .and_then(|s| parse_vendor_id(&s));
    let backend = classify_mft(&friendly_name, vendor_id, true);
    EncoderCandidate {
        backend,
        friendly_name,
        is_hardware: true,
    }
}

/// Parse the `MFT_ENUM_HARDWARE_VENDOR_ID_Attribute` string into a PCI vendor
/// id. Media Foundation reports this as `"VEN_XXXX"` (hex, e.g. `"VEN_10DE"`);
/// some drivers report just the hex digits. Returns `None` when it cannot be
/// parsed so [`classify_mft`] falls back to the friendly-name match.
fn parse_vendor_id(raw: &str) -> Option<u32> {
    let trimmed = raw.trim();
    let hex = trimmed
        .strip_prefix("VEN_")
        .or_else(|| trimmed.strip_prefix("ven_"))
        .unwrap_or(trimmed)
        .trim();
    u32::from_str_radix(hex, 16).ok()
}

/// Activate and configure the hardware encoder MFT for `codec`.
///
/// Only hardware (async, D3D-backed) MFTs are supported: the renderer takes
/// the native path only when `probe_hardware_video_encoders` reports a
/// hardware H.264 encoder, and falls back to CEF capture otherwise.
fn init_mft(
    settings: &EncoderSettings,
    out: (u32, u32),
    d3d: &D3dDevice,
) -> StdResult<(IMFTransform, IMFMediaEventGenerator, bool, EncoderBackend), String> {
    unsafe {
        let activates = enumerate_hardware_encoder_activates(settings.codec.mf_subtype())
            .map_err(|e| format!("MFTEnumEx: {e}"))?;
        let candidates: Vec<EncoderCandidate> = activates
            .iter()
            .map(|a| read_encoder_candidate(a))
            .collect();
        for c in &candidates {
            log::info!(
                "[MftEncoder] enumerated HW encoder: '{}' → {}",
                c.friendly_name,
                c.backend.as_str()
            );
        }

        let backend = select_encoder(&candidates);
        let Some(idx) = candidates.iter().position(|c| c.backend == backend) else {
            return Err("no hardware video encoder available".to_string());
        };
        log::info!(
            "[MftEncoder] selected encoder backend: {}",
            backend.as_str()
        );

        let encoder_mft: IMFTransform = activates[idx]
            .ActivateObject()
            .map_err(|e| format!("ActivateObject: {e}"))?;
        if let Ok(attrs) = encoder_mft.GetAttributes() {
            let _ = attrs.SetUINT32(&MF_TRANSFORM_ASYNC_UNLOCK, 1);
        }
        encoder_mft
            .ProcessMessage(
                MFT_MESSAGE_SET_D3D_MANAGER,
                windows::core::Interface::as_raw(&d3d.dxgi_manager) as usize,
            )
            .map_err(|e| format!("Attach D3D manager: {e}"))?;

        set_media_types(
            &encoder_mft,
            settings.codec.mf_subtype(),
            out,
            settings.fps,
            settings.bitrate,
        )
        .map_err(|e| format!("Set media types: {e}"))?;

        // Low-latency tuning (Req 1): low-delay rate control, no B-frames /
        // lookahead, ~1 s GOP. Best-effort; logs the knobs that took.
        configure_low_latency(&encoder_mft, settings.fps);

        let start = || -> WinResult<()> {
            encoder_mft.ProcessMessage(MFT_MESSAGE_COMMAND_FLUSH, 0)?;
            encoder_mft.ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0)?;
            encoder_mft.ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0)
        };
        start().map_err(|e| format!("Start streaming: {e}"))?;

        let info = encoder_mft
            .GetOutputStreamInfo(0)
            .map_err(|e| format!("GetOutputStreamInfo: {e}"))?;
        let provides_samples = (info.dwFlags & MFT_OUTPUT_STREAM_PROVIDES_SAMPLES.0 as u32) != 0;
        log::info!(
            "[MftEncoder] output_stream flags=0x{:X} provides_samples={provides_samples}",
            info.dwFlags
        );

        // Hardware MFTs are asynchronous: METransformNeedInput/HaveOutput
        // arrive through the event generator.
        let event_gen: IMFMediaEventGenerator = encoder_mft
            .cast()
            .map_err(|e| format!("hardware MFT has no event generator: {e}"))?;
        Ok((encoder_mft, event_gen, provides_samples, backend))
    }
}

/// Set the encoder output type (codec, size, rate, bitrate) then the matching
/// NV12 input type. Used at init and on every resolution / fps reconfigure.
unsafe fn set_media_types(
    encoder_mft: &IMFTransform,
    subtype: GUID,
    size: (u32, u32),
    fps: u32,
    bitrate: u32,
) -> WinResult<()> {
    let frame_rate_packed = ((fps.max(1) as u64) << 32) | 1;
    let frame_size_packed = ((size.0 as u64) << 32) | (size.1 as u64);

    let out_type: IMFMediaType = MFCreateMediaType()?;
    out_type.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)?;
    out_type.SetGUID(&MF_MT_SUBTYPE, &subtype)?;
    out_type.SetUINT32(&MF_MT_AVG_BITRATE, bitrate)?;
    out_type.SetUINT64(&MF_MT_FRAME_RATE, frame_rate_packed)?;
    out_type.SetUINT64(&MF_MT_FRAME_SIZE, frame_size_packed)?;
    out_type.SetUINT32(&MF_MT_INTERLACE_MODE, 2)?;
    encoder_mft.SetOutputType(0, &out_type, 0)?;

    let in_type: IMFMediaType = MFCreateMediaType()?;
    in_type.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)?;
    in_type.SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_NV12)?;
    in_type.SetUINT64(&MF_MT_FRAME_RATE, frame_rate_packed)?;
    in_type.SetUINT64(&MF_MT_FRAME_SIZE, frame_size_packed)?;
    in_type.SetUINT32(&MF_MT_INTERLACE_MODE, 2)?;
    in_type.SetUINT64(&MF_MT_PIXEL_ASPECT_RATIO, (1u64 << 32) | 1)?;
    // Stride for NV12: width bytes per row (no padding in our aligned texture).
    in_type.SetUINT32(&MF_MT_DEFAULT_STRIDE, size.0)?;
    encoder_mft.SetInputType(0, &in_type, 0)
}

// ── Async MFT event pump ───────────────────────────────────────────────────

/// One message from the MFT event generator, delivered by
/// [`MftEventCallback`] on a Media Foundation work-queue thread.
enum MftEventMsg {
    Event(u32),
    Failed(HRESULT),
}

/// `IMFAsyncCallback` for `BeginGetEvent`: forwards each MFT event to the
/// encoder thread and wakes it. The generator travels as the async *state*, so
/// the callback holds no COM reference back to the MFT (no ref cycle).
#[windows::core::implement(IMFAsyncCallback)]
struct MftEventCallback {
    events: mpsc::Sender<MftEventMsg>,
    wake: mpsc::SyncSender<WorkerInput>,
}

impl IMFAsyncCallback_Impl for MftEventCallback_Impl {
    fn GetParameters(&self, _flags: *mut u32, _queue: *mut u32) -> WinResult<()> {
        // E_NOTIMPL selects the default work queue and flags.
        Err(windows::Win32::Foundation::E_NOTIMPL.into())
    }

    fn Invoke(&self, result: Ref<'_, IMFAsyncResult>) -> WinResult<()> {
        let result = result.ok()?;
        let msg = unsafe {
            result
                .GetState()
                .and_then(|state| state.cast::<IMFMediaEventGenerator>())
                .and_then(|generator| generator.EndGetEvent(result))
                .map(|event| MftEventMsg::Event(event.GetType().unwrap_or(0)))
                .unwrap_or_else(|e| MftEventMsg::Failed(e.code()))
        };
        let _ = self.events.send(msg);
        let _ = self.wake.try_send(WorkerInput::Wake);
        Ok(())
    }
}

// ── Encoder thread state ───────────────────────────────────────────────────

#[derive(Clone, Copy)]
struct EncoderSettings {
    codec: VideoCodec,
    src: (u32, u32),
    max: (u32, u32),
    fps: u32,
    bitrate: u32,
}

/// The newest captured frame waiting for (or, during a pending resize, kept
/// after) encoding. At most one frame is ever held, so a 2-buffer WGC pool and
/// the hook's retain-at-most-one rule are both respected.
struct HeldFrame {
    frame: CapturedFrame,
    encoded: bool,
}

/// Normalize a frame's content size for comparison with the configured source
/// size (the encoder works in even dimensions).
fn frame_dims(frame: &CapturedFrame) -> (u32, u32) {
    (even_dimension(frame.width), even_dimension(frame.height))
}

/// All state owned by the encoder thread.
struct Encoder {
    mft: IMFTransform,
    event_gen: IMFMediaEventGenerator,
    callback: IMFAsyncCallback,
    event_rx: mpsc::Receiver<MftEventMsg>,
    provides_samples: bool,
    backend: EncoderBackend,
    vp: VideoProcessor,
    completion: GpuCompletionSignal,
    d3d: Arc<D3dDevice>,
    stats: Arc<NativeShareStats>,
    output_tx: EncodedSender,
    settings: EncoderSettings,
    /// Current encode (VideoProcessor output + MFT frame) size.
    out: (u32, u32),
    duration_hns: i64,
    pts: i64,
    /// METransformNeedInput events not yet answered with ProcessInput. Every
    /// event is counted (B14: extra NeedInput events are no longer discarded,
    /// so the MFT can keep more than one frame in flight).
    need_input: u32,
    held: Option<HeldFrame>,
    resize: ResizeDebouncer,
    want_keyframe: bool,
    output_drop_logged: bool,
}

impl Encoder {
    fn init(
        settings: EncoderSettings,
        d3d: Arc<D3dDevice>,
        stats: Arc<NativeShareStats>,
        output_tx: EncodedSender,
        wake: mpsc::SyncSender<WorkerInput>,
    ) -> StdResult<Self, String> {
        let src = (
            even_dimension(settings.src.0),
            even_dimension(settings.src.1),
        );
        let out = fit_within(src, settings.max);
        let (mft, event_gen, provides_samples, backend) = init_mft(&settings, out, &d3d)?;
        let vp = VideoProcessor::new(&d3d, src.0, src.1, out.0, out.1)
            .map_err(|e| format!("GPU video processor: {e}"))?;
        let completion = d3d.create_completion_signal();
        log::info!(
            "[MftEncoder] GPU completion signal: path={}",
            completion.path_name()
        );

        let (event_tx, event_rx) = mpsc::channel();
        let callback: IMFAsyncCallback = MftEventCallback {
            events: event_tx,
            wake,
        }
        .into();

        stats.set_encoder_backend(backend);
        stats.set_negotiated_params(out.0, out.1, f64::from(settings.fps));
        log::info!(
            "[MftEncoder] Worker started codec={:?} src={}x{} out={}x{} (box {}x{}) fps={} bitrate={} backend={}",
            settings.codec,
            src.0,
            src.1,
            out.0,
            out.1,
            settings.max.0,
            settings.max.1,
            settings.fps,
            settings.bitrate,
            backend.as_str()
        );

        let mut encoder = Self {
            mft,
            event_gen,
            callback,
            event_rx,
            provides_samples,
            backend,
            vp,
            completion,
            d3d,
            stats,
            output_tx,
            settings: EncoderSettings { src, ..settings },
            out,
            duration_hns: 10_000_000i64 / settings.fps.max(1) as i64,
            pts: 0,
            need_input: 0,
            held: None,
            resize: ResizeDebouncer::new(src),
            want_keyframe: false,
            output_drop_logged: false,
        };
        encoder
            .arm_event()
            .map_err(|e| format!("BeginGetEvent: {e}"))?;
        Ok(encoder)
    }

    /// Request the next MFT event. Exactly one request is outstanding at a
    /// time; it is re-armed after each delivered event.
    fn arm_event(&mut self) -> WinResult<()> {
        unsafe {
            let state: IUnknown = self.event_gen.cast()?;
            self.event_gen.BeginGetEvent(&self.callback, &state)
        }
    }

    fn run(
        &mut self,
        input_rx: &mpsc::Receiver<WorkerInput>,
        control_rx: &mpsc::Receiver<EncoderControl>,
        stop: &AtomicBool,
    ) {
        while !stop.load(Ordering::Relaxed) {
            // 1. Control messages (latest reconfig wins; any keyframe request
            //    in the batch is honored).
            let mut reconfig = None;
            while let Ok(ctrl) = control_rx.try_recv() {
                match ctrl {
                    EncoderControl::Reconfig(cfg) => reconfig = Some(cfg),
                    EncoderControl::RequestKeyframe => self.want_keyframe = true,
                }
            }
            if let Some(cfg) = reconfig {
                self.apply_quality(cfg);
            }

            // 2. MFT events.
            if !self.pump_events() {
                break;
            }

            // 3. Trailing edge of a debounced source resize.
            if let Some(src) = self.resize.poll(Instant::now()) {
                self.apply_source_size(src);
            }

            // 4. Feed the MFT if it asked for input and a frame is waiting.
            self.feed();

            // 5. Sleep until something happens.
            match input_rx.recv_timeout(IDLE_WAKE) {
                Ok(WorkerInput::Frame(frame)) => self.accept_frame(frame),
                Ok(WorkerInput::Wake) | Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
    }

    /// Drain delivered MFT events. Returns `false` when the event stream is
    /// dead (MFT shut down or errored) and the thread should exit.
    fn pump_events(&mut self) -> bool {
        while let Ok(msg) = self.event_rx.try_recv() {
            match msg {
                MftEventMsg::Event(kind) => {
                    if kind == METransformNeedInput.0 as u32 {
                        self.need_input = self.need_input.saturating_add(1);
                    } else if kind == METransformHaveOutput.0 as u32 {
                        self.drain_output();
                    }
                    if let Err(e) = self.arm_event() {
                        log::error!("[MftEncoder] BeginGetEvent failed: {e}");
                        return false;
                    }
                }
                MftEventMsg::Failed(hr) => {
                    if hr != MF_E_SHUTDOWN {
                        log::error!("[MftEncoder] GetEvent failed: {hr:?}");
                    }
                    return false;
                }
            }
        }
        true
    }

    /// Take ownership of a newly captured frame: detect a source resize, then
    /// make it the held frame (replacing an older unencoded one, which drops
    /// and releases back to its source immediately).
    fn accept_frame(&mut self, frame: CapturedFrame) {
        if let Some(src) = self.resize.observe(frame_dims(&frame), Instant::now()) {
            self.apply_source_size(src);
        }
        let replaced = self.held.replace(HeldFrame {
            frame,
            encoded: false,
        });
        if replaced.is_some_and(|old| !old.encoded) {
            self.stats.dropped_frames.fetch_add(1, Ordering::Relaxed);
        }
    }

    fn feed(&mut self) {
        if self.need_input == 0 {
            return;
        }
        let Some(held) = self.held.as_mut().filter(|h| !h.encoded) else {
            return;
        };
        if self.want_keyframe {
            self.want_keyframe = false;
            unsafe { force_keyframe(&self.mft) };
        }
        match process_input_frame(
            &self.mft,
            &mut self.vp,
            &mut self.completion,
            &self.d3d,
            &held.frame,
            self.pts,
            self.duration_hns,
            &self.stats,
        ) {
            Ok(true) => {
                self.need_input -= 1;
                self.pts = self.pts.saturating_add(self.duration_hns);
                held.encoded = true;
                if self.stats.negotiated_width.load(Ordering::Relaxed) == 0 {
                    // A capture-path change cleared the negotiated params;
                    // republish now that frames flow again.
                    self.stats.set_negotiated_params(
                        self.out.0,
                        self.out.1,
                        f64::from(self.settings.fps),
                    );
                }
                // While a resize is pending keep the (already encoded) frame,
                // so it can be re-encoded at the new size if the source goes
                // static; otherwise release it right away.
                if !self.resize.is_pending() {
                    self.held = None;
                }
            }
            Ok(false) => {
                // GPU completion timed out; the frame was not submitted.
                self.held = None;
            }
            Err(e) if e.code() == MF_E_NOTACCEPTING => {
                // The MFT is not ready (stale NeedInput after a flush). Keep the
                // frame for the next real request.
                self.need_input = 0;
            }
            Err(e) => {
                let errors = self.stats.encode_errors.fetch_add(1, Ordering::Relaxed) + 1;
                if errors <= 3 {
                    log::warn!("[MftEncoder] ProcessInput error: {e}");
                } else if errors == 4 {
                    log::warn!("[MftEncoder] ProcessInput errors suppressed after 3");
                }
                self.held = None;
            }
        }
    }

    /// Quality preset change from the renderer.
    fn apply_quality(&mut self, cfg: EncoderReconfig) {
        self.settings.max = (cfg.max_width, cfg.max_height);
        self.settings.fps = cfg.fps;
        self.settings.bitrate = cfg.bitrate;
        self.reconfigure(self.settings.src, true);
    }

    /// The captured source changed shape (debounced).
    fn apply_source_size(&mut self, src: (u32, u32)) {
        self.reconfigure(src, false);
        // Re-encode the newest frame at the new size so a source that goes
        // static after resizing does not leave the old geometry on screen.
        if let Some(held) = self.held.as_mut() {
            held.encoded = false;
        }
    }

    /// Fit `src` inside the quality box and rebuild whatever changed: the
    /// VideoProcessor (source and/or output size) and, when the encode size,
    /// fps, or bitrate changed, the MFT media types + GOP. Forces a keyframe
    /// after any change that alters the bitstream. A failure keeps the previous
    /// configuration.
    fn reconfigure(&mut self, src: (u32, u32), quality_changed: bool) {
        let out = fit_within(src, self.settings.max);
        if let Err(e) = self.vp.reconfigure(&self.d3d, src, out) {
            log::warn!(
                "[MftEncoder] VideoProcessor reconfigure to {}x{} → {}x{} failed ({e}); keeping prior config",
                src.0,
                src.1,
                out.0,
                out.1
            );
            return;
        }
        self.settings.src = src;

        if out != self.out || quality_changed {
            let result = unsafe {
                self.mft
                    .ProcessMessage(MFT_MESSAGE_COMMAND_FLUSH, 0)
                    .and_then(|()| {
                        set_media_types(
                            &self.mft,
                            self.settings.codec.mf_subtype(),
                            out,
                            self.settings.fps,
                            self.settings.bitrate,
                        )
                    })
                    .and_then(|()| {
                        set_gop_size(&self.mft, self.settings.fps);
                        self.mft
                            .ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0)?;
                        self.mft
                            .ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0)
                    })
            };
            if let Err(e) = result {
                log::warn!(
                    "[MftEncoder] MFT reconfigure to {}x{} failed ({e})",
                    out.0,
                    out.1
                );
                return;
            }
            self.out = out;
            self.duration_hns = 10_000_000i64 / self.settings.fps.max(1) as i64;
            self.want_keyframe = true;
        }

        self.stats
            .set_negotiated_params(out.0, out.1, f64::from(self.settings.fps));
        log::info!(
            "[MftEncoder] reconfigured src={}x{} out={}x{} (box {}x{}) fps={} bitrate={}",
            src.0,
            src.1,
            out.0,
            out.1,
            self.settings.max.0,
            self.settings.max.1,
            self.settings.fps,
            self.settings.bitrate
        );
    }

    /// One `ProcessOutput` per `METransformHaveOutput` (async MFT contract),
    /// continuing only while the MFT flags the buffer as incomplete.
    fn drain_output(&mut self) {
        loop {
            let out_sample: Option<IMFSample> = if self.provides_samples {
                None
            } else {
                let alloc = || -> WinResult<IMFSample> {
                    unsafe {
                        let s = MFCreateSample()?;
                        let b = MFCreateMemoryBuffer(4 * 1024 * 1024)?;
                        s.AddBuffer(&b)?;
                        Ok(s)
                    }
                };
                match alloc() {
                    Ok(s) => Some(s),
                    Err(e) => {
                        log::warn!("[MftEncoder] Alloc output sample error: {e}");
                        return;
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
            let result = unsafe { self.mft.ProcessOutput(0, &mut buffers, &mut status_flags) };

            // Take the COM refs out of the ManuallyDrop fields so they release
            // on every path, including errors (previously the error path leaked
            // the output sample).
            let sample = unsafe { std::mem::ManuallyDrop::take(&mut buffers[0].pSample) };
            drop(unsafe { std::mem::ManuallyDrop::take(&mut buffers[0].pEvents) });
            let incomplete =
                buffers[0].dwStatus & (MFT_OUTPUT_DATA_BUFFER_INCOMPLETE.0 as u32) != 0;

            match result {
                Ok(()) => {}
                Err(e) if e.code() == MF_E_TRANSFORM_NEED_MORE_INPUT => return,
                Err(e) => {
                    log::warn!("[MftEncoder] ProcessOutput error: {e}");
                    return;
                }
            }

            if let Some(sample) = sample.as_ref() {
                match extract_sample_bytes(sample) {
                    Ok(raw) if !raw.is_empty() => self.send_encoded(ensure_annexb(&raw)),
                    Ok(_) => {}
                    Err(e) => log::warn!("[MftEncoder] Extract sample error: {e}"),
                }
            }

            if !incomplete {
                return;
            }
        }
    }

    fn send_encoded(&mut self, annexb: Vec<u8>) {
        use tokio::sync::mpsc::error::TrySendError;
        self.stats.encoded_frames.fetch_add(1, Ordering::Relaxed);
        match self.output_tx.try_send(annexb) {
            Ok(()) => {}
            Err(TrySendError::Full(_)) => {
                // The writer is behind. Dropping an H.264 frame breaks the
                // reference chain, so count it and start a fresh GOP.
                self.stats.dropped_frames.fetch_add(1, Ordering::Relaxed);
                self.want_keyframe = true;
                if !self.output_drop_logged {
                    self.output_drop_logged = true;
                    log::warn!(
                        "[MftEncoder] encoded-frame queue full; dropping and forcing a keyframe"
                    );
                }
            }
            Err(TrySendError::Closed(_)) => {}
        }
    }

    /// End the stream and shut the MFT down, which also cancels the pending
    /// `BeginGetEvent` (its callback receives `MF_E_SHUTDOWN`).
    fn shutdown(&mut self) {
        self.held = None;
        unsafe {
            let _ = self.mft.ProcessMessage(MFT_MESSAGE_NOTIFY_END_OF_STREAM, 0);
            let _ = self.mft.ProcessMessage(MFT_MESSAGE_COMMAND_FLUSH, 0);
            if let Ok(shutdown) = self.mft.cast::<IMFShutdown>() {
                let _ = shutdown.Shutdown();
            }
        }
    }
}

/// Fused GPU convert + downscale of `frame` into a pooled NV12 slot, then
/// `ProcessInput`. Returns `Ok(false)` when the GPU completion wait timed out
/// (the frame is skipped, not an encoder error).
#[allow(clippy::too_many_arguments)]
fn process_input_frame(
    encoder_mft: &IMFTransform,
    vp: &mut VideoProcessor,
    completion_signal: &mut GpuCompletionSignal,
    d3d: &D3dDevice,
    frame: &CapturedFrame,
    pts: i64,
    duration_hns: i64,
    stats: &NativeShareStats,
) -> WinResult<bool> {
    unsafe {
        let sample: IMFSample = MFCreateSample()?;
        sample.SetSampleTime(pts)?;
        sample.SetSampleDuration(duration_hns)?;

        let fused_start = Instant::now();

        // Acquire the NV12 destination slot from the rotating ring, or fall
        // back to the single retained texture if the ring is unavailable
        // (Req 3.4).
        let slot_idx = match vp.nv12_ring.as_mut() {
            Some(ring) => ring.acquire_rotating(),
            None => None,
        };
        let (output_view, nv12_tex): (ID3D11VideoProcessorOutputView, ID3D11Texture2D) =
            match slot_idx.zip(vp.nv12_ring.as_ref()) {
                Some((i, ring)) => {
                    let slot = ring
                        .ring
                        .get(i)
                        .expect("just-acquired NV12 slot must exist");
                    (slot.output_view.clone(), slot.texture.clone())
                }
                None => (vp.fallback_view.clone(), vp.fallback_tex.clone()),
            };

        // ── Immediate_Context critical section START (Req 4.2) ──
        // `convert_into` records the single fused VideoProcessorBlt; the
        // completion signal below closes out this frame's GPU recording.
        vp.convert_into(
            &frame.texture,
            (frame.width, frame.height),
            &output_view,
            d3d,
        )
        .map_err(|e| {
            log::warn!("[MftEncoder] VP convert_into failed: {e}");
            e
        })?;
        completion_signal.signal(&d3d.context);
        // ── Immediate_Context critical section END (Req 4.2) ──

        // Wait (outside the critical section) until the GPU has finished
        // reading the source, so the caller may release the frame safely.
        if completion_signal.is_active() && !completion_signal.wait(&d3d.context) {
            stats.encode_errors.fetch_add(1, Ordering::Relaxed);
            log::warn!(
                "[MftEncoder] GPU completion signal timed out (path={}); dropping frame",
                completion_signal.path_name()
            );
            return Ok(false);
        }
        stats.record_fused_gpu_ns(fused_start.elapsed().as_nanos() as u64);

        let buffer: IMFMediaBuffer =
            MFCreateDXGISurfaceBuffer(&ID3D11Texture2D::IID, &nv12_tex, 0, false).map_err(|e| {
                log::warn!("[MftEncoder] MFCreateDXGISurfaceBuffer failed: {e}");
                e
            })?;
        sample.AddBuffer(&buffer)?;

        let submit_start = Instant::now();
        encoder_mft.ProcessInput(0, &sample, 0)?;
        stats.record_encode_submit_ns(submit_start.elapsed().as_nanos() as u64);

        // The NV12 slot stays in use until the ring rotation releases it on a
        // future acquire (Req 3.9).
        log::trace!("[MftEncoder] ProcessInput ok pts={pts}");
        stats.captured_frames.fetch_add(1, Ordering::Relaxed);
        Ok(true)
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
    /// Lazily-created intermediate texture used to **normalize** a foreign
    /// shared surface (the Game_Capture_Hook's `OpenSharedResource` alias)
    /// before the VideoProcessor reads it. A texture opened from another
    /// device's shared handle — created by OBS with
    /// `BIND_SHADER_RESOURCE | MISC_SHARED` and possibly a typeless/SRGB-aliased
    /// format — is frequently rejected by `CreateVideoProcessorInputView` /
    /// `VideoProcessorBlt` with `E_INVALIDARG (0x80070057)`. A single
    /// same-device `CopyResource` into this owned, VP-friendly texture (typed
    /// format, `BIND_SHADER_RESOURCE`, no shared flag) sidesteps that without a
    /// CPU readback. Allocated on first use and recreated only if the source
    /// dimensions/format change. `None` until the first hook frame; the WGC
    /// path never touches it (its frames are already VP-compatible).
    normalize_tex: Option<ID3D11Texture2D>,
    /// The `(width, height, format)` the cached [`normalize_tex`] was created
    /// with, so it is reused across frames and only reallocated on change.
    normalize_desc: Option<(u32, u32, i32)>,
}

unsafe impl Send for VideoProcessor {}

/// Map a DXGI format to a fully-typed, non-SRGB `_UNORM` format suitable as a
/// `VideoProcessor` input. Foreign shared surfaces can be typeless or SRGB
/// (OBS applies `apply_dxgi_format_typeless` when `allow_srgb_alias` is set);
/// the VP wants a concrete UNORM type. Unknown formats pass through unchanged.
fn coerce_vp_input_format(
    format: windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT,
) -> windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT {
    use windows::Win32::Graphics::Dxgi::Common::*;
    match format {
        DXGI_FORMAT_B8G8R8A8_TYPELESS | DXGI_FORMAT_B8G8R8A8_UNORM_SRGB => {
            DXGI_FORMAT_B8G8R8A8_UNORM
        }
        DXGI_FORMAT_R8G8B8A8_TYPELESS | DXGI_FORMAT_R8G8B8A8_UNORM_SRGB => {
            DXGI_FORMAT_R8G8B8A8_UNORM
        }
        other => other,
    }
}

/// Number of NV12 ring slots (Req 3.3 mandates "exactly 2 or 3"). Three gives a
/// little pipelining headroom so NVENC can still be reading slot N while the
/// next blit targets slot N+1.
const NV12_RING_SLOTS: usize = 3;

/// VideoProcessor content descriptor for `src` → `dst` (both aligned for NV12:
/// 16-wide, 2-tall).
fn vp_content_desc(src: (u32, u32), dst: (u32, u32)) -> D3D11_VIDEO_PROCESSOR_CONTENT_DESC {
    let rate = windows::Win32::Graphics::Dxgi::Common::DXGI_RATIONAL {
        Numerator: 30,
        Denominator: 1,
    };
    D3D11_VIDEO_PROCESSOR_CONTENT_DESC {
        InputFrameFormat: D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE,
        InputWidth: (src.0 + 15) & !15,
        InputHeight: (src.1 + 1) & !1,
        OutputWidth: (dst.0 + 15) & !15,
        OutputHeight: (dst.1 + 1) & !1,
        Usage: D3D11_VIDEO_USAGE_OPTIMAL_SPEED,
        InputFrameRate: rate,
        OutputFrameRate: rate,
    }
}

impl VideoProcessor {
    /// Create a video processor that scales from `src_w×src_h` (native capture)
    /// to `dst_w×dst_h` (target encode resolution) while converting BGRA→NV12.
    fn new(d3d: &D3dDevice, src_w: u32, src_h: u32, dst_w: u32, dst_h: u32) -> WinResult<Self> {
        unsafe {
            let video_dev: ID3D11VideoDevice = d3d.device.cast()?;
            let video_ctx: ID3D11VideoContext = d3d.context.cast()?;

            let aligned_src_w = (src_w + 15) & !15;
            let aligned_src_h = (src_h + 1) & !1;
            let aligned_dst_w = (dst_w + 15) & !15;
            let aligned_dst_h = (dst_h + 1) & !1;
            let content_desc = vp_content_desc((src_w, src_h), (dst_w, dst_h));
            let vp_enum = video_dev
                .CreateVideoProcessorEnumerator(&content_desc)
                .map_err(|e| {
                    log::error!("[VP] CreateVideoProcessorEnumerator failed: {e}");
                    e
                })?;
            let vp = video_dev.CreateVideoProcessor(&vp_enum, 0).map_err(|e| {
                log::error!("[VP] CreateVideoProcessor failed: {e}");
                e
            })?;

            // Fallback single NV12 destination (Req 3.4).
            let fallback_slot =
                Self::create_nv12_slot(d3d, &video_dev, &vp_enum, aligned_dst_w, aligned_dst_h)
                    .map_err(|e| {
                        log::error!("[VP] fallback NV12 slot failed: {e}");
                        e
                    })?;
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
                src_width: src_w,
                src_height: src_h,
                dst_width: dst_w,
                dst_height: dst_h,
                normalize_tex: None,
                normalize_desc: None,
            })
        }
    }

    /// Rebuild the processor for a new source size and/or encode size (a live
    /// quality switch or a resized capture source) WITHOUT recreating the
    /// device, video context, or encoder thread. Recreates the VP enumerator +
    /// processor (their content descriptor pins both sizes), the fallback NV12
    /// slot, and the NV12 ring.
    ///
    /// The new resources are built before `self` is touched, so a failure
    /// leaves the processor intact and the caller keeps encoding at the old
    /// configuration.
    fn reconfigure(&mut self, d3d: &D3dDevice, src: (u32, u32), dst: (u32, u32)) -> WinResult<()> {
        if src == (self.src_width, self.src_height) && dst == (self.dst_width, self.dst_height) {
            return Ok(());
        }
        unsafe {
            let aligned_dst_w = (dst.0 + 15) & !15;
            let aligned_dst_h = (dst.1 + 1) & !1;
            let content_desc = vp_content_desc(src, dst);
            let new_enum = self
                .video_dev
                .CreateVideoProcessorEnumerator(&content_desc)?;
            let new_vp = self.video_dev.CreateVideoProcessor(&new_enum, 0)?;
            let fallback = Self::create_nv12_slot(
                d3d,
                &self.video_dev,
                &new_enum,
                aligned_dst_w,
                aligned_dst_h,
            )?;
            let new_ring = Self::allocate_ring(
                d3d,
                &self.video_dev,
                &new_enum,
                aligned_dst_w,
                aligned_dst_h,
                NV12_RING_SLOTS,
            )
            .ok();

            // Commit: replacing the fields drops the old COM objects.
            self.vp = new_vp;
            self.vp_enum = new_enum;
            self.fallback_tex = fallback.texture;
            self.fallback_view = fallback.output_view;
            self.nv12_ring = new_ring;
            self.src_width = src.0;
            self.src_height = src.1;
            self.dst_width = dst.0;
            self.dst_height = dst.1;

            log::info!(
                "[VP] reconfigured src={}x{} dst={}x{} (aligned dst {}x{})",
                src.0,
                src.1,
                dst.0,
                dst.1,
                aligned_dst_w,
                aligned_dst_h,
            );
            Ok(())
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
                SampleDesc: DXGI_SAMPLE_DESC {
                    Count: 1,
                    Quality: 0,
                },
                Usage: D3D11_USAGE_DEFAULT,
                BindFlags: (D3D11_BIND_RENDER_TARGET.0 | D3D11_BIND_VIDEO_ENCODER.0) as u32,
                CPUAccessFlags: 0,
                MiscFlags: D3D11_RESOURCE_MISC_SHARED.0 as u32,
            };
            let mut texture = None;
            d3d.device
                .CreateTexture2D(&nv12_desc, None, Some(&mut texture))
                .map_err(|e| {
                    log::error!("[VP] CreateTexture2D(NV12) failed: {e}");
                    e
                })?;
            let texture = texture.unwrap();

            let output_view_desc = D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC {
                ViewDimension: D3D11_VPOV_DIMENSION_TEXTURE2D,
                Anonymous: D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC_0 {
                    Texture2D: D3D11_TEX2D_VPOV { MipSlice: 0 },
                },
            };
            let mut output_view = None;
            video_dev
                .CreateVideoProcessorOutputView(
                    &texture,
                    vp_enum,
                    &output_view_desc,
                    Some(&mut output_view),
                )
                .map_err(|e| {
                    log::error!("[VP] CreateVideoProcessorOutputView failed: {e}");
                    e
                })?;
            let output_view = output_view.unwrap();

            Ok(Nv12Slot {
                texture,
                output_view,
            })
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
        &mut self,
        src: &ID3D11Texture2D,
        content: (u32, u32),
        output_view: &ID3D11VideoProcessorOutputView,
        d3d: &D3dDevice,
    ) -> WinResult<()> {
        unsafe {
            let mut src_desc = D3D11_TEXTURE2D_DESC::default();
            src.GetDesc(&mut src_desc);

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

            // Create an input view for `src` directly. A WGC frame is already a
            // VP-compatible BGRA render target, so this succeeds on the first
            // try. A foreign Game_Capture_Hook shared surface (opened from the
            // game's device via OpenSharedResource, created by OBS with
            // BIND_SHADER_RESOURCE | MISC_SHARED and possibly a typeless/SRGB
            // format) is often rejected here with E_INVALIDARG — in that case we
            // normalize it with one same-device CopyResource into an owned,
            // VP-friendly texture and build the input view from that instead.
            let mut input_view = None;
            let direct = self.video_dev.CreateVideoProcessorInputView(
                src,
                &self.vp_enum,
                &input_view_desc,
                Some(&mut input_view),
            );

            let input_view = match direct {
                Ok(()) => input_view.unwrap(),
                Err(e) => {
                    // Normalize the foreign surface and retry once. Any failure
                    // in the normalize path surfaces the ORIGINAL error context
                    // so the log pinpoints the cause rather than a generic blit
                    // failure.
                    let normalized = self.normalize_source(d3d, src).map_err(|ne| {
                        log::warn!(
                            "[VP] direct input view failed ({e}); normalize copy also failed ({ne})"
                        );
                        ne
                    })?;
                    let mut nv = None;
                    self.video_dev
                        .CreateVideoProcessorInputView(
                            &normalized,
                            &self.vp_enum,
                            &input_view_desc,
                            Some(&mut nv),
                        )
                        .map_err(|ne| {
                            log::warn!(
                                "[VP] input view failed for normalized surface too: \
                                 direct={e}, normalized={ne}"
                            );
                            ne
                        })?;
                    nv.unwrap()
                }
            };

            // Source rect = the frame's content rect, clipped to the texture.
            // WGC reports the window's live ContentSize, which can be smaller
            // than the pool texture while a resize is in flight (the rest of the
            // texture is stale), and can be odd (for example 1115x628). Never
            // overrun the real texture: that makes VideoProcessorBlt fail with
            // E_INVALIDARG.
            let src_rect = windows::Win32::Foundation::RECT {
                left: 0,
                top: 0,
                right: content.0.min(src_desc.Width).max(1) as i32,
                bottom: content.1.min(src_desc.Height).max(1) as i32,
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
            self.video_ctx
                .VideoProcessorSetStreamSourceRect(&self.vp, 0, true, Some(&src_rect));
            // Stream dest = target size (hardware downscale).
            self.video_ctx
                .VideoProcessorSetStreamDestRect(&self.vp, 0, true, Some(&dst_rect));
            // Output target = destination size.
            self.video_ctx
                .VideoProcessorSetOutputTargetRect(&self.vp, true, Some(&dst_rect));

            // SAFETY: We borrow `stream` without moving it (from_raw_parts), so
            // pInputSurface is still accessible for the explicit ManuallyDrop::drop
            // afterwards. This releases the COM ref every frame, preventing leaks.
            let result = self.video_ctx.VideoProcessorBlt(
                &self.vp,
                output_view,
                0,
                std::slice::from_raw_parts(&stream, 1),
            );

            // Explicitly release the input view COM ref to prevent per-frame leaks.
            // ManuallyDrop::drop() calls the destructor without moving the value.
            // SAFETY: stream is still valid here (not moved); this is the only drop.
            std::mem::ManuallyDrop::drop(&mut stream.pInputSurface);

            result?;
            Ok(())
        }
    }

    /// Normalize a foreign shared surface into an owned, VideoProcessor-friendly
    /// texture via a single same-device `CopyResource`, returning a clone of the
    /// cached destination.
    ///
    /// The Game_Capture_Hook hands us a texture aliased from the game's device
    /// through `OpenSharedResource`. OBS creates that surface with only
    /// `BIND_SHADER_RESOURCE | D3D11_RESOURCE_MISC_SHARED` (and, with SRGB
    /// aliasing, a *typeless* format). A D3D11 VideoProcessor input view requires
    /// the texture to be created with `BIND_RENDER_TARGET` (this is what a WGC
    /// frame — which works — carries), so a view over the bare shared surface
    /// fails with `E_INVALIDARG`. Copying it once into a texture WE create with
    /// the **same bind flags a WGC frame uses** (`RENDER_TARGET | SHADER_RESOURCE`),
    /// a concrete `_UNORM` format, and no shared flag produces a VP-compatible
    /// input. The copy is GPU→GPU on the `Shared_D3D_Device` (no CPU readback).
    ///
    /// `CopyResource` requires identical formats, so the destination keeps the
    /// source's channel order (RGBA stays RGBA, BGRA stays BGRA); only typeless/
    /// SRGB formats are coerced to their plain `_UNORM` typed form, which is
    /// copy-compatible. The D3D11 VideoProcessor accepts both RGBA and BGRA
    /// inputs and applies the correct color conversion to NV12 either way.
    ///
    /// The destination is cached and reused across frames; it is reallocated
    /// only when the source `(width, height, format)` changes (e.g. a swapchain
    /// resize). The `CopyResource` is recorded on the shared `Immediate_Context`
    /// inside the caller's existing bounded critical section.
    fn normalize_source(
        &mut self,
        d3d: &D3dDevice,
        src: &ID3D11Texture2D,
    ) -> WinResult<ID3D11Texture2D> {
        unsafe {
            let mut desc = D3D11_TEXTURE2D_DESC::default();
            src.GetDesc(&mut desc);
            let coerced = coerce_vp_input_format(desc.Format);
            let key = (desc.Width, desc.Height, coerced.0);

            // One-time diagnostic of exactly what the hook handed us, so a
            // residual VP rejection points at the real cause (format vs bind
            // flags) rather than a generic E_INVALIDARG.
            if self.normalize_desc != Some(key) {
                log::info!(
                    "[VP] hook surface desc: fmt={:?} bind=0x{:x} misc=0x{:x} usage={:?} {}x{}",
                    desc.Format,
                    desc.BindFlags,
                    desc.MiscFlags,
                    desc.Usage.0,
                    desc.Width,
                    desc.Height
                );
            }

            // (Re)allocate the cached normalize texture only on first use or a
            // source dimension/format change.
            if self.normalize_desc != Some(key) || self.normalize_tex.is_none() {
                let norm_desc = D3D11_TEXTURE2D_DESC {
                    Width: desc.Width,
                    Height: desc.Height,
                    MipLevels: 1,
                    ArraySize: 1,
                    Format: coerced,
                    SampleDesc: windows::Win32::Graphics::Dxgi::Common::DXGI_SAMPLE_DESC {
                        Count: 1,
                        Quality: 0,
                    },
                    Usage: D3D11_USAGE_DEFAULT,
                    // Match what a WGC frame carries — RENDER_TARGET is the flag a
                    // D3D11 VideoProcessor input view requires; SHADER_RESOURCE
                    // rounds it out. Without RENDER_TARGET the input view creation
                    // fails with E_INVALIDARG even after the copy.
                    BindFlags: (D3D11_BIND_RENDER_TARGET.0 | D3D11_BIND_SHADER_RESOURCE.0) as u32,
                    CPUAccessFlags: 0,
                    MiscFlags: 0,
                };
                let mut tex = None;
                d3d.device
                    .CreateTexture2D(&norm_desc, None, Some(&mut tex))
                    .map_err(|e| {
                        log::warn!(
                            "[VP] normalize texture create failed ({}x{}, fmt {:?} -> {:?}): {e}",
                            desc.Width,
                            desc.Height,
                            desc.Format,
                            coerced
                        );
                        e
                    })?;
                self.normalize_tex = Some(tex.unwrap());
                self.normalize_desc = Some(key);
                log::info!(
                    "[VP] normalizing hook surface via same-device copy: {}x{} fmt {:?} -> {:?}",
                    desc.Width,
                    desc.Height,
                    desc.Format,
                    coerced
                );
            }

            let dst = self.normalize_tex.as_ref().expect("normalize_tex just set");
            // GPU→GPU copy on the shared device; no CPU readback.
            d3d.context.CopyResource(dst, src);
            Ok(dst.clone())
        }
    }
}

// ── Annex-B normalisation ──────────────────────────────────────────────────

fn ensure_annexb(data: &[u8]) -> Vec<u8> {
    if data.len() >= 4 && (data.starts_with(&[0, 0, 0, 1]) || data.starts_with(&[0, 0, 1])) {
        return data.to_vec();
    }

    // Assume AVCC: [4-byte big-endian NAL length][NAL data]...
    let mut out = Vec::with_capacity(data.len() + 16);
    let mut i = 0usize;
    while i + 4 <= data.len() {
        let nal_len = u32::from_be_bytes([data[i], data[i + 1], data[i + 2], data[i + 3]]) as usize;
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

// ── ICodecAPI helpers: low-latency config, live bitrate, force keyframe ──────
//
// These drive Phase-1 of the streaming-quality spec. They are all best-effort:
// a hardware encoder MFT that does not implement `ICodecAPI` or a specific
// property returns an error which we log and ignore, so the session never fails
// because a tuning knob is unsupported.

/// Build a `u32`-valued `VARIANT` (`VT_UI4`) for an `ICodecAPI::SetValue` call.
#[cfg(feature = "native-screen-share")]
unsafe fn variant_u32(value: u32) -> windows::Win32::System::Variant::VARIANT {
    use windows::Win32::System::Variant::{VARIANT, VARIANT_0, VARIANT_0_0, VARIANT_0_0_0, VT_UI4};
    let mut v = VARIANT::default();
    // Construct the VT_UI4 variant by writing the tagged union fields directly.
    let val_0_0 = VARIANT_0_0 {
        vt: VT_UI4,
        wReserved1: 0,
        wReserved2: 0,
        wReserved3: 0,
        Anonymous: VARIANT_0_0_0 { ulVal: value },
    };
    v.Anonymous = VARIANT_0 {
        Anonymous: std::mem::ManuallyDrop::new(val_0_0),
    };
    v
}

/// Build a boolean `VARIANT` (`VT_BOOL`) for `ICodecAPI::SetValue`.
#[cfg(feature = "native-screen-share")]
unsafe fn variant_bool(value: bool) -> windows::Win32::System::Variant::VARIANT {
    use windows::Win32::Foundation::{VARIANT_FALSE, VARIANT_TRUE};
    use windows::Win32::System::Variant::{
        VARIANT, VARIANT_0, VARIANT_0_0, VARIANT_0_0_0, VT_BOOL,
    };
    let mut v = VARIANT::default();
    let val_0_0 = VARIANT_0_0 {
        vt: VT_BOOL,
        wReserved1: 0,
        wReserved2: 0,
        wReserved3: 0,
        Anonymous: VARIANT_0_0_0 {
            boolVal: if value { VARIANT_TRUE } else { VARIANT_FALSE },
        },
    };
    v.Anonymous = VARIANT_0 {
        Anonymous: std::mem::ManuallyDrop::new(val_0_0),
    };
    v
}

/// Apply low-latency rate-control + bounded-GOP tuning to a hardware encoder via
/// `ICodecAPI` (Req 1.1, 1.2). Each knob is best-effort: an `E_NOTIMPL` (or any
/// failure) on one property is logged and skipped, never failing the session
/// (Req 1.3). Logs the exact set of knobs that applied so a log reader can
/// verify low-latency mode is active.
///
/// `fps` sets a ~1-second GOP (keyframe interval) so PLI-driven keyframes
/// dominate steady state while bounding the worst-case late-joiner wait.
#[cfg(feature = "native-screen-share")]
unsafe fn configure_low_latency(encoder_mft: &IMFTransform, fps: u32) {
    use windows::Win32::Media::MediaFoundation::{
        eAVEncCommonRateControlMode_LowDelayVBR, CODECAPI_AVEncCommonRateControlMode,
        CODECAPI_AVLowLatencyMode, ICodecAPI,
    };

    let codec_api: ICodecAPI = match encoder_mft.cast() {
        Ok(c) => c,
        Err(e) => {
            log::info!(
                "[MftEncoder] encoder does not expose ICodecAPI ({e}); \
                 low-latency tuning skipped (default config)"
            );
            return;
        }
    };

    let mut applied: Vec<&'static str> = Vec::new();

    // Low-latency mode: emit each frame ASAP (disables B-frames / lookahead).
    {
        let val = variant_bool(true);
        let r = codec_api.SetValue(&CODECAPI_AVLowLatencyMode, &val);
        if r.is_ok() {
            applied.push("AVLowLatencyMode=true");
        } else {
            log::info!("[MftEncoder] AVLowLatencyMode unsupported: {:?}", r);
        }
    }

    // Low-delay VBR rate control (screen content; no multi-frame lookahead).
    {
        let val = variant_u32(eAVEncCommonRateControlMode_LowDelayVBR.0 as u32);
        let r = codec_api.SetValue(&CODECAPI_AVEncCommonRateControlMode, &val);
        if r.is_ok() {
            applied.push("RateControlMode=LowDelayVBR");
        } else {
            log::info!(
                "[MftEncoder] AVEncCommonRateControlMode unsupported: {:?}",
                r
            );
        }
    }

    // Bounded GOP (~1s). Keeps late-joiner / recovery keyframes bounded while
    // letting on-demand PLI keyframes carry steady-state recovery.
    if set_gop_size(encoder_mft, fps) {
        applied.push("GOPSize=fps(~1s)");
    }

    log::info!(
        "[MftEncoder] low-latency config applied: [{}]",
        applied.join(", ")
    );
}

/// Force the encoder to emit a keyframe (IDR) on the next frame via `ICodecAPI`
/// `CODECAPI_AVEncVideoForceKeyFrame` (Req 2.1, 2.2). Best-effort.
#[cfg(feature = "native-screen-share")]
unsafe fn force_keyframe(encoder_mft: &IMFTransform) {
    use windows::Win32::Media::MediaFoundation::{CODECAPI_AVEncVideoForceKeyFrame, ICodecAPI};
    let codec_api: ICodecAPI = match encoder_mft.cast() {
        Ok(c) => c,
        Err(e) => {
            log::warn!("[MftEncoder] force_keyframe: encoder has no ICodecAPI ({e})");
            return;
        }
    };
    let val = variant_u32(1);
    match codec_api.SetValue(&CODECAPI_AVEncVideoForceKeyFrame, &val) {
        Ok(()) => log::info!("[MftEncoder] forced keyframe (IDR) on next frame"),
        Err(e) => log::warn!("[MftEncoder] force keyframe failed: {e}"),
    }
}

/// Set a ~1 s GOP (`fps` frames) via `CODECAPI_AVEncMPVGOPSize`. Called at init
/// and again after every fps change so the keyframe interval follows the frame
/// rate. Best-effort; returns whether the encoder accepted it.
#[cfg(feature = "native-screen-share")]
unsafe fn set_gop_size(encoder_mft: &IMFTransform, fps: u32) -> bool {
    use windows::Win32::Media::MediaFoundation::{CODECAPI_AVEncMPVGOPSize, ICodecAPI};
    let Ok(codec_api) = encoder_mft.cast::<ICodecAPI>() else {
        return false;
    };
    let val = variant_u32(fps.max(1));
    match codec_api.SetValue(&CODECAPI_AVEncMPVGOPSize, &val) {
        Ok(()) => true,
        Err(e) => {
            log::info!("[MftEncoder] AVEncMPVGOPSize unsupported: {e}");
            false
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

// ── Unit tests for the pure Encoder_Selection layer (task 8.1) ────────────────

#[cfg(test)]
mod encoder_selection_tests {
    use super::*;

    fn cand(backend: EncoderBackend, name: &str, is_hardware: bool) -> EncoderCandidate {
        EncoderCandidate {
            backend,
            friendly_name: name.to_string(),
            is_hardware,
        }
    }

    #[test]
    fn empty_slice_selects_software() {
        // Req 6.3: never fail to pick — no candidates means software fallback.
        assert_eq!(select_encoder(&[]), EncoderBackend::Software);
    }

    #[test]
    fn vendor_hw_preferred_over_generic_and_software() {
        // Req 6.1/6.2/6.3: vendor HW > generic HW > software.
        let candidates = [
            cand(EncoderBackend::Software, "Software H264", false),
            cand(EncoderBackend::GenericHwMft, "Some HW MFT", true),
            cand(EncoderBackend::QuickSync, "Intel QuickSync", true),
        ];
        assert_eq!(select_encoder(&candidates), EncoderBackend::QuickSync);
    }

    #[test]
    fn generic_hw_preferred_over_software() {
        // Req 6.2: a generic hardware MFT beats the software encoder.
        let candidates = [
            cand(EncoderBackend::Software, "Software H264", false),
            cand(EncoderBackend::GenericHwMft, "Some HW MFT", true),
        ];
        assert_eq!(select_encoder(&candidates), EncoderBackend::GenericHwMft);
    }

    #[test]
    fn vendor_tiebreak_is_fixed_priority_nvenc_amf_quicksync() {
        // Among multiple vendor-HW candidates the documented priority is
        // NVENC > AMF > QuickSync regardless of slice order (deterministic).
        let candidates = [
            cand(EncoderBackend::QuickSync, "Intel", true),
            cand(EncoderBackend::Amf, "AMD", true),
            cand(EncoderBackend::Nvenc, "NVIDIA", true),
        ];
        assert_eq!(select_encoder(&candidates), EncoderBackend::Nvenc);

        let amd_vs_intel = [
            cand(EncoderBackend::QuickSync, "Intel", true),
            cand(EncoderBackend::Amf, "AMD", true),
        ];
        assert_eq!(select_encoder(&amd_vs_intel), EncoderBackend::Amf);
    }

    #[test]
    fn selection_is_order_independent() {
        // Deterministic: reordering the same candidates yields the same choice.
        let a = [
            cand(EncoderBackend::Nvenc, "NVIDIA", true),
            cand(EncoderBackend::GenericHwMft, "HW", true),
            cand(EncoderBackend::Software, "SW", false),
        ];
        let b = [
            cand(EncoderBackend::Software, "SW", false),
            cand(EncoderBackend::GenericHwMft, "HW", true),
            cand(EncoderBackend::Nvenc, "NVIDIA", true),
        ];
        assert_eq!(select_encoder(&a), select_encoder(&b));
        assert_eq!(select_encoder(&a), EncoderBackend::Nvenc);
    }

    #[test]
    fn classify_non_hardware_is_software() {
        // Req 6.3: a non-hardware MFT is always software, even with a vendor id.
        assert_eq!(
            classify_mft("NVIDIA H.264 Encoder", Some(0x10DE), false),
            EncoderBackend::Software
        );
    }

    #[test]
    fn classify_by_vendor_id() {
        // Req 6.1: authoritative PCI vendor id classification.
        assert_eq!(classify_mft("", Some(0x10DE), true), EncoderBackend::Nvenc);
        assert_eq!(classify_mft("", Some(0x1002), true), EncoderBackend::Amf);
        assert_eq!(
            classify_mft("", Some(0x8086), true),
            EncoderBackend::QuickSync
        );
    }

    #[test]
    fn classify_by_friendly_name_when_no_vendor_id() {
        assert_eq!(
            classify_mft("NVIDIA H.264 Encoder MFT", None, true),
            EncoderBackend::Nvenc
        );
        assert_eq!(
            classify_mft("AMD Radeon AMF H.264 Encoder", None, true),
            EncoderBackend::Amf
        );
        assert_eq!(
            classify_mft("Intel® Quick Sync Video H.264 Encoder", None, true),
            EncoderBackend::QuickSync
        );
    }

    #[test]
    fn classify_unknown_hardware_is_generic() {
        // Req 6.2: a hardware MFT of unknown vendor is a usable generic HW MFT.
        assert_eq!(
            classify_mft("Acme Mystery Encoder", None, true),
            EncoderBackend::GenericHwMft
        );
        assert_eq!(
            classify_mft("Some Encoder", Some(0xBEEF), true),
            EncoderBackend::GenericHwMft
        );
    }

    #[test]
    fn vendor_id_takes_precedence_over_friendly_name() {
        // A vendor id wins even if the name suggests a different vendor.
        assert_eq!(
            classify_mft("Intel QuickSync", Some(0x10DE), true),
            EncoderBackend::Nvenc
        );
    }

    #[test]
    fn backend_as_str_is_stable() {
        // Req 6.5: status contract strings consumed by task 9.1.
        assert_eq!(EncoderBackend::Nvenc.as_str(), "nvenc");
        assert_eq!(EncoderBackend::Amf.as_str(), "amf");
        assert_eq!(EncoderBackend::QuickSync.as_str(), "quicksync");
        assert_eq!(EncoderBackend::GenericHwMft.as_str(), "generic_hw");
        assert_eq!(EncoderBackend::Software.as_str(), "software");
    }
}
