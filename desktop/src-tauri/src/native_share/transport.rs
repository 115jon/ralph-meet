//! WebRTC transport shared by the SFU publisher and the local preview loopback:
//! peer-connection construction, the H.264 track, the encoded-sample writer,
//! the RTCP keyframe reader, and keyframe-on-connect. Both callers build their
//! PC through here, so they cannot drift apart.

use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant};

use bytes::Bytes;
use tokio::sync::{broadcast, mpsc};
use tokio::task::JoinHandle;
use webrtc::api::interceptor_registry::register_default_interceptors;
use webrtc::api::media_engine::MediaEngine;
use webrtc::api::APIBuilder;
use webrtc::ice_transport::ice_credential_type::RTCIceCredentialType;
use webrtc::ice_transport::ice_server::RTCIceServer;
use webrtc::peer_connection::configuration::RTCConfiguration;
use webrtc::peer_connection::peer_connection_state::RTCPeerConnectionState;
use webrtc::peer_connection::sdp::sdp_type::RTCSdpType;
use webrtc::peer_connection::sdp::session_description::RTCSessionDescription;
use webrtc::peer_connection::RTCPeerConnection;
use webrtc::rtp_transceiver::rtp_codec::RTCRtpCodecCapability;
use webrtc::rtp_transceiver::rtp_sender::RTCRtpSender;
use webrtc::track::track_local::track_local_static_sample::TrackLocalStaticSample;
use webrtc::track::track_local::TrackLocal;

use super::session::CancelToken;
use super::stats::NativeShareStats;
use super::NativeIceServer;
use crate::wmf_encoder::{EncoderControlHandle, VideoCodec};

/// At most one PLI/FIR-driven keyframe per second, so a PLI burst does not
/// spike the bitrate (Req 2.3).
const KEYFRAME_DEBOUNCE: Duration = Duration::from_secs(1);
/// Clamp for per-sample RTP durations: a long pause (loading screen) or a
/// startup hiccup must not stamp one absurd duration.
const MIN_SAMPLE_DURATION: Duration = Duration::from_millis(1);
const MAX_SAMPLE_DURATION: Duration = Duration::from_millis(250);

/// Map the renderer's ICE servers to webrtc-rs, defaulting to a public STUN
/// server when none are usable.
pub(crate) fn ice_servers(servers: Option<Vec<NativeIceServer>>) -> Vec<RTCIceServer> {
    let mut out: Vec<RTCIceServer> = servers
        .unwrap_or_default()
        .into_iter()
        .filter(|s| !s.urls.is_empty())
        .map(|s| RTCIceServer {
            urls: s.urls,
            username: s.username.unwrap_or_default(),
            credential: s.credential.unwrap_or_default(),
            credential_type: RTCIceCredentialType::Password,
        })
        .collect();
    if out.is_empty() {
        out.push(RTCIceServer {
            urls: vec!["stun:stun.l.google.com:19302".to_owned()],
            ..Default::default()
        });
    }
    out
}

/// Create a peer connection with the default codecs + interceptors registered.
/// (A bare `APIBuilder::new().build()` offers no codecs, which made the JS
/// preview peer fail to answer.)
pub(crate) async fn new_peer_connection(
    ice_servers: Vec<RTCIceServer>,
) -> Result<Arc<RTCPeerConnection>, String> {
    let mut media_engine = MediaEngine::default();
    media_engine
        .register_default_codecs()
        .map_err(|e| e.to_string())?;
    let registry = register_default_interceptors(
        webrtc::interceptor::registry::Registry::new(),
        &mut media_engine,
    )
    .map_err(|e| e.to_string())?;
    let api = APIBuilder::new()
        .with_media_engine(media_engine)
        .with_interceptor_registry(registry)
        .build();
    let pc = api
        .new_peer_connection(RTCConfiguration {
            ice_servers,
            ..Default::default()
        })
        .await
        .map_err(|e| format!("Create peer connection: {e}"))?;
    Ok(Arc::new(pc))
}

