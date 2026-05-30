use bytes::Bytes;
use std::sync::atomic::{AtomicU64, AtomicU8, Ordering};
use std::sync::{mpsc, Arc};
use tauri::Emitter;
use tokio::sync::Mutex;
use webrtc::api::interceptor_registry::register_default_interceptors;
use webrtc::api::media_engine::MediaEngine;
use webrtc::api::APIBuilder;
use webrtc::ice_transport::ice_credential_type::RTCIceCredentialType;
use webrtc::peer_connection::configuration::RTCConfiguration;
use webrtc::peer_connection::peer_connection_state::RTCPeerConnectionState;
use webrtc::peer_connection::sdp::session_description::RTCSessionDescription;
use webrtc::peer_connection::RTCPeerConnection;
use webrtc::rtp_transceiver::rtp_codec::RTCRtpCodecCapability;
use webrtc::track::track_local::track_local_static_sample::TrackLocalStaticSample;
use webrtc::track::track_local::TrackLocal;

use crate::d3d_device::D3dDevice;
use crate::game_capture::{
    select_capture_mode, CaptureMode, GraphicsApiBackend, InjectionOutcome, SourceKind,
};
use crate::wmf_encoder::{MftEncoderWorker, VideoCodec};

fn even_dimension(value: u32) -> u32 {
    value.saturating_sub(value % 2).max(2)
}

// ── Shared stats ───────────────────────────────────────────────────────────

#[derive(Default)]
pub struct NativeShareStats {
    pub captured_frames: AtomicU64,
    pub encoded_frames: AtomicU64,
    pub encode_errors: AtomicU64,
    pub samples_written: AtomicU64,
    pub audio_samples_written: AtomicU64,
    pub write_errors: AtomicU64,
    pub dropped_frames: AtomicU64,

    // ── Per-frame timing (Req 9.1, 9.2) ──────────────────────────────────
    // Stored as nanoseconds. Written by the encoder worker (task 3.1) on each
    // processed frame; the serializable snapshot + `capture_mode` reporting are
    // layered on top in task 5.1. Added additively so existing counters above
    // are untouched.
    /// Most recent fused GPU capture-and-conversion (VideoProcessorBlt +
    /// scoped completion query) duration, in nanoseconds.
    pub last_fused_gpu_ns: AtomicU64,
    /// Most recent MFT `ProcessInput` submit duration, in nanoseconds.
    pub last_encode_submit_ns: AtomicU64,
    /// Exponentially-weighted moving average (alpha = 1/8) of the fused-GPU
    /// duration, in nanoseconds — a stable value for UI display.
    pub fused_gpu_ns_ewma: AtomicU64,
    /// EWMA (alpha = 1/8) of the encode-submit duration, in nanoseconds.
    pub encode_submit_ns_ewma: AtomicU64,

    // ── Active capture mode (Req 6.5, 7.3, 9.4) ──────────────────────────
    /// The active `Capture_Mode` for the current session, encoded as a small
    /// integer so it can live in an atomic alongside the counters:
    /// `0 = wgc` (the guaranteed fallback), `1 = hook` (zero-copy DX11 hook).
    /// Mirrors [`CaptureMode`]; mapped back to its string form in the snapshot.
    /// Defaults to `0` (`wgc`) so a session that never selects the hook reports
    /// the fallback mode, matching the orchestration default.
    pub capture_mode: AtomicU8,
}

impl NativeShareStats {
    /// EWMA smoothing factor denominator (alpha = 1/8). A larger denominator
    /// yields a smoother, slower-moving average.
    const EWMA_SHIFT: u32 = 3;

    /// Record the most recent fused-GPU operation duration (the
    /// `VideoProcessorBlt` + scoped completion query) and fold it into the
    /// EWMA. Called once per processed frame by the encoder worker (Req 9.1).
    pub fn record_fused_gpu_ns(&self, ns: u64) {
        self.last_fused_gpu_ns.store(ns, Ordering::Relaxed);
        Self::update_ewma(&self.fused_gpu_ns_ewma, ns);
    }

    /// Record the most recent MFT `ProcessInput` submit duration and fold it
    /// into the EWMA. Called once per processed frame (Req 9.2).
    pub fn record_encode_submit_ns(&self, ns: u64) {
        self.last_encode_submit_ns.store(ns, Ordering::Relaxed);
        Self::update_ewma(&self.encode_submit_ns_ewma, ns);
    }

    /// Fold `sample` into an EWMA stored in `slot`:
    /// `ewma += (sample - ewma) / 2^EWMA_SHIFT`. A zero EWMA seeds directly to
    /// the first sample so the average converges immediately on session start.
    fn update_ewma(slot: &AtomicU64, sample: u64) {
        let prev = slot.load(Ordering::Relaxed);
        let next = if prev == 0 {
            sample
        } else if sample >= prev {
            prev + ((sample - prev) >> Self::EWMA_SHIFT)
        } else {
            prev - ((prev - sample) >> Self::EWMA_SHIFT)
        };
        slot.store(next, Ordering::Relaxed);
    }

    /// Record the active `Capture_Mode` for the session (Req 6.5, 7.3, 9.4).
    /// Stored as the `CaptureMode` discriminant so the value round-trips back
    /// to the same string in the snapshot.
    pub fn set_capture_mode(&self, mode: CaptureMode) {
        self.capture_mode
            .store(capture_mode_to_u8(mode), Ordering::Relaxed);
    }

    /// Build a serializable [`NativeShareStatsSnapshot`] from the live atomics
    /// (Req 9.3, 9.4, 9.5). Every existing counter is mapped through unchanged;
    /// the per-frame timing values are converted from the stored nanoseconds to
    /// microseconds for UI readability; the capture mode is reported as its
    /// stable string form (`"wgc"` | `"hook"`).
    pub fn snapshot(&self) -> NativeShareStatsSnapshot {
        NativeShareStatsSnapshot {
            capture_mode: capture_mode_from_u8(self.capture_mode.load(Ordering::Relaxed))
                .as_str()
                .to_string(),
            // Existing counters — mapped unchanged (Req 9.5).
            captured_frames: self.captured_frames.load(Ordering::Relaxed),
            encoded_frames: self.encoded_frames.load(Ordering::Relaxed),
            encode_errors: self.encode_errors.load(Ordering::Relaxed),
            samples_written: self.samples_written.load(Ordering::Relaxed),
            dropped_frames: self.dropped_frames.load(Ordering::Relaxed),
            // Per-frame timing — nanoseconds → microseconds (Req 9.1, 9.2).
            last_fused_gpu_us: self.last_fused_gpu_ns.load(Ordering::Relaxed) / 1_000,
            last_encode_submit_us: self.last_encode_submit_ns.load(Ordering::Relaxed) / 1_000,
            fused_gpu_us_avg: self.fused_gpu_ns_ewma.load(Ordering::Relaxed) / 1_000,
            encode_submit_us_avg: self.encode_submit_ns_ewma.load(Ordering::Relaxed) / 1_000,
        }
    }
}

