//! Screen-share audio: WASAPI system loopback (monitor sources) or per-process
//! loopback (window sources), Opus-encoded on a capture thread and written to
//! the WebRTC track by ONE ordered writer task per session.

use std::sync::Arc;
#[cfg(target_os = "windows")]
use std::sync::Mutex as StdMutex;
use std::time::Duration;

use bytes::Bytes;
use webrtc::peer_connection::peer_connection_state::RTCPeerConnectionState;
use webrtc::peer_connection::RTCPeerConnection;
use webrtc::track::track_local::track_local_static_sample::TrackLocalStaticSample;

#[cfg(target_os = "windows")]
use super::capture::window_hwnd_from_id;
use super::session::CancelToken;
use super::stats::NativeShareStats;

/// One Opus packet covers 20 ms at 48 kHz.
const OPUS_FRAME: Duration = Duration::from_millis(20);
/// Bounded hand-off between the capture thread and the ordered writer task.
/// 50 packets = 1 s of audio; a stalled writer drops instead of buffering
/// unbounded latency.
const AUDIO_QUEUE_PACKETS: usize = 50;

/// Sending half of the ordered audio pipeline: the capture thread pushes
/// encoded Opus packets here and the session's single writer task drains them
/// in order (B19: no per-packet `spawn`, so packets can never be reordered).
#[derive(Clone)]
pub(crate) struct AudioSink {
    tx: tokio::sync::mpsc::Sender<Bytes>,
    stats: Arc<NativeShareStats>,
}

impl AudioSink {
    #[cfg(target_os = "windows")]
    fn push(&self, packet: Vec<u8>) {
        if self.tx.try_send(Bytes::from(packet)).is_err() {
            self.stats
                .write_errors
                .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        }
    }
}

/// Build the capture→writer channel and spawn the ordered writer task. The task
/// exits when the session is cancelled or every sink is dropped.
pub(crate) fn spawn_audio_writer(
    track: Arc<TrackLocalStaticSample>,
    peer_connection: Arc<RTCPeerConnection>,
    stats: Arc<NativeShareStats>,
    cancel: CancelToken,
) -> (AudioSink, tokio::task::JoinHandle<()>) {
    let (tx, mut rx) = tokio::sync::mpsc::channel::<Bytes>(AUDIO_QUEUE_PACKETS);
    let sink = AudioSink {
        tx,
        stats: Arc::clone(&stats),
    };
    let task = tokio::spawn(async move {
        loop {
            let packet = tokio::select! {
                _ = cancel.cancelled() => break,
                packet = rx.recv() => match packet {
                    Some(packet) => packet,
                    None => break,
                },
            };
            if peer_connection.connection_state() != RTCPeerConnectionState::Connected {
                continue;
            }
            let sample = webrtc::media::Sample {
                data: packet,
                duration: OPUS_FRAME,
                ..Default::default()
            };
            let counter = match track.write_sample(&sample).await {
                Ok(()) => &stats.audio_samples_written,
                Err(_) => &stats.write_errors,
            };
            counter.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        }
    });
    (sink, task)
}

/// How many 20 ms silent frames to synthesize so the RTP clock keeps pace with
/// wall-clock time (B19). Loopback capture delivers *nothing* while nothing
/// renders, so without padding the RTP timestamp freezes during silence and the
/// next real packet lands early on the receiver's clock. Padding starts only
/// once the stream is more than `SLACK_FRAMES` behind and catches up to one
/// frame short of real time, so a device that delivers normally (even in
/// bursts) is never padded.
pub(crate) fn silence_frames_to_pad(elapsed: Duration, frames_emitted: u64) -> u64 {
    const SLACK_FRAMES: u64 = 5;
    let expected = (elapsed.as_millis() / OPUS_FRAME.as_millis()) as u64;
    if expected > frames_emitted + SLACK_FRAMES {
        expected - frames_emitted - 1
    } else {
        0
    }
}

