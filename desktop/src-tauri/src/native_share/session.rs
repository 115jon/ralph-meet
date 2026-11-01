//! [`ShareSession`]: everything one native go-live creates — the SFU peer
//! connection and its tasks, the capture source (WGC or the game-capture hook),
//! the encoder worker, audio, watchdogs, and the preview loopback — owned in
//! one place with ONE cancellation token.
//!
//! * Start builds the session incrementally; any failure tears down whatever
//!   was already built through the same [`ShareSession::shutdown`] path.
//! * Stop/drop cancels the token first (every task and thread watches it),
//!   closes the peer connections with a timeout, then joins the blocking parts
//!   (encoder, hook thread, audio/watchdog threads) on the blocking pool with a
//!   timeout, so a wedged GPU or driver can never hang the lifecycle gate.
//! * A session can end itself (source closed, connection lost) through its
//!   [`SessionEnder`], which only acts while that session is still current.

#[cfg(all(feature = "game-capture-hook", windows))]
use std::sync::atomic::AtomicU64;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex as StdMutex};
use std::time::{Duration, Instant};

use bytes::Bytes;
use tauri::{Emitter, Manager};
use tokio::sync::broadcast;
use tokio::task::JoinHandle;
use webrtc::peer_connection::peer_connection_state::RTCPeerConnectionState;
use webrtc::peer_connection::RTCPeerConnection;
use webrtc::track::track_local::track_local_static_sample::TrackLocalStaticSample;

use super::capture::{resolve_wgc_item, select_capture, source_still_live, CaptureSelection};
use super::quality::{even_dimension, parse_quality_params, quality_preset, QualityParams};
use super::stats::NativeShareStats;
use super::transport::{
    self, add_track, create_gathered_offer, h264_track, new_peer_connection, opus_track,
    spawn_video_pipeline, EncodedFeed, VideoPipeline,
};
use super::{NativeIceServer, NativeShareState, VIDEO_FLOW_CONFIRMATION_SAMPLES};
use crate::d3d_device::D3dDevice;
use crate::game_capture::{CaptureMode, FallbackReason, SourceKind};
use crate::wgc_capture::{ItemClosedCallback, WgcCapture};
use crate::wmf_encoder::{
    EncoderControlHandle, EncoderReconfig, FrameSender, MftEncoderWorker, VideoCodec,
};

/// How long start waits for ICE gathering before returning the offer. Host and
/// srflx candidates are normally ready within a few hundred ms; TURN relay
/// probing can take seconds and is not worth delaying go-live for.
const ICE_GATHER_BUDGET: Duration = Duration::from_millis(700);
/// The preview loopback is localhost-only (host candidates, typically <50 ms).
const PREVIEW_GATHER_BUDGET: Duration = Duration::from_millis(200);
/// Bound on `RTCPeerConnection::close` during teardown.
const PC_CLOSE_TIMEOUT: Duration = Duration::from_secs(3);
/// Bound on joining the blocking parts during teardown. After this the join
/// continues detached; the lifecycle gate is released regardless.
const TEARDOWN_JOIN_TIMEOUT: Duration = Duration::from_secs(5);
/// A `Disconnected` peer connection gets this long to recover before the
/// session ends itself.
pub(crate) const DISCONNECT_GRACE: Duration = Duration::from_secs(5);
/// Encoded H.264 access units buffered between the encoder and the writer.
const ENCODED_QUEUE: usize = 16;
/// Fan-out to the preview loopback; a lagging preview skips ahead and asks for
/// a keyframe instead of back-pressuring the SFU path.
const PREVIEW_TAP_CAPACITY: usize = 64;

// ── Cancellation ───────────────────────────────────────────────────────────

/// One-shot cancellation signal usable from async tasks
/// ([`CancelToken::cancelled`]) and plain threads ([`CancelToken::wait_timeout`]).
/// Each session owns its own token, so cancelling an old session can never
/// affect a newer one (B2).
#[derive(Clone, Default)]
pub struct CancelToken(Arc<CancelInner>);

#[derive(Default)]
struct CancelInner {
    cancelled: AtomicBool,
    notify: tokio::sync::Notify,
    lock: StdMutex<()>,
    condvar: Condvar,
}

impl CancelToken {
    pub fn new() -> Self {
        Self::default()
    }

    /// Fire the token. Idempotent; wakes every async and thread waiter.
    pub fn cancel(&self) {
        if self.0.cancelled.swap(true, Ordering::SeqCst) {
            return;
        }
        self.0.notify.notify_waiters();
        let _guard = self.0.lock.lock().unwrap_or_else(|p| p.into_inner());
        self.0.condvar.notify_all();
    }

    pub fn is_cancelled(&self) -> bool {
        self.0.cancelled.load(Ordering::SeqCst)
    }

    /// Resolves once the token fires.
    pub async fn cancelled(&self) {
        loop {
            // Register before checking so a concurrent `cancel` cannot slip
            // between the check and the await.
            let notified = self.0.notify.notified();
            if self.is_cancelled() {
                return;
            }
            notified.await;
        }
    }

    /// Block the current thread for up to `timeout`, returning early when the
    /// token fires. Returns whether the token has fired.
    pub fn wait_timeout(&self, timeout: Duration) -> bool {
        let guard = self.0.lock.lock().unwrap_or_else(|p| p.into_inner());
        if self.is_cancelled() {
            return true;
        }
        let _ = self
            .0
            .condvar
            .wait_timeout_while(guard, timeout, |_| !self.is_cancelled())
            .unwrap_or_else(|p| p.into_inner());
        self.is_cancelled()
    }

