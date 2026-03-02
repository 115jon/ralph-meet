
import { GridItem } from "@/components/voice/types";
import { SFUClient } from "@/lib/sfu-client";
import type { VoiceState } from "@/lib/types";
import { useMediaDevices } from "@/lib/useMediaDevices";
import { useVoiceSettingsStore } from "@/stores/useVoiceSettingsStore";
import { useUser } from "@clerk/tanstack-react-start";
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { useShallow } from "zustand/shallow";

export interface UseRoomVoiceChannelProps {
  roomSlug: string;
  guestName: string;
  onJoined?: () => void;
  onLeft?: () => void;
  autoJoin?: boolean;
}

// ── Reducer ─────────────────────────────────────────────────────────────────

interface RoomVoiceState {
  joined: boolean;
  isScreenSharing: boolean;
  localScreenStream: MediaStream | null;
  isStreamingAudio: boolean;
  currentScreenQuality: string;
  isCameraActive: boolean;
  connectionState: string;
  focusedId: string | null;
  speakingUsers: Record<string, boolean>;
  watchedStreams: Record<string, boolean>;
  streamThumbnails: Record<string, string>;
  audioBlocked: boolean;
  remoteStreams: Record<string, Record<string, MediaStream>>;
  participants: VoiceState[];
}

type RoomAction =
  | { type: "JOINED" }
  | { type: "LEFT" }
  | { type: "SET_CONNECTION"; payload: string }
  | { type: "SET_SCREEN_SHARING"; payload: boolean; stream: MediaStream | null; audio?: boolean }
  | { type: "SET_CAMERA"; payload: boolean }
  | { type: "SET_FOCUSED"; payload: string | null }
  | { type: "SET_AUDIO_BLOCKED"; payload: boolean }
  | { type: "SET_SPEAKING"; payload: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>) }
  | { type: "SET_WATCHED"; payload: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>) }
  | { type: "UPDATE_REMOTE_STREAMS"; payload: Record<string, Record<string, MediaStream>> | ((prev: Record<string, Record<string, MediaStream>>) => Record<string, Record<string, MediaStream>>) }
  | { type: "SET_SCREEN_QUALITY"; payload: string }
  | { type: "SET_THUMBNAILS"; payload: Record<string, string> | ((prev: Record<string, string>) => Record<string, string>) }
  | { type: "SET_PARTICIPANTS"; payload: VoiceState[] | ((prev: VoiceState[]) => VoiceState[]) };

function roomReducer(state: RoomVoiceState, action: RoomAction): RoomVoiceState {
  switch (action.type) {
    case "JOINED": return { ...state, joined: true, connectionState: "connected" };
    case "LEFT": return { ...state, joined: false, connectionState: "disconnected", localScreenStream: null, isScreenSharing: false, isStreamingAudio: false, participants: [] };
    case "SET_CONNECTION": return { ...state, connectionState: action.payload };
    case "SET_SCREEN_SHARING": return { ...state, isScreenSharing: action.payload, localScreenStream: action.stream, isStreamingAudio: action.audio ?? state.isStreamingAudio };
    case "SET_CAMERA": return { ...state, isCameraActive: action.payload };
    case "SET_FOCUSED": return { ...state, focusedId: action.payload };
    case "SET_AUDIO_BLOCKED": return { ...state, audioBlocked: action.payload };
    case "SET_SPEAKING": {
      const next = typeof action.payload === "function" ? action.payload(state.speakingUsers) : action.payload;
      return { ...state, speakingUsers: next };
    }
    case "SET_WATCHED": {
      const next = typeof action.payload === "function" ? action.payload(state.watchedStreams) : action.payload;
      return { ...state, watchedStreams: next };
    }
    case "UPDATE_REMOTE_STREAMS": {
      const next = typeof action.payload === "function" ? action.payload(state.remoteStreams) : action.payload;
      return { ...state, remoteStreams: next };
    }
    case "SET_SCREEN_QUALITY": return { ...state, currentScreenQuality: action.payload };
    case "SET_THUMBNAILS": {
      const next = typeof action.payload === "function" ? action.payload(state.streamThumbnails) : action.payload;
      return { ...state, streamThumbnails: next };
    }
    case "SET_PARTICIPANTS": {
      const next = typeof action.payload === "function" ? action.payload(state.participants) : action.payload;
      return { ...state, participants: next };
    }
    default: return state;
  }
}