// ── Screen-share audio capture ─────────────────────────────────────────────

#[cfg(target_os = "windows")]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum NativeScreenAudioSource {
    SystemLoopback,
    ProcessLoopback { target_pid: u32 },
}

#[cfg(target_os = "windows")]
pub(crate) fn resolve_native_screen_audio_source(
    source_id: &str,
) -> Option<NativeScreenAudioSource> {
    if source_id.starts_with("monitor-") {
        return Some(NativeScreenAudioSource::SystemLoopback);
    }

    #[cfg(windows)]
    fn get_pid_from_hwnd(hwnd: isize) -> Option<u32> {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId;
        let mut pid: u32 = 0;
        let thread_id = unsafe { GetWindowThreadProcessId(HWND(hwnd as *mut _), Some(&mut pid)) };
        if thread_id == 0 || pid == 0 {
            None
        } else {
            Some(pid)
        }
    }

    let target_pid = window_hwnd_from_id(source_id).and_then(get_pid_from_hwnd)?;
    Some(NativeScreenAudioSource::ProcessLoopback { target_pid })
}

#[cfg(target_os = "windows")]
#[windows::core::implement(windows::Win32::Media::Audio::IActivateAudioInterfaceCompletionHandler)]
struct ProcessLoopbackActivationHandler {
    tx: StdMutex<
        Option<
            std::sync::mpsc::SyncSender<Result<windows::Win32::Media::Audio::IAudioClient, String>>,
        >,
    >,
}

#[cfg(target_os = "windows")]
impl ProcessLoopbackActivationHandler {
    fn new(
        tx: std::sync::mpsc::SyncSender<Result<windows::Win32::Media::Audio::IAudioClient, String>>,
    ) -> Self {
        Self {
            tx: StdMutex::new(Some(tx)),
        }
    }

    fn finish(&self, result: Result<windows::Win32::Media::Audio::IAudioClient, String>) {
        if let Ok(mut tx) = self.tx.lock() {
            if let Some(tx) = tx.take() {
                let _ = tx.send(result);
            }
        }
    }
}

#[cfg(target_os = "windows")]
impl windows::Win32::Media::Audio::IActivateAudioInterfaceCompletionHandler_Impl
    for ProcessLoopbackActivationHandler_Impl
{
    fn ActivateCompleted(
        &self,
        activateoperation: windows_core::Ref<
            '_,
            windows::Win32::Media::Audio::IActivateAudioInterfaceAsyncOperation,
        >,
    ) -> windows::core::Result<()> {
        use windows::Win32::Media::Audio::IAudioClient;
        use windows_core::Interface;

        let mut activation_result = windows::core::HRESULT(0);
        let mut activated = None;
        let result = unsafe {
            activateoperation
                .ok()?
                .GetActivateResult(&mut activation_result, &mut activated)
                .map_err(|e| format!("GetActivateResult failed: {e}"))
                .and_then(|_| {
                    activation_result
                        .ok()
                        .map_err(|e| format!("Audio interface activation failed: {e}"))
                })
                .and_then(|_| {
                    let activated = activated.ok_or_else(|| {
                        "ActivateAudioInterfaceAsync returned no interface".to_string()
                    })?;
                    activated.cast::<IAudioClient>().map_err(|e| {
                        format!("Cast activated interface to IAudioClient failed: {e}")
                    })
                })
        };

        self.finish(result);
        Ok(())
    }
}

