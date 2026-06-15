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
import { buildCameraVideoConstraints } from "@/lib/camera-quality";
import {
  getMediaDeviceSnapshot,
  type MediaDeviceInfo_Custom,
} from "@/lib/media-device-snapshot";
import {
  useMediaDeviceStore,
} from "@/lib/useMediaDevices";

const lmLog = clog("LocalMedia");

export interface LocalAudioConstraints {
  deviceId?: string;
  deviceLabel?: string;
  groupId?: string;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
  /** Request 2-channel capture for the stereo bypass pipeline */
  stereo?: boolean;
}

export interface LocalVideoConstraints {
  deviceId?: string;
  deviceLabel?: string;
  groupId?: string;
  qualityId?: string;
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

/** Last requested camera profile for the active stream. */
let activeVideoRequestKey: string | null = null;

function applyActiveAudioTrackLabel(devices: MediaDeviceInfo_Custom[]) {
  const track = activeStream?.getAudioTracks()[0];
  const trackLabel = track?.label?.trim();
  if (!track || !trackLabel) return devices;

  const settingsDeviceId = track.getSettings().deviceId;
  let applied = false;

  const labeled = devices.map((device) => {
    if (device.kind !== "audioinput") return device;
    if (settingsDeviceId && device.deviceId === settingsDeviceId) {
      applied = true;
      return { ...device, label: trackLabel };
    }
    if (device.deviceId === "default" && device.label.startsWith("Default")) {
      applied = true;
      return { ...device, label: trackLabel };
    }
    return device;
  });

  if (applied) return labeled;

  return devices.map((device, index) => (
    index === 0 && device.kind === "audioinput"
      ? { ...device, label: trackLabel }
      : device
  ));
}

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
  const idMatch = !c.deviceId || c.deviceId === "default" || s.deviceId === c.deviceId;
  const qualityMatch = activeVideoRequestKey === videoRequestKey(c);
  return idMatch && qualityMatch;
}

function videoRequestKey(c: LocalVideoConstraints | null): string | null {
  if (!c) return null;
  return `${c.deviceId || "default"}:${c.qualityId || "default"}`;
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
        ? buildCameraVideoConstraints({
          deviceId: video.deviceId,
          exactDevice: exactVideo,
          qualityId: video.qualityId,
        })
        : false,
  };
}

