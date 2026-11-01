//! Native (hardware H.264) screen share: Tauri commands and the session slot.
//!
//! Module map:
//! * [`session`] — `ShareSession`, the owner of everything one go-live creates
//!   (PC + tasks, capture, encoder, audio, watchdogs, preview) with one
//!   cancellation token and one teardown path.
//! * [`transport`] — peer connection / track / writer / RTCP / keyframe-on-
//!   connect, shared by the SFU publisher and the preview loopback.
//! * [`capture`] — capture-source resolution, capture-mode selection, and the
//!   game-capture hook thread.
//! * [`audio`] — loopback capture + Opus + the ordered audio writer.
//! * [`quality`] — presets, aspect-preserving fit, resize debounce (pure).
//! * [`stats`] — pipeline counters and the `Capture_Status` snapshot.
//!
//! [`NativeShareState`] holds only the lifecycle gate, the current-session
//! slot, and the stats the renderer polls.

mod audio;
mod capture;
pub mod quality;
mod session;
pub mod stats;
mod transport;

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use tokio::sync::Mutex;
use webrtc::peer_connection::peer_connection_state::RTCPeerConnectionState;

pub use capture::should_notify_hook_unavailable;
pub use quality::{parse_quality_params, QualityParams};
pub use session::ShareEndedPayload;
pub use stats::{NativeShareStats, NativeShareStatsSnapshot};

use session::{start_session, take_if_current, ShareSession, StartRequest};
use stats::reset_native_share_stats;

// A single successfully written video sample is enough for the receiver to
// paint the stream. Requiring multiple writes needlessly delays go-live on
// static windows that only produce one startup frame until the content changes.
pub(crate) const VIDEO_FLOW_CONFIRMATION_SAMPLES: u64 = 1;

// ── Shared Tauri state ─────────────────────────────────────────────────────

#[derive(Default)]
pub struct NativeShareState {
    /// Serializes start/stop/update/preview lifecycle operations. Every wait
    /// performed while holding it is bounded (teardown uses timeouts).
    lifecycle_gate: Mutex<()>,
    /// The current session, if any. Lock order: `lifecycle_gate` first.
    session: Mutex<Option<ShareSession>>,
    next_session_id: AtomicU64,
    /// Pipeline stats the renderer polls. Reset at every session start/stop.
    pub stats: Arc<NativeShareStats>,
}

/// Take the current session out of the slot and tear it down. The caller holds
/// the lifecycle gate.
async fn stop_current_session(state: &NativeShareState) -> bool {
    let session = state.session.lock().await.take();
    let stopped = match session {
        Some(session) => {
            session.shutdown().await;
            true
        }
        None => false,
    };
    reset_native_share_stats(&state.stats);
    stopped
}

/// End session `id` if it is still the current one (a session ending itself:
/// source closed, connection lost). Returns whether it was current.
pub(crate) async fn end_session_if_current(state: &NativeShareState, id: u64) -> bool {
    let _lifecycle_guard = state.lifecycle_gate.lock().await;
    let session = take_if_current(&mut *state.session.lock().await, id);
    match session {
        Some(session) => {
            session.shutdown().await;
            reset_native_share_stats(&state.stats);
            true
        }
        None => false,
    }
}

// ── Updater / app-exit handoff ─────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct NativeShareUpdatePreparationSnapshot {
    pub session_active: bool,
    pub preview_pc: bool,
    pub game_hook: bool,
    pub stats: NativeShareStatsSnapshot,
}

impl NativeShareUpdatePreparationSnapshot {
    fn has_live_resources(&self) -> bool {
        self.session_active || self.preview_pc || self.game_hook
    }

    fn hook_related_active(&self) -> bool {
        self.game_hook
            || self.stats.capture_mode == "hook"
            || self.stats.active_backend != "n/a"
            || self.stats.foreign_hook
    }

    fn requires_shutdown(&self) -> bool {
        self.has_live_resources() || self.hook_related_active()
    }
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct NativeShareUpdatePreparationReport {
    pub before: NativeShareUpdatePreparationSnapshot,
    pub after: NativeShareUpdatePreparationSnapshot,
}

impl NativeShareUpdatePreparationReport {
    pub fn shutdown_required(&self) -> bool {
        self.before.requires_shutdown()
    }

    pub fn hook_related_state_was_active(&self) -> bool {
        self.before.hook_related_active()
    }