/// The H.264 video track, identical for the SFU and the preview so Chromium
/// decodes both the same way.
pub(crate) fn h264_track(track_id: String) -> Arc<TrackLocalStaticSample> {
    let codec = VideoCodec::H264;
    Arc::new(TrackLocalStaticSample::new(
        RTCRtpCodecCapability {
            mime_type: codec.mime_type().to_owned(),
            clock_rate: 90_000,
            sdp_fmtp_line: codec.sdp_fmtp().to_owned(),
            ..Default::default()
        },
        track_id,
        "screen".to_owned(),
    ))
}

/// The Opus screen-audio track.
pub(crate) fn opus_track(track_id: String) -> Arc<TrackLocalStaticSample> {
    Arc::new(TrackLocalStaticSample::new(
        RTCRtpCodecCapability {
            mime_type: "audio/opus".to_owned(),
            clock_rate: 48_000,
            channels: 2,
            sdp_fmtp_line: "minptime=10;useinbandfec=1;stereo=1;sprop-stereo=1;usedtx=0".to_owned(),
            ..Default::default()
        },
        track_id,
        "screen".to_owned(),
    ))
}

pub(crate) async fn add_track(
    pc: &RTCPeerConnection,
    track: &Arc<TrackLocalStaticSample>,
) -> Result<Arc<RTCRtpSender>, String> {
    pc.add_track(Arc::clone(track) as Arc<dyn TrackLocal + Send + Sync>)
        .await
        .map_err(|e| format!("Add track: {e}"))
}

/// Create the offer, wait up to `gather_budget` for ICE gathering, and return
/// the *gathered* local description (candidates inline). Returning the
/// pre-gather offer SDP left the peer with no candidates unless it listened
/// for trickle events, which the renderer does not (B17).
pub(crate) async fn create_gathered_offer(
    pc: &RTCPeerConnection,
    gather_budget: Duration,
) -> Result<String, String> {
    let offer = pc
        .create_offer(None)
        .await
        .map_err(|e| format!("Create offer: {e}"))?;
    let mut gather_complete = pc.gathering_complete_promise().await;
    pc.set_local_description(offer)
        .await
        .map_err(|e| format!("Set local description: {e}"))?;
    let _ = tokio::time::timeout(gather_budget, gather_complete.recv()).await;
    pc.local_description()
        .await
        .map(|desc| desc.sdp)
        .ok_or_else(|| "Peer connection has no local description".to_string())
}

pub(crate) async fn apply_answer(pc: &RTCPeerConnection, sdp: String) -> Result<(), String> {
    let mut answer = RTCSessionDescription::default();
    answer.sdp = sdp;
    answer.sdp_type = RTCSdpType::Answer;
    pc.set_remote_description(answer)
        .await
        .map_err(|e| e.to_string())
}

/// Where a writer gets encoded H.264 access units from.
pub(crate) enum EncodedFeed {
    /// Straight from the encoder (the SFU writer). Each frame is also fanned
    /// out to `tap` so a preview loopback can subscribe.
    Encoder {
        rx: mpsc::Receiver<Vec<u8>>,
        tap: broadcast::Sender<Bytes>,
    },
    /// A subscription to the SFU writer's fan-out (the preview writer).
    Tap(broadcast::Receiver<Bytes>),
}

enum FeedItem {
    Frame(Bytes),
    /// The subscriber fell behind and skipped frames: the decoder needs a
    /// fresh keyframe.
    Lagged,
    Closed,
}

impl EncodedFeed {
    async fn next(&mut self) -> FeedItem {
        match self {
            EncodedFeed::Encoder { rx, tap } => match rx.recv().await {
                Some(data) => {
                    let data = Bytes::from(data);
                    let _ = tap.send(data.clone());
                    FeedItem::Frame(data)
                }
                None => FeedItem::Closed,
            },
            EncodedFeed::Tap(rx) => match rx.recv().await {
                Ok(data) => FeedItem::Frame(data),
                Err(broadcast::error::RecvError::Lagged(_)) => FeedItem::Lagged,
                Err(broadcast::error::RecvError::Closed) => FeedItem::Closed,
            },
        }
    }
}