// ── Hook ────────────────────────────────────────────────────────────────────

export function useRoomVoiceChannel({
  roomSlug,
  guestName,
  onJoined,
  onLeft,
  autoJoin = false,
}: UseRoomVoiceChannelProps) {
  const { user } = useUser();

  const [voiceState, voiceDispatch] = useReducer(roomReducer, {
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
    participants: [],
  });

  const {
    joined, isScreenSharing, localScreenStream, isStreamingAudio,
    currentScreenQuality, isCameraActive, connectionState,
    focusedId, speakingUsers, watchedStreams, streamThumbnails,
    audioBlocked, remoteStreams, participants,
  } = voiceState;

  const sfuRef = useRef<SFUClient | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const participantsRef = useRef<Map<string, VoiceState>>(new Map());
  const remoteAggregatorsRef = useRef<Record<string, { cam: MediaStream; screen: MediaStream }>>({});
  const capturingThumbnails = useRef<Set<string>>(new Set());

  const myIdRef = useRef<string>("");
  const { hasMicrophone, hasCamera } = useMediaDevices();

  // Use a room-specific namespace so muted/deafened state from chat doesn't leak
  const settingsUserId = `room-${user?.id || "guest"}`;
  const { isMuted: settingsMuted, isDeafened: settingsDeafened, inputDeviceId, videoDeviceId, noiseSuppression, echoCancellation, autoSensitivity, sensitivity, streamHighFidelity, outputVolume, outputDeviceId } = useVoiceSettingsStore(useShallow(s => {
    const st = s.getSettings(settingsUserId);
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

  const peerSettings = useVoiceSettingsStore(s => s.getSettings(settingsUserId).peerSettings);
  const currentSettingsRef = useRef({ isMuted: settingsMuted, isDeafened: settingsDeafened, peerSettings });
  useEffect(() => {
    currentSettingsRef.current = { isMuted: settingsMuted, isDeafened: settingsDeafened, peerSettings };
  }, [settingsMuted, settingsDeafened, peerSettings]);

  const isMicOn = !settingsMuted && hasMicrophone;
  const isDeafened = settingsDeafened;
  const isCameraOn = isCameraActive && hasCamera;

  // Set current user SYNCHRONOUSLY on every render — not in an effect.
  // The store's mutators (setIsMuted, setIsDeafened, setDevice, updateUserSettings)
  // read get().currentUser internally. If we set it in a useEffect, there's a race:
  // zustand/persist rehydrates currentUser from localStorage (e.g. "user_abc123" from chat),
  // and before our effect runs, the first render reads the stale chat user's muted state.
  // Calling it here ensures currentUser is correct before any store reads.
  if (useVoiceSettingsStore.getState().currentUser !== settingsUserId) {
    setCurrentUser(settingsUserId);
  }

  // ── Audio resume logic ──────────────────────────────────────────────────

  useEffect(() => {
    const resume = () => {
      sfuRef.current?.resumeAudioContext();
      voiceDispatch({ type: "SET_AUDIO_BLOCKED", payload: false });
    };
    window.addEventListener("click", resume, { once: true });
    window.addEventListener("keydown", resume, { once: true });
    return () => {
      window.removeEventListener("click", resume);
      window.removeEventListener("keydown", resume);
    };
  }, []);

  useEffect(() => {
    if (!joined || !sfuRef.current) {
      voiceDispatch({ type: "SET_AUDIO_BLOCKED", payload: false });
      return;
    }
    const timer = setTimeout(() => {
      if (sfuRef.current?.isAudioSuspended()) {
        voiceDispatch({ type: "SET_AUDIO_BLOCKED", payload: true });
      }
    }, 1000);
    return () => clearTimeout(timer);
  }, [joined]);

  // ── Per-user volume control ─────────────────────────────────────────────

  useEffect(() => {
    if (!sfuRef.current || !joined) return;
    for (const [uuid, p] of participantsRef.current.entries()) {
      const clerkId = p.clerk_user_id || uuid;
      const settings = (peerSettings as any)[clerkId];
      const finalVolume = (isDeafened || settings?.muted) ? 0 : ((settings?.volume ?? 100) / 100);
      sfuRef.current.setParticipantVolume(uuid, finalVolume);
    }
  }, [peerSettings, isDeafened, joined]);

  // ── Join handler ────────────────────────────────────────────────────────

  const handleJoin = useCallback(async () => {
    const name = user?.username || user?.fullName || guestName || "Guest";
    const sfu = new SFUClient(roomSlug);
    sfuRef.current = sfu;

    sfu.on("joined", ({ participantId, participants: existing }) => {
      myIdRef.current = participantId;
      voiceDispatch({ type: "JOINED" });
      onJoined?.();
      existing.forEach(p => participantsRef.current.set(p.id, p));
      voiceDispatch({ type: "SET_PARTICIPANTS", payload: existing });
    });

    sfu.on("participant-joined", ({ participant }) => {
      participantsRef.current.set(participant.id, participant);
      voiceDispatch({ type: "SET_PARTICIPANTS", payload: (prev) => [...prev, participant] });
    });

    sfu.on("voice-state-update", ({ participant }) => {
      participantsRef.current.set(participant.id, participant);
      voiceDispatch({ type: "SET_PARTICIPANTS", payload: (prev) => prev.map(p => p.id === participant.id ? participant : p) });
    });

    sfu.on("profile-update", ({ participantId, name: newName, avatarUrl }) => {
      const p = participantsRef.current.get(participantId);
      if (p) {
        p.name = newName;
        p.avatar_url = avatarUrl;
        voiceDispatch({ type: "SET_PARTICIPANTS", payload: (prev) => prev.map(x => x.id === participantId ? { ...x, name: newName, avatar_url: avatarUrl } : x) });
      }
    });

    sfu.on("participant-left", ({ participantId }) => {
      participantsRef.current.delete(participantId);
      voiceDispatch({ type: "SET_PARTICIPANTS", payload: (prev) => prev.filter(p => p.id !== participantId) });
      voiceDispatch({
        type: "UPDATE_REMOTE_STREAMS",
        payload: (prev) => {
          const next = { ...prev };
          delete next[participantId];
          delete remoteAggregatorsRef.current[participantId];
          return next;
        },
      });
      voiceDispatch({
        type: "SET_SPEAKING",
        payload: (prev) => {
          const next = { ...prev };
          delete next[participantId];
          return next;
        },
      });
    });

    sfu.on("remote-track", ({ participantId, track, trackInfo }) => {
      voiceDispatch({
        type: "UPDATE_REMOTE_STREAMS",
        payload: (prev) => {
          const userStreams = prev[participantId] || {};
          const nextStream = new MediaStream();
          if (track.kind === "audio") {
            const processedStream = sfu.applyVolumeToTrack(participantId, track, trackInfo.track_name);
            const ps = currentSettingsRef.current.peerSettings[participantId];
            const vol = (currentSettingsRef.current.isDeafened || (ps as any)?.muted) ? 0 : (((ps as any)?.volume ?? 100) / 100);
            sfu.setParticipantVolume(participantId, vol);
            const pt = processedStream.getAudioTracks()[0];
            nextStream.addTrack(pt || track);
          } else {
            nextStream.addTrack(track);
          }
          return { ...prev, [participantId]: { ...userStreams, [trackInfo.track_name]: nextStream } };
        },
      });

      // Capture periodic thumbnails for screen share video tracks
      if (track.kind === "video" && trackInfo.track_name.startsWith("screen-video-") && !capturingThumbnails.current.has(participantId)) {
        capturingThumbnails.current.add(participantId);
        const captureThumb = () => {
          if (track.readyState !== "live" || track.muted) {
            capturingThumbnails.current.delete(participantId);
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
                voiceDispatch({ type: "SET_THUMBNAILS", payload: (prev: Record<string, string>) => ({ ...prev, [participantId]: dataUrl }) });
              }
              video.srcObject = null;
            }).catch(() => { });
          } catch { /* ignore */ }
          setTimeout(() => {
            if (track.readyState === "live") captureThumb();
            else capturingThumbnails.current.delete(participantId);
          }, 5000);
        };
        setTimeout(captureThumb, 1000);
      }
    });

    sfu.on("speaking", ({ participantId, speaking }) => {
      voiceDispatch({ type: "SET_SPEAKING", payload: (prev) => ({ ...prev, [participantId]: speaking > 0 }) });
    });

    sfu.on("vad-speaking", ({ participantId, isSpeaking }) => {
      voiceDispatch({ type: "SET_SPEAKING", payload: (prev) => ({ ...prev, [participantId]: isSpeaking }) });
    });

    sfu.on("connection-state", ({ state }) => voiceDispatch({ type: "SET_CONNECTION", payload: state }));

    // Re-publish local tracks after voice WS reconnect
    sfu.on("voice-reconnected", () => {
      console.log("[RoomVoice] Voice reconnected — re-publishing local tracks");
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

    sfu.connect(name, user?.imageUrl, user?.id);
    sfu.resumeAudioContext();
    localStreamRef.current = new MediaStream();
  }, [user, roomSlug, guestName, onJoined]);

  // Auto-join
  useEffect(() => {
    if (autoJoin && !joined && !sfuRef.current) {
      handleJoin();
    }
  }, [autoJoin, joined, handleJoin]);

  // ── Device swap effect ──────────────────────────────────────────────────

  useEffect(() => {
    if (!joined || !sfuRef.current) return;
    const sfu = sfuRef.current;
    const oldStream = localStreamRef.current;

    const swapDevices = async () => {
      try {
        if (!hasMicrophone && !isCameraActive) {
          if (oldStream) oldStream.getTracks().forEach(t => t.stop());
          localStreamRef.current = new MediaStream();
          return;
        }

        const ns = streamHighFidelity ? false : noiseSuppression;
        const ec = streamHighFidelity ? false : echoCancellation;
        // Chrome AGC also forces a mono downmix, so it MUST be disabled for stereo
        const ag = streamHighFidelity ? false : autoSensitivity;

        const newStream = await navigator.mediaDevices.getUserMedia({
          audio: hasMicrophone ? {
            deviceId: (inputDeviceId && inputDeviceId !== "default") ? { exact: inputDeviceId } : undefined,
            noiseSuppression: ns,
            echoCancellation: ec,
            autoGainControl: ag,
            googEchoCancellation: ec,
            googAutoGainControl: ag,
            googNoiseSuppression: ns,
            channelCount: 2,
          } as any : false,
          video: isCameraActive ? ((videoDeviceId && videoDeviceId !== "default") ? { deviceId: { exact: videoDeviceId } } : true) : false,
        });

        let streamToPublish = newStream;
        if (streamHighFidelity && hasMicrophone) {
          // Route through Web Audio to create a non-getUserMedia track.
          // PeerConnection doesn't apply its APM to non-getUserMedia tracks.
          streamToPublish = sfu.createTrueStereoStream(newStream);
        }

        const oldAudio = oldStream?.getAudioTracks()[0];
        const newAudio = streamToPublish.getAudioTracks()[0];
        if (newAudio && (!oldAudio || newAudio.id !== oldAudio.id)) {
          if (oldAudio) oldAudio.stop();
          newAudio.enabled = isMicOn;
          if (oldAudio) sfu.replaceTrack(`cam-audio-${myIdRef.current}`, newAudio);
          else sfu.publishTracks(new MediaStream([newAudio]), "cam");
          if (isMicOn) { sfu.stopVAD(); sfu.startVAD(newStream); } // VAD still uses raw stream
        }

        const oldVideo = oldStream?.getVideoTracks()[0];
        const newVideo = newStream.getVideoTracks()[0];
        if (newVideo && (!oldVideo || newVideo.id !== oldVideo.id)) {
          if (oldVideo) oldVideo.stop();
          newVideo.enabled = isCameraActive;
          if (oldVideo) sfu.replaceTrack(`cam-video-${myIdRef.current}`, newVideo);
          else sfu.publishTracks(new MediaStream([newVideo]), "cam");
        }

        localStreamRef.current = newStream;

        if (inputDeviceId === "default" || !inputDeviceId) {
          const actualId = newAudio?.getSettings().deviceId;
          if (actualId) setDevice("input", actualId);
        }
        if (isCameraActive && (videoDeviceId === "default" || !videoDeviceId)) {
          const actualId = newVideo?.getSettings().deviceId;
          if (actualId) setDevice("video", actualId);
        }
      } catch (err) {
        console.error("[RoomVoice:Devices] Failed to swap devices:", err);
      }
    };
    swapDevices();
  }, [
    inputDeviceId, videoDeviceId, isMicOn, isCameraActive, hasMicrophone, joined, setDevice,
    noiseSuppression, echoCancellation, autoSensitivity, streamHighFidelity
  ]);

  // ── VAD threshold sync ──────────────────────────────────────────────────

  useEffect(() => {
    if (!sfuRef.current) return;
    let threshold = 3.0;
    if (!autoSensitivity) threshold = 0.5 + (Math.abs(sensitivity) / 100) * 14.5;
    sfuRef.current.setVADThreshold(threshold);

    // Enable noise gate when manual sensitivity is active (autoSensitivity OFF)
    if (!autoSensitivity) {
      sfuRef.current.enableNoiseGate();
    } else {
      sfuRef.current.disableNoiseGate();
    }
  }, [autoSensitivity, sensitivity]);

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

  // ── Voice state sync — sends full state to SFU ──────────────────────────

  useEffect(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const audioTrack = stream.getAudioTracks()[0];
    if (audioTrack) audioTrack.enabled = isMicOn;
    if (isMicOn) sfuRef.current?.startVAD(stream);
    else sfuRef.current?.stopVAD();
  }, [isMicOn]);

  // Send full voice state to SFU whenever any state changes
  useEffect(() => {
    if (!joined || !sfuRef.current) return;
    sfuRef.current.sendVoiceState({
      self_mute: !isMicOn,
      self_deaf: isDeafened,
      self_video: isCameraOn,
      self_stream: isScreenSharing,
      self_stream_audio: isStreamingAudio,
    });
  }, [isMicOn, isDeafened, isCameraOn, isScreenSharing, isStreamingAudio, joined]);


  // ── Cleanup on unmount ──────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      if (sfuRef.current) {
        sfuRef.current.disconnect();
        sfuRef.current = null;
        localStreamRef.current?.getTracks().forEach(t => t.stop());
        screenStreamRef.current?.getTracks().forEach(t => t.stop());
        voiceDispatch({ type: "LEFT" });
      }
    };
  }, [roomSlug]);

  // ── Controls ────────────────────────────────────────────────────────────

  const handleLeave = useCallback(() => {
    sfuRef.current?.disconnect();
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    screenStreamRef.current?.getTracks().forEach(t => t.stop());
    voiceDispatch({ type: "LEFT" });
    onLeft?.();
  }, [onLeft]);

  const toggleMic = useCallback(() => setIsMuted(!settingsMuted), [settingsMuted, setIsMuted]);
  const toggleDeafen = useCallback(() => setIsDeafened(!settingsDeafened), [settingsDeafened, setIsDeafened]);

  const toggleCamera = useCallback(async () => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const newState = !isCameraActive;
    if (newState) {
      if (stream.getVideoTracks().length === 0) {
        const ns = await navigator.mediaDevices.getUserMedia({
          video: (videoDeviceId && videoDeviceId !== "default") ? { deviceId: { ideal: videoDeviceId } } : true,
        });
        const track = ns.getVideoTracks()[0];
        stream.addTrack(track);
      }
      stream.getVideoTracks().forEach(t => t.enabled = true);
      sfuRef.current?.publishTracks(new MediaStream(stream.getVideoTracks()), "cam");
    } else {
      stream.getVideoTracks().forEach(t => t.enabled = false);
      sfuRef.current?.unpublishTrack(`cam-video-${myIdRef.current}`);
    }
    voiceDispatch({ type: "SET_CAMERA", payload: newState });
  }, [isCameraActive, videoDeviceId]);

  const toggleScreenShare = useCallback(async (options?: { quality?: string; withAudio?: boolean; changeSource?: boolean }) => {
    if (isScreenSharing && !options?.changeSource && !options?.quality && options?.withAudio === undefined) {
      screenStreamRef.current?.getTracks().forEach(t => t.stop());
      screenStreamRef.current = null;
      voiceDispatch({ type: "SET_SCREEN_SHARING", payload: false, stream: null, audio: false });
      sfuRef.current?.stopTracks([`screen-video-${myIdRef.current}`, `screen-audio-${myIdRef.current}`]);
    } else {
      try {
        const targetQuality = options?.quality || currentScreenQuality;
        const targetAudio = options?.withAudio !== undefined ? options.withAudio : isStreamingAudio;

        if (isScreenSharing && !options?.changeSource) {
          voiceDispatch({ type: "SET_SCREEN_QUALITY", payload: targetQuality });
          voiceDispatch({ type: "SET_SCREEN_SHARING", payload: true, stream: localScreenStream, audio: targetAudio });
          if (screenStreamRef.current) {
            screenStreamRef.current.getAudioTracks().forEach(t => t.enabled = targetAudio);
            const videoTrack = screenStreamRef.current.getVideoTracks()[0];
            if (videoTrack) {
              const qMap: Record<string, { width: number; height: number }> = {
                "720p": { width: 1280, height: 720 }, "1080p": { width: 1920, height: 1080 },
                "1440p": { width: 2560, height: 1440 }, "4k": { width: 3840, height: 2160 },
              };
              const fps = targetQuality.endsWith("60") ? 60 : 30;
              const res = qMap[targetQuality.replace(/\d+$/, "")];
              if (res) videoTrack.applyConstraints({ width: { ideal: res.width }, height: { ideal: res.height }, frameRate: { ideal: fps } }).catch(() => { });
            }
          }
          return;
        }

        const qMap: Record<string, { width: number; height: number }> = {
          "720p": { width: 1280, height: 720 }, "1080p": { width: 1920, height: 1080 },
          "1440p": { width: 2560, height: 1440 }, "4k": { width: 3840, height: 2160 },
        };
        const fps = targetQuality.endsWith("60") ? 60 : 30;
        const res = qMap[targetQuality.replace(/\d+$/, "")];
        const audioC = targetAudio ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false } : false;
        const videoC = res ? { width: { ideal: res.width }, height: { ideal: res.height }, frameRate: { ideal: fps } } : true;

        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getDisplayMedia({ video: videoC, audio: audioC as any });
        } catch (err: any) {
          if (targetAudio && err.name !== "NotAllowedError") {
            stream = await navigator.mediaDevices.getDisplayMedia({ video: videoC, audio: false });
          } else throw err;
        }
        if (screenStreamRef.current) screenStreamRef.current.getTracks().forEach(t => { t.onended = null; t.stop(); });
        screenStreamRef.current = stream;
        voiceDispatch({ type: "SET_SCREEN_SHARING", payload: true, stream, audio: targetAudio });
        voiceDispatch({ type: "SET_SCREEN_QUALITY", payload: targetQuality });
        sfuRef.current?.publishTracks(stream, "screen");

        stream.getVideoTracks()[0].onended = () => {
          voiceDispatch({ type: "SET_SCREEN_SHARING", payload: false, stream: null, audio: false });
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
    if (screenStreamRef.current) screenStreamRef.current.getAudioTracks().forEach(t => t.enabled = next);
    voiceDispatch({ type: "SET_SCREEN_SHARING", payload: isScreenSharing, stream: localScreenStream, audio: next });
  }, [isStreamingAudio, isScreenSharing, localScreenStream]);

  const onToggleWatch = useCallback((id: string) => {
    voiceDispatch({ type: "SET_WATCHED", payload: (prev) => ({ ...prev, [id]: !prev[id] }) });
  }, []);

  // ── Build grid items from SFU participants (no ChatProvider needed) ────

  const gridItems = useMemo(() => {
    const items: GridItem[] = [];

    if (joined) {
      const myName = user?.username || user?.fullName || guestName || "You";
      items.push({
        id: `local-camera-${myIdRef.current}`,
        userId: user?.id || myIdRef.current,
        name: myName,
        avatar: user?.imageUrl || null,
        stream: localStreamRef.current,
        isLocal: true,
        type: isCameraOn ? "camera" : "avatar",
        isStreaming: false,
        isMuted: !isMicOn,
        isDeafened,
        isSpeaking: !!speakingUsers[myIdRef.current],
      });

      if (isScreenSharing && localScreenStream) {
        items.push({
          id: `local-screen-${myIdRef.current}`,
          userId: user?.id || myIdRef.current,
          name: myName,
          avatar: user?.imageUrl || null,
          stream: localScreenStream,
          isLocal: true,
          type: "screen",
          isStreaming: true,
          isMuted: false,
          isDeafened: false,
          isSpeaking: false,
        });
      }
    }

    // Remote participants — derived from SFU events
    participants.forEach((p) => {
      if (p.id === myIdRef.current) return;

      const userStreams = remoteStreams[p.id] || {};

      if (!remoteAggregatorsRef.current[p.id]) {
        remoteAggregatorsRef.current[p.id] = { cam: new MediaStream(), screen: new MediaStream() };
      }
      const agg = remoteAggregatorsRef.current[p.id];

      const updateTracks = (type: "cam" | "screen", prefix: string) => {
        const targetTracks = new Set<MediaStreamTrack>();
        Object.entries(userStreams).forEach(([name, s]) => {
          if (name.startsWith(prefix)) (s as MediaStream).getTracks().forEach(t => targetTracks.add(t));
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

      updateTracks("cam", "cam-");
      updateTracks("screen", "screen-");

      items.push({
        id: `remote-camera-${p.id}`,
        userId: p.clerk_user_id || p.id,
        name: p.name,
        avatar: p.avatar_url || null,
        stream: agg.cam.getTracks().length > 0 ? agg.cam : null,
        isLocal: false,
        type: p.self_video ? "camera" : "avatar",
        isStreaming: false,
        isMuted: p.self_mute,
        isDeafened: p.self_deaf || false,
        isSpeaking: !!speakingUsers[p.id],
      });

      if (p.self_stream) {
        items.push({
          id: `remote-screen-${p.id}`,
          userId: p.clerk_user_id || p.id,
          name: `${p.name}'s Stream`,
          avatar: p.avatar_url || null,
          stream: agg.screen.getTracks().length > 0 ? agg.screen : null,
          isLocal: false,
          type: "screen",
          isStreaming: true,
          isMuted: false,
          isDeafened: false,
          isSpeaking: false,
        });
      }
    });

    return items;
  }, [joined, user, guestName, isMicOn, isDeafened, isScreenSharing, localScreenStream, remoteStreams, speakingUsers, participants, isCameraOn]);

  return {
    joined,
    isScreenSharing,
    localScreenStream,
    isStreamingAudio,
    currentScreenQuality,
    isCameraActive,
    connectionState,
    focusedId,
    setFocusedId: (id: string | null) => voiceDispatch({ type: "SET_FOCUSED", payload: id }),
    speakingUsers,
    watchedStreams,
    streamThumbnails,
    gridItems,
    audioBlocked,
    setAudioBlocked: (blocked: boolean) => voiceDispatch({ type: "SET_AUDIO_BLOCKED", payload: blocked }),
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
      peerSettings,
    },
    isMicOn,
    isDeafened,
    isCameraOn,
    vcMembers: participants,
    hasMicrophone,
    hasCamera,
    sfu: sfuRef.current,
    settingsUserId,
  };
}