    pub fn residual_state_detected(&self) -> bool {
        self.after.requires_shutdown()
    }
}

async fn snapshot_update_preparation_state(
    state: &NativeShareState,
) -> NativeShareUpdatePreparationSnapshot {
    let slot = state.session.lock().await;
    NativeShareUpdatePreparationSnapshot {
        session_active: slot.is_some(),
        preview_pc: slot.as_ref().is_some_and(ShareSession::has_preview),
        game_hook: slot.as_ref().is_some_and(ShareSession::has_hook),
        stats: state.stats.snapshot(),
    }
}

fn log_update_preparation_state(stage: &str, snapshot: &NativeShareUpdatePreparationSnapshot) {
    log::info!(
        "[NativeShare][UpdatePrep] stage={} session_active={} preview_pc={} game_hook={} shutdown_required={} hook_related_active={} mode={} backend={} fallback={} policy={} unavailable={} foreign_hook={} negotiated={:?}x{:?}@{:?} captured={} encoded={} samples={} dropped={}",
        stage,
        snapshot.session_active,
        snapshot.preview_pc,
        snapshot.game_hook,
        snapshot.requires_shutdown(),
        snapshot.hook_related_active(),
        snapshot.stats.capture_mode,
        snapshot.stats.active_backend,
        snapshot.stats.fallback_reason,
        snapshot.stats.capture_policy,
        snapshot.stats.capture_unavailable,
        snapshot.stats.foreign_hook,
        snapshot.stats.negotiated_width,
        snapshot.stats.negotiated_height,
        snapshot.stats.negotiated_fps,
        snapshot.stats.captured_frames,
        snapshot.stats.encoded_frames,
        snapshot.stats.samples_written,
        snapshot.stats.dropped_frames,
    );
}

/// Stop any native share before an update install / app exit, reporting what
/// was live before and whether anything survived.
pub(crate) async fn prepare_native_share_for_update(
    state: &NativeShareState,
) -> NativeShareUpdatePreparationReport {
    let _lifecycle_guard = state.lifecycle_gate.lock().await;
    let before = snapshot_update_preparation_state(state).await;
    log_update_preparation_state("before", &before);

    if before.requires_shutdown() {
        stop_current_session(state).await;
    }

    let after = snapshot_update_preparation_state(state).await;
    log_update_preparation_state("after", &after);

    NativeShareUpdatePreparationReport { before, after }
}

// ── Signaling payloads ─────────────────────────────────────────────────────

#[derive(serde::Serialize, serde::Deserialize)]
pub struct SdpOfferPayload {
    pub sdp: String,
    pub r#type: String,
}

impl SdpOfferPayload {
    fn offer(sdp: String) -> Self {
        Self {
            sdp,
            r#type: "offer".to_string(),
        }
    }
}

#[derive(Clone, Debug, serde::Deserialize)]
pub struct NativeIceServer {
    pub urls: Vec<String>,
    pub username: Option<String>,
    pub credential: Option<String>,
}

// ── Commands ───────────────────────────────────────────────────────────────

/// Start a native share for `source_id`, replacing any running session, and
/// return the SDP offer (with gathered ICE candidates) for the SFU.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
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
    let _lifecycle_guard = state.lifecycle_gate.lock().await;
    let _ = source_name; // WGC needs only the HWND / monitor index.
    let quality = quality.unwrap_or_else(|| "720p30".to_string());
    let with_audio = with_audio.unwrap_or(false);
    log::info!(
        "[NativeShare] start request source_id={} quality={} with_audio={} ice_servers={}",
        source_id,
        quality,
        with_audio,
        ice_servers.as_ref().map(Vec::len).unwrap_or(0)
    );

    // B3: a new go-live always replaces the previous session completely.
    if stop_current_session(&state).await {
        log::info!("[NativeShare] stopped the previous session before starting a new one");
    }

    let id = state.next_session_id.fetch_add(1, Ordering::Relaxed) + 1;
    let request = StartRequest {
        source_id,
        quality,
        track_name: track_name.unwrap_or_else(|| "screen_share".to_owned()),
        audio_track_name: audio_track_name.unwrap_or_else(|| "screen_audio".to_owned()),
        with_audio,
        ice_servers,
    };
    match start_session(app, id, Arc::clone(&state.stats), request).await {
        Ok((session, sdp)) => {
            *state.session.lock().await = Some(session);
            log::info!("[NativeShare] session {id} started");
            Ok(SdpOfferPayload::offer(sdp))
        }
        Err(e) => {
            reset_native_share_stats(&state.stats);
            Err(e)
        }
    }
}

#[tauri::command]
pub async fn handle_sdp_answer(
    state: tauri::State<'_, NativeShareState>,
    sdp: String,
) -> Result<(), String> {
    log::info!("[NativeShare] handle_sdp_answer sdp_len={}", sdp.len());
    // Clone the PC out so the slot lock is not held across the await.
    let pc = state
        .session
        .lock()
        .await
        .as_ref()
        .and_then(ShareSession::peer_connection)
        .ok_or("No active WebRTC connection")?;
    transport::apply_answer(&pc, sdp).await?;
    log::info!("[NativeShare] handle_sdp_answer applied");
    Ok(())
}

