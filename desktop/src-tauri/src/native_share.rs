use bytes::Bytes;
use crabgrab::feature::bitmap::{FrameBitmap, VideoFrameBitmap};
#[cfg(target_os = "windows")]
use crabgrab::platform::windows::{WindowsCapturableWindowExt, WindowsCaptureConfigExt, HWND};
use crabgrab::prelude::*;
use openh264::encoder::{Encoder as OpenH264Encoder, EncoderConfig, RateControlMode, UsageType};
use openh264::formats::{BgraSliceU8, YUVBuffer};
use openh264::OpenH264API;
use std::borrow::Cow;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tauri::Emitter;
use tokio::sync::{mpsc, Mutex};
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

fn even_dimension(value: u32) -> u32 {
    value.saturating_sub(value % 2).max(2)
}

// ── Shared State for Native Share ──────────────────────────────────────────

#[derive(Default)]
pub struct NativeShareState {
    pub active_connection: Mutex<Option<Arc<RTCPeerConnection>>>,
    pub video_track: Mutex<Option<Arc<TrackLocalStaticSample>>>,
    pub capture_stream: Mutex<Option<CaptureStream>>,
    pub audio_running: Arc<std::sync::atomic::AtomicBool>,
    pub stats: Arc<NativeShareStats>,
}

#[derive(Default)]
pub struct NativeShareStats {
    pub captured_frames: AtomicU64,
    pub encoded_frames: AtomicU64,
    pub encode_errors: AtomicU64,
    pub samples_written: AtomicU64,
    pub audio_samples_written: AtomicU64,
    pub write_errors: AtomicU64,
    pub dropped_frames: AtomicU64,
}

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
    let frame_samples_per_channel = 960usize; // 20 ms at 48 kHz.
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

fn crop_or_borrow_bgra<'a>(
    frame_data: &'a [[u8; 4]],
    frame_width: usize,
    frame_height: usize,
    target_width: usize,
    target_height: usize,
) -> Option<Cow<'a, [u8]>> {
    if frame_width < target_width || frame_height < target_height {
        return None;
    }

    let frame_bytes = bytemuck::cast_slice(frame_data);
    if frame_width == target_width && frame_height == target_height {
        return Some(Cow::Borrowed(frame_bytes));
    }

    let source_stride = frame_width * 4;
    let target_stride = target_width * 4;
    let mut cropped = Vec::with_capacity(target_stride * target_height);
    for row in 0..target_height {
        let start = row * source_stride;
        let end = start + target_stride;
        cropped.extend_from_slice(&frame_bytes[start..end]);
    }

    Some(Cow::Owned(cropped))
}

// ── Payload for Signaling ────────────────────────────────────────────────

#[derive(serde::Serialize, serde::Deserialize)]
pub struct SdpOfferPayload {
    pub sdp: String,
    pub r#type: String, // "offer"
}

#[derive(Clone, Debug, serde::Deserialize)]
pub struct NativeIceServer {
    pub urls: Vec<String>,
    pub username: Option<String>,
    pub credential: Option<String>,
}

enum SelectedCaptureSource {
    Display(CapturableDisplay),
    Window(CapturableWindow),
}

impl SelectedCaptureSource {
    fn rect(&self) -> crabgrab::util::Rect {
        match self {
            Self::Display(display) => display.rect(),
            Self::Window(window) => window.rect(),
        }
    }

    fn into_config(self) -> Result<CaptureConfig, String> {
        match self {
            Self::Display(display) => Ok(CaptureConfig::with_display(
                display,
                CapturePixelFormat::Bgra8888,
            )),
            Self::Window(window) => {
                CaptureConfig::with_window(window, CapturePixelFormat::Bgra8888)
                    .map_err(|e| format!("Selected window cannot be captured: {e}"))
            }
        }
    }
}

