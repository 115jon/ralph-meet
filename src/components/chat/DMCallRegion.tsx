"use client";

import { getAuthAssetUrl } from "@/lib/platform";
import { playCallEnd, resumeSoundContext } from "@/lib/sounds";
import { cn } from "@/lib/utils";
import { prewarmAudioContext } from "@/lib/voice/audio-pipeline";
import { useChatStore } from "@/stores/chat-store";
import { useCallStore } from "@/stores/useCallStore";
import { useCallVoiceStore } from "@/stores/useCallVoiceStore";
import { useVoiceSettingsStore } from "@/stores/useVoiceSettingsStore";
import { HeadphoneOff, Headphones, Mic, MicOff, Monitor, Phone, PhoneOff, Video, VideoOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ParticipantCard } from "../voice/ParticipantCard";

/**
 * In-DM call region rendered inside ChatArea when a call is active/ringing
 * for the current DM channel. Takes up space in the chat column (not overlay).
 * Shows participant avatars with mute/deafen badges, media tiles for
 * camera/screen streams, controls, and join buttons.
 */
export function DMCallRegion({ channelId }: { channelId: string }) {
  const { status, callId, remoteUser, channelId: callChannelId, startedAt } = useCallStore();
  const gateway = useChatStore((s) => s.gateway);
  const currentUser = useChatStore((s) => s.user);

  // Call voice state from the SFU
  const callVoice = useCallVoiceStore();

  // Mute/deafen from voice settings (works globally)
  const isMuted = useVoiceSettingsStore((s) => s.getSettings().isMuted);
  const isDeafened = useVoiceSettingsStore((s) => s.getSettings().isDeafened);

  const [duration, setDuration] = useState("0:00");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Duration timer
  useEffect(() => {
    if (status !== "active" || !startedAt) {
      setDuration("0:00");
      return;
    }
    const tick = () => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      const mins = Math.floor(elapsed / 60);
      const secs = elapsed % 60;
      setDuration(`${mins}:${secs.toString().padStart(2, "0")}`);
    };
    tick();
    intervalRef.current = setInterval(tick, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [status, startedAt]);

  // Only show if there's a call for THIS DM channel
  if (callChannelId !== channelId || status === "idle") return null;

  const isActive = status === "active";
  const isRingingOutgoing = status === "ringing_outgoing";
  const isRingingIncoming = status === "ringing_incoming";

  // Build participant list
  const participants: { id: string; username: string; avatarUrl?: string }[] = [];

  if (currentUser && (isActive || isRingingOutgoing)) {
    participants.push({
      id: currentUser.id,
      username: currentUser.username,
      avatarUrl: currentUser.avatar_url,
    });
  }

  if (remoteUser) {
    participants.push({
      id: remoteUser.id,
      username: remoteUser.username,
      avatarUrl: remoteUser.avatar_url,
    });
  }

  const handleAccept = () => {
    // Prewarm AudioContext during this user gesture so the SFU (created
    // asynchronously after CALL_START) gets a running context, not a
    // suspended one. Without this, Chrome's autoplay policy blocks audio.
    prewarmAudioContext();
    resumeSoundContext();
    // Force voice disconnect before accepting
    window.dispatchEvent(new CustomEvent("force-voice-disconnect"));
    callId && gateway?.sendCallAccept(callId);
  };
  const handleAcceptWithVideo = () => {
    handleAccept();
    // Queue camera enable after the SFU connects
    const unsub = useCallVoiceStore.subscribe((state) => {
      if (state.toggleCamera) {
        state.toggleCamera();
        unsub();
      }
    });
  };
  const handleDecline = () => callId && gateway?.sendCallDecline(callId);
  const handleEnd = () => {
    // Play call-end sound immediately (the gateway CALL_END handler will
    // skip it since we set status to "idle" below, preventing double-play)
    playCallEnd();
    // Send end signal to server AND disconnect SFU
    if (callId) gateway?.sendCallEnd(callId);
    callVoice.handleLeave?.();
    // Reset call store locally — CALL_END event may never arrive from server
    useCallStore.getState().endCall("local");
  };
  // Create a display list of grid items, optionally injecting the ringing remote user
  const displayItems = [...callVoice.gridItems];
  if (isActive && remoteUser && !displayItems.some(i => i.userId === remoteUser.id)) {
    displayItems.push({
      id: `ringing-${remoteUser.id}`,
      userId: remoteUser.id,
      name: remoteUser.username,
      avatar: remoteUser.avatar_url,
      type: "camera",
      isLocal: false,
      isSpeaking: false,
      isMuted: true,
      isDeafened: false,
      serverMute: false,
      volume: 1,
      stream: null,
      isStreaming: false,
      isRinging: true,
    } as any);
  }

  // Sort local user first
  displayItems.sort((a, b) => (a.isLocal ? -1 : b.isLocal ? 1 : 0));

  const hasVideoFeed = isActive && displayItems.some(i => (i.type === 'camera' && i.stream && i.stream.getVideoTracks().length > 0) || i.type === 'screen');

  return (
    <div className="shrink-0 w-full min-h-[300px] bg-black border-b border-rm-border flex flex-col relative overflow-hidden group">

      {/* Video Grid OR Avatar Circles */}
      {hasVideoFeed ? (
        <div className="flex-1 p-4 w-full h-full flex flex-col justify-center">
          <div className={cn(
            "grid gap-4 w-full max-h-full aspect-video md:aspect-auto",
            displayItems.length === 1 ? "grid-cols-1 max-w-4xl mx-auto h-full" :
              displayItems.length === 2 ? "grid-cols-2 max-w-6xl mx-auto h-full lg:h-auto lg:aspect-video" :
                "grid-cols-2 md:grid-cols-3 h-full"
          )}>
            {displayItems.map((item) => (
              <div key={item.id} className="min-h-[140px] md:min-h-[180px] w-full shrink-0 h-full">
                <ParticipantCard
                  item={item}
                  isFocused={false}
                  isTray={false}
                  globalDeafened={isDeafened}
                  onClick={() => { }}
                  watchedStreams={{}}
                  streamThumbnails={{}}
                  voiceActions={{
                    onToggleScreenShare: callVoice.toggleScreenShare || (() => { }),
                    isCurrentUserStreaming: callVoice.isScreenSharing,
                    currentScreenQuality: callVoice.screenQuality,
                    isStreamingAudio: callVoice.isStreamingAudio,
                    onToggleStreamAudio: callVoice.onToggleStreamAudio || (() => { }),
                    onToggleWatch: () => { },
                    watchedStreams: {},
                    availableQualities: [],
                    onLeave: handleEnd,
                    isMuted: !callVoice.isMicOn,
                    onToggleMute: callVoice.toggleMic || (() => { }),
                    isDeafened: isDeafened,
                    onToggleDeafen: callVoice.toggleDeafen || (() => { }),
                    onChangeSource: () => { },
                    sfu: callVoice.sfu!
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      ) : (
        /* Status text at top for ringing states when no video */
        <div className="flex-1 flex flex-col relative">
          <div className="absolute top-4 left-0 right-0 text-center z-10">
            {isRingingOutgoing && (
              <p className="text-sm font-medium text-rm-text-muted animate-pulse">Calling...</p>
            )}
            {isRingingIncoming && (
              <p className="text-sm font-medium text-rm-text-muted animate-pulse">
                {remoteUser?.username} is calling...
              </p>
            )}
          </div>

          <div className="flex-1 flex items-center justify-center gap-8 sm:gap-16 p-8">
            {(isActive ? displayItems : participants.map(p => ({
              id: p.id,
              name: p.username,
              avatar: p.avatarUrl,
              isLocal: p.id === currentUser?.id,
              isMuted: p.id === currentUser?.id ? (callVoice.isMicOn === false) : false,
              isDeafened: p.id === currentUser?.id ? isDeafened : false,
              isSpeaking: false,
              isRinging: isRingingOutgoing && p.id !== currentUser?.id
            }))).map((item: any) => {
              const src = item.avatar ? getAuthAssetUrl(item.avatar) : undefined;
              return (
                <div key={item.id} className="relative flex flex-col items-center">
                  <div className={cn(
                    "h-24 w-24 md:h-32 md:w-32 rounded-full overflow-hidden border-2 transition-all",
                    item.isSpeaking ? "border-primary shadow-[0_0_20px_var(--rm-glow)]" : "border-transparent",
                    item.isRinging && "animate-pulse border-primary/50 shadow-[0_0_15px_var(--rm-glow)]"
                  )}>
                    {src ? (
                      <img src={src} alt={item.name} className="h-full w-full object-cover" />
                    ) : (
                      <div className="h-full w-full flex items-center justify-center bg-rm-bg-surface text-4xl font-bold text-rm-text-muted">
                        {item.name?.[0]?.toUpperCase()}
                      </div>
                    )}
                  </div>
                  {/* Mute/Deafen badge */}
                  {(item.isMuted || item.isDeafened) && (
                    <div className="absolute top-[70px] md:top-[96px] -right-2 flex h-8 w-8 items-center justify-center rounded-full bg-rm-bg-elevated border-2 border-black">
                      {item.isDeafened ? (
                        <HeadphoneOff className="h-4 w-4 text-red-500" />
                      ) : (
                        <MicOff className="h-4 w-4 text-red-500" />
                      )}
                    </div>
                  )}
                  {item.isRinging && (
                    <span className="absolute -bottom-3 bg-rm-bg-surface/80 backdrop-blur rounded-full px-3 py-0.5 text-[10px] font-bold text-rm-text animate-pulse border border-rm-border whitespace-nowrap">
                      Calling...
                    </span>
                  )}
                  <div className="mt-4 text-center">
                    <p className="text-sm font-bold text-rm-text">{item.name}</p>
                    {item.isLocal && <p className="text-[11px] font-medium text-rm-text-muted">You</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Controls Container (Absolute positioned at the bottom in Discord style) */}
      <div className={cn(
        "bg-gradient-to-t from-black/80 to-transparent pt-12 pb-4 px-6 flex items-center justify-center transition-opacity duration-300",
        // In video mode, fade controls out when not hovering the region, like Discord
        hasVideoFeed ? "opacity-0 group-hover:opacity-100 absolute bottom-0 left-0 right-0 z-50" : "relative"
      )}>

        {isActive && (
          <div className="flex items-center gap-4 bg-rm-bg-elevated/90 backdrop-blur-xl px-4 py-2 rounded-2xl border border-white/10 shadow-2xl">
            <button
              onClick={() => callVoice.toggleMic?.()}
              className={cn(
                "flex h-12 w-12 items-center justify-center rounded-full transition-all",
                isMuted
                  ? "bg-red-500/20 text-red-400 hover:bg-red-500/30"
                  : "bg-white/10 text-rm-text hover:bg-white/20"
              )}
              title={isMuted ? "Unmute" : "Mute"}
            >
              {isMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
            </button>
            <button
              onClick={() => callVoice.toggleDeafen?.()}
              className={cn(
                "flex h-12 w-12 items-center justify-center rounded-full transition-all",
                isDeafened
                  ? "bg-red-500/20 text-red-400 hover:bg-red-500/30"
                  : "bg-white/10 text-rm-text hover:bg-white/20"
              )}
              title={isDeafened ? "Undeafen" : "Deafen"}
            >
              {isDeafened ? <HeadphoneOff className="h-5 w-5" /> : <Headphones className="h-5 w-5" />}
            </button>
            <button
              onClick={() => callVoice.toggleCamera?.()}
              className={cn(
                "flex h-12 w-12 items-center justify-center rounded-full transition-all",
                callVoice.isCameraActive
                  ? "bg-white/10 text-rm-text hover:bg-white/20"
                  : "bg-white/5 text-rm-text-muted hover:bg-white/10"
              )}
              title={callVoice.isCameraActive ? "Turn Off Camera" : "Turn On Camera"}
            >
              {callVoice.isCameraActive ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
            </button>
            <button
              onClick={() => callVoice.toggleScreenShare?.()}
              className={cn(
                "flex h-12 w-12 items-center justify-center rounded-full transition-all",
                callVoice.isScreenSharing
                  ? "bg-primary/20 text-primary hover:bg-primary/30"
                  : "bg-white/5 text-rm-text-muted hover:bg-white/10"
              )}
              title={callVoice.isScreenSharing ? "Stop Sharing" : "Share Screen"}
            >
              <Monitor className="h-5 w-5" />
            </button>
            <div className="w-[1px] h-8 bg-white/10 mx-2" /> {/* Divider */}
            <button
              onClick={handleEnd}
              className="flex h-12 w-16 items-center justify-center rounded-full bg-red-500 hover:bg-red-600 text-white transition-all shadow-lg shadow-red-500/20"
              title="Leave Call"
            >
              <Phone className="h-6 w-6 rotate-135" />
            </button>
          </div>
        )}

        {isRingingIncoming && (
          <div className="flex items-center gap-4 bg-rm-bg-elevated/90 backdrop-blur-xl px-4 py-2 rounded-2xl border border-white/10 shadow-2xl">
            <button
              onClick={handleAccept}
              className="flex items-center gap-2 h-12 px-6 rounded-full bg-green-600 hover:bg-green-500 text-white font-bold transition-all shadow-lg shadow-green-600/20"
            >
              <Phone className="h-5 w-5" />
              Join Voice
            </button>
            <button
              onClick={handleAcceptWithVideo}
              className="flex items-center gap-2 h-12 px-6 rounded-full bg-green-600 hover:bg-green-500 text-white font-bold transition-all shadow-lg shadow-green-600/20"
            >
              <Video className="h-5 w-5" />
              Join Video
            </button>
            <div className="w-[1px] h-8 bg-white/10 mx-2" />
            <button
              onClick={handleDecline}
              className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 hover:bg-red-500/20 text-rm-text hover:text-red-400 transition-all"
              title="Decline"
            >
              <PhoneOff className="h-5 w-5" />
            </button>
          </div>
        )}

        {isRingingOutgoing && (
          <div className="flex items-center gap-4 bg-rm-bg-elevated/90 backdrop-blur-xl px-4 py-2 rounded-2xl border border-white/10 shadow-2xl">
            <button
              onClick={handleEnd}
              className="flex items-center gap-2 h-12 px-6 rounded-full bg-red-500 hover:bg-red-600 text-white font-bold transition-all shadow-lg shadow-red-500/20"
            >
              <PhoneOff className="h-5 w-5" />
              Cancel Call
            </button>
          </div>
        )}
      </div>

      {isActive && duration && (
        <div className={cn(
          "absolute right-4 text-xs font-bold text-rm-text-muted/50 tabular-nums pointer-events-none transition-opacity duration-300 z-50",
          hasVideoFeed ? "top-4 opacity-0 group-hover:opacity-100" : "bottom-6"
        )}>
          {duration}
        </div>
      )}
    </div>
  );
}

/**
 * Simple video tile for rendering camera/screen streams in the call region.
 */
function MediaTile({ item }: { item: { id: string; name: string; stream?: MediaStream | null; type: string } }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && item.stream) {
      videoRef.current.srcObject = item.stream;
    }
  }, [item.stream]);

  if (!item.stream || item.stream.getTracks().length === 0) return null;

  const hasVideoTrack = item.stream.getVideoTracks().length > 0;
  if (!hasVideoTrack) return null;

  return (
    <div className="relative rounded-xl overflow-hidden bg-rm-bg-primary aspect-video">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={item.type !== "screen"}
        className="w-full h-full object-contain"
      />
      <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded-md bg-black/60 text-[11px] text-white font-medium">
        {item.name}{item.type === "screen" ? " — Screen" : ""}
      </div>
    </div>
  );
}