    /// Block the current thread until the token fires.
    #[cfg_attr(not(feature = "game-capture-hook"), allow(dead_code))]
    pub fn wait(&self) {
        while !self.wait_timeout(Duration::from_secs(1)) {}
    }
}

// ── Self-ending ────────────────────────────────────────────────────────────

/// Why a session ended itself.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum EndReason {
    /// The captured window/monitor went away. Carries the stable
    /// [`FallbackReason`] string (e.g. `target_exited`).
    SourceClosed(String),
    /// The SFU peer connection failed, or stayed disconnected past
    /// [`DISCONNECT_GRACE`]. Carries the terminal state.
    ConnectionFailed(String),
}

/// Payload of the `native-screen-share-ended` event.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct ShareEndedPayload {
    /// `"source-closed"` or `"connection-failed"`.
    pub reason: &'static str,
    pub detail: String,
}

impl EndReason {
    pub(crate) fn payload(&self) -> ShareEndedPayload {
        match self {
            EndReason::SourceClosed(detail) => ShareEndedPayload {
                reason: "source-closed",
                detail: detail.clone(),
            },
            EndReason::ConnectionFailed(detail) => ShareEndedPayload {
                reason: "connection-failed",
                detail: detail.clone(),
            },
        }
    }
}

/// Ends the session it was created for — tears it down and emits
/// `native-screen-share-ended` — but only if that session is still the
/// current one. Fires at most once; safe to call from any thread.
pub(crate) type SessionEnder = Arc<dyn Fn(EndReason) + Send + Sync>;

fn session_ender<R: tauri::Runtime>(app: tauri::AppHandle<R>, session_id: u64) -> SessionEnder {
    let fired = Arc::new(AtomicBool::new(false));
    Arc::new(move |reason: EndReason| {
        if fired.swap(true, Ordering::AcqRel) {
            return;
        }
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let state = app.state::<NativeShareState>();
            if super::end_session_if_current(state.inner(), session_id).await {
                let payload = reason.payload();
                log::info!(
                    "[NativeShare] session {session_id} ended itself: {} ({})",
                    payload.reason,
                    payload.detail
                );
                let _ = app.emit("native-screen-share-ended", payload);
            }
        });
    })
}

/// Tracks the SFU peer connection after it first connects and decides when the
/// session should end itself: immediately on `Failed`, or after a
/// `Disconnected` that does not recover within `grace`. Failures before the
/// first connect are left to the start path (`wait_native_screen_share_connected`).
#[derive(Debug)]
pub(crate) struct ConnectionWatch {
    connected_once: bool,
    disconnected_since: Option<Instant>,
    grace: Duration,
}

impl ConnectionWatch {
    pub(crate) fn new(grace: Duration) -> Self {
        Self {
            connected_once: false,
            disconnected_since: None,
            grace,
        }
    }

    /// Feed the current state; returns the terminal state name when the
    /// session should end.
    pub(crate) fn observe(
        &mut self,
        state: RTCPeerConnectionState,
        now: Instant,
    ) -> Option<&'static str> {
        match state {
            RTCPeerConnectionState::Connected => {
                self.connected_once = true;
                self.disconnected_since = None;
                None
            }
            RTCPeerConnectionState::Disconnected if self.connected_once => {
                let since = *self.disconnected_since.get_or_insert(now);
                (now.saturating_duration_since(since) >= self.grace).then_some("disconnected")
            }
            RTCPeerConnectionState::Failed if self.connected_once => Some("failed"),
            _ => None,
        }
    }
}

fn spawn_connection_watch(
    pc: Arc<RTCPeerConnection>,
    cancel: CancelToken,
    ender: SessionEnder,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut watch = ConnectionWatch::new(DISCONNECT_GRACE);
        loop {
            tokio::select! {
                _ = cancel.cancelled() => return,
                _ = tokio::time::sleep(Duration::from_millis(250)) => {}
            }
            let state = pc.connection_state();
            if state == RTCPeerConnectionState::Closed {
                return;
            }
            if let Some(detail) = watch.observe(state, Instant::now()) {
                log::warn!("[NativeShare] peer connection {detail}; ending native share");
                ender(EndReason::ConnectionFailed(detail.to_string()));
                return;
            }
        }
    })
}

// ── Session slot helpers ───────────────────────────────────────────────────

/// Anything that knows which session it is.
pub(crate) trait SessionIdentity {
    fn session_id(&self) -> u64;
}

/// Take the session out of `slot` only if it is session `id`. A late end
/// request from an old session therefore never touches a newer one.
pub(crate) fn take_if_current<T: SessionIdentity>(slot: &mut Option<T>, id: u64) -> Option<T> {
    if slot.as_ref().is_some_and(|s| s.session_id() == id) {
        slot.take()
    } else {
        None
    }
}

// ── Start request ──────────────────────────────────────────────────────────

pub(crate) struct StartRequest {
    pub(crate) source_id: String,
    pub(crate) quality: String,
    pub(crate) track_name: String,
    pub(crate) audio_track_name: String,
    pub(crate) with_audio: bool,
    pub(crate) ice_servers: Option<Vec<NativeIceServer>>,
}