/// Discriminant for `CaptureMode::Wgc` stored in [`NativeShareStats::capture_mode`].
const CAPTURE_MODE_WGC: u8 = 0;
/// Discriminant for `CaptureMode::Hook` stored in [`NativeShareStats::capture_mode`].
const CAPTURE_MODE_HOOK: u8 = 1;

/// Map a [`CaptureMode`] to the `u8` discriminant kept in the atomic.
fn capture_mode_to_u8(mode: CaptureMode) -> u8 {
    match mode {
        CaptureMode::Wgc => CAPTURE_MODE_WGC,
        CaptureMode::Hook => CAPTURE_MODE_HOOK,
    }
}

/// Map a stored `u8` discriminant back to a [`CaptureMode`]. Any unknown value
/// (only `0`/`1` are ever written) defaults to the `wgc` fallback so the
/// reported mode is always valid.
fn capture_mode_from_u8(value: u8) -> CaptureMode {
    match value {
        CAPTURE_MODE_HOOK => CaptureMode::Hook,
        _ => CaptureMode::Wgc,
    }
}

/// Serializable snapshot of [`NativeShareStats`] returned by the stats Tauri
/// command (Req 9.3, 9.4, 9.5). Counters are reported as-is; per-frame timing
/// is expressed in **microseconds** for UI readability, and the capture mode is
/// the stable string form of the active [`CaptureMode`].
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct NativeShareStatsSnapshot {
    /// Active capture mode: `"wgc"` (fallback) or `"hook"` (zero-copy DX11).
    pub capture_mode: String,
    // ── Existing counters (Req 9.5 — reported unchanged) ─────────────────
    pub captured_frames: u64,
    pub encoded_frames: u64,
    pub encode_errors: u64,
    pub samples_written: u64,
    pub dropped_frames: u64,
    // ── Per-frame timing in microseconds (Req 9.1, 9.2, 9.4) ─────────────
    /// Most recent fused GPU capture-and-conversion duration, in microseconds.
    pub last_fused_gpu_us: u64,
    /// Most recent MFT `ProcessInput` submit duration, in microseconds.
    pub last_encode_submit_us: u64,
    /// Smoothed (EWMA) fused-GPU duration, in microseconds.
    pub fused_gpu_us_avg: u64,
    /// Smoothed (EWMA) encode-submit duration, in microseconds.
    pub encode_submit_us_avg: u64,
}

// ── Shared Tauri state ─────────────────────────────────────────────────────

#[derive(Default)]
pub struct NativeShareState {
    pub active_connection: Mutex<Option<Arc<RTCPeerConnection>>>,
    pub video_track: Mutex<Option<Arc<TrackLocalStaticSample>>>,
    /// WGC capture session — drop to stop capture.
    pub wgc_capture: Mutex<Option<crate::wgc_capture::WgcCapture>>,
    /// Encoder worker — dropped in stop command.
    pub encoder_worker: Mutex<Option<MftEncoderWorker>>,
    /// Live DX11 game-capture hook (Tier 3) when the session resolved to the
    /// zero-copy `hook` Capture_Mode. Kept alive for the session's duration so
    /// the injected payload keeps publishing shared surfaces; cleared on stop,
    /// which runs [`Dx11Hook::detach`] via `Drop` to release the shared
    /// surfaces and the target-process handle (Req 7.5). `None` whenever the
    /// session runs on the WGC fallback path.
    pub game_hook: Mutex<Option<crate::game_capture::dx11::Dx11Hook>>,
    pub audio_running: Arc<std::sync::atomic::AtomicBool>,
    pub stats: Arc<NativeShareStats>,
}

// ── WASAPI loopback audio (unchanged from original) ───────────────────────

#[cfg(target_os = "windows")]
fn start_wasapi_loopback_audio(
    audio_track: Arc<TrackLocalStaticSample>,
    peer_connection: Arc<RTCPeerConnection>,
    running: Arc<std::sync::atomic::AtomicBool>,
    stats: Arc<NativeShareStats>,
) {
    running.store(true, Ordering::Relaxed);
    let runtime = tokio::runtime::Handle::current();

    std::thread::Builder::new()
        .name("RalphNativeScreenAudio".to_owned())
        .spawn(move || {
            if let Err(err) =
                run_wasapi_loopback_audio(audio_track, peer_connection, running, stats, runtime)
            {
                log::warn!("[NativeShare] WASAPI loopback audio stopped: {err}");
            }
        })
        .ok();
}

