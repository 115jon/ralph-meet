// ============================================================================
// LocalMediaManager — Singleton media stream manager (Livekit-style)
//
// Industry pattern (Livekit DeviceManager, Jitsi MediaStreamManager):
//   1. permissions.query()   → instant hasMic/hasCam flag  (<5ms, no device lock)
//   2. getUserMedia()        → real stream acquisition     (parallel with WS handshake)
//   3. enumerateDevices()    → full labeled device list    (fast NOW — getUserMedia
//                              already unlocked the browser's device discovery lock)
//
// Key property: a single in-flight getUserMedia() promise per kind — all callers
// share the same promise rather than spawning parallel requests. This matches
// Livekit's `userMediaPromiseMap: Map<MediaDeviceKind, Promise<MediaStream>>`.
// ============================================================================

import { clog } from "@/lib/console-logger";
import type { MediaDeviceInfo_Custom } from "@/lib/useMediaDevices";
import { useMediaDeviceStore } from "@/lib/useMediaDevices";

const lmLog = clog("LocalMedia");

export interface LocalAudioConstraints {
  deviceId?: string;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
  /** Request 2-channel capture for the stereo bypass pipeline */
  stereo?: boolean;
}

export interface LocalVideoConstraints {
  deviceId?: string;
}

export interface AcquireResult {
  stream: MediaStream;
  /** True if this was a freshly acquired stream, false if constraints matched cache */
  fresh: boolean;
}

// ── Singleton state ───────────────────────────────────────────────────────
/** Active audio+video stream (raw, before stereo bypass) */
let activeStream: MediaStream | null = null;

/** In-flight getUserMedia promise — shared by callers during join */
let streamPromise: Promise<MediaStream | null> | null = null;

// ── Helpers ───────────────────────────────────────────────────────────────

/** True if the track's current settings match the given constraints */
function audioConstraintsMatch(
  track: MediaStreamTrack,
  c: LocalAudioConstraints
): boolean {
  const s = track.getSettings();
  const idMatch =
    !c.deviceId || c.deviceId === "default" || s.deviceId === c.deviceId;
  return (
    idMatch &&
    s.noiseSuppression === c.noiseSuppression &&
    s.echoCancellation === c.echoCancellation &&
    s.autoGainControl === c.autoGainControl
  );
}

function videoConstraintsMatch(
  track: MediaStreamTrack,
  c: LocalVideoConstraints
): boolean {
  const s = track.getSettings();
  return !c.deviceId || c.deviceId === "default" || s.deviceId === c.deviceId;
}

function mediaConstraints(
  audio: LocalAudioConstraints,
  video: LocalVideoConstraints | null,
  exactAudio: boolean,
  exactVideo: boolean
): MediaStreamConstraints {
  return {
    audio: {
      deviceId: exactAudio ? { exact: audio.deviceId } : undefined,
      noiseSuppression: audio.noiseSuppression,
      echoCancellation: audio.echoCancellation,
      autoGainControl: audio.autoGainControl,
      // Legacy Chrome constraint names
      googEchoCancellation: audio.echoCancellation,
      googAutoGainControl: audio.autoGainControl,
      googNoiseSuppression: audio.noiseSuppression,
      channelCount: audio.stereo !== false ? 2 : 1,
    } as any,
    video:
      video
        ? exactVideo
          ? { deviceId: { exact: video.deviceId } }
          : true
        : false,
  };
}

// ── Core API ──────────────────────────────────────────────────────────────

/**
 * Acquire a local media stream with the given constraints.
 *
 * - If a compatible stream is already active, returns it immediately (no new getUserMedia).
 * - If a getUserMedia call is already in-flight (e.g. from startEarlyMic), awaits
 *   that promise rather than spawning a new one.
 * - On success, re-enumerates devices for full labels instantly — because
 *   getUserMedia already unlocked the browser's device discovery lock.
 * - Falls back to system default if the stored device ID no longer exists.
 */