/// The blocking half of start: resolve the capture item, size the encode, open
/// the shared D3D device, and select (and possibly inject) the capture path.
struct MediaPrep {
    item: windows::Graphics::Capture::GraphicsCaptureItem,
    src: (u32, u32),
    params: QualityParams,
    d3d: Arc<D3dDevice>,
    selection: CaptureSelection,
}

impl MediaPrep {
    fn build<R: tauri::Runtime>(
        app: &tauri::AppHandle<R>,
        source_id: &str,
        quality: &str,
        stats: &NativeShareStats,
    ) -> Result<Self, String> {
        let item = resolve_wgc_item(source_id)?;
        let size = item.Size().map_err(|e| e.to_string())?;
        let src = (
            even_dimension(size.Width.max(0) as u32),
            even_dimension(size.Height.max(0) as u32),
        );
        let params = parse_quality_params(quality, src.0, src.1);
        log::info!(
            "[NativeShare] source={}x{} box={}x{} target={}x{} fps={} bitrate={}",
            src.0,
            src.1,
            params.max_width,
            params.max_height,
            params.width,
            params.height,
            params.fps,
            params.bitrate
        );
        let d3d = D3dDevice::new().map_err(|e| format!("Create D3D11 device: {e}"))?;
        let selection = select_capture(app, &d3d, source_id, params.fps, stats);
        Ok(Self {
            item,
            src,
            params,
            d3d,
            selection,
        })
    }
}

/// Build a new session. On failure everything already built is torn down
/// before the error is returned (B1).
pub(crate) async fn start_session<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    id: u64,
    stats: Arc<NativeShareStats>,
    request: StartRequest,
) -> Result<(ShareSession, String), String> {
    let prep = {
        let app = app.clone();
        let stats = Arc::clone(&stats);
        let source_id = request.source_id.clone();
        let quality = request.quality.clone();
        tauri::async_runtime::spawn_blocking(move || {
            MediaPrep::build(&app, &source_id, &quality, &stats)
        })
        .await
        .map_err(|e| format!("Capture setup task failed: {e}"))??
    };

    let mut session = ShareSession::new(id, stats);
    match session.build(app, request, prep).await {
        Ok(sdp) => Ok((session, sdp)),
        Err(e) => {
            log::warn!("[NativeShare] start failed ({e}); tearing down the partial session");
            session.shutdown().await;
            Err(e)
        }
    }
}

// ── The session ────────────────────────────────────────────────────────────

/// A live (or partially built) native share. See the module docs.
pub(crate) struct ShareSession {
    id: u64,
    cancel: CancelToken,
    stats: Arc<NativeShareStats>,
    pc: Option<Arc<RTCPeerConnection>>,
    encoder: Option<MftEncoderWorker>,
    control: Option<EncoderControlHandle>,
    /// The WGC capture (also the hook path's pre-roll, which the hook thread
    /// retires once the first hook frame arrives).
    wgc: Arc<StdMutex<Option<WgcCapture>>>,
    #[cfg(all(feature = "game-capture-hook", windows))]
    hook: Option<super::capture::HookCaptureSession>,
    /// The DLL capture-rate cap the hook thread pushes into `hook_info`.
    #[cfg(all(feature = "game-capture-hook", windows))]
    frame_interval_ns: Arc<AtomicU64>,
    /// Audio / watchdog / diagnostics threads (shared so the deferred audio
    /// start can register its thread later).
    threads: Arc<StdMutex<Vec<std::thread::JoinHandle<()>>>>,
    tasks: Vec<JoinHandle<()>>,
    preview_tap: broadcast::Sender<Bytes>,
    preview: Option<PreviewLoopback>,
}

impl SessionIdentity for ShareSession {
    fn session_id(&self) -> u64 {
        self.id
    }
}

/// The parts of a session whose teardown blocks (thread joins, WinRT Close).
struct BlockingParts {
    wgc: Option<WgcCapture>,
    #[cfg(all(feature = "game-capture-hook", windows))]
    hook: Option<super::capture::HookCaptureSession>,
    encoder: Option<MftEncoderWorker>,
    threads: Vec<std::thread::JoinHandle<()>>,
}

impl BlockingParts {
    fn is_empty(&self) -> bool {
        #[cfg(all(feature = "game-capture-hook", windows))]
        let hook_empty = self.hook.is_none();
        #[cfg(not(all(feature = "game-capture-hook", windows)))]
        let hook_empty = true;
        self.wgc.is_none() && hook_empty && self.encoder.is_none() && self.threads.is_empty()
    }

    /// Stop the frame sources first (so nothing feeds the encoder), then the
    /// encoder, then the helper threads. The token is already cancelled.
    fn join_all(mut self) {
        drop(self.wgc.take());
        #[cfg(all(feature = "game-capture-hook", windows))]
        if let Some(mut hook) = self.hook.take() {
            hook.stop();
        }
        if let Some(mut encoder) = self.encoder.take() {
            encoder.stop();
        }
        for thread in self.threads.drain(..) {
            let _ = thread.join();
        }
    }
}

