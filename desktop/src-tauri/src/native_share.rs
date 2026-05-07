use std::sync::Arc;
use tokio::sync::{Mutex};
use crabgrab::prelude::*;
use tauri::{Emitter};
use crate::wmf_encoder::{WmfH264Encoder, bgra_to_nv12};
use webrtc::api::APIBuilder;
use webrtc::api::interceptor_registry::register_default_interceptors;
use webrtc::api::media_engine::MediaEngine;
use webrtc::peer_connection::configuration::RTCConfiguration;
use webrtc::peer_connection::RTCPeerConnection;
use webrtc::peer_connection::sdp::session_description::RTCSessionDescription;
use webrtc::track::track_local::track_local_static_sample::TrackLocalStaticSample;
use webrtc::track::track_local::TrackLocal;
use webrtc::rtp_transceiver::rtp_codec::RTCRtpCodecCapability;

// ── Shared State for Native Share ──────────────────────────────────────────

#[derive(Default)]
pub struct NativeShareState {
    pub active_connection: Mutex<Option<Arc<RTCPeerConnection>>>,
    pub video_track: Mutex<Option<Arc<TrackLocalStaticSample>>>,
    pub capture_stream: Mutex<Option<CaptureStream>>,
}

// ── Payload for Signaling ────────────────────────────────────────────────

#[derive(serde::Serialize, serde::Deserialize)]
pub struct SdpOfferPayload {
    pub sdp: String,
    pub r#type: String, // "offer"
}

// ── Start Native Screen Share ──────────────────────────────────────────────

