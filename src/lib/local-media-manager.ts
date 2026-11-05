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

import {
  captureAnswersRequest,
  captureErrorAction,
  captureProcessingMatches,
  captureTarget,
  deviceSatisfies,
  type DeviceResolution,
} from "@ralph/voice";
import { clog } from "@/lib/console-logger";
import { buildCameraVideoConstraints } from "@/lib/camera-quality";
import {
  getMediaDeviceSnapshot,
  type MediaDeviceInfo_Custom,
} from "@/lib/media-device-snapshot";
import { lookupSavedDevice } from "@/lib/stored-device";
import { useMediaDeviceStore } from "@/lib/useMediaDevices";

const lmLog = clog("LocalMedia");

type Logger = ReturnType<typeof clog>;

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

declare const localMediaOwnerBrand: unique symbol;
export type LocalMediaOwner = {
  readonly [localMediaOwnerBrand]: true;
};

export function createLocalMediaOwner(): LocalMediaOwner {
  return {} as LocalMediaOwner;
}

interface LocalMediaState {
  activeStream: MediaStream | null;
  streamPromise: Promise<MediaStream | null> | null;
  acquisitionGeneration: number;
  acquisitionOrder: number;
  activeAudioRequestDeviceId?: string;
  activeVideoRequestDeviceId?: string;
  activeVideoRequestKey: string | null;
}

const defaultLocalMediaOwner = createLocalMediaOwner();
const localMediaStates = new WeakMap<LocalMediaOwner, LocalMediaState>();

function getLocalMediaState(owner?: LocalMediaOwner): LocalMediaState {
  const key = owner ?? defaultLocalMediaOwner;
  let state = localMediaStates.get(key);
  if (!state) {
    state = {
      activeStream: null,
      streamPromise: null,
      acquisitionGeneration: 0,
      acquisitionOrder: 0,
      activeAudioRequestDeviceId: undefined,
      activeVideoRequestDeviceId: undefined,
      activeVideoRequestKey: null,
    };
    localMediaStates.set(key, state);
  }
  return state;
}

// ── Scoped state ───────────────────────────────────────────────────────────
// State is scoped by LocalMediaOwner; the default owner preserves legacy callers.