impl ShareSession {
    fn new(id: u64, stats: Arc<NativeShareStats>) -> Self {
        let (preview_tap, _) = broadcast::channel(PREVIEW_TAP_CAPACITY);
        Self {
            id,
            cancel: CancelToken::new(),
            stats,
            pc: None,
            encoder: None,
            control: None,
            wgc: Arc::new(StdMutex::new(None)),
            #[cfg(all(feature = "game-capture-hook", windows))]
            hook: None,
            #[cfg(all(feature = "game-capture-hook", windows))]
            frame_interval_ns: Arc::new(AtomicU64::new(0)),
            threads: Arc::new(StdMutex::new(Vec::new())),
            tasks: Vec::new(),
            preview_tap,
            preview: None,
        }
    }

    pub(crate) fn peer_connection(&self) -> Option<Arc<RTCPeerConnection>> {
        self.pc.clone()
    }

    pub(crate) fn preview_peer_connection(&self) -> Option<Arc<RTCPeerConnection>> {
        self.preview.as_ref().and_then(|p| p.pc.clone())
    }

    pub(crate) fn has_preview(&self) -> bool {
        self.preview.is_some()
    }

    pub(crate) fn has_hook(&self) -> bool {
        #[cfg(all(feature = "game-capture-hook", windows))]
        {
            self.hook.is_some()
        }
        #[cfg(not(all(feature = "game-capture-hook", windows)))]
        {
            false
        }
    }

    fn push_thread(&self, handle: Option<std::thread::JoinHandle<()>>) {
        if let Some(handle) = handle {
            self.threads
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .push(handle);
        }
    }

    async fn build<R: tauri::Runtime>(
        &mut self,
        app: tauri::AppHandle<R>,
        request: StartRequest,
        prep: MediaPrep,
    ) -> Result<String, String> {
        let MediaPrep {
            item,
            src,
            params,
            d3d,
            selection,
        } = prep;
        let ender = session_ender(app.clone(), self.id);

        // Peer connection + tracks.
        let pc = new_peer_connection(transport::ice_servers(request.ice_servers)).await?;
        self.pc = Some(Arc::clone(&pc));
        {
            let app = app.clone();
            pc.on_peer_connection_state_change(Box::new(move |s| {
                log::info!("[NativeShare] peer_connection_state={s}");
                let _ = app.emit("native-screen-share-status", format!("pc:{s}"));
                Box::pin(async {})
            }));
        }
        let video_track = h264_track(request.track_name);
        let video_sender = add_track(&pc, &video_track).await?;
        let audio_track = if request.with_audio {
            let track = opus_track(request.audio_track_name);
            add_track(&pc, &track).await?;
            Some(track)
        } else {
            None
        };

        // Encoder (blocking init, bounded by its own timeout).
        let (encoded_tx, encoded_rx) = tokio::sync::mpsc::channel(ENCODED_QUEUE);
        let encoder = {
            let d3d = Arc::clone(&d3d);
            let stats = Arc::clone(&self.stats);
            tauri::async_runtime::spawn_blocking(move || {
                MftEncoderWorker::new(
                    VideoCodec::H264,
                    src.0,
                    src.1,
                    params.max_width,
                    params.max_height,
                    params.fps,
                    params.bitrate,
                    d3d,
                    encoded_tx,
                    stats,
                )
            })
            .await
            .map_err(|e| format!("Encoder setup task failed: {e}"))?
            .map_err(|e| format!("Start encoder worker: {e}"))?
        };
        let control = encoder.control_handle();
        let frames = encoder.frame_sender();
        self.encoder = Some(encoder);
        self.control = Some(control.clone());

        // SFU writer + RTCP keyframes + keyframe-on-connect, and the
        // mid-session connection watch.
        self.tasks.extend(spawn_video_pipeline(VideoPipeline {
            label: "sfu",
            pc: Arc::clone(&pc),
            track: video_track,
            sender: video_sender,
            feed: EncodedFeed::Encoder {
                rx: encoded_rx,
                tap: self.preview_tap.clone(),
            },
            control,
            stats: Some(Arc::clone(&self.stats)),
            fps_hint: params.fps,
            cancel: self.cancel.clone(),
        }));
        self.tasks.push(spawn_connection_watch(
            Arc::clone(&pc),
            self.cancel.clone(),
            Arc::clone(&ender),
        ));

        let is_window = selection.source_kind == SourceKind::Window;
        self.start_frame_source(
            &app,
            &request.source_id,
            item,
            &d3d,
            frames,
            &params,
            selection,
            &ender,
        )?;

        #[cfg(target_os = "windows")]
        if let Some(track) = audio_track {
            self.start_audio(track, &pc, &request.source_id);
        }
        #[cfg(not(target_os = "windows"))]
        let _ = audio_track;

        // The hook thread watches its own source; WGC window shares (and the
        // hook's WGC pre-roll) get an IsWindow watchdog in case the capture
        // item's Closed event does not fire.
        if is_window {
            self.push_thread(spawn_window_watchdog(
                request.source_id.clone(),
                self.cancel.clone(),
                Arc::clone(&ender),
            ));
        }
        self.push_thread(spawn_diagnostics(
            request.source_id,
            self.cancel.clone(),
            Arc::clone(&pc),
            Arc::clone(&self.stats),
        ));

        create_gathered_offer(&pc, ICE_GATHER_BUDGET).await
    }

