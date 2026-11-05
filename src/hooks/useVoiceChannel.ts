import { GridItem } from "@/components/voice/types";
import { toast } from "@/components/ui/toast";
import {
  createCameraBackgroundEffect,
  getCameraBackgroundEffectKey,
  type CameraBackgroundEffect,
} from "@/lib/camera-background-effects";
import { clog } from "@/lib/console-logger";
import {
  VOICE_MOVE_EVENT,
  type VoiceMoveDetail,
} from "@/lib/voice/voice-move-client";
import { clearVoiceMoveGrant } from "@/lib/voice/voice-move-grants";
import { buildCameraVideoConstraints } from "@/lib/camera-quality";
import {
  acquireLocalStream,
  cancelPendingLocalStreamAcquisition,
  createLocalMediaOwner,
  releaseLocalStream,
  startEarlyMic,
  type LocalMediaOwner,
} from "@/lib/local-media-manager";
import { resolveOutputSinkId } from "@/lib/stored-device";
import { isDesktop, isWgcCaptureAllowed } from "@/lib/platform";
import { getHost } from "@/lib/host";
import { areReconnectSoundsSuppressed } from "@/lib/reconnect-sound-guard";
import type { ScreenShareOptions } from "@/lib/screen-share-types";
import { SFUClient, type SFUEventMap } from "@/lib/sfu-client";
import { sendVoiceDisconnectBeacon } from "@/lib/voice-disconnect-beacon";
import {
  applyStreamWatcherSnapshot,
  type PendingStreamWatchIntents,
  buildStreamWatcherIdentities,
  getStreamWatcherActivitySound,
  isStreamWatcherSnapshotPayload,
  resolveWatchedStreamsWithPendingIntents,
  type StreamWatcherIdsByStreamer,
} from "@/lib/stream-watchers";
import { resolveVoiceIdentity } from "@/lib/voice-identity";
import {
  createLocalAudioProcessor,
  isNoiseReductionProviderSupported,
  resolveCaptureAudioProcessing,
  resolveLocalAudioProcessingMode,
  resolveLocalAudioPublicationMode,
  type LocalAudioProcessorHandle,
  type LocalAudioProcessingMode,
  type LocalAudioPublicationMode,
  type VoiceAudioProcessingSettings,
} from "@/lib/voice/noise-reduction";
import {
  isCaptureAudioContextSuspended,
  noteLocalAudioPublication,
  reportLocalAudioIssue,
} from "@/lib/voice/capture-audio-context";
import {
  DEFAULT_SHARED_SPATIAL_STATE,
  calculateSpatialAudioMix,
  calculateSpatialPositions,
  normalizeSpatialState,
  remoteSpatialParticipants,
  type SharedSpatialAudioState,
} from "@/lib/voice/spatial-audio";
import type { SilentAudioTrack } from "@/lib/voice/standby-audio";
import {
  claimVoiceStandby,
  dropVoiceStandby,
  holdVoiceStandby,
  markVoiceChannelJoining,
  retireVoiceStandby,
  isVoiceStandbyDisabled,
  setClaimedVoiceAudible,
  useVoiceStandbyActive,
} from "@/lib/voice/voice-standby";
import { prewarmAudioContext } from "@/lib/voice/audio-pipeline";
import { markVoice } from "@/lib/voice/latency-marks";
import { prefetchVoiceChannelJoin } from "@/lib/voice/voice-admission-client";
import { prewarmWebRtc } from "@/lib/voice/webrtc-prewarm";
import { getVoiceActivityThreshold } from "@/lib/voice/vad";
import {
  parseNativeShareEndedPayload,
  resolveNativeShareEndedAction,
} from "@/lib/voice/native-share-ended";
import {
  getSoundboardServerKey,
  stopAutomaticJoinSoundboardPlaybacksByOwner,
} from "@/lib/voice/soundboard";
import {
  cancelAutomaticSoundboardCleanup,
  getAutomaticSoundboardSessionId,
  getAutomaticSoundboardSessionGeneration,
  playAutomaticSoundboardTrigger,
  resetAutomaticSoundboardSession,
  type AutomaticSoundboardTransport,
} from "@/lib/voice/auto-soundboard";

import {
  VoiceSession,
  captureOutcome,
  captureProcessingMatches,
  deviceListKey,
  fallbackRetryId,
  listedDeviceId,
  liveCaptureMatches,
  type CaptureRecord,
  type SavedDevice,
  type PublicationGeneration,
  screenShareSubscription,
  type PublicationReconciler,
  type PublicationSlot,
  type ReconcileResult,
  type ScreenShareEvent,
  type TrackSlot,
  type VoiceEndReason,
} from "@ralph/voice";
import { createSfuPublicationReconciler } from "@/lib/voice/publication-media";
import {
  attachScreenPreview,
  createWebScreenShare,
  getCustomPickerDesktopStream,
  screenShareVideoConstraints,
  screenSourceState,
  webScreenShareRequest,
  type WebScreenCapture,
  type WebScreenShare,
  type WebScreenSource,
} from "@/lib/voice/screen-share-sources";
import {
  playConnected,
  playDeafen,
  playDisconnect,
  playMute,
  playScreenShareStart,
  playScreenShareStop,
  playStreamWatcherStart,
  playStreamWatcherStop,
  playUndeafen,
  playUnmute,
  playVoiceJoin,
} from "@/lib/sounds";
import type { VoiceState, VoiceStateDelta } from "@/lib/types";
import { useMediaDevices } from "@/lib/useMediaDevices";
import { useChatActions, useChatStore } from "@/stores/chat-store";
import { useVoiceSettingsStore } from "@/stores/useVoiceSettingsStore";
import { useUser } from "@kova/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { useShallow } from "zustand/shallow";
import { useNativeShareStats } from "@/hooks/useNativeShareStats";
import { useSpatialAudioSync } from "@/hooks/useSpatialAudioSync";

const vcLog = clog("VoiceChannel");
const screenLog = clog("ScreenShare");
const devicesLog = clog("Voice:Devices");
const previewLog = clog("Preview");
const ROOM_GUEST_SETTINGS_USER_ID = "room-guest";
const STREAM_PREVIEW_CAPTURE_WIDTH = 224;
const STREAM_PREVIEW_CAPTURE_QUALITY = 0.4;
const STREAM_PREVIEW_CAPTURE_INTERVAL_MS = 8000;
const STREAM_PREVIEW_CAPTURE_INITIAL_DELAY_MS = 750;
let speakingSourceSequence = 0;

export function mergeVoiceState(
  cached: VoiceState | undefined,
  incoming: VoiceState | VoiceStateDelta,
): VoiceState | null {
  if (cached) return { ...cached, ...incoming };
  return "name" in incoming ? incoming : null;
}

/**
 * Whether a reconcile failed on `slot` itself. A run sets a slot aside when
 * its retries run out and still converges the others, so another slot's
 * failure (the screen share's, say) is not this caller's.
 */
function failedOn(
  result: ReconcileResult<MediaStreamTrack>,
  slot: PublicationSlot,
): result is Extract<ReconcileResult<MediaStreamTrack>, { status: "failed" }> {
  return result.status === "failed" && result.failedSlots.includes(slot);
}

function disposeVoiceActivityStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

export {
  getCustomPickerDesktopStream,
  resolvePreviewStartState,
  type PreviewStartDecision,
  type ScreenSharePreviewKind,
} from "@/lib/voice/screen-share-sources";

export interface ScreenVideoSubscriptionDecisionInput {
  /** The viewer pressed Watch on this share. */
  isWatched: boolean;
  /** The share's tile is on stage (which shows it as watched too). */
  isFocused: boolean;
}

/**
 * A remote screen share's video is pulled only while the viewer watches it,
 * the same rule its tile uses to show the video instead of the Watch prompt.
 * Its audio is pulled regardless ("always hear" only sets its volume), so an
 * unwatched share costs a few kbps, not a video stream.
 */
export function resolveScreenVideoSubscription({
  isWatched,
  isFocused,
}: ScreenVideoSubscriptionDecisionInput): boolean {
  return screenShareSubscription({
    watched: isWatched,
    shareFocused: isFocused,
    participantFocused: isFocused,
    alwaysHear: false,
  }).video;
}

/**
 * Stills for screen-share tiles. A remote share's video is pulled only while
 * watched, so the still behind an unwatched share's Watch prompt is the one
 * its publisher broadcasts (`stream_preview_url`, kept fresh while sharing);
 * a still captured here from pulled video fills in where there is none.
 * The local share keeps the still captured from its own preview.
 */
export function resolveStreamThumbnails(
  captured: Record<string, string>,
  members: ReadonlyArray<{
    user_id?: string;
    stream_preview_url?: string | null;
  }>,
  localUserId: string | null | undefined,
): Record<string, string> {
  let merged = captured;
  for (const member of members) {
    const preview = member.stream_preview_url;
    if (
      !member.user_id ||
      member.user_id === localUserId ||
      !preview ||
      merged[member.user_id] === preview
    ) {
      continue;
    }
    if (merged === captured) merged = { ...captured };
    merged[member.user_id] = preview;
  }
  return merged;
}

export type RemoteStreamsByUser = Record<string, Record<string, MediaStream>>;

export function upsertRemoteTrackStream(
  streams: RemoteStreamsByUser,
  userId: string,
  trackName: string,
  stream: MediaStream,
): RemoteStreamsByUser {
  const userStreams = streams[userId] || {};
  return { ...streams, [userId]: { ...userStreams, [trackName]: stream } };
}

export function removeRemoteTrackStream(
  streams: RemoteStreamsByUser,
  userId: string,
  trackName: string,
): RemoteStreamsByUser {
  const userStreams = streams[userId];
  if (!userStreams || !(trackName in userStreams)) return streams;

  const nextUserStreams = { ...userStreams };
  delete nextUserStreams[trackName];

  const next = { ...streams };
  if (Object.keys(nextUserStreams).length === 0) {
    delete next[userId];
  } else {
    next[userId] = nextUserStreams;
  }

  return next;
}

export interface PreviewResumeOutcome {
  /** Resulting `isPreviewHidden` for the session after the resume attempt. */
  isPreviewHidden: boolean;
  /** Stream to attach to the local tile (newly opened, CEF fallback, or null). */
  stream: MediaStream | null;
  /** True when a fresh native preview stream was opened (caller wires `onended`). */
  openedStream: boolean;
  /** True when a native reopen was attempted but failed (caller may warn). */
  reopenFailed: boolean;
}

export interface PreviewHideDecision {
  /** True when the current preview stream must stay alive while hidden. */
  preserveStream: boolean;
}

export type PreviewResumeMechanism =
  | "desktop-loopback"
  | "reopen-selected-source"
  | "restore-existing-stream";

/**
 * Chooses how the local preview should resume.
 *
 * Desktop hook/native shares must continue to use the dedicated loopback PC so
 * the preview reflects the actual encoded desktop output. Browser shares do not
 * have that native loopback path, so they either reopen a reusable selected
 * source or simply restore the already-captured local stream.
 */
export function resolvePreviewResumeMechanism(args: {
  isHookActive: boolean;
  hasReusablePreviewSource: boolean;
}): PreviewResumeMechanism {
  if (args.isHookActive) return "desktop-loopback";
  if (args.hasReusablePreviewSource) return "reopen-selected-source";
  return "restore-existing-stream";
}

/**
 * Pure hide decision for the local preview pause flow.
 *
 * Browser `getDisplayMedia` shares have no reusable source identifier, so once
 * their preview stream is stopped there is nothing we can reopen without
 * prompting the user again. In that case we hide the tile but keep the current
 * preview stream alive. Native/hook-backed previews can be recreated later, so
 * they still tear down the preview stream to save resources.
 */
export function resolvePreviewHideState(args: {
  isHookActive: boolean;
  hasReusablePreviewSource: boolean;
}): PreviewHideDecision {
  return {
    preserveStream: !args.isHookActive && !args.hasReusablePreviewSource,
  };
}

/**
 * Pure resume decision for the `togglePreviewHidden` un-hide path (Req 5.3).
 *
 * When the share is native and the source is known (`canReopenNativePreview`),
 * the existing flow reopens the CEF preview for that source via the injected
 * `openPreviewStream` opener. On success the preview is shown with the new
 * stream; on failure it stays paused. For a non-native (CEF) share the existing
 * share's local stream is restored without opening anything new.
 *
 * Extracting the decision here keeps the side-effectful pieces (ref assignment,
 * `onended` teardown wiring, dispatch) in the hook while making the resume
 * branching unit-testable without a DOM or the full hook environment.
 */
export async function resolvePreviewResume(args: {
  /** True when we know the native source and can reopen its CEF preview. */
  canReopenNativePreview: boolean;
  /** Opens a CEF preview MediaStream for the known native source. */
  openPreviewStream: () => Promise<MediaStream | null>;
  /** Existing preview/local stream to fall back to when nothing is reopened. */
  existingPreviewStream: MediaStream | null;
}): Promise<PreviewResumeOutcome> {
  if (args.canReopenNativePreview) {
    try {
      const stream = await args.openPreviewStream();
      return {
        isPreviewHidden: false,
        stream,
        openedStream: true,
        reopenFailed: false,
      };
    } catch {
      return {
        isPreviewHidden: true,
        stream: null,
        openedStream: false,
        reopenFailed: true,
      };
    }
  }
  return {
    isPreviewHidden: false,
    stream: args.existingPreviewStream,
    openedStream: false,
    reopenFailed: false,
  };
}

export interface UseVoiceChannelProps {
  channelId?: string;
  /** Server ID. Required for voice channels, optional for calls (when roomSlug is provided). */
  serverId?: string;
  /** Override the room slug (e.g. for calls that use a dedicated voice room) */
  roomSlug?: string;
  /** When true, skips voice-channel-specific gateway messages (join/leave) */
  isCall?: boolean;
  /** Operating mode: "channel" (server), "call" (dms), or "room" (anonymous generic links) */
  mode?: "channel" | "call" | "room";
  guestName?: string;
  onJoined?: () => void;
  onLeft?: () => void;
  autoJoin?: boolean;
}

/** The props one teardown runs with: those of the render that started it. */
interface VoiceTeardownInputs {
  automaticSoundboardSessionId: string;
  channelId: string | null | undefined;
  createAutomaticSoundboardTransport: (
    voiceClient: SFUClient | null,
  ) => AutomaticSoundboardTransport | undefined;
  isCall: boolean;
  localMediaOwner: LocalMediaOwner;
  mode: "channel" | "call" | "room";
  onLeft?: () => void;
  sendVoiceChannelLeave: (channelId: string) => void;
  serverId: string | null | undefined;
}

/**
 * A processor built from the early microphone capture on a join click, in
 * parallel with the voice gateway connecting. The device sync adopts it when
 * it is for the same capture track and settings.
 */
interface EarlyAudioProcessor {
  trackId: string | null;
  settingsKey: string;
  promise: Promise<LocalAudioProcessorHandle | null>;
}

function discardEarlyAudioProcessor(ref: {
  current: EarlyAudioProcessor | null;
}): void {
  const early = ref.current;
  ref.current = null;
  if (early) void early.promise.then((processor) => processor?.destroy());
}

/**
 * The early processor when it matches `stream` and `settings`; otherwise
 * undefined (and the early one, if any, is destroyed).
 */
async function takeEarlyAudioProcessor(
  ref: { current: EarlyAudioProcessor | null },
  stream: MediaStream,
  settings: VoiceAudioProcessingSettings,
): Promise<LocalAudioProcessorHandle | undefined> {
  const early = ref.current;
  if (!early) return undefined;
  ref.current = null;
  const processor = await early.promise;
  if (
    processor &&
    early.trackId === stream.getAudioTracks()[0]?.id &&
    early.settingsKey === JSON.stringify(settings)
  ) {
    return processor;
  }
  processor?.destroy();
  return undefined;
}

/** What a failed publication mode falls back to. */
function fallbackPublicationMode(
  mode: LocalAudioPublicationMode,
): LocalAudioPublicationMode {
  // RNNoise and true-stereo fall back to the identity graph (still gated);
  // a failed identity graph leaves the raw microphone published.
  return mode === "passthrough" || mode === "direct" ? "direct" : "passthrough";
}

const NO_DEVICES: readonly never[] = [];

/**
 * One kind's device intent for the capture sync: the saved choice and its
 * selection counter (moves on every pick, even of the same device).
 */
interface DeviceIntent {
  readonly saved: SavedDevice;
  readonly selection: number;
}

/** The opened device as @ralph/voice compares it with the saved one. */
function openedDevice(track: MediaStreamTrack): SavedDevice {
  const settings = track.getSettings();
  return {
    deviceId: settings.deviceId,
    label: track.label,
    groupId: settings.groupId,
  };
}

/** Whether the current microphone publication is what `mode` asks for. */
function publicationMatches(
  processor: LocalAudioProcessorHandle | null,
  mode: LocalAudioPublicationMode,
  voiceGateEnabled: boolean,
): boolean {
  if ((processor?.mode ?? "direct") !== mode) return false;
  const lookaheadMs = processor?.gateLookaheadMs;
  // The gate's lookahead is fixed when the processor is built.
  return lookaheadMs === undefined || lookaheadMs > 0 === voiceGateEnabled;
}

