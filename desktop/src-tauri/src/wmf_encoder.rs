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
    /// Last-resort CPU encoder, used when no hardware backend is available
    /// rather than terminating the session (Req 6.3).
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
pub fn classify_mft(friendly_name: &str, vendor_id: Option<u32>, is_hardware: bool) -> EncoderBackend {
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

/// A live, in-place reconfiguration request sent to the running encoder worker
/// so a quality change (resolution / fps / bitrate) is applied WITHOUT tearing
/// down the encoder thread, the WebRTC peer connection, the track, or the live
/// game-capture hook — i.e. seamless quality switching with no re-injection and
/// no SDP renegotiation. Applied at a frame boundary on the encoder thread.
#[derive(Debug, Clone, Copy)]
pub struct EncoderReconfig {
    /// New target encode width (the VP output + MFT output type).
    pub width: u32,
    /// New target encode height.
    pub height: u32,
    /// New target frame rate (fps).
    pub fps: u32,
    /// New target average bitrate (bits/sec).
    pub bitrate: u32,
}

/// A control message applied to the running encoder at a frame boundary on the
/// encoder thread — without tearing down the thread, the WebRTC peer
/// connection, the track, or the live game-capture hook.
///
/// `Reconfig` is the heavyweight path (resolution/fps change ⇒ rebuild the VP
/// output + reset the MFT output type). `SetBitrate` and `RequestKeyframe` are
/// the lightweight Phase-1 additions: a live `ICodecAPI` setter and a one-shot
/// force-IDR, neither of which flushes the MFT or rebuilds the VP. These power
/// adaptive bitrate (no resolution churn) and on-demand keyframes (PLI/FIR
/// recovery, late-joiner resync).
#[derive(Debug, Clone, Copy)]
pub enum EncoderControl {
    /// Full reconfigure: resolution / fps / bitrate (rebuilds VP output + MFT
    /// output type). The seamless quality-switch path.
    Reconfig(EncoderReconfig),
    /// Bitrate-only change (bits/sec) applied live via `ICodecAPI`
    /// `CODECAPI_AVEncCommonMeanBitRate` — no flush, no output-type reset, no
    /// forced keyframe. Drives adaptive bitrate.
    SetBitrate(u32),
    /// Force the encoder to emit a keyframe (IDR) on the next frame, via
    /// `CODECAPI_AVEncVideoForceKeyFrame`. Driven by inbound RTCP PLI/FIR; the
    /// sender debounces so a PLI burst yields at most one IDR per window.
    RequestKeyframe,
}

/// A cloneable, `Send` handle to a running encoder's control channel.
///
/// Lets components that do not own the [`MftEncoderWorker`] (notably the
/// inbound-RTCP reader spawned on the WebRTC peer connection) drive on-demand
/// keyframes and live bitrate changes. All sends are non-blocking and fail
/// silently once the encoder thread has exited (the receiver is dropped), so a
/// late RTCP packet after teardown is harmless.
#[derive(Clone)]
pub struct EncoderControlHandle {
    tx: mpsc::Sender<EncoderControl>,
}

impl EncoderControlHandle {
    /// Request a keyframe (IDR) on the next frame. No-op if the encoder is gone.
    pub fn request_keyframe(&self) {
        let _ = self.tx.send(EncoderControl::RequestKeyframe);
    }

    /// Set the encoder's mean bitrate (bits/sec) live. No-op if the encoder is
    /// gone. Used by the adaptive-bitrate controller (Phase 2).
    pub fn set_bitrate(&self, bitrate_bps: u32) {
        let _ = self.tx.send(EncoderControl::SetBitrate(bitrate_bps));
    }
}

pub struct MftEncoderWorker {
    pub frame_tx: mpsc::SyncSender<CapturedFrame>,
    /// Live reconfiguration channel into the running encoder thread. Carries
    /// [`EncoderControl`] messages (resolution/fps `Reconfig`, live `SetBitrate`,
    /// one-shot `RequestKeyframe`) applied at the next frame boundary — no
    /// thread/PC/track/hook teardown. Dropped on stop.
    control_tx: mpsc::Sender<EncoderControl>,
    stop_flag: Arc<AtomicBool>,
    join: Option<std::thread::JoinHandle<()>>,
    /// The vendor-neutral encoder backend selected for this session
    /// (Req 6.5). Resolved inside the worker thread by [`init_mft`] /
    /// [`select_encoder`] and reported back over the init channel, so the
    /// session/status layer (task 9.1) can surface it through `NativeShareStats`
    /// without reaching into the encoder thread. `selected_backend()` exposes it.
    selected_backend: EncoderBackend,
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
        let (control_tx, control_rx) = mpsc::channel::<EncoderControl>();
        let stop_flag = Arc::new(AtomicBool::new(false));
        let stop_clone = Arc::clone(&stop_flag);

        // One-shot channel: thread sends Ok(EncoderBackend) or Err(msg) to
        // confirm MFT init and report the selected encoder backend (Req 6.5).
        let (init_tx, init_rx) = mpsc::sync_channel::<StdResult<EncoderBackend, String>>(1);

        let join = match std::thread::Builder::new()
            .name("RalphMftEncoder".to_owned())
            .spawn(move || {
                // init_mft runs *inside* the thread — no COM pointers cross the spawn.
                let (encoder_mft, event_gen, provides_samples, backend) =
                    match init_mft(codec, width, height, fps, bitrate, &d3d) {
                        Ok(t) => {
                            let _ = init_tx.send(Ok(t.3));
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
                    "[MftEncoder] Worker started codec={:?} {}x{} fps={fps} bitrate={bitrate} backend={}",
                    codec,
                    width,
                    height,
                    backend.as_str()
                );
                run_encoder_loop(
                    encoder_mft,
                    event_gen,
                    provides_samples,
                    frame_rx,
                    control_rx,
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

        // Wait for MFT init result from the thread, capturing the selected backend.
        let selected_backend = match init_rx.recv() {
            Ok(Ok(backend)) => backend,
            Ok(Err(msg)) => return Err(msg),
            Err(_) => return Err("Encoder thread died before reporting init".into()),
        };

        Ok(Self {
            frame_tx,
            control_tx,
            stop_flag,
            join: Some(join),
            selected_backend,
        })
    }

    /// The vendor-neutral [`EncoderBackend`] chosen for this session (Req 6.5).
    /// Consumed by the session/status layer (task 9.1) to report the active
    /// encoder in `NativeShareStats` / `Capture_Status`.
    pub fn selected_backend(&self) -> EncoderBackend {
        self.selected_backend
    }

    /// Request a live, in-place quality reconfiguration of the running encoder
    /// (resolution / fps / bitrate). The worker applies it at the next frame
    /// boundary by rebuilding its GPU VideoProcessor output + MFT output type
    /// and updating the bitrate — WITHOUT restarting the encoder thread, the
    /// WebRTC peer connection, the track, or the live game-capture hook. This is
    /// what makes a quality switch seamless and zero-restart. Returns an error
    /// only if the encoder thread has already exited.
    pub fn reconfigure(&self, cfg: EncoderReconfig) -> StdResult<(), String> {
        self.control_tx
            .send(EncoderControl::Reconfig(cfg))
            .map_err(|_| "encoder worker thread is no longer running".to_string())
    }

    /// Change the encoder's target average bitrate (bits/sec) live, without
    /// changing resolution, flushing the MFT, or forcing a keyframe. Drives
    /// adaptive bitrate. Returns an error only if the encoder thread has exited.
    pub fn set_bitrate(&self, bitrate_bps: u32) -> StdResult<(), String> {
        self.control_tx
            .send(EncoderControl::SetBitrate(bitrate_bps))
            .map_err(|_| "encoder worker thread is no longer running".to_string())
    }

    /// Request the encoder emit a keyframe (IDR) on the next frame — driven by
    /// inbound RTCP PLI/FIR and late-joiner resync. The encoder thread applies
    /// it via `CODECAPI_AVEncVideoForceKeyFrame`. Callers should debounce bursts.
    /// Returns an error only if the encoder thread has exited.
    pub fn request_keyframe(&self) -> StdResult<(), String> {
        self.control_tx
            .send(EncoderControl::RequestKeyframe)
            .map_err(|_| "encoder worker thread is no longer running".to_string())
    }

    /// A cloneable, `Send` handle to the encoder's control channel, for tasks
    /// that live elsewhere (e.g. the inbound-RTCP reader on the WebRTC PC) and
    /// need to drive keyframes / bitrate without owning the worker.
    pub fn control_handle(&self) -> EncoderControlHandle {
        EncoderControlHandle {
            tx: self.control_tx.clone(),
        }
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

// ── Encoder enumeration + selection wiring (vendor-neutral, task 8.2) ─────────
//
// `init_mft` enumerates the hardware video-encoder MFTs via
// `MFTEnumEx(MFT_CATEGORY_VIDEO_ENCODER, MFT_ENUM_FLAG_HARDWARE | …)`, reads
// each activate's friendly name (`MFT_FRIENDLY_NAME_Attribute`) and vendor id
// (`MFT_ENUM_HARDWARE_VENDOR_ID_Attribute`), classifies it with
// [`classify_mft`], and picks the winner with the pure [`select_encoder`]
// (Req 6.1, 6.2). When no hardware encoder is available, `select_encoder`
// resolves to [`EncoderBackend::Software`] and the encoder enumerates a
// software MFT instead of failing the session (Req 6.3). The chosen MFT is then
// activated and configured, and the selected [`EncoderBackend`] is returned so
// the session/status layer (task 9.1) can report it (Req 6.5).

/// Read an `IMFActivate` allocated-string attribute (e.g.
/// `MFT_FRIENDLY_NAME_Attribute`), freeing the `CoTaskMemAlloc`'d buffer that
/// `GetAllocatedString` hands back. Returns `None` if the attribute is absent.
unsafe fn read_activate_string(activate: &IMFActivate, key: &GUID) -> Option<String> {
    let mut value = PWSTR::null();
    let mut len = 0u32;
    match activate.GetAllocatedString(key, &mut value, &mut len) {
        Ok(()) => {
            let s = value.to_string().ok();
            if !value.is_null() {
                CoTaskMemFree(Some(value.as_ptr() as *const core::ffi::c_void));
            }
            s
        }
        Err(_) => None,
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

/// Build an [`EncoderCandidate`] from one enumerated `IMFActivate` by reading
/// its friendly name + vendor id and classifying it (Req 6.1, 6.2). `is_hardware`
/// reflects the enumeration flag used (`MFT_ENUM_FLAG_HARDWARE` ⇒ `true`).
unsafe fn read_encoder_candidate(activate: &IMFActivate, is_hardware: bool) -> EncoderCandidate {
    let friendly_name =
        read_activate_string(activate, &MFT_FRIENDLY_NAME_Attribute).unwrap_or_default();
    let vendor_id =
        read_activate_string(activate, &MFT_ENUM_HARDWARE_VENDOR_ID_Attribute)
            .and_then(|s| parse_vendor_id(&s));
    let backend = classify_mft(&friendly_name, vendor_id, is_hardware);
    EncoderCandidate {
        backend,
        friendly_name,
        is_hardware,
    }
}

/// Enumerate the video-encoder MFTs (NV12 in → `codec` out) with the given
/// hardware/software flag, taking ownership of each returned `IMFActivate` and
/// freeing the `CoTaskMemAlloc`'d array. An empty result is `Ok(vec![])` (not an
/// error) so the caller can fall back from hardware to software (Req 6.3).
unsafe fn enumerate_encoders(codec: VideoCodec, hardware: bool) -> WinResult<Vec<IMFActivate>> {
    let input = MFT_REGISTER_TYPE_INFO {
        guidMajorType: MFMediaType_Video,
        guidSubtype: MFVideoFormat_NV12,
    };
    let output = MFT_REGISTER_TYPE_INFO {
        guidMajorType: MFMediaType_Video,
        guidSubtype: codec.mf_subtype(),
    };
    // Hardware: enumerate async hardware MFTs. Software: enumerate synchronous
    // software MFTs (the built-in CPU encoder), used only as the last-resort
    // fallback when no hardware encoder is present.
    let base = if hardware {
        MFT_ENUM_FLAG_HARDWARE.0
    } else {
        MFT_ENUM_FLAG_SYNCMFT.0
    };
    let flags = MFT_ENUM_FLAG(base | MFT_ENUM_FLAG_SORTANDFILTER.0);

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

    let mut result = Vec::with_capacity(count as usize);
    if count > 0 && !activates.is_null() {
        for item in slice::from_raw_parts_mut(activates, count as usize) {
            if let Some(a) = item.take() {
                result.push(a);
            }
        }
    }
    CoTaskMemFree(Some(activates as _));
    Ok(result)
}

// ── MFT initialisation ─────────────────────────────────────────────────────

/// Initialise the encoder MFT for `codec`, selecting a vendor-neutral encoder
/// backend (Req 6.1–6.4).
///
/// Returns the activated `IMFTransform`, an optional `IMFMediaEventGenerator`
/// (present for the async hardware MFTs, `None` for a synchronous software MFT),
/// the `provides_samples` flag, and the selected [`EncoderBackend`] (Req 6.5).
/// Hardware MFTs run the existing async, GPU-backed path; the software fallback
/// runs the synchronous, CPU `bgra_to_nv12` path (no D3D manager) so a captured
/// surface is encoded without assuming NVENC (Req 6.4).
fn init_mft(
    codec: VideoCodec,
    width: u32,
    height: u32,
    fps: u32,
    bitrate: u32,
    d3d: &D3dDevice,
) -> WinResult<(IMFTransform, Option<IMFMediaEventGenerator>, bool, EncoderBackend)> {
    unsafe {
        // 1. Enumerate hardware encoders and classify each into a candidate.
        let hw_activates = enumerate_encoders(codec, true)?;
        let hw_candidates: Vec<EncoderCandidate> = hw_activates
            .iter()
            .map(|a| read_encoder_candidate(a, true))
            .collect();
        for c in &hw_candidates {
            log::info!(
                "[MftEncoder] enumerated HW encoder: '{}' → {}",
                c.friendly_name,
                c.backend.as_str()
            );
        }

        // 2. Pure, deterministic selection across the enumerated candidates.
        let selected = select_encoder(&hw_candidates);

        // 3. Resolve the winning activate. A hardware backend is always present
        //    in `hw_candidates` when selected (select_encoder returns the
        //    minimum present rank); `Software` means the hardware list was empty
        //    so we enumerate a software MFT instead (Req 6.3).
        let (activate, backend, use_d3d): (IMFActivate, EncoderBackend, bool) =
            if selected != EncoderBackend::Software {
                let idx = hw_candidates
                    .iter()
                    .position(|c| c.backend == selected)
                    .expect("select_encoder returns a backend present in the candidates");
                (hw_activates[idx].clone(), selected, true)
            } else {
                log::warn!(
                    "[MftEncoder] no hardware encoder available; falling back to software MFT"
                );
                let activate = enumerate_encoders(codec, false)?
                    .into_iter()
                    .next()
                    .ok_or_else(|| Error::from_hresult(HRESULT(0xC00D36B3u32 as i32)))?;
                (activate, EncoderBackend::Software, false)
            };

        log::info!("[MftEncoder] selected encoder backend: {}", backend.as_str());

        let encoder_mft: IMFTransform = activate.ActivateObject()?;

        // 4. Hardware MFTs are async + GPU-backed: unlock async operation and
        //    attach the DXGI device manager. The software MFT is synchronous
        //    and CPU-fed, so neither applies (and attaching a D3D manager to it
        //    would fail).
        if use_d3d {
            if let Ok(attrs) = encoder_mft.GetAttributes() {
                let _ = attrs.SetUINT32(&MF_TRANSFORM_ASYNC_UNLOCK, 1);
            }

            // Attach DXGI device manager for GPU-backed samples.
            encoder_mft.ProcessMessage(
                MFT_MESSAGE_SET_D3D_MANAGER,
                windows::core::Interface::as_raw(&d3d.dxgi_manager) as usize,
            )?;
            log::info!("[MftEncoder] D3D manager attached");
        }

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

        // Low-latency tuning for the hardware encoder (Req 1): low-delay rate
        // control, no B-frames/lookahead, bounded GOP. Best-effort — applied
        // before streaming begins; logs the knobs that took. Skipped for the
        // software MFT (no ICodecAPI / not GPU-backed).
        if use_d3d {
            configure_low_latency(&encoder_mft, fps);
        }

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

        // Async hardware MFTs expose an IMFMediaEventGenerator that drives the
        // METransformNeedInput/HaveOutput pump. A synchronous software MFT does
        // not, so the event generator is optional and the loop falls back to a
        // synchronous ProcessInput/ProcessOutput drive for software (Req 6.4).
        let event_gen: Option<IMFMediaEventGenerator> = encoder_mft.cast().ok();
        if event_gen.is_none() {
            log::info!(
                "[MftEncoder] no event generator (synchronous MFT) — using sync encode drive"
            );
        }
        Ok((encoder_mft, event_gen, provides_samples, backend))
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
        DXGI_FORMAT_B8G8R8A8_TYPELESS | DXGI_FORMAT_B8G8R8A8_UNORM_SRGB => DXGI_FORMAT_B8G8R8A8_UNORM,
        DXGI_FORMAT_R8G8B8A8_TYPELESS | DXGI_FORMAT_R8G8B8A8_UNORM_SRGB => DXGI_FORMAT_R8G8B8A8_UNORM,
        other => other,
    }
}

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
                normalize_tex: None,
                normalize_desc: None,
            })
        }
    }

    /// Rebuild the output side of the processor for a new encode resolution
    /// (a live quality switch) WITHOUT recreating the device, video context, or
    /// tearing down the encoder. Recreates the VP enumerator + processor (their
    /// content descriptor pins the output size), the fallback NV12 slot, and the
    /// NV12 ring at the new dimensions. The source dims are unchanged (the hook/
    /// WGC still delivers the game's native frame); only the scale target moves.
    ///
    /// On success the new resources atomically replace the old ones (the old
    /// COM objects drop here, after the new ones are built, so a failure leaves
    /// the processor fully intact and the caller keeps encoding at the old size).
    fn reconfigure_output(&mut self, d3d: &D3dDevice, dst_w: u32, dst_h: u32) -> WinResult<()> {
        unsafe {
            let aligned_dst_w = (dst_w + 15) & !15;
            let aligned_dst_h = (dst_h + 1) & !1;
            if aligned_dst_w == self.dst_width && aligned_dst_h == self.dst_height {
                return Ok(()); // no resolution change
            }

            let content_desc = D3D11_VIDEO_PROCESSOR_CONTENT_DESC {
                InputFrameFormat: D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE,
                InputWidth: self.src_width,
                InputHeight: self.src_height,
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
            // Build all new resources BEFORE mutating self, so any failure is
            // non-destructive (we return Err and keep encoding at the old size).
            let new_enum = self.video_dev.CreateVideoProcessorEnumerator(&content_desc)?;
            let new_vp = self.video_dev.CreateVideoProcessor(&new_enum, 0)?;
            let fallback =
                Self::create_nv12_slot(d3d, &self.video_dev, &new_enum, aligned_dst_w, aligned_dst_h)?;
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
            self.dst_width = aligned_dst_w;
            self.dst_height = aligned_dst_h;

            log::info!(
                "[VP] reconfigured output to {}x{} (src {}x{} unchanged)",
                aligned_dst_w, aligned_dst_h, self.src_width, self.src_height
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
        &mut self,
        src: &ID3D11Texture2D,
        output_view: &ID3D11VideoProcessorOutputView,
        d3d: &D3dDevice,
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
                    desc.Format, desc.BindFlags, desc.MiscFlags, desc.Usage.0,
                    desc.Width, desc.Height
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
                            desc.Width, desc.Height, desc.Format, coerced
                        );
                        e
                    })?;
                self.normalize_tex = Some(tex.unwrap());
                self.normalize_desc = Some(key);
                log::info!(
                    "[VP] normalizing hook surface via same-device copy: {}x{} fmt {:?} -> {:?}",
                    desc.Width, desc.Height, desc.Format, coerced
                );
            }

            let dst = self
                .normalize_tex
                .as_ref()
                .expect("normalize_tex just set");
            // GPU→GPU copy on the shared device; no CPU readback.
            d3d.context.CopyResource(dst, src);
            Ok(dst.clone())
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
    event_gen: Option<IMFMediaEventGenerator>,
    provides_samples: bool,
    frame_rx: mpsc::Receiver<CapturedFrame>,
    control_rx: mpsc::Receiver<EncoderControl>,
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
    // A synchronous software MFT (no event generator) cannot read a DXGI-backed
    // sample, so the software fallback uses the CPU `bgra_to_nv12` path with
    // system-memory buffers (Req 6.3, 6.4). Hardware (async) MFTs use the GPU
    // VideoProcessor fused-blit path. So when there is no event generator we do
    // not even create the GPU video processor — we go straight to CPU NV12.
    let software = event_gen.is_none();

    // GPU video processor converts BGRA→NV12 AND downscales to the target resolution.
    let mut vp: Option<VideoProcessor> = if software {
        log::info!(
            "[MftEncoder] software encode path active (CPU BGRA→NV12, system-memory samples)"
        );
        None
    } else {
        match VideoProcessor::new(&d3d, src_width, src_height, width, height) {
            Ok(v) => {
                log::info!("[MftEncoder] GPU video processor ready");
                Some(v)
            }
            Err(e) => {
                log::warn!("[MftEncoder] GPU video processor unavailable ({e}), falling back to CPU BGRA→NV12");
                None
            }
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

    // ── Synchronous software MFT drive ───────────────────────────────────────
    // No async event pump: pull a frame, ProcessInput, then drain ProcessOutput
    // until the MFT reports NEED_MORE_INPUT, repeating until stop.
    let Some(event_gen) = event_gen else {
        run_sync_encoder_loop(
            &encoder_mft,
            &mut vp,
            event_query.as_ref(),
            provides_samples,
            frame_rx,
            control_rx,
            output_tx,
            stop_flag,
            stats,
            &d3d,
            duration_hns,
        );
        unsafe {
            let _ = encoder_mft.ProcessMessage(MFT_MESSAGE_NOTIFY_END_OF_STREAM, 0);
            let _ = encoder_mft.ProcessMessage(MFT_MESSAGE_COMMAND_FLUSH, 0);
        }
        return;
    };

    // ── Asynchronous hardware MFT event pump ─────────────────────────────────
    let mut pts: i64 = 0;
    let mut needs_input = false;
    let mut event_log_count = 0u32;
    let frame_wait = std::time::Duration::from_millis(2);
    // Live encode params — mutated in place on a reconfigure (seamless quality
    // switch) so the VP output + MFT output type + frame duration track the new
    // resolution/fps without restarting the thread/PC/track/hook.
    let mut duration_hns = duration_hns;

    loop {
        if stop_flag.load(Ordering::Relaxed) {
            break;
        }

        // Apply any pending encoder control messages at this frame boundary.
        // Drain the channel: collapse repeated Reconfig/SetBitrate to the latest
        // value, but honor a keyframe request if any arrived in the batch.
        let mut pending_reconfig: Option<EncoderReconfig> = None;
        let mut pending_bitrate: Option<u32> = None;
        let mut want_keyframe = false;
        while let Ok(ctrl) = control_rx.try_recv() {
            match ctrl {
                EncoderControl::Reconfig(cfg) => pending_reconfig = Some(cfg),
                EncoderControl::SetBitrate(bps) => pending_bitrate = Some(bps),
                EncoderControl::RequestKeyframe => want_keyframe = true,
            }
        }
        if let Some(cfg) = pending_reconfig {
            match apply_encoder_reconfig(&encoder_mft, &mut vp, &d3d, src_width, src_height, cfg) {
                Ok(()) => {
                    duration_hns = 10_000_000i64 / cfg.fps.max(1) as i64;
                    log::info!(
                        "[MftEncoder] live reconfigure applied: {}x{} fps={} bitrate={}",
                        cfg.width, cfg.height, cfg.fps, cfg.bitrate
                    );
                }
                Err(e) => {
                    log::warn!("[MftEncoder] live reconfigure failed ({e}); keeping prior config");
                }
            }
        } else if let Some(bps) = pending_bitrate {
            // Bitrate-only: a Reconfig already re-set the output bitrate, so only
            // apply a standalone SetBitrate when there was no reconfigure.
            unsafe { set_mean_bitrate(&encoder_mft, bps) };
        }
        if want_keyframe {
            unsafe { force_keyframe(&encoder_mft) };
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

/// Synchronous encode drive for a software MFT (no `IMFMediaEventGenerator`).
///
/// A synchronous MFT does not raise `METransformNeedInput` /
/// `METransformHaveOutput` events, so instead of an event pump we feed one frame
/// at a time with `ProcessInput` and then drain `ProcessOutput` until the MFT
/// reports `MF_E_TRANSFORM_NEED_MORE_INPUT`. This is the last-resort CPU encode
/// path used when no hardware encoder is available (Req 6.3, 6.4); it reuses the
/// shared [`process_input_frame`] (which falls back to CPU `bgra_to_nv12` when
/// `vp` is `None`) and the shared [`drain_output_loop`].
#[allow(clippy::too_many_arguments)]
fn run_sync_encoder_loop(
    encoder_mft: &IMFTransform,
    vp: &mut Option<VideoProcessor>,
    event_query: Option<&ID3D11Query>,
    provides_samples: bool,
    frame_rx: mpsc::Receiver<CapturedFrame>,
    control_rx: mpsc::Receiver<EncoderControl>,
    output_tx: mpsc::SyncSender<Vec<u8>>,
    stop_flag: Arc<AtomicBool>,
    stats: Arc<NativeShareStats>,
    d3d: &D3dDevice,
    duration_hns: i64,
) {
    let mut pts: i64 = 0;
    let mut duration_hns = duration_hns;
    let frame_wait = std::time::Duration::from_millis(5);
    // Software path scales on the CPU; reconfigure needs the native source dims
    // the VP (if any) reads from. They are constant for the session, so capture
    // them from the VP when present (software path usually has no VP).
    let (src_w, src_h) = vp
        .as_ref()
        .map(|v| (v.src_width, v.src_height))
        .unwrap_or((0, 0));

    loop {
        if stop_flag.load(Ordering::Relaxed) {
            break;
        }

        // Apply any pending encoder control messages (latest reconfig/bitrate
        // wins; honor a keyframe request if any arrived in the batch).
        let mut pending_reconfig: Option<EncoderReconfig> = None;
        let mut pending_bitrate: Option<u32> = None;
        let mut want_keyframe = false;
        while let Ok(ctrl) = control_rx.try_recv() {
            match ctrl {
                EncoderControl::Reconfig(cfg) => pending_reconfig = Some(cfg),
                EncoderControl::SetBitrate(bps) => pending_bitrate = Some(bps),
                EncoderControl::RequestKeyframe => want_keyframe = true,
            }
        }
        if let Some(cfg) = pending_reconfig {
            match apply_encoder_reconfig(encoder_mft, vp, d3d, src_w, src_h, cfg) {
                Ok(()) => {
                    duration_hns = 10_000_000i64 / cfg.fps.max(1) as i64;
                    log::info!(
                        "[MftEncoder] (sw) live reconfigure applied: {}x{} fps={} bitrate={}",
                        cfg.width, cfg.height, cfg.fps, cfg.bitrate
                    );
                }
                Err(e) => {
                    log::warn!("[MftEncoder] (sw) live reconfigure failed ({e}); keeping prior config");
                }
            }
        } else if let Some(bps) = pending_bitrate {
            unsafe { set_mean_bitrate(encoder_mft, bps) };
        }
        if want_keyframe {
            unsafe { force_keyframe(encoder_mft) };
        }

        match frame_rx.recv_timeout(frame_wait) {
            Ok(frame) => {
                match process_input_frame(
                    encoder_mft,
                    vp,
                    event_query,
                    d3d,
                    frame,
                    pts,
                    duration_hns,
                    &stats,
                ) {
                    Ok(()) => {
                        pts = pts.saturating_add(duration_hns);
                        // Drain everything the MFT produced for this input.
                        drain_output_loop(encoder_mft, provides_samples, &output_tx, &stats);
                    }
                    Err(e) => {
                        stats.encode_errors.fetch_add(1, Ordering::Relaxed);
                        if stats.encode_errors.load(Ordering::Relaxed) <= 3 {
                            log::warn!("[MftEncoder] (sw) ProcessInput error: {e}");
                        } else if stats.encode_errors.load(Ordering::Relaxed) == 4 {
                            log::warn!("[MftEncoder] (sw) ProcessInput errors suppressed after 3");
                        }
                    }
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
}

/// Apply a live quality reconfiguration (resolution / fps / bitrate) to the
/// running encoder in place — the seamless-quality-switch core. Reconfigures
/// the GPU VideoProcessor output (scale target) and resets the MFT output type
/// (frame size + frame rate + average bitrate) WITHOUT recreating the MFT,
/// device, peer connection, track, or capture source.
///
/// H.264/HEVC carry resolution + parameter sets inline, and the SFU + remote
/// decoders renegotiate from the new keyframe the MFT emits after an output-type
/// change, so no SDP renegotiation is needed. The MFT is flushed before the
/// output type changes so no half-encoded frame straddles the switch; encoding
/// resumes with a fresh IDR at the new size.
///
/// Source dims are intentionally unchanged: the hook/WGC always delivers the
/// game's native frame, and only the downscale target moves — so there is never
/// a second copy or a recapture on a quality switch.
fn apply_encoder_reconfig(
    encoder_mft: &IMFTransform,
    vp: &mut Option<VideoProcessor>,
    d3d: &D3dDevice,
    _src_width: u32,
    _src_height: u32,
    cfg: EncoderReconfig,
) -> WinResult<()> {
    unsafe {
        // 1. Rebuild the VP output (scale target) for the new resolution. The
        //    source side and the shared device/context are untouched.
        if let Some(vp) = vp.as_mut() {
            vp.reconfigure_output(d3d, cfg.width, cfg.height)?;
        }

        // 2. Reset the MFT output type. Read the current output type and clone
        //    its GUIDs, then overwrite frame size / frame rate / bitrate so we
        //    do not depend on the codec subtype being threaded in here. The MFT
        //    must be flushed and the output type re-set while streaming; the
        //    async hardware MFT accepts a SetOutputType after a flush and emits
        //    a new IDR, which the WebRTC track carries without renegotiation.
        let current_out = encoder_mft.GetOutputCurrentType(0)?;
        let subtype = current_out.GetGUID(&MF_MT_SUBTYPE)?;

        encoder_mft.ProcessMessage(MFT_MESSAGE_COMMAND_FLUSH, 0)?;

        let frame_rate_packed = ((cfg.fps as u64) << 32) | 1;
        let frame_size_packed = ((cfg.width as u64) << 32) | (cfg.height as u64);

        let out_type: IMFMediaType = MFCreateMediaType()?;
        out_type.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)?;
        out_type.SetGUID(&MF_MT_SUBTYPE, &subtype)?;
        out_type.SetUINT32(&MF_MT_AVG_BITRATE, cfg.bitrate)?;
        out_type.SetUINT64(&MF_MT_FRAME_RATE, frame_rate_packed)?;
        out_type.SetUINT64(&MF_MT_FRAME_SIZE, frame_size_packed)?;
        out_type.SetUINT32(&MF_MT_INTERLACE_MODE, 2)?;
        encoder_mft.SetOutputType(0, &out_type, 0)?;

        // Re-set the NV12 input type at the new frame size so input/output
        // agree (the VP now writes NV12 at the new resolution).
        let in_type: IMFMediaType = MFCreateMediaType()?;
        in_type.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)?;
        in_type.SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_NV12)?;
        in_type.SetUINT64(&MF_MT_FRAME_RATE, frame_rate_packed)?;
        in_type.SetUINT64(&MF_MT_FRAME_SIZE, frame_size_packed)?;
        in_type.SetUINT32(&MF_MT_INTERLACE_MODE, 2)?;
        in_type.SetUINT64(&MF_MT_PIXEL_ASPECT_RATIO, (1u64 << 32) | 1)?;
        in_type.SetUINT32(&MF_MT_DEFAULT_STRIDE, cfg.width)?;
        encoder_mft.SetInputType(0, &in_type, 0)?;

        // Resume streaming at the new config.
        encoder_mft.ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0)?;
        encoder_mft.ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0)?;
        Ok(())
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
    use windows::Win32::System::Variant::{VARIANT, VARIANT_0, VARIANT_0_0, VARIANT_0_0_0, VT_BOOL};
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
        ICodecAPI, CODECAPI_AVEncCommonRateControlMode, CODECAPI_AVEncMPVGOPSize,
        CODECAPI_AVLowLatencyMode, eAVEncCommonRateControlMode_LowDelayVBR,
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
            log::info!("[MftEncoder] AVEncCommonRateControlMode unsupported: {:?}", r);
        }
    }

    // Bounded GOP (~1s). Keeps late-joiner / recovery keyframes bounded while
    // letting on-demand PLI keyframes carry steady-state recovery.
    {
        let gop = fps.max(1);
        let val = variant_u32(gop);
        let r = codec_api.SetValue(&CODECAPI_AVEncMPVGOPSize, &val);
        if r.is_ok() {
            applied.push("GOPSize=fps(~1s)");
        } else {
            log::info!("[MftEncoder] AVEncMPVGOPSize unsupported: {:?}", r);
        }
    }

    log::info!(
        "[MftEncoder] low-latency config applied: [{}]",
        applied.join(", ")
    );
}

/// Set the encoder's mean bitrate (bits/sec) live via `ICodecAPI`
/// `CODECAPI_AVEncCommonMeanBitRate` — no flush, no output-type reset, no forced
/// keyframe (Req 3.1). Best-effort: logs and returns on failure.
#[cfg(feature = "native-screen-share")]
unsafe fn set_mean_bitrate(encoder_mft: &IMFTransform, bitrate_bps: u32) {
    use windows::Win32::Media::MediaFoundation::{ICodecAPI, CODECAPI_AVEncCommonMeanBitRate};
    let codec_api: ICodecAPI = match encoder_mft.cast() {
        Ok(c) => c,
        Err(e) => {
            log::warn!("[MftEncoder] set_bitrate: encoder has no ICodecAPI ({e})");
            return;
        }
    };
    let val = variant_u32(bitrate_bps);
    match codec_api.SetValue(&CODECAPI_AVEncCommonMeanBitRate, &val) {
        Ok(()) => log::info!("[MftEncoder] live bitrate set to {} bps", bitrate_bps),
        Err(e) => log::warn!("[MftEncoder] live bitrate set to {bitrate_bps} failed: {e}"),
    }
}

/// Force the encoder to emit a keyframe (IDR) on the next frame via `ICodecAPI`
/// `CODECAPI_AVEncVideoForceKeyFrame` (Req 2.1, 2.2). Best-effort.
#[cfg(feature = "native-screen-share")]
unsafe fn force_keyframe(encoder_mft: &IMFTransform) {
    use windows::Win32::Media::MediaFoundation::{ICodecAPI, CODECAPI_AVEncVideoForceKeyFrame};
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

                // Resolve the destination output view + texture as owned COM
                // clones (cheap AddRef on refcounted interfaces). Cloning frees
                // the borrow on `vp` so the `&mut self` `convert_into` below
                // (which may lazily allocate the normalize texture) does not
                // conflict with these still being referenced after the call.
                let (output_view, nv12_tex): (
                    ID3D11VideoProcessorOutputView,
                    ID3D11Texture2D,
                ) = match slot_idx.and_then(|i| vp.nv12_ring.as_ref().map(|r| (i, r))) {
                    Some((i, ring)) => {
                        let slot = ring
                            .ring
                            .get(i)
                            .expect("just-acquired NV12 slot must exist");
                        (slot.output_view.clone(), slot.texture.clone())
                    }
                    None => (vp.fallback_view.clone(), vp.fallback_tex.clone()),
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
                vp.convert_into(&frame.texture, &output_view, d3d)
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
                    MFCreateDXGISurfaceBuffer(&ID3D11Texture2D::IID, &nv12_tex, 0, false)
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
        assert_eq!(classify_mft("", Some(0x8086), true), EncoderBackend::QuickSync);
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