/// One video publisher: a peer connection carrying one H.264 track fed from
/// the session's encoder.
pub(crate) struct VideoPipeline {
    pub(crate) label: &'static str,
    pub(crate) pc: Arc<RTCPeerConnection>,
    pub(crate) track: Arc<TrackLocalStaticSample>,
    pub(crate) sender: Arc<RTCRtpSender>,
    pub(crate) feed: EncodedFeed,
    pub(crate) control: EncoderControlHandle,
    /// Counters to update (the SFU writer only; the preview is not counted).
    pub(crate) stats: Option<Arc<NativeShareStats>>,
    pub(crate) fps_hint: u32,
    pub(crate) cancel: CancelToken,
}

/// Spawn the writer, RTCP keyframe reader, and keyframe-on-connect tasks for
/// `pipeline`. All three stop on `pipeline.cancel`.
pub(crate) fn spawn_video_pipeline(pipeline: VideoPipeline) -> Vec<JoinHandle<()>> {
    let VideoPipeline {
        label,
        pc,
        track,
        sender,
        feed,
        control,
        stats,
        fps_hint,
        cancel,
    } = pipeline;
    vec![
        tokio::spawn(run_writer(
            label,
            Arc::clone(&pc),
            track,
            feed,
            control.clone(),
            stats,
            fps_hint,
            cancel.clone(),
        )),
        tokio::spawn(run_rtcp_keyframe_reader(
            label,
            sender,
            control.clone(),
            cancel.clone(),
        )),
        tokio::spawn(run_keyframe_on_connect(label, pc, control, cancel)),
    ]
}

/// Write encoded samples to `track`, stamping each with the REAL elapsed time
/// since the previous one.
///
/// The sample `duration` advances the RTP clock (duration × 90 kHz). It must
/// track wall-clock time, not a fixed fps: after a live 30→60 switch a fixed
/// 33 ms stamp made receivers play at half speed. The freshest sample produced
/// before the PC connects is retained and flushed on connect, because a static
/// window may only produce one startup frame.
#[allow(clippy::too_many_arguments)]
async fn run_writer(
    label: &'static str,
    pc: Arc<RTCPeerConnection>,
    track: Arc<TrackLocalStaticSample>,
    mut feed: EncodedFeed,
    control: EncoderControlHandle,
    stats: Option<Arc<NativeShareStats>>,
    fps_hint: u32,
    cancel: CancelToken,
) {
    let first_duration = Duration::from_millis(1_000 / fps_hint.max(1) as u64);
    let mut last_write: Option<Instant> = None;
    let mut pending: Option<(Bytes, Instant)> = None;
    let mut connect_poll = tokio::time::interval(Duration::from_millis(25));
    connect_poll.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    let write = |data: Bytes, duration: Duration| {
        let track = Arc::clone(&track);
        let stats = stats.clone();
        async move {
            let ok = track
                .write_sample(&webrtc::media::Sample {
                    data,
                    duration,
                    ..Default::default()
                })
                .await
                .is_ok();
            if let Some(stats) = stats {
                let counter = if ok {
                    &stats.samples_written
                } else {
                    &stats.write_errors
                };
                counter.fetch_add(1, Ordering::Relaxed);
            }
            ok
        }
    };

    loop {
        tokio::select! {
            _ = cancel.cancelled() => break,
            item = feed.next() => {
                let data = match item {
                    FeedItem::Frame(data) => data,
                    FeedItem::Lagged => {
                        control.request_keyframe();
                        continue;
                    }
                    FeedItem::Closed => break,
                };
                if pc.connection_state() != RTCPeerConnectionState::Connected {
                    pending = Some((data, Instant::now()));
                    last_write = None;
                    continue;
                }
                if let Some((retained, at)) = pending.take() {
                    if write(retained, first_duration).await {
                        log::info!(
                            "[NativeShare][{label}] flushed retained pre-connect video sample after {}ms",
                            at.elapsed().as_millis()
                        );
                    }
                    last_write = Some(Instant::now());
                }
                let now = Instant::now();
                let duration = last_write
                    .map(|at| (now - at).clamp(MIN_SAMPLE_DURATION, MAX_SAMPLE_DURATION))
                    .unwrap_or(first_duration);
                last_write = Some(now);
                write(data, duration).await;
            }
            _ = connect_poll.tick(), if pending.is_some() => {
                if pc.connection_state() != RTCPeerConnectionState::Connected {
                    continue;
                }
                if let Some((retained, at)) = pending.take() {
                    if write(retained, first_duration).await {
                        log::info!(
                            "[NativeShare][{label}] flushed retained pre-connect video sample after {}ms",
                            at.elapsed().as_millis()
                        );
                    }
                    last_write = Some(Instant::now());
                }
            }
        }
    }
}