async fn resolve_capture_source(
    source_id: &str,
    source_name: Option<&str>,
) -> Result<SelectedCaptureSource, String> {
    if let Some(raw_idx) = source_id.strip_prefix("monitor-") {
        let idx = raw_idx
            .parse::<usize>()
            .map_err(|_| format!("Invalid monitor source id: {source_id}"))?;
        let content = CapturableContent::new(CapturableContentFilter::DISPLAYS)
            .await
            .map_err(|e| format!("Could not enumerate displays: {e}"))?;
        return content
            .displays()
            .nth(idx)
            .map(SelectedCaptureSource::Display)
            .ok_or_else(|| format!("Selected display is no longer capturable: {source_id}"));
    }

    if let Some(raw_hwnd) = source_id.strip_prefix("window-") {
        #[cfg(target_os = "windows")]
        {
            let hwnd_id = raw_hwnd
                .parse::<isize>()
                .map_err(|_| format!("Invalid window source id: {source_id}"))?;
            let window = CapturableWindow::from_window_handle(HWND(hwnd_id))
                .map_err(|e| format!("Selected window is no longer capturable: {e}"))?;
            return Ok(SelectedCaptureSource::Window(window));
        }

        #[cfg(not(target_os = "windows"))]
        {
            let target_name = source_name.unwrap_or_default().to_lowercase();
            if target_name.is_empty() {
                return Err(format!("Window source name is required for {source_id}"));
            }
            let content = CapturableContent::new(CapturableContentFilter::NORMAL_WINDOWS)
                .await
                .map_err(|e| format!("Could not enumerate windows: {e}"))?;
            return content
                .windows()
                .find(|window| {
                    let title_lower = window.title().to_lowercase();
                    title_lower == target_name
                        || title_lower.contains(&target_name)
                        || target_name.contains(&title_lower)
                })
                .map(SelectedCaptureSource::Window)
                .ok_or_else(|| {
                    format!(
                        "Selected window is no longer capturable: {}",
                        source_name.unwrap_or(source_id)
                    )
                });
        }
    }

    Err(format!("Unsupported native capture source id: {source_id}"))
}