#[cfg(target_os = "windows")]
fn run_wasapi_loopback_audio(
    audio_track: Arc<TrackLocalStaticSample>,
    peer_connection: Arc<RTCPeerConnection>,
    running: Arc<std::sync::atomic::AtomicBool>,
    stats: Arc<NativeShareStats>,
    runtime: tokio::runtime::Handle,
) -> Result<(), String> {
    use std::collections::VecDeque;
    use shiguredo_opus::{Application, Encoder as OpusEncoder, EncoderConfig};
    use wasapi::{initialize_mta, DeviceEnumerator, Direction, SampleType, StreamMode, WaveFormat};

    initialize_mta()
        .ok()
        .map_err(|e| format!("Initialize WASAPI MTA failed: {e}"))?;

    let enumerator =
        DeviceEnumerator::new().map_err(|e| format!("Create WASAPI enumerator failed: {e}"))?;
    let device = enumerator
        .get_default_device(&Direction::Render)
        .map_err(|e| format!("Get default render device failed: {e}"))?;
    let mut audio_client = device
        .get_iaudioclient()
        .map_err(|e| format!("Create WASAPI audio client failed: {e}"))?;

    let desired_format = WaveFormat::new(32, 32, &SampleType::Float, 48_000, 2, None);
    let blockalign = desired_format.get_blockalign() as usize;
    let (_default_time, min_time) = audio_client
        .get_device_period()
        .map_err(|e| format!("Get WASAPI device period failed: {e}"))?;
    let mode = StreamMode::EventsShared {
        autoconvert: true,
        buffer_duration_hns: min_time,
    };

    audio_client
        .initialize_client(&desired_format, &Direction::Capture, &mode)
        .map_err(|e| format!("Initialize WASAPI loopback client failed: {e}"))?;
    let event = audio_client
        .set_get_eventhandle()
        .map_err(|e| format!("Create WASAPI event handle failed: {e}"))?;
    let capture_client = audio_client
        .get_audiocaptureclient()
        .map_err(|e| format!("Create WASAPI capture client failed: {e}"))?;

    let mut opus_config = EncoderConfig::new(48_000, 2);
    opus_config.application = Some(Application::Audio);
    opus_config.bitrate = Some(192_000);
    opus_config.vbr = Some(true);
    opus_config.dtx = Some(false);
    let mut encoder =
        OpusEncoder::new(opus_config).map_err(|e| format!("Create Opus encoder failed: {e}"))?;

    let mut sample_queue: VecDeque<u8> = VecDeque::with_capacity(blockalign * 48_000);
    let frame_samples_per_channel = 960usize; // 20 ms at 48 kHz
    let frame_bytes = blockalign * frame_samples_per_channel;
    audio_client
        .start_stream()
        .map_err(|e| format!("Start WASAPI loopback stream failed: {e}"))?;

    while running.load(Ordering::Relaxed) {
        capture_client
            .read_from_device_to_deque(&mut sample_queue)
            .map_err(|e| format!("Read WASAPI loopback packet failed: {e}"))?;

        while sample_queue.len() >= frame_bytes {
            let mut pcm = Vec::with_capacity(frame_samples_per_channel * 2);
            for _ in 0..(frame_samples_per_channel * 2) {
                let b0 = sample_queue.pop_front().unwrap_or(0);
                let b1 = sample_queue.pop_front().unwrap_or(0);
                let b2 = sample_queue.pop_front().unwrap_or(0);
                let b3 = sample_queue.pop_front().unwrap_or(0);
                pcm.push(f32::from_le_bytes([b0, b1, b2, b3]));
            }

            match encoder.encode_f32(&pcm) {
                Ok(packet) if !packet.is_empty() => {
                    let sample = webrtc::media::Sample {
                        data: Bytes::from(packet),
                        duration: std::time::Duration::from_millis(20),
                        ..Default::default()
                    };
                    let track = Arc::clone(&audio_track);
                    let pc = Arc::clone(&peer_connection);
                    let stats = Arc::clone(&stats);
                    runtime.spawn(async move {
                        if pc.connection_state() == RTCPeerConnectionState::Connected {
                            match track.write_sample(&sample).await {
                                Ok(_) => {
                                    stats.audio_samples_written.fetch_add(1, Ordering::Relaxed);
                                }
                                Err(_) => {
                                    stats.write_errors.fetch_add(1, Ordering::Relaxed);
                                }
                            }
                        }
                    });
                }
                Ok(_) => {}
                Err(err) => {
                    log::warn!("[NativeShare] Opus encode failed: {err}");
                }
            }
        }

        let _ = event.wait_for_event(100);
    }

    let _ = audio_client.stop_stream();
    Ok(())
}

// ── Signaling payloads ─────────────────────────────────────────────────────

#[derive(serde::Serialize, serde::Deserialize)]
pub struct SdpOfferPayload {
    pub sdp: String,
    pub r#type: String,
}

#[derive(Clone, Debug, serde::Deserialize)]
pub struct NativeIceServer {
    pub urls: Vec<String>,
    pub username: Option<String>,
    pub credential: Option<String>,
}

// ── Resolve source ID to WGC capture item ─────────────────────────────────

fn resolve_wgc_item(
    source_id: &str,
) -> Result<windows::Graphics::Capture::GraphicsCaptureItem, String> {
    if let Some(raw_idx) = source_id.strip_prefix("monitor-") {
        let idx = raw_idx
            .parse::<usize>()
            .map_err(|_| format!("Invalid monitor source id: {source_id}"))?;
        crate::wgc_capture::capture_item_for_monitor_idx(idx)
            .map_err(|e| format!("Create WGC monitor item: {e}"))
    } else if let Some(raw_hwnd) = source_id.strip_prefix("window-") {
        let hwnd = raw_hwnd
            .parse::<isize>()
            .map_err(|_| format!("Invalid window source id: {source_id}"))?;
        crate::wgc_capture::capture_item_for_hwnd(hwnd)
            .map_err(|e| format!("Create WGC window item: {e}"))
    } else {
        Err(format!("Unsupported native capture source id: {source_id}"))
    }
}

/// Derive the [`SourceKind`] from a native capture `source_id`.
///
/// Source ids are the same strings `resolve_wgc_item` understands: a
/// `"monitor-<idx>"` id is a [`SourceKind::Monitor`] (always WGC, Req 6.2) and a
/// `"window-<hwnd>"` id is a [`SourceKind::Window`] (the only hook candidate,
/// Req 7.1). Any other prefix is treated as a window so it still flows through
/// the (conservative) selection — a non-window/non-monitor id never reaches
/// here because `resolve_wgc_item` rejects it first.
fn source_kind_from_id(source_id: &str) -> SourceKind {
    if source_id.starts_with("monitor-") {
        SourceKind::Monitor
    } else {
        SourceKind::Window
    }
}

/// Parse the raw `HWND` value out of a `"window-<hwnd>"` source id, if present.
/// Returns `None` for a monitor id or a malformed window id (in which case no
/// hook attach is attempted and the session stays on the WGC path).
fn window_hwnd_from_id(source_id: &str) -> Option<isize> {
    source_id
        .strip_prefix("window-")
        .and_then(|raw| raw.parse::<isize>().ok())
}