export async function acquireLocalStream(
  audio: LocalAudioConstraints,
  videoConstraint: LocalVideoConstraints | null,
  logPrefix = "LocalMedia"
): Promise<MediaStream> {
  const log = clog(logPrefix);

  // If we have an active stream that matches, return it immediately
  if (activeStream) {
    const audioTrack = activeStream.getAudioTracks()[0];
    const videoTrack = activeStream.getVideoTracks()[0];
    const audioOk = !audioTrack || audioConstraintsMatch(audioTrack, audio);
    const videoOk =
      !videoConstraint ||
      (videoTrack && videoConstraintsMatch(videoTrack, videoConstraint));
    if (audioOk && videoOk) {
      log.debug("Reusing active stream (constraints match)");
      return activeStream;
    }
  }

  // Await any in-flight promise first (shared across callers during join)
  if (streamPromise) {
    log.debug("Awaiting in-flight getUserMedia promise...");
    const existing = await streamPromise;
    if (existing) {
      activeStream = existing;
      return existing;
    }
  }

  const useExactAudio = !!(audio.deviceId && audio.deviceId !== "default");
  const useExactVideo = !!(
    videoConstraint?.deviceId && videoConstraint.deviceId !== "default"
  );

  const doGetUserMedia = async (exactAudio: boolean, exactVideo: boolean) => {
    return navigator.mediaDevices.getUserMedia(
      mediaConstraints(audio, videoConstraint, exactAudio, exactVideo)
    );
  };

  let stream: MediaStream;
  try {
    stream = await doGetUserMedia(useExactAudio, useExactVideo);
  } catch (err: any) {
    if (
      err.name === "OverconstrainedError" ||
      err.name === "NotFoundError"
    ) {
      log.warn(
        `Device not found (${err.constraint ?? "unknown"}), falling back to system default`
      );
      stream = await doGetUserMedia(false, false);
    } else if (err.name === "NotAllowedError") {
      // Permission denied — surface, don't swallow
      log.warn("Permission denied for getUserMedia");
      throw err;
    } else {
      throw err;
    }
  }

  activeStream = stream;
  streamPromise = null;

  // ── Post-acquire re-enumeration ────────────────────────────────────────
  // getUserMedia just unlocked the browser's device discovery. enumerateDevices()
  // is now near-instant (<20ms) and will return full device labels.
  // This is the Jitsi/Livekit pattern: enumerate AFTER stream acquisition.
  refreshDeviceLabels();

  log.info(
    `Stream acquired — audio: ${stream.getAudioTracks()[0]?.label ?? "none"}`
  );
  return stream;
}

/**
 * Start getUserMedia eagerly before the WS handshake completes.
 * Returns a promise that resolves to the stream (or null on failure).
 * The in-flight promise is stored so acquireLocalStream() can await it
 * rather than spawning a second call.
 */
export function startEarlyMic(audio: LocalAudioConstraints): Promise<MediaStream | null> {
  if (streamPromise) return streamPromise; // already in-flight

  lmLog.debug("Starting early mic acquisition...");
  const useExact = !!(audio.deviceId && audio.deviceId !== "default");
  streamPromise = navigator.mediaDevices
    .getUserMedia(mediaConstraints(audio, null, useExact, false))
    .then((stream) => {
      lmLog.info(`Early mic acquired: ${stream.getAudioTracks()[0]?.label}`);
      activeStream = stream;
      streamPromise = null;
      // Refresh labels now that the device lock is released
      refreshDeviceLabels();
      return stream;
    })
    .catch((err) => {
      lmLog.warn("Early mic acquisition failed — will retry in swapDevices:", err.name);
      streamPromise = null;
      return null;
    });

  return streamPromise!;
}

/**
 * Release the active stream reference. Does NOT stop tracks — the caller
 * is responsible for that (tracks may still be in a PeerConnection sender).
 */
export function releaseLocalStream(): void {
  activeStream = null;
  streamPromise = null;
}

// ── Private: post-acquire label refresh ───────────────────────────────────
/**
 * Re-enumerate devices after getUserMedia has been called.
 * Firefox's enumerateDevices returns full labels near-instantly after
 * the stream is acquired (the internal device lock is now released).
 * This is called automatically after every successful acquire.
 */
async function refreshDeviceLabels(): Promise<void> {
  if (
    typeof navigator === "undefined" ||
    !navigator.mediaDevices?.enumerateDevices
  ) return;

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const mics: MediaDeviceInfo_Custom[] = devices
      .filter((d) => d.kind === "audioinput")
      .map((d, i) => ({
        deviceId: d.deviceId,
        label: d.label || `Microphone ${i + 1}`,
        kind: d.kind,
      }));
    const speakers: MediaDeviceInfo_Custom[] = devices
      .filter((d) => d.kind === "audiooutput")
      .map((d, i) => ({
        deviceId: d.deviceId,
        label: d.label || `Speaker ${i + 1}`,
        kind: d.kind,
      }));
    const cams: MediaDeviceInfo_Custom[] = devices
      .filter((d) => d.kind === "videoinput")
      .map((d, i) => ({
        deviceId: d.deviceId,
        label: d.label || `Camera ${i + 1}`,
        kind: d.kind,
      }));

    useMediaDeviceStore.getState()._update({
      hasMicrophone: mics.length > 0,
      hasCamera: cams.length > 0,
      audioInputs: mics,
      audioOutputs: speakers,
      videoInputs: cams,
    });

    lmLog.debug(
      `Labels refreshed: ${mics.length} mics, ${cams.length} cams, ${speakers.length} outputs`
    );
  } catch {
    // Not critical — labels stay stale from the slow initial enumerate
  }
}