/// Inbound RTCP: on PLI/FIR (late join, loss, layer switch) force an IDR so the
/// affected viewer recovers in ~1 frame. Exits when the sender's RTCP stream
/// ends (PC closed) or the session is cancelled.
async fn run_rtcp_keyframe_reader(
    label: &'static str,
    sender: Arc<RTCRtpSender>,
    control: EncoderControlHandle,
    cancel: CancelToken,
) {
    use webrtc::rtcp::payload_feedbacks::full_intra_request::FullIntraRequest;
    use webrtc::rtcp::payload_feedbacks::picture_loss_indication::PictureLossIndication;

    let mut last_keyframe: Option<Instant> = None;
    let mut pli_total: u64 = 0;
    let mut forced_total: u64 = 0;
    loop {
        let packets = tokio::select! {
            _ = cancel.cancelled() => break,
            read = sender.read_rtcp() => match read {
                Ok((packets, _)) => packets,
                Err(e) => {
                    log::info!(
                        "[NativeShare][{label}] RTCP keyframe reader exiting ({e}); pli_total={pli_total}, forced_total={forced_total}"
                    );
                    break;
                }
            },
        };
        let wants_keyframe = packets.iter().any(|pkt| {
            let any = pkt.as_any();
            any.downcast_ref::<PictureLossIndication>().is_some()
                || any.downcast_ref::<FullIntraRequest>().is_some()
        });
        if !wants_keyframe {
            continue;
        }
        pli_total += 1;
        if last_keyframe.map_or(true, |at| at.elapsed() >= KEYFRAME_DEBOUNCE) {
            control.request_keyframe();
            last_keyframe = Some(Instant::now());
            forced_total += 1;
            log::info!(
                "[NativeShare][{label}] RTCP PLI/FIR → forced keyframe (pli_total={pli_total}, forced_total={forced_total})"
            );
        }
    }
}

/// Force an IDR as soon as the PC reaches `Connected`, so late ICE completion
/// does not leave first paint waiting for the next scene change.
async fn run_keyframe_on_connect(
    label: &'static str,
    pc: Arc<RTCPeerConnection>,
    control: EncoderControlHandle,
    cancel: CancelToken,
) {
    loop {
        match pc.connection_state() {
            RTCPeerConnectionState::Connected => {
                control.request_keyframe();
                log::info!(
                    "[NativeShare][{label}] peer connected; requested keyframe for first paint"
                );
                return;
            }
            RTCPeerConnectionState::Failed | RTCPeerConnectionState::Closed => return,
            _ => {}
        }
        tokio::select! {
            _ = cancel.cancelled() => return,
            _ = tokio::time::sleep(Duration::from_millis(25)) => {}
        }
    }
}