    /// Start the frame source the capture selection chose:
    ///
    /// * `hook` — the zero-copy game-capture hook feeds the encoder (Req 7.1),
    ///   with a WGC pre-roll for window sources until the first hook frame.
    /// * capture-unavailable — hook-exclusive policy with the hook unavailable:
    ///   no frame source runs (Req 5.3).
    /// * `wgc` — the guaranteed path; WGC follows the source size.
    #[allow(clippy::too_many_arguments)]
    // `wgc_preroll` is only read again by the hook path.
    #[cfg_attr(not(feature = "game-capture-hook"), allow(unused_assignments))]
    fn start_frame_source<R: tauri::Runtime>(
        &mut self,
        app: &tauri::AppHandle<R>,
        source_id: &str,
        item: windows::Graphics::Capture::GraphicsCaptureItem,
        d3d: &Arc<D3dDevice>,
        frames: FrameSender,
        params: &QualityParams,
        selection: CaptureSelection,
        ender: &SessionEnder,
    ) -> Result<(), String> {
        let on_closed: ItemClosedCallback = {
            let ender = Arc::clone(ender);
            Arc::new(move || {
                ender(EndReason::SourceClosed(
                    FallbackReason::TargetExited.as_str().to_string(),
                ))
            })
        };
        let frame_gate = Arc::new(AtomicBool::new(true));
        let start_hook = selection.start_hook();
        let mut wgc_preroll = start_hook && selection.source_kind == SourceKind::Window;
        log::info!(
            "[NativeShare] frame-source startup source_id={} source_kind={:?} capture_mode={} policy={} start_hook={} wgc_preroll={} box={}x{} fps={}",
            source_id,
            selection.source_kind,
            selection.capture_mode.as_str(),
            selection.policy.as_str(),
            start_hook,
            wgc_preroll,
            params.max_width,
            params.max_height,
            params.fps,
        );

        if wgc_preroll {
            match crate::wgc_capture::start_wgc_capture(
                item.clone(),
                d3d,
                frames.clone(),
                Arc::clone(&self.stats),
                Arc::clone(&frame_gate),
                Some(Arc::clone(&on_closed)),
            ) {
                Ok(capture) => {
                    self.stats.set_capture_mode(CaptureMode::Wgc);
                    self.stats.set_active_backend(None);
                    self.stats.set_fallback_reason(FallbackReason::None);
                    *self.wgc.lock().unwrap_or_else(|p| p.into_inner()) = Some(capture);
                    log::info!(
                        "[NativeShare] started WGC pre-roll for window share; waiting for the hook to prove readiness"
                    );
                }
                Err(err) => {
                    wgc_preroll = false;
                    log::warn!(
                        "[NativeShare] WGC pre-roll failed to start ({err}); continuing with hook-only startup"
                    );
                }
            }
        }

        if start_hook {
            #[cfg(all(feature = "game-capture-hook", windows))]
            {
                use crate::game_capture::CapturePolicy;
                let mut selection = selection;
                let hook = selection
                    .hook
                    .take()
                    .ok_or("start_hook implies a prepared hook")?;
                let first_frame_timeout = Duration::from_millis(
                    crate::game_capture::initial_hook_first_frame_timeout_ms(selection.policy),
                );
                log::info!(
                    "[NativeShare] starting hook session target_pid={} backend={} policy={} first_frame_timeout_ms={} wgc_preroll={}",
                    hook.target_pid(),
                    hook.backend().as_str(),
                    selection.policy.as_str(),
                    first_frame_timeout.as_millis(),
                    wgc_preroll,
                );
                self.frame_interval_ns
                    .store(frame_interval_ns(params.fps), Ordering::Relaxed);
                self.hook = Some(super::capture::spawn_hook_capture_session(
                    super::capture::HookThreadContext {
                        hook,
                        helper: selection.helper.take(),
                        d3d: Arc::clone(d3d),
                        source_id: source_id.to_string(),
                        frames,
                        stats: Arc::clone(&self.stats),
                        frame_interval_ns: Arc::clone(&self.frame_interval_ns),
                        hook_exclusive: selection.policy == CapturePolicy::HookExclusive,
                        first_frame_timeout,
                        app: app.clone(),
                        wgc_preroll: wgc_preroll.then(|| {
                            super::capture::HookWgcPrerollController {
                                frame_gate: Arc::clone(&frame_gate),
                                wgc_capture: Arc::clone(&self.wgc),
                            }
                        }),
                        cancel: self.cancel.clone(),
                        ender: Arc::clone(ender),
                    },
                ));
            }
            #[cfg(not(all(feature = "game-capture-hook", windows)))]
            let _ = app;
        } else if selection.capture_unavailable {
            log::warn!(
                "[NativeShare] hook-exclusive policy with the hook unavailable: not starting WGC; \
                 no frames will be delivered for this session (Req 5.3)"
            );
        } else {
            let capture = crate::wgc_capture::start_wgc_capture(
                item,
                d3d,
                frames,
                Arc::clone(&self.stats),
                frame_gate,
                Some(on_closed),
            )?;
            *self.wgc.lock().unwrap_or_else(|p| p.into_inner()) = Some(capture);
        }
        Ok(())
    }

