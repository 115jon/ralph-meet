"use client";

import { GridItem } from "@/components/voice/types";
import { useChatActions, useChatState } from "@/lib/chat-context";
import { SFUClient } from "@/lib/sfu-client";
import type { VoiceState } from "@/lib/types";
import { useMediaDevices } from "@/lib/useMediaDevices";
import { useVoiceSettingsStore } from "@/stores/useVoiceSettingsStore";
import { useUser } from "@clerk/nextjs";
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { useShallow } from "zustand/shallow";

export interface UseVoiceChannelProps {
  channelId: string;
  serverId: string;
  onJoined?: () => void;
  onLeft?: () => void;
  autoJoin?: boolean;
}

export function useVoiceChannel({
  channelId,
  serverId,
  onJoined,
  onLeft,
  autoJoin = false,
}: UseVoiceChannelProps) {
  const { user } = useUser();
  const chatState = useChatState();
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
      case 'SET_THUMBNAILS': return { ...state, streamThumbnails: action.payload };
      case 'SET_SCREEN_QUALITY': return { ...state, currentScreenQuality: action.payload };
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
    remoteStreams: {}
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
    remoteStreams
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

  const myIdRef = useRef<string>("");
  const uuidToClerkRef = useRef<Map<string, string>>(new Map());
  const { hasMicrophone, hasCamera } = useMediaDevices();

  const { isMuted: settingsMuted, isDeafened: settingsDeafened, inputDeviceId, videoDeviceId, noiseSuppression, echoCancellation, autoSensitivity, sensitivity, streamHighFidelity } = useVoiceSettingsStore(useShallow(s => {
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
      streamHighFidelity: st.streamHighFidelity
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
        }
      }
    });
  }, [peerSettings, isDeafened, joined, chatState.voiceChannelStates, channelId]);

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

    const vcMembers = chatState.voiceChannelStates[channelId] ?? [];
    const remoteMemberCount = vcMembers.length - 1;
    const isOnlyRemote = remoteMemberCount === 1;

    for (const [uuid, clerkId] of uuidToClerkRef.current.entries()) {
      const isWatched = !!watchedStreams[clerkId];
      const alwaysHear = !!bandwidthPeerSettings[clerkId];
      const isFocused = focusedId === `remote-screen-${clerkId}` || focusedId === `remote-camera-${clerkId}`;
      const rid = (isFocused || isOnlyRemote) ? "h" : "l";

      const isStillInChannel = vcMembers.some(m => m.clerk_user_id === clerkId);
      if (!isStillInChannel) continue;

      sfu.setRemoteTrackSubscription(uuid, `screen-video-${uuid}`, isWatched, rid);
      sfu.setRemoteTrackSubscription(uuid, `cam-video-${uuid}`, true, rid);
      sfu.setRemoteTrackSubscription(uuid, `screen-audio-${uuid}`, isFocused || alwaysHear || isOnlyRemote);
    }
    sfu.pullTracks([]);
  }, [watchedStreams, bandwidthPeerSettings, focusedId, chatState.voiceChannelStates, channelId, joined]);

  const handleJoin = useCallback(async () => {
    const name = user?.username || user?.fullName || "Guest";
    const roomSlug = `voice-${serverId}-${channelId}`;
    const sfu = new SFUClient(roomSlug);
    sfuRef.current = sfu;

    sfu.on("joined", ({ participantId, participants }) => {
      myIdRef.current = participantId;
      if (user?.id) {
        uuidToClerkRef.current.set(participantId, user.id);
      }
      voiceDispatch({ type: 'JOINED' });
      onJoined?.();
      participants.forEach(p => {
        participantsRef.current.set(p.id, p);
        if (p.clerk_user_id) uuidToClerkRef.current.set(p.id, p.clerk_user_id);
      });
      sendVoiceChannelJoin(channelId, currentSettingsRef.current.isMuted);
    });

    sfu.on("participant-joined", ({ participant }) => {
      participantsRef.current.set(participant.id, participant);
      if (participant.clerk_user_id) uuidToClerkRef.current.set(participant.id, participant.clerk_user_id);
    });

    sfu.on("voice-state-update", ({ participant }) => {
      participantsRef.current.set(participant.id, participant);
      if (participant.clerk_user_id) uuidToClerkRef.current.set(participant.id, participant.clerk_user_id);
    });

    sfu.on("participant-left", ({ participantId }) => {
      const clerkId = uuidToClerkRef.current.get(participantId) || participantId;
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
    });

    sfu.on("remote-track", ({ participantId, track, trackInfo }) => {
      const clerkId = uuidToClerkRef.current.get(participantId);
      if (!clerkId) return;

      voiceDispatch({
        type: 'UPDATE_REMOTE_STREAMS',
        payload: (prev: any) => {
          const userStreams = prev[clerkId] || {};
          const nextStream = new MediaStream();
          if (track.kind === "audio") {
            const processedStream = sfu.applyVolumeToTrack(participantId, track, trackInfo.track_name);
            const peerSetting = currentSettingsRef.current.peerSettings[clerkId];
            const finalVolume = (currentSettingsRef.current.isDeafened || (peerSetting as any)?.muted) ? 0 : (((peerSetting as any)?.volume ?? 100) / 100);
            sfu.setParticipantVolume(participantId, finalVolume);
            const processedTrack = processedStream.getAudioTracks()[0];
            nextStream.addTrack(processedTrack || track);
          } else {
            nextStream.addTrack(track);
          }
          return { ...prev, [clerkId]: { ...userStreams, [trackInfo.track_name]: nextStream } };
        }
      });
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

    sfu.connect(name, user?.imageUrl, user?.id);
    sfu.resumeAudioContext();
    localStreamRef.current = new MediaStream();
  }, [user, serverId, channelId, sendVoiceChannelJoin, onJoined]);

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

      try {
        if (!hasMicrophone && !isCameraActive) {
          if (oldStream) oldStream.getTracks().forEach(t => t.stop());
          localStreamRef.current = new MediaStream();
          return;
        }

        const appliedNoiseSuppression = streamHighFidelity ? false : noiseSuppression;
        const appliedEchoCancellation = streamHighFidelity ? false : echoCancellation;
        const appliedAutoSensitivity = streamHighFidelity ? false : autoSensitivity;

        const newStream = await navigator.mediaDevices.getUserMedia({
          audio: hasMicrophone ? {
            deviceId: (inputDeviceId && inputDeviceId !== 'default') ? { ideal: inputDeviceId } : undefined,
            noiseSuppression: appliedNoiseSuppression,
            echoCancellation: appliedEchoCancellation,
            autoGainControl: appliedAutoSensitivity,
            googEchoCancellation: appliedEchoCancellation,
            googAutoGainControl: appliedAutoSensitivity,
            googNoiseSuppression: appliedNoiseSuppression,
            googHighpassFilter: false,
            sampleRate: 48000,
            sampleSize: 16,
            channelCount: 2
          } as any : false,
          video: isCameraActive ? ((videoDeviceId && videoDeviceId !== 'default') ? { deviceId: { ideal: videoDeviceId } } : true) : false
        });

        const oldAudio = oldStream?.getAudioTracks()[0];
        const newAudio = newStream.getAudioTracks()[0];
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
            sfu.startVAD(newStream);
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

        if (inputDeviceId === 'default' || !inputDeviceId) {
          const actualId = newAudio?.getSettings().deviceId;
          if (actualId) setDevice('input', actualId);
        }
        if (isCameraActive && (videoDeviceId === 'default' || !videoDeviceId)) {
          const actualId = newVideo?.getSettings().deviceId;
          if (actualId) setDevice('video', actualId);
        }
      } catch (err) {
        console.error("[Voice:Devices] Failed to swap devices:", err);
      }
    };

    swapDevices();
  }, [inputDeviceId, videoDeviceId, isMicOn, isCameraActive, hasMicrophone, joined, setDevice]);

  useEffect(() => {
    const audioTrack = localStreamRef.current?.getAudioTracks()[0];
    if (!audioTrack) return;

    const appliedNoiseSuppression = streamHighFidelity ? false : noiseSuppression;
    const appliedEchoCancellation = streamHighFidelity ? false : echoCancellation;
    const appliedAutoSensitivity = streamHighFidelity ? false : autoSensitivity;

    audioTrack.applyConstraints({
      noiseSuppression: appliedNoiseSuppression,
      echoCancellation: appliedEchoCancellation,
      autoGainControl: appliedAutoSensitivity,
      googEchoCancellation: appliedEchoCancellation,
      googAutoGainControl: appliedAutoSensitivity,
      googNoiseSuppression: appliedNoiseSuppression,
      googHighpassFilter: false,
      sampleRate: 48000,
      sampleSize: 16,
      channelCount: 2
    } as any).catch(err => console.warn("[Voice:Constraints] Failed:", err));

  }, [noiseSuppression, echoCancellation, autoSensitivity, streamHighFidelity]);

  useEffect(() => {
    if (!sfuRef.current) return;

    let threshold = 3.0;
    if (!autoSensitivity) {
      const absSens = Math.abs(sensitivity);
      threshold = 0.5 + (absSens / 100) * 14.5;
    }

    sfuRef.current.setVADThreshold(threshold);
  }, [autoSensitivity, sensitivity]);

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
      sfuRef.current?.sendMuteUpdate(!isMicOn, isDeafened);
    }
  }, [isMicOn, isDeafened, joined]);

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

  useEffect(() => {
    return () => {
      if (sfuRef.current) {
        sfuRef.current.disconnect();
        sfuRef.current = null;
        localStreamRef.current?.getTracks().forEach(t => t.stop());
        screenStreamRef.current?.getTracks().forEach(t => t.stop());
        sendVoiceChannelLeave();
        voiceDispatch({ type: 'LEFT' });
      }
    };
  }, [channelId, serverId, sendVoiceChannelLeave]);

  const handleLeave = useCallback(() => {
    sfuRef.current?.disconnect();
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    screenStreamRef.current?.getTracks().forEach(t => t.stop());
    voiceDispatch({ type: 'LEFT' });
    onLeft?.();
    sendVoiceChannelLeave();
  }, [sendVoiceChannelLeave, onLeft]);

  const toggleMic = useCallback(() => {
    setIsMuted(!settingsMuted);
  }, [settingsMuted, setIsMuted]);

  const toggleDeafen = useCallback(() => {
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
      sfuRef.current?.unpublishTrack(`cam-video-${myIdRef.current}`);
    }
    voiceDispatch({ type: 'SET_CAMERA', payload: newState });
  }, [isCameraActive, videoDeviceId]);

  const toggleScreenShare = useCallback(async (options?: { quality?: string; withAudio?: boolean; changeSource?: boolean }) => {
    if (isScreenSharing && !options?.changeSource && !options?.quality && options?.withAudio === undefined) {
      screenStreamRef.current?.getTracks().forEach(t => t.stop());
      screenStreamRef.current = null;
      voiceDispatch({ type: 'SET_SCREEN_SHARING', payload: false, stream: null, audio: false });
      sfuRef.current?.stopTracks([`screen-video-${myIdRef.current}`, `screen-audio-${myIdRef.current}`]);
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
                videoTrack.applyConstraints({
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
        const audioConstraints = targetAudio ? {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        } : false;

        const videoConstraints = res ? { width: { ideal: res.width }, height: { ideal: res.height }, frameRate: { ideal: fps } } : true;

        let stream: MediaStream;
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
        if (screenStreamRef.current) {
          screenStreamRef.current.getTracks().forEach(t => { t.onended = null; t.stop(); });
        }
        screenStreamRef.current = stream;
        voiceDispatch({ type: 'SET_SCREEN_SHARING', payload: true, stream: stream, audio: targetAudio });
        voiceDispatch({ type: 'SET_SCREEN_QUALITY', payload: targetQuality });
        sfuRef.current?.publishTracks(stream, "screen");

        stream.getVideoTracks()[0].onended = () => {
          voiceDispatch({ type: 'SET_SCREEN_SHARING', payload: false, stream: null, audio: false });
          if (screenStreamRef.current === stream) screenStreamRef.current = null;
          sfuRef.current?.stopTracks([`screen-video-${myIdRef.current}`, `screen-audio-${myIdRef.current}`]);
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

  const gridItems = useMemo(() => {
    const items: GridItem[] = [];
    const members = chatState.voiceChannelStates[channelId] ?? [];

    if (joined) {
      items.push({
        id: `local-camera-${myIdRef.current}`,
        userId: user?.id || "",
        name: user?.username || "You",
        avatar: user?.imageUrl,
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
          avatar: user?.imageUrl,
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

    members.forEach((m) => {
      if (m.clerk_user_id === user?.id) return;
      const pId = Array.from(uuidToClerkRef.current.entries()).find(([, cId]) => cId === m.clerk_user_id)?.[0];
      const p = pId ? participantsRef.current.get(pId) : null;
      const isRemoteCameraOn = m.self_video || p?.self_video;
      const isRemoteStreaming = m.self_stream || p?.self_stream;
      const peerSetting = peerSettings[m.clerk_user_id];

      let userStreams = remoteStreams[m.clerk_user_id] || {};
      if (Object.keys(userStreams).length === 0) {
        for (const [uuid, cId] of uuidToClerkRef.current.entries()) {
          if (cId === m.clerk_user_id && remoteStreams[uuid]) {
            userStreams = (remoteStreams as any)[uuid];
            break;
          }
        }
      }

      if (!remoteAggregatorsRef.current[m.clerk_user_id]) {
        remoteAggregatorsRef.current[m.clerk_user_id] = { cam: new MediaStream(), screen: new MediaStream() };
      }
      const agg = remoteAggregatorsRef.current[m.clerk_user_id];

      const updateTracks = (aggStream: MediaStream, prefix: string) => {
        const targetTracks = new Set<MediaStreamTrack>();
        Object.entries(userStreams).forEach(([name, s]) => {
          if (name.startsWith(prefix)) (s as MediaStream).getTracks().forEach(t => targetTracks.add(t));
        });
        aggStream.getTracks().forEach(t => { if (!targetTracks.has(t)) aggStream.removeTrack(t); });
        targetTracks.forEach(t => { if (!aggStream.getTracks().includes(t)) aggStream.addTrack(t); });
      };

      updateTracks(agg.cam, "cam-");
      updateTracks(agg.screen, "screen-");

      items.push({
        id: `remote-camera-${m.clerk_user_id}`,
        userId: m.clerk_user_id,
        name: m.name,
        avatar: m.avatar_url,
        stream: agg.cam.getTracks().length > 0 ? agg.cam : null,
        isLocal: false,
        type: isRemoteCameraOn ? 'camera' : 'avatar',
        isStreaming: false,
        isMuted: m.self_mute || !!(peerSetting as any)?.muted,
        isDeafened: m.self_deaf || false,
        isSpeaking: !!speakingUsers[m.clerk_user_id] && !(peerSetting as any)?.muted
      });

      if (isRemoteStreaming) {
        items.push({
          id: `remote-screen-${m.clerk_user_id}`,
          userId: m.clerk_user_id,
          name: `${m.name}'s Stream`,
          avatar: m.avatar_url,
          stream: agg.screen.getTracks().length > 0 ? agg.screen : null,
          isLocal: false,
          type: 'screen',
          isStreaming: true,
          isMuted: false,
          isDeafened: false,
          isSpeaking: false
        });
      }
    });

    return items;
  }, [joined, user, isMicOn, isDeafened, isScreenSharing, localScreenStream, remoteStreams, speakingUsers, chatState.voiceChannelStates, channelId, peerSettings, isCameraOn]);

  return {
    joined,
    isScreenSharing,
    localScreenStream,
    isStreamingAudio,
    currentScreenQuality,
    isCameraActive,
    connectionState,
    focusedId,
    setFocusedId: (id: string | null) => voiceDispatch({ type: 'SET_FOCUSED', payload: id }),
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
    vcMembers: chatState.voiceChannelStates[channelId] ?? [],
    hasMicrophone,
    hasCamera,
    sfu: sfuRef.current
  };
}