#[tauri::command]
pub async fn start_native_screen_share<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, NativeShareState>,
    source_id: String,
    source_name: Option<String>,
    quality: Option<String>,
) -> Result<SdpOfferPayload, String> {
    // 1. Setup WebRTC MediaEngine & API
    let mut m = MediaEngine::default();
    m.register_default_codecs().map_err(|e| e.to_string())?;

    let mut registry = webrtc::interceptor::registry::Registry::new();
    registry = register_default_interceptors(registry, &mut m).map_err(|e| e.to_string())?;

    let api = APIBuilder::new()
        .with_media_engine(m)
        .with_interceptor_registry(registry)
        .build();

    let config = RTCConfiguration {
        ice_servers: vec![
            webrtc::ice_transport::ice_server::RTCIceServer {
                urls: vec!["stun:stun.l.google.com:19302".to_owned()],
                ..Default::default()
            }
        ],
        ..Default::default()
    };

    let peer_connection = Arc::new(api.new_peer_connection(config).await.map_err(|e| e.to_string())?);

    // 2. Create the H.264 Video Track
    let video_track = Arc::new(TrackLocalStaticSample::new(
        RTCRtpCodecCapability {
            mime_type: "video/H264".to_owned(),
            ..Default::default()
        },
        "screen_share".to_owned(),
        "webrtc-rs".to_owned(),
    ));

    peer_connection
        .add_track(Arc::clone(&video_track) as Arc<dyn TrackLocal + Send + Sync>)
        .await
        .map_err(|e| e.to_string())?;

    // 3. ICE Candidate gathering
    let app_clone = app.clone();
    peer_connection.on_ice_candidate(Box::new(move |candidate: Option<webrtc::ice_transport::ice_candidate::RTCIceCandidate>| {
        if let Some(c) = candidate {
            let _ = app_clone.emit("native-ice-candidate", c.to_json().ok());
        }
        Box::pin(async {})
    }));

    // 4. Create SDP Offer
    let offer = peer_connection.create_offer(None).await.map_err(|e| e.to_string())?;
    let mut gather_complete = peer_connection.gathering_complete_promise().await;
    peer_connection.set_local_description(offer.clone()).await.map_err(|e| e.to_string())?;
    let _ = gather_complete.recv().await;

    // 5. Start crabgrab capture loop
    let capture_token = match CaptureStream::test_access(false) {
        Some(token) => token,
        None => return Err("CrabGrab access denied or unsupported".to_string()),
    };

    // Parse the source_id to a CapturableWindow or CapturableDisplay
    // In a real app we'd iterate over xcap or crabgrab's capturable elements to find the match.
    // Here we'll just grab the primary display as a placeholder for the exact matching logic.
    let filter = if source_id.starts_with("monitor-") {
        CapturableContentFilter::DISPLAYS
    } else {
        // Fallback to windows if it's not explicitly a monitor
        CapturableContentFilter::NORMAL_WINDOWS
    };
    let content = CapturableContent::new(filter).await.map_err(|e| e.to_string())?;

    // Quick parsing: "monitor-0" -> displays[0], "window-123" -> windows.find.
    let mut p_display = None;
    let mut p_window = None;

    if source_id.starts_with("monitor-") {
        if let Ok(idx) = source_id.replace("monitor-", "").parse::<usize>() {
            p_display = content.displays().nth(idx);
        }
    } else if source_id.starts_with("window-") {
        let target_name = source_name.unwrap_or_default();
        let target_name_lower = target_name.to_lowercase();

        p_window = content.windows().find(|window| {
            let title = window.title();
            if target_name_lower.is_empty() {
                return false;
            }

            let title_lower = title.to_lowercase();
            title_lower == target_name_lower
                || title_lower.contains(&target_name_lower)
                || target_name_lower.contains(&title_lower)
        });

        if p_window.is_none() {
            return Err(format!("Selected window is no longer capturable: {}", target_name));
        }
    }

    if p_display.is_none() && p_window.is_none() {
        p_display = content.displays().next(); // fallback
    }

    let config = if let Some(display) = p_display {
        CaptureConfig::with_display(display, CapturePixelFormat::Bgra8888)
    } else if let Some(window) = p_window {
        CaptureConfig::with_window(window, CapturePixelFormat::Bgra8888).unwrap()
    } else {
        return Err("No capturable source found".to_string());
    };

    let (width, height) = if let Some(d) = p_display {
        let rect = d.rect();
        (rect.size.width as u32, rect.size.height as u32)
    } else if let Some(w) = p_window {
        let rect = w.rect().unwrap_or(Rect { origin: Point { x: 0.0, y: 0.0 }, size: Size { width: 1920.0, height: 1080.0 } });
        (rect.size.width as u32, rect.size.height as u32)
    } else {
        (1920, 1080)
    };

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

    // Initialize Hardware Encoder at the captured source's native dimensions.
    // Never downscale window capture here; the selected quality controls bitrate/FPS.
    let mut wmf_encoder = WmfH264Encoder::new(width, height, fps, bitrate).map_err(|e| e.to_string())?;

    let video_track_clone = Arc::clone(&video_track);
    let mut capture_stream = CaptureStream::new(capture_token, capture_config, move |event| {
        match event {
            Ok(StreamEvent::Video(frame)) => {
                if let Ok(bgra) = frame.get_video_frame_buffer() {
                    let nv12 = bgra_to_nv12(bgra.as_slice(), width as usize, height as usize);
                    let duration_ms = (1_000 / fps.max(1)) as i64 * 10_000; // 100ns units

                    if let Ok(nal_units) = wmf_encoder.encode(&nv12, duration_ms) {
                        if !nal_units.is_empty() {
                            // Convert to Bytes for webrtc track
                            let bytes = bytes::Bytes::from(nal_units);
                            // Write directly to WebRTC H.264 track
                            // TrackLocalStaticSample write_sample expects the sample and duration
                            let sample = webrtc::media::Sample {
                                data: bytes,
                                duration: std::time::Duration::from_millis((1_000 / fps.max(1)) as u64),
                                ..Default::default()
                            };

                            let vt = video_track_clone.clone();
                            tokio::spawn(async move {
                                let _ = vt.write_sample(&sample).await;
                            });
                        }
                    }
                }
            },
            _ => {}
        }
    }).map_err(|e| e.to_string())?;

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

    pc.set_remote_description(answer).await.map_err(|e| e.to_string())?;

    Ok(())
}

// ── Stop Native Screen Share ───────────────────────────────────────────────

#[tauri::command]
pub async fn stop_native_screen_share(
    state: tauri::State<'_, NativeShareState>,
) -> Result<(), String> {
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