    /// Screen-share audio. System loopback starts at once; per-process
    /// loopback waits until video is confirmed flowing (or 10 s), because
    /// activating it early has delayed first paint on some targets.
    #[cfg(target_os = "windows")]
    fn start_audio(
        &mut self,
        track: Arc<TrackLocalStaticSample>,
        pc: &Arc<RTCPeerConnection>,
        source_id: &str,
    ) {
        use super::audio::{
            resolve_native_screen_audio_source, spawn_audio_writer, start_native_screen_audio,
            NativeScreenAudioSource,
        };

        let Some(source) = resolve_native_screen_audio_source(source_id) else {
            log::warn!(
                "[NativeShare] could not resolve an application audio target for {source_id}; starting video without audio"
            );
            return;
        };
        let (sink, writer) = spawn_audio_writer(
            track,
            Arc::clone(pc),
            Arc::clone(&self.stats),
            self.cancel.clone(),
        );
        self.tasks.push(writer);

        match source {
            NativeScreenAudioSource::SystemLoopback => {
                self.push_thread(start_native_screen_audio(sink, self.cancel.clone(), source));
            }
            NativeScreenAudioSource::ProcessLoopback { .. } => {
                const AUDIO_START_TIMEOUT: Duration = Duration::from_secs(10);
                let pc = Arc::clone(pc);
                let stats = Arc::clone(&self.stats);
                let cancel = self.cancel.clone();
                let threads = Arc::clone(&self.threads);
                let source_id = source_id.to_string();
                self.tasks.push(tokio::spawn(async move {
                    let started = Instant::now();
                    loop {
                        let flowing = pc.connection_state() == RTCPeerConnectionState::Connected
                            && stats.samples_written.load(Ordering::Relaxed)
                                >= VIDEO_FLOW_CONFIRMATION_SAMPLES;
                        if flowing || started.elapsed() >= AUDIO_START_TIMEOUT {
                            break;
                        }
                        tokio::select! {
                            _ = cancel.cancelled() => return,
                            _ = tokio::time::sleep(Duration::from_millis(50)) => {}
                        }
                    }
                    if cancel.is_cancelled() {
                        return;
                    }
                    log::info!(
                        "[NativeShare] starting deferred process loopback audio for {source_id} after {}ms",
                        started.elapsed().as_millis()
                    );
                    if let Some(handle) = start_native_screen_audio(sink, cancel, source) {
                        threads
                            .lock()
                            .unwrap_or_else(|p| p.into_inner())
                            .push(handle);
                    }
                }));
            }
        }
    }

    /// Apply a quality preset in place: the encoder refits the source aspect
    /// ratio inside the new box; the hook's DLL capture rate follows the fps.
    pub(crate) fn update_quality(&self, quality: &str) -> Result<(u32, u32, u32, u32), String> {
        let encoder = self
            .encoder
            .as_ref()
            .ok_or("No active encoder worker to reconfigure")?;
        let (max_width, max_height, fps, bitrate) = quality_preset(quality);
        encoder
            .reconfigure(EncoderReconfig {
                max_width,
                max_height,
                fps,
                bitrate,
            })
            .map_err(|e| format!("encoder reconfigure failed: {e}"))?;
        #[cfg(all(feature = "game-capture-hook", windows))]
        self.frame_interval_ns
            .store(frame_interval_ns(fps), Ordering::Relaxed);
        Ok((max_width, max_height, fps, bitrate))
    }

    /// (Re)build the preview loopback PC — built through the same transport
    /// code as the SFU publisher, fed from the SFU writer's fan-out — and
    /// return its gathered SDP offer.
    pub(crate) async fn start_preview<R: tauri::Runtime>(
        &mut self,
        app: &tauri::AppHandle<R>,
    ) -> Result<String, String> {
        if let Some(old) = self.preview.take() {
            old.close().await;
        }
        let control = self.control.clone().ok_or("No active encoder worker")?;
        let pc = new_peer_connection(Vec::new())
            .await
            .map_err(|e| format!("Create preview PC: {e}"))?;
        let mut preview = PreviewLoopback {
            pc: Some(Arc::clone(&pc)),
            cancel: CancelToken::new(),
            tasks: Vec::new(),
        };

        let built = async {
            let track = h264_track("preview_loopback".to_owned());
            let sender = add_track(&pc, &track).await?;
            {
                let app = app.clone();
                pc.on_ice_candidate(Box::new(move |candidate| {
                    if let Some(c) = candidate {
                        let _ = app.emit("native-preview-ice-candidate", c.to_json().ok());
                    }
                    Box::pin(async {})
                }));
            }
            // Localhost-only, non-trickle: the gathered SDP carries the host
            // candidates and the JS peer answers with its own inline.
            let sdp = create_gathered_offer(&pc, PREVIEW_GATHER_BUDGET).await?;
            preview.tasks = spawn_video_pipeline(VideoPipeline {
                label: "preview",
                pc: Arc::clone(&pc),
                track,
                sender,
                feed: EncodedFeed::Tap(self.preview_tap.subscribe()),
                control,
                stats: None,
                fps_hint: 30,
                cancel: preview.cancel.clone(),
            });
            Ok::<String, String>(sdp)
        }
        .await;

        match built {
            Ok(sdp) => {
                self.preview = Some(preview);
                log::info!("[NativeShare] preview loopback PC created");
                Ok(sdp)
            }
            Err(e) => {
                preview.close().await;
                Err(e)
            }
        }
    }

    pub(crate) async fn stop_preview(&mut self) -> bool {
        match self.preview.take() {
            Some(preview) => {
                preview.close().await;
                true
            }
            None => false,
        }
    }