#[cfg(target_os = "windows")]
fn activate_process_loopback_audio_client(
    target_pid: u32,
) -> Result<windows::Win32::Media::Audio::IAudioClient, String> {
    use windows::Win32::Media::Audio::{
        ActivateAudioInterfaceAsync, IActivateAudioInterfaceCompletionHandler, IAudioClient,
        AUDIOCLIENT_ACTIVATION_PARAMS, AUDIOCLIENT_ACTIVATION_PARAMS_0,
        AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK, AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS,
        PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE, VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
    };
    use windows::Win32::System::Com::StructuredStorage::PROPVARIANT;
    use windows::Win32::System::Com::BLOB;
    use windows::Win32::System::Variant::VT_BLOB;
    use windows_core::Interface;

    let mut activation = AUDIOCLIENT_ACTIVATION_PARAMS {
        ActivationType: AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
        Anonymous: AUDIOCLIENT_ACTIVATION_PARAMS_0 {
            ProcessLoopbackParams: AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS {
                TargetProcessId: target_pid,
                ProcessLoopbackMode: PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE,
            },
        },
    };

    let mut activation_params = PROPVARIANT::default();
    unsafe {
        let inner = &mut *activation_params.Anonymous.Anonymous;
        inner.vt = VT_BLOB;
        inner.Anonymous.blob = BLOB {
            cbSize: std::mem::size_of::<AUDIOCLIENT_ACTIVATION_PARAMS>() as u32,
            pBlobData: (&mut activation as *mut AUDIOCLIENT_ACTIVATION_PARAMS).cast::<u8>(),
        };
    }

    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    let handler: IActivateAudioInterfaceCompletionHandler =
        ProcessLoopbackActivationHandler::new(tx).into();
    let operation_result = unsafe {
        ActivateAudioInterfaceAsync(
            VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
            &IAudioClient::IID,
            Some(&activation_params),
            &handler,
        )
        .map_err(|e| format!("ActivateAudioInterfaceAsync failed: {e}"))
    };

    let result = match operation_result {
        Ok(operation) => {
            let _operation = operation;
            rx.recv_timeout(std::time::Duration::from_secs(5))
                .map_err(|_| "Timed out waiting for process loopback audio activation".to_string())
                .and_then(|inner| inner)
        }
        Err(err) => Err(err),
    };

    // `windows::PROPVARIANT` drops via `PropVariantClear`. For `VT_BLOB`, that
    // would attempt to free `pBlobData`, but here the blob only borrows the
    // stack-owned `activation` payload exactly like the Win32 sample does.
    // Skip Drop so `PropVariantClear` does not corrupt the heap by freeing a
    // borrowed pointer after the async activation finishes.
    std::mem::forget(activation_params);

    result
}

#[cfg(target_os = "windows")]
fn process_loopback_stream_flags() -> u32 {
    use windows::Win32::Media::Audio::{
        AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM, AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
        AUDCLNT_STREAMFLAGS_LOOPBACK,
    };

    AUDCLNT_STREAMFLAGS_LOOPBACK
        | AUDCLNT_STREAMFLAGS_EVENTCALLBACK
        | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM
}

#[cfg(target_os = "windows")]
fn build_process_loopback_capture_format() -> windows::Win32::Media::Audio::WAVEFORMATEX {
    use windows::Win32::Media::Audio::WAVE_FORMAT_PCM;

    let sample_rate = 48_000u32;
    let channels = 2u16;
    let bits_per_sample = 16u16;
    let blockalign = channels * (bits_per_sample / 8);

    windows::Win32::Media::Audio::WAVEFORMATEX {
        wFormatTag: WAVE_FORMAT_PCM as u16,
        nChannels: channels,
        nSamplesPerSec: sample_rate,
        nAvgBytesPerSec: sample_rate * u32::from(blockalign),
        nBlockAlign: blockalign,
        wBitsPerSample: bits_per_sample,
        cbSize: 0,
    }
}