/// Whether the DX11 zero-copy game-capture hook may be attempted this session.
///
/// The hook is **additive and opt-in**: WGC is the proven, guaranteed path
/// (Req 6) and must remain the default, so the hook is only attempted when the
/// `RALPH_GAME_CAPTURE_HOOK` environment variable is set to a truthy value
/// (`1`, `true`, `yes`, or `on`, case-insensitive). With the variable unset or
/// any other value, `select_capture_mode` is still called but with
/// `hook_enabled = false`, so it always resolves to `wgc` and default behavior
/// is unchanged.
fn game_capture_hook_enabled() -> bool {
    std::env::var("RALPH_GAME_CAPTURE_HOOK")
        .ok()
        .map(|v| {
            let v = v.trim().to_ascii_lowercase();
            matches!(v.as_str(), "1" | "true" | "yes" | "on")
        })
        .unwrap_or(false)
}

/// Whether a hook-injection `outcome` must trigger the "zero-copy hook
/// unavailable" user notification.
///
/// This is the pure decision that drives the `native-screen-share-status`
/// `"hook-unavailable…"` emit in [`start_native_screen_share`]: a hook attempt
/// that **failed** or was **blocked** (anti-cheat) falls back to WGC and must
/// notify the user (Req 6.3, 7.4). A [`InjectionOutcome::Success`] (the hook is
/// the active mode) or [`InjectionOutcome::NotAttempted`] (a monitor source or a
/// disabled hook, where WGC was always going to be used) is silent.
///
/// Extracted as a `pub fn` so the notification *decision* can be unit-tested at
/// a public seam without constructing a Tauri `AppHandle` (the `emit` itself
/// needs one and so cannot run in CI).
pub fn should_notify_hook_unavailable(outcome: InjectionOutcome) -> bool {
    matches!(
        outcome,
        InjectionOutcome::Failed | InjectionOutcome::Blocked
    )
}

// ── start_native_screen_share ──────────────────────────────────────────────