    fn take_blocking_parts(&mut self) -> BlockingParts {
        BlockingParts {
            wgc: self.wgc.lock().unwrap_or_else(|p| p.into_inner()).take(),
            #[cfg(all(feature = "game-capture-hook", windows))]
            hook: self.hook.take(),
            encoder: self.encoder.take(),
            threads: std::mem::take(&mut *self.threads.lock().unwrap_or_else(|p| p.into_inner())),
        }
    }

    /// Tear everything down: cancel, close the PCs (bounded), then join the
    /// blocking parts on the blocking pool (bounded). Never blocks an async
    /// worker thread.
    pub(crate) async fn shutdown(mut self) {
        let id = self.id;
        self.cancel.cancel();
        if let Some(preview) = self.preview.take() {
            preview.close().await;
        }
        for task in self.tasks.drain(..) {
            task.abort();
        }
        if let Some(pc) = self.pc.take() {
            if tokio::time::timeout(PC_CLOSE_TIMEOUT, pc.close())
                .await
                .is_err()
            {
                log::warn!("[NativeShare] session {id}: peer connection close timed out");
            }
        }
        self.control = None;
        let parts = self.take_blocking_parts();
        if parts.is_empty() {
            return;
        }
        let join = tauri::async_runtime::spawn_blocking(move || parts.join_all());
        if tokio::time::timeout(TEARDOWN_JOIN_TIMEOUT, join)
            .await
            .is_err()
        {
            log::warn!(
                "[NativeShare] session {id}: teardown join exceeded {}s; finishing in the background",
                TEARDOWN_JOIN_TIMEOUT.as_secs()
            );
        }
        log::info!("[NativeShare] session {id} stopped");
    }
}

impl Drop for ShareSession {
    /// Safety net for a session dropped without [`ShareSession::shutdown`]:
    /// cancel, close the PCs in the background, and join the blocking parts
    /// on a detached thread so the dropping thread never blocks.
    fn drop(&mut self) {
        self.cancel.cancel();
        for task in self.tasks.drain(..) {
            task.abort();
        }
        drop(self.preview.take());
        if let Some(pc) = self.pc.take() {
            tauri::async_runtime::spawn(async move {
                let _ = tokio::time::timeout(PC_CLOSE_TIMEOUT, pc.close()).await;
            });
        }
        let parts = self.take_blocking_parts();
        if !parts.is_empty() {
            let _ = std::thread::Builder::new()
                .name("RalphShareTeardown".into())
                .spawn(move || parts.join_all());
        }
    }
}

/// The local preview loopback peer connection and its tasks.
pub(crate) struct PreviewLoopback {
    pc: Option<Arc<RTCPeerConnection>>,
    cancel: CancelToken,
    tasks: Vec<JoinHandle<()>>,
}

impl PreviewLoopback {
    async fn close(mut self) {
        self.cancel.cancel();
        for task in self.tasks.drain(..) {
            task.abort();
        }
        if let Some(pc) = self.pc.take() {
            let _ = tokio::time::timeout(PC_CLOSE_TIMEOUT, pc.close()).await;
        }
    }
}

impl Drop for PreviewLoopback {
    fn drop(&mut self) {
        self.cancel.cancel();
        for task in self.tasks.drain(..) {
            task.abort();
        }
        if let Some(pc) = self.pc.take() {
            tauri::async_runtime::spawn(async move {
                let _ = tokio::time::timeout(PC_CLOSE_TIMEOUT, pc.close()).await;
            });
        }
    }
}

#[cfg(all(feature = "game-capture-hook", windows))]
fn frame_interval_ns(fps: u32) -> u64 {
    if fps > 0 {
        1_000_000_000u64 / fps as u64
    } else {
        0
    }
}

// ── Session threads ────────────────────────────────────────────────────────

/// Ends the session when a shared window is destroyed (`IsWindow`), as a
/// backstop to the capture item's `Closed` event.
fn spawn_window_watchdog(
    source_id: String,
    cancel: CancelToken,
    ender: SessionEnder,
) -> Option<std::thread::JoinHandle<()>> {
    std::thread::Builder::new()
        .name("RalphShareSourceWatch".into())
        .spawn(move || {
            while !cancel.wait_timeout(Duration::from_millis(500)) {
                if !source_still_live(&source_id) {
                    log::info!(
                        "[NativeShare] shared window {source_id} closed; ending screen share"
                    );
                    ender(EndReason::SourceClosed(
                        FallbackReason::TargetExited.as_str().to_string(),
                    ));
                    return;
                }
            }
        })
        .ok()
}