/// Spawn the audio capture thread for `source`. The thread exits when the
/// session's `cancel` token fires; the returned handle is joined by session
/// teardown (B2: the audio thread is owned by its session, never shared).
#[cfg(target_os = "windows")]
pub(crate) fn start_native_screen_audio(
    sink: AudioSink,
    cancel: CancelToken,
    source: NativeScreenAudioSource,
) -> Option<std::thread::JoinHandle<()>> {
    std::thread::Builder::new()
        .name("RalphNativeScreenAudio".to_owned())
        .spawn(move || {
            let result = match source {
                NativeScreenAudioSource::SystemLoopback => {
                    run_wasapi_loopback_audio(&sink, &cancel)
                }
                NativeScreenAudioSource::ProcessLoopback { target_pid } => {
                    run_process_loopback_audio(&sink, &cancel, target_pid)
                }
            };

            if let Err(err) = result {
                log::warn!("[NativeShare] WASAPI loopback audio stopped: {err}");
            }
        })
        .ok()
}

/// Turns captured PCM into 20 ms Opus packets for one session, padding with
/// encoded silence whenever the device falls behind wall-clock time (see
/// [`silence_frames_to_pad`]).
#[cfg(target_os = "windows")]
struct OpusFramer {
    encoder: shiguredo_opus::Encoder,
    channels: usize,
    started: std::time::Instant,
    frames_emitted: u64,
}

#[cfg(target_os = "windows")]
impl OpusFramer {
    const FRAME_SAMPLES_PER_CHANNEL: usize = 960; // 20 ms at 48 kHz

    fn new(bitrate: u32, channels: u16, low_delay_vbr: bool) -> Result<Self, String> {
        use shiguredo_opus::{Application, Encoder as OpusEncoder, EncoderConfig};
        let mut config = EncoderConfig::new(48_000, channels as u8);
        config.application = Some(Application::Audio);
        config.bitrate = Some(bitrate);
        if low_delay_vbr {
            config.vbr = Some(true);
            config.dtx = Some(false);
        }
        let encoder =
            OpusEncoder::new(config).map_err(|e| format!("Create Opus encoder failed: {e}"))?;
        Ok(Self {
            encoder,
            channels: usize::from(channels),
            started: std::time::Instant::now(),
            frames_emitted: 0,
        })
    }

    fn frame_samples(&self) -> usize {
        Self::FRAME_SAMPLES_PER_CHANNEL * self.channels
    }

    fn encode(&mut self, sink: &AudioSink, pcm: &[f32]) {
        self.frames_emitted += 1;
        match self.encoder.encode_f32(pcm) {
            Ok(packet) if !packet.is_empty() => sink.push(packet),
            Ok(_) => {}
            Err(err) => log::warn!("[NativeShare] Opus encode failed: {err}"),
        }
    }

    /// Encode every whole frame in `queue`, decoding `bytes_per_sample`-wide
    /// little-endian samples with `decode`.
    fn drain(
        &mut self,
        sink: &AudioSink,
        queue: &mut std::collections::VecDeque<u8>,
        bytes_per_sample: usize,
        decode: impl Fn(&[u8]) -> f32,
    ) {
        let frame_bytes = self.frame_samples() * bytes_per_sample;
        let mut raw = vec![0u8; bytes_per_sample];
        while queue.len() >= frame_bytes {
            let mut pcm = Vec::with_capacity(self.frame_samples());
            for _ in 0..self.frame_samples() {
                for byte in raw.iter_mut() {
                    *byte = queue.pop_front().unwrap_or(0);
                }
                pcm.push(decode(&raw));
            }
            self.encode(sink, &pcm);
        }
    }

    fn pad_silence(&mut self, sink: &AudioSink) {
        let missing = silence_frames_to_pad(self.started.elapsed(), self.frames_emitted);
        if missing == 0 {
            return;
        }
        let silence = vec![0.0f32; self.frame_samples()];
        for _ in 0..missing {
            self.encode(sink, &silence);
        }
    }
}

