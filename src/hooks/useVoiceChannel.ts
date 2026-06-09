import { GridItem } from "@/components/voice/types";
import { clog } from "@/lib/console-logger";
import { acquireLocalStream, releaseLocalStream, startEarlyMic } from "@/lib/local-media-manager";
import { isDesktop, isWgcCaptureAllowed } from "@/lib/platform";
import type { ScreenShareOptions } from "@/lib/screen-share-types";
import { SFUClient } from "@/lib/sfu-client";
import {
  DEFAULT_SHARED_SPATIAL_STATE,
  calculateSpatialAudioMix,
  calculateSpatialPositions,
  normalizeSpatialState,
  remoteSpatialParticipants,
  type SharedSpatialAudioState,
} from "@/lib/voice/spatial-audio";
import {
  playConnected,
  playDeafen,
  playDisconnect,
  playMute,
  playScreenShareStart,
  playScreenShareStop,
  playUndeafen,
  playUnmute,
} from "@/lib/sounds";
import type { VoiceState } from "@/lib/types";
import { useMediaDevices } from "@/lib/useMediaDevices";
import { useChatActions, useChatStore } from "@/stores/chat-store";
import { useSoundSettingsStore } from "@/stores/useSoundSettingsStore";
import { useVoiceSettingsStore } from "@/stores/useVoiceSettingsStore";
import { useUser } from "@kova/react";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useShallow } from "zustand/shallow";
import type { ScreenShareSourceState } from "@/lib/screen-share-types";
import { useNativeShareStats } from "@/hooks/useNativeShareStats";

const vcLog = clog("VoiceChannel");
const screenLog = clog("ScreenShare");
const devicesLog = clog("Voice:Devices");
const previewLog = clog("Preview");

const SCREEN_QUALITY_MAP: Record<string, { width: number; height: number; bitrate: number }> = {
  "720p": { width: 1280, height: 720, bitrate: 5_000_000 },
  "1080p": { width: 1920, height: 1080, bitrate: 8_000_000 },
  "1440p": { width: 2560, height: 1440, bitrate: 14_000_000 },
  "4k": { width: 3840, height: 2160, bitrate: 24_000_000 },
};

function getScreenQualitySettings(quality: string) {
  const fps = quality.endsWith("60") ? 60 : 30;
  const resKey = quality.replace(/\d+$/, "");
  const res = SCREEN_QUALITY_MAP[resKey];
  return { fps, res };
}

function desktopCaptureSourceId(sourceId: string, sourceKind?: "window" | "monitor" | "device") {
  if (sourceKind === "window" && sourceId.startsWith("window-")) {
    return `window:${sourceId.slice("window-".length)}:0`;
  }

  if (sourceKind === "monitor" && sourceId.startsWith("monitor-")) {
    return `screen:${sourceId.slice("monitor-".length)}:0`;
  }

  return null;
}

export async function getCustomPickerDesktopStream(options: {
  sourceId?: string;
  captureId?: string;
  sourceKind?: "window" | "monitor" | "device";
  withAudio: boolean;
  videoConstraints: MediaTrackConstraints;
  desktopMandatoryConstraints: Record<string, unknown>;
}): Promise<MediaStream | null> {
  if (!options.sourceId) return null;

  if (options.sourceKind === "device") {
    return navigator.mediaDevices.getUserMedia({
      video: {
        deviceId: { exact: options.sourceId },
        ...options.videoConstraints,
      },
      audio: false,
    });
  }

  const chromeMediaSourceId = options.captureId ?? desktopCaptureSourceId(options.sourceId, options.sourceKind);
  if (!chromeMediaSourceId) return null;

  const constraints: MediaStreamConstraints = {
    video: {
      mandatory: {
        chromeMediaSource: "desktop",
        chromeMediaSourceId,
        ...options.desktopMandatoryConstraints,
      },
    } as MediaTrackConstraints,
    audio: false,
  };

  if (options.withAudio && options.sourceKind === "monitor") {
    constraints.audio = {
      mandatory: {
        chromeMediaSource: "desktop",
        chromeMediaSourceId,
      },
    } as MediaTrackConstraints;
  }

  return navigator.mediaDevices.getUserMedia(constraints);
}

function screenShareVideoConstraints(quality: string) {
  const { fps, res } = getScreenQualitySettings(quality);
  const browserVideoConstraints = {
    ...(res ? { width: { ideal: res.width }, height: { ideal: res.height } } : {}),
    frameRate: { ideal: fps, max: fps },
    cursor: "always",
  } as MediaTrackConstraints;

  const desktopMandatoryConstraints: Record<string, unknown> = {
    maxFrameRate: fps,
    cursor: "always",
  };

  if (res) {
    desktopMandatoryConstraints.maxWidth = res.width;
    desktopMandatoryConstraints.maxHeight = res.height;
  }

  return { fps, res, browserVideoConstraints, desktopMandatoryConstraints };
}

/** Whether a screen share is driven by the native hardware pipeline or by CEF. */
export type ScreenSharePreviewKind = "native" | "cef";

export interface PreviewStartDecision {
  /** Initial `isPreviewHidden` value for the session. */
  isPreviewHidden: boolean;
  /** Whether a CEF preview capture session should be opened for the shared source. */
  openCefPreview: boolean;
}

/**
 * Pure decision for the initial Local_Preview state when a screen share starts.
 *
 * Native (hardware) shares default to PAUSED so a second WGC/getDisplayMedia
 * session is not opened on the same source, which would add capture overhead
 * (Req 5.1). CEF (non-native) shares keep the existing default of showing the
 * preview (Req 5.4). The resume control later reopens the preview through the
 * existing `togglePreviewHidden` flow (Req 5.3).
 *
 * Preview is paused (and no CEF preview session is opened) if and only if the
 * share is native — this is the property-tested invariant (Property 9).
 */
export function resolvePreviewStartState(kind: ScreenSharePreviewKind): PreviewStartDecision {
  const isNative = kind === "native";
  return {
    isPreviewHidden: isNative,
    openCefPreview: !isNative,
  };
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

/**
 * Pure resume decision for the `togglePreviewHidden` un-hide path (Req 5.3).
 *
 * When the share is native and the source is known (`canReopenNativePreview`),
 * the existing flow reopens the CEF preview for that source via the injected
 * `openPreviewStream` opener. On success the preview is shown with the new
 * stream; on failure it stays paused. For a non-native (CEF) share the existing
 * `screenStreamRef` stream is restored without opening anything new.
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
  /** Existing CEF stream to fall back to for non-native shares. */
  cefFallbackStream: MediaStream | null;
}): Promise<PreviewResumeOutcome> {
  if (args.canReopenNativePreview) {
    try {
      const stream = await args.openPreviewStream();
      return { isPreviewHidden: false, stream, openedStream: true, reopenFailed: false };
    } catch {
      return { isPreviewHidden: true, stream: null, openedStream: false, reopenFailed: true };
    }
  }
  return {
    isPreviewHidden: false,
    stream: args.cefFallbackStream,
    openedStream: false,
    reopenFailed: false,
  };
}

function describeVideoTrack(track?: MediaStreamTrack) {
  if (!track) return null;
  const settings = track.getSettings();
  return {
    id: track.id,
    label: track.label,
    readyState: track.readyState,
    muted: track.muted,
    width: settings.width,
    height: settings.height,
    frameRate: settings.frameRate,
    displaySurface: (settings as MediaTrackSettings & { displaySurface?: string }).displaySurface,
    deviceId: settings.deviceId,
  };
}

function describeAudioTrack(track?: MediaStreamTrack) {
  if (!track) return null;
  const settings = track.getSettings();
  return {
    id: track.id,
    label: track.label,
    readyState: track.readyState,
    muted: track.muted,
    deviceId: settings.deviceId,
    sampleRate: (settings as MediaTrackSettings & { sampleRate?: number }).sampleRate,
    channelCount: (settings as MediaTrackSettings & { channelCount?: number }).channelCount,
  };
}

function logScreenShare(message: string, details?: unknown) {
  if (details === undefined) {
    screenLog.info(message);
    return;
  }
  try {
    screenLog.info(`${message} ${JSON.stringify(details, (_key, value) => {
      if (value instanceof Error) {
        return {
          name: value.name,
          message: value.message,
          stack: value.stack,
        };
      }
      return value;
    })}`);
  } catch {
    screenLog.info(message, details);
  }
}

async function probeNativeHardwareEncoders() {
  if (!isDesktop()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke("probe_hardware_video_encoders");
  } catch (error) {
    return { error };
  }
}

function hasNativeH264HardwareEncoder(probe: unknown) {
  return Array.isArray((probe as { h264?: unknown[] } | null)?.h264)
    && ((probe as { h264?: unknown[] }).h264?.length ?? 0) > 0;
}