// ── Start Native Screen Share ──────────────────────────────────────────────

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
    let selected_source = resolve_capture_source(&source_id, source_name.as_deref()).await?;

    // 1. Setup WebRTC MediaEngine & API
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
        .filter(|server| !server.urls.is_empty())
        .map(|server| webrtc::ice_transport::ice_server::RTCIceServer {
            urls: server.urls,
            username: server.username.unwrap_or_default(),
            credential: server.credential.unwrap_or_default(),
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

    let config = RTCConfiguration {
        ice_servers: rtc_ice_servers,
        ..Default::default()
    };

    let peer_connection = Arc::new(
        api.new_peer_connection(config)
            .await
            .map_err(|e| e.to_string())?,
    );
    let stats = Arc::clone(&state.stats);
    stats.captured_frames.store(0, Ordering::Relaxed);
    stats.encoded_frames.store(0, Ordering::Relaxed);
    stats.encode_errors.store(0, Ordering::Relaxed);
    stats.samples_written.store(0, Ordering::Relaxed);
    stats.audio_samples_written.store(0, Ordering::Relaxed);
    stats.write_errors.store(0, Ordering::Relaxed);
    stats.dropped_frames.store(0, Ordering::Relaxed);

    let app_for_pc = app.clone();
    peer_connection.on_peer_connection_state_change(Box::new(move |state| {
        let _ = app_for_pc.emit("native-screen-share-status", format!("pc:{state}"));
        Box::pin(async {})
    }));

    let native_track_name = track_name.unwrap_or_else(|| "screen_share".to_owned());

    // 2. Create the H.264 Video Track
    let video_track = Arc::new(TrackLocalStaticSample::new(
        RTCRtpCodecCapability {
            mime_type: "video/H264".to_owned(),
            clock_rate: 90_000,
            sdp_fmtp_line: "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f"
                .to_owned(),
            ..Default::default()
        },
        native_track_name,
        "screen".to_owned(),
    ));

    peer_connection
        .add_track(Arc::clone(&video_track) as Arc<dyn TrackLocal + Send + Sync>)
        .await
        .map_err(|e| e.to_string())?;

    let audio_track = if with_audio.unwrap_or(false) {
        let native_audio_track_name = audio_track_name.unwrap_or_else(|| "screen_audio".to_owned());
        let track = Arc::new(TrackLocalStaticSample::new(
            RTCRtpCodecCapability {
                mime_type: "audio/opus".to_owned(),
                clock_rate: 48_000,
                channels: 2,
                sdp_fmtp_line: "minptime=10;useinbandfec=1;stereo=1;sprop-stereo=1;usedtx=0"
                    .to_owned(),
                ..Default::default()
            },
            native_audio_track_name,
            "screen".to_owned(),
        ));

        peer_connection
            .add_track(Arc::clone(&track) as Arc<dyn TrackLocal + Send + Sync>)
            .await
            .map_err(|e| e.to_string())?;
        Some(track)
    } else {
        None
    };

    // 3. ICE Candidate gathering
    let app_clone = app.clone();
    peer_connection.on_ice_candidate(Box::new(
        move |candidate: Option<webrtc::ice_transport::ice_candidate::RTCIceCandidate>| {
            if let Some(c) = candidate {
                let _ = app_clone.emit("native-ice-candidate", c.to_json().ok());
            }
            Box::pin(async {})
        },
    ));

    // 4. Create SDP Offer
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

    // 5. Start crabgrab capture loop
    #[cfg(target_os = "windows")]
    let capture_token = match CaptureStream::test_access(true) {
        Some(token) => token,
        None => CaptureStream::request_access(true).await.ok_or_else(|| {
            "Borderless screen capture permission was denied or is unsupported".to_string()
        })?,
    };

    #[cfg(not(target_os = "windows"))]
    let capture_token = match CaptureStream::test_access(false) {
        Some(token) => token,
        None => return Err("CrabGrab access denied or unsupported".to_string()),
    };

    let (source_width, source_height) = {
        let rect = selected_source.rect();
        (rect.size.width as u32, rect.size.height as u32)
    };
    let encode_width = even_dimension(source_width);
    let encode_height = even_dimension(source_height);

    let config = selected_source.into_config()?;

    #[cfg(target_os = "windows")]
    let capture_config = config.with_borderless(true);

    #[cfg(not(target_os = "windows"))]
    let capture_config = config;

    let quality = quality.unwrap_or_else(|| "720p30".to_string());
    let fps = if quality.ends_with("60") { 60 } else { 30 };
    let bitrate = match quality.as_str() {
        "720p30" => 4_000_000,
        "720p60" => 6_000_000,
        "1080p30" => 8_000_000,
        "1080p60" => 12_000_000,
        "1440p30" => 16_000_000,
        "1440p60" => 24_000_000,
        "4k30" => 28_000_000,
        "4k60" => 45_000_000,
        _ => 8_000_000,
    };

    // Encode at the captured source's native dimensions. Keep this path software-backed and
    // deterministic; the previous WMF encoder could capture frames but emit zero H.264 samples.
    let h264_config = EncoderConfig::new()
        .set_bitrate_bps(bitrate)
        .max_frame_rate(fps as f32)
        .rate_control_mode(RateControlMode::Bitrate)
        .usage_type(UsageType::ScreenContentRealTime)
        .enable_skip_frame(false)
        .set_multiple_thread_idc(0);
    let mut h264_encoder =
        OpenH264Encoder::with_api_config(OpenH264API::from_source(), h264_config)
            .map_err(|e| format!("Create OpenH264 encoder failed: {e}"))?;
    let mut yuv_buffer = YUVBuffer::new(encode_width as usize, encode_height as usize);

    let (sample_tx, mut sample_rx) = mpsc::channel::<webrtc::media::Sample>(3);
    let writer_track = Arc::clone(&video_track);
    let writer_pc = Arc::clone(&peer_connection);
    let writer_stats = Arc::clone(&stats);
    tokio::spawn(async move {
        let mut last_sample: Option<(Bytes, std::time::Duration)> = None;
        let mut repeat_latest = tokio::time::interval(std::time::Duration::from_millis(250));
        repeat_latest.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

        loop {
            tokio::select! {
                maybe_sample = sample_rx.recv() => {
                    let Some(sample) = maybe_sample else {
                        break;
                    };
                    last_sample = Some((sample.data.clone(), sample.duration));

                    match writer_track.write_sample(&sample).await {
                        Ok(_) => {
                            if writer_pc.connection_state() == RTCPeerConnectionState::Connected {
                                writer_stats.samples_written.fetch_add(1, Ordering::Relaxed);
                            }
                        }
                        Err(_) => {
                            writer_stats.write_errors.fetch_add(1, Ordering::Relaxed);
                        }
                    }
                }
                _ = repeat_latest.tick() => {
                    if writer_pc.connection_state() != RTCPeerConnectionState::Connected {
                        continue;
                    }

                    if let Some((data, duration)) = last_sample.as_ref() {
                        let sample = webrtc::media::Sample {
                            data: data.clone(),
                            duration: *duration,
                            ..Default::default()
                        };
                        match writer_track.write_sample(&sample).await {
                            Ok(_) => {
                                writer_stats.samples_written.fetch_add(1, Ordering::Relaxed);
                            }
                            Err(_) => {
                                writer_stats.write_errors.fetch_add(1, Ordering::Relaxed);
                            }
                        }
                    }
                }
            }
        }
    });

    let capture_stream =
        CaptureStream::new(capture_token, capture_config, move |event| match event {
            Ok(StreamEvent::Video(frame)) => {
                if let Ok(bitmap) = frame.get_bitmap() {
                    if let FrameBitmap::BgraUnorm8x4(bgra_frame) = bitmap {
                        stats.captured_frames.fetch_add(1, Ordering::Relaxed);
                        let frame_width = bgra_frame.width;
                        let frame_height = bgra_frame.height;
                        let target_width = encode_width as usize;
                        let target_height = encode_height as usize;
                        let Some(bgra_bytes) = crop_or_borrow_bgra(
                            bgra_frame.data.as_ref(),
                            frame_width,
                            frame_height,
                            target_width,
                            target_height,
                        ) else {
                            stats.dropped_frames.fetch_add(1, Ordering::Relaxed);
                            return;
                        };

                        let bgra =
                            BgraSliceU8::new(bgra_bytes.as_ref(), (target_width, target_height));
                        yuv_buffer.read_rgb(bgra);

                        match h264_encoder.encode(&yuv_buffer) {
                            Ok(bitstream) => {
                                let nal_units = bitstream.to_vec();
                                if nal_units.is_empty() {
                                    stats.encode_errors.fetch_add(1, Ordering::Relaxed);
                                    return;
                                }

                                stats.encoded_frames.fetch_add(1, Ordering::Relaxed);
                                let sample = webrtc::media::Sample {
                                    data: Bytes::from(nal_units),
                                    duration: std::time::Duration::from_millis(
                                        (1_000 / fps.max(1)) as u64,
                                    ),
                                    ..Default::default()
                                };

                                if sample_tx.try_send(sample).is_err() {
                                    stats.dropped_frames.fetch_add(1, Ordering::Relaxed);
                                }
                            }
                            Err(_) => {
                                stats.encode_errors.fetch_add(1, Ordering::Relaxed);
                            }
                        }
                    }
                }
            }
            _ => {}
        })
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "windows")]
    if let Some(track) = audio_track {
        start_wasapi_loopback_audio(
            track,
            Arc::clone(&peer_connection),
            Arc::clone(&state.audio_running),
            Arc::clone(&state.stats),
        );
    }

    // Store state
    let mut st = state.active_connection.lock().await;
    *st = Some(Arc::clone(&peer_connection));

    let mut vt = state.video_track.lock().await;
    *vt = Some(Arc::clone(&video_track));

    let mut cs = state.capture_stream.lock().await;
    *cs = Some(capture_stream);

    Ok(SdpOfferPayload {
        sdp: offer.sdp,
        r#type: "offer".to_string(),
    })
}