#[cfg(target_os = "windows")]
fn run_wasapi_loopback_audio(sink: &AudioSink, cancel: &CancelToken) -> Result<(), String> {
    use std::collections::VecDeque;
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

    let mut framer = OpusFramer::new(192_000, 2, true)?;
    let mut sample_queue: VecDeque<u8> = VecDeque::with_capacity(blockalign * 48_000);
    audio_client
        .start_stream()
        .map_err(|e| format!("Start WASAPI loopback stream failed: {e}"))?;

    let result = (|| -> Result<(), String> {
        while !cancel.is_cancelled() {
            capture_client
                .read_from_device_to_deque(&mut sample_queue)
                .map_err(|e| format!("Read WASAPI loopback packet failed: {e}"))?;
            framer.drain(sink, &mut sample_queue, 4, |b| {
                f32::from_le_bytes([b[0], b[1], b[2], b[3]])
            });
            framer.pad_silence(sink);

            let _ = event.wait_for_event(OPUS_FRAME.as_millis() as u32);
        }
        Ok(())
    })();

    let _ = audio_client.stop_stream();
    result
}

#[cfg(target_os = "windows")]
fn run_process_loopback_audio(
    sink: &AudioSink,
    cancel: &CancelToken,
    target_pid: u32,
) -> Result<(), String> {
    use std::collections::VecDeque;
    use windows::Win32::Foundation::{CloseHandle, HANDLE, WAIT_OBJECT_0, WAIT_TIMEOUT};
    use windows::Win32::Media::Audio::{
        IAudioCaptureClient, IAudioClient, AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED,
        WAVEFORMATEX,
    };
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
    use windows::Win32::System::Threading::{CreateEventW, WaitForSingleObject};

    /// Closes the capture event on every exit path, including `?` returns.
    struct EventGuard(HANDLE);
    impl Drop for EventGuard {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseHandle(self.0);
            }
        }
    }

    let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };

    let format = build_process_loopback_capture_format();
    let sample_rate = format.nSamplesPerSec;
    let channels = format.nChannels;
    let bits_per_sample = format.wBitsPerSample;
    let blockalign = format.nBlockAlign;
    let stream_flags = process_loopback_stream_flags();
    log::info!(
        "[NativeShare] starting process loopback audio target_pid={} format={}Hz/{}ch/{}bit flags=0x{:x}",
        target_pid,
        sample_rate,
        channels,
        bits_per_sample,
        stream_flags
    );

    let client: IAudioClient = activate_process_loopback_audio_client(target_pid)?;
    unsafe {
        client
            .Initialize(
                AUDCLNT_SHAREMODE_SHARED,
                stream_flags,
                0,
                0,
                (&format as *const WAVEFORMATEX).cast(),
                None,
            )
            .map_err(|e| format!("Initialize process loopback client failed: {e}"))?;
    }

    let receive_signal = unsafe {
        CreateEventW(None, false, false, None)
            .map_err(|e| format!("Create process loopback event failed: {e}"))?
    };
    let _event_guard = EventGuard(receive_signal);
    unsafe {
        client
            .SetEventHandle(receive_signal)
            .map_err(|e| format!("SetEventHandle for process loopback failed: {e}"))?;
    }

    let capture: IAudioCaptureClient = unsafe {
        client
            .GetService()
            .map_err(|e| format!("GetService(IAudioCaptureClient) failed: {e}"))?
    };

    unsafe {
        client
            .Start()
            .map_err(|e| format!("Start process loopback audio client failed: {e}"))?;
    }

    let mut framer = OpusFramer::new(128_000, channels, false)?;
    let mut sample_queue: VecDeque<u8> = VecDeque::with_capacity(framer.frame_samples() * 2 * 4);

    let result = (|| -> Result<(), String> {
        while !cancel.is_cancelled() {
            let wait =
                unsafe { WaitForSingleObject(receive_signal, OPUS_FRAME.as_millis() as u32) };
            if wait != WAIT_TIMEOUT && wait != WAIT_OBJECT_0 {
                break;
            }

            if wait == WAIT_OBJECT_0 {
                loop {
                    let capture_size = unsafe {
                        capture
                            .GetNextPacketSize()
                            .map_err(|e| format!("GetNextPacketSize failed: {e}"))?
                    };
                    if capture_size == 0 {
                        break;
                    }

                    let mut buffer = std::ptr::null_mut();
                    let mut frames = 0u32;
                    let mut flags = 0u32;
                    unsafe {
                        capture
                            .GetBuffer(&mut buffer, &mut frames, &mut flags, None, None)
                            .map_err(|e| format!("GetBuffer failed: {e}"))?;
                    }

                    let byte_len = frames as usize * usize::from(blockalign);
                    if (flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32) != 0 {
                        sample_queue.resize(sample_queue.len() + byte_len, 0);
                    } else if !buffer.is_null() && byte_len > 0 {
                        let slice = unsafe { std::slice::from_raw_parts(buffer, byte_len) };
                        sample_queue.extend(slice.iter().copied());
                    }

                    unsafe {
                        capture
                            .ReleaseBuffer(frames)
                            .map_err(|e| format!("ReleaseBuffer failed: {e}"))?;
                    }

                    framer.drain(sink, &mut sample_queue, 2, |b| {
                        i16::from_le_bytes([b[0], b[1]]) as f32 / i16::MAX as f32
                    });
                }
            }
            framer.pad_silence(sink);
        }
        Ok(())
    })();

    unsafe {
        let _ = client.Stop();
    }
    result
}