async function resolveStoredDeviceId(
  kind: MediaDeviceKind,
  deviceId?: string,
  deviceLabel?: string,
  groupId?: string,
  log = lmLog
): Promise<string | undefined> {
  if (!deviceId || deviceId === "default") return deviceId;
  if (!navigator.mediaDevices?.enumerateDevices) return deviceId;

  const devices = await navigator.mediaDevices.enumerateDevices();
  const candidates = devices.filter((d) => d.kind === kind);
  if (!deviceId.startsWith("native:") && candidates.some((d) => d.deviceId === deviceId)) return deviceId;

  const byGroup = groupId ? candidates.find((d) => d.groupId && d.groupId === groupId) : undefined;
  if (byGroup) {
    log.info(`Resolved stale ${kind} deviceId by groupId: ${byGroup.label || "unlabeled device"}`);
    return byGroup.deviceId;
  }

  const normalizedLabel = deviceLabel?.trim().toLowerCase();
  const byLabel = normalizedLabel
    ? candidates.find((d) => d.label?.trim().toLowerCase() === normalizedLabel)
    : undefined;
  if (byLabel) {
    log.info(`Resolved stale ${kind} deviceId by label: ${byLabel.label}`);
    return byLabel.deviceId;
  }

  if (deviceId.startsWith("native:")) {
    log.warn(`Native ${kind} endpoint is not exposed by CEF; falling back to system default`);
    return "default";
  }

  log.warn(`Stored ${kind} deviceId is gone; falling back to system default`);
  return "default";
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

  const resolvedAudioId = await resolveStoredDeviceId(
    "audioinput",
    audio.deviceId,
    audio.deviceLabel,
    audio.groupId,
    log
  );
  const resolvedVideoId = videoConstraint
    ? await resolveStoredDeviceId(
      "videoinput",
      videoConstraint.deviceId,
      videoConstraint.deviceLabel,
      videoConstraint.groupId,
      log
    )
    : undefined;
  const resolvedAudio = { ...audio, deviceId: resolvedAudioId };
  const resolvedVideo = videoConstraint ? { ...videoConstraint, deviceId: resolvedVideoId } : null;
  const useResolvedExactAudio = !!(resolvedAudio.deviceId && resolvedAudio.deviceId !== "default");
  const useResolvedExactVideo = !!(resolvedVideo?.deviceId && resolvedVideo.deviceId !== "default");

  const doGetUserMedia = async (exactAudio: boolean, exactVideo: boolean) => {
    return navigator.mediaDevices.getUserMedia(
      mediaConstraints(resolvedAudio, resolvedVideo, exactAudio, exactVideo)
    );
  };

  let stream: MediaStream;
  try {
    stream = await doGetUserMedia(useResolvedExactAudio, useResolvedExactVideo);
  } catch (err: any) {
    if (
      err.name === "OverconstrainedError" ||
      err.name === "NotFoundError"
    ) {
      log.warn(`Exact device unavailable (${err.constraint ?? "unknown"}), retrying with system default`);
      stream = await navigator.mediaDevices.getUserMedia(
        mediaConstraints(
          { ...resolvedAudio, deviceId: "default" },
          resolvedVideo ? { ...resolvedVideo, deviceId: "default" } : null,
          false,
          false
        )
      );
    } else if (err.name === "NotAllowedError") {
      // Permission denied — surface, don't swallow
      log.warn("Permission denied for getUserMedia");
      throw err;
    } else {
      throw err;
    }
  }

  activeStream = stream;
  activeVideoRequestKey = videoRequestKey(resolvedVideo);
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
  streamPromise = resolveStoredDeviceId("audioinput", audio.deviceId, audio.deviceLabel, audio.groupId, lmLog)
    .then((resolvedId) => navigator.mediaDevices
      .getUserMedia(mediaConstraints({ ...audio, deviceId: resolvedId }, null, !!(resolvedId && resolvedId !== "default"), false)))
    .then((stream) => {
      lmLog.info(`Early mic acquired: ${stream.getAudioTracks()[0]?.label}`);
      activeStream = stream;
      activeVideoRequestKey = null;
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
  activeVideoRequestKey = null;
  streamPromise = null;
}

// ── Private: post-acquire label refresh ───────────────────────────────────
/**
 * Re-enumerate devices after getUserMedia has been called.
 * Desktop CEF's enumerateDevices returns full labels after the stream is
 * acquired and its permission/content setting has been recorded.
 * This is called automatically after every successful acquire.
 */
async function refreshDeviceLabels(): Promise<void> {
  if (
    typeof navigator === "undefined" ||
    !navigator.mediaDevices?.enumerateDevices
  ) return;

  try {
    const snapshot = await getMediaDeviceSnapshot();
    const resolvedMics = applyActiveAudioTrackLabel(snapshot.audioInputs);

    useMediaDeviceStore.getState()._update({
      hasMicrophone: resolvedMics.length > 0,
      hasCamera: snapshot.videoInputs.length > 0,
      audioInputs: resolvedMics,
      audioOutputs: snapshot.audioOutputs,
      videoInputs: snapshot.videoInputs,
    });

    lmLog.debug(
      `Labels refreshed: ${resolvedMics.length} mics, ${snapshot.videoInputs.length} cams, ${snapshot.audioOutputs.length} outputs, ${snapshot.nativeAudioDevices.length} native audio devices`
    );
  } catch {
    // Not critical — labels stay stale from the slow initial enumerate
  }
}