async function applyScreenTrackQuality(
  stream: MediaStream | null,
  quality: string,
  sfu: SFUClient | null,
  participantId: string | null,
) {
  const videoTrack = stream?.getVideoTracks()[0];
  if (!videoTrack) return;

  const { fps, res } = getScreenQualitySettings(quality);
  if (res) {
    logScreenShare("Applying screen quality", {
      quality,
      requested: { width: res.width, height: res.height, fps, bitrate: res.bitrate },
      before: describeVideoTrack(videoTrack),
    });
    await videoTrack.applyConstraints({
      width: { ideal: res.width, max: res.width },
      height: { ideal: res.height, max: res.height },
      frameRate: { ideal: fps, max: fps },
    }).catch((err) => {
      screenLog.warn("Failed to apply video constraints:", err);
    });
    logScreenShare("Applied screen quality", {
      quality,
      after: describeVideoTrack(videoTrack),
      constraints: videoTrack.getConstraints?.(),
    });
  }

  if (!sfu || !participantId) return;

  await sfu.updateSenderEncoding(`screen-video-${participantId}`, {
    maxBitrate: res?.bitrate,
    maxFramerate: fps,
    scaleResolutionDownBy: 1,
  }).catch((err) => {
    screenLog.warn("Failed to update sender encoding:", err);
  });
  logScreenShare("Updated sender encoding", {
    trackName: `screen-video-${participantId}`,
    quality,
    maxBitrate: res?.bitrate,
    maxFramerate: fps,
  });
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
  const { voiceChannelStates, voiceChannelSpatialAudioStates, chatUserAvatarUrl, chatConnected, voiceChannelStartedAt } = useChatStore(useShallow(s => ({
    voiceChannelStates: s.voiceChannelStates,
    voiceChannelSpatialAudioStates: s.voiceChannelSpatialAudioStates,
    chatUserAvatarUrl: s.user?.avatar_url,
    chatConnected: s.connected,
    voiceChannelStartedAt: s.voiceChannelStartedAt,
  })));
  const { sendVoiceChannelJoin, sendVoiceChannelLeave, sendVoiceStateUpdate, setSpeakingUsers } = useChatActions();
  const currentVoiceChannelStartedAt = channelId ? voiceChannelStartedAt[channelId] ?? null : null;

  const [voiceState, voiceDispatch] = useReducer((state: any, action: any) => {
    switch (action.type) {
      case 'JOINED': return { ...state, joined: true, connectionState: 'connected' };
      case 'LEFT': return {
        ...state,
        joined: false,
        connectionState: 'disconnected',
        localScreenStream: null,
        isScreenSharing: false,
        isStreamingAudio: false,
        isPreviewHidden: false,
        speakingUsers: {},
        watchedStreams: {},
        streamThumbnails: {},
        remoteStreams: {},
        participantsVersion: 0,
        participants: [],
        audioStalled: false,
      };
      case 'SET_CONNECTION': return { ...state, connectionState: action.payload };
      case 'SET_SCREEN_SHARING': return { ...state, isScreenSharing: action.payload, localScreenStream: action.stream, isStreamingAudio: action.audio ?? state.isStreamingAudio };
      case 'SET_PREVIEW_HIDDEN': return { ...state, isPreviewHidden: action.payload, localScreenStream: action.stream !== undefined ? action.stream : state.localScreenStream };
      case 'SET_SCREEN_SOURCE': return { ...state, currentScreenSource: action.payload };
      case 'SET_CAMERA': return { ...state, isCameraActive: action.payload };
      case 'SET_FOCUSED': return { ...state, focusedId: action.payload };
      case 'SET_AUDIO_BLOCKED': return { ...state, audioBlocked: action.payload };
      case 'SET_SPEAKING': {
        const next = typeof action.payload === 'function' ? action.payload(state.speakingUsers) : action.payload;
        return { ...state, speakingUsers: next };
      }
      case 'SET_WATCHED': {
        const next = typeof action.payload === 'function' ? action.payload(state.watchedStreams) : action.payload;
        return { ...state, watchedStreams: next };
      }
      case 'UPDATE_REMOTE_STREAMS': {
        const next = typeof action.payload === 'function' ? action.payload(state.remoteStreams) : action.payload;
        return { ...state, remoteStreams: next };
      }
      case 'SET_THUMBNAILS': {
        const next = typeof action.payload === 'function' ? action.payload(state.streamThumbnails) : action.payload;
        return { ...state, streamThumbnails: next };
      }
      case 'SET_PARTICIPANTS': {
        const next = typeof action.payload === 'function' ? action.payload(state.participants) : action.payload;
        return { ...state, participants: next };
      }
      case 'SET_AUDIO_STALLED': return { ...state, audioStalled: action.payload };
      case 'SET_SPATIAL_AUDIO_STATE': return { ...state, spatialAudioState: action.payload };
      case 'SET_SCREEN_QUALITY': return { ...state, currentScreenQuality: action.payload };
      case 'BUMP_PARTICIPANTS': return { ...state, participantsVersion: (state.participantsVersion ?? 0) + 1 };
      default: return state;
    }
  }, {
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
    streamThumbnails: {},
    audioBlocked: false,
    remoteStreams: {},
    participantsVersion: 0,
    participants: [],
    audioStalled: false,
    spatialAudioState: DEFAULT_SHARED_SPATIAL_STATE,
  });

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
    streamThumbnails,
    audioBlocked,
    remoteStreams,
    participantsVersion,
    participants,
    audioStalled,
    spatialAudioState,
  } = voiceState;

  const { isHookActive } = useNativeShareStats();

  // Sync local speaking state to the global chat context
  useEffect(() => {
    // console.log("[useVoiceChannel] Syncing speakingUsers to global context:", speakingUsers);
    setSpeakingUsers(speakingUsers);
  }, [speakingUsers, setSpeakingUsers]);

  // Keep the synchronous source ref in lockstep with the reactive state so
  // imperative callbacks (toggleScreenShare) can re-target the active source.
  useEffect(() => {
    currentScreenSourceRef.current = currentScreenSource ?? null;
  }, [currentScreenSource]);

  // Clean up global speaking state on unmount
  useEffect(() => {
    return () => setSpeakingUsers({});
  }, [setSpeakingUsers]);

  const sfuRef = useRef<SFUClient | null>(null);
  // Tracks whether auto-join has already fired for the current autoJoin=true
  // activation. Prevents re-joining immediately after an explicit handleLeave()
  // while the URL (and therefore autoJoin prop) still points at a voice channel.
  // Reset whenever autoJoin transitions false→true (e.g. user navigates away
  // and comes back to the voice channel via the sidebar).
  const hasAutoJoined = useRef(false);
  const autoJoinTargetRef = useRef<string | null>(null);
  // sfuInstance is reactive state that mirrors sfuRef — changing sfuRef.current
  // does NOT trigger re-renders, so consumers (CalLVoiceManager's sync effect,
  // useVoiceStats, etc.) would never see the non-null value. This state field
  // is the one returned from the hook; sfuRef is used for all imperative calls.
  const [sfuInstance, setSfuInstance] = useState<SFUClient | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const participantsRef = useRef<Map<string, VoiceState>>(new Map());
  const remoteAggregatorsRef = useRef<Record<string, { cam: MediaStream; screen: MediaStream }>>({});
  const capturingThumbnails = useRef<Set<string>>(new Set());
  const thumbnailCaptureRefs = useRef<Record<string, { video: HTMLVideoElement; canvas: HTMLCanvasElement; timeoutId: number | null }>>({});
  const watchedStreamsRef = useRef<Record<string, boolean>>({});
  const focusedIdRef = useRef<string | null>(null);

  const myIdRef = useRef<string>("");
  const uuidToClerkRef = useRef<Map<string, string>>(new Map());
  // Mirrors `currentScreenSource` for synchronous reads inside imperative
  // callbacks (toggleScreenShare) without adding it to their dependency arrays.
  // Lets a mid-share quality/audio change re-target the SAME source instead of
  // falling through to a fresh getDisplayMedia capture (which would break a
  // live native hardware share).
  const currentScreenSourceRef = useRef<ScreenShareSourceState | null>(null);
  const { hasMicrophone, hasCamera } = useMediaDevices();

  const settingsUserId = mode === "room" ? `room-${user?.id || "guest"}` : (user?.id || "guest");
  const { isMuted: settingsMuted, isDeafened: settingsDeafened, inputDeviceId, inputDeviceLabel, inputDeviceGroupId, videoDeviceId, videoDeviceLabel, videoDeviceGroupId, noiseSuppression, echoCancellation, autoSensitivity, sensitivity, streamHighFidelity, outputVolume, outputDeviceId, spatialAudioEnabled } = useVoiceSettingsStore(useShallow(s => {
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
      noiseSuppression: st.noiseSuppression,
      echoCancellation: st.echoCancellation,
      autoSensitivity: st.autoSensitivity,
      sensitivity: st.sensitivity,
      streamHighFidelity: st.streamHighFidelity,
      spatialAudioEnabled: st.spatialAudioEnabled,
      outputVolume: st.outputVolume,
      outputDeviceId: st.outputDeviceId,
    };
  }));

  const setCurrentUser = useVoiceSettingsStore(s => s.setCurrentUser);
  const setIsMuted = useVoiceSettingsStore(s => s.setIsMuted);
  const setIsDeafened = useVoiceSettingsStore(s => s.setIsDeafened);
  const setDevice = useVoiceSettingsStore(s => s.setDevice);

  const peerSettings = useVoiceSettingsStore(s => s.getSettings(settingsUserId).peerSettings);

  const bandwidthPeerSettings = useMemo(() => {
    const map: Record<string, boolean> = {};
    Object.entries(peerSettings).forEach(([id, p]) => {
      if ((p as any).alwaysHear) map[id] = true;
    });
    return map;
  }, [peerSettings]);

  const currentSettingsRef = useRef({ isMuted: settingsMuted, isDeafened: settingsDeafened, peerSettings });
  useEffect(() => {
    currentSettingsRef.current = { isMuted: settingsMuted, isDeafened: settingsDeafened, peerSettings };
  }, [settingsMuted, settingsDeafened, peerSettings]);

  useEffect(() => { watchedStreamsRef.current = watchedStreams; }, [watchedStreams]);
  useEffect(() => { focusedIdRef.current = focusedId; }, [focusedId]);

  const isMicOn = !settingsMuted && hasMicrophone;
  const isDeafened = settingsDeafened;
  const isCameraOn = isCameraActive && hasCamera;

  useEffect(() => {
    if (user?.id) setCurrentUser(user.id);
  }, [user?.id, setCurrentUser]);

  useEffect(() => {
    if (!sfuRef.current) return;
    const uuidMap = uuidToClerkRef.current;

    for (const [uuid, clerkId] of uuidMap.entries()) {
      const channelMembers = (mode !== "room" && channelId) ? voiceChannelStates[channelId] : undefined;
      const peer = channelMembers?.find((m: any) => m.clerk_user_id === clerkId);
      const settings: any = peerSettings[clerkId] || { volume: 100, muted: false, alwaysHear: false };

      const isPeerSilenced = isDeafened || settings.muted || (peer?.self_mute || peer?.self_deaf);
      const finalVolume = isPeerSilenced ? 0 : (settings.volume / 100);

      sfuRef.current?.setParticipantVolume(uuid, finalVolume);

      // Re-apply screen-audio volume override — setParticipantVolume
      // sets ALL GainNodes (including screen-audio) to the same volume.
      // Screen-audio should only be audible when focused or alwaysHear.
      const alwaysHearPeer = !!settings.alwaysHear;
      const isFocusedPeer = focusedId === `remote-screen-${clerkId}` || focusedId === `remote-camera-${clerkId}`;
      const wantsScreenAudio = isFocusedPeer || alwaysHearPeer;
      sfuRef.current?.setTrackVolume(uuid, `screen-audio-${uuid}`, wantsScreenAudio ? finalVolume : 0);
    }
  }, [peerSettings, isDeafened, joined, voiceChannelStates, channelId, focusedId]);

  useEffect(() => {
    if (!joined) return;
    const nextSpatialAudioState = normalizeSpatialState({
      ...spatialAudioState,
      enabled: spatialAudioEnabled,
      updatedAt: Date.now(),
    });
    voiceDispatch({ type: 'SET_SPATIAL_AUDIO_STATE', payload: nextSpatialAudioState });
    sendVoiceStateUpdate({
      spatial_audio_enabled: spatialAudioEnabled,
      spatial_audio_high_fidelity: streamHighFidelity,
      spatial_audio_state: nextSpatialAudioState,
    });
  }, [joined, spatialAudioEnabled, streamHighFidelity, sendVoiceStateUpdate]);

  useEffect(() => {
    if (!channelId) return;
    const shared = voiceChannelSpatialAudioStates[channelId];
    if (shared && shared.updatedAt !== spatialAudioState.updatedAt) {
      voiceDispatch({ type: 'SET_SPATIAL_AUDIO_STATE', payload: normalizeSpatialState(shared) });
    }
  }, [channelId, voiceChannelSpatialAudioStates, spatialAudioState.updatedAt]);

  useEffect(() => {
    const resume = () => {
      sfuRef.current?.resumeAudioContext();
      voiceDispatch({ type: 'SET_AUDIO_BLOCKED', payload: false });
    };
    window.addEventListener("click", resume, { once: true });
    window.addEventListener("keydown", resume, { once: true });

    const sfu = sfuRef.current;
    if (sfu) {
      sfu.on("audio-resumed", () => voiceDispatch({ type: 'SET_AUDIO_BLOCKED', payload: false }));
    }

    return () => {
      window.removeEventListener("click", resume);
      window.removeEventListener("keydown", resume);
    };
  }, []);

  useEffect(() => {
    if (!joined || !sfuRef.current) {
      voiceDispatch({ type: 'SET_AUDIO_BLOCKED', payload: false });
      return;
    }

    const check = () => {
      if (sfuRef.current?.audio.isAudioSuspended()) {
        voiceDispatch({ type: 'SET_AUDIO_BLOCKED', payload: true });
      }
    };

    const timer = setTimeout(check, 1000);
    return () => clearTimeout(timer);
  }, [joined]);

  useEffect(() => {
    if (!joined || !sfuRef.current) return;
    const sfu = sfuRef.current;

    const vcMembers = channelId ? (voiceChannelStates[channelId] ?? []) : [];
    const remoteMemberCount = Math.max(0, (isCall || mode === "room" ? Array.from(uuidToClerkRef.current.keys()).length : vcMembers.length) - 1);
    const isOnlyRemote = remoteMemberCount === 1;
    const localClerkId = user?.id;

    let hasRemoteSubs = false;
    for (const [uuid, clerkId] of uuidToClerkRef.current.entries()) {
      // Skip the local user — we never subscribe to our own tracks
      if (clerkId === localClerkId) continue;

      const isWatched = !!watchedStreams[clerkId];
      const alwaysHear = !!bandwidthPeerSettings[clerkId];
      const isFocused = focusedId === `remote-screen-${clerkId}` || focusedId === `remote-camera-${clerkId}`;
      const camRid = (isFocused || isOnlyRemote) ? "h" : "l";

      // Verify the user is still in the channel (voice channel or call/room)
      // For calls and rooms, we rely on SFU participants entirely rather than gateway presence
      const isStillInChannel = isCall || mode === "room" || vcMembers.some((m: any) => m.clerk_user_id === clerkId);
      if (!isStillInChannel) continue;

      hasRemoteSubs = true;
      // Screen-audio: keep transceiver ALWAYS active (recvonly). Audio is
      // ~20kbps — negligible bandwidth. Toggling the transceiver to inactive
      // and back deactivates the WebRTC media pipeline, causing the Web Audio
      // source to read silence even after reactivation. Instead, control
      // audibility purely through the GainNode volume.
      const wantsScreenAudio = isFocused || alwaysHear;
      sfu.setRemoteTrackSubscription(uuid, `screen-audio-${uuid}`, true);
      sfu.setTrackVolume(uuid, `screen-audio-${uuid}`, wantsScreenAudio ? 1.0 : 0);

      // Screen-video: when alwaysHear is on but not watching, don't pull
      // video bandwidth — only pull once the user clicks "Watch Stream".
      const wantsScreenVideo = alwaysHear ? isWatched : true;
      sfu.setRemoteTrackSubscription(uuid, `screen-video-${uuid}`, wantsScreenVideo, wantsScreenVideo ? "h" : undefined);
      sfu.setRemoteTrackSubscription(uuid, `cam-video-${uuid}`, true, camRid);
    }
    // Only pull when there are actual remote subscriptions to negotiate
    if (hasRemoteSubs) {
      sfu.pullTracks([]);
    }
  }, [watchedStreams, bandwidthPeerSettings, focusedId, voiceChannelStates, channelId, joined, isCall, participantsVersion]);

  const handleJoin = useCallback(async () => {
    if (sfuRef.current) {
      vcLog.warn("Already connecting or connected, skipping duplicate handleJoin");
      return;
    }

    vcLog.info("handleJoin invoked", {
      channelId,
      serverId,
      mode,
      autoJoin,
      joined,
      chatConnected,
      hasUser: !!user,
      voiceGateway: (sfuRef.current as SFUClient | null)?.voiceGW?.getDebugState?.(),
      roomGateway: (sfuRef.current as SFUClient | null)?.roomGW?.getDebugState?.(),
    });

    const chatUser = useChatStore.getState().user;
    const name = mode === "room" ? (guestName || "Guest") : (chatUser?.display_name || user?.username || user?.fullName || "Guest");
    const roomSlug = roomSlugOverride || `voice-${serverId}-${channelId}`;
    const sfu = new SFUClient(roomSlug);
    sfuRef.current = sfu;
    setSfuInstance(sfu);

    const rememberParticipant = (participant: VoiceState) => {
      participantsRef.current.set(participant.id, participant);
      if (participant.clerk_user_id && mode !== "room") {
        uuidToClerkRef.current.set(participant.id, participant.clerk_user_id);
        sfu.setClerkMapping(participant.id, participant.clerk_user_id);
      }
    };

    const upsertParticipant = (participant: VoiceState) => {
      rememberParticipant(participant);
      voiceDispatch({ type: 'BUMP_PARTICIPANTS' });
      voiceDispatch({
        type: 'SET_PARTICIPANTS',
        payload: (prev: VoiceState[]) => {
          const next = prev.filter(p => p.id !== participant.id);
          next.push(participant);
          return next;
        }
      });
    };

    const syncParticipants = (participants: VoiceState[]) => {
      const nextIds = new Set(participants.map(p => p.id));
      for (const [participantId] of participantsRef.current) {
        if (!nextIds.has(participantId)) {
          participantsRef.current.delete(participantId);
          uuidToClerkRef.current.delete(participantId);
          sfu.deleteClerkMapping(participantId);
        }
      }
      participants.forEach(rememberParticipant);
      voiceDispatch({ type: 'BUMP_PARTICIPANTS' });
      voiceDispatch({ type: 'SET_PARTICIPANTS', payload: participants });
    };

    // ── Eager mic acquisition (fire-and-forget, parallel with WS handshake) ──
    // LocalMediaManager.startEarlyMic() stores the in-flight promise so
    // acquireLocalStream() in swapDevices awaits it instead of a second call.
    const currentSettings = useVoiceSettingsStore.getState().getSettings(settingsUserId);
    const hiFi = currentSettings.streamHighFidelity;
    startEarlyMic({
      deviceId: currentSettings.inputDeviceId,
      deviceLabel: currentSettings.inputDeviceLabel,
      groupId: currentSettings.inputDeviceGroupId,
      noiseSuppression: hiFi ? false : currentSettings.noiseSuppression,
      echoCancellation: hiFi ? false : currentSettings.echoCancellation,
      autoGainControl: hiFi ? false : currentSettings.autoSensitivity,
      stereo: true,
    });

    sfu.on("joined", ({ participantId, participants, spatialAudioState: initialSpatialAudioState }: any) => {
      vcLog.info("SFU joined", {
        channelId,
        serverId,
        mode,
        participantId,
        participants: participants.length,
      });
      myIdRef.current = participantId;
      if (user?.id && mode !== "room") {
        uuidToClerkRef.current.set(participantId, user.id);
        sfu.setClerkMapping(participantId, user.id);
      }

      syncParticipants(participants);
      if (initialSpatialAudioState) {
        voiceDispatch({ type: 'SET_SPATIAL_AUDIO_STATE', payload: normalizeSpatialState(initialSpatialAudioState) });
      }

      // Bumping participants immediately correctly sets initial call participants
      voiceDispatch({ type: 'JOINED' });
      onJoined?.();

      // Play connected sound (skip for calls — gateway plays CALL_CONNECT instead)
      if (!isCall && useSoundSettingsStore.getState().getSettings()?.selfConnectDisconnect) {
        playConnected();
      }

      if (mode !== "room" && channelId) {
        sendVoiceChannelJoin(channelId, currentSettingsRef.current.isMuted, currentVoiceChannelStartedAt);
      }
    });

    sfu.on("participant-joined", ({ participant }) => {
      upsertParticipant(participant);

      if (mode === "room" && useSoundSettingsStore.getState().getSettings()?.voiceJoinLeave) {
        import("@/lib/sounds").then(m => m.playVoiceJoin());
      }
    });

    sfu.on("voice-state-update", ({ participant, spatialAudioState: nextSpatialAudioState }: any) => {
      upsertParticipant(participant);
      if (nextSpatialAudioState) {
        voiceDispatch({ type: 'SET_SPATIAL_AUDIO_STATE', payload: normalizeSpatialState(nextSpatialAudioState) });
      }
    });

    sfu.on("participants-sync", ({ participants, spatialAudioState: nextSpatialAudioState }: any) => {
      syncParticipants(participants);
      if (nextSpatialAudioState) {
        voiceDispatch({ type: 'SET_SPATIAL_AUDIO_STATE', payload: normalizeSpatialState(nextSpatialAudioState) });
      }
    });

    sfu.on("audio-stalled", (isStalled: boolean) => {
      voiceDispatch({ type: 'SET_AUDIO_STALLED', payload: isStalled });
    });

    sfu.on("profile-update", ({ participantId, name: newName, avatarUrl }) => {
      const p = participantsRef.current.get(participantId);
      if (p) {
        p.name = newName;
        p.avatar_url = avatarUrl;
        voiceDispatch({ type: "SET_PARTICIPANTS", payload: (prev: VoiceState[]) => prev.map(x => x.id === participantId ? { ...x, name: newName, avatar_url: avatarUrl } : x) });
      }
    });

    sfu.on("participant-left", ({ participantId }) => {
      const clerkId = uuidToClerkRef.current.get(participantId) || participantId;
      participantsRef.current.delete(participantId);
      uuidToClerkRef.current.delete(participantId);
      sfu.deleteClerkMapping(participantId);
      voiceDispatch({ type: 'SET_PARTICIPANTS', payload: (prev: VoiceState[]) => prev.filter(p => p.id !== participantId) });
      voiceDispatch({
        type: 'UPDATE_REMOTE_STREAMS',
        payload: (prev: any) => {
          const next = { ...prev };
          delete next[clerkId];
          delete remoteAggregatorsRef.current[clerkId];
          return next;
        }
      });
      voiceDispatch({
        type: 'SET_SPEAKING',
        payload: (prev: any) => {
          const next = { ...prev };
          delete next[clerkId];
          return next;
        }
      });
      voiceDispatch({ type: 'BUMP_PARTICIPANTS' });
    });

    sfu.on("remote-track", ({ participantId, track, trackInfo }) => {
      // Use clerk ID if mapped, otherwise fall back to raw participant UUID.
      // For calls, both users join simultaneously so the mapping may not be
      // populated before the first remote-track fires.
      const clerkId = uuidToClerkRef.current.get(participantId) || participantId;

      voiceDispatch({
        type: 'UPDATE_REMOTE_STREAMS',
        payload: (prev: any) => {
          const userStreams = prev[clerkId] || {};
          const nextStream = new MediaStream();
          if (track.kind === "audio") {
            const processedStream = sfu.applyVolumeToTrack(participantId, track, trackInfo.track_name);

            // Screen-audio starts muted — it only becomes audible when the
            // stream is focused (clicked to expand) or alwaysHear is set.
            // The subscription effect syncs this on focus/setting changes.
            const isScreenAudio = trackInfo.track_name.startsWith('screen-audio-');
            if (isScreenAudio) {
              const alwaysHearPeer = !!(currentSettingsRef.current.peerSettings[clerkId] as any)?.alwaysHear;
              const currentFocused = focusedIdRef.current;
              const isFocusedNow = currentFocused === `remote-screen-${clerkId}` || currentFocused === `remote-camera-${clerkId}`;
              sfu.setTrackVolume(participantId, trackInfo.track_name, (isFocusedNow || alwaysHearPeer) ? 1.0 : 0);
            } else {
              const peerSetting = currentSettingsRef.current.peerSettings[clerkId];
              const finalVolume = (currentSettingsRef.current.isDeafened || (peerSetting as any)?.muted) ? 0 : (((peerSetting as any)?.volume ?? 100) / 100);
              sfu.setParticipantVolume(participantId, finalVolume);
            }
            const processedTrack = processedStream.getAudioTracks()[0];
            nextStream.addTrack(processedTrack || track);
          } else {
            nextStream.addTrack(track);
          }
          return { ...prev, [clerkId]: { ...userStreams, [trackInfo.track_name]: nextStream } };
        }
      });

      // Ensure AudioContext is running — for calls the SFU is created via
      // autoJoin (outside a user gesture) so the context may be suspended.
      if (track.kind === "audio") {
        sfu.resumeAudioContext();
      }

      // Capture periodic thumbnails for screen share video tracks.
      // Reuse one hidden video/canvas pair per peer; repeatedly creating media
      // elements here can contend with active decoders during long calls.
      if (track.kind === "video" && trackInfo.track_name.startsWith("screen-video-") && !capturingThumbnails.current.has(clerkId)) {
        capturingThumbnails.current.add(clerkId);
        const cleanupThumb = () => {
          capturingThumbnails.current.delete(clerkId);
          const capture = thumbnailCaptureRefs.current[clerkId];
          if (!capture) return;
          if (capture.timeoutId !== null) {
            window.clearTimeout(capture.timeoutId);
          }
          capture.video.pause();
          capture.video.srcObject = null;
          delete thumbnailCaptureRefs.current[clerkId];
        };
        const captureThumb = () => {
          if (track.readyState !== "live") {
            cleanupThumb();
            return;
          }
          try {
            let capture = thumbnailCaptureRefs.current[clerkId];
            if (!capture) {
              capture = {
                canvas: document.createElement("canvas"),
                video: document.createElement("video"),
                timeoutId: null,
              };
              capture.video.muted = true;
              capture.video.playsInline = true;
              capture.video.srcObject = new MediaStream([track]);
              thumbnailCaptureRefs.current[clerkId] = capture;
            }
            const { canvas, video } = capture;
            if (track.muted || watchedStreamsRef.current[clerkId]) {
              capture.timeoutId = window.setTimeout(captureThumb, 5000);
              return;
            }
            video.muted = true;
            video.play().then(() => {
              canvas.width = Math.min(video.videoWidth, 320);
              canvas.height = Math.round(canvas.width * (video.videoHeight / video.videoWidth)) || 180;
              const ctx = canvas.getContext("2d");
              if (ctx) {
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                const dataUrl = canvas.toDataURL("image/jpeg", 0.5);
                voiceDispatch({ type: 'SET_THUMBNAILS', payload: (prev: Record<string, string>) => ({ ...prev, [clerkId]: dataUrl }) });
              }
            }).catch(() => { });
          } catch { /* ignore */ }
          // Recapture every 5 seconds
          const capture = thumbnailCaptureRefs.current[clerkId];
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

    sfu.on("speaking", ({ participantId, speaking }) => {
      const clerkId = uuidToClerkRef.current.get(participantId) || participantId;
      voiceDispatch({
        type: 'SET_SPEAKING',
        payload: (prev: any) => ({ ...prev, [clerkId]: speaking > 0 })
      });
    });

    sfu.on("vad-speaking", ({ participantId, isSpeaking }) => {
      const clerkId = uuidToClerkRef.current.get(participantId) || participantId;
      voiceDispatch({
        type: 'SET_SPEAKING',
        payload: (prev: any) => ({ ...prev, [clerkId]: isSpeaking })
      });
    });

    sfu.on("connection-state", ({ state }) => voiceDispatch({ type: 'SET_CONNECTION', payload: state }));

    sfu.on("voice-reconnected", () => {
      vcLog.info("Voice reconnected — re-publishing local tracks");
      const stream = localStreamRef.current;
      if (!stream) return;
      const audioTracks = stream.getAudioTracks();
      const videoTracks = stream.getVideoTracks();
      if (audioTracks.length > 0) {
        sfu.publishTracks(new MediaStream(audioTracks), "cam");
      }
      if (videoTracks.length > 0) {
        sfu.publishTracks(new MediaStream(videoTracks), "cam");
      }
    });

    sfu.on("voice-token-expired", () => {
      vcLog.warn("Voice token expired, requesting fresh authentication...");
      sfu.refreshVoiceCredentials();
    });

    vcLog.info("Connecting SFU", {
      channelId,
      serverId,
      mode,
      roomSlug,
      autoJoin,
      hasUser: !!user,
    });
    sfu.connect(name, chatUserAvatarUrl || user?.imageUrl, user?.id);
    sfu.resumeAudioContext();
    localStreamRef.current = new MediaStream();
  }, [user, serverId, channelId, sendVoiceChannelJoin, onJoined, roomSlugOverride, isCall, mode, guestName, settingsUserId]);

  useEffect(() => {
    if (!joined || mode === "room" || !channelId || !chatConnected) return;

    const reassertJoin = () => {
      sendVoiceChannelJoin(channelId, currentSettingsRef.current.isMuted, currentVoiceChannelStartedAt);
    };

    reassertJoin();
    const timer = window.setInterval(reassertJoin, 30_000);
    return () => window.clearInterval(timer);
  }, [joined, mode, channelId, chatConnected, sendVoiceChannelJoin, currentVoiceChannelStartedAt]);

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
    if (autoJoin && !hasAutoJoined.current && !joined && user && !sfuRef.current) {
      hasAutoJoined.current = true;
      handleJoin();
    }
  }, [autoJoin, joined, user, handleJoin]);

  useEffect(() => {
    if (!joined || !sfuRef.current) return;

    const swapDevices = async () => {
      const sfu = sfuRef.current!;
      const oldStream = localStreamRef.current;

      // Always attempt audio — useMediaDevices() takes ~8s to set hasMicrophone
      // via its useEffect enumeration. Depending on that flag for the early-exit
      // means the initial publish is delayed. Instead, we always call getUserMedia
      // and let it throw NotFoundError if there's genuinely no mic (caught below).
      // hasMicrophone remains a dep so the effect re-runs when a mic is plugged in.
      const wantAudio = true;


      try {
        // Skip if the current stream already uses the requested devices
        // AND the same audio processing settings. This prevents a redundant
        // getUserMedia call when our device-ID reflection (below) updates
        // inputDeviceId from "default" to the actual hardware ID.
        if (oldStream) {
          const currentAudioTrack = oldStream.getAudioTracks()[0];
          const currentVideoId = oldStream.getVideoTracks()[0]?.getSettings().deviceId;
          const audioMatch = currentAudioTrack && (() => {
            const s = currentAudioTrack.getSettings();
            const appliedNS = streamHighFidelity ? false : noiseSuppression;
            const appliedEC = streamHighFidelity ? false : echoCancellation;
            const appliedAG = streamHighFidelity ? false : autoSensitivity;
            // Treat 'default' or empty inputDeviceId as matching any working device
            const deviceMatches = !inputDeviceId || inputDeviceId === 'default' || s.deviceId === inputDeviceId;
            return deviceMatches
              && s.noiseSuppression === appliedNS
              && s.echoCancellation === appliedEC
              && s.autoGainControl === appliedAG;
          })();
          const videoMatch = !isCameraActive || (currentVideoId && currentVideoId === videoDeviceId);
          if (audioMatch && videoMatch) return;
        }

        const appliedNoiseSuppression = streamHighFidelity ? false : noiseSuppression;
        const appliedEchoCancellation = streamHighFidelity ? false : echoCancellation;
        const appliedAutoSensitivity = streamHighFidelity ? false : autoSensitivity;

        let newStream: MediaStream;
        try {
          newStream = await acquireLocalStream(
            {
              deviceId: inputDeviceId,
              deviceLabel: inputDeviceLabel,
              groupId: inputDeviceGroupId,
              noiseSuppression: appliedNoiseSuppression,
              echoCancellation: appliedEchoCancellation,
              autoGainControl: appliedAutoSensitivity,
              stereo: true,
            },
            isCameraActive ? { deviceId: videoDeviceId, deviceLabel: videoDeviceLabel, groupId: videoDeviceGroupId } : null,
            "Voice:Devices"
          );
        } catch (err: any) {
          if (err.name !== "NotAllowedError") {
            devicesLog.warn("Failed to acquire stream:", err.name);
          }
          return;
        }

        let streamToPublish = newStream;
        if (streamHighFidelity && newStream.getAudioTracks().length > 0) {
          // Route through Web Audio to create a non-getUserMedia track.
          // PeerConnection doesn't apply its APM to non-getUserMedia tracks.
          streamToPublish = sfu.createTrueStereoStream(newStream);
        }

        const oldAudio = oldStream?.getAudioTracks()[0];
        const newAudio = streamToPublish.getAudioTracks()[0];
        if (newAudio && (!oldAudio || newAudio.id !== oldAudio.id)) {
          if (oldAudio) oldAudio.stop();
          newAudio.enabled = isMicOn;
          if (oldAudio) {
            sfu.replaceTrack(`cam-audio-${myIdRef.current}`, newAudio);
          } else {
            sfu.publishTracks(new MediaStream([newAudio]), "cam");
          }
          if (isMicOn) {
            sfu.vad.stop();
            sfu.vad.start(newStream); // VAD still uses raw stream
          }
        }

        const oldVideo = oldStream?.getVideoTracks()[0];
        const newVideo = newStream.getVideoTracks()[0];
        if (newVideo && (!oldVideo || newVideo.id !== oldVideo.id)) {
          if (oldVideo) oldVideo.stop();
          newVideo.enabled = isCameraActive;
          if (oldVideo) {
            sfu.replaceTrack(`cam-video-${myIdRef.current}`, newVideo);
          } else {
            sfu.publishTracks(new MediaStream([newVideo]), "cam");
          }
        }

        localStreamRef.current = newStream;

        // Reflect the actual device IDs in the settings store so the UI
        // shows what hardware is genuinely in use (not just "Default").
        // The early-exit guard above prevents this from causing a redundant
        // getUserMedia call when the effect re-runs with the resolved ID.
        const actualAudioTrack = newStream.getAudioTracks()[0];
        if (actualAudioTrack) {
          const actualAudioId = actualAudioTrack.getSettings().deviceId;
          if (actualAudioId && actualAudioId !== inputDeviceId) {
            setDevice('input', actualAudioId, undefined, {
              label: actualAudioTrack.label,
              groupId: actualAudioTrack.getSettings().groupId,
            });
          }
        }
        const actualVideoTrack = newStream.getVideoTracks()[0];
        if (actualVideoTrack) {
          const actualVideoId = actualVideoTrack.getSettings().deviceId;
          if (actualVideoId && actualVideoId !== videoDeviceId) {
            setDevice('video', actualVideoId, undefined, {
              label: actualVideoTrack.label,
              groupId: actualVideoTrack.getSettings().groupId,
            });
          }
        }
      } catch (err) {
        devicesLog.error("Failed to swap devices:", err);
      }
    };

    swapDevices();
  }, [
    inputDeviceId, inputDeviceLabel, inputDeviceGroupId, videoDeviceId, videoDeviceLabel, videoDeviceGroupId, isMicOn, isCameraActive, hasMicrophone, joined, isCall,
    noiseSuppression, echoCancellation, autoSensitivity, streamHighFidelity
  ]);

  useEffect(() => {
    if (!sfuRef.current) return;

    let threshold = 3.0; // default auto threshold
    if (!autoSensitivity) {
      // sensitivity slider is -100dB (left) to 0dB (right).
      // dB is logarithmic: convert to linear amplitude, then scale to RMS 0-100.
      // -100 dB → ~0.001 (gate wide open, any sound triggers)
      //  -50 dB → ~0.32  (normal speech triggers easily)
      //  -20 dB → ~10    (need moderately loud input)
      //    0 dB → 100    (requires full-scale signal)
      threshold = Math.pow(10, sensitivity / 20) * 100;
      threshold = Math.max(0.1, Math.min(50, threshold));
    }

    sfuRef.current.vad.setThreshold(threshold);
  }, [autoSensitivity, sensitivity]);

  const enableNoiseGate = useCallback(() => {
    if (!sfuRef.current) return;
    // Always enable noise gate — replaceTrack(null) during silence provides
    // a secondary bandwidth defense on top of Opus DTX. The audio pipeline
    // should be identical for both voice channels and calls.
    sfuRef.current.vad.enableNoiseGate();
  }, []);

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
  useEffect(() => {
    if (!joined) return;
    setOutputDevice(outputDeviceId);
  }, [outputDeviceId, joined, setOutputDevice]);

  useEffect(() => {
    const stream = localStreamRef.current;
    if (!stream) return;

    const audioTrack = stream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = isMicOn;
    }

    if (isMicOn) {
      sfuRef.current?.vad.start(stream);
    } else {
      sfuRef.current?.vad.stop();
    }

    if (joined && mode !== "room") {
      sfuRef.current?.roomGW.sendVoiceState({
        self_mute: !isMicOn,
        self_deaf: isDeafened,
        self_video: isCameraOn,
        self_stream: isScreenSharing,
        self_stream_audio: isStreamingAudio,
      });
    }
  }, [isMicOn, isDeafened, isCameraOn, isScreenSharing, isStreamingAudio, joined, mode]);

  useEffect(() => {
    if (!joined || mode === "room") return;
    sendVoiceStateUpdate({
      self_mute: !isMicOn,
      self_deaf: isDeafened,
      self_video: isCameraOn,
      self_stream: isScreenSharing,
      self_stream_audio: isStreamingAudio,
    });
  }, [isMicOn, isDeafened, isCameraOn, isScreenSharing, isStreamingAudio, joined, sendVoiceStateUpdate]);

  // We need to keep a ref to `joined` because the cleanup function
  // needs to know if we are currently joined.
  const joinedRef = useRef(joined);
  useEffect(() => { joinedRef.current = joined; }, [joined]);

  useEffect(() => {
    return () => {
      if (sfuRef.current) {
        sfuRef.current.disconnect();
        sfuRef.current = null;
        setSfuInstance(null);
        localStreamRef.current?.getTracks().forEach(t => { t.onended = null; t.stop(); });
        screenStreamRef.current?.getTracks().forEach(t => { t.onended = null; t.stop(); });

        participantsRef.current.clear();
        remoteAggregatorsRef.current = {};
        uuidToClerkRef.current.clear();
        capturingThumbnails.current.clear();

        voiceDispatch({ type: 'LEFT' });

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
      }

      if (joinedRef.current && mode !== "room" && channelId) {
        sendVoiceChannelLeave(channelId); // Leave gateway presence if we were in
      }
    };
  }, [channelId, sendVoiceChannelLeave, mode]);

  // Listen for forced disconnects (e.g. user was banned/kicked from the server)
  useEffect(() => {
    const handleForceDisconnect = () => {
      if (sfuRef.current) {
        // Play disconnect sound before cleanup (skip for calls — gateway plays call-end sound)
        if (!isCall && useSoundSettingsStore.getState().getSettings()?.selfConnectDisconnect) {
          playDisconnect();
        }
        sfuRef.current.disconnect();
        sfuRef.current = null;
        localStreamRef.current?.getTracks().forEach(t => { t.onended = null; t.stop(); });
        localStreamRef.current = null;
        screenStreamRef.current?.getTracks().forEach(t => { t.onended = null; t.stop(); });
        screenStreamRef.current = null;
        voiceDispatch({ type: 'LEFT' });
        onLeft?.();
        if (mode !== "room" && channelId) {
          sendVoiceChannelLeave(channelId);
        }
      }
    };
    window.addEventListener("force-voice-disconnect", handleForceDisconnect);
    return () => window.removeEventListener("force-voice-disconnect", handleForceDisconnect);
  }, [onLeft, sendVoiceChannelLeave, channelId, isCall, mode]);

  const handleLeave = useCallback(() => {
    // Play disconnect sound (skip for calls — gateway plays call-end sound)
    if (!isCall && useSoundSettingsStore.getState().getSettings()?.selfConnectDisconnect) {
      playDisconnect();
    }
    sfuRef.current?.disconnect();
    sfuRef.current = null;
    setSfuInstance(null);
    localStreamRef.current?.getTracks().forEach(t => { t.onended = null; t.stop(); });
    screenStreamRef.current?.getTracks().forEach(t => { t.onended = null; t.stop(); });
    releaseLocalStream();

    // Clear stale participant references
    participantsRef.current.clear();
    remoteAggregatorsRef.current = {};
    uuidToClerkRef.current.clear();
    capturingThumbnails.current.clear();

    voiceDispatch({ type: 'LEFT' });
    onLeft?.();
    sendVoiceChannelLeave(channelId);
    // Prevent the auto-join effect from immediately re-joining after an explicit
    // leave while the URL (and autoJoin prop) still points at this voice channel.
    hasAutoJoined.current = true;
  }, [sendVoiceChannelLeave, onLeft, isCall, channelId]);

  const toggleMic = useCallback(() => {
    // Play mute/unmute click
    const soundSettings = useSoundSettingsStore.getState().getSettings();
    if (soundSettings?.soundsEnabled && soundSettings?.muteDeafen) {
      if (!settingsMuted) playMute(); else playUnmute();
    }
    setIsMuted(!settingsMuted);
  }, [settingsMuted, setIsMuted]);

  const toggleDeafen = useCallback(() => {
    // Play deafen/undeafen click
    const soundSettings = useSoundSettingsStore.getState().getSettings();
    if (soundSettings?.soundsEnabled && soundSettings?.muteDeafen) {
      if (!settingsDeafened) playDeafen(); else playUndeafen();
    }
    setIsDeafened(!settingsDeafened);
  }, [settingsDeafened, setIsDeafened]);

  const toggleCamera = useCallback(async () => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const newState = !isCameraActive;

    if (newState) {
      if (stream.getVideoTracks().length === 0) {
        const newStream = await navigator.mediaDevices.getUserMedia({
          video: (videoDeviceId && videoDeviceId !== 'default') ? { deviceId: { ideal: videoDeviceId } } : true
        });
        const track = newStream.getVideoTracks()[0];
        stream.addTrack(track);
      }
      stream.getVideoTracks().forEach(t => t.enabled = true);
      sfuRef.current?.publishTracks(new MediaStream(stream.getVideoTracks()), "cam");
    } else {
      stream.getVideoTracks().forEach(t => t.enabled = false);
      if (sfuRef.current && myIdRef.current) {
        sfuRef.current.replaceTrack(`cam-video-${myIdRef.current}`, null);
        sfuRef.current.unpublishTrack(`cam-video-${myIdRef.current}`);
      }
    }
    voiceDispatch({ type: 'SET_CAMERA', payload: newState });
  }, [isCameraActive, videoDeviceId]);

  const toggleScreenShare = useCallback(async (options?: ScreenShareOptions) => {
    if (isScreenSharing && !options?.changeSource && !options?.quality && options?.withAudio === undefined) {
      // ── Stop screen sharing ─────────────────────────────────────────
      if (sfuRef.current && myIdRef.current) {
        await sfuRef.current.stopNativeScreenShare();
        sfuRef.current.stopTracks([
          `screen-video-${myIdRef.current}`,
          `screen-audio-${myIdRef.current}`,
        ]);
      }
      screenStreamRef.current?.getTracks().forEach(t => { t.onended = null; t.stop(); });
      screenStreamRef.current = null;
      voiceDispatch({ type: 'SET_SCREEN_SHARING', payload: false, stream: null, audio: false });
      // Play screen share stop sound
      if (useSoundSettingsStore.getState().getSettings()?.screenShare) {
        playScreenShareStop();
      }
    } else {
      try {
        const targetQuality = options?.quality || currentScreenQuality;
        const targetAudio = options?.withAudio !== undefined ? options.withAudio : isStreamingAudio;

        // Mid-share quality/audio changes (and audio toggles) often arrive with
        // NO source fields — e.g. the quality dropdown calls
        // toggleScreenShare({ quality }). If we have a live share whose source we
        // know, re-target THAT source so the restart routes back through the
        // same capture path (native hardware hook for a window/monitor). Without
        // this, `selectedDesktopSource` below is false, the native publisher is
        // never restarted (nor stopped), and we fall through to getDisplayMedia —
        // which grabs a fresh full-monitor stream and publishes it on top of the
        // still-live native publisher, colliding the SDP ("invalid proposed
        // signaling state transition from stable applying remote answer") and
        // breaking the stream. Reusing the source makes quality switching seamless.
        const activeSource = currentScreenSourceRef.current;
        const effectiveOptions: ScreenShareOptions | undefined =
          isScreenSharing && isDesktop() && !options?.sourceId && activeSource?.sourceId
            ? {
                ...options,
                sourceId: activeSource.sourceId ?? undefined,
                captureId: activeSource.captureId ?? undefined,
                sourceName: activeSource.sourceName ?? undefined,
                sourceKind: activeSource.sourceKind ?? undefined,
              }
            : options;

        // ── Seamless in-place quality switch (zero-overhead) ────────────────
        // If the only change is quality (not the source, not audio) and a live
        // NATIVE hardware share is running, reconfigure the encoder in place:
        // no re-injection of the game-capture hook, no new capture session, no
        // WebRTC renegotiation, no track teardown. The native encoder rebuilds
        // its downscale target + bitrate and emits a fresh keyframe the existing
        // track carries. Falls through to the full restart path only if the
        // in-place switch reports it could not apply (no active native share).
        //
        // This must also catch the case where the picker/modal re-submits the
        // SAME source at a new quality with `changeSource: true` (it sets that
        // flag whenever a share is already live). A full restart there republishes
        // the same-named track but does NOT renegotiate the broadcast resolution
        // with the SFU, so viewers stay at the old resolution even though the
        // native encoder switched — the exact 720p-stuck-after-1080p bug. So we
        // treat "same source + quality differs + audio unchanged" as quality-only.
        const activeSourceId = activeSource?.sourceId ?? null;
        const requestedSourceId = options?.sourceId ?? null;
        const sameSource =
          requestedSourceId === null || requestedSourceId === activeSourceId;
        const audioUnchanged =
          options?.withAudio === undefined || options.withAudio === isStreamingAudio;
        const qualityDiffers =
          options?.quality !== undefined && options.quality !== currentScreenQuality;
        const isQualityOnlyChange =
          isScreenSharing && sameSource && qualityDiffers && audioUnchanged;
        if (isQualityOnlyChange && sfuRef.current?.isNativeScreenShareActive) {
          const applied = await sfuRef.current.updateNativeScreenQuality(targetQuality);
          if (applied) {
            voiceDispatch({ type: 'SET_SCREEN_QUALITY', payload: targetQuality });
            logScreenShare("Applied in-place native quality switch", {
              quality: targetQuality,
              sameSource,
              hadChangeSourceFlag: !!options?.changeSource,
            });
            return;
          }
          // else: fall through to the full native restart below.
        }

        if (isScreenSharing && !options?.changeSource && screenStreamRef.current) {
          voiceDispatch({ type: 'SET_SCREEN_QUALITY', payload: targetQuality });
          voiceDispatch({ type: 'SET_SCREEN_SHARING', payload: true, stream: localScreenStream, audio: targetAudio });
          if (screenStreamRef.current) {
            screenStreamRef.current.getAudioTracks().forEach(t => t.enabled = targetAudio);
            await applyScreenTrackQuality(screenStreamRef.current, targetQuality, sfuRef.current, myIdRef.current);
          }
          return;
        }

        const {
          browserVideoConstraints,
          desktopMandatoryConstraints,
        } = screenShareVideoConstraints(targetQuality);

        const selectedDesktopSource = isDesktop() && !!effectiveOptions?.sourceId;
        const captureStartedAt = performance.now();
        const elapsed = () => Math.round(performance.now() - captureStartedAt);
        logScreenShare("Starting capture", {
          elapsedMs: 0,
          selectedDesktopSource,
          sourceId: effectiveOptions?.sourceId ?? null,
          captureId: effectiveOptions?.captureId ?? null,
          sourceKind: effectiveOptions?.sourceKind ?? null,
          sourceName: effectiveOptions?.sourceName ?? null,
          pickerSelectionElapsedMs: effectiveOptions?.pickerSelectionElapsedMs ?? null,
          pickerToCaptureStartMs: effectiveOptions?.pickerOpenedAt ? Math.round(captureStartedAt - effectiveOptions.pickerOpenedAt) : null,
          quality: targetQuality,
          withAudio: targetAudio,
          browserVideoConstraints,
          desktopMandatoryConstraints,
        });
        let hardwareEncoderProbe: unknown = null;
        if (selectedDesktopSource) {
          logScreenShare("Discord-style capture summary", {
            sourceId: effectiveOptions?.captureId ?? effectiveOptions?.sourceId,
            sourceName: effectiveOptions?.sourceName ?? null,
            type: effectiveOptions?.sourceKind === "monitor" ? "screen" : effectiveOptions?.sourceKind ?? null,
            useVideoHook: false,
            useGraphicsCapture: true,
            useCaptureDeviceForEncode: "native-wmf-hardware-first",
            requestedHardwareEncode: true,
            note: "Native publisher is attempted first when the hardware encoder probe succeeds; CEF remains fallback",
          });
          hardwareEncoderProbe = await probeNativeHardwareEncoders();
          logScreenShare("Native hardware encoder probe", hardwareEncoderProbe);
        }
        let stream: MediaStream | null = null;
        if (selectedDesktopSource && isScreenSharing) {
          // Stop old native pipeline AND old preview stream before any restart.
          await sfuRef.current?.stopNativeScreenShare();
          screenStreamRef.current?.getTracks().forEach(t => { t.onended = null; t.stop(); });
          screenStreamRef.current = null;
        }
        if (
          selectedDesktopSource
          && effectiveOptions?.sourceKind !== "device"
          && effectiveOptions?.sourceId
          && sfuRef.current
          && hasNativeH264HardwareEncoder(hardwareEncoderProbe)
        ) {
          try {
            logScreenShare("Calling native hardware screen publisher", {
              elapsedMs: elapsed(),
              sourceId: effectiveOptions.sourceId,
              sourceKind: effectiveOptions.sourceKind,
              sourceName: effectiveOptions.sourceName ?? null,
              quality: targetQuality,
              withAudio: targetAudio,
            });
            await sfuRef.current.publishNativeScreenShare({
              sourceId: effectiveOptions.sourceId,
              sourceName: effectiveOptions.sourceName ?? null,
              quality: targetQuality,
              withAudio: targetAudio,
            });
            logScreenShare("Native hardware screen publisher connected", {
              elapsedMs: elapsed(),
              sourceId: effectiveOptions.sourceId,
              sourceKind: effectiveOptions.sourceKind,
              sourceName: effectiveOptions.sourceName ?? null,
            });

            // ── Preview-paused default for native shares (Req 5.1, 5.2) ────
            // Native hardware capture already runs a WGC session on the source.
            // Opening a second CEF/getDisplayMedia preview on the same source
            // adds capture overhead, so default the local preview to PAUSED:
            // do NOT open a CEF preview stream here. The local tile shows the
            // existing "Preview paused" placeholder until the user resumes via
            // togglePreviewHidden (Req 5.3), which reopens the CEF preview from
            // currentScreenSource.
            const previewDecision = resolvePreviewStartState("native");

            screenStreamRef.current = null;

            voiceDispatch({ type: 'SET_SCREEN_SHARING', payload: true, stream: null, audio: targetAudio });
            voiceDispatch({ type: 'SET_PREVIEW_HIDDEN', payload: previewDecision.isPreviewHidden, stream: null });
            voiceDispatch({ type: 'SET_SCREEN_QUALITY', payload: targetQuality });
            voiceDispatch({
              type: 'SET_SCREEN_SOURCE',
              payload: {
                sourceId: effectiveOptions?.sourceId ?? null,
                captureId: effectiveOptions?.captureId ?? null,
                sourceName: effectiveOptions?.sourceName ?? null,
                sourceKind: effectiveOptions?.sourceKind ?? null,
              } satisfies ScreenShareSourceState,
            });
            if (useSoundSettingsStore.getState().getSettings()?.screenShare) {
              playScreenShareStart();
            }
            return;
          } catch (error) {
            const wgcCaptureAllowed = isWgcCaptureAllowed();
            logScreenShare(
              wgcCaptureAllowed
                ? "Native hardware publisher failed; falling back to CEF capture"
                : "Native hardware publisher failed; WGC/CEF fallback disabled by hook-exclusive policy",
              {
              elapsedMs: elapsed(),
              error,
              },
            );
            await sfuRef.current.stopNativeScreenShare();
            if (!wgcCaptureAllowed) {
              throw error;
            }
          }
        }
        if (selectedDesktopSource) {
          logScreenShare("Calling selected desktop capture", {
            elapsedMs: elapsed(),
            sourceId: effectiveOptions?.sourceId,
            captureId: effectiveOptions?.captureId,
            sourceKind: effectiveOptions?.sourceKind,
          });
          stream = await getCustomPickerDesktopStream({
            sourceId: effectiveOptions?.sourceId,
            captureId: effectiveOptions?.captureId,
            sourceKind: effectiveOptions?.sourceKind,
            withAudio: targetAudio,
            videoConstraints: browserVideoConstraints,
            desktopMandatoryConstraints,
          });
          logScreenShare("Selected desktop capture returned", {
            elapsedMs: elapsed(),
            hasStream: !!stream,
          });
        }

        if (selectedDesktopSource && !stream) {
          throw new Error(`Selected desktop source could not be captured: ${effectiveOptions?.sourceName || effectiveOptions?.sourceId}`);
        }

        if (selectedDesktopSource && stream) {
          const track = stream.getVideoTracks()[0];
          if (track) {
            track.contentHint = effectiveOptions?.sourceKind === "window" ? "motion" : "detail";
          }
          logScreenShare("Captured selected desktop source", {
            elapsedMs: elapsed(),
            sourceId: effectiveOptions?.sourceId,
            captureId: effectiveOptions?.captureId,
            sourceKind: effectiveOptions?.sourceKind,
            sourceName: effectiveOptions?.sourceName,
            track: describeVideoTrack(track),
            audioTracks: stream.getAudioTracks().map(describeAudioTrack),
          });
        }

        if (!stream) {
          const audioConstraints = targetAudio ? {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          } : false;
          const displayMediaOptions: any = {
            video: browserVideoConstraints,
            audio: audioConstraints as any,
            monitorTypeSurfaces: "include",
            selfBrowserSurface: "exclude",
            surfaceSwitching: "include",
            systemAudio: targetAudio ? "include" : "exclude",
            windowAudio: targetAudio ? "system" : "exclude",
          };

          try {
            const displayMediaStartedAt = performance.now();
            logScreenShare("Calling getDisplayMedia", {
              elapsedMs: elapsed(),
              options: displayMediaOptions,
            });
            stream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);
            logScreenShare("getDisplayMedia returned", {
              elapsedMs: elapsed(),
              displayMediaElapsedMs: Math.round(performance.now() - displayMediaStartedAt),
              videoTracks: stream.getVideoTracks().map(describeVideoTrack),
              audioTracks: stream.getAudioTracks().map(describeAudioTrack),
            });
          } catch (err: any) {
            if (targetAudio && err.name !== 'NotAllowedError') {
              logScreenShare("getDisplayMedia with audio failed; retrying video-only", {
                elapsedMs: elapsed(),
                error: err,
              });
              const retryStartedAt = performance.now();
              stream = await navigator.mediaDevices.getDisplayMedia({
                video: browserVideoConstraints as any,
                audio: false
              });
              logScreenShare("getDisplayMedia video-only retry returned", {
                elapsedMs: elapsed(),
                displayMediaElapsedMs: Math.round(performance.now() - retryStartedAt),
                videoTracks: stream.getVideoTracks().map(describeVideoTrack),
                audioTracks: stream.getAudioTracks().map(describeAudioTrack),
              });
            } else {
              throw err;
            }
          }
        }

        if (!stream) {
          throw new Error("No screen share source was selected");
        }
        if (screenStreamRef.current) {
          if (sfuRef.current && myIdRef.current) {
            sfuRef.current.replaceTrack(`screen-video-${myIdRef.current}`, null);
            sfuRef.current.replaceTrack(`screen-audio-${myIdRef.current}`, null);
          }
          screenStreamRef.current.getTracks().forEach(t => { t.onended = null; t.stop(); });
        }
        screenStreamRef.current = stream;
        const screenHasAudio = stream
          .getAudioTracks()
          .some((track: MediaStreamTrack) => track.readyState === "live");
        stream.getVideoTracks().forEach((track) => {
          track.contentHint = effectiveOptions?.sourceKind === "window" ? "motion" : "detail";
        });
        logScreenShare("Capture ready", {
          elapsedMs: elapsed(),
          videoTracks: stream.getVideoTracks().map(describeVideoTrack),
          videoContentHints: stream.getVideoTracks().map((track) => track.contentHint),
          audioTracks: stream.getAudioTracks().map(describeAudioTrack),
          screenHasAudio,
        });
        voiceDispatch({ type: 'SET_SCREEN_SHARING', payload: true, stream: stream, audio: screenHasAudio });
        voiceDispatch({ type: 'SET_SCREEN_QUALITY', payload: targetQuality });
        voiceDispatch({
          type: 'SET_SCREEN_SOURCE',
          payload: {
            sourceId: effectiveOptions?.sourceId ?? null,
            captureId: effectiveOptions?.captureId ?? null,
            sourceName: effectiveOptions?.sourceName ?? null,
            sourceKind: effectiveOptions?.sourceKind ?? null,
          } satisfies ScreenShareSourceState,
        });

        const publishStartedAt = performance.now();
        logScreenShare("Publishing screen tracks", {
          elapsedMs: elapsed(),
          videoTrackCount: stream.getVideoTracks().length,
          audioTrackCount: stream.getAudioTracks().length,
        });
        await sfuRef.current?.publishTracks(stream, "screen");
        logScreenShare("Published screen tracks", {
          elapsedMs: elapsed(),
          publishElapsedMs: Math.round(performance.now() - publishStartedAt),
        });
        await applyScreenTrackQuality(stream, targetQuality, sfuRef.current, myIdRef.current);

        // Play screen share start sound
        if (useSoundSettingsStore.getState().getSettings()?.screenShare) {
          playScreenShareStart();
        }

        const screenVideoTrack = stream.getVideoTracks()[0];
        if (screenVideoTrack) screenVideoTrack.onended = () => {
          // Only unpublish if this stream is STILL the active screen share.
          // When switching sources, the new share is already published on the
          // same track names, so unpublishing here would kill the new stream.
          const isStillActive = screenStreamRef.current === stream;
          if (isStillActive) {
            voiceDispatch({ type: 'SET_SCREEN_SHARING', payload: false, stream: null, audio: false });
            screenStreamRef.current = null;
            if (sfuRef.current && myIdRef.current) {
              sfuRef.current.stopTracks([
                `screen-video-${myIdRef.current}`,
                `screen-audio-${myIdRef.current}`,
              ]);
            }
          }
        };
      } catch (err) {
        screenLog.error("Screen share failed:", err);
      }
    }
  }, [isScreenSharing, currentScreenQuality, isStreamingAudio, localScreenStream]);

  // ── Auto-stop when the shared source goes away (desktop native share) ──────
  // The backend emits `native-screen-share-ended` when the captured window is
  // closed or its process exits (the source no longer exists, so neither the
  // hook nor WGC can capture it). Production-correct behavior is to stop the
  // share — like Discord — instead of leaving it stuck in an "unavailable" /
  // hanging state. We tear the local share down exactly as an explicit stop
  // would (drop tracks, clear UI, play the stop sound) by invoking the stop
  // path. A ref holds the latest `toggleScreenShare` so the listener is set up
  // once and never re-subscribes on every render.
  const toggleScreenShareRef = useRef(toggleScreenShare);
  useEffect(() => {
    toggleScreenShareRef.current = toggleScreenShare;
  }, [toggleScreenShare]);
  const isScreenSharingRef = useRef(isScreenSharing);
  useEffect(() => {
    isScreenSharingRef.current = isScreenSharing;
  }, [isScreenSharing]);

  useEffect(() => {
    if (!isDesktop()) return;
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    void (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const dispose = await listen("native-screen-share-ended", (event) => {
          // Only act if we still think we're sharing — avoids a double-stop if
          // the user already stopped, or a late event after teardown.
          if (!isScreenSharingRef.current) return;
          vcLog.info("Native screen share ended by source close; stopping", {
            payload: event.payload,
          });
          // Invoke the no-arg stop path (drops tracks, clears state, stop sound).
          void toggleScreenShareRef.current?.();
        });
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
  }, []);

  // ── Toggle local preview capture ───────────────────────────────────────────
  // Stops or restarts the CEF preview MediaStream entirely for performance.
  // The native hardware share pipeline is NOT touched — only the local tile feed.
  const togglePreviewHidden = useCallback(async () => {
    const willHide = !isPreviewHidden;
    if (willHide) {
      // Tear down the loopback PC if active (hook shares).
      if (isHookActive && sfuRef.current) {
        await sfuRef.current.stopPreviewLoopback();
      }
      // Stop all preview tracks to release the WGC session.
      screenStreamRef.current?.getTracks().forEach(t => { t.onended = null; t.stop(); });
      screenStreamRef.current = null;
      voiceDispatch({ type: 'SET_PREVIEW_HIDDEN', payload: true, stream: null });
    } else {
      // When the hook is the active capture backend, feed the local preview
      // from the hook's existing encode via a loopback PeerConnection — no
      // second WGC capture, no border, no extra encode cost.
      if (isHookActive && sfuRef.current) {
        const stream = await sfuRef.current.startPreviewLoopback();
        if (stream) {
          screenStreamRef.current = stream;
          voiceDispatch({ type: 'SET_PREVIEW_HIDDEN', payload: false, stream });
        } else {
          previewLog.warn('Loopback preview failed to connect');
        }
        return;
      }
      // Re-open preview — only possible on native share where we know the source.
      const src = currentScreenSource;
      const canReopenNativePreview = !!src?.sourceId && isScreenSharing;
      let openedPreview: MediaStream | null = null;
      const outcome = await resolvePreviewResume({
        canReopenNativePreview,
        cefFallbackStream: screenStreamRef.current,
        openPreviewStream: async () => {
          const { browserVideoConstraints, desktopMandatoryConstraints } = screenShareVideoConstraints(currentScreenQuality);
          openedPreview = await getCustomPickerDesktopStream({
            sourceId: src!.sourceId!,
            captureId: src!.captureId ?? undefined,
            sourceKind: src!.sourceKind ?? undefined,
            withAudio: false,
            videoConstraints: browserVideoConstraints,
            desktopMandatoryConstraints,
          });
          return openedPreview;
        },
      });

      if (outcome.openedStream && outcome.stream) {
        const previewStream = outcome.stream;
        screenStreamRef.current = previewStream;
        // Restore onended so closing the source still tears down native share.
        const videoTrack = previewStream.getVideoTracks()[0];
        if (videoTrack) {
          videoTrack.onended = async () => {
            if (screenStreamRef.current !== previewStream) return;
            screenStreamRef.current = null;
            await sfuRef.current?.stopNativeScreenShare();
            if (sfuRef.current && myIdRef.current) {
              sfuRef.current.stopTracks([`screen-video-${myIdRef.current}`, `screen-audio-${myIdRef.current}`]);
            }
            voiceDispatch({ type: 'SET_SCREEN_SHARING', payload: false, stream: null, audio: false });
          };
        }
      } else if (outcome.reopenFailed) {
        // Non-fatal; stay hidden if re-open fails.
        previewLog.warn('Failed to re-open preview stream');
      }
      voiceDispatch({ type: 'SET_PREVIEW_HIDDEN', payload: outcome.isPreviewHidden, stream: outcome.stream });
    }
  }, [isPreviewHidden, isScreenSharing, currentScreenSource, currentScreenQuality, isHookActive]);

  const onToggleStreamAudio = useCallback(async () => {
    const next = !isStreamingAudio;
    // Check if we're in the native hardware share path.
    // nativeScreenShareActive is private on SFUClient; cast through any.
    const isNative = !!(sfuRef.current && (sfuRef.current as any).nativeScreenShareActive);
    if (isNative) {
      // Native WASAPI loopback audio is started at init time with a fixed flag.
      // To toggle it we must restart the whole native pipeline with flipped audio.
      if (currentScreenSource?.sourceId) {
        await toggleScreenShare({
          sourceId: currentScreenSource.sourceId,
          captureId: currentScreenSource.captureId ?? undefined,
          sourceName: currentScreenSource.sourceName ?? undefined,
          sourceKind: currentScreenSource.sourceKind ?? undefined,
          quality: currentScreenQuality,
          withAudio: next,
          changeSource: true,
        });
      }
      return;
    }
    // CEF path: just enable/disable the audio track.
    if (screenStreamRef.current) {
      screenStreamRef.current.getAudioTracks().forEach(t => t.enabled = next);
    }
    voiceDispatch({ type: 'SET_SCREEN_SHARING', payload: isScreenSharing, stream: localScreenStream, audio: next });
  }, [isStreamingAudio, isScreenSharing, localScreenStream, currentScreenQuality, currentScreenSource, toggleScreenShare]);

  const onToggleWatch = useCallback((clerkId: string) => {
    voiceDispatch({ type: 'SET_WATCHED', payload: (prev: any) => ({ ...prev, [clerkId]: !prev[clerkId] }) });
  }, []);

  const setFocusedId = useCallback((id: string | null) => {
    voiceDispatch({ type: 'SET_FOCUSED', payload: id });
  }, []);

  const gridItems = useMemo(() => {
    const items: GridItem[] = [];

    // For voice channels, use gateway-tracked members.
    // For calls, use the SFU's own participant map combined with gateway VCS for calls.
    const vcMembers = (mode !== "room" && channelId) ? (voiceChannelStates[channelId] ?? []) : [];

    if (joined) {
      items.push({
        id: `local-camera-${myIdRef.current}`,
        userId: user?.id || "",
        name: user?.username || "You",
        avatar: chatUserAvatarUrl || user?.imageUrl,
        stream: localStreamRef.current,
        isLocal: true,
        type: isCameraOn ? 'camera' : 'avatar',
        isStreaming: false,
        isMuted: !isMicOn,
        isDeafened: isDeafened,
        isSpeaking: !!speakingUsers[user?.id || myIdRef.current]
      });

      if (isScreenSharing) {
        // For CEF screen share: localScreenStream has live tracks → render the preview.
        // For native HW share: localScreenStream is null (no CEF MediaStream) → still
        //   add the tile so the UI shows a "Sharing" placeholder.
        const localScreenHasTracks = !!localScreenStream &&
          localScreenStream
            .getTracks()
            .some((t: MediaStreamTrack) => t.readyState === "live");
        items.push({
          id: `local-screen-${myIdRef.current}`,
          userId: user?.id || "",
          name: user?.username || "You",
          avatar: chatUserAvatarUrl || user?.imageUrl,
          stream: localScreenHasTracks ? localScreenStream : null,
          isLocal: true,
          type: 'screen',
          isStreaming: true,
          isMuted: false,
          isDeafened: false,
          isSpeaking: false
        });
      }
    }

    // ── Shared helpers ─────────────────────────────────────────────────

    /** Resolve remote user's media streams, falling back to UUID-keyed entries */
    const resolveStreams = (clerkId: string): Record<string, MediaStream> => {
      let streams = remoteStreams[clerkId] || {};
      if (Object.keys(streams).length === 0) {
        for (const [uuid, cId] of uuidToClerkRef.current.entries()) {
          if (cId === clerkId && remoteStreams[uuid]) {
            streams = remoteStreams[uuid] as any;
            break;
          }
        }
      }
      return streams as Record<string, MediaStream>;
    };

    /** Sync aggregator MediaStreams for cam/screen tracks, returns { cam, screen } */
    const syncAggregator = (clerkId: string, userStreams: Record<string, MediaStream>) => {
      if (!remoteAggregatorsRef.current[clerkId]) {
        remoteAggregatorsRef.current[clerkId] = { cam: new MediaStream(), screen: new MediaStream() };
      }
      const agg = remoteAggregatorsRef.current[clerkId];
      const sync = (type: "cam" | "screen", prefix: string) => {
        const targetTracks = new Set<MediaStreamTrack>();
        Object.entries(userStreams).forEach(([name, s]) => {
          if (name.startsWith(prefix)) s.getTracks().forEach(t => targetTracks.add(t));
        });
        const currentTracks = agg[type].getTracks();
        let changed = currentTracks.length !== targetTracks.size;
        if (!changed) {
          for (const t of currentTracks) {
            if (!targetTracks.has(t)) { changed = true; break; }
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
      clerkId: string;
      name: string;
      avatar?: string;
      isCameraOn: boolean;
      isStreaming: boolean;
      selfMute: boolean;
      selfDeaf: boolean;
    }

    const remotes: RemoteInfo[] = [];

    // All Voice Channels (and DM calls): derive from gateway member list first
    // This ensures presence is visible immediately even before the SFU connects
    vcMembers.forEach((m) => {
      if (m.clerk_user_id === user?.id) return;
      // find their SFU participant info if they have joined the SFU
      const pId = Array.from(uuidToClerkRef.current.entries()).find(([, cId]) => cId === m.clerk_user_id)?.[0];
      const p = pId ? participantsRef.current.get(pId) : null;
      remotes.push({
        clerkId: m.clerk_user_id,
        name: m.name,
        avatar: m.avatar_url,
        isCameraOn: m.self_video || !!p?.self_video,
        isStreaming: m.self_stream || !!p?.self_stream,
        selfMute: m.self_mute,
        selfDeaf: m.self_deaf || false,
      });
    });

    // Supplement with directly-connected SFU participants who might be missing
    // from the Gateway state (e.g. DM Calls where `VOICE_CHANNEL_STATES` isn't fully broadcast)
    for (const [pId, clerkId] of uuidToClerkRef.current.entries()) {
      if (clerkId === user?.id) continue;
      if (remotes.some(r => r.clerkId === clerkId)) continue;

      const p = participantsRef.current.get(pId);
      if (!p) continue;

        remotes.push({
        clerkId,
        name: p.name || "Unknown",
        avatar: p.avatar_url,
        isCameraOn: !!p.self_video,
        isStreaming: !!p.self_stream,
        selfMute: !!p.self_mute,
        selfDeaf: !!p.self_deaf,
      });
    }

    // ── Build grid items from normalized list ─────────────────────────

    for (const remote of remotes) {
      const peerSetting = peerSettings[remote.clerkId];
      const userStreams = resolveStreams(remote.clerkId);
      const agg = syncAggregator(remote.clerkId, userStreams);
      const hasScreenTracks = agg.screen.getTracks().some(t => t.readyState === "live");

      items.push({
        id: `remote-camera-${remote.clerkId}`,
        userId: remote.clerkId,
        name: remote.name,
        avatar: remote.avatar,
        stream: agg.cam.getTracks().length > 0 ? agg.cam : null,
        isLocal: false,
        type: remote.isCameraOn ? 'camera' : 'avatar',
        isStreaming: false,
        isMuted: remote.selfMute || !!(peerSetting as any)?.muted,
        isDeafened: remote.selfDeaf,
        isSpeaking: !!speakingUsers[remote.clerkId] && !(peerSetting as any)?.muted
      });

      if (remote.isStreaming || hasScreenTracks) {
        items.push({
          id: `remote-screen-${remote.clerkId}`,
          userId: remote.clerkId,
          name: `${remote.name}'s Stream`,
          avatar: remote.avatar,
          stream: agg.screen.getTracks().length > 0 ? agg.screen : null,
          isLocal: false,
          type: 'screen',
          isStreaming: true,
          isMuted: false,
          isDeafened: false,
          isSpeaking: false
        });
      }
    }

    return items;
    // participantsVersion forces re-computation when SFU participants change (calls)
  }, [joined, user, localStreamRef.current, isMicOn, isDeafened, isScreenSharing, localScreenStream, remoteStreams, speakingUsers, voiceChannelStates, channelId, peerSettings, isCameraOn, isCall, participantsVersion, mode]);

  const applySpatialAudio = useCallback((state: SharedSpatialAudioState, enabledForLocal: boolean) => {
    const sfu = sfuRef.current;
    if (!sfu) return;
    const participants = [
      { userId: user?.id || myIdRef.current },
      ...remoteSpatialParticipants(gridItems),
    ].filter((p) => p.userId);
    const positions = calculateSpatialPositions(participants, state);
    for (const [uuid, clerkId] of uuidToClerkRef.current.entries()) {
      if (clerkId === user?.id) continue;
      const peerPosition = positions[clerkId];
      const selfPosition = positions[user?.id || myIdRef.current] ?? { x: 50, y: 78 };
      const channelMembers = (mode !== "room" && channelId) ? voiceChannelStates[channelId] : undefined;
      const peer = channelMembers?.find((m: any) => m.clerk_user_id === clerkId);
      const settings: any = peerSettings[clerkId] || { volume: 100, muted: false };
      const isPeerSilenced = isDeafened || settings.muted || (peer?.self_mute || peer?.self_deaf);
      const baseVolume = isPeerSilenced ? 0 : (settings.volume / 100);
      const mix = enabledForLocal ? calculateSpatialAudioMix(selfPosition, peerPosition, state.roomSize) : { pan: 0, gain: 1 };
      sfu.setTrackPan(uuid, `cam-audio-${uuid}`, mix.pan);
      sfu.setTrackVolume(uuid, `cam-audio-${uuid}`, baseVolume * mix.gain);
    }
  }, [channelId, focusedId, gridItems, isDeafened, mode, peerSettings, user?.id, voiceChannelStates]);

  useEffect(() => {
    const enabledForLocal = !!spatialAudioState.enabled && spatialAudioEnabled && streamHighFidelity && !isDeafened;
    applySpatialAudio(spatialAudioState, enabledForLocal);
  }, [spatialAudioState, spatialAudioEnabled, streamHighFidelity, isDeafened, applySpatialAudio]);

  const updateSharedSpatialAudioState = useCallback((next: SharedSpatialAudioState) => {
    const normalized = normalizeSpatialState(next);
    voiceDispatch({ type: 'SET_SPATIAL_AUDIO_STATE', payload: normalized });
    sendVoiceStateUpdate({
      spatial_audio_enabled: normalized.enabled,
      spatial_audio_high_fidelity: streamHighFidelity,
      spatial_audio_state: normalized,
    });
  }, [sendVoiceStateUpdate, streamHighFidelity]);

  return {
    joined,
    isScreenSharing,
    localScreenStream,
    isPreviewHidden,
    isStreamingAudio,
    currentScreenQuality,
    currentScreenSource,
    isCameraActive,
    connectionState,
    focusedId,
    setFocusedId,
    speakingUsers,
    watchedStreams,
    streamThumbnails,
    gridItems,
    audioBlocked,
    setAudioBlocked: (blocked: boolean) => voiceDispatch({ type: 'SET_AUDIO_BLOCKED', payload: blocked }),
    handleJoin,
    handleLeave,
    toggleMic,
    toggleDeafen,
    toggleCamera,
    toggleScreenShare,
    onToggleStreamAudio,
    togglePreviewHidden,
    onToggleWatch,
    currentSettings: {
      isMuted: settingsMuted,
      isDeafened: settingsDeafened,
      peerSettings
    },
    isMicOn,
    isDeafened,
    isCameraOn,
    vcMembers: (mode !== "room" && channelId) ? (voiceChannelStates[channelId] ?? []) : [],
    hasMicrophone,
    hasCamera,
    sfu: sfuInstance,
    settingsUserId,
    audioStalled,
    spatialAudioState,
    updateSharedSpatialAudioState,
  };
}