#[cfg(all(test, target_os = "windows"))]
mod process_loopback_audio_tests {
    use super::*;
    use windows::Win32::Media::Audio::{
        AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM, AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
        AUDCLNT_STREAMFLAGS_LOOPBACK, WAVE_FORMAT_PCM,
    };

    #[test]
    fn process_loopback_uses_reference_stream_flags() {
        let flags = process_loopback_stream_flags();

        assert_ne!(flags & AUDCLNT_STREAMFLAGS_LOOPBACK, 0);
        assert_ne!(flags & AUDCLNT_STREAMFLAGS_EVENTCALLBACK, 0);
        assert_ne!(flags & AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM, 0);
    }

    #[test]
    fn process_loopback_requests_pcm_48khz_stereo() {
        let format = build_process_loopback_capture_format();
        let w_format_tag = format.wFormatTag;
        let n_channels = format.nChannels;
        let n_samples_per_sec = format.nSamplesPerSec;
        let w_bits_per_sample = format.wBitsPerSample;
        let n_block_align = format.nBlockAlign;
        let n_avg_bytes_per_sec = format.nAvgBytesPerSec;
        let cb_size = format.cbSize;

        assert_eq!(w_format_tag, WAVE_FORMAT_PCM as u16);
        assert_eq!(n_channels, 2);
        assert_eq!(n_samples_per_sec, 48_000);
        assert_eq!(w_bits_per_sample, 16);
        assert_eq!(n_block_align, 4);
        assert_eq!(n_avg_bytes_per_sec, 192_000);
        assert_eq!(cb_size, 0);
    }
}

#[cfg(test)]
mod silence_padding_tests {
    use super::*;

    #[test]
    fn no_padding_while_the_device_keeps_up() {
        assert_eq!(silence_frames_to_pad(Duration::ZERO, 0), 0);
        assert_eq!(silence_frames_to_pad(Duration::from_secs(1), 50), 0);
        // Bursty delivery inside the slack window is not padded.
        assert_eq!(silence_frames_to_pad(Duration::from_secs(1), 45), 0);
    }

    #[test]
    fn pads_to_one_frame_short_of_real_time_after_silence() {
        // 1 s of silence with nothing emitted: 50 frames due, pad 49.
        assert_eq!(silence_frames_to_pad(Duration::from_secs(1), 0), 49);
        // Once caught up, nothing more until the slack is exceeded again.
        assert_eq!(silence_frames_to_pad(Duration::from_secs(1), 49), 0);
    }

    #[test]
    fn a_device_running_ahead_is_never_padded() {
        assert_eq!(silence_frames_to_pad(Duration::from_millis(100), 40), 0);
    }
}