// ── Handle incoming SDP Answer ─────────────────────────────────────────────

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

#[tauri::command]
pub async fn wait_native_screen_share_connected(
    state: tauri::State<'_, NativeShareState>,
    timeout_ms: Option<u64>,
) -> Result<String, String> {
    let timeout_ms = timeout_ms.unwrap_or(10_000);
    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(timeout_ms);

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

        if std::time::Instant::now() >= deadline {
            return Err(format!(
                "Timed out waiting for native media; connection={connection_state}, captured_frames={}, encoded_frames={}, encode_errors={}, samples_written={}, audio_samples_written={}, write_errors={}, dropped_frames={}",
                state.stats.captured_frames.load(Ordering::Relaxed),
                state.stats.encoded_frames.load(Ordering::Relaxed),
                state.stats.encode_errors.load(Ordering::Relaxed),
                samples_written,
                audio_samples_written,
                state.stats.write_errors.load(Ordering::Relaxed),
                state.stats.dropped_frames.load(Ordering::Relaxed),
            ));
        }

        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
}

// ── Stop Native Screen Share ───────────────────────────────────────────────

#[tauri::command]
pub async fn stop_native_screen_share(
    state: tauri::State<'_, NativeShareState>,
) -> Result<(), String> {
    state.audio_running.store(false, Ordering::Relaxed);

    let mut st = state.active_connection.lock().await;
    if let Some(pc) = st.take() {
        let _ = pc.close().await;
    }

    let mut vt = state.video_track.lock().await;
    *vt = None;

    let mut cs = state.capture_stream.lock().await;
    if let Some(mut stream) = cs.take() {
        stream.stop().map_err(|e| e.to_string())?;
    }

    Ok(())
}
