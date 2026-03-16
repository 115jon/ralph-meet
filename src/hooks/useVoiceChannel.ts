
import { GridItem } from "@/components/voice/types";
import { isDesktop } from "@/lib/platform";
import { SFUClient } from "@/lib/sfu-client";
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
import { useUser } from "@clerk/tanstack-react-start";
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { useShallow } from "zustand/shallow";

export interface UseVoiceChannelProps {
  channelId: string;
  /** Server ID. Required for voice channels, optional for calls (when roomSlug is provided). */
  serverId?: string;
  /** Override the room slug (e.g. for calls that use a dedicated voice room) */
  roomSlug?: string;
  /** When true, skips voice-channel-specific gateway messages (join/leave) */
  isCall?: boolean;
  onJoined?: () => void;
  onLeft?: () => void;
  autoJoin?: boolean;
}

export function useVoiceChannel({
  channelId,
  serverId,
  roomSlug: roomSlugOverride,
  isCall = false,
  onJoined,
  onLeft,
  autoJoin = false,
}: UseVoiceChannelProps) {
  const { user } = useUser();
  const { voiceChannelStates, chatUserAvatarUrl } = useChatStore(useShallow(s => ({
    voiceChannelStates: s.voiceChannelStates,
    chatUserAvatarUrl: s.user?.avatar_url,
  })));
  const { sendVoiceChannelJoin, sendVoiceChannelLeave, sendVoiceStateUpdate, setSpeakingUsers } = useChatActions();

  const [voiceState, voiceDispatch] = useReducer((state: any, action: any) => {
    switch (action.type) {
      case 'JOINED': return { ...state, joined: true, connectionState: 'connected' };
      case 'LEFT': return { ...state, joined: false, connectionState: 'disconnected', localScreenStream: null, isScreenSharing: false, isStreamingAudio: false };
      case 'SET_CONNECTION': return { ...state, connectionState: action.payload };
      case 'SET_SCREEN_SHARING': return { ...state, isScreenSharing: action.payload, localScreenStream: action.stream, isStreamingAudio: action.audio ?? state.isStreamingAudio };
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
    isCameraActive: false,
    connectionState: "new",
    focusedId: null,
    speakingUsers: {},
    watchedStreams: {},
    streamThumbnails: {},
    audioBlocked: false,
    remoteStreams: {},
    participantsVersion: 0
  });

  const {
    joined,
    isScreenSharing,
    localScreenStream,
    isStreamingAudio,
    currentScreenQuality,
    isCameraActive,
    connectionState,
    focusedId,
    speakingUsers,
    watchedStreams,
    streamThumbnails,
    audioBlocked,
    remoteStreams,
    participantsVersion
  } = voiceState;

  // Sync local speaking state to the global chat context
  useEffect(() => {
    // console.log("[useVoiceChannel] Syncing speakingUsers to global context:", speakingUsers);
    setSpeakingUsers(speakingUsers);
  }, [speakingUsers, setSpeakingUsers]);

  // Clean up global speaking state on unmount
  useEffect(() => {
    return () => setSpeakingUsers({});
  }, [setSpeakingUsers]);

  const sfuRef = useRef<SFUClient | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const participantsRef = useRef<Map<string, VoiceState>>(new Map());
  const remoteAggregatorsRef = useRef<Record<string, { cam: MediaStream; screen: MediaStream }>>({});
  const capturingThumbnails = useRef<Set<string>>(new Set());
  const watchedStreamsRef = useRef<Record<string, boolean>>({});
  const focusedIdRef = useRef<string | null>(null);

  const myIdRef = useRef<string>("");
  const uuidToClerkRef = useRef<Map<string, string>>(new Map());
  const { hasMicrophone, hasCamera } = useMediaDevices();

  const { isMuted: settingsMuted, isDeafened: settingsDeafened, inputDeviceId, videoDeviceId, noiseSuppression, echoCancellation, autoSensitivity, sensitivity, streamHighFidelity, outputVolume, outputDeviceId } = useVoiceSettingsStore(useShallow(s => {
    const st = s.getSettings(user?.id);
    return {
      isMuted: st.isMuted,
      isDeafened: st.isDeafened,
      inputDeviceId: st.inputDeviceId,
      videoDeviceId: st.videoDeviceId,
      noiseSuppression: st.noiseSuppression,
      echoCancellation: st.echoCancellation,
      autoSensitivity: st.autoSensitivity,
      sensitivity: st.sensitivity,
      streamHighFidelity: st.streamHighFidelity,
      outputVolume: st.outputVolume,
      outputDeviceId: st.outputDeviceId,
    };
  }));

  const setCurrentUser = useVoiceSettingsStore(s => s.setCurrentUser);
  const setIsMuted = useVoiceSettingsStore(s => s.setIsMuted);
  const setIsDeafened = useVoiceSettingsStore(s => s.setIsDeafened);
  const setDevice = useVoiceSettingsStore(s => s.setDevice);

  const peerSettings = useVoiceSettingsStore(s => s.getSettings(user?.id).peerSettings);

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

    Object.entries(peerSettings).forEach(([clerkId, settings]) => {
      for (const [uuid, cId] of uuidMap.entries()) {
        if (cId === clerkId) {
          const finalVolume = (isDeafened || (settings as any).muted) ? 0 : ((settings as any).volume / 100);
          sfuRef.current?.setParticipantVolume(uuid, finalVolume);

          // Re-apply screen-audio volume override — setParticipantVolume
          // sets ALL GainNodes (including screen-audio) to the same volume.
          // Screen-audio should only be audible when focused or alwaysHear.
          const alwaysHearPeer = !!(settings as any).alwaysHear;
          const isFocusedPeer = focusedId === `remote-screen-${clerkId}` || focusedId === `remote-camera-${clerkId}`;
          const wantsScreenAudio = isFocusedPeer || alwaysHearPeer;
          sfuRef.current?.setTrackVolume(uuid, `screen-audio-${uuid}`, wantsScreenAudio ? finalVolume : 0);
        }
      }
    });
  }, [peerSettings, isDeafened, joined, voiceChannelStates, channelId, focusedId]);

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
      if (sfuRef.current?.isAudioSuspended()) {
        voiceDispatch({ type: 'SET_AUDIO_BLOCKED', payload: true });
      }
    };

    const timer = setTimeout(check, 1000);
    return () => clearTimeout(timer);
  }, [joined]);

  useEffect(() => {
    if (!joined || !sfuRef.current) return;
    const sfu = sfuRef.current;

    const vcMembers = voiceChannelStates[channelId] ?? [];
    const remoteMemberCount = Math.max(0, (isCall ? Array.from(uuidToClerkRef.current.keys()).length : vcMembers.length) - 1);
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

      // Verify the user is still in the channel (voice channel or call)
      // For calls, we rely on SFU participants entirely rather than gateway presence
      const isStillInChannel = isCall || vcMembers.some(m => m.clerk_user_id === clerkId);
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
    const chatUser = useChatStore.getState().user;
    const name = chatUser?.display_name || user?.username || user?.fullName || "Guest";
    const roomSlug = roomSlugOverride || `voice-${serverId}-${channelId}`;
    const sfu = new SFUClient(roomSlug);
    sfuRef.current = sfu;

    sfu.on("joined", ({ participantId, participants }) => {
      myIdRef.current = participantId;
      if (user?.id) {
        uuidToClerkRef.current.set(participantId, user.id);
      }

      participants.forEach(p => {
        participantsRef.current.set(p.id, p);
        if (p.clerk_user_id) uuidToClerkRef.current.set(p.id, p.clerk_user_id);
      });

      // Bumping participants immediately correctly sets initial call participants
      voiceDispatch({ type: 'BUMP_PARTICIPANTS' });
      voiceDispatch({ type: 'JOINED' });
      onJoined?.();

      // Play connected sound (skip for calls — gateway plays CALL_CONNECT instead)
      if (!isCall && useSoundSettingsStore.getState().getSettings()?.selfConnectDisconnect) {
        playConnected();
      }

      sendVoiceChannelJoin(channelId, currentSettingsRef.current.isMuted);
    });

    sfu.on("participant-joined", ({ participant }) => {
      participantsRef.current.set(participant.id, participant);
      if (participant.clerk_user_id) uuidToClerkRef.current.set(participant.id, participant.clerk_user_id);
      voiceDispatch({ type: 'BUMP_PARTICIPANTS' });
    });

    sfu.on("voice-state-update", ({ participant }) => {
      participantsRef.current.set(participant.id, participant);
      if (participant.clerk_user_id) uuidToClerkRef.current.set(participant.id, participant.clerk_user_id);
      voiceDispatch({ type: 'BUMP_PARTICIPANTS' });
    });

    sfu.on("participant-left", ({ participantId }) => {
      const clerkId = uuidToClerkRef.current.get(participantId) || participantId;
      participantsRef.current.delete(participantId);
      uuidToClerkRef.current.delete(participantId);
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

      // Capture periodic thumbnails for screen share video tracks
      if (track.kind === "video" && trackInfo.track_name.startsWith("screen-video-") && !capturingThumbnails.current.has(clerkId)) {
        capturingThumbnails.current.add(clerkId);
        const captureThumb = () => {
          if (track.readyState !== "live" || track.muted) {
            capturingThumbnails.current.delete(clerkId);
            return;
          }
          try {
            const canvas = document.createElement("canvas");
            const video = document.createElement("video");
            video.srcObject = new MediaStream([track]);
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
              video.srcObject = null;
            }).catch(() => { });
          } catch { /* ignore */ }
          // Recapture every 5 seconds
          setTimeout(() => {
            if (track.readyState === "live") captureThumb();
            else capturingThumbnails.current.delete(clerkId);
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

    // Re-publish local tracks after voice WS reconnect
    sfu.on("voice-reconnected", () => {
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

    sfu.connect(name, chatUserAvatarUrl || user?.imageUrl, user?.id);
    sfu.resumeAudioContext();
    localStreamRef.current = new MediaStream();
  }, [user, serverId, channelId, sendVoiceChannelJoin, onJoined, roomSlugOverride, isCall]);

  useEffect(() => {
    if (autoJoin && !joined && user && !sfuRef.current) {
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
        // Chrome AGC also forces a mono downmix, so it MUST be disabled for stereo
        const appliedAutoSensitivity = streamHighFidelity ? false : autoSensitivity;

        // Build constraints — use `exact` only for non-default device IDs
        const useExactAudio = inputDeviceId && inputDeviceId !== 'default';
        const useExactVideo = videoDeviceId && videoDeviceId !== 'default';

        const buildConstraints = (exactAudio: boolean, exactVideo: boolean) => ({
          audio: {
            deviceId: exactAudio ? { exact: inputDeviceId } : undefined,
            noiseSuppression: appliedNoiseSuppression,
            echoCancellation: appliedEchoCancellation,
            autoGainControl: appliedAutoSensitivity,
            googEchoCancellation: appliedEchoCancellation,
            googAutoGainControl: appliedAutoSensitivity,
            googNoiseSuppression: appliedNoiseSuppression,
            channelCount: 2
          } as any,
          video: isCameraActive ? (exactVideo ? { deviceId: { exact: videoDeviceId } } : true) : false
        });

        let newStream: MediaStream;
        try {
          newStream = await navigator.mediaDevices.getUserMedia(
            buildConstraints(!!useExactAudio, !!useExactVideo)
          );
        } catch (constraintErr: any) {
          // If the stored device ID no longer exists, fall back to system default.
          // We intentionally do NOT call setDevice() here to avoid re-triggering
          // this effect — just use "default" for the retry within this run.
          if (constraintErr.name === 'OverconstrainedError' || constraintErr.name === 'NotFoundError') {
            console.warn("[Voice:Devices] Stored device not found, using system default:", constraintErr.constraint || 'unknown');
            newStream = await navigator.mediaDevices.getUserMedia(
              buildConstraints(false, false)
            );
          } else {
            throw constraintErr;
          }
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
            sfu.stopVAD();
            sfu.startVAD(newStream); // VAD still uses raw stream
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
          if (actualAudioId && actualAudioId !== inputDeviceId && inputDeviceId === 'default') {
            setDevice('input', actualAudioId);
          }
        }
        const actualVideoTrack = newStream.getVideoTracks()[0];
        if (actualVideoTrack) {
          const actualVideoId = actualVideoTrack.getSettings().deviceId;
          if (actualVideoId && actualVideoId !== videoDeviceId && videoDeviceId === 'default') {
            setDevice('video', actualVideoId);
          }
        }
      } catch (err) {
        console.error("[Voice:Devices] Failed to swap devices:", err);
      }
    };

    swapDevices();
  }, [
    inputDeviceId, videoDeviceId, isMicOn, isCameraActive, hasMicrophone, joined, isCall,
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

    sfuRef.current.setVADThreshold(threshold);

    // Always enable noise gate — replaceTrack(null) during silence provides
    // a secondary bandwidth defense on top of Opus DTX. The audio pipeline
    // should be identical for both voice channels and calls.
    sfuRef.current.enableNoiseGate();
  }, [autoSensitivity, sensitivity, joined]);

  // ── Master output volume sync ──────────────────────────────────────────
  useEffect(() => {
    if (!sfuRef.current) return;
    sfuRef.current.setMasterVolume(outputVolume / 100);
  }, [outputVolume, joined]);

  // ── Output device sync ─────────────────────────────────────────────────
  useEffect(() => {
    if (!sfuRef.current) return;
    sfuRef.current.setOutputDevice(outputDeviceId);
  }, [outputDeviceId, joined]);

  useEffect(() => {
    const stream = localStreamRef.current;
    if (!stream) return;

    const audioTrack = stream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = isMicOn;
    }

    if (isMicOn) {
      sfuRef.current?.startVAD(stream);
    } else {
      sfuRef.current?.stopVAD();
    }

    if (joined) {
      // Use sendVoiceState (no hidden inversions) instead of sendMuteUpdate
      // which already inverts isMicOn — passing !isMicOn to it caused double-negation.
      sfuRef.current?.sendVoiceState({
        self_mute: !isMicOn,
        self_deaf: isDeafened,
        self_video: isCameraOn,
        self_stream: isScreenSharing,
        self_stream_audio: isStreamingAudio,
      });
    }
  }, [isMicOn, isDeafened, isCameraOn, isScreenSharing, isStreamingAudio, joined]);

  useEffect(() => {
    if (!joined) return;
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
        localStreamRef.current?.getTracks().forEach(t => { t.onended = null; t.stop(); });
        screenStreamRef.current?.getTracks().forEach(t => { t.onended = null; t.stop(); });
        voiceDispatch({ type: 'LEFT' });
      }

      if (joinedRef.current) {
        sendVoiceChannelLeave(channelId); // Leave gateway presence if we were in
      }
    };
  }, [channelId, sendVoiceChannelLeave]);

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
        sendVoiceChannelLeave(channelId);
      }
    };
    window.addEventListener("force-voice-disconnect", handleForceDisconnect);
    return () => window.removeEventListener("force-voice-disconnect", handleForceDisconnect);
  }, [onLeft, sendVoiceChannelLeave, channelId, isCall]);

  const handleLeave = useCallback(() => {
    // Play disconnect sound (skip for calls — gateway plays call-end sound)
    if (!isCall && useSoundSettingsStore.getState().getSettings()?.selfConnectDisconnect) {
      playDisconnect();
    }
    sfuRef.current?.disconnect();
    localStreamRef.current?.getTracks().forEach(t => { t.onended = null; t.stop(); });
    screenStreamRef.current?.getTracks().forEach(t => { t.onended = null; t.stop(); });
    voiceDispatch({ type: 'LEFT' });
    onLeft?.();
    sendVoiceChannelLeave(channelId);
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

  const toggleScreenShare = useCallback(async (options?: { quality?: string; withAudio?: boolean; changeSource?: boolean; sourceId?: string }) => {
    if (isScreenSharing && !options?.changeSource && !options?.quality && options?.withAudio === undefined) {
      // ── Stop screen sharing ─────────────────────────────────────────
      if (sfuRef.current && myIdRef.current) {
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
      // Stop native capture if running on desktop
      if (isDesktop()) {
        // No-op: CEF handles capture lifecycle internally
      }
    } else {
      try {
        const targetQuality = options?.quality || currentScreenQuality;
        const targetAudio = options?.withAudio !== undefined ? options.withAudio : isStreamingAudio;

        if (isScreenSharing && !options?.changeSource) {
          voiceDispatch({ type: 'SET_SCREEN_QUALITY', payload: targetQuality });
          voiceDispatch({ type: 'SET_SCREEN_SHARING', payload: true, stream: localScreenStream, audio: targetAudio });
          if (screenStreamRef.current) {
            screenStreamRef.current.getAudioTracks().forEach(t => t.enabled = targetAudio);
            const videoTrack = screenStreamRef.current.getVideoTracks()[0];
            if (videoTrack) {
              const qualityMap: Record<string, { width: number; height: number }> = {
                "720p": { width: 1280, height: 720 },
                "1080p": { width: 1920, height: 1080 },
                "1440p": { width: 2560, height: 1440 },
                "4k": { width: 3840, height: 2160 },
              };
              const fps = targetQuality.endsWith("60") ? 60 : 30;
              const resKey = targetQuality.replace(/\d+$/, "");
              const res = qualityMap[resKey];
              if (res) {
                await videoTrack.applyConstraints({
                  width: { ideal: res.width },
                  height: { ideal: res.height },
                  frameRate: { ideal: fps },
                }).catch(() => { });
              }
            }
          }
          return;
        }

        const qualityMap: Record<string, { width: number; height: number }> = {
          "720p": { width: 1280, height: 720 },
          "1080p": { width: 1920, height: 1080 },
          "1440p": { width: 2560, height: 1440 },
          "4k": { width: 3840, height: 2160 },
        };
        const fps = targetQuality.endsWith("60") ? 60 : 30;
        const resKey = targetQuality.replace(/\d+$/, "");
        const res = qualityMap[resKey];

        let stream: MediaStream;

        // ── Desktop (CEF): use Chromium's internal desktop capture API ──
        // Same approach as Electron: getUserMedia with chromeMediaSource
        // gives us hardware-accelerated capture of a SPECIFIC source
        // that the user picked in our DesktopScreenPickerModal.
        if (options?.sourceId && isDesktop()) {
          // Map our xcap IDs to Chromium's format:
          //   monitor-0 → screen:0:0, window-12345 → window:12345:0
          const sourceId = options.sourceId;
          let chromeSourceId: string;
          if (sourceId.startsWith("monitor-")) {
            const idx = sourceId.replace("monitor-", "");
            chromeSourceId = `screen:${idx}:0`;
          } else if (sourceId.startsWith("window-")) {
            const hwnd = sourceId.replace("window-", "");
            chromeSourceId = `window:${hwnd}:0`;
          } else {
            chromeSourceId = sourceId;
          }

          const videoConstraints: any = {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: chromeSourceId,
              maxFrameRate: fps,
              // Constrain capture to the user-selected quality so we don't
              // stream at native resolution (e.g. 1440p) when 720p was chosen.
              ...(res ? { maxWidth: res.width, maxHeight: res.height } : {}),
            },
            optional: [
              { cursor: 'always' }, // Show mouse cursor in screen shares
            ],
          };

          stream = await navigator.mediaDevices.getUserMedia({
            video: videoConstraints,
            audio: false, // desktop audio handled separately below
          });

          // If audio requested, try to get system audio via getDisplayMedia
          if (targetAudio) {
            try {
              const audioStream = await navigator.mediaDevices.getDisplayMedia({
                video: { width: 1, height: 1 }, // minimal — we only want audio
                audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } as any,
              });
              // Grab audio tracks, discard the throwaway video track
              audioStream.getVideoTracks().forEach(t => t.stop());
              audioStream.getAudioTracks().forEach(t => stream.addTrack(t));
            } catch {
              // System audio not available — continue without it
              console.warn("[ScreenShare] System audio capture failed, continuing without audio");
            }
          }
        }
        // ── Web: standard getDisplayMedia (shows system picker) ─────
        else {
          const audioConstraints = targetAudio ? {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          } : false;
          const videoConstraints = res ? { width: { ideal: res.width }, height: { ideal: res.height }, frameRate: { ideal: fps } } : true;

          try {
            stream = await navigator.mediaDevices.getDisplayMedia({
              video: videoConstraints,
              audio: audioConstraints as any,
            });
          } catch (err: any) {
            if (targetAudio && err.name !== 'NotAllowedError') {
              stream = await navigator.mediaDevices.getDisplayMedia({
                video: videoConstraints,
                audio: false
              });
            } else {
              throw err;
            }
          }
        }

        if (screenStreamRef.current) {
          if (sfuRef.current && myIdRef.current) {
            sfuRef.current.replaceTrack(`screen-video-${myIdRef.current}`, null);
            sfuRef.current.replaceTrack(`screen-audio-${myIdRef.current}`, null);
          }
          screenStreamRef.current.getTracks().forEach(t => { t.onended = null; t.stop(); });
        }
        screenStreamRef.current = stream;
        voiceDispatch({ type: 'SET_SCREEN_SHARING', payload: true, stream: stream, audio: targetAudio });
        voiceDispatch({ type: 'SET_SCREEN_QUALITY', payload: targetQuality });
        sfuRef.current?.publishTracks(stream, "screen");

        // Play screen share start sound
        if (useSoundSettingsStore.getState().getSettings()?.screenShare) {
          playScreenShareStart();
        }

        stream.getVideoTracks()[0].onended = () => {
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
        console.error("Screen share failed:", err);
      }
    }
  }, [isScreenSharing, currentScreenQuality, isStreamingAudio, localScreenStream]);

  const onToggleStreamAudio = useCallback(() => {
    const next = !isStreamingAudio;
    if (screenStreamRef.current) {
      screenStreamRef.current.getAudioTracks().forEach(t => t.enabled = next);
    }
    voiceDispatch({ type: 'SET_SCREEN_SHARING', payload: isScreenSharing, stream: localScreenStream, audio: next });
  }, [isStreamingAudio, isScreenSharing, localScreenStream]);

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
    const vcMembers = voiceChannelStates[channelId] ?? [];

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

      if (isScreenSharing && localScreenStream) {
        items.push({
          id: `local-screen-${myIdRef.current}`,
          userId: user?.id || "",
          name: user?.username || "You",
          avatar: chatUserAvatarUrl || user?.imageUrl,
          stream: localScreenStream,
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

      if (remote.isStreaming) {
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
  }, [joined, user, localStreamRef.current, isMicOn, isDeafened, isScreenSharing, localScreenStream, remoteStreams, speakingUsers, voiceChannelStates, channelId, peerSettings, isCameraOn, isCall, participantsVersion]);

  return {
    joined,
    isScreenSharing,
    localScreenStream,
    isStreamingAudio,
    currentScreenQuality,
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
    onToggleWatch,
    currentSettings: {
      isMuted: settingsMuted,
      isDeafened: settingsDeafened,
      peerSettings
    },
    isMicOn,
    isDeafened,
    isCameraOn,
    vcMembers: voiceChannelStates[channelId] ?? [],
    hasMicrophone,
    hasCamera,
    sfu: sfuRef.current
  };
}