export function useVoiceChannel({
  channelId,
  serverId,
  roomSlug: roomSlugOverride,
  isCall = false,
  mode = "channel",
  guestName,
  onJoined,
  onLeft,
  autoJoin = false,
}: UseVoiceChannelProps) {
  const { user } = useUser();
  const {
    voiceChannelStates,
    voiceChannelSpatialAudioStates,
    chatUserAvatarUrl,
    chatUserAvatarDisplay,
    chatUserDisplayName,
    chatUsername,
    voiceChannelStartedAt,
  } = useChatStore(
    useShallow((s) => ({
      voiceChannelStates: s.voiceChannelStates,
      voiceChannelSpatialAudioStates: s.voiceChannelSpatialAudioStates,
      chatUserAvatarUrl: s.user?.avatar_url,
      chatUserAvatarDisplay: s.user?.avatar_display,
      chatUserDisplayName: s.user?.display_name,
      chatUsername: s.user?.username,
      voiceChannelStartedAt: s.voiceChannelStartedAt,
    })),
  );
  const {
    dispatch,
    sendVoiceChannelJoin,
    sendVoiceChannelLeave,
    sendVoiceStateUpdate,
    setSpeakingUsers,
    clearSpeakingUsers,
  } = useChatActions();
  const speakingSourceIdRef = useRef<string | null>(null);
  if (!speakingSourceIdRef.current) {
    speakingSourceIdRef.current = `voice-session-${++speakingSourceSequence}`;
  }
  const currentVoiceChannelStartedAt = channelId
    ? (voiceChannelStartedAt[channelId] ?? null)
    : null;
  const resolvedRoomSlug =
    roomSlugOverride ||
    (serverId && channelId ? `voice-${serverId}-${channelId}` : "");
  const automaticSoundboardSessionId = getAutomaticSoundboardSessionId(
    isCall ? "call" : mode,
    resolvedRoomSlug || channelId || "voice",
  );
  const createAutomaticSoundboardTransport = useCallback(
    (
      voiceClient: SFUClient | null,
    ): AutomaticSoundboardTransport | undefined => {
      const userId = user?.id;
      const serverKey = isCall ? "dm-call" : serverId;
      if (!voiceClient || !userId || !serverKey || mode === "room") {
        return undefined;
      }
      return {
        serverKey,
        userId,
        sendAppEvent: (payload) => voiceClient.voiceGW.sendAppEvent(payload),
        isReady: () => voiceClient.voiceGW.isReady,
        waitUntilReady: () => voiceClient.waitForVoiceGatewayReady(),
      };
    },
    [isCall, mode, serverId, user?.id],
  );

  const [voiceState, voiceDispatch] = useReducer(
    (state: any, action: any) => {
      switch (action.type) {
        case "JOINED":
          return { ...state, joined: true, connectionState: "connected" };
        case "LEFT":
          return {
            ...state,
            joined: false,
            connectionState: "disconnected",
            localScreenStream: null,
            isScreenSharing: false,
            isStreamingAudio: false,
            currentScreenSource: null,
            isPreviewHidden: false,
            speakingUsers: {},
            watchedStreams: {},
            streamWatcherIdsByStreamer: {},
            streamThumbnails: {},
            remoteStreams: {},
            participantsVersion: 0,
            audioStalled: false,
          };
        case "SET_CONNECTION":
          return { ...state, connectionState: action.payload };
        case "SET_SCREEN_SHARING":
          return {
            ...state,
            isScreenSharing: action.payload,
            localScreenStream: action.stream,
            isStreamingAudio: action.audio ?? state.isStreamingAudio,
          };
        case "SET_PREVIEW_HIDDEN":
          return {
            ...state,
            isPreviewHidden: action.payload,
            localScreenStream:
              action.stream !== undefined
                ? action.stream
                : state.localScreenStream,
          };
        case "SET_SCREEN_SOURCE":
          return { ...state, currentScreenSource: action.payload };
        case "SET_CAMERA":
          return { ...state, isCameraActive: action.payload };
        case "SET_FOCUSED":
          return { ...state, focusedId: action.payload };
        case "SET_AUDIO_BLOCKED":
          return { ...state, audioBlocked: action.payload };
        case "SET_SPEAKING": {
          const next =
            typeof action.payload === "function"
              ? action.payload(state.speakingUsers)
              : action.payload;
          return { ...state, speakingUsers: next };
        }
        case "SET_WATCHED": {
          const next =
            typeof action.payload === "function"
              ? action.payload(state.watchedStreams)
              : action.payload;
          return { ...state, watchedStreams: next };
        }
        case "SET_STREAM_WATCHER_IDS": {
          const next =
            typeof action.payload === "function"
              ? action.payload(state.streamWatcherIdsByStreamer)
              : action.payload;
          return { ...state, streamWatcherIdsByStreamer: next };
        }
        case "UPDATE_REMOTE_STREAMS": {
          const next =
            typeof action.payload === "function"
              ? action.payload(state.remoteStreams)
              : action.payload;
          return { ...state, remoteStreams: next };
        }
        case "SET_THUMBNAILS": {
          const next =
            typeof action.payload === "function"
              ? action.payload(state.streamThumbnails)
              : action.payload;
          return { ...state, streamThumbnails: next };
        }
        case "SET_AUDIO_STALLED":
          return { ...state, audioStalled: action.payload };
        case "SET_SPATIAL_AUDIO_STATE":
          return { ...state, spatialAudioState: action.payload };
        case "SET_SCREEN_QUALITY":
          return { ...state, currentScreenQuality: action.payload };
        case "BUMP_PARTICIPANTS":
          return {
            ...state,
            participantsVersion: (state.participantsVersion ?? 0) + 1,
          };
        default:
          return state;
      }
    },
    {
      joined: false,
      isScreenSharing: false,
      localScreenStream: null,
      isStreamingAudio: false,
      currentScreenQuality: "720p30",
      currentScreenSource: null,
      isPreviewHidden: false,
      isCameraActive: false,
      connectionState: "new",
      focusedId: null,
      speakingUsers: {},
      watchedStreams: {},
      streamWatcherIdsByStreamer: {},
      streamThumbnails: {},
      audioBlocked: false,
      remoteStreams: {},
      participantsVersion: 0,
      audioStalled: false,
      spatialAudioState: DEFAULT_SHARED_SPATIAL_STATE,
    },
  );

  const {
    joined,
    isScreenSharing,
    localScreenStream,
    isStreamingAudio,
    currentScreenQuality,
    currentScreenSource,
    isPreviewHidden,
    isCameraActive,
    connectionState,
    focusedId,
    speakingUsers,
    watchedStreams,
    streamWatcherIdsByStreamer,
    streamThumbnails,
    audioBlocked,
    remoteStreams,
    participantsVersion,
    audioStalled,
    spatialAudioState,
  } = voiceState;
  const desiredCameraStateRef = useRef(isCameraActive);
  const desiredCameraIntentVersionRef = useRef(0);

  useEffect(() => {
    desiredCameraStateRef.current = isCameraActive;
  }, [isCameraActive]);

  const { isHookActive } = useNativeShareStats();

  useEffect(() => {
    const localUserId =
      mode === "room" ? myIdRef.current || null : user?.id || null;
    const canBroadcastSidebarPreview = joined && mode !== "room";

    const pushStreamPreviewUpdate = (previewUrl: string | null) => {
      if (!canBroadcastSidebarPreview) {
        lastSentStreamPreviewUrlRef.current = null;
        return;
      }
      if (lastSentStreamPreviewUrlRef.current === previewUrl) return;
      lastSentStreamPreviewUrlRef.current = previewUrl;
      sendVoiceStateUpdate({ stream_preview_url: previewUrl });
    };

    const clearLocalThumbnail = () => {
      if (!localUserId) return;
      voiceDispatch({
        type: "SET_THUMBNAILS",
        payload: (prev: Record<string, string>) => {
          if (!(localUserId in prev)) return prev;
          const next = { ...prev };
          delete next[localUserId];
          return next;
        },
      });
      pushStreamPreviewUpdate(null);
    };

    const cleanupCapture = () => {
      const capture = localThumbnailCaptureRef.current;
      if (!capture) return;
      if (capture.timeoutId !== null) {
        window.clearTimeout(capture.timeoutId);
      }
      capture.video.pause();
      capture.video.srcObject = null;
      localThumbnailCaptureRef.current = null;
    };

    if (!localUserId || !isScreenSharing || !localScreenStream) {
      cleanupCapture();
      clearLocalThumbnail();
      return;
    }

    const track = localScreenStream.getVideoTracks()[0];
    if (!track || track.readyState !== "live") {
      cleanupCapture();
      clearLocalThumbnail();
      return;
    }

    let cancelled = false;

    const ensureCapture = () => {
      if (!localThumbnailCaptureRef.current) {
        const video = document.createElement("video");
        video.muted = true;
        video.playsInline = true;
        localThumbnailCaptureRef.current = {
          video,
          canvas: document.createElement("canvas"),
          timeoutId: null,
        };
      }
      return localThumbnailCaptureRef.current;
    };

    const captureThumb = () => {
      if (cancelled || track.readyState !== "live") {
        cleanupCapture();
        clearLocalThumbnail();
        return;
      }

      try {
        const capture = ensureCapture();
        const { video, canvas } = capture;

        if (video.srcObject !== localScreenStream) {
          video.srcObject = localScreenStream;
        }

        video
          .play()
          .then(() => {
            if (cancelled) return;
            if (!video.videoWidth || !video.videoHeight) return;

            canvas.width = Math.min(
              video.videoWidth,
              STREAM_PREVIEW_CAPTURE_WIDTH,
            );
            canvas.height =
              Math.round(
                canvas.width * (video.videoHeight / video.videoWidth),
              ) || 180;

            const ctx = canvas.getContext("2d");
            if (!ctx) return;

            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL(
              "image/jpeg",
              STREAM_PREVIEW_CAPTURE_QUALITY,
            );

            voiceDispatch({
              type: "SET_THUMBNAILS",
              payload: (prev: Record<string, string>) =>
                prev[localUserId] === dataUrl
                  ? prev
                  : { ...prev, [localUserId]: dataUrl },
            });
            pushStreamPreviewUpdate(dataUrl);
          })
          .catch(() => {
            /* ignore */
          });
      } catch {
        // Ignore thumbnail failures; the UI will fall back to the placeholder preview.
      }

      const capture = ensureCapture();
      if (capture.timeoutId !== null) {
        window.clearTimeout(capture.timeoutId);
      }
      capture.timeoutId = window.setTimeout(
        captureThumb,
        STREAM_PREVIEW_CAPTURE_INTERVAL_MS,
      );
    };

    const capture = ensureCapture();
    if (capture.timeoutId !== null) {
      window.clearTimeout(capture.timeoutId);
    }
    capture.timeoutId = window.setTimeout(
      captureThumb,
      STREAM_PREVIEW_CAPTURE_INITIAL_DELAY_MS,
    );

    return () => {
      cancelled = true;
      cleanupCapture();
      clearLocalThumbnail();
    };
  }, [
    isScreenSharing,
    joined,
    localScreenStream,
    mode,
    sendVoiceStateUpdate,
    user?.id,
  ]);

  // Clean up global speaking state on unmount
  useEffect(() => {
    return () => clearSpeakingUsers(speakingSourceIdRef.current!);
  }, [clearSpeakingUsers]);

  // The session's client (standby, connecting, joined or reconnecting) for
  // the imperative code below. Only the session writes it (onClientChange);
  // it is null while idle and from the first step of a teardown.
  const sfuRef: { readonly current: SFUClient | null } =
    useRef<SFUClient | null>(null);
  // The one record of whether there is a voice session, which client it has
  // and which phase it is in (packages/voice/STATE_MACHINE.md). Everything
  // below asks it; nothing else tracks "joined" or "standby" imperatively.
  const [voiceSession] = useState(
    () =>
      new VoiceSession<SFUClient>({
        timers: {
          setTimeout: (callback, ms) => window.setTimeout(callback, ms),
          clearTimeout: (handle) => window.clearTimeout(handle as number),
        },
        onStepError: (step, error) =>
          vcLog.warn("Voice teardown step failed", { step, error }),
        onClientChange: (client) => {
          (sfuRef as { current: SFUClient | null }).current = client;
        },
      }),
  );
  const standbySilenceRef = useRef<SilentAudioTrack | null>(null);
  const releaseStandbySilence = useCallback((nextTrack?: MediaStreamTrack) => {
    const silence = standbySilenceRef.current;
    if (!silence || silence.track === nextTrack) return;
    standbySilenceRef.current = null;
    silence.stop();
  }, []);
  // Tracks whether auto-join has already fired for the current autoJoin=true
  // activation. Prevents re-joining immediately after an explicit handleLeave()
  // while the URL (and therefore autoJoin prop) still points at a voice channel.
  // Reset whenever autoJoin transitions false→true (e.g. user navigates away
  // and comes back to the voice channel via the sidebar).
  const hasAutoJoined = useRef(false);
  const autoJoinTargetRef = useRef<string | null>(null);
  // sfuInstance is the reactive copy of the session's client — the session
  // does NOT trigger re-renders, so consumers (CallVoiceManager's sync effect,
  // useVoiceStats, etc.) would never see it change. It is set on join and
  // cleared by the teardown's releaseClient step; sfuRef is used for all
  // imperative calls.
  const [sfuInstance, setSfuInstance] = useState<SFUClient | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const publishedAudioProcessorRef = useRef<LocalAudioProcessorHandle | null>(
    null,
  );
  const failedAudioProcessingModeRef = useRef<LocalAudioProcessingMode | null>(
    null,
  );
  const ownedVadMonitorStreamRef = useRef<MediaStream | null>(null);
  /** This hook's forced-disconnect teardown (not the window-wide event). */
  const forceDisconnectRef = useRef<(() => void) | null>(null);
  const earlyAudioProcessorRef = useRef<EarlyAudioProcessor | null>(null);
  const rawCameraTrackRef = useRef<MediaStreamTrack | null>(null);
  const cameraBackgroundEffectRef = useRef<CameraBackgroundEffect | null>(null);
  const activeCameraBackgroundKeyRef = useRef("none");
  const activeCameraQualityRef = useRef<string | null>(null);
  // What each live capture track was opened for (@ralph/voice
  // `CaptureRecord`, DEVICES.md "Keeping a capture"): a fallback track keeps
  // answering its request until the saved device is listed differently or
  // the user picks a device again.
  const audioCaptureRequestRef = useRef<CaptureRecord<MediaStreamTrack> | null>(
    null,
  );
  const videoCaptureRequestRef = useRef<CaptureRecord<MediaStreamTrack> | null>(
    null,
  );
  // True while the live track is a fallback for a saved device. Only then do
  // device list changes rerun the capture sync (`fallbackRetryId`), so the
  // list unlocking at join doesn't restart a capture that already opened
  // the saved device.
  const [inputCaptureFellBack, setInputCaptureFellBack] = useState(false);
  const [videoCaptureFellBack, setVideoCaptureFellBack] = useState(false);
  // Capture ownership (getUserMedia, processors, camera effects), not
  // publication: each capture sync and camera toggle takes a generation and
  // drops what it captured once a newer one started. Mute takes none.
  const captureGenerationRef = useRef(0);
  // The capture sync in flight. The first one of a session is not restarted
  // by a re-run that asks for the same devices and settings.
  const captureRunRef = useRef<{
    readonly generation: number;
    readonly client: SFUClient;
    readonly requestKey: string;
    readonly initial: boolean;
    done: boolean;
  } | null>(null);
  /**
   * Whether a capture sync for `client` is still on its way (with
   * `initialOnly`, only the session's first one). Stall recovery and camera
   * toggles must not displace it.
   */
  const isCaptureInFlight = useCallback(
    (client: SFUClient, options?: { initialOnly?: boolean }): boolean => {
      const run = captureRunRef.current;
      return (
        !!run &&
        !run.done &&
        run.client === client &&
        run.generation === captureGenerationRef.current &&
        (!options?.initialOnly || run.initial)
      );
    },
    [],
  );
  // Bumped to re-run the capture sync (unmute with no live microphone).
  const [captureRetryNonce, setCaptureRetryNonce] = useState(0);
  // The one owner of this session's microphone and camera publications
  // (packages/voice, "Publication"). Created for a client on first use and
  // disposed by the teardown.
  const publicationRef = useRef<{
    readonly client: SFUClient;
    readonly reconciler: PublicationReconciler<MediaStreamTrack>;
  } | null>(null);
  const publicationFor = useCallback(
    (client: SFUClient): PublicationReconciler<MediaStreamTrack> => {
      const current = publicationRef.current;
      if (current?.client === client && !current.reconciler.isDisposed) {
        return current.reconciler;
      }
      current?.reconciler.dispose();
      const reconciler = createSfuPublicationReconciler(
        client,
        () => myIdRef.current,
      );
      publicationRef.current = { client, reconciler };
      return reconciler;
    },
    [],
  );
  /**
   * The track the session has committed on `slot` (what it would publish if
   * nothing were in flight), if it is still live. An abandoned or failed
   * publication change hands the slot back to this, never to whatever intent
   * it displaced: that may be another abandoned change's, already released.
   */
  const committedPublicationTrack = useCallback(
    (slot: TrackSlot): MediaStreamTrack | null => {
      const live = (track: MediaStreamTrack | null | undefined) =>
        track && track.readyState !== "ended" ? track : null;
      if (slot === "camera") {
        return live(localStreamRef.current?.getVideoTracks()[0]);
      }
      const processor = publishedAudioProcessorRef.current;
      if (processor) {
        return live(processor.publicationStream.getAudioTracks()[0]);
      }
      return (
        live(localStreamRef.current?.getAudioTracks()[0]) ??
        live(standbySilenceRef.current?.track)
      );
    },
    [],
  );
  /** The reconciler of `client` if it has one (never creates one). */
  const existingPublication = useCallback(
    (
      client: SFUClient | null,
    ): PublicationReconciler<MediaStreamTrack> | null => {
      const current = publicationRef.current;
      return client &&
        current?.client === client &&
        !current.reconciler.isDisposed
        ? current.reconciler
        : null;
    },
    [],
  );
  const [localMediaOwner] = useState<LocalMediaOwner>(() =>
    createLocalMediaOwner(),
  );
  const standbyMediaOwnerRef = useRef<LocalMediaOwner | null>(null);
  const alwaysShowStreamPreviewRef = useRef(false);
  // A native share ended by itself; set below, where it is defined.
  const nativeShareEndedRef = useRef<
    (
      rawPayload: unknown,
      client: SFUClient | null,
      origin: "backend" | "reconnect",
    ) => void
  >(() => {});
  // The one owner of this session's screen share (packages/voice,
  // SCREEN_SHARE.md); it publishes through the client's reconciler.
  // Created for a client on first use and disposed by the teardown.
  const screenShareRef = useRef<{
    readonly client: SFUClient;
    readonly share: WebScreenShare;
  } | null>(null);
  const existingScreenShare = useCallback(
    (client: SFUClient | null): WebScreenShare | null => {
      const current = screenShareRef.current;
      return client && current?.client === client && !current.share.isDisposed
        ? current.share
        : null;
    },
    [],
  );
  const screenShareFor = useCallback(
    (client: SFUClient): WebScreenShare => {
      const existing = existingScreenShare(client);
      if (existing) return existing;
      screenShareRef.current?.share.dispose();
      const share = createWebScreenShare({
        sfu: client,
        publication: publicationFor(client),
        participantId: () => myIdRef.current,
        alwaysShowPreview: () => alwaysShowStreamPreviewRef.current,
      });
      share.subscribe(
        (event: ScreenShareEvent<WebScreenSource, WebScreenCapture>) => {
          switch (event.type) {
            case "started":
            case "updated": {
              const { request, capture, path } = event.share;
              voiceDispatch({
                type: "SET_SCREEN_SHARING",
                payload: true,
                stream: capture.stream,
                audio: request.audio,
              });
              if (event.type === "started" && path === "native") {
                voiceDispatch({
                  type: "SET_PREVIEW_HIDDEN",
                  payload: capture.previewHidden,
                  stream: capture.stream,
                });
              }
              voiceDispatch({
                type: "SET_SCREEN_QUALITY",
                payload: request.quality,
              });
              if (event.type === "started") {
                voiceDispatch({
                  type: "SET_SCREEN_SOURCE",
                  payload: screenSourceState(request.source),
                });
                playScreenShareStart();
              }
              return;
            }
            case "restart-failed":
              screenLog.warn(
                "Screen share restart failed; the live share is kept",
                event.error,
              );
              return;
            case "ended":
              if (event.reason === "failed") {
                screenLog.error("Screen share failed:", event.error);
              }
              voiceDispatch({
                type: "SET_SCREEN_SHARING",
                payload: false,
                stream: null,
                audio: false,
              });
              voiceDispatch({ type: "SET_SCREEN_SOURCE", payload: null });
              if (event.reason === "stopped" && event.announced) {
                playScreenShareStop();
              }
              return;
            default:
              return;
          }
        },
      );
      screenShareRef.current = { client, share };
      return share;
    },
    [existingScreenShare, publicationFor],
  );
  const participantsRef = useRef<Map<string, VoiceState>>(new Map());
  const voiceChannelMembersRef = useRef(
    voiceChannelStates[channelId ?? ""] ?? [],
  );
  voiceChannelMembersRef.current = channelId
    ? (voiceChannelStates[channelId] ?? [])
    : [];
  const remoteAudioAttachedAtRef = useRef(new Map<string, number>());
  const volumeDecisionLogRef = useRef(new Map<string, string>());
  const sentVoiceMuteRef = useRef<{ mute: boolean; deaf: boolean } | null>(
    null,
  );
  const publishMicLogRef = useRef("");
  const remoteAggregatorsRef = useRef<
    Record<string, { cam: MediaStream; screen: MediaStream }>
  >({});
  const capturingThumbnails = useRef<Set<string>>(new Set());
  const thumbnailCaptureRefs = useRef<
    Record<
      string,
      {
        video: HTMLVideoElement;
        canvas: HTMLCanvasElement;
        timeoutId: number | null;
      }
    >
  >({});
  const localThumbnailCaptureRef = useRef<{
    video: HTMLVideoElement;
    canvas: HTMLCanvasElement;
    timeoutId: number | null;
  } | null>(null);
  const lastSentStreamPreviewUrlRef = useRef<string | null>(null);
  const watchedStreamsRef = useRef<Record<string, boolean>>({});
  const pendingWatchIntentsRef = useRef<PendingStreamWatchIntents>({});
  const streamWatcherIdsRef = useRef<StreamWatcherIdsByStreamer>({});
  const hasReceivedInitialStreamWatcherSnapshotRef = useRef(false);
  const focusedIdRef = useRef<string | null>(null);

  const myIdRef = useRef<string>("");
  const uuidToUserIdRef = useRef<Map<string, string>>(new Map());
  const speakingByParticipantRef = useRef<Record<string, boolean>>({});
  const {
    hasMicrophone,
    hasCamera,
    audioInputs = NO_DEVICES,
    audioOutputs = NO_DEVICES,
    videoInputs = NO_DEVICES,
  } = useMediaDevices();

  const settingsUserId =
    mode === "room" ? ROOM_GUEST_SETTINGS_USER_ID : user?.id || "guest";
  const {
    isMuted: settingsMuted,
    isDeafened: settingsDeafened,
    inputDeviceId,
    inputDeviceLabel,
    inputDeviceGroupId,
    videoDeviceId,
    videoDeviceLabel,
    videoDeviceGroupId,
    cameraQuality,
    cameraBackground,
    customCameraBackgrounds,
    noiseSuppression,
    noiseReductionEnabled,
    noiseReductionProvider,
    echoCancellation,
    autoSensitivity,
    sensitivity,
    streamHighFidelity,
    outputVolume,
    outputDeviceId,
    outputDeviceLabel,
    outputDeviceGroupId,
    spatialAudioEnabled,
    inputProfile,
    alwaysShowStreamPreview,
  } = useVoiceSettingsStore(
    useShallow((s) => {
      const st = s.getSettings(settingsUserId);
      return {
        isMuted: st.isMuted,
        isDeafened: st.isDeafened,
        inputDeviceId: st.inputDeviceId,
        inputDeviceLabel: st.inputDeviceLabel,
        inputDeviceGroupId: st.inputDeviceGroupId,
        videoDeviceId: st.videoDeviceId,
        videoDeviceLabel: st.videoDeviceLabel,
        videoDeviceGroupId: st.videoDeviceGroupId,
        cameraQuality: st.cameraQuality,
        cameraBackground: st.cameraBackground,
        customCameraBackgrounds: st.customCameraBackgrounds,
        noiseSuppression: st.noiseSuppression,
        noiseReductionEnabled: st.noiseReductionEnabled,
        noiseReductionProvider: st.noiseReductionProvider,
        echoCancellation: st.echoCancellation,
        autoSensitivity: st.autoSensitivity,
        sensitivity: st.sensitivity,
        streamHighFidelity: st.streamHighFidelity,
        spatialAudioEnabled: st.spatialAudioEnabled,
        inputProfile: st.inputProfile,
        outputVolume: st.outputVolume,
        outputDeviceId: st.outputDeviceId,
        outputDeviceLabel: st.outputDeviceLabel,
        outputDeviceGroupId: st.outputDeviceGroupId,
        alwaysShowStreamPreview: !!st.alwaysShowStreamPreview,
      };
    }),
  );
  alwaysShowStreamPreviewRef.current = alwaysShowStreamPreview;
  const noiseReductionSupported = isNoiseReductionProviderSupported(
    noiseReductionProvider,
  );
  const isStudioMode = inputProfile === "studio";
  const audioProcessingSettings = useMemo<VoiceAudioProcessingSettings>(
    () => ({
      noiseSuppression,
      echoCancellation,
      autoSensitivity,
      streamHighFidelity,
      noiseReductionEnabled: noiseReductionEnabled && noiseReductionSupported,
      noiseReductionProvider,
      // Studio turns the sensitivity gate off; without it (and without
      // RNNoise) the microphone is published directly, with no Web Audio hop.
      voiceGateEnabled: !isStudioMode,
    }),
    [
      autoSensitivity,
      echoCancellation,
      isStudioMode,
      noiseReductionEnabled,
      noiseReductionProvider,
      noiseReductionSupported,
      noiseSuppression,
      streamHighFidelity,
    ],
  );
  const audioProcessingSettingsRef = useRef(audioProcessingSettings);
  useEffect(() => {
    audioProcessingSettingsRef.current = audioProcessingSettings;
  }, [audioProcessingSettings]);

  useEffect(() => {
    failedAudioProcessingModeRef.current = null;
  }, [audioProcessingSettings]);

  const setCurrentUser = useVoiceSettingsStore((s) => s.setCurrentUser);
  const setIsMuted = useVoiceSettingsStore((s) => s.setIsMuted);
  const setIsDeafened = useVoiceSettingsStore((s) => s.setIsDeafened);
  const setDevice = useVoiceSettingsStore((s) => s.setDevice);
  const inputSelectionRevision = useVoiceSettingsStore(
    (s) => s.deviceSelectionRevision?.input ?? 0,
  );
  const videoSelectionRevision = useVoiceSettingsStore(
    (s) => s.deviceSelectionRevision?.video ?? 0,
  );
  const outputSelectionRevision = useVoiceSettingsStore(
    (s) => s.deviceSelectionRevision?.output ?? 0,
  );
  // Device intent per kind (packages/voice/DEVICES.md). A new object only
  // when the saved choice or its selection counter moves, so each is one
  // capture-sync trigger.
  const microphoneIntent = useMemo<DeviceIntent>(
    () => ({
      saved: {
        deviceId: inputDeviceId,
        label: inputDeviceLabel,
        groupId: inputDeviceGroupId,
      },
      selection: inputSelectionRevision,
    }),
    [
      inputDeviceId,
      inputDeviceLabel,
      inputDeviceGroupId,
      inputSelectionRevision,
    ],
  );
  const cameraIntent = useMemo<DeviceIntent>(
    () => ({
      saved: {
        deviceId: videoDeviceId,
        label: videoDeviceLabel,
        groupId: videoDeviceGroupId,
      },
      selection: videoSelectionRevision,
    }),
    [
      videoDeviceId,
      videoDeviceLabel,
      videoDeviceGroupId,
      videoSelectionRevision,
    ],
  );
  // Where the saved microphone/camera is in the device list right now, or
  // null when it is not listed (unplugged, or the list is still hidden).
  const listedInputId = listedDeviceId(audioInputs, microphoneIntent.saved);
  const listedVideoId = listedDeviceId(videoInputs, cameraIntent.saved);
  const inputFallbackRetryId = fallbackRetryId(
    inputCaptureFellBack,
    listedInputId,
  );
  const videoFallbackRetryId = fallbackRetryId(
    videoCaptureFellBack,
    listedVideoId,
  );
  // Read by the capture sync without rerunning it on every list change; the
  // *FallbackRetryId deps rerun it when that matters.
  const listedDeviceIdsRef = useRef({
    input: listedInputId,
    video: listedVideoId,
  });
  useEffect(() => {
    listedDeviceIdsRef.current = { input: listedInputId, video: listedVideoId };
  }, [listedInputId, listedVideoId]);
  // Changes when a speaker is plugged in or the list unlocks after the first
  // capture, so a saved speaker that could not be resolved earlier is retried.
  const audioOutputsKey = deviceListKey(audioOutputs);
  const updateUserSettings = useVoiceSettingsStore((s) => s.updateUserSettings);

  const peerSettings = useVoiceSettingsStore(
    (s) => s.getSettings(settingsUserId).peerSettings,
  );

  const bandwidthPeerSettings = useMemo(() => {
    const map: Record<string, boolean> = {};
    Object.entries(peerSettings).forEach(([id, p]) => {
      if ((p as any).alwaysHear) map[id] = true;
    });
    return map;
  }, [peerSettings]);

  const currentSettingsRef = useRef({
    isMuted: settingsMuted,
    isDeafened: settingsDeafened,
    peerSettings,
  });
  useEffect(() => {
    currentSettingsRef.current = {
      isMuted: settingsMuted,
      isDeafened: settingsDeafened,
      peerSettings,
    };
  }, [settingsMuted, settingsDeafened, peerSettings]);

  const stopCameraBackgroundEffect = useCallback((stopRawSource = false) => {
    cameraBackgroundEffectRef.current?.stop();
    cameraBackgroundEffectRef.current = null;
    activeCameraBackgroundKeyRef.current = "none";

    if (stopRawSource) {
      const localVideoTracks = new Set(
        localStreamRef.current?.getVideoTracks() ?? [],
      );
      const rawTrack = rawCameraTrackRef.current;
      if (rawTrack && !localVideoTracks.has(rawTrack)) rawTrack.stop();
      rawCameraTrackRef.current = null;
    }
  }, []);

  useEffect(() => {
    watchedStreamsRef.current = watchedStreams;
  }, [watchedStreams]);
  useEffect(() => {
    streamWatcherIdsRef.current = streamWatcherIdsByStreamer;
  }, [streamWatcherIdsByStreamer]);
  useEffect(() => {
    focusedIdRef.current = focusedId;
  }, [focusedId]);
  useEffect(() => {
    if (!joined) {
      hasReceivedInitialStreamWatcherSnapshotRef.current = false;
      streamWatcherIdsRef.current = {};
      watchedStreamsRef.current = {};
      pendingWatchIntentsRef.current = {};
    }
  }, [joined]);

  const isMicOn = !settingsMuted && hasMicrophone;
  const publishMic = !settingsMuted;
  const isMicOnRef = useRef(publishMic);
  isMicOnRef.current = publishMic;

  // The speaking set every surface reads (via useIsSpeaking / useSpeakingAttr
  // on leaf components). Two gates apply before it leaves this hook:
  //   - your own entry only while your mic is live. The VAD can still report
  //     a trailing "speaking" when you mute mid-word (it is stopped, not
  //     flushed), and the server can echo it, so muted you never lights.
  //   - peers you muted locally never light (the tile always behaved so; the
  //     tree, the user panel and the call strip now agree with it).
  const publishedSpeakingUsers = useMemo(() => {
    const blocked: string[] = [];
    if (!isMicOn) {
      if (user?.id) blocked.push(user.id);
      if (myIdRef.current) blocked.push(myIdRef.current);
    }
    for (const [peerId, setting] of Object.entries(peerSettings)) {
      if ((setting as { muted?: boolean } | undefined)?.muted) {
        blocked.push(peerId);
      }
    }
    if (!blocked.some((id) => speakingUsers[id])) return speakingUsers;
    const next = { ...speakingUsers };
    for (const id of blocked) delete next[id];
    return next;
    // myIdRef is read at compute time; any change to who is speaking under
    // that id arrives as a new speakingUsers object.
  }, [speakingUsers, isMicOn, user?.id, peerSettings]);

  // Sync the gated speaking state to the global chat context.
  useEffect(() => {
    setSpeakingUsers(publishedSpeakingUsers, speakingSourceIdRef.current!);
  }, [publishedSpeakingUsers, setSpeakingUsers]);

  const restartVadMonitoring = useCallback(
    (
      sfu: SFUClient | null,
      processorOverride?: LocalAudioProcessorHandle | null,
      fallbackStream?: MediaStream | null,
    ) => {
      if (!sfu) return;

      if (isStudioMode) sfu.vad.disableNoiseGate();
      else sfu.vad.enableNoiseGate();

      sfu.vad.stop();
      disposeVoiceActivityStream(ownedVadMonitorStreamRef.current);
      ownedVadMonitorStreamRef.current = null;

      if (!isMicOnRef.current) return;

      const processor = processorOverride ?? publishedAudioProcessorRef.current;
      // The publication's gate detects speech itself; follow it (start()
      // returns false if that gate is not the one bound to the detector).
      if (processor?.gateController.inGraph && sfu.vad.start(null)) return;
      // Without a processor the raw (direct) microphone is what is published.
      const rawStream = fallbackStream ?? localStreamRef.current;
      const monitorStream = processor
        ? processor.createMonitorStream()
        : rawStream
          ? new MediaStream(
              rawStream
                .getAudioTracks()
                .filter((track) => track.readyState === "live")
                .map((track) =>
                  typeof track.clone === "function" ? track.clone() : track,
                ),
            )
          : null;
      if (!monitorStream || monitorStream.getAudioTracks().length === 0) {
        disposeVoiceActivityStream(monitorStream);
        return;
      }

      ownedVadMonitorStreamRef.current = monitorStream;
      if (!sfu.vad.start(monitorStream)) {
        disposeVoiceActivityStream(monitorStream);
        ownedVadMonitorStreamRef.current = null;
      }
    },
    [isStudioMode],
  );

  const isDeafened = settingsDeafened;
  const isCameraOn = isCameraActive && hasCamera;

  useEffect(() => {
    if (mode === "room" || user?.id) {
      setCurrentUser(settingsUserId);
    }
  }, [mode, user?.id, settingsUserId, setCurrentUser]);

  useEffect(() => {
    if (!sfuRef.current) return;
    const uuidMap = uuidToUserIdRef.current;

    for (const [uuid, appUserId] of uuidMap.entries()) {
      const settings: any = peerSettings[appUserId] || {
        volume: 100,
        streamVolume: 100,
        muted: false,
        alwaysHear: false,
      };

      const isPeerSilenced = isDeafened || settings.muted;
      const finalVolume = isPeerSilenced ? 0 : settings.volume / 100;
      const member = (
        channelId ? (voiceChannelStates[channelId] ?? []) : []
      ).find((entry) => entry.user_id === appUserId);
      const decision = `${member?.self_mute ?? ""}:${member?.self_deaf ?? ""}:${member?.connection_state ?? ""}:${finalVolume}`;
      if (volumeDecisionLogRef.current.get(appUserId) !== decision) {
        volumeDecisionLogRef.current.set(appUserId, decision);
        const attachedAt = remoteAudioAttachedAtRef.current.get(appUserId);
        vcLog.info("Remote volume decision", {
          appUserId,
          rosterSelfMute: member?.self_mute ?? null,
          rosterSelfDeaf: member?.self_deaf ?? null,
          connectionState: member?.connection_state ?? null,
          localDeafened: isDeafened,
          peerMuted: !!settings.muted,
          volume: finalVolume,
          msSinceTrackAttach: attachedAt ? Date.now() - attachedAt : null,
        });
      }
      const streamVolume =
        isDeafened || settings.muted
          ? 0
          : (settings.streamVolume ?? settings.volume) / 100;

      sfuRef.current?.setParticipantVolume(uuid, finalVolume);

      // Re-apply screen-audio volume override — setParticipantVolume
      // sets ALL GainNodes (including screen-audio) to the same volume.
      // Screen-audio should only be audible when focused or alwaysHear.
      const { audible } = screenShareSubscription({
        watched: false,
        shareFocused: focusedId === `remote-screen-${appUserId}`,
        participantFocused:
          focusedId === `remote-screen-${appUserId}` ||
          focusedId === `remote-camera-${appUserId}`,
        alwaysHear: !!settings.alwaysHear,
      });
      sfuRef.current?.setTrackVolume(
        uuid,
        `screen-audio-${uuid}`,
        audible ? streamVolume : 0,
      );
    }
  }, [
    peerSettings,
    isDeafened,
    joined,
    focusedId,
    participantsVersion,
    channelId,
    voiceChannelStates,
  ]);

  useSpatialAudioSync({
    joined,
    spatialAudioEnabled,
    streamHighFidelity,
    spatialAudioState,
    dispatch: voiceDispatch,
    sendVoiceStateUpdate,
  });

  useEffect(() => {
    if (!channelId) return;
    const shared = voiceChannelSpatialAudioStates[channelId];
    if (shared && shared.updatedAt !== spatialAudioState.updatedAt) {
      voiceDispatch({
        type: "SET_SPATIAL_AUDIO_STATE",
        payload: normalizeSpatialState(shared),
      });
    }
  }, [channelId, voiceChannelSpatialAudioStates, spatialAudioState.updatedAt]);

  useEffect(() => {
    const resume = () => {
      const sfu = sfuRef.current;
      if (!sfu) return;
      void Promise.all([
        Promise.resolve(publishedAudioProcessorRef.current?.resume()),
        Promise.resolve(sfu.resumeAudioContext()),
      ]).then(() => {
        sfu.vad.resumeContext();
        // A suspended capture context silences the gated microphone, so it
        // keeps the prompt up just like a suspended playback context.
        const blocked =
          sfu.audio.isAudioSuspended() || isCaptureAudioContextSuspended();
        voiceDispatch({ type: "SET_AUDIO_BLOCKED", payload: !!blocked });
        if (!blocked) {
          window.removeEventListener("click", resume);
          window.removeEventListener("keydown", resume);
        }
      });
    };
    window.addEventListener("click", resume);
    window.addEventListener("keydown", resume);

    const sfu = sfuInstance;
    const unsubscribeAudioResumed = sfu?.on("audio-resumed", () =>
      voiceDispatch({ type: "SET_AUDIO_BLOCKED", payload: false }),
    );

    return () => {
      window.removeEventListener("click", resume);
      window.removeEventListener("keydown", resume);
      unsubscribeAudioResumed?.();
    };
  }, [sfuInstance]);

  useEffect(() => {
    if (!joined || !sfuRef.current) {
      voiceDispatch({ type: "SET_AUDIO_BLOCKED", payload: false });
      return;
    }

    const check = () => {
      if (
        sfuRef.current?.audio.isAudioSuspended() ||
        isCaptureAudioContextSuspended()
      ) {
        voiceDispatch({ type: "SET_AUDIO_BLOCKED", payload: true });
      }
    };

    const timer = setTimeout(check, 1000);
    return () => clearTimeout(timer);
  }, [joined]);

  useEffect(() => {
    if (!joined || !sfuRef.current) return;
    const sfu = sfuRef.current;

    const vcMembers = channelId ? (voiceChannelStates[channelId] ?? []) : [];
    const localAppUserId = user?.id;

    for (const [uuid, appUserId] of uuidToUserIdRef.current.entries()) {
      // Skip the local user — we never subscribe to our own tracks
      if (uuid === myIdRef.current || appUserId === localAppUserId) continue;

      const isWatched = !!watchedStreams[appUserId];
      const settings: any = currentSettingsRef.current.peerSettings[
        appUserId
      ] || { volume: 100, streamVolume: 100 };
      const alwaysHear = !!bandwidthPeerSettings[appUserId];
      const isScreenFocused = focusedId === `remote-screen-${appUserId}`;
      const isFocused =
        isScreenFocused || focusedId === `remote-camera-${appUserId}`;

      // Verify the user is still in the channel (voice channel or call/room)
      // For calls and rooms, we rely on SFU participants entirely rather than gateway presence
      const isStillInChannel =
        isCall ||
        mode === "room" ||
        vcMembers.some((m: any) => m.user_id === appUserId);
      if (!isStillInChannel) continue;

      // Screen-audio: keep transceiver ALWAYS active (recvonly). Audio is
      // ~20kbps — negligible bandwidth. Toggling the transceiver to inactive
      // and back deactivates the WebRTC media pipeline, causing the Web Audio
      // source to read silence even after reactivation. Instead, control
      // audibility purely through the GainNode volume.
      // packages/voice SCREEN_SHARE.md, "Watching".
      const subscription = screenShareSubscription({
        watched: isWatched,
        shareFocused: isScreenFocused,
        participantFocused: isFocused,
        alwaysHear,
      });
      const streamVolume =
        currentSettingsRef.current.isDeafened || settings.muted
          ? 0
          : (settings.streamVolume ?? settings.volume) / 100;
      sfu.setRemoteTrackSubscription(
        `screen-audio-${uuid}`,
        subscription.audio,
      );
      sfu.setTrackVolume(
        uuid,
        `screen-audio-${uuid}`,
        subscription.audible ? streamVolume : 0,
      );

      sfu.setRemoteTrackSubscription(
        `screen-video-${uuid}`,
        subscription.video,
      );
      // Always pulled; the simulcast layer follows the tile's rendered size.
      sfu.setRemoteTrackSubscription(`cam-video-${uuid}`, true);
    }
  }, [
    watchedStreams,
    bandwidthPeerSettings,
    focusedId,
    voiceChannelStates,
    channelId,
    joined,
    isCall,
    mode,
    participantsVersion,
    user?.id,
  ]);

  const handleJoin = useCallback(async () => {
    markVoice("join-click", { channelId, serverId, mode });
    // One session at a time; checked before claiming, since a claim takes
    // the standby out of the pool.
    if (voiceSession.isLive) {
      vcLog.warn(
        "Already connecting or connected, skipping duplicate handleJoin",
      );
      return;
    }
    const claimedStandby =
      mode === "channel" && channelId && serverId
        ? claimVoiceStandby(channelId, serverId, isMicOnRef.current)
        : null;
    if (claimedStandby) markVoice("standby-claimed", { channelId });
    const adoptingStandby = claimedStandby !== null || voiceSession.isStandby;
    prewarmAudioContext();
    if (!adoptingStandby && mode === "channel" && channelId && serverId) {
      markVoiceChannelJoining(channelId, serverId);
    }
    standbyMediaOwnerRef.current = claimedStandby?.mediaOwner ?? null;
    cancelAutomaticSoundboardCleanup(automaticSoundboardSessionId);
    resetAutomaticSoundboardSession(automaticSoundboardSessionId);
    vcLog.info("handleJoin invoked", {
      channelId,
      serverId,
      mode,
      hasUser: !!user,
      voiceGateway: (
        sfuRef.current as SFUClient | null
      )?.voiceGW?.getDebugState?.(),
      roomGateway: (
        sfuRef.current as SFUClient | null
      )?.roomGW?.getDebugState?.(),
    });

    const displayName = chatUserDisplayName?.trim() || null;
    const username = chatUsername || user?.username || user?.name || "Guest";
    const name =
      mode === "room" ? guestName || "Guest" : displayName || username;
    const roomSlug = resolvedRoomSlug;
    const sfu =
      claimedStandby?.sfu ??
      (adoptingStandby ? voiceSession.client! : new SFUClient(roomSlug));
    if (claimedStandby?.silence) {
      standbySilenceRef.current = claimedStandby.silence;
    }
    // Not live (checked above), so the session takes it.
    const lease = voiceSession.start(sfu);
    if (!lease) return;
    setSfuInstance(sfu);

    const resolveSpeakingUserId = (participantId: string): string => {
      const isLocal =
        participantId === myIdRef.current ||
        participantId === sfu.getParticipantId();
      if (isLocal && user?.id && mode !== "room") return user.id;
      return uuidToUserIdRef.current.get(participantId) || participantId;
    };

    const rememberParticipant = (participant: VoiceState) => {
      participantsRef.current.set(participant.id, participant);
      const participantUserId =
        mode === "room" ? participant.id : participant.user_id;
      if (participantUserId) {
        uuidToUserIdRef.current.set(participant.id, participantUserId);
        sfu.setUserMapping(participant.id, participantUserId);

        if (participant.id !== participantUserId) {
          voiceDispatch({
            type: "SET_SPEAKING",
            payload: (previous: Record<string, boolean>) => {
              if (!(participant.id in previous)) return previous;
              const next = { ...previous };
              const wasSpeaking = next[participant.id];
              delete next[participant.id];
              if (wasSpeaking) next[participantUserId] = true;
              return next;
            },
          });
          voiceDispatch({
            type: "UPDATE_REMOTE_STREAMS",
            payload: (previous: RemoteStreamsByUser) => {
              const aliased = previous[participant.id];
              if (!aliased) return previous;
              const next = { ...previous };
              next[participantUserId] = {
                ...aliased,
                ...(next[participantUserId] ?? {}),
              };
              delete next[participant.id];
              return next;
            },
          });
          if (remoteAggregatorsRef.current[participant.id]) {
            remoteAggregatorsRef.current[participantUserId] =
              remoteAggregatorsRef.current[participant.id];
            delete remoteAggregatorsRef.current[participant.id];
          }
        }
      }
    };

    const upsertParticipant = (participant: VoiceState) => {
      rememberParticipant(participant);
      voiceDispatch({ type: "BUMP_PARTICIPANTS" });
    };

    const syncParticipants = (participants: VoiceState[]) => {
      const nextIds = new Set(participants.map((p) => p.id));
      for (const [participantId] of participantsRef.current) {
        if (!nextIds.has(participantId)) {
          const appUserId =
            uuidToUserIdRef.current.get(participantId) || participantId;
          const hasOtherUserIdentity = Array.from(
            uuidToUserIdRef.current.entries(),
          ).some(
            ([otherId, otherUserId]) =>
              otherId !== participantId && otherUserId === appUserId,
          );
          participantsRef.current.delete(participantId);
          uuidToUserIdRef.current.delete(participantId);
          delete speakingByParticipantRef.current[participantId];
          sfu.deleteUserMapping(participantId);
          const hasOtherUserSpeaking = Array.from(
            uuidToUserIdRef.current.entries(),
          ).some(
            ([otherId, otherUserId]) =>
              otherUserId === appUserId &&
              speakingByParticipantRef.current[otherId],
          );
          voiceDispatch({
            type: "SET_SPEAKING",
            payload: (previous: Record<string, boolean>) => {
              const next = { ...previous };
              delete next[participantId];
              if (!hasOtherUserSpeaking) delete next[appUserId];
              return next;
            },
          });
          voiceDispatch({
            type: "UPDATE_REMOTE_STREAMS",
            payload: (previous: RemoteStreamsByUser) => {
              if (!(participantId in previous) && !(appUserId in previous)) {
                return previous;
              }
              const next = { ...previous };
              delete next[participantId];
              if (!hasOtherUserIdentity) {
                delete next[appUserId];
              } else if (next[appUserId]) {
                next[appUserId] = Object.fromEntries(
                  Object.entries(next[appUserId]).filter(
                    ([trackName]) => !trackName.endsWith(participantId),
                  ),
                );
              }
              delete remoteAggregatorsRef.current[participantId];
              if (!hasOtherUserIdentity) {
                delete remoteAggregatorsRef.current[appUserId];
              }
              return next;
            },
          });
        }
      }
      participants.forEach(rememberParticipant);
      voiceDispatch({ type: "BUMP_PARTICIPANTS" });
    };

    // ── Eager mic acquisition (fire-and-forget, parallel with WS handshake) ──
    // LocalMediaManager.startEarlyMic() stores the in-flight promise so
    // acquireLocalStream() in swapDevices awaits it instead of a second call.
    const currentSettings = useVoiceSettingsStore
      .getState()
      .getSettings(settingsUserId);
    const captureProcessing = resolveCaptureAudioProcessing({
      noiseSuppression: currentSettings.noiseSuppression,
      echoCancellation: currentSettings.echoCancellation,
      autoSensitivity: currentSettings.autoSensitivity,
      streamHighFidelity: currentSettings.streamHighFidelity,
      noiseReductionEnabled:
        currentSettings.noiseReductionEnabled &&
        isNoiseReductionProviderSupported(
          currentSettings.noiseReductionProvider,
        ),
      noiseReductionProvider: currentSettings.noiseReductionProvider,
    });
    // A claimed standby never opened the microphone (it only published
    // silence); capture starts here, concurrently with promotion, on the
    // standby's media owner so the device sync below reuses this request.
    const earlyMic = startEarlyMic(
      {
        deviceId: currentSettings.inputDeviceId,
        deviceLabel: currentSettings.inputDeviceLabel,
        groupId: currentSettings.inputDeviceGroupId,
        noiseSuppression: captureProcessing.noiseSuppression,
        echoCancellation: captureProcessing.echoCancellation,
        autoGainControl: captureProcessing.autoGainControl,
        stereo: true,
      },
      claimedStandby?.mediaOwner ?? localMediaOwner,
    );
    // Build the gated processor from that capture as soon as it lands, in
    // parallel with the gateway connect, so the first publication (which
    // never goes out ungated) rarely waits for it.
    discardEarlyAudioProcessor(earlyAudioProcessorRef);
    const earlySettings = audioProcessingSettingsRef.current;
    if (
      earlyMic &&
      resolveLocalAudioPublicationMode(earlySettings) !== "direct"
    ) {
      const early: EarlyAudioProcessor = {
        trackId: null,
        settingsKey: JSON.stringify(earlySettings),
        promise: Promise.resolve(null),
      };
      early.promise = Promise.resolve(earlyMic)
        .then((stream) => {
          const track = stream?.getAudioTracks()[0];
          if (!stream || !track || earlyAudioProcessorRef.current !== early) {
            return null;
          }
          early.trackId = track.id;
          markVoice("audio-processor-early");
          return createLocalAudioProcessor(stream, earlySettings);
        })
        .catch(() => null);
      earlyAudioProcessorRef.current = early;
    }

    // Removed by the session's teardown (step 2), whichever way it ends.
    const onSfu = <K extends keyof SFUEventMap>(
      event: K,
      handler: (data: SFUEventMap[K]) => void,
    ) => {
      lease.addCleanup(sfu.on(event, handler));
    };

    onSfu(
      "joined",
      ({
        participantId,
        participants,
        spatialAudioState: initialSpatialAudioState,
      }: any) => {
        const join = lease.active ? voiceSession.markJoined() : null;
        if (!join) return;
        const wasAlreadyJoined = join.wasJoined;

        vcLog.info("SFU joined", {
          channelId,
          serverId,
          mode,
          participantId,
          participants: participants.length,
        });
        myIdRef.current = participantId;
        if (user?.id && mode !== "room") {
          uuidToUserIdRef.current.set(participantId, user.id);
          sfu.setUserMapping(participantId, user.id);
          voiceDispatch({
            type: "SET_SPEAKING",
            payload: (previous: Record<string, boolean>) => {
              const wasSpeaking = Boolean(
                previous[participantId] || previous[user.id],
              );
              if (!wasSpeaking && !(participantId in previous)) return previous;
              const next = { ...previous };
              delete next[participantId];
              if (wasSpeaking) next[user.id] = true;
              else delete next[user.id];
              return next;
            },
          });
        }

        syncParticipants(participants);
        if (initialSpatialAudioState) {
          voiceDispatch({
            type: "SET_SPATIAL_AUDIO_STATE",
            payload: normalizeSpatialState(initialSpatialAudioState),
          });
        }

        // Bumping participants immediately correctly sets initial call participants
        voiceDispatch({ type: "JOINED" });
        markVoice("ui-joined", { channelId, participantId });
        onJoined?.();

        // Play connected sound (skip for calls — gateway plays CALL_CONNECT instead)
        if (!wasAlreadyJoined && !isCall) playConnected();
        void playAutomaticSoundboardTrigger(
          "join",
          automaticSoundboardSessionId,
          serverId,
          createAutomaticSoundboardTransport(sfu),
        );

        if (mode !== "room" && channelId) {
          sendVoiceChannelJoin(
            channelId,
            currentSettingsRef.current.isMuted,
            currentVoiceChannelStartedAt,
          );
          // A move grant for this channel has done its job (both tickets
          // and this join); later reconnects must not offer it again.
          clearVoiceMoveGrant(channelId);
        }
      },
    );

    onSfu("participant-joined", ({ participant }) => {
      upsertParticipant(participant);

      if (mode === "room" && !areReconnectSoundsSuppressed()) {
        playVoiceJoin();
      }
    });

    onSfu(
      "voice-state-update",
      ({
        participant,
        spatialAudioState: nextSpatialAudioState,
      }: {
        participant: VoiceState | VoiceStateDelta;
        spatialAudioState?: SharedSpatialAudioState;
      }) => {
        const mergedParticipant = mergeVoiceState(
          participantsRef.current.get(participant.id),
          participant,
        );
        if (!mergedParticipant) return;
        upsertParticipant(mergedParticipant);
        if (nextSpatialAudioState) {
          voiceDispatch({
            type: "SET_SPATIAL_AUDIO_STATE",
            payload: normalizeSpatialState(nextSpatialAudioState),
          });
        }
      },
    );

    onSfu(
      "participants-sync",
      ({ participants, spatialAudioState: nextSpatialAudioState }: any) => {
        voiceSession.connectionRestored();
        syncParticipants(participants);
        if (nextSpatialAudioState) {
          voiceDispatch({
            type: "SET_SPATIAL_AUDIO_STATE",
            payload: normalizeSpatialState(nextSpatialAudioState),
          });
        }
      },
    );

    onSfu("audio-stalled", (isStalled: boolean) => {
      voiceDispatch({ type: "SET_AUDIO_STALLED", payload: isStalled });
    });

    onSfu("outbound-audio-stalled", (isStalled: boolean) => {
      if (!isStalled || !isMicOnRef.current) return;

      const sfu = sfuRef.current;
      // A capture sync in flight (a device swap) is about to replace the
      // microphone: recovering the old one now would move its publication
      // generation and make the swap drop the device the user picked. The
      // sentinel watches the new microphone afresh once it is published.
      if (sfu && isCaptureInFlight(sfu)) {
        vcLog.info("Outbound audio stalled during a capture; not recovering");
        sfu.outboundAudioSentinel?.resetMonitoring();
        return;
      }
      const publication = existingPublication(sfu);
      const recoveryStream = localStreamRef.current;
      const rawAudioTrack = recoveryStream?.getAudioTracks()[0];
      if (
        !sfu ||
        !publication ||
        !rawAudioTrack ||
        rawAudioTrack.readyState === "ended"
      ) {
        vcLog.warn(
          "Outbound audio stalled but no live raw microphone track is available",
        );
        return;
      }

      rawAudioTrack.enabled = true;
      vcLog.warn(
        "Replacing stalled processed microphone track with gated identity audio",
        {
          processorMode:
            publishedAudioProcessorRef.current?.mode ?? "passthrough",
        },
      );
      void (async () => {
        let recoveryProcessor: LocalAudioProcessorHandle | null = null;
        try {
          recoveryProcessor = await createLocalAudioProcessor(
            new MediaStream([rawAudioTrack]),
            {
              ...audioProcessingSettingsRef.current,
              noiseReductionEnabled: false,
              streamHighFidelity: false,
            },
          );
          const recoveryTrack =
            recoveryProcessor?.publicationStream.getAudioTracks()[0];
          if (!recoveryProcessor || !recoveryTrack) {
            recoveryProcessor?.destroy();
            sfu.outboundAudioSentinel?.resetMonitoring();
            vcLog.warn(
              "Failed to recover stalled outbound microphone audio; gated identity graph unavailable",
            );
            return;
          }
          // A capture sync committed another microphone meanwhile, or one
          // started and will (see above).
          if (
            sfuRef.current !== sfu ||
            localStreamRef.current !== recoveryStream ||
            isCaptureInFlight(sfu)
          ) {
            recoveryProcessor.destroy();
            sfu.outboundAudioSentinel?.resetMonitoring();
            return;
          }

          // Through the reconciler, like every publication change: a mute
          // meanwhile does not cancel it, a capture sync or a teardown does.
          publication.setTrack("microphone", recoveryTrack);
          const generation = publication.generation;
          const result = await publication.reconcile();
          const current =
            result.status !== "disposed" &&
            !failedOn(result, "microphone") &&
            publication.isCurrent(generation, "microphone") &&
            sfuRef.current === sfu &&
            localStreamRef.current === recoveryStream;
          if (!current) {
            if (publication.isCurrent(generation, "microphone")) {
              // Still ours but not published: back to the committed track.
              publication.setTrack(
                "microphone",
                committedPublicationTrack("microphone"),
              );
              void publication.reconcile();
            }
            recoveryProcessor.destroy();
            if (failedOn(result, "microphone")) {
              sfu.outboundAudioSentinel?.resetMonitoring();
              vcLog.warn(
                "Failed to recover stalled outbound microphone audio",
                result.error,
              );
            }
            return;
          }

          const previousProcessor = publishedAudioProcessorRef.current;
          publishedAudioProcessorRef.current = recoveryProcessor;
          recoveryProcessor = null;
          failedAudioProcessingModeRef.current =
            resolveLocalAudioProcessingMode(audioProcessingSettingsRef.current);
          sfu.vad.setGateController(
            publishedAudioProcessorRef.current.gateController,
          );
          if (previousProcessor !== publishedAudioProcessorRef.current) {
            previousProcessor?.destroy();
          }
          restartVadMonitoring(sfu);
        } catch (error) {
          recoveryProcessor?.destroy();
          sfu.outboundAudioSentinel?.resetMonitoring();
          vcLog.warn(
            "Failed to recover stalled outbound microphone audio",
            error,
          );
        }
      })();
    });

    onSfu("app-event", (event) => {
      if (!isStreamWatcherSnapshotPayload(event)) return;

      const previousWatcherIds = streamWatcherIdsRef.current;
      const nextWatcherIds = applyStreamWatcherSnapshot(
        previousWatcherIds,
        event,
      );
      const localWatcherUserId =
        mode === "room" ? myIdRef.current || null : user?.id || null;
      const optimisticResolution = resolveWatchedStreamsWithPendingIntents(
        nextWatcherIds,
        localWatcherUserId,
        pendingWatchIntentsRef.current,
      );

      streamWatcherIdsRef.current = nextWatcherIds;
      watchedStreamsRef.current = optimisticResolution.watchedStreams;
      pendingWatchIntentsRef.current = optimisticResolution.pendingIntents;
      voiceDispatch({
        type: "SET_STREAM_WATCHER_IDS",
        payload: nextWatcherIds,
      });
      voiceDispatch({
        type: "SET_WATCHED",
        payload: optimisticResolution.watchedStreams,
      });

      const isInitialSnapshot =
        !hasReceivedInitialStreamWatcherSnapshotRef.current;
      hasReceivedInitialStreamWatcherSnapshotRef.current = true;
      if (isInitialSnapshot) return;

      const activitySound = getStreamWatcherActivitySound(
        previousWatcherIds,
        nextWatcherIds,
        localWatcherUserId,
      );
      if (activitySound && !areReconnectSoundsSuppressed()) {
        const options = { userId: settingsUserId };
        if (activitySound === "start") playStreamWatcherStart(options);
        else playStreamWatcherStop(options);
      }
    });

    onSfu(
      "profile-update",
      ({
        participantId,
        name: newName,
        username,
        displayName,
        avatarUrl,
        avatarDisplay,
      }) => {
        const p = participantsRef.current.get(participantId);
        const profileUserId =
          p?.user_id ?? uuidToUserIdRef.current.get(participantId);
        if (p) {
          const updated = {
            ...p,
            name: newName,
            ...(username !== undefined ? { username } : {}),
            ...(displayName !== undefined ? { display_name: displayName } : {}),
            ...(avatarUrl !== undefined ? { avatar_url: avatarUrl } : {}),
            ...(avatarDisplay !== undefined
              ? { avatar_display: avatarDisplay }
              : {}),
          };
          participantsRef.current.set(participantId, updated);
          voiceDispatch({ type: "BUMP_PARTICIPANTS" });
        }
        if (profileUserId) {
          dispatch({
            type: "UPDATE_MEMBER_PROFILE",
            userId: profileUserId,
            name: newName,
            ...(username !== undefined ? { username } : {}),
            ...(displayName !== undefined ? { display_name: displayName } : {}),
            ...(avatarUrl !== undefined ? { avatar_url: avatarUrl } : {}),
            ...(avatarDisplay !== undefined
              ? { avatar_display: avatarDisplay }
              : {}),
          });
        }
      },
    );

    onSfu("participant-left", ({ participantId }) => {
      const appUserId =
        uuidToUserIdRef.current.get(participantId) || participantId;
      const hasOtherUserIdentity = Array.from(
        uuidToUserIdRef.current.entries(),
      ).some(
        ([otherId, otherUserId]) =>
          otherId !== participantId && otherUserId === appUserId,
      );
      if (!hasOtherUserIdentity) {
        stopAutomaticJoinSoundboardPlaybacksByOwner(
          appUserId,
          getSoundboardServerKey(isCall ? "dm-call" : serverId),
        );
      }
      participantsRef.current.delete(participantId);
      uuidToUserIdRef.current.delete(participantId);
      delete speakingByParticipantRef.current[participantId];
      sfu.deleteUserMapping(participantId);
      const hasOtherUserSpeaking = Array.from(
        uuidToUserIdRef.current.entries(),
      ).some(
        ([otherId, otherUserId]) =>
          otherUserId === appUserId &&
          speakingByParticipantRef.current[otherId],
      );
      voiceDispatch({
        type: "UPDATE_REMOTE_STREAMS",
        payload: (prev: RemoteStreamsByUser) => {
          const next = { ...prev };
          delete next[participantId];
          delete remoteAggregatorsRef.current[participantId];
          if (!hasOtherUserIdentity) {
            delete next[appUserId];
            delete remoteAggregatorsRef.current[appUserId];
          } else if (next[appUserId]) {
            next[appUserId] = Object.fromEntries(
              Object.entries(next[appUserId]).filter(
                ([trackName]) => !trackName.endsWith(participantId),
              ),
            );
          }
          return next;
        },
      });
      voiceDispatch({
        type: "SET_SPEAKING",
        payload: (prev: Record<string, boolean>) => {
          const next = { ...prev };
          delete next[participantId];
          if (!hasOtherUserSpeaking) delete next[appUserId];
          return next;
        },
      });
      voiceDispatch({ type: "BUMP_PARTICIPANTS" });
    });

    onSfu("remote-track", ({ participantId, track, trackInfo, action }) => {
      // Use the user id if mapped, otherwise fall back to the raw participant UUID.
      // For calls, both users join simultaneously so the mapping may not be
      // populated before the first remote-track fires.
      const appUserId =
        uuidToUserIdRef.current.get(participantId) || participantId;

      const cleanupRemoteScreenThumbnail = () => {
        capturingThumbnails.current.delete(appUserId);
        const capture = thumbnailCaptureRefs.current[appUserId];
        if (capture) {
          if (capture.timeoutId !== null) {
            window.clearTimeout(capture.timeoutId);
          }
          capture.video.pause();
          capture.video.srcObject = null;
          delete thumbnailCaptureRefs.current[appUserId];
        }
        voiceDispatch({
          type: "SET_THUMBNAILS",
          payload: (prev: Record<string, string>) => {
            if (!(appUserId in prev)) return prev;
            const next = { ...prev };
            delete next[appUserId];
            return next;
          },
        });
      };

      if (action === "remove") {
        sfu.removeTrackVolume(participantId, trackInfo.track_name);
        voiceDispatch({
          type: "UPDATE_REMOTE_STREAMS",
          payload: (prev: RemoteStreamsByUser) =>
            removeRemoteTrackStream(prev, appUserId, trackInfo.track_name),
        });

        if (trackInfo.track_name.startsWith("screen-video-")) {
          cleanupRemoteScreenThumbnail();
        }

        voiceDispatch({ type: "BUMP_PARTICIPANTS" });
        return;
      }

      voiceDispatch({
        type: "UPDATE_REMOTE_STREAMS",
        payload: (prev: RemoteStreamsByUser) => {
          const nextStream = new MediaStream();
          if (track.kind === "audio") {
            const processedStream = sfu.attachRemoteAudioTrack(
              participantId,
              track,
              trackInfo.track_name,
            );

            // Screen-audio starts muted — it only becomes audible when the
            // stream is focused (clicked to expand) or alwaysHear is set.
            // The subscription effect syncs this on focus/setting changes.
            const isScreenAudio =
              trackInfo.track_name.startsWith("screen-audio-");
            if (isScreenAudio) {
              const peerSetting = currentSettingsRef.current.peerSettings[
                appUserId
              ] as any;
              const alwaysHearPeer = !!peerSetting?.alwaysHear;
              const currentFocused = focusedIdRef.current;
              const isFocusedNow =
                currentFocused === `remote-screen-${appUserId}` ||
                currentFocused === `remote-camera-${appUserId}`;
              const streamVolume =
                currentSettingsRef.current.isDeafened || peerSetting?.muted
                  ? 0
                  : (peerSetting?.streamVolume ?? peerSetting?.volume ?? 100) /
                    100;
              sfu.setTrackVolume(
                participantId,
                trackInfo.track_name,
                isFocusedNow || alwaysHearPeer ? streamVolume : 0,
              );
            } else {
              const peerSetting =
                currentSettingsRef.current.peerSettings[appUserId];
              const member = voiceChannelMembersRef.current.find(
                (entry) => entry.user_id === appUserId,
              );
              const finalVolume =
                currentSettingsRef.current.isDeafened ||
                (peerSetting as any)?.muted
                  ? 0
                  : ((peerSetting as any)?.volume ?? 100) / 100;
              const attachedAt =
                remoteAudioAttachedAtRef.current.get(appUserId) ?? Date.now();
              remoteAudioAttachedAtRef.current.set(appUserId, attachedAt);
              vcLog.info("Remote audio volume applied", {
                appUserId,
                trackName: trackInfo.track_name,
                rosterSelfMute: member?.self_mute ?? null,
                rosterSelfDeaf: member?.self_deaf ?? null,
                connectionState: member?.connection_state ?? null,
                connected: member?.connected ?? null,
                volume: finalVolume,
                msSinceTrackAttach: Date.now() - attachedAt,
              });
              sfu.setParticipantVolume(participantId, finalVolume);
            }
            const processedTrack = processedStream.getAudioTracks()[0];
            nextStream.addTrack(processedTrack || track);
          } else {
            nextStream.addTrack(track);
          }
          return upsertRemoteTrackStream(
            prev,
            appUserId,
            trackInfo.track_name,
            nextStream,
          );
        },
      });

      // Ensure AudioContext is running — for calls the SFU is created via
      // autoJoin (outside a user gesture) so the context may be suspended.
      if (track.kind === "audio") {
        vcLog.info("Remote audio track attached to voice channel", {
          participantId,
          trackName: trackInfo.track_name,
          attachedAt: Date.now(),
        });
        sfu.resumeAudioContext();
      }

      // Capture periodic thumbnails for screen share video tracks.
      // Reuse one hidden video/canvas pair per peer; repeatedly creating media
      // elements here can contend with active decoders during long calls.
      if (
        track.kind === "video" &&
        trackInfo.track_name.startsWith("screen-video-") &&
        !capturingThumbnails.current.has(appUserId)
      ) {
        capturingThumbnails.current.add(appUserId);
        const cleanupThumb = () => {
          capturingThumbnails.current.delete(appUserId);
          const capture = thumbnailCaptureRefs.current[appUserId];
          if (!capture) return;
          if (capture.timeoutId !== null) {
            window.clearTimeout(capture.timeoutId);
          }
          capture.video.pause();
          capture.video.srcObject = null;
          delete thumbnailCaptureRefs.current[appUserId];
        };
        const captureThumb = () => {
          if (track.readyState !== "live") {
            cleanupThumb();
            return;
          }
          try {
            let capture = thumbnailCaptureRefs.current[appUserId];
            if (!capture) {
              capture = {
                canvas: document.createElement("canvas"),
                video: document.createElement("video"),
                timeoutId: null,
              };
              capture.video.muted = true;
              capture.video.playsInline = true;
              capture.video.srcObject = new MediaStream([track]);
              thumbnailCaptureRefs.current[appUserId] = capture;
            }
            const { canvas, video } = capture;
            if (track.muted) {
              capture.timeoutId = window.setTimeout(captureThumb, 5000);
              return;
            }
            video.muted = true;
            video
              .play()
              .then(() => {
                canvas.width = Math.min(video.videoWidth, 320);
                canvas.height =
                  Math.round(
                    canvas.width * (video.videoHeight / video.videoWidth),
                  ) || 180;
                const ctx = canvas.getContext("2d");
                if (ctx) {
                  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                  const dataUrl = canvas.toDataURL("image/jpeg", 0.5);
                  voiceDispatch({
                    type: "SET_THUMBNAILS",
                    payload: (prev: Record<string, string>) => ({
                      ...prev,
                      [appUserId]: dataUrl,
                    }),
                  });
                }
              })
              .catch(() => {});
          } catch {
            /* ignore */
          }
          // Recapture every 5 seconds
          const capture = thumbnailCaptureRefs.current[appUserId];
          if (!capture) return;
          capture.timeoutId = window.setTimeout(() => {
            if (track.readyState === "live") captureThumb();
            else cleanupThumb();
          }, 5000);
        };
        // Initial capture after brief delay for first frame
        setTimeout(captureThumb, 1000);
      }
    });

    onSfu("speaking", ({ participantId, speaking }) => {
      const appUserId = resolveSpeakingUserId(participantId);
      speakingByParticipantRef.current[participantId] = speaking > 0;
      const hasMappedSpeakingParticipant = Array.from(
        uuidToUserIdRef.current.entries(),
      ).some(
        ([mappedId, mappedUserId]) =>
          mappedUserId === appUserId &&
          speakingByParticipantRef.current[mappedId],
      );
      const nextSpeaking =
        hasMappedSpeakingParticipant ||
        (!uuidToUserIdRef.current.has(participantId) && speaking > 0);
      voiceDispatch({
        type: "SET_SPEAKING",
        payload: (prev: Record<string, boolean>) => {
          const next = { ...prev };
          delete next[participantId];
          if (nextSpeaking) next[appUserId] = true;
          else delete next[appUserId];
          return next;
        },
      });
    });

    onSfu("voice-ready", ({ speaking }) => {
      voiceSession.connectionRestored();
      const nextSpeakingUsers: Record<string, boolean> = {};
      const speakingParticipantIds = new Set(Object.keys(speaking ?? {}));
      for (const [participantId] of uuidToUserIdRef.current.entries()) {
        if (participantId !== myIdRef.current) {
          speakingByParticipantRef.current[participantId] =
            speakingParticipantIds.has(participantId);
        }
      }
      for (const [participantId, flags] of Object.entries(speaking ?? {})) {
        if (flags <= 0) continue;
        speakingByParticipantRef.current[participantId] = true;
        const appUserId = resolveSpeakingUserId(participantId);
        nextSpeakingUsers[appUserId] = true;
      }
      const localParticipantId = myIdRef.current || sfu.getParticipantId();
      const localUserId = localParticipantId
        ? resolveSpeakingUserId(localParticipantId)
        : user?.id && mode !== "room"
          ? user.id
          : null;
      voiceDispatch({
        type: "SET_SPEAKING",
        payload: (previous: Record<string, boolean>) => {
          const localWasSpeaking = Boolean(
            (localUserId && previous[localUserId]) ||
            (localParticipantId && previous[localParticipantId]),
          );
          if (localUserId && localWasSpeaking) {
            const next = { ...nextSpeakingUsers, [localUserId]: true };
            if (localParticipantId && localParticipantId !== localUserId) {
              delete next[localParticipantId];
            }
            return next;
          }
          return nextSpeakingUsers;
        },
      });
    });

    onSfu("vad-speaking", ({ participantId, isSpeaking }) => {
      const appUserId = resolveSpeakingUserId(participantId);
      speakingByParticipantRef.current[participantId] = isSpeaking;
      const hasMappedSpeakingParticipant = Array.from(
        uuidToUserIdRef.current.entries(),
      ).some(
        ([mappedId, mappedUserId]) =>
          mappedUserId === appUserId &&
          speakingByParticipantRef.current[mappedId],
      );
      const nextSpeaking =
        hasMappedSpeakingParticipant ||
        (!uuidToUserIdRef.current.has(participantId) && isSpeaking);
      voiceDispatch({
        type: "SET_SPEAKING",
        payload: (prev: Record<string, boolean>) => {
          const next = { ...prev };
          delete next[participantId];
          if (nextSpeaking) next[appUserId] = true;
          else delete next[appUserId];
          return next;
        },
      });
    });

    onSfu("connection-state", ({ state }) => {
      voiceDispatch({ type: "SET_CONNECTION", payload: state });
      if (state === "connected") voiceSession.connectionRestored();
      else if (state === "disconnected" || state === "failed") {
        voiceSession.connectionLost();
      }
    });
    // The room socket closed on its own (it reconnects); Resumed brings it
    // back as participants-sync, a new Ready as joined.
    onSfu("disconnected", () => voiceSession.connectionLost());

    // The native share could not come back after the voice reconnect.
    onSfu("native-screen-share-ended", (payload) => {
      nativeShareEndedRef.current(payload, sfu, "reconnect");
    });

    onSfu("voice-reconnected", () => {
      void (async () => {
        vcLog.info("Voice reconnected — re-publishing local tracks");
        // The media session has no publications: everything wanted is
        // published afresh, including a capture sync's track still on its
        // way (it commits its own processor when its publish converges) and
        // a browser screen share (a native one reconnects on its own).
        const publication = existingPublication(sfu);
        if (publication) {
          // The republish applies the mute as it is now.
          publication.setEnabled("microphone", isMicOnRef.current);
          publication.connectionReset();
          const result = await publication.reconcile();
          if (sfuRef.current !== sfu) return;
          if (result.status === "failed") {
            vcLog.warn("Voice reconnect publication failed", result.error);
          }
          if (localStreamRef.current) {
            sfu.vad.setGateController(
              publishedAudioProcessorRef.current?.gateController ?? null,
            );
            restartVadMonitoring(sfu);
          }
        }
      })().catch((error) => {
        vcLog.warn("Voice reconnect publication failed", error);
      });
    });

    onSfu("voice-token-expired", () => {
      vcLog.warn("Voice token expired, requesting fresh authentication...");
      sfu.refreshVoiceCredentials();
    });

    onSfu("kicked", () => {
      // One voice session per user: a newer join on another device ended
      // this one. Leave for good (no reassert, no rejoin) and say why.
      vcLog.warn("Voice moved to another device", { channelId, mode });
      toast.info("You joined this call on another device", {
        description: "Voice is connected there now.",
      });
      window.dispatchEvent(new CustomEvent("force-voice-disconnect"));
    });

    // The call sockets give up for good on these (tickets refused twice, or
    // admission rejected): end this session as a forced disconnect would.
    const endLostSession = (reason: "auth-failed" | "admission-rejected") => {
      if (sfuRef.current !== sfu) return;
      vcLog.warn("Voice session lost", { reason, channelId, mode });
      toast.info("Voice disconnected", {
        description: "Your voice session ended. Join again to reconnect.",
      });
      forceDisconnectRef.current?.();
    };
    onSfu("auth-failed", () => endLostSession("auth-failed"));
    onSfu("admission-rejected", () => endLostSession("admission-rejected"));
    onSfu("error", ({ message }) => {
      // Recoverable: the sockets retry, and fatal closes arrive above.
      vcLog.warn("SFU error", { message, channelId, mode });
    });
    onSfu("voice-move", (move) => {
      // A moderator moved this session; the server has already ended it
      // here. The chat page leaves and joins the target (the normal switch,
      // so mute and deafen carry over and screen share stops). If nothing
      // takes the move, leave for good as on a takeover.
      vcLog.info("Moved to another voice channel", {
        from: channelId,
        to: move.channelId,
      });
      toast.call(
        `${move.moverName ?? "A moderator"} moved you to ${move.channelName ?? "another channel"}`,
      );
      const detail: VoiceMoveDetail = {
        serverId: move.serverId,
        channelId: move.channelId,
      };
      const unclaimed = window.dispatchEvent(
        new CustomEvent(VOICE_MOVE_EVENT, { detail, cancelable: true }),
      );
      if (unclaimed) {
        window.dispatchEvent(new CustomEvent("force-voice-disconnect"));
      }
    });

    if (adoptingStandby) {
      sfu.replayJoinedSnapshot();
      sfu.promoteStandby({
        selfMute: currentSettingsRef.current.isMuted,
        selfDeaf: currentSettingsRef.current.isDeafened,
      });
    } else {
      vcLog.info("Connecting SFU", {
        channelId,
        serverId,
        mode,
        roomSlug,
        hasUser: !!user,
      });
      sfu.connect(
        name,
        chatUserAvatarUrl || user?.image || undefined,
        user?.id,
        mode === "room" ? undefined : username,
        mode === "room" ? null : displayName,
        mode === "room" ? null : chatUserAvatarDisplay,
        {
          channelId: channelId ?? undefined,
          serverId: serverId ?? undefined,
        },
      );
    }
    sfu.resumeAudioContext();
    if (!claimedStandby) {
      localStreamRef.current = new MediaStream();
    }
  }, [
    automaticSoundboardSessionId,
    createAutomaticSoundboardTransport,
    user,
    serverId,
    channelId,
    sendVoiceChannelJoin,
    onJoined,
    resolvedRoomSlug,
    isCall,
    mode,
    guestName,
    settingsUserId,
    chatUserAvatarUrl,
    chatUserAvatarDisplay,
    chatUserDisplayName,
    chatUsername,
    dispatch,
    currentVoiceChannelStartedAt,
    localMediaOwner,
    restartVadMonitoring,
    existingPublication,
    committedPublicationTrack,
    isCaptureInFlight,
    voiceSession,
  ]);

  // No 30 s VoiceChannelJoin re-send: the sidebar roster is the voice
  // room's own (realtime/VOICE_ROSTER.md), which the room pushes to the
  // global gateway on every change. The one join above only names the
  // channel this session's chat-socket op 15 hints (preview, spatial) are for.

  // Reset the guard whenever autoJoin flips back to false (user navigated away),
  // so the next time they return to the voice channel it auto-joins again.
  const prevAutoJoinRef = useRef(autoJoin);
  useEffect(() => {
    if (!autoJoin && prevAutoJoinRef.current) {
      hasAutoJoined.current = false;
      autoJoinTargetRef.current = null;
    }
    prevAutoJoinRef.current = autoJoin;
  }, [autoJoin]);

  useEffect(() => {
    if (!autoJoin) return;

    const autoJoinTarget = `${mode}:${serverId ?? ""}:${roomSlugOverride ?? ""}:${channelId ?? ""}`;
    if (autoJoinTargetRef.current !== autoJoinTarget) {
      autoJoinTargetRef.current = autoJoinTarget;
      hasAutoJoined.current = false;
    }
  }, [autoJoin, mode, serverId, roomSlugOverride, channelId]);

  useEffect(() => {
    if (
      autoJoin &&
      !hasAutoJoined.current &&
      !joined &&
      (mode === "room" || user) &&
      !sfuRef.current
    ) {
      hasAutoJoined.current = true;
      handleJoin();
    }
  }, [autoJoin, joined, mode, user, handleJoin]);

  const channelHasOtherMembers =
    mode === "channel" &&
    !autoJoin &&
    !joined &&
    !!user?.id &&
    !!channelId &&
    !!serverId &&
    (voiceChannelStates[channelId] ?? []).some(
      (member) => member.user_id !== user?.id && member.connected !== false,
    );
  const standbyProfileRef = useRef({
    avatarDisplay: chatUserAvatarDisplay,
    avatarUrl: chatUserAvatarUrl || user?.image || undefined,
    displayName: chatUserDisplayName?.trim() || null,
    username: chatUsername || user?.username || user?.name || "Guest",
  });
  standbyProfileRef.current = {
    avatarDisplay: chatUserAvatarDisplay,
    avatarUrl: chatUserAvatarUrl || user?.image || undefined,
    displayName: chatUserDisplayName?.trim() || null,
    username: chatUsername || user?.username || user?.name || "Guest",
  };

  const standbyActive = useVoiceStandbyActive();

  // While the "Join voice" landing is up, fetch the room and voice tickets
  // so the click starts at the WebSocket instead of at the ticket round trip,
  // and start the browser's WebRTC stack while the page is idle. An occupied
  // channel is covered by its warm standby instead, when one runs.
  const canPrefetchJoin =
    mode === "channel" &&
    !joined &&
    !autoJoin &&
    !!user?.id &&
    !!channelId &&
    !!serverId &&
    (!channelHasOtherMembers || !standbyActive || isVoiceStandbyDisabled());
  const prefetchJoin = useCallback(() => {
    if (!canPrefetchJoin || sfuRef.current || !channelId || !serverId) return;
    prewarmWebRtc();
    prefetchVoiceChannelJoin({
      channelId,
      roomSlug: resolvedRoomSlug,
      serverId,
    });
  }, [canPrefetchJoin, channelId, resolvedRoomSlug, serverId]);
  useEffect(() => {
    prefetchJoin();
  }, [prefetchJoin]);

  useEffect(() => {
    if (
      !standbyActive ||
      !channelHasOtherMembers ||
      sfuRef.current ||
      !channelId ||
      !serverId ||
      !user?.id
    ) {
      return;
    }
    const profile = standbyProfileRef.current;
    const held = holdVoiceStandby({
      channelId,
      serverId,
      roomSlug: resolvedRoomSlug,
      userId: user.id,
      name: profile.displayName || profile.username,
      username: profile.username,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
      avatarDisplay: profile.avatarDisplay,
    });
    const session = held.session;
    if (!session) return;
    // Idle or leaving (checked above), so the hold is taken.
    voiceSession.holdStandby(session.sfu);
    standbySilenceRef.current = session.silence;
    return () => {
      held.release();
      // Promoted by a join (or ended): no longer this hold's to drop.
      if (!voiceSession.releaseStandby(session.sfu)) return;
      if (standbySilenceRef.current === session.silence) {
        standbySilenceRef.current = null;
      }
    };
  }, [
    standbyActive,
    channelHasOtherMembers,
    channelId,
    resolvedRoomSlug,
    serverId,
    user?.id,
    voiceSession,
  ]);

  useEffect(() => {
    const session = sfuRef.current;
    if (!session || voiceSession.isStandby) {
      captureGenerationRef.current += 1;
      return;
    }
    const requestKey = JSON.stringify({
      audioProcessingSettings,
      cameraBackground: getCameraBackgroundEffectKey(
        cameraBackground,
        customCameraBackgrounds,
      ),
      cameraQuality,
      isCameraActive,
      microphone: microphoneIntent.saved,
      camera: cameraIntent.saved,
    });
    const hasActiveAudio =
      !!localStreamRef.current?.getAudioTracks().length ||
      !!publishedAudioProcessorRef.current;
    const isInitialMediaSync = !hasActiveAudio;
    const inFlight = captureRunRef.current;
    if (
      isInitialMediaSync &&
      inFlight &&
      !inFlight.done &&
      inFlight.initial &&
      inFlight.client === session &&
      inFlight.requestKey === requestKey &&
      inFlight.generation === captureGenerationRef.current
    ) {
      // The session's first capture is still on its way for these same
      // devices and settings: let it finish rather than start over.
      return;
    }
    if (inFlight && !inFlight.done) {
      cancelPendingLocalStreamAcquisition(localMediaOwner);
    }
    const generation = ++captureGenerationRef.current;
    const run = {
      generation,
      client: session,
      requestKey,
      initial: isInitialMediaSync,
      done: false,
    };
    captureRunRef.current = run;

    const isCurrent = () =>
      captureGenerationRef.current === generation && sfuRef.current === session;
    const { input: listedInputId, video: listedVideoId } =
      listedDeviceIdsRef.current;
    const microphoneSaved = microphoneIntent.saved;
    const cameraSaved = cameraIntent.saved;
    const swapDevices = async () => {
      const sfu = session;
      const publication = publicationFor(sfu);
      let nextAudioProcessor: LocalAudioProcessorHandle | null = null;
      let acquiredStream: MediaStream | null = null;
      let acquiredCameraEffect: CameraBackgroundEffect | null = null;
      // The publication intents this run set, so an abandoned run can hand
      // those slots back (see revertPublication).
      const ownIntents: Array<{
        slot: TrackSlot;
        generation: PublicationGeneration;
      }> = [];
      const wantPublished = async (
        slot: TrackSlot,
        track: MediaStreamTrack,
      ): Promise<boolean> => {
        publication.setTrack(slot, track);
        const generation = publication.generation;
        ownIntents.push({ slot, generation });
        const result = await publication.reconcile();
        if (failedOn(result, slot)) throw result.error;
        return publication.isCurrent(generation, slot);
      };
      const disposeStaleResources = (
        audioProcessor: LocalAudioProcessorHandle | null,
        cameraEffect: CameraBackgroundEffect | null = null,
      ) => {
        cameraEffect?.stop();
        audioProcessor?.destroy();
        if (acquiredStream && acquiredStream !== localStreamRef.current) {
          acquiredStream.getTracks().forEach((track) => track.stop());
        }
      };
      // Hands every slot whose intent is still this run's back to the
      // committed track, and waits until that is published again, so
      // nothing this run is about to release stays on the wire.
      const revertPublication = async () => {
        let reverted = false;
        for (const intent of ownIntents.splice(0)) {
          if (!publication.isCurrent(intent.generation, intent.slot)) continue;
          publication.setTrack(
            intent.slot,
            committedPublicationTrack(intent.slot),
          );
          reverted = true;
        }
        if (!reverted) return;
        const result = await publication.reconcile();
        if (result.status === "failed") {
          devicesLog.warn(
            "Failed to restore the publication after an abandoned device swap",
            result.error,
          );
        }
      };
      const abortStaleSwap = async (
        audioProcessor: LocalAudioProcessorHandle | null,
        cameraEffect: CameraBackgroundEffect | null = null,
      ) => {
        await revertPublication();
        disposeStaleResources(audioProcessor, cameraEffect);
      };
      const oldStream = localStreamRef.current;
      const requestedCameraBackgroundKey = getCameraBackgroundEffectKey(
        cameraBackground,
        customCameraBackgrounds,
      );

      // Always attempt audio — useMediaDevices() takes ~8s to set hasMicrophone
      // via its useEffect enumeration. Depending on that flag for the early-exit
      // means the initial publish is delayed. Instead, we always call getUserMedia
      // and let it throw NotFoundError if there's genuinely no mic (caught below).
      // hasMicrophone remains a dep so the effect re-runs when a mic is plugged in.
      try {
        // Skip if the current stream already uses the requested devices
        // AND the same audio processing settings. This prevents a redundant
        // getUserMedia call when our device-ID reflection (below) updates
        // inputDeviceId from "default" to the actual hardware ID.
        if (oldStream) {
          const currentAudioTrack = oldStream.getAudioTracks()[0];
          const currentVideoTrack =
            rawCameraTrackRef.current ?? oldStream.getVideoTracks()[0];
          const currentVideoId = currentVideoTrack?.getSettings().deviceId;
          const desiredPublicationMode = resolveLocalAudioPublicationMode(
            audioProcessingSettings,
          );
          const effectivePublicationMode =
            failedAudioProcessingModeRef.current === desiredPublicationMode
              ? fallbackPublicationMode(desiredPublicationMode)
              : desiredPublicationMode;
          // A raw microphone left published while the settings want a gate
          // (or RNNoise) is a mismatch, so the next sync repairs it.
          const audioProcessorMatches = publicationMatches(
            publishedAudioProcessorRef.current,
            effectivePublicationMode,
            audioProcessingSettings.voiceGateEnabled !== false,
          );
          // Device and capture processing: @ralph/voice (DEVICES.md,
          // "Keeping a capture").
          const audioMatch =
            !!currentAudioTrack &&
            currentAudioTrack.readyState === "live" &&
            liveCaptureMatches({
              savedId: microphoneSaved.deviceId,
              listedId: listedInputId,
              selection: microphoneIntent.selection,
              track: currentAudioTrack,
              trackDeviceId: currentAudioTrack.getSettings().deviceId,
              record: audioCaptureRequestRef.current,
            }) &&
            captureProcessingMatches(
              currentAudioTrack.getSettings(),
              resolveCaptureAudioProcessing(audioProcessingSettings),
            );
          const videoQualityMatch =
            !isCameraActive || activeCameraQualityRef.current === cameraQuality;
          const videoBackgroundMatch =
            !isCameraActive ||
            activeCameraBackgroundKeyRef.current ===
              requestedCameraBackgroundKey;
          const videoDeviceMatch =
            !isCameraActive ||
            (!!currentVideoTrack &&
              liveCaptureMatches({
                savedId: cameraSaved.deviceId,
                listedId: listedVideoId,
                selection: cameraIntent.selection,
                track: currentVideoTrack,
                trackDeviceId: currentVideoId,
                record: videoCaptureRequestRef.current,
              }));
          const videoMatch =
            !isCameraActive ||
            (!!currentVideoTrack &&
              videoDeviceMatch &&
              videoQualityMatch &&
              videoBackgroundMatch);
          const microphoneTrackName =
            sfu.getMicrophoneTrackName() ??
            (myIdRef.current ? `cam-audio-${myIdRef.current}` : null);
          const silenceStillPublished =
            isMicOnRef.current &&
            !!microphoneTrackName &&
            standbySilenceRef.current?.track ===
              sfu.getPublishedTrack(microphoneTrackName);
          if (
            audioMatch &&
            videoMatch &&
            audioProcessorMatches &&
            !silenceStillPublished
          ) {
            return;
          }
        }

        const captureProcessing = resolveCaptureAudioProcessing(
          audioProcessingSettings,
        );

        let newStream: MediaStream;
        try {
          newStream = await acquireLocalStream(
            {
              deviceId: microphoneSaved.deviceId,
              deviceLabel: microphoneSaved.label,
              groupId: microphoneSaved.groupId,
              noiseSuppression: captureProcessing.noiseSuppression,
              echoCancellation: captureProcessing.echoCancellation,
              autoGainControl: captureProcessing.autoGainControl,
              stereo: true,
            },
            isCameraActive
              ? {
                  deviceId: cameraSaved.deviceId,
                  deviceLabel: cameraSaved.label,
                  groupId: cameraSaved.groupId,
                  qualityId: cameraQuality,
                }
              : null,
            "Voice:Devices",
            standbyMediaOwnerRef.current ?? localMediaOwner,
          );
          acquiredStream = newStream;
          if (!isCurrent()) {
            await abortStaleSwap(null);
            return;
          }
        } catch (err: any) {
          if (err.name !== "NotAllowedError") {
            devicesLog.warn("Failed to acquire stream:", err.name);
          }
          return;
        }

        let streamToPublish: MediaStream | null = null;
        const applyProcessorMode = (
          processor: LocalAudioProcessorHandle,
        ): void => {
          const requestedAudioProcessingMode = resolveLocalAudioProcessingMode(
            audioProcessingSettings,
          );
          if (processor.mode !== requestedAudioProcessingMode) {
            failedAudioProcessingModeRef.current = requestedAudioProcessingMode;
          }
        };
        if (newStream.getAudioTracks().length > 0) {
          const replacingExistingAudio = !!oldStream?.getAudioTracks()[0];
          const publicationMode = resolveLocalAudioPublicationMode(
            audioProcessingSettings,
          );
          if (publicationMode !== "direct") {
            // The gate (and RNNoise) must be in place from the first packet:
            // build the processor before publishing instead of publishing the
            // raw microphone and swapping the processor in afterwards (that
            // swap raced later syncs and could leave the raw track published).
            // Joins overlap this with the voice gateway connecting.
            try {
              nextAudioProcessor =
                (await takeEarlyAudioProcessor(
                  earlyAudioProcessorRef,
                  newStream,
                  audioProcessingSettings,
                )) ??
                (await createLocalAudioProcessor(
                  newStream,
                  audioProcessingSettings,
                ));
            } catch (error) {
              devicesLog.warn(
                "Failed to create gated outbound audio processor",
                error,
              );
              nextAudioProcessor = null;
            }
          }

          if (nextAudioProcessor) {
            applyProcessorMode(nextAudioProcessor);
            streamToPublish = nextAudioProcessor.publicationStream;
          } else if (publicationMode === "direct") {
            // No gate, no RNNoise: publish the capture track itself.
            streamToPublish = new MediaStream(newStream.getAudioTracks());
          } else {
            failedAudioProcessingModeRef.current = publicationMode;
            if (replacingExistingAudio) {
              devicesLog.warn(
                "Outbound audio processor unavailable; preserving the previous publication",
              );
              await abortStaleSwap(null);
              return;
            }
            // Nothing is published yet, and an ungated microphone beats a
            // missing one. Reported (logged once, in diagnostics).
            reportLocalAudioIssue(
              "processor-unavailable",
              `publishing the raw microphone instead of ${publicationMode}`,
            );
            streamToPublish = new MediaStream(newStream.getAudioTracks());
          }
        } else {
          streamToPublish = newStream;
        }

        if (!isCurrent()) {
          await abortStaleSwap(nextAudioProcessor);
          return;
        }

        const displayStream = new MediaStream(newStream.getAudioTracks());
        const rawAudioTrack = newStream.getAudioTracks()[0];
        if (rawAudioTrack) rawAudioTrack.enabled = isMicOnRef.current;
        const previousAudioProcessor = publishedAudioProcessorRef.current;

        const oldAudio = oldStream?.getAudioTracks()[0];
        const newAudio = streamToPublish?.getAudioTracks()[0];
        const previousPublishedAudio =
          previousAudioProcessor?.publicationStream.getAudioTracks()[0] ??
          oldAudio;
        const audioNeedsUpdate =
          !!newAudio &&
          (!previousPublishedAudio ||
            previousPublishedAudio.id !== newAudio.id);
        const microphoneTrackName =
          sfu.getMicrophoneTrackName() ??
          (myIdRef.current ? `cam-audio-${myIdRef.current}` : "cam-audio-self");
        const silenceStillPublished =
          !!standbySilenceRef.current &&
          standbySilenceRef.current.track ===
            sfu.getPublishedTrack(microphoneTrackName);
        if (
          silenceStillPublished &&
          standbySilenceRef.current &&
          publication.appliedFor("microphone") === undefined
        ) {
          // A promoted standby's silence: replaced, not published beside.
          publication.adopt("microphone", standbySilenceRef.current.track);
        }
        const replaceSilenceWithLiveMic =
          isMicOnRef.current &&
          silenceStillPublished &&
          newAudio?.readyState === "live";
        const keepStandbySilence = !isMicOnRef.current && silenceStillPublished;
        if (keepStandbySilence) {
          vcLog.info("Publisher kept standby silence", {
            settingsMuted: !isMicOnRef.current,
            hasMicrophone,
            trackName: microphoneTrackName,
          });
          if (rawAudioTrack) rawAudioTrack.enabled = false;
        }
        if (
          (audioNeedsUpdate || replaceSilenceWithLiveMic) &&
          newAudio &&
          !keepStandbySilence
        ) {
          if (!oldAudio) {
            // Speaking detection starts before the first publication lands.
            if (nextAudioProcessor) {
              sfu.vad.setGateController(nextAudioProcessor.gateController);
              restartVadMonitoring(sfu, nextAudioProcessor);
            } else {
              restartVadMonitoring(sfu, null, newStream);
            }
          }
          // Mute is the reconciler's `enabled`: it never restarts this.
          publication.setEnabled("microphone", isMicOnRef.current);
          const published = await wantPublished("microphone", newAudio);
          if (!isCurrent() || !published) {
            await abortStaleSwap(nextAudioProcessor);
            return;
          }
          if (rawAudioTrack) rawAudioTrack.enabled = isMicOnRef.current;
          releaseStandbySilence(newAudio);
        }

        const oldVideo = oldStream?.getVideoTracks()[0];
        const previousRawVideo = rawCameraTrackRef.current;
        const rawVideo = newStream.getVideoTracks()[0];
        let newVideo = rawVideo;

        if (rawVideo) {
          if (requestedCameraBackgroundKey !== "none") {
            try {
              const effect = await createCameraBackgroundEffect(
                rawVideo,
                cameraBackground,
                customCameraBackgrounds,
              );
              acquiredCameraEffect = effect;
              if (!isCurrent()) {
                await abortStaleSwap(nextAudioProcessor, effect);
                return;
              }
              cameraBackgroundEffectRef.current?.stop();
              cameraBackgroundEffectRef.current = effect;
              if (effect) {
                newVideo = effect.track;
                activeCameraBackgroundKeyRef.current = effect.key;
              } else {
                activeCameraBackgroundKeyRef.current = "none";
              }
            } catch (error) {
              devicesLog.warn(
                "Camera background processor unavailable; publishing raw camera",
                error,
              );
              if (!isCurrent()) {
                await abortStaleSwap(nextAudioProcessor);
                return;
              }
              stopCameraBackgroundEffect(false);
              newVideo = rawVideo;
            }
          } else {
            stopCameraBackgroundEffect(false);
          }

          rawCameraTrackRef.current = rawVideo;
          newVideo.enabled = isCameraActive;
          displayStream.addTrack(newVideo);
        } else {
          stopCameraBackgroundEffect(true);
        }

        if (newVideo && (!oldVideo || newVideo.id !== oldVideo.id)) {
          newVideo.enabled = isCameraActive;
          const published = await wantPublished("camera", newVideo);
          if (!isCurrent() || !published) {
            await abortStaleSwap(nextAudioProcessor);
            return;
          }
        }

        const committedAudioProcessor = nextAudioProcessor;
        localStreamRef.current = displayStream;
        publishedAudioProcessorRef.current = committedAudioProcessor;
        ownIntents.length = 0;
        nextAudioProcessor = null;
        if (audioNeedsUpdate) {
          sfu.vad.setGateController(
            committedAudioProcessor?.gateController ?? null,
          );
          noteLocalAudioPublication(committedAudioProcessor?.mode ?? "direct", {
            gated:
              !!committedAudioProcessor?.gateController.inGraph &&
              (committedAudioProcessor.gateLookaheadMs ?? 0) > 0,
            lookaheadMs: committedAudioProcessor?.gateLookaheadMs ?? null,
          });
        }
        if (
          previousAudioProcessor &&
          previousAudioProcessor !== committedAudioProcessor
        ) {
          previousAudioProcessor.destroy();
        }

        const publishedMic = sfu.getPublishedTrack(microphoneTrackName);
        const keptCapture = newStream.getAudioTracks();
        if (
          oldAudio &&
          oldAudio !== newAudio &&
          oldAudio !== publishedMic &&
          oldAudio !== standbySilenceRef.current?.track &&
          !keptCapture.includes(oldAudio)
        ) {
          oldAudio.stop();
        }
        if (oldVideo && oldVideo !== newVideo) oldVideo.stop();
        if (
          previousRawVideo &&
          previousRawVideo !== rawVideo &&
          previousRawVideo !== oldVideo
        ) {
          previousRawVideo.stop();
        }

        if (
          (audioNeedsUpdate || replaceSilenceWithLiveMic) &&
          oldAudio &&
          isMicOnRef.current
        ) {
          restartVadMonitoring(sfu);
        }

        if (!isCurrent()) return;

        // Record what each capture was opened for, and save a refreshed id
        // when the saved device came back under a new one. A fallback
        // capture (device unplugged, or the list was still hidden) leaves
        // the saved choice alone (DEVICES.md, "What is saved").
        const actualAudioTrack = newStream.getAudioTracks()[0];
        audioCaptureRequestRef.current = actualAudioTrack
          ? {
              track: actualAudioTrack,
              savedId: microphoneSaved.deviceId,
              listedId: listedInputId,
              selection: microphoneIntent.selection,
            }
          : null;
        const audioOutcome = actualAudioTrack
          ? captureOutcome(microphoneSaved, openedDevice(actualAudioTrack))
          : null;
        setInputCaptureFellBack(!!audioOutcome?.fellBack);
        if (actualAudioTrack && audioOutcome?.persist) {
          const opened = openedDevice(actualAudioTrack);
          setDevice("input", audioOutcome.persist, undefined, {
            label: opened.label,
            groupId: opened.groupId,
          });
        }
        if (!isCurrent()) return;
        const actualVideoTrack = rawVideo;
        activeCameraQualityRef.current = actualVideoTrack
          ? cameraQuality
          : null;
        videoCaptureRequestRef.current = actualVideoTrack
          ? {
              track: actualVideoTrack,
              savedId: cameraSaved.deviceId,
              listedId: listedVideoId,
              selection: cameraIntent.selection,
            }
          : null;
        const videoOutcome = actualVideoTrack
          ? captureOutcome(cameraSaved, openedDevice(actualVideoTrack))
          : null;
        setVideoCaptureFellBack(!!videoOutcome?.fellBack);
        if (actualVideoTrack && videoOutcome?.persist) {
          const opened = openedDevice(actualVideoTrack);
          setDevice("video", videoOutcome.persist, undefined, {
            label: opened.label,
            groupId: opened.groupId,
          });
        }
      } catch (err) {
        // The reconciler gave up (its retries are spent) or a step threw:
        // hand the slots back and release what this run captured.
        await revertPublication();
        if (isInitialMediaSync && isCurrent()) {
          sfu.vad.stop();
          sfu.vad.setGateController(null);
        }
        nextAudioProcessor?.destroy();
        acquiredCameraEffect?.stop();
        if (cameraBackgroundEffectRef.current === acquiredCameraEffect) {
          cameraBackgroundEffectRef.current = null;
          activeCameraBackgroundKeyRef.current = "none";
        }
        if (acquiredStream && acquiredStream !== localStreamRef.current) {
          const currentTracks = new Set(
            localStreamRef.current?.getTracks() ?? [],
          );
          acquiredStream.getTracks().forEach((track) => {
            if (!currentTracks.has(track)) track.stop();
          });
        }
        devicesLog.error("Failed to swap devices:", err);
      }
    };

    void swapDevices().finally(() => {
      run.done = true;
    });
    // No cleanup: the next run cancels this one (unless it is the first
    // capture asking for the same thing), and the teardown releases what
    // a cancelled run still holds.
  }, [
    // Capture-sync triggers (packages/voice/DEVICES.md, "When to capture
    // again"): device intent and fallback retry per kind, camera state,
    // processing settings, a microphone appearing, the unmute retry, and
    // a new client.
    microphoneIntent,
    inputFallbackRetryId,
    cameraIntent,
    videoFallbackRetryId,
    cameraQuality,
    cameraBackground,
    customCameraBackgrounds,
    isCameraActive,
    audioProcessingSettings,
    hasMicrophone,
    captureRetryNonce,
    sfuInstance,
    setDevice,
    stopCameraBackgroundEffect,
    localMediaOwner,
    restartVadMonitoring,
    releaseStandbySilence,
    publicationFor,
    committedPublicationTrack,
    voiceSession,
  ]);

  // Unmount: drop whatever capture is still in flight.
  useEffect(
    () => () => {
      captureGenerationRef.current += 1;
      cancelPendingLocalStreamAcquisition(localMediaOwner);
    },
    [localMediaOwner],
  );

  useEffect(() => {
    if (!sfuRef.current) return;

    sfuRef.current.vad.setThreshold(
      getVoiceActivityThreshold(
        isStudioMode ? true : autoSensitivity,
        sensitivity,
      ),
    );
  }, [autoSensitivity, isStudioMode, sensitivity, sfuInstance]);

  const setMasterVolume = useCallback((outputVolume: number) => {
    if (!sfuRef.current) return;
    sfuRef.current.audio.setMasterVolume(outputVolume / 100);
  }, []);

  const setOutputDevice = useCallback((outputDeviceId: string) => {
    if (!sfuRef.current) return;
    sfuRef.current.audio.setOutputDevice(outputDeviceId);
  }, []);

  // ── Master output volume sync ──────────────────────────────────────────
  useEffect(() => {
    if (!joined) return;
    setMasterVolume(outputVolume);
  }, [outputVolume, joined, setMasterVolume]);

  // ── Output device sync ─────────────────────────────────────────────────
  // The saved speaker id can go stale like a microphone's, so look it up by
  // label/groupId before handing it to setSinkId. While the list is hidden
  // the saved id is tried as is; the lookup runs again when the list changes
  // (first capture unlocks it, a device is plugged in) or the user picks a
  // speaker again.
  useEffect(() => {
    if (!joined) return;
    let cancelled = false;
    void resolveOutputSinkId({
      deviceId: outputDeviceId,
      label: outputDeviceLabel,
      groupId: outputDeviceGroupId,
    }).then((sinkId) => {
      if (!cancelled) setOutputDevice(sinkId);
    });
    return () => {
      cancelled = true;
    };
  }, [
    outputDeviceId,
    outputDeviceLabel,
    outputDeviceGroupId,
    outputSelectionRevision,
    audioOutputsKey,
    joined,
    setOutputDevice,
  ]);

  const previousVoiceJoinStateRef = useRef(joined);
  useEffect(() => {
    const joinedChanged = previousVoiceJoinStateRef.current !== joined;
    previousVoiceJoinStateRef.current = joined;
    const standbyOwnsMic =
      !!channelId &&
      !!serverId &&
      setClaimedVoiceAudible(channelId, serverId, publishMic);
    if (publishMic && standbyOwnsMic && sfuRef.current) {
      const sfu = sfuRef.current;
      const trackName = sfu.getMicrophoneTrackName();
      const published = trackName ? sfu.getPublishedTrack(trackName) : null;
      const silenceTrack = standbySilenceRef.current?.track ?? null;
      // The processor's (gated) output when there is one, else the capture
      // track itself (direct publication).
      const liveMic =
        publishedAudioProcessorRef.current?.publicationStream
          .getAudioTracks()
          .find((track) => track.readyState === "live") ??
        localStreamRef.current
          ?.getAudioTracks()
          .find(
            (track) => track.readyState === "live" && track !== silenceTrack,
          );
      const liveTracks =
        localStreamRef.current
          ?.getAudioTracks()
          .filter(
            (track) => track.readyState === "live" && track !== silenceTrack,
          ) ?? [];
      for (const track of liveTracks) track.enabled = true;
      if (trackName && silenceTrack && published === silenceTrack && liveMic) {
        const publication = publicationFor(sfu);
        if (publication.appliedFor("microphone") === undefined) {
          publication.adopt("microphone", silenceTrack);
        }
        publication.setEnabled("microphone", true);
        publication.setTrack("microphone", liveMic);
        void publication.reconcile().then((result) => {
          if (
            result.status !== "converged" ||
            publication.intentFor("microphone").track !== liveMic
          ) {
            vcLog.warn("Unmute could not replace standby silence", {
              trackName,
            });
            return;
          }
          vcLog.info("Unmute published live microphone", { trackName });
        });
      } else if (trackName && silenceTrack && published === silenceTrack) {
        vcLog.info("Unmute waiting for a new microphone", {
          trackName,
          localTracks:
            localStreamRef.current?.getAudioTracks().map((track) => ({
              readyState: track.readyState,
              enabled: track.enabled,
            })) ?? [],
        });
        // Mute is not a capture input any more: ask the capture sync to
        // open a microphone now.
        setCaptureRetryNonce((nonce) => nonce + 1);
      }
    }
    const publishKey = `${isMicOn}:${hasMicrophone}:${settingsMuted}:${standbyOwnsMic}`;
    if (publishMicLogRef.current !== publishKey) {
      publishMicLogRef.current = publishKey;
      vcLog.info("Publisher mic audible", {
        isMicOn,
        hasMicrophone,
        settingsMuted,
        publishMic,
        standbyOwnsMic,
      });
    }
    // The reconciler's mute intent follows every mute change, whoever gates
    // the sender now (a claimed standby gates it itself): a republish after
    // a voice reconnect applies this intent. Applied at once; never cancels
    // a publication in flight.
    existingPublication(sfuRef.current)?.setEnabled("microphone", publishMic);
    const stream = localStreamRef.current;
    if (!stream && !standbyOwnsMic) return;

    if (stream && !standbyOwnsMic) {
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = publishMic;
      }
    }

    if (!joinedChanged) restartVadMonitoring(sfuRef.current);

    const previousVoiceMute = sentVoiceMuteRef.current;
    if (
      !previousVoiceMute ||
      previousVoiceMute.mute !== settingsMuted ||
      previousVoiceMute.deaf !== isDeafened
    ) {
      const earliestAttach = Math.min(
        ...remoteAudioAttachedAtRef.current.values(),
      );
      vcLog.info("Local voice mute transition", {
        selfMuteFrom: previousVoiceMute?.mute ?? null,
        selfMuteTo: settingsMuted,
        selfDeafFrom: previousVoiceMute?.deaf ?? null,
        selfDeafTo: isDeafened,
        hasMicrophone,
        isMicOn,
        publishMic,
        msSinceEarliestRemoteAttach: Number.isFinite(earliestAttach)
          ? Date.now() - earliestAttach
          : null,
      });
      sentVoiceMuteRef.current = { mute: settingsMuted, deaf: isDeafened };
    }

    if (joined) {
      sfuRef.current?.roomGW.sendVoiceState({
        self_mute: settingsMuted,
        self_deaf: isDeafened,
        self_video: isCameraOn,
        self_stream: isScreenSharing,
        self_stream_audio: isStreamingAudio,
      });
    }
  }, [
    isMicOn,
    publishMic,
    settingsMuted,
    hasMicrophone,
    isDeafened,
    isCameraOn,
    isScreenSharing,
    isStreamingAudio,
    joined,
    mode,
    channelId,
    serverId,
    restartVadMonitoring,
    publicationFor,
    existingPublication,
  ]);

  // Mute, deafen, camera and share go to the room socket only (above): the
  // room's roster carries them to the sidebar.

  const disconnectBeaconSentRef = useRef(false);

  useEffect(() => {
    if (joined) {
      disconnectBeaconSentRef.current = false;
    }
  }, [joined, channelId, serverId, mode]);

  useEffect(() => {
    if (typeof window === "undefined" || !user?.id) return;

    const handleProfileUpdate = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          event?: string;
          data?: {
            user_id?: string;
            name?: string;
            username?: string;
            display_name?: string | null;
            avatar_url?: string | null;
            avatar_display?: string | null;
          };
        }>
      ).detail;
      const profile = detail?.data;
      if (!joined || !profile || detail.event !== "USER_PROFILE_UPDATE") return;
      if (profile.user_id !== user.id) return;

      const identityFields = [
        "name",
        "username",
        "display_name",
        "avatar_url",
        "avatar_display",
      ] as const;
      if (
        !identityFields.some((field) =>
          Object.prototype.hasOwnProperty.call(profile, field),
        )
      ) {
        return;
      }
      sfuRef.current?.roomGW.refreshProfile();
    };

    window.addEventListener("chat-gateway-event", handleProfileUpdate);
    return () =>
      window.removeEventListener("chat-gateway-event", handleProfileUpdate);
  }, [joined, user?.id]);

  useEffect(() => {
    if (mode !== "channel" || !channelId || !serverId) return;

    const handlePageExit = () => {
      if (!voiceSession.isJoined || disconnectBeaconSentRef.current) return;

      const voiceSessionId = myIdRef.current;
      const gatewaySessionId = useChatStore.getState().gateway.getSessionId();
      if (!voiceSessionId && !gatewaySessionId) return;

      disconnectBeaconSentRef.current = true;
      sendVoiceDisconnectBeacon({
        channelId,
        serverId,
        gatewaySessionId,
        voiceSessionId,
      });
    };

    window.addEventListener("pagehide", handlePageExit);
    window.addEventListener("beforeunload", handlePageExit);
    return () => {
      window.removeEventListener("pagehide", handlePageExit);
      window.removeEventListener("beforeunload", handlePageExit);
    };
  }, [channelId, serverId, mode, voiceSession]);

  /**
   * The hook's part of the one teardown (VoiceSession.end, see
   * packages/voice/STATE_MACHINE.md "Teardown"). Leave, forced disconnect
   * and unmount all come through here, each with the props of the render
   * that registered it; the session picks the plan (sounds, send window,
   * onLeft) and runs these steps in its fixed order.
   */
  const endVoiceSession = useCallback(
    (reason: VoiceEndReason, inputs: VoiceTeardownInputs) => {
      const {
        automaticSoundboardSessionId: soundboardSessionId,
        channelId: endedChannelId,
        createAutomaticSoundboardTransport: createTransport,
        isCall: endedIsCall,
        localMediaOwner: endedMediaOwner,
        mode: endedMode,
        onLeft: notifyLeft,
        sendVoiceChannelLeave: leavePresence,
        serverId: endedServerId,
      } = inputs;
      return voiceSession.end(
        reason,
        {
          announceLeave: ({ client, plan }) => {
            const details = {
              reason,
              channelId: endedChannelId,
              serverId: endedServerId,
              mode: endedMode,
              joined: plan.wasJoined,
            };
            if (reason === "forced-disconnect") {
              vcLog.warn("Voice lifecycle teardown", details);
            } else {
              vcLog.info("Voice lifecycle teardown", details);
            }
            // Calls skip it: the gateway plays the call-end sound.
            if (plan.leaveSound) playDisconnect();
            // handleLeave cancels it itself, before retiring the standby.
            if (reason === "forced-disconnect") {
              cancelAutomaticSoundboardCleanup(soundboardSessionId);
            }
            const generation =
              getAutomaticSoundboardSessionGeneration(soundboardSessionId);
            if (plan.leaveTrigger) {
              void playAutomaticSoundboardTrigger(
                "leave",
                soundboardSessionId,
                endedServerId,
                createTransport(client),
              ).catch(() => false);
            }
            if (plan.sendWindowMs === 0) return;
            return () =>
              resetAutomaticSoundboardSession(soundboardSessionId, generation);
          },
          releaseLocalMedia: ({ client }) => {
            // Sharing stops with the session: its captures are released
            // (the media session and the native pipeline go with the
            // client's disconnect).
            if (screenShareRef.current?.client === client) {
              screenShareRef.current.share.dispose();
              screenShareRef.current = null;
            }
            // Publications end with the media session; nothing more may be
            // published, replaced or retried for this client.
            if (publicationRef.current?.client === client) {
              publicationRef.current.reconciler.dispose();
              publicationRef.current = null;
            }
            stopCameraBackgroundEffect(true);
            client.vad.setGateController(null);
            // VAD starts before Joined; its monitor may be a clone of the raw mic.
            disposeVoiceActivityStream(ownedVadMonitorStreamRef.current);
            ownedVadMonitorStreamRef.current = null;
            publishedAudioProcessorRef.current?.destroy();
            publishedAudioProcessorRef.current = null;
            discardEarlyAudioProcessor(earlyAudioProcessorRef);
            localStreamRef.current?.getTracks().forEach((track) => {
              track.onended = null;
              track.stop();
            });
            localStreamRef.current = null;
            // Also invalidates a capture that may still be pending.
            releaseLocalStream(endedMediaOwner);
            if (standbyMediaOwnerRef.current) {
              releaseLocalStream(standbyMediaOwnerRef.current);
              standbyMediaOwnerRef.current = null;
            }
          },
          clearSessionState: ({ plan }) => {
            myIdRef.current = "";
            speakingByParticipantRef.current = {};
            participantsRef.current.clear();
            remoteAggregatorsRef.current = {};
            uuidToUserIdRef.current.clear();
            capturingThumbnails.current.clear();
            voiceDispatch({ type: "LEFT" });
            if (plan.clearPresence && endedMode !== "room" && endedChannelId) {
              leavePresence(endedChannelId);
            }
          },
          // Only its own client: a session started inside the send window
          // keeps the instance it set.
          releaseClient: ({ client }) =>
            setSfuInstance((current) => (current === client ? null : current)),
          left: () => notifyLeft?.(),
        },
        { isCall: endedIsCall },
      );
    },
    [stopCameraBackgroundEffect, voiceSession],
  );

  useEffect(() => {
    return () => {
      // A held standby is only let go; its pool keeps or disposes it.
      if (
        !voiceSession.isStandby &&
        mode === "channel" &&
        channelId &&
        serverId
      ) {
        retireVoiceStandby(channelId, serverId);
      }
      const outcome = endVoiceSession("component-unmount", {
        automaticSoundboardSessionId,
        channelId,
        createAutomaticSoundboardTransport,
        isCall,
        localMediaOwner,
        mode,
        sendVoiceChannelLeave,
        serverId,
      });
      if (outcome.kind !== "ended") return;
      // Re-arm auto-join. Under React StrictMode (dev) the mount runs
      // setup → cleanup → setup again, so this teardown fires immediately
      // after the auto-join created the SFU — tearing down the half-open
      // WebSocket ("closed before connection established"). Because
      // hasAutoJoined is a ref, it survives the remount and would otherwise
      // stay true, so the re-mounted effect would skip re-joining and leave
      // the user stranded on the landing page until they click "Join Voice"
      // a second time. Resetting it lets the remount auto-join again.
      // This is safe: a genuine unmount discards the ref entirely, and
      // explicit leaves go through handleLeave (which sets the guard).
      hasAutoJoined.current = false;
      autoJoinTargetRef.current = null;
    };
  }, [
    channelId,
    sendVoiceChannelLeave,
    mode,
    serverId,
    isCall,
    automaticSoundboardSessionId,
    createAutomaticSoundboardTransport,
    localMediaOwner,
    endVoiceSession,
    voiceSession,
  ]);

  // Listen for forced disconnects (e.g. user was banned/kicked from the server)
  useEffect(() => {
    const handleForceDisconnect = () => {
      if (mode === "channel" && channelId && serverId) {
        dropVoiceStandby(channelId, serverId);
      }
      endVoiceSession("forced-disconnect", {
        automaticSoundboardSessionId,
        channelId,
        createAutomaticSoundboardTransport,
        isCall,
        localMediaOwner,
        mode,
        onLeft,
        sendVoiceChannelLeave,
        serverId,
      });
    };
    forceDisconnectRef.current = handleForceDisconnect;
    window.addEventListener("force-voice-disconnect", handleForceDisconnect);
    return () => {
      if (forceDisconnectRef.current === handleForceDisconnect) {
        forceDisconnectRef.current = null;
      }
      window.removeEventListener(
        "force-voice-disconnect",
        handleForceDisconnect,
      );
    };
  }, [
    onLeft,
    sendVoiceChannelLeave,
    channelId,
    isCall,
    mode,
    serverId,
    automaticSoundboardSessionId,
    createAutomaticSoundboardTransport,
    localMediaOwner,
    endVoiceSession,
  ]);

  const handleLeave = useCallback(() => {
    const activeSfu = voiceSession.client;
    if (!activeSfu) return;
    // Leaving on your own drops any move grant; the leave a move causes
    // keeps the one it just brought.
    if (!activeSfu.wasMoved) clearVoiceMoveGrant();
    cancelAutomaticSoundboardCleanup(automaticSoundboardSessionId);
    if (mode === "channel" && channelId && serverId) {
      retireVoiceStandby(channelId, serverId);
    }
    const outcome = endVoiceSession("user-leave", {
      automaticSoundboardSessionId,
      channelId,
      createAutomaticSoundboardTransport,
      isCall,
      localMediaOwner,
      mode,
      onLeft,
      sendVoiceChannelLeave,
      serverId,
    });
    // Prevent the auto-join effect from immediately re-joining after an explicit
    // leave while the URL (and autoJoin prop) still points at this voice channel.
    if (outcome.kind === "ended") hasAutoJoined.current = true;
  }, [
    sendVoiceChannelLeave,
    onLeft,
    isCall,
    channelId,
    mode,
    serverId,
    automaticSoundboardSessionId,
    createAutomaticSoundboardTransport,
    localMediaOwner,
    endVoiceSession,
    voiceSession,
  ]);

  const toggleMic = useCallback(() => {
    if (!settingsMuted) playMute();
    else playUnmute();
    setIsMuted(!settingsMuted);
  }, [settingsMuted, setIsMuted]);

  const toggleDeafen = useCallback(() => {
    if (!settingsDeafened) playDeafen();
    else playUndeafen();
    setIsDeafened(!settingsDeafened);
  }, [settingsDeafened, setIsDeafened]);

  const toggleCamera = useCallback(async () => {
    const session = sfuRef.current;
    const stream = localStreamRef.current;
    if (!stream || !session) return;
    // The session's first capture is on its way: leave it alone (cancelling
    // it here would withdraw its publication and push it again). The stream
    // exists from the join on, so it says nothing about the capture.
    if (isCaptureInFlight(session, { initialOnly: true })) {
      devicesLog.info("Camera toggle ignored during the first capture");
      return;
    }
    cancelPendingLocalStreamAcquisition(localMediaOwner);
    const generation = ++captureGenerationRef.current;
    const publication = publicationFor(session);

    const isCurrent = () =>
      captureGenerationRef.current === generation &&
      sfuRef.current === session &&
      localStreamRef.current === stream;
    const discardStaleCapture = (
      capture: MediaStream,
      effect: CameraBackgroundEffect | null = null,
    ) => {
      effect?.stop();
      capture.getTracks().forEach((track) => {
        track.onended = null;
        track.stop();
      });
    };

    const newState = !desiredCameraStateRef.current;
    desiredCameraStateRef.current = newState;
    const intentVersion = ++desiredCameraIntentVersionRef.current;

    const performToggle = async () => {
      if (newState) {
        if (!isCurrent()) return;
        const existingVideoTracks = stream.getVideoTracks();
        const requestedCameraBackgroundKey = getCameraBackgroundEffectKey(
          cameraBackground,
          customCameraBackgrounds,
        );
        const shouldAcquireVideoTrack =
          existingVideoTracks.length === 0 ||
          activeCameraQualityRef.current !== cameraQuality ||
          activeCameraBackgroundKeyRef.current !== requestedCameraBackgroundKey;
        if (shouldAcquireVideoTrack) {
          const newStream = await navigator.mediaDevices.getUserMedia({
            video: buildCameraVideoConstraints({
              deviceId: videoDeviceId,
              exactDevice: false,
              qualityId: cameraQuality,
            }),
          });
          if (!isCurrent()) {
            discardStaleCapture(newStream);
            return;
          }
          const rawTrack = newStream.getVideoTracks()[0];
          let outputTrack = rawTrack;

          if (rawTrack && requestedCameraBackgroundKey !== "none") {
            try {
              const effect = await createCameraBackgroundEffect(
                rawTrack,
                cameraBackground,
                customCameraBackgrounds,
              );
              if (!isCurrent()) {
                discardStaleCapture(newStream, effect);
                return;
              }
              cameraBackgroundEffectRef.current?.stop();
              cameraBackgroundEffectRef.current = effect;
              if (effect) {
                outputTrack = effect.track;
                activeCameraBackgroundKeyRef.current = effect.key;
              } else {
                activeCameraBackgroundKeyRef.current = "none";
              }
            } catch (error) {
              devicesLog.warn(
                "Camera background processor unavailable; publishing raw camera",
                error,
              );
              if (!isCurrent()) {
                discardStaleCapture(newStream);
                return;
              }
              stopCameraBackgroundEffect(false);
            }
          } else {
            if (!isCurrent()) {
              discardStaleCapture(newStream);
              return;
            }
            stopCameraBackgroundEffect(false);
          }

          if (!isCurrent()) {
            discardStaleCapture(newStream);
            return;
          }
          const previousRawTrack = rawCameraTrackRef.current;
          rawCameraTrackRef.current = rawTrack ?? null;
          existingVideoTracks.forEach((oldTrack) => {
            stream.removeTrack(oldTrack);
            oldTrack.stop();
          });
          if (
            previousRawTrack &&
            previousRawTrack !== rawTrack &&
            !existingVideoTracks.includes(previousRawTrack)
          ) {
            previousRawTrack.stop();
          }
          if (outputTrack) stream.addTrack(outputTrack);
          activeCameraQualityRef.current = rawTrack ? cameraQuality : null;
        }
        if (!isCurrent()) return;
        stream.getVideoTracks().forEach((t) => (t.enabled = true));
        const cameraTrack = stream.getVideoTracks()[0];
        if (!cameraTrack) return;
        publication.setTrack("camera", cameraTrack);
        const result = await publication.reconcile();
        if (!isCurrent()) return;
        if (failedOn(result, "camera")) throw result.error;
      } else {
        if (!isCurrent()) return;
        stopCameraBackgroundEffect(true);
        if (!isCurrent()) return;
        stream.getVideoTracks().forEach((t) => {
          stream.removeTrack(t);
          t.stop();
        });
        if (!isCurrent()) return;
        activeCameraQualityRef.current = null;
        // Withdrawn, not closed: PartyTracks keeps the camera's SFU track
        // alive with a keepalive (see unpublishTrack).
        publication.setTrack("camera", null);
        const result = await publication.reconcile();
        if (!isCurrent()) return;
        if (failedOn(result, "camera")) throw result.error;
      }
      if (!isCurrent()) return;
      voiceDispatch({ type: "SET_CAMERA", payload: newState });
      return true;
    };

    let committed = false;
    try {
      committed = (await performToggle()) === true;
    } finally {
      if (
        !committed &&
        desiredCameraIntentVersionRef.current === intentVersion
      ) {
        desiredCameraStateRef.current = isCameraActive;
      }
    }
  }, [
    isCameraActive,
    videoDeviceId,
    cameraQuality,
    cameraBackground,
    customCameraBackgrounds,
    stopCameraBackgroundEffect,
    localMediaOwner,
    publicationFor,
    isCaptureInFlight,
  ]);

  // ── Screen share ────────────────────────────────────────────────────────────
  // The lifecycle (start, restart, audio, quality, stop, failure) is the
  // voice package's ScreenShare (packages/voice/SCREEN_SHARE.md); this only
  // turns the UI's calls into its commands. The UI state follows its events
  // (see screenShareFor).
  const toggleScreenShare = useCallback(
    async (options?: ScreenShareOptions) => {
      const client = sfuRef.current;
      if (!client) {
        screenLog.warn("Screen share needs a voice connection");
        return;
      }
      const share = screenShareFor(client);
      const wanted = share.wanted;
      const changes =
        !!options?.changeSource ||
        !!options?.quality ||
        options?.withAudio !== undefined;
      // A picked source other than the wanted one is a new share, even when
      // the caller did not know one was starting (changeSource unset).
      const otherSource =
        options?.sourceId !== undefined &&
        options.sourceId !== wanted?.source.sourceId;
      if (wanted && !changes) {
        share.stop();
      } else if (!wanted || options?.changeSource || otherSource) {
        // A desktop restart re-targets the live source unless the picker
        // chose another, so it goes back through the same capture path
        // (the native hook) instead of a fresh getDisplayMedia.
        const live = wanted?.source;
        const merged: ScreenShareOptions | undefined =
          live?.sourceId && isDesktop()
            ? {
                sourceId: live.sourceId,
                captureId: live.captureId ?? undefined,
                sourceName: live.sourceName ?? undefined,
                sourceKind: live.sourceKind ?? undefined,
                sourceAppName: live.sourceAppName ?? undefined,
                sourceIcon: live.sourceIcon ?? undefined,
                ...options,
              }
            : options;
        share.start(
          webScreenShareRequest(merged, {
            quality: wanted?.quality ?? currentScreenQuality,
            audio: wanted?.audio ?? isStreamingAudio,
          }),
        );
      } else {
        if (options?.withAudio !== undefined) share.setAudio(options.withAudio);
        if (options?.quality) share.setQuality(options.quality);
      }
      await share.idle();
    },
    [screenShareFor, currentScreenQuality, isStreamingAudio],
  );

  // ── Native share ended itself (desktop) ─────────────────────────────────────
  // The backend emits `native-screen-share-ended` when a native share ends on
  // its own:
  //   * `source-closed` — the captured window closed / its process exited. Stop
  //     the share like an explicit stop (drop tracks, clear UI, stop sound).
  //   * `connection-failed` — the hardware stream's connection died mid-share.
  //     Restart the same source through CEF capture (quality and audio kept)
  //     unless the hook-exclusive policy forbids WGC/CEF capture, then stop.
  // The client emits the same `connection-failed` when a native share could
  // not reconnect after a voice reconnect (the backend says nothing for a
  // stop the renderer made); it counts only while the live share is native.
  const handleNativeShareEnded = useCallback(
    (
      rawPayload: unknown,
      client: SFUClient | null,
      origin: "backend" | "reconnect",
    ) => {
      const share = existingScreenShare(client);
      const wanted = share?.wanted ?? null;
      const payload = parseNativeShareEndedPayload(rawPayload);
      const action = resolveNativeShareEndedAction(payload, {
        isSharing:
          wanted !== null &&
          (origin === "backend" || share?.live?.path === "native"),
        wgcCaptureAllowed: isWgcCaptureAllowed(),
      });
      vcLog.info("Native screen share ended by itself", {
        origin,
        payload,
        action,
      });
      if (!share || !wanted || action === "ignore") return;
      if (action === "fallback-cef") {
        toast.info("Screen share switched to standard capture", {
          id: "native-share-fallback",
          description: "The hardware stream lost its connection.",
        });
        share.start({ ...wanted, preferNative: false });
      } else {
        share.stop();
      }
    },
    [existingScreenShare],
  );
  nativeShareEndedRef.current = handleNativeShareEnded;
  useEffect(() => {
    if (!isDesktop()) return;
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    void (async () => {
      try {
        const dispose = await getHost().media.onNativeScreenShareEnded(
          (rawPayload) => {
            handleNativeShareEnded(rawPayload, sfuRef.current, "backend");
          },
        );
        if (cancelled) dispose();
        else unlisten = dispose;
      } catch {
        // Event API unavailable (non-Tauri); nothing to do.
      }
    })();
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, [handleNativeShareEnded]);

  // ── Toggle local preview capture ───────────────────────────────────────────
  // Stops or restarts the CEF preview MediaStream entirely for performance.
  // The native hardware share pipeline is NOT touched — only the local tile feed.
  const togglePreviewHidden = useCallback(async () => {
    const client = sfuRef.current;
    const share = existingScreenShare(client);
    const capture = share?.live?.capture ?? null;
    const hasReusablePreviewSource =
      !!currentScreenSource?.sourceId && isScreenSharing;
    if (!isPreviewHidden) {
      const hideDecision = resolvePreviewHideState({
        isHookActive,
        hasReusablePreviewSource,
      });
      if (hideDecision.preserveStream) {
        voiceDispatch({
          type: "SET_PREVIEW_HIDDEN",
          payload: true,
          stream: capture?.stream ?? localScreenStream,
        });
        return;
      }
      // Tear down the loopback PC if active (hook shares).
      if (isHookActive && client) {
        await client.stopPreviewLoopback();
      }
      // Stop all preview tracks to release the WGC session.
      if (capture) {
        capture.stream?.getTracks().forEach((t) => {
          t.onended = null;
          t.stop();
        });
        attachScreenPreview(capture, null, null);
      }
      voiceDispatch({
        type: "SET_PREVIEW_HIDDEN",
        payload: true,
        stream: null,
      });
      return;
    }

    const resumeMechanism = resolvePreviewResumeMechanism({
      isHookActive,
      hasReusablePreviewSource,
    });
    // When the hook is the active capture backend, feed the local preview
    // from the hook's existing encode via a loopback PeerConnection — no
    // second WGC capture, no border, no extra encode cost.
    if (resumeMechanism === "desktop-loopback" && client) {
      const stream = await client.startPreviewLoopback();
      if (stream) {
        if (capture) attachScreenPreview(capture, stream, null);
        voiceDispatch({ type: "SET_PREVIEW_HIDDEN", payload: false, stream });
      } else {
        previewLog.warn("Loopback preview failed to connect");
      }
      return;
    }
    // Re-open preview only when the selected desktop source is reusable.
    const src = currentScreenSource;
    const outcome = await resolvePreviewResume({
      canReopenNativePreview: resumeMechanism === "reopen-selected-source",
      existingPreviewStream: capture?.stream ?? localScreenStream,
      openPreviewStream: async () => {
        const { browserVideoConstraints, desktopMandatoryConstraints } =
          screenShareVideoConstraints(currentScreenQuality);
        return getCustomPickerDesktopStream({
          sourceId: src!.sourceId!,
          captureId: src!.captureId ?? undefined,
          sourceKind: src!.sourceKind ?? undefined,
          withAudio: false,
          videoConstraints: browserVideoConstraints,
          desktopMandatoryConstraints,
        });
      },
    });

    if (outcome.openedStream && outcome.stream && capture) {
      // Closing the source still ends the share.
      attachScreenPreview(capture, outcome.stream, (ended) =>
        share?.captureEnded(ended),
      );
    } else if (outcome.reopenFailed) {
      // Non-fatal; stay hidden if re-open fails.
      previewLog.warn("Failed to re-open preview stream");
    }
    voiceDispatch({
      type: "SET_PREVIEW_HIDDEN",
      payload: outcome.isPreviewHidden,
      stream: outcome.stream,
    });
  }, [
    existingScreenShare,
    isPreviewHidden,
    isScreenSharing,
    currentScreenSource,
    currentScreenQuality,
    isHookActive,
    localScreenStream,
  ]);

  const onToggleAlwaysShowStreamPreview = useCallback(() => {
    const nextAlwaysShowStreamPreview = !alwaysShowStreamPreview;
    updateUserSettings(
      (current) => ({
        ...current,
        alwaysShowStreamPreview: nextAlwaysShowStreamPreview,
      }),
      settingsUserId,
    );

    if (nextAlwaysShowStreamPreview && isScreenSharing && isPreviewHidden) {
      void Promise.resolve(togglePreviewHidden()).catch((error) => {
        previewLog.warn(
          "Failed to resume preview after enabling Always Show Stream Preview",
          error,
        );
      });
    }
  }, [
    alwaysShowStreamPreview,
    updateUserSettings,
    settingsUserId,
    isScreenSharing,
    isPreviewHidden,
    togglePreviewHidden,
  ]);

  // Browser shares flip their audio track in place; a native share restarts
  // its pipeline with the flag flipped (serialized, latest wins). Nothing
  // to do without a share.
  const onToggleStreamAudio = useCallback(async () => {
    const share = existingScreenShare(sfuRef.current);
    if (!share) return;
    share.toggleAudio();
    await share.idle();
  }, [existingScreenShare]);

  const onToggleWatch = useCallback((streamerUserId: string) => {
    const nextWatching = !watchedStreamsRef.current[streamerUserId];
    const nextWatchedStreams = nextWatching
      ? { ...watchedStreamsRef.current, [streamerUserId]: true }
      : Object.fromEntries(
          Object.entries(watchedStreamsRef.current).filter(
            ([userId]) => userId !== streamerUserId,
          ),
        );

    pendingWatchIntentsRef.current = {
      ...pendingWatchIntentsRef.current,
      [streamerUserId]: nextWatching,
    };
    voiceDispatch({
      type: "SET_WATCHED",
      payload: nextWatchedStreams,
    });
    watchedStreamsRef.current = nextWatchedStreams;
    sfuRef.current?.voiceGW.sendAppEvent({
      type: nextWatching ? "stream.watch.start" : "stream.watch.stop",
      streamer_user_id: streamerUserId,
    });
  }, []);

  const setFocusedId = useCallback((id: string | null) => {
    voiceDispatch({ type: "SET_FOCUSED", payload: id });
  }, []);

  const tileStreamThumbnails = useMemo(
    () =>
      resolveStreamThumbnails(
        streamThumbnails,
        mode !== "room" && channelId
          ? (voiceChannelStates[channelId] ?? [])
          : [],
        user?.id,
      ),
    [streamThumbnails, mode, channelId, voiceChannelStates, user?.id],
  );

  const gridItems = useMemo(() => {
    const items: GridItem[] = [];

    // For voice channels, use gateway-tracked members.
    // For calls, use the SFU's own participant map combined with gateway VCS for calls.
    const vcMembers =
      mode !== "room" && channelId ? (voiceChannelStates[channelId] ?? []) : [];
    const localName =
      mode === "room"
        ? guestName || "You"
        : chatUserDisplayName?.trim() ||
          chatUsername ||
          user?.username ||
          "You";

    if (joined) {
      items.push({
        id: `local-camera-${myIdRef.current}`,
        userId: user?.id || myIdRef.current,
        name: localName,
        avatar: chatUserAvatarUrl || user?.image || undefined,
        avatarDisplay: chatUserAvatarDisplay,
        stream: localStreamRef.current,
        isLocal: true,
        type: isCameraOn ? "camera" : "avatar",
        isStreaming: false,
        isMuted: !isMicOn,
        isDeafened: isDeafened,
        // Speaking is not part of the tile model: a flip would rebuild every
        // tile. Leaves read useIsSpeaking(userId) / useSpeakingAttr(userId).
      });

      if (isScreenSharing) {
        // For CEF screen share: localScreenStream has live tracks → render the preview.
        // For native HW share: localScreenStream is null (no CEF MediaStream) → still
        //   add the tile so the UI shows a "Sharing" placeholder.
        const localScreenHasTracks =
          !!localScreenStream &&
          localScreenStream
            .getTracks()
            .some((t: MediaStreamTrack) => t.readyState === "live");
        items.push({
          id: `local-screen-${myIdRef.current}`,
          userId: user?.id || myIdRef.current,
          name: localName,
          avatar: chatUserAvatarUrl || user?.image || undefined,
          avatarDisplay: chatUserAvatarDisplay,
          stream: localScreenHasTracks ? localScreenStream : null,
          isLocal: true,
          type: "screen",
          isStreaming: true,
          isMuted: false,
          isDeafened: false,
        });
      }
    }

    // ── Shared helpers ─────────────────────────────────────────────────

    /** Resolve remote user's media streams, falling back to UUID-keyed entries */
    const resolveStreams = (appUserId: string): Record<string, MediaStream> => {
      let streams = remoteStreams[appUserId] || {};
      if (Object.keys(streams).length === 0) {
        for (const [uuid, cId] of uuidToUserIdRef.current.entries()) {
          if (cId === appUserId && remoteStreams[uuid]) {
            streams = remoteStreams[uuid] as any;
            break;
          }
        }
      }
      return streams as Record<string, MediaStream>;
    };

    /** Sync aggregator MediaStreams for cam/screen tracks, returns { cam, screen } */
    const syncAggregator = (
      appUserId: string,
      userStreams: Record<string, MediaStream>,
    ) => {
      if (!remoteAggregatorsRef.current[appUserId]) {
        remoteAggregatorsRef.current[appUserId] = {
          cam: new MediaStream(),
          screen: new MediaStream(),
        };
      }
      const agg = remoteAggregatorsRef.current[appUserId];
      const sync = (type: "cam" | "screen", prefix: string) => {
        const targetTracks = new Set<MediaStreamTrack>();
        Object.entries(userStreams).forEach(([name, s]) => {
          if (name.startsWith(prefix))
            s.getTracks().forEach((t) => targetTracks.add(t));
        });
        const currentTracks = agg[type].getTracks();
        let changed = currentTracks.length !== targetTracks.size;
        if (!changed) {
          for (const t of currentTracks) {
            if (!targetTracks.has(t)) {
              changed = true;
              break;
            }
          }
        }
        if (changed) {
          agg[type] = new MediaStream(Array.from(targetTracks));
        }
      };
      sync("cam", "cam-");
      sync("screen", "screen-");
      return agg;
    };

    // ── Build normalized remote participant list ──────────────────────

    interface RemoteInfo {
      appUserId: string;
      name: string;
      avatar?: string;
      avatarDisplay?:
        | import("@/lib/avatar-display").AvatarDisplay
        | string
        | null;
      isCameraOn: boolean;
      isStreaming: boolean;
      selfMute: boolean;
      selfDeaf: boolean;
    }

    const remotes: RemoteInfo[] = [];

    // All Voice Channels (and DM calls): derive from gateway member list first
    // This ensures presence is visible immediately even before the SFU connects
    vcMembers.forEach((m) => {
      if (m.user_id === user?.id) return;
      // find their SFU participant info if they have joined the SFU
      const pId = Array.from(uuidToUserIdRef.current.entries()).find(
        ([, cId]) => cId === m.user_id,
      )?.[0];
      const p = pId ? participantsRef.current.get(pId) : null;
      // Gateway presence is canonical once available; SFU data is only a
      // fallback for participants not represented in the gateway state.
      const identity = resolveVoiceIdentity({
        name: m.name,
        username: m.username,
        display_name: m.display_name,
        avatar_url: m.avatar_url ?? null,
        avatar_display: m.avatar_display ?? null,
      });
      remotes.push({
        appUserId: m.user_id,
        name: identity.name,
        avatar: identity.avatarUrl ?? undefined,
        avatarDisplay: identity.avatarDisplay,
        isCameraOn: m.self_video || !!p?.self_video,
        isStreaming: m.self_stream || !!p?.self_stream,
        selfMute: m.self_mute,
        selfDeaf: m.self_deaf || false,
      });
    });

    // Supplement with directly-connected SFU participants who might be missing
    // from the Gateway state (e.g. DM Calls where `VOICE_CHANNEL_STATES` isn't fully broadcast)
    for (const [pId, appUserId] of uuidToUserIdRef.current.entries()) {
      if (pId === myIdRef.current) continue;
      if (appUserId === user?.id) continue;
      if (remotes.some((r) => r.appUserId === appUserId)) continue;

      const p = participantsRef.current.get(pId);
      if (!p) continue;

      const identity = resolveVoiceIdentity({
        name: p.name,
        username: p.username,
        display_name: p.display_name,
        avatar_url: p.avatar_url ?? null,
        avatar_display: p.avatar_display ?? null,
      });

      remotes.push({
        appUserId,
        name: identity.name,
        avatar: identity.avatarUrl ?? undefined,
        avatarDisplay: identity.avatarDisplay,
        isCameraOn: !!p.self_video,
        isStreaming: !!p.self_stream,
        selfMute: !!p.self_mute,
        selfDeaf: !!p.self_deaf,
      });
    }

    // ── Build grid items from normalized list ─────────────────────────

    for (const remote of remotes) {
      const peerSetting = peerSettings[remote.appUserId];
      const userStreams = resolveStreams(remote.appUserId);
      const agg = syncAggregator(remote.appUserId, userStreams);
      const hasScreenTracks = agg.screen
        .getTracks()
        .some((t) => t.readyState === "live");

      items.push({
        id: `remote-camera-${remote.appUserId}`,
        userId: remote.appUserId,
        name: remote.name,
        avatar: remote.avatar,
        avatarDisplay: remote.avatarDisplay,
        stream: agg.cam.getTracks().length > 0 ? agg.cam : null,
        isLocal: false,
        type: remote.isCameraOn ? "camera" : "avatar",
        isStreaming: false,
        isMuted: remote.selfMute || !!(peerSetting as any)?.muted,
        isDeafened: remote.selfDeaf,
        // See the local tile: leaves read useIsSpeaking(userId).
      });

      if (remote.isStreaming || hasScreenTracks) {
        items.push({
          id: `remote-screen-${remote.appUserId}`,
          userId: remote.appUserId,
          name: `${remote.name}'s Stream`,
          avatar: remote.avatar,
          avatarDisplay: remote.avatarDisplay,
          stream: agg.screen.getTracks().length > 0 ? agg.screen : null,
          isLocal: false,
          type: "screen",
          isStreaming: true,
          isMuted: false,
          isDeafened: false,
        });
      }
    }

    return items;
    // Ref-backed SFU participants need this revision to invalidate the snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    joined,
    user,
    guestName,
    chatUserAvatarUrl,
    chatUserAvatarDisplay,
    chatUserDisplayName,
    chatUsername,
    isMicOn,
    isDeafened,
    isScreenSharing,
    localScreenStream,
    remoteStreams,
    voiceChannelStates,
    channelId,
    peerSettings,
    isCameraOn,
    participantsVersion,
    mode,
  ]);

  const localWatcherUserId =
    mode === "room" ? myIdRef.current || null : user?.id || null;
  const watchersByStreamer = useMemo(
    () =>
      buildStreamWatcherIdentities(
        streamWatcherIdsByStreamer,
        gridItems,
        localWatcherUserId,
      ),
    [streamWatcherIdsByStreamer, gridItems, localWatcherUserId],
  );

  const applySpatialAudio = useCallback(
    (state: SharedSpatialAudioState, enabledForLocal: boolean) => {
      const sfu = sfuRef.current;
      if (!sfu) return;
      const participants = [
        { userId: user?.id || myIdRef.current },
        ...remoteSpatialParticipants(gridItems),
      ].filter((p) => p.userId);
      const positions = calculateSpatialPositions(participants, state);
      for (const [uuid, appUserId] of uuidToUserIdRef.current.entries()) {
        if (uuid === myIdRef.current || appUserId === user?.id) continue;
        const peerPosition = positions[appUserId];
        const selfPosition = positions[user?.id || myIdRef.current] ?? {
          x: 50,
          y: 78,
        };
        const settings: any = peerSettings[appUserId] || {
          volume: 100,
          muted: false,
        };
        const isPeerSilenced = isDeafened || settings.muted;
        const baseVolume = isPeerSilenced ? 0 : settings.volume / 100;
        const mix = enabledForLocal
          ? calculateSpatialAudioMix(selfPosition, peerPosition, state.roomSize)
          : { pan: 0, gain: 1 };
        sfu.setTrackPan(uuid, `cam-audio-${uuid}`, mix.pan);
        sfu.setTrackVolume(uuid, `cam-audio-${uuid}`, baseVolume * mix.gain);
      }
    },
    [gridItems, isDeafened, peerSettings, user?.id],
  );

  useEffect(() => {
    const enabledForLocal =
      !!spatialAudioState.enabled &&
      spatialAudioEnabled &&
      streamHighFidelity &&
      !isDeafened;
    applySpatialAudio(spatialAudioState, enabledForLocal);
  }, [
    spatialAudioState,
    spatialAudioEnabled,
    streamHighFidelity,
    isDeafened,
    applySpatialAudio,
  ]);

  const updateSharedSpatialAudioState = useCallback(
    (next: SharedSpatialAudioState) => {
      const normalized = normalizeSpatialState(next);
      voiceDispatch({ type: "SET_SPATIAL_AUDIO_STATE", payload: normalized });
      sendVoiceStateUpdate({
        spatial_audio_enabled: normalized.enabled,
        spatial_audio_high_fidelity: streamHighFidelity,
        spatial_audio_state: normalized,
      });
    },
    [sendVoiceStateUpdate, streamHighFidelity],
  );

  return {
    joined,
    isScreenSharing,
    isPreviewHidden,
    isStreamingAudio,
    currentScreenQuality,
    currentScreenSource,
    isCameraActive,
    connectionState,
    focusedId,
    setFocusedId,
    watchedStreams,
    watchersByStreamer,
    streamThumbnails: tileStreamThumbnails,
    gridItems,
    audioBlocked,
    setAudioBlocked: (blocked: boolean) =>
      voiceDispatch({ type: "SET_AUDIO_BLOCKED", payload: blocked }),
    handleJoin,
    prefetchJoin,
    handleLeave,
    toggleMic,
    toggleDeafen,
    toggleCamera,
    toggleScreenShare,
    onToggleStreamAudio,
    togglePreviewHidden,
    alwaysShowStreamPreview,
    onToggleAlwaysShowStreamPreview,
    onToggleWatch,
    currentSettings: {
      isMuted: settingsMuted,
      isDeafened: settingsDeafened,
      peerSettings,
    },
    isMicOn,
    isDeafened,
    isCameraOn,
    vcMembers:
      mode !== "room" && channelId ? (voiceChannelStates[channelId] ?? []) : [],
    hasMicrophone,
    hasCamera,
    sfu: sfuInstance,
    settingsUserId,
    audioStalled,
    spatialAudioState,
    updateSharedSpatialAudioState,
    roomSlug: resolvedRoomSlug || null,
    voiceSessionId: myIdRef.current || null,
  };
}