#[tauri::command]
pub async fn wait_native_screen_share_connected(
    state: tauri::State<'_, NativeShareState>,
    timeout_ms: Option<u64>,
) -> Result<String, String> {
    let timeout_ms = timeout_ms.unwrap_or(15_000);
    log::info!("[NativeShare] wait_native_screen_share_connected timeout_ms={timeout_ms}");
    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(timeout_ms);
    let stats = &state.stats;

    loop {
        let pc = state
            .session
            .lock()
            .await
            .as_ref()
            .and_then(ShareSession::peer_connection)
            .ok_or_else(|| "No active WebRTC connection".to_string())?;

        let connection_state = pc.connection_state();
        let samples_written = stats.samples_written.load(Ordering::Relaxed);
        let audio_samples_written = stats.audio_samples_written.load(Ordering::Relaxed);
        let captured_frames = stats.captured_frames.load(Ordering::Relaxed);
        let encoded_frames = stats.encoded_frames.load(Ordering::Relaxed);
        let encode_errors = stats.encode_errors.load(Ordering::Relaxed);
        let write_errors = stats.write_errors.load(Ordering::Relaxed);
        let dropped_frames = stats.dropped_frames.load(Ordering::Relaxed);
        let counters = format!(
            "connection={connection_state}, captured_frames={captured_frames}, encoded_frames={encoded_frames}, encode_errors={encode_errors}, samples_written={samples_written}, audio_samples_written={audio_samples_written}, write_errors={write_errors}, dropped_frames={dropped_frames}"
        );

        match connection_state {
            RTCPeerConnectionState::Connected
                if samples_written >= VIDEO_FLOW_CONFIRMATION_SAMPLES =>
            {
                log::info!("[NativeShare] wait_native_screen_share_connected success {counters}");
                return Ok(format!(
                    "connected;samples_written={samples_written};audio_samples_written={audio_samples_written}"
                ));
            }
            RTCPeerConnectionState::Failed | RTCPeerConnectionState::Closed => {
                log::warn!("[NativeShare] wait_native_screen_share_connected terminal {counters}");
                return Err(format!(
                    "Native WebRTC connection ended before media could flow: {connection_state}"
                ));
            }
            _ => {}
        }

        if stats.capture_unavailable.load(Ordering::Relaxed) {
            log::warn!(
                "[NativeShare] wait_native_screen_share_connected capture_unavailable {counters}"
            );
            return Err(format!(
                "Native capture became unavailable before media could flow: {counters}"
            ));
        }

        if captured_frames >= 30 && encoded_frames == 0 && encode_errors >= 25 {
            log::warn!(
                "[NativeShare] wait_native_screen_share_connected encoder_failed {counters}"
            );
            return Err(format!("Native hardware video encoder failed; {counters}"));
        }

        if std::time::Instant::now() >= deadline {
            log::warn!("[NativeShare] wait_native_screen_share_connected timeout {counters}");
            return Err(format!("Timed out waiting for native media; {counters}"));
        }

        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
}

#[tauri::command]
pub async fn stop_native_screen_share(
    state: tauri::State<'_, NativeShareState>,
) -> Result<(), String> {
    let _lifecycle_guard = state.lifecycle_gate.lock().await;
    stop_current_session(&state).await;
    Ok(())
}

/// Change the encode quality of the LIVE share in place: the encoder refits the
/// source aspect ratio inside the new preset box and emits a fresh keyframe —
/// no re-injection, new capture session, renegotiation, or track teardown.
/// Errors when no session is active (the caller then does a full restart).
#[tauri::command]
pub async fn update_native_screen_quality(
    state: tauri::State<'_, NativeShareState>,
    quality: String,
) -> Result<(), String> {
    let _lifecycle_guard = state.lifecycle_gate.lock().await;
    let slot = state.session.lock().await;
    let session = slot
        .as_ref()
        .ok_or("No active native screen share to reconfigure")?;
    let (max_width, max_height, fps, bitrate) = session.update_quality(&quality)?;
    log::info!(
        "[NativeShare] live quality switch → {quality} (box {max_width}x{max_height} @ {fps}fps, {bitrate} bps)"
    );
    Ok(())
}

/// Lock-free snapshot of the pipeline stats (zeroed / `wgc` defaults when no
/// session is active).
#[tauri::command]
pub async fn get_native_screen_share_stats(
    state: tauri::State<'_, NativeShareState>,
) -> Result<NativeShareStatsSnapshot, String> {
    Ok(state.stats.snapshot())
}

// ── Preview loopback ───────────────────────────────────────────────────────
//
// The local preview tile can be fed from a localhost PeerConnection carrying
// the SAME encoded H.264 samples the SFU receives — one encoder, two
// consumers, no second capture. Owned by the session; stopping the session
// stops it.

#[tauri::command]
pub async fn start_preview_loopback<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, NativeShareState>,
) -> Result<SdpOfferPayload, String> {
    let _lifecycle_guard = state.lifecycle_gate.lock().await;
    let mut slot = state.session.lock().await;
    let session = slot
        .as_mut()
        .ok_or("No active native share session for the preview")?;
    let sdp = session.start_preview(&app).await?;
    Ok(SdpOfferPayload::offer(sdp))
}