/// Logs pipeline counters for the first 20 s of a session.
fn spawn_diagnostics(
    source_id: String,
    cancel: CancelToken,
    pc: Arc<RTCPeerConnection>,
    stats: Arc<NativeShareStats>,
) -> Option<std::thread::JoinHandle<()>> {
    std::thread::Builder::new()
        .name("RalphNativeShareDiag".into())
        .spawn(move || {
            let started = Instant::now();
            let mut ticks = 0u32;
            while started.elapsed() < Duration::from_secs(20) {
                let snap = stats.snapshot();
                log::info!(
                    "[NativeShareDiag] t={}ms source={} pc={} mode={} backend={} encoder={} fallback={} unavailable={} foreign_hook={} negotiated={:?}x{:?}@{:?} captured={} encoded={} encode_errors={} samples={} audio_samples={} write_errors={} dropped={}",
                    started.elapsed().as_millis(),
                    source_id,
                    pc.connection_state(),
                    snap.capture_mode,
                    snap.active_backend,
                    snap.encoder_backend,
                    snap.fallback_reason,
                    snap.capture_unavailable,
                    snap.foreign_hook,
                    snap.negotiated_width,
                    snap.negotiated_height,
                    snap.negotiated_fps,
                    snap.captured_frames,
                    snap.encoded_frames,
                    snap.encode_errors,
                    snap.samples_written,
                    stats.audio_samples_written.load(Ordering::Relaxed),
                    stats.write_errors.load(Ordering::Relaxed),
                    stats.dropped_frames.load(Ordering::Relaxed),
                );
                ticks += 1;
                let interval = if ticks < 12 { 250 } else { 500 };
                if cancel.wait_timeout(Duration::from_millis(interval)) {
                    return;
                }
            }
        })
        .ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancelling_one_session_token_leaves_another_untouched() {
        let old = CancelToken::new();
        let new = CancelToken::new();
        let old_clone = old.clone();
        old_clone.cancel();
        assert!(old.is_cancelled());
        assert!(
            !new.is_cancelled(),
            "a new session must not inherit an old cancel"
        );
        // A thread waiting on the new token keeps waiting.
        assert!(!new.wait_timeout(Duration::from_millis(10)));
    }

    #[test]
    fn cancel_wakes_a_blocked_thread_promptly() {
        let token = CancelToken::new();
        let waiter = {
            let token = token.clone();
            std::thread::spawn(move || {
                let started = Instant::now();
                assert!(token.wait_timeout(Duration::from_secs(10)));
                started.elapsed()
            })
        };
        std::thread::sleep(Duration::from_millis(20));
        token.cancel();
        let waited = waiter.join().unwrap();
        assert!(waited < Duration::from_secs(5), "waited {waited:?}");
    }

    #[test]
    fn cancel_resolves_async_waiters() {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()
            .unwrap();
        rt.block_on(async {
            let token = CancelToken::new();
            let waiter = tokio::spawn({
                let token = token.clone();
                async move { token.cancelled().await }
            });
            tokio::task::yield_now().await;
            token.cancel();
            tokio::time::timeout(Duration::from_secs(1), waiter)
                .await
                .expect("cancelled() must resolve")
                .unwrap();
            // Already-cancelled tokens resolve immediately.
            token.cancelled().await;
        });
    }

    struct Fake(u64);
    impl SessionIdentity for Fake {
        fn session_id(&self) -> u64 {
            self.0
        }
    }

    #[test]
    fn a_stale_end_request_cannot_take_the_new_session() {
        let mut slot = Some(Fake(2));
        // Session 1's ender fires late, after session 2 replaced it.
        assert!(take_if_current(&mut slot, 1).is_none());
        assert_eq!(slot.as_ref().map(|s| s.0), Some(2));
        // Session 2's own request does take it.
        assert_eq!(take_if_current(&mut slot, 2).map(|s| s.0), Some(2));
        assert!(slot.is_none());
        assert!(take_if_current(&mut slot, 2).is_none());
    }

    #[test]
    fn connection_watch_ignores_failures_before_first_connect() {
        let t0 = Instant::now();
        let mut watch = ConnectionWatch::new(DISCONNECT_GRACE);
        assert_eq!(watch.observe(RTCPeerConnectionState::Connecting, t0), None);
        assert_eq!(watch.observe(RTCPeerConnectionState::Failed, t0), None);
    }

    #[test]
    fn connection_watch_ends_on_failed_after_connect() {
        let t0 = Instant::now();
        let mut watch = ConnectionWatch::new(DISCONNECT_GRACE);
        watch.observe(RTCPeerConnectionState::Connected, t0);
        assert_eq!(
            watch.observe(RTCPeerConnectionState::Failed, t0),
            Some("failed")
        );
    }

    #[test]
    fn connection_watch_gives_disconnected_a_grace_period() {
        let t0 = Instant::now();
        let at = |ms| t0 + Duration::from_millis(ms);
        let mut watch = ConnectionWatch::new(Duration::from_secs(5));
        watch.observe(RTCPeerConnectionState::Connected, t0);
        assert_eq!(
            watch.observe(RTCPeerConnectionState::Disconnected, at(100)),
            None
        );
        assert_eq!(
            watch.observe(RTCPeerConnectionState::Disconnected, at(4_000)),
            None
        );
        // Recovered: the grace timer resets.
        assert_eq!(
            watch.observe(RTCPeerConnectionState::Connected, at(4_500)),
            None
        );
        assert_eq!(
            watch.observe(RTCPeerConnectionState::Disconnected, at(6_000)),
            None
        );
        assert_eq!(
            watch.observe(RTCPeerConnectionState::Disconnected, at(10_000)),
            None
        );
        assert_eq!(
            watch.observe(RTCPeerConnectionState::Disconnected, at(11_000)),
            Some("disconnected")
        );
    }

    #[test]
    fn end_reasons_map_to_the_event_payload() {
        assert_eq!(
            EndReason::SourceClosed("target_exited".into()).payload(),
            ShareEndedPayload {
                reason: "source-closed",
                detail: "target_exited".into()
            }
        );
        let json =
            serde_json::to_value(EndReason::ConnectionFailed("failed".into()).payload()).unwrap();
        assert_eq!(json["reason"], "connection-failed");
        assert_eq!(json["detail"], "failed");
    }
}