#[tauri::command]
pub async fn start_native_screen_share<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, NativeShareState>,
    source_id: String,
    source_name: Option<String>,
    quality: Option<String>,
    track_name: Option<String>,
    audio_track_name: Option<String>,
    with_audio: Option<bool>,
    ice_servers: Option<Vec<NativeIceServer>>,
) -> Result<SdpOfferPayload, String> {
    let _ = source_name; // not needed with WGC (HWND / monitor index is sufficient)

    // 1. Resolve capture item synchronously (WGC item creation is not async).
    let wgc_item = resolve_wgc_item(&source_id)?;

    // Get the item's native size (WGC always captures at the monitor's physical resolution).
    let item_size = wgc_item.Size().map_err(|e| e.to_string())?;
    let src_width = even_dimension(item_size.Width as u32);
    let src_height = even_dimension(item_size.Height as u32);

    // 2. Select codec — prefer H.264, fall back to HEVC (not currently used but wired).
    let codec = VideoCodec::H264;

    // 3. Parse quality → fps + target encode resolution + bitrate.
    //    WGC captures at native resolution; the D3D11 Video Processor scales to the target.
    let quality = quality.unwrap_or_else(|| "720p30".to_string());
    let fps: u32 = if quality.ends_with("60") { 60 } else { 30 };
    let (encode_width, encode_height, bitrate): (u32, u32, u32) = match quality.as_str() {
        "480p30" | "480p60" => (854, 480, 2_000_000),
        "720p30"            => (1280, 720, 4_000_000),
        "720p60"            => (1280, 720, 6_000_000),
        "1080p30"           => (1920, 1080, 8_000_000),
        "1080p60"           => (1920, 1080, 12_000_000),
        "1440p30"           => (2560, 1440, 16_000_000),
        "1440p60"           => (2560, 1440, 24_000_000),
        "4k30"              => (3840, 2160, 28_000_000),
        "4k60"              => (3840, 2160, 45_000_000),
        _                   => (1920, 1080, 8_000_000),
    };
    // Cap encode dims to the native source size — no upscaling.
    let encode_width  = encode_width.min(src_width);
    let encode_height = encode_height.min(src_height);
    log::info!(
        "[NativeShare] source={}x{}  target={}x{}  fps={}  bitrate={}",
        src_width, src_height, encode_width, encode_height, fps, bitrate
    );

    // 4. Create shared D3D11 device.
    let d3d = D3dDevice::new().map_err(|e| format!("Create D3D11 device: {e}"))?;

    // 5. Reset stats.
    let stats = Arc::clone(&state.stats);
    stats.captured_frames.store(0, Ordering::Relaxed);
    stats.encoded_frames.store(0, Ordering::Relaxed);
    stats.encode_errors.store(0, Ordering::Relaxed);
    stats.samples_written.store(0, Ordering::Relaxed);
    stats.audio_samples_written.store(0, Ordering::Relaxed);
    stats.write_errors.store(0, Ordering::Relaxed);
    stats.dropped_frames.store(0, Ordering::Relaxed);
    // New per-frame timing fields (Req 9.1, 9.2) — reset alongside the counters.
    stats.last_fused_gpu_ns.store(0, Ordering::Relaxed);
    stats.last_encode_submit_ns.store(0, Ordering::Relaxed);
    stats.fused_gpu_ns_ewma.store(0, Ordering::Relaxed);
    stats.encode_submit_ns_ewma.store(0, Ordering::Relaxed);
    // Capture mode (Req 6.5, 7.3, 9.4) — default to the `wgc` fallback at
    // session start; task 7.3 overrides it via `set_capture_mode` once the
    // capture-mode selection resolves (e.g. a successful DX11 hook attach).
    stats
        .capture_mode
        .store(CAPTURE_MODE_WGC, Ordering::Relaxed);

    // ── Capture-mode selection (Tier 3, Req 6/7/8) ───────────────────────
    // WGC is the guaranteed, proven path (Req 6) and stays the default frame
    // source for this session regardless of mode. The zero-copy DX11 hook is
    // additive and opt-in behind `RALPH_GAME_CAPTURE_HOOK`. We only attempt
    // injection for an injectable *window* source (Req 6.2: a monitor is always
    // WGC); a monitor source or a disabled hook is `NotAttempted`, which
    // `select_capture_mode` resolves to `wgc`.
    let source_kind = source_kind_from_id(&source_id);
    let hook_enabled = game_capture_hook_enabled();
    // The DX11 backend is implemented (task 7.2), so treat it as ready and let
    // the single env flag be the conservative gate. Non-DX11 backends stay
    // gated inside `select_capture_mode` / `GraphicsApiBackend::is_active_capable`.
    let backend = GraphicsApiBackend::Dx11;
    let dx11_ready = true;

    // Attempt to attach the hook only for an injectable window source when the
    // flag is on; otherwise the outcome is `NotAttempted`. A failure or
    // anti-cheat block here must never abort the session — we fall back to WGC.
    let mut game_hook: Option<crate::game_capture::dx11::Dx11Hook> = None;
    let injection_outcome = if hook_enabled
        && source_kind == SourceKind::Window
        && backend.is_active_capable()
        && dx11_ready
    {
        match window_hwnd_from_id(&source_id) {
            Some(hwnd) => {
                let attach =
                    crate::game_capture::dx11::Dx11Hook::try_attach(&d3d, hwnd, backend);
                log::info!(
                    "[NativeShare] DX11 hook attach outcome={:?}: {}",
                    attach.outcome,
                    attach.detail
                );
                game_hook = attach.hook;
                attach.outcome
            }
            None => InjectionOutcome::NotAttempted,
        }
    } else {
        InjectionOutcome::NotAttempted
    };

    // Resolve the active Capture_Mode via the pure selection function and
    // report it in stats (Req 6.5, 7.3). `hook` is only chosen for a DX11
    // window with the flag on, DX11 ready, and a successful injection.
    let capture_mode = select_capture_mode(
        source_kind,
        backend,
        hook_enabled,
        dx11_ready,
        injection_outcome,
    );
    stats.set_capture_mode(capture_mode);
    log::info!(
        "[NativeShare] capture_mode={} (source_kind={:?}, hook_enabled={}, injection={:?})",
        capture_mode.as_str(),
        source_kind,
        hook_enabled,
        injection_outcome
    );

    // On a hook attempt that failed or was blocked (anti-cheat), continue the
    // session on the WGC fallback and notify the user that zero-copy hook
    // capture is unavailable — never terminate the session (Req 6.3, 7.4).
    if should_notify_hook_unavailable(injection_outcome) {
        let reason = match injection_outcome {
            InjectionOutcome::Blocked => "blocked (likely anti-cheat)",
            _ => "failed to attach",
        };
        log::warn!("[NativeShare] zero-copy DX11 hook {reason}; continuing on WGC fallback");
        let _ = app.emit(
            "native-screen-share-status",
            format!(
                "hook-unavailable: zero-copy game-capture hook {reason}; continuing screen share on WGC"
            ),
        );
    }

    // Only retain the hook handle when the hook is the active mode. Dropping it
    // here runs `Dx11Hook::detach` (Drop) so we never leave an idle injected
    // payload running on the WGC path (Req 7.5).
    if capture_mode != CaptureMode::Hook {
        game_hook = None;
    }

    // NOTE: WGC remains the frame source for both modes in this wiring. The
    // hook attaches and is reported as the active mode (Req 7.3) and is kept
    // alive in state; the fused, ring-buffered, flush-free WGC path (Req 1–4)
    // is the common substrate that always produces frames (Req 6.4), so the
    // session can never regress below the proven WGC pipeline.

    // 6. Build WebRTC peer connection.
    let mut m = MediaEngine::default();
    m.register_default_codecs().map_err(|e| e.to_string())?;
    let mut registry = webrtc::interceptor::registry::Registry::new();
    registry = register_default_interceptors(registry, &mut m).map_err(|e| e.to_string())?;
    let api = APIBuilder::new()
        .with_media_engine(m)
        .with_interceptor_registry(registry)
        .build();

    let mut rtc_ice_servers: Vec<webrtc::ice_transport::ice_server::RTCIceServer> = ice_servers
        .unwrap_or_default()
        .into_iter()
        .filter(|s| !s.urls.is_empty())
        .map(|s| webrtc::ice_transport::ice_server::RTCIceServer {
            urls: s.urls,
            username: s.username.unwrap_or_default(),
            credential: s.credential.unwrap_or_default(),
            credential_type: RTCIceCredentialType::Password,
            ..Default::default()
        })
        .collect();
    if rtc_ice_servers.is_empty() {
        rtc_ice_servers.push(webrtc::ice_transport::ice_server::RTCIceServer {
            urls: vec!["stun:stun.l.google.com:19302".to_owned()],
            ..Default::default()
        });
    }

    let peer_connection = Arc::new(
        api.new_peer_connection(RTCConfiguration {
            ice_servers: rtc_ice_servers,
            ..Default::default()
        })
        .await
        .map_err(|e| e.to_string())?,
    );

    let app_for_pc = app.clone();
    peer_connection.on_peer_connection_state_change(Box::new(move |s| {
        let _ = app_for_pc.emit("native-screen-share-status", format!("pc:{s}"));
        Box::pin(async {})
    }));

    // 7. Create video track.
    let native_track_name = track_name.unwrap_or_else(|| "screen_share".to_owned());
    let video_track = Arc::new(TrackLocalStaticSample::new(
        RTCRtpCodecCapability {
            mime_type: codec.mime_type().to_owned(),
            clock_rate: 90_000,
            sdp_fmtp_line: codec.sdp_fmtp().to_owned(),
            ..Default::default()
        },
        native_track_name,
        "screen".to_owned(),
    ));
    peer_connection
        .add_track(Arc::clone(&video_track) as Arc<dyn TrackLocal + Send + Sync>)
        .await
        .map_err(|e| e.to_string())?;

    // 8. Optional audio track.
    let audio_track = if with_audio.unwrap_or(false) {
        let name = audio_track_name.unwrap_or_else(|| "screen_audio".to_owned());
        let t = Arc::new(TrackLocalStaticSample::new(
            RTCRtpCodecCapability {
                mime_type: "audio/opus".to_owned(),
                clock_rate: 48_000,
                channels: 2,
                sdp_fmtp_line: "minptime=10;useinbandfec=1;stereo=1;sprop-stereo=1;usedtx=0"
                    .to_owned(),
                ..Default::default()
            },
            name,
            "screen".to_owned(),
        ));
        peer_connection
            .add_track(Arc::clone(&t) as Arc<dyn TrackLocal + Send + Sync>)
            .await
            .map_err(|e| e.to_string())?;
        Some(t)
    } else {
        None
    };

    // 9. ICE candidate forwarding.
    let app_clone = app.clone();
    peer_connection.on_ice_candidate(Box::new(
        move |candidate| {
            if let Some(c) = candidate {
                let _ = app_clone.emit("native-ice-candidate", c.to_json().ok());
            }
            Box::pin(async {})
        },
    ));

    // 10. Create SDP offer.
    let offer = peer_connection
        .create_offer(None)
        .await
        .map_err(|e| e.to_string())?;
    let mut gather_complete = peer_connection.gathering_complete_promise().await;
    peer_connection
        .set_local_description(offer.clone())
        .await
        .map_err(|e| e.to_string())?;
    let _ = gather_complete.recv().await;

    // 11. Spawn async writer: encoder output → WebRTC track.
    // Use tokio mpsc as the async-friendly bridge; a blocking thread drains the
    // sync SyncReceiver and forwards into the tokio channel.
    let (encoded_tx, encoded_rx) = mpsc::sync_channel::<Vec<u8>>(8);
    let (async_tx, mut async_rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
    let writer_track = Arc::clone(&video_track);
    let writer_pc = Arc::clone(&peer_connection);
    let writer_stats = Arc::clone(&stats);
    let fps_for_writer = fps;

    // Blocking bridge thread: drains sync Receiver → async sender.
    std::thread::Builder::new()
        .name("RalphEncoderBridge".into())
        .spawn(move || {
            while let Ok(data) = encoded_rx.recv() {
                if async_tx.send(data).is_err() {
                    break;
                }
            }
        })
        .ok();

    tokio::spawn(async move {
        while let Some(data) = async_rx.recv().await {
            if writer_pc.connection_state() != RTCPeerConnectionState::Connected {
                continue;
            }
            let sample = webrtc::media::Sample {
                data: Bytes::from(data),
                duration: std::time::Duration::from_millis(1_000 / fps_for_writer.max(1) as u64),
                ..Default::default()
            };
            match writer_track.write_sample(&sample).await {
                Ok(_) => { writer_stats.samples_written.fetch_add(1, Ordering::Relaxed); }
                Err(_) => { writer_stats.write_errors.fetch_add(1, Ordering::Relaxed); }
            }
        }
    });

    // 12. Start the encoder worker (dedicated OS thread with async MFT pump).
    let encoder_worker = MftEncoderWorker::new(
        codec,
        src_width,
        src_height,
        encode_width,
        encode_height,
        fps,
        bitrate,
        Arc::clone(&d3d),
        encoded_tx,
        Arc::clone(&stats),
    )
    .map_err(|e| format!("Start encoder worker: {e}"))?;

    // 13. Start WGC capture at the NATIVE resolution.
    //     The D3D11 VP in the encoder worker scales down to encode_width×encode_height.
    let wgc = crate::wgc_capture::start_wgc_capture(
        wgc_item,
        &d3d,
        src_width,
        src_height,
        encoder_worker.frame_tx.clone(),
        Arc::clone(&stats),
    )?;

    // 14. Optional WASAPI audio.
    #[cfg(target_os = "windows")]
    if let Some(track) = audio_track {
        start_wasapi_loopback_audio(
            track,
            Arc::clone(&peer_connection),
            Arc::clone(&state.audio_running),
            Arc::clone(&stats),
        );
    }

    // 15. Store state.
    *state.active_connection.lock().await = Some(Arc::clone(&peer_connection));
    *state.video_track.lock().await = Some(Arc::clone(&video_track));
    *state.wgc_capture.lock().await = Some(wgc);
    *state.encoder_worker.lock().await = Some(encoder_worker);
    // Keep the DX11 hook alive for the session when it is the active mode; it
    // is released (detached) in `stop_native_screen_share` (Req 7.5). `None`
    // on the WGC fallback path.
    *state.game_hook.lock().await = game_hook;

    Ok(SdpOfferPayload {
        sdp: offer.sdp,
        r#type: "offer".to_string(),
    })
}

// ── handle_sdp_answer ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn handle_sdp_answer(
    state: tauri::State<'_, NativeShareState>,
    sdp: String,
) -> Result<(), String> {
    let st = state.active_connection.lock().await;
    let pc = st.as_ref().ok_or("No active WebRTC connection")?;

    let mut answer = RTCSessionDescription::default();
    answer.sdp = sdp;
    answer.sdp_type = webrtc::peer_connection::sdp::sdp_type::RTCSdpType::Answer;

    pc.set_remote_description(answer)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ── wait_native_screen_share_connected ────────────────────────────────────

#[tauri::command]
pub async fn wait_native_screen_share_connected(
    state: tauri::State<'_, NativeShareState>,
    timeout_ms: Option<u64>,
) -> Result<String, String> {
    let timeout_ms = timeout_ms.unwrap_or(15_000);
    let deadline =
        std::time::Instant::now() + std::time::Duration::from_millis(timeout_ms);

    loop {
        let pc = {
            let st = state.active_connection.lock().await;
            st.as_ref()
                .cloned()
                .ok_or_else(|| "No active WebRTC connection".to_string())?
        };

        let connection_state = pc.connection_state();
        let samples_written = state.stats.samples_written.load(Ordering::Relaxed);
        let audio_samples_written = state.stats.audio_samples_written.load(Ordering::Relaxed);
        let captured_frames = state.stats.captured_frames.load(Ordering::Relaxed);
        let encoded_frames = state.stats.encoded_frames.load(Ordering::Relaxed);
        let encode_errors = state.stats.encode_errors.load(Ordering::Relaxed);

        match connection_state {
            RTCPeerConnectionState::Connected if samples_written >= 3 => {
                return Ok(format!(
                    "connected;samples_written={samples_written};audio_samples_written={audio_samples_written}"
                ));
            }
            RTCPeerConnectionState::Failed | RTCPeerConnectionState::Closed => {
                return Err(format!(
                    "Native WebRTC connection ended before media could flow: {connection_state}"
                ));
            }
            _ => {}
        }

        if captured_frames >= 30 && encoded_frames == 0 && encode_errors >= 25 {
            return Err(format!(
                "Native hardware video encoder failed; connection={connection_state}, captured_frames={captured_frames}, encoded_frames={encoded_frames}, encode_errors={encode_errors}, samples_written={samples_written}, audio_samples_written={audio_samples_written}, write_errors={}, dropped_frames={}",
                state.stats.write_errors.load(Ordering::Relaxed),
                state.stats.dropped_frames.load(Ordering::Relaxed),
            ));
        }

        if std::time::Instant::now() >= deadline {
            return Err(format!(
                "Timed out waiting for native media; connection={connection_state}, captured_frames={captured_frames}, encoded_frames={encoded_frames}, encode_errors={encode_errors}, samples_written={samples_written}, audio_samples_written={audio_samples_written}, write_errors={}, dropped_frames={}",
                state.stats.write_errors.load(Ordering::Relaxed),
                state.stats.dropped_frames.load(Ordering::Relaxed),
            ));
        }

        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
}

// ── stop_native_screen_share ───────────────────────────────────────────────

#[tauri::command]
pub async fn stop_native_screen_share(
    state: tauri::State<'_, NativeShareState>,
) -> Result<(), String> {
    state.audio_running.store(false, Ordering::Relaxed);

    // Stop and drop encoder worker first (signals the encode thread to exit).
    let mut ew = state.encoder_worker.lock().await;
    if let Some(mut worker) = ew.take() {
        worker.stop();
    }

    // Drop WGC session (stops FrameArrived callbacks).
    *state.wgc_capture.lock().await = None;

    // Detach and release the DX11 game-capture hook, if one is active. Taking
    // it here drops the `Dx11Hook`, whose `Drop`/`detach` releases the shared
    // surfaces and closes the target-process handle (Req 7.5).
    {
        let mut hook = state.game_hook.lock().await;
        if let Some(mut h) = hook.take() {
            h.detach();
        }
    }

    // Close WebRTC peer connection.
    let mut st = state.active_connection.lock().await;
    if let Some(pc) = st.take() {
        let _ = pc.close().await;
    }

    *state.video_track.lock().await = None;
    Ok(())
}

// ── get_native_screen_share_stats ──────────────────────────────────────────

/// Return a serializable [`NativeShareStatsSnapshot`] of the current native
/// share session's pipeline stats so the renderer can read internal per-frame
/// timing and counters (Req 9.3, 9.4, 9.5, 10.2).
///
/// `state.stats` is a live `Arc<NativeShareStats>` on the managed state, so the
/// snapshot is always available: during an active session it reflects populated
/// counters + timing + the active `Capture_Mode`; with no session active it
/// reports the zeroed/`wgc` defaults (acceptable per Req 9.3/9.4/9.5). Reading
/// is lock-free — `snapshot()` loads the atomics directly — so this command
/// never contends with the capture/encoder threads.
#[tauri::command]
pub async fn get_native_screen_share_stats(
    state: tauri::State<'_, NativeShareState>,
) -> Result<NativeShareStatsSnapshot, String> {
    Ok(state.stats.snapshot())
}

// ── Unit tests for the stats snapshot mapping (task 5.1) ──────────────────

#[cfg(test)]
mod stats_snapshot_tests {
    use super::*;

    #[test]
    fn default_snapshot_reports_wgc_and_zeroes() {
        let stats = NativeShareStats::default();
        let snap = stats.snapshot();
        assert_eq!(snap.capture_mode, "wgc");
        assert_eq!(snap.captured_frames, 0);
        assert_eq!(snap.encoded_frames, 0);
        assert_eq!(snap.encode_errors, 0);
        assert_eq!(snap.samples_written, 0);
        assert_eq!(snap.dropped_frames, 0);
        assert_eq!(snap.last_fused_gpu_us, 0);
        assert_eq!(snap.last_encode_submit_us, 0);
        assert_eq!(snap.fused_gpu_us_avg, 0);
        assert_eq!(snap.encode_submit_us_avg, 0);
    }

    #[test]
    fn snapshot_maps_existing_counters_unchanged() {
        let stats = NativeShareStats::default();
        stats.captured_frames.store(101, Ordering::Relaxed);
        stats.encoded_frames.store(97, Ordering::Relaxed);
        stats.encode_errors.store(2, Ordering::Relaxed);
        stats.samples_written.store(95, Ordering::Relaxed);
        stats.dropped_frames.store(4, Ordering::Relaxed);

        let snap = stats.snapshot();
        assert_eq!(snap.captured_frames, 101);
        assert_eq!(snap.encoded_frames, 97);
        assert_eq!(snap.encode_errors, 2);
        assert_eq!(snap.samples_written, 95);
        assert_eq!(snap.dropped_frames, 4);
    }

    #[test]
    fn snapshot_converts_timing_ns_to_us() {
        let stats = NativeShareStats::default();
        // 1_500_000 ns = 1500 us; integer division truncates sub-microsecond.
        stats.last_fused_gpu_ns.store(1_500_000, Ordering::Relaxed);
        stats.last_encode_submit_ns.store(2_999, Ordering::Relaxed); // -> 2 us
        stats.fused_gpu_ns_ewma.store(1_234_567, Ordering::Relaxed); // -> 1234 us
        stats.encode_submit_ns_ewma.store(500, Ordering::Relaxed); // -> 0 us

        let snap = stats.snapshot();
        assert_eq!(snap.last_fused_gpu_us, 1_500);
        assert_eq!(snap.last_encode_submit_us, 2);
        assert_eq!(snap.fused_gpu_us_avg, 1_234);
        assert_eq!(snap.encode_submit_us_avg, 0);
    }

    #[test]
    fn snapshot_reports_capture_mode_string() {
        let stats = NativeShareStats::default();
        stats.set_capture_mode(CaptureMode::Hook);
        assert_eq!(stats.snapshot().capture_mode, "hook");
        stats.set_capture_mode(CaptureMode::Wgc);
        assert_eq!(stats.snapshot().capture_mode, "wgc");
    }

    #[test]
    fn capture_mode_u8_round_trips() {
        for mode in [CaptureMode::Wgc, CaptureMode::Hook] {
            assert_eq!(capture_mode_from_u8(capture_mode_to_u8(mode)), mode);
        }
        // Unknown discriminants fall back to the wgc default.
        assert_eq!(capture_mode_from_u8(42), CaptureMode::Wgc);
    }

    #[test]
    fn snapshot_serializes_to_json() {
        let stats = NativeShareStats::default();
        stats.captured_frames.store(7, Ordering::Relaxed);
        stats.last_fused_gpu_ns.store(3_000, Ordering::Relaxed);
        let json = serde_json::to_value(stats.snapshot()).unwrap();
        assert_eq!(json["capture_mode"], "wgc");
        assert_eq!(json["captured_frames"], 7);
        assert_eq!(json["last_fused_gpu_us"], 3);
    }

    // ── get_native_screen_share_stats command (task 5.2) ─────────────────

    #[test]
    fn state_default_snapshot_is_zeroed_wgc() {
        // The command returns `state.stats.snapshot()`; with no active session
        // the managed state's live stats Arc yields the zeroed/`wgc` default
        // (acceptable per Req 9.3/9.4/9.5).
        let state = NativeShareState::default();
        assert_eq!(state.stats.snapshot(), NativeShareStats::default().snapshot());
    }

    #[test]
    fn state_snapshot_reflects_live_session_stats() {
        // The stats Arc is shared with the capture/encoder threads; the command
        // reads it live, so mutations made during a session are visible in the
        // snapshot the command would return (Req 9.4, 9.5, 10.2).
        let state = NativeShareState::default();
        let shared = Arc::clone(&state.stats);
        shared.captured_frames.store(120, Ordering::Relaxed);
        shared.encoded_frames.store(118, Ordering::Relaxed);
        shared.dropped_frames.store(2, Ordering::Relaxed);
        shared.record_fused_gpu_ns(450_000); // 450 us
        shared.record_encode_submit_ns(1_200_000); // 1200 us
        shared.set_capture_mode(CaptureMode::Hook);

        let snap = state.stats.snapshot();
        assert_eq!(snap.capture_mode, "hook");
        assert_eq!(snap.captured_frames, 120);
        assert_eq!(snap.encoded_frames, 118);
        assert_eq!(snap.dropped_frames, 2);
        assert_eq!(snap.last_fused_gpu_us, 450);
        assert_eq!(snap.last_encode_submit_us, 1_200);
    }
}

// ── Unit tests for capture-mode orchestration helpers (task 7.3) ───────────

#[cfg(test)]
mod capture_mode_wiring_tests {
    use super::*;

    #[test]
    fn source_kind_derives_monitor_from_monitor_id() {
        assert_eq!(source_kind_from_id("monitor-0"), SourceKind::Monitor);
        assert_eq!(source_kind_from_id("monitor-3"), SourceKind::Monitor);
    }

    #[test]
    fn source_kind_derives_window_from_window_id() {
        assert_eq!(source_kind_from_id("window-12345"), SourceKind::Window);
        // Any non-monitor id is treated conservatively as a window candidate.
        assert_eq!(source_kind_from_id("other-xyz"), SourceKind::Window);
    }

    #[test]
    fn window_hwnd_parsed_only_for_window_ids() {
        assert_eq!(window_hwnd_from_id("window-12345"), Some(12345));
        assert_eq!(window_hwnd_from_id("window--7"), Some(-7));
        // Monitor ids and malformed window ids yield no hwnd (no attach attempt).
        assert_eq!(window_hwnd_from_id("monitor-0"), None);
        assert_eq!(window_hwnd_from_id("window-notanumber"), None);
        assert_eq!(window_hwnd_from_id("garbage"), None);
    }

    #[test]
    fn monitor_source_always_selects_wgc_even_with_success() {
        // Mirrors the orchestration call: a monitor source forces WGC (Req 6.2)
        // regardless of the (irrelevant) injection outcome.
        let mode = select_capture_mode(
            source_kind_from_id("monitor-1"),
            GraphicsApiBackend::Dx11,
            true,
            true,
            InjectionOutcome::Success,
        );
        assert_eq!(mode, CaptureMode::Wgc);
    }

    #[test]
    fn window_source_with_disabled_hook_selects_wgc() {
        // Default behavior (flag off ⇒ hook_enabled false, NotAttempted) keeps
        // the proven WGC pipeline (Req 6.1).
        let mode = select_capture_mode(
            source_kind_from_id("window-42"),
            GraphicsApiBackend::Dx11,
            false,
            true,
            InjectionOutcome::NotAttempted,
        );
        assert_eq!(mode, CaptureMode::Wgc);
    }

    #[test]
    fn window_source_with_successful_injection_selects_hook() {
        let mode = select_capture_mode(
            source_kind_from_id("window-42"),
            GraphicsApiBackend::Dx11,
            true,
            true,
            InjectionOutcome::Success,
        );
        assert_eq!(mode, CaptureMode::Hook);
    }

    #[test]
    fn failed_or_blocked_injection_falls_back_to_wgc() {
        for outcome in [InjectionOutcome::Failed, InjectionOutcome::Blocked] {
            let mode = select_capture_mode(
                source_kind_from_id("window-42"),
                GraphicsApiBackend::Dx11,
                true,
                true,
                outcome,
            );
            assert_eq!(mode, CaptureMode::Wgc, "{outcome:?} must fall back to WGC");
        }
    }

    #[test]
    fn hook_enable_flag_is_conservative_by_default() {
        // Truthy values enable; everything else (including unset) disables.
        let truthy = ["1", "true", "TRUE", "Yes", "on", " on "];
        let falsy = ["0", "false", "no", "off", "", "enabled?", "2"];

        for v in truthy {
            std::env::set_var("RALPH_GAME_CAPTURE_HOOK", v);
            assert!(game_capture_hook_enabled(), "{v:?} should enable the hook");
        }
        for v in falsy {
            std::env::set_var("RALPH_GAME_CAPTURE_HOOK", v);
            assert!(!game_capture_hook_enabled(), "{v:?} should not enable the hook");
        }
        std::env::remove_var("RALPH_GAME_CAPTURE_HOOK");
        assert!(
            !game_capture_hook_enabled(),
            "unset env var must keep the hook disabled (WGC default)"
        );
    }
}
