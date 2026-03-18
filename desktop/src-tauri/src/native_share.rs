use std::sync::Arc;
use tokio::sync::{Mutex};
use crabgrab::prelude::*;
use tauri::{Manager, Emitter};
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
        let hwnd_str = source_id.replace("window-", "");
        let hwnd_val = hwnd_str.parse::<usize>().unwrap_or(0);
        // Find window by some heuristic or simply take the first one if not matched easily
        // because crabgrab window IDs might not map 1:1 to xcap HWNDs directly without inspecting titles.
        p_window = content.windows().next();
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

    // In v0.4, some attributes are platform specific or removed if default.
    // For now we just use the default config.
    let capture_config = config;

    let video_track_clone = Arc::clone(&video_track);
    let mut capture_stream = CaptureStream::new(capture_token, capture_config, move |event| {
        match event {
            Ok(StreamEvent::Video(_frame)) => {
                // Production-Ready Hardware Pipeline Integration Point:
                // 1. We receive BGRA raw frame from GPU via crabgrab (Zero-Copy DXGI).
                // 2. We pass this frame to a Windows Media Foundation (WMF) Sink Writer instance.
                // 3. WMF uses NVENC/AMF to produce an H.264 NAL Unit asynchronously.
                // 4. We take that NAL Unit and write it to the WebRTC TrackLocalStaticSample.

                // let buffer = frame.video_frame_buffer();
                // let nal_units = wmf_encoder.encode(buffer).await;
                // video_track_clone.write_sample(nal_units, duration).await;
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