function applyActiveAudioTrackLabel(
  devices: MediaDeviceInfo_Custom[],
  stream: MediaStream | null,
) {
  const track = stream?.getAudioTracks()[0];
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

  return devices.map((device, index) =>
    index === 0 && device.kind === "audioinput"
      ? { ...device, label: trackLabel }
      : device,
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────

/** The capture-level processing (constraints) a track has applied. */
function audioProcessingMatches(
  track: MediaStreamTrack,
  c: LocalAudioConstraints,
): boolean {
  return captureProcessingMatches(track.getSettings(), c);
}

function videoRequestKey(c: LocalVideoConstraints | null): string | null {
  if (!c) return null;
  return `${c.deviceId || "default"}:${c.qualityId || "default"}`;
}

function stopStreamTracks(stream: MediaStream) {
  stream.getTracks().forEach((track) => track.stop());
}

function throwIfAcquisitionStale(
  state: LocalMediaState,
  generation: number,
  order?: number,
) {
  if (
    generation === state.acquisitionGeneration &&
    (order === undefined || order === state.acquisitionOrder)
  )
    return;
  const error = new Error("Local media acquisition was cancelled");
  error.name = "AbortError";
  throw error;
}

function mediaConstraints(
  audio: LocalAudioConstraints,
  video: LocalVideoConstraints | null,
  exactAudio: boolean,
  exactVideo: boolean,
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
    video: video
      ? buildCameraVideoConstraints({
          deviceId: video.deviceId,
          exactDevice: exactVideo,
          qualityId: video.qualityId,
        })
      : false,
  };
}

function lookupStoredAudio(
  audio: LocalAudioConstraints,
  log: Logger,
): Promise<DeviceResolution> {
  return lookupSavedDevice(
    "audioinput",
    {
      deviceId: audio.deviceId,
      label: audio.deviceLabel,
      groupId: audio.groupId,
    },
    log,
  );
}

function lookupStoredVideo(
  video: LocalVideoConstraints,
  log: Logger,
): Promise<DeviceResolution> {
  return lookupSavedDevice(
    "videoinput",
    {
      deviceId: video.deviceId,
      label: video.deviceLabel,
      groupId: video.groupId,
    },
    log,
  );
}

const isUnverified = (resolution: DeviceResolution | null | undefined) =>
  resolution?.outcome === "unverified";

/**
 * A saved id was tried blind because the device list was hidden, and the
 * capture fell back to the system default. That capture granted access, so
 * the list is readable now: look the saved devices up again by groupId and
 * label and reopen them. Keeps the fallback stream if nothing better is found.
 * Ids already verified before the fallback are passed in `audioId`/`videoId`.
 */
async function reopenStoredDevices(
  fallback: MediaStream,
  {
    audio,
    video,
    audioId,
    videoId,
    isStale,
    log,
  }: {
    audio: LocalAudioConstraints;
    video: LocalVideoConstraints | null;
    audioId: string | undefined;
    videoId: string | undefined;
    isStale: () => boolean;
    log: Logger;
  },
): Promise<MediaStream> {
  let audioRetry: DeviceResolution | null;
  let videoRetry: DeviceResolution | null;
  try {
    [audioRetry, videoRetry] = await Promise.all([
      audioId === undefined ? lookupStoredAudio(audio, log) : null,
      video && videoId === undefined ? lookupStoredVideo(video, log) : null,
    ]);
  } catch (err: any) {
    // The fallback stream is live and owned by the caller: hand it back.
    log.warn(`Saved device lookup failed (${err?.name ?? "unknown"})`);
    return fallback;
  }
  if (isStale()) return fallback;
  const nextAudioId = audioId ?? audioRetry?.deviceId;
  const nextVideoId = videoId ?? videoRetry?.deviceId;
  // Still hidden: the saved id is tried exactly once more.
  const exactAudio = captureTarget(nextAudioId).exact;
  const exactVideo = !!video && captureTarget(nextVideoId).exact;
  if (!exactAudio && !exactVideo) return fallback;

  try {
    const reopened = await navigator.mediaDevices.getUserMedia(
      mediaConstraints(
        { ...audio, deviceId: nextAudioId },
        video ? { ...video, deviceId: nextVideoId } : null,
        exactAudio,
        exactVideo,
      ),
    );
    if (isStale()) {
      stopStreamTracks(reopened);
      return fallback;
    }
    stopStreamTracks(fallback);
    log.info("Reopened the saved device after the device list unlocked");
    return reopened;
  } catch (err: any) {
    log.warn(`Saved device still unavailable (${err?.name ?? "unknown"})`);
    return fallback;
  }
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
  logPrefix = "LocalMedia",
  owner?: LocalMediaOwner,
): Promise<MediaStream> {
  const state = getLocalMediaState(owner);
  const log = clog(logPrefix);
  const generation = state.acquisitionGeneration;
  let supersededActiveStream: MediaStream | null = null;

  // If we have an active stream that matches, return it immediately
  if (state.activeStream) {
    const activeLookupOrder = state.acquisitionOrder;
    const activeAudioLookup = await lookupStoredAudio(audio, log);
    const activeVideoLookup = videoConstraint
      ? await lookupStoredVideo(videoConstraint, log)
      : null;
    throwIfAcquisitionStale(state, generation, activeLookupOrder);
    const audioTrack = state.activeStream.getAudioTracks()[0];
    const videoTrack = state.activeStream.getVideoTracks()[0];
    const audioLive = !audioTrack || audioTrack.readyState !== "ended";
    if ((videoConstraint && !videoTrack) || !audioLive) {
      supersededActiveStream = state.activeStream;
    }
    // Device: @ralph/voice decides (hidden list, fallback, refreshed id).
    // A stream with no audio track is judged on its request alone.
    const audioOk =
      audioLive &&
      captureAnswersRequest(audio.deviceId, activeAudioLookup, {
        requestedId: state.activeAudioRequestDeviceId,
        deviceId: audioTrack
          ? audioTrack.getSettings().deviceId
          : activeAudioLookup.deviceId,
      }) &&
      (!audioTrack || audioProcessingMatches(audioTrack, audio));
    const videoOk =
      !videoConstraint ||
      (!!activeVideoLookup &&
        !!videoTrack &&
        captureAnswersRequest(videoConstraint.deviceId, activeVideoLookup, {
          requestedId: state.activeVideoRequestDeviceId,
          deviceId: videoTrack.getSettings().deviceId,
        }) &&
        state.activeVideoRequestKey ===
          videoRequestKey({
            ...videoConstraint,
            deviceId: activeVideoLookup.deviceId,
          }));
    if (audioOk && videoOk) {
      log.debug("Reusing active stream (constraints match)");
      return state.activeStream;
    }
  }

  let supersededSharedStream: MediaStream | null = null;

  // Await any in-flight promise first (shared across callers during join)
  if (state.streamPromise) {
    log.debug("Awaiting in-flight getUserMedia promise...");
    const existing = await state.streamPromise;
    throwIfAcquisitionStale(state, generation);
    if (existing) {
      const existingAudio = existing.getAudioTracks()[0];
      const audioMatches =
        !!existingAudio &&
        existingAudio.readyState !== "ended" &&
        deviceSatisfies(audio.deviceId, existingAudio.getSettings().deviceId) &&
        audioProcessingMatches(existingAudio, audio);
      // The shared request (startEarlyMic) is audio-only: a request that
      // adds video always captures again.
      const videoMatches = !videoConstraint;
      if (audioMatches && videoMatches) {
        state.activeStream = existing;
        return existing;
      }
      log.debug("Shared stream does not match requested devices; reacquiring");
      supersededSharedStream = existing;
    }
  }

  const requestOrder = ++state.acquisitionOrder;

  const audioLookup = await lookupStoredAudio(audio, log);
  throwIfAcquisitionStale(state, generation, requestOrder);
  const videoLookup = videoConstraint
    ? await lookupStoredVideo(videoConstraint, log)
    : null;
  const resolvedAudioId = audioLookup.deviceId;
  const resolvedVideoId = videoLookup?.deviceId;
  throwIfAcquisitionStale(state, generation, requestOrder);
  const resolvedAudio = { ...audio, deviceId: resolvedAudioId };
  const resolvedVideo = videoConstraint
    ? { ...videoConstraint, deviceId: resolvedVideoId }
    : null;
  const useResolvedExactAudio = captureTarget(resolvedAudio.deviceId).exact;
  const useResolvedExactVideo =
    !!resolvedVideo && captureTarget(resolvedVideo.deviceId).exact;

  const doGetUserMedia = async (exactAudio: boolean, exactVideo: boolean) => {
    return navigator.mediaDevices.getUserMedia(
      mediaConstraints(resolvedAudio, resolvedVideo, exactAudio, exactVideo),
    );
  };

  let stream: MediaStream;
  try {
    stream = await doGetUserMedia(useResolvedExactAudio, useResolvedExactVideo);
    if (
      generation !== state.acquisitionGeneration ||
      requestOrder !== state.acquisitionOrder
    ) {
      stopStreamTracks(stream);
      throwIfAcquisitionStale(state, generation, requestOrder);
    }
  } catch (err: any) {
    const action = captureErrorAction(err?.name);
    if (action === "retry-system-default") {
      throwIfAcquisitionStale(state, generation, requestOrder);
      log.warn(
        `Exact device unavailable (${err.constraint ?? "unknown"}), retrying with system default`,
      );
      stream = await navigator.mediaDevices.getUserMedia(
        mediaConstraints(
          { ...resolvedAudio, deviceId: "default" },
          resolvedVideo ? { ...resolvedVideo, deviceId: "default" } : null,
          false,
          false,
        ),
      );
      if (
        generation !== state.acquisitionGeneration ||
        requestOrder !== state.acquisitionOrder
      ) {
        stopStreamTracks(stream);
        throwIfAcquisitionStale(state, generation, requestOrder);
      }
      if (isUnverified(audioLookup) || isUnverified(videoLookup)) {
        stream = await reopenStoredDevices(stream, {
          audio,
          video: videoConstraint,
          audioId: isUnverified(audioLookup)
            ? undefined
            : resolvedAudio.deviceId,
          videoId: isUnverified(videoLookup)
            ? undefined
            : resolvedVideo?.deviceId,
          isStale: () =>
            generation !== state.acquisitionGeneration ||
            requestOrder !== state.acquisitionOrder,
          log,
        });
        if (
          generation !== state.acquisitionGeneration ||
          requestOrder !== state.acquisitionOrder
        ) {
          stopStreamTracks(stream);
          throwIfAcquisitionStale(state, generation, requestOrder);
        }
      }
    } else if (action === "permission-denied") {
      // Permission denied — surface, don't swallow
      log.warn("Permission denied for getUserMedia");
      throw err;
    } else {
      throw err;
    }
  }

  throwIfAcquisitionStale(state, generation, requestOrder);

  state.activeStream = stream;
  const streamsToStop = new Set<MediaStream>();
  if (supersededActiveStream) streamsToStop.add(supersededActiveStream);
  if (supersededSharedStream) streamsToStop.add(supersededSharedStream);
  for (const supersededStream of streamsToStop) {
    if (supersededStream !== stream) stopStreamTracks(supersededStream);
  }
  state.activeAudioRequestDeviceId = audio.deviceId;
  state.activeVideoRequestDeviceId = videoConstraint?.deviceId;
  state.activeVideoRequestKey = videoRequestKey(resolvedVideo);
  state.streamPromise = null;

  // ── Post-acquire re-enumeration ────────────────────────────────────────
  // getUserMedia just unlocked the browser's device discovery. enumerateDevices()
  // is now near-instant (<20ms) and will return full device labels.
  // This is the Jitsi/Livekit pattern: enumerate AFTER stream acquisition.
  refreshDeviceLabels(state);

  log.info(
    `Stream acquired — audio: ${stream.getAudioTracks()[0]?.label ?? "none"}`,
  );
  return stream;
}

/**
 * Start getUserMedia eagerly before the WS handshake completes.
 * Returns a promise that resolves to the stream (or null on failure).
 * The in-flight promise is stored so acquireLocalStream() can await it
 * rather than spawning a second call.
 */
export function startEarlyMic(
  audio: LocalAudioConstraints,
  owner?: LocalMediaOwner,
): Promise<MediaStream | null> {
  const state = getLocalMediaState(owner);
  if (state.streamPromise) return state.streamPromise; // already in-flight

  lmLog.debug("Starting early mic acquisition...");
  const generation = state.acquisitionGeneration;
  const requestOrder = ++state.acquisitionOrder;
  const promise = lookupStoredAudio(audio, lmLog)
    .then(({ deviceId: resolvedId }) => {
      throwIfAcquisitionStale(state, generation, requestOrder);
      return navigator.mediaDevices.getUserMedia(
        mediaConstraints(
          { ...audio, deviceId: resolvedId },
          null,
          captureTarget(resolvedId).exact,
          false,
        ),
      );
    })
    .then((stream) => {
      if (!stream) return null;
      if (
        generation !== state.acquisitionGeneration ||
        requestOrder !== state.acquisitionOrder
      ) {
        stopStreamTracks(stream);
        throwIfAcquisitionStale(state, generation, requestOrder);
      }

      lmLog.info(`Early mic acquired: ${stream.getAudioTracks()[0]?.label}`);
      state.activeStream = stream;
      state.activeAudioRequestDeviceId = audio.deviceId;
      state.activeVideoRequestDeviceId = undefined;
      state.activeVideoRequestKey = null;
      if (state.streamPromise === promise) state.streamPromise = null;
      // Refresh labels now that the device lock is released
      refreshDeviceLabels(state);
      return stream;
    })
    .catch((err) => {
      lmLog.warn(
        "Early mic acquisition failed — will retry in swapDevices:",
        err.name,
      );
      if (state.streamPromise === promise) state.streamPromise = null;
      return null;
    });

  state.streamPromise = promise;
  return promise;
}

/** Invalidate pending acquisition work without clearing the active stream. */
export function cancelPendingLocalStreamAcquisition(
  owner?: LocalMediaOwner,
): void {
  getLocalMediaState(owner).acquisitionOrder += 1;
}

/**
 * Release the active stream reference. Does NOT stop tracks — the caller
 * is responsible for that (tracks may still be in a PeerConnection sender).
 */
export function releaseLocalStream(owner?: LocalMediaOwner): void {
  const state = getLocalMediaState(owner);
  state.acquisitionGeneration += 1;
  cancelPendingLocalStreamAcquisition(owner);
  state.activeStream = null;
  state.activeAudioRequestDeviceId = undefined;
  state.activeVideoRequestDeviceId = undefined;
  state.activeVideoRequestKey = null;
  state.streamPromise = null;
}

// ── Private: post-acquire label refresh ───────────────────────────────────
/**
 * Re-enumerate devices after getUserMedia has been called.
 * Desktop CEF's enumerateDevices returns full labels after the stream is
 * acquired and its permission/content setting has been recorded.
 * This is called automatically after every successful acquire.
 */
async function refreshDeviceLabels(state: LocalMediaState): Promise<void> {
  if (
    typeof navigator === "undefined" ||
    !navigator.mediaDevices?.enumerateDevices
  )
    return;

  try {
    const snapshot = await getMediaDeviceSnapshot();
    const resolvedMics = applyActiveAudioTrackLabel(
      snapshot.audioInputs,
      state.activeStream,
    );

    useMediaDeviceStore.getState()._update({
      hasMicrophone: resolvedMics.length > 0,
      hasCamera: snapshot.videoInputs.length > 0,
      audioInputs: resolvedMics,
      audioOutputs: snapshot.audioOutputs,
      videoInputs: snapshot.videoInputs,
    });

    lmLog.debug(
      `Labels refreshed: ${resolvedMics.length} mics, ${snapshot.videoInputs.length} cams, ${snapshot.audioOutputs.length} outputs, ${snapshot.nativeAudioDevices.length} native audio devices`,
    );
  } catch {
    // Not critical — labels stay stale from the slow initial enumerate
  }
}