#[tauri::command]
pub async fn handle_preview_loopback_answer(
    state: tauri::State<'_, NativeShareState>,
    sdp: String,
) -> Result<(), String> {
    let pc = state
        .session
        .lock()
        .await
        .as_ref()
        .and_then(ShareSession::preview_peer_connection)
        .ok_or("No preview loopback PC")?;
    transport::apply_answer(&pc, sdp).await
}

#[tauri::command]
pub async fn stop_preview_loopback(
    state: tauri::State<'_, NativeShareState>,
) -> Result<(), String> {
    let _lifecycle_guard = state.lifecycle_gate.lock().await;
    if let Some(session) = state.session.lock().await.as_mut() {
        if session.stop_preview().await {
            log::info!("[NativeShare] preview loopback PC stopped");
        }
    }
    Ok(())
}

#[cfg(test)]
mod update_preparation_tests {
    use super::*;

    fn prep_snapshot() -> NativeShareUpdatePreparationSnapshot {
        NativeShareUpdatePreparationSnapshot {
            session_active: false,
            preview_pc: false,
            game_hook: false,
            stats: NativeShareStats::default().snapshot(),
        }
    }

    #[test]
    fn preparation_snapshot_requires_shutdown_for_live_resources() {
        let mut snapshot = prep_snapshot();
        snapshot.preview_pc = true;

        assert!(snapshot.has_live_resources());
        assert!(snapshot.requires_shutdown());
        assert!(!snapshot.hook_related_active());
    }

    #[test]
    fn preparation_snapshot_requires_shutdown_for_hook_related_state() {
        let mut snapshot = prep_snapshot();
        snapshot.stats.capture_mode = "hook".to_string();
        snapshot.stats.active_backend = "dx11".to_string();

        assert!(!snapshot.has_live_resources());
        assert!(snapshot.hook_related_active());
        assert!(snapshot.requires_shutdown());
    }

    #[test]
    fn preparation_report_detects_residual_state() {
        let before = prep_snapshot();
        let mut after = prep_snapshot();
        after.game_hook = true;

        let report = NativeShareUpdatePreparationReport { before, after };
        assert!(!report.shutdown_required());
        assert!(!report.hook_related_state_was_active());
        assert!(report.residual_state_detected());
    }

    #[test]
    fn state_default_snapshot_is_zeroed_wgc() {
        let state = NativeShareState::default();
        assert_eq!(
            state.stats.snapshot(),
            NativeShareStats::default().snapshot()
        );
    }

    #[test]
    fn state_snapshot_reflects_live_session_stats() {
        use crate::game_capture::CaptureMode;
        let state = NativeShareState::default();
        let shared = Arc::clone(&state.stats);
        shared.captured_frames.store(120, Ordering::Relaxed);
        shared.encoded_frames.store(118, Ordering::Relaxed);
        shared.dropped_frames.store(2, Ordering::Relaxed);
        shared.record_fused_gpu_ns(450_000);
        shared.record_encode_submit_ns(1_200_000);
        shared.set_capture_mode(CaptureMode::Hook);

        let snap = state.stats.snapshot();
        assert_eq!(snap.capture_mode, "hook");
        assert_eq!(snap.captured_frames, 120);
        assert_eq!(snap.encoded_frames, 118);
        assert_eq!(snap.dropped_frames, 2);
        assert_eq!(snap.last_fused_gpu_us, 450);
        assert_eq!(snap.last_encode_submit_us, 1_200);
    }

    #[test]
    fn a_fresh_state_reports_nothing_to_shut_down() {
        let state = NativeShareState::default();
        let rt = tokio::runtime::Builder::new_current_thread()
            .build()
            .unwrap();
        let report = rt.block_on(prepare_native_share_for_update(&state));
        assert!(!report.shutdown_required());
        assert!(!report.residual_state_detected());
    }
}
