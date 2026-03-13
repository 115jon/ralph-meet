"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useUserResolution } from "@/hooks/useUserResolution";
import { getAuthAssetUrl } from "@/lib/platform";
import { playCallEnd, playRingStop, resumeSoundContext } from "@/lib/sounds";
import { cn } from "@/lib/utils";
import { prewarmAudioContext } from "@/lib/voice/audio-pipeline";
import { getAvailableStreamQualities } from "@/lib/voice/utils";
import { useChatStore } from "@/stores/chat-store";
import { useCallStore } from "@/stores/useCallStore";
import { useCallVoiceStore } from "@/stores/useCallVoiceStore";
import { useVoiceSettingsStore } from "@/stores/useVoiceSettingsStore";
import { ChevronUp, HeadphoneOff, MicOff, Phone, Video, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { UnifiedScreenShareModal } from "../UnifiedScreenShareModal";
import { VoiceControls } from "../voice/VoiceControls";
import { VoiceGrid } from "../voice/VoiceGrid";

/** Stable empty array for Zustand selector fallback (avoids infinite re-renders) */
const EMPTY_MEMBERS: any[] = [];

/**
 * In-DM call region rendered inside ChatArea when a call is active/ringing
 * for the current DM channel. Takes up space in the chat column (not overlay).
 * Shows participant avatars with mute/deafen badges, media tiles for
 * camera/screen streams, controls, and join buttons.
 */
export function DMCallRegion({ channelId }: { channelId: string }) {
  const { status, callId, remoteUser, channelId: callChannelId, startedAt, hasConnected, hasJoinedSFU, voiceRoomId } = useCallStore();
  const gateway = useChatStore((s) => s.gateway);
  const currentUser = useChatStore((s) => s.user);

  const activeRemoteUser = useUserResolution(remoteUser?.id, remoteUser);
  const activeCurrentUser = useUserResolution(currentUser?.id, currentUser);

  // Voice channel members for this DM channel (unified voice state).
  // IMPORTANT: fallback must be a stable reference — creating `[]` inside a
  // Zustand selector causes Object.is to fail every render → infinite loop.
  const voiceMembers = useChatStore((s) => s.voiceChannelStates[channelId]) ?? EMPTY_MEMBERS;

  // Call voice state from the SFU
  const callVoice = useCallVoiceStore();

  // Mute/deafen from voice settings (works globally)
  const isMuted = useVoiceSettingsStore((s) => s.getSettings().isMuted);
  const isDeafened = useVoiceSettingsStore((s) => s.getSettings().isDeafened);

  const dmChannel = useChatStore((s) => s.dmChannels.find(c => c.id === channelId)) as any;
  const otherUserId = dmChannel?.user_1_id === currentUser?.id ? dmChannel?.user_2_id : dmChannel?.user_1_id;

  const isActive = voiceMembers.length > 0;
  const isRingingOutgoing = status === "ringing_outgoing" && callChannelId === channelId;
  const isRingingIncoming = status === "ringing_incoming" && callChannelId === channelId;

  // Duration timer
  useEffect(() => {
    if (!isActive) {
      setDuration("0:00");
      return;
    }
    // If we rely on isActive (voiceMembers > 0), we just start timer from when we render active
    // Realistic fix: use useCallStore's startedAt if available, otherwise just use now as fallback
    const start = startedAt || Date.now();
    const tick = () => {
      const elapsed = Math.floor((Date.now() - start) / 1000);
      const mins = Math.floor(elapsed / 60);
      const secs = elapsed % 60;
      setDuration(`${mins}:${secs.toString().padStart(2, "0")}`);
    };
    tick();
    intervalRef.current = setInterval(tick, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isActive, startedAt]);

  const [duration, setDuration] = useState("0:00");
  const [isExpanded, setIsExpanded] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [isScreenModalOpen, setIsScreenModalOpen] = useState(false);
  const [showMembers, setShowMembers] = useState(true);
  const [isChatHidden, setIsChatHidden] = useState(false);
  const [focusedId, setFocusedId] = useState<string | null>(null);

  // Only show if there's someone in the voice channel OR if it's currently ringing
  if (!isActive && !isRingingOutgoing && !isRingingIncoming) return null;

  // Deterministically compute voiceRoomId if active
  const sortedIds = [currentUser?.id || "", otherUserId || ""].sort();
  const computedVoiceRoomId = `dm-call-${sortedIds[0]}-${sortedIds[1]}`;
  const actualVoiceRoomId = voiceRoomId || computedVoiceRoomId;

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleAccept = () => {
    prewarmAudioContext();
    resumeSoundContext();
    window.dispatchEvent(new CustomEvent("force-voice-disconnect"));

    if (isRingingIncoming && callId) {
      // Answering a ringing call — MUST send accept to the server so it
      // clears the pending ring and transitions both parties to active.
      // Note: isActive may already be true here because the caller is already
      // in the voice channel, but we still need the server handshake.
      gateway?.sendCallAccept(callId);
    } else if (isActive) {
      // Rejoining an existing call (lobby → SFU).
      // After a page reload the call store is empty (idle), so we need to
      // bootstrap the full call metadata before CallVoiceManager can render.
      const store = useCallStore.getState();
      if (store.status === "idle") {
        // Reconstruct remote user from the voice channel member list
        const remoteMember = voiceMembers.find((m: any) => m.clerk_user_id !== currentUser?.id);
        const remoteInfo = remoteMember
          ? { id: remoteMember.clerk_user_id, username: remoteMember.name ?? "User", avatar_url: remoteMember.avatar_url }
          : otherUserId
            ? { id: otherUserId, username: activeRemoteUser.displayName, avatar_url: activeRemoteUser.avatarUrl || undefined }
            : null;

        // Set the store to active with all required metadata so CallVoiceManager renders
        useCallStore.setState({
          status: "active",
          callId: null, // no call_id — this is a cold rejoin
          remoteUser: remoteInfo,
          channelId,
          voiceRoomId: actualVoiceRoomId,
          startedAt: Date.now(),
          endReason: null,
          hasConnected: true,
          hasJoinedSFU: true,
        });
      } else {
        // Already have call metadata, just flip SFU on
        store.joinSFU();
      }
    }
  };

  const handleAcceptWithVideo = () => {
    handleAccept();
    const unsub = useCallVoiceStore.subscribe((state) => {
      if (state.toggleCamera) {
        state.toggleCamera();
        unsub();
      }
    });
  };

  const handleDecline = () => {
    playRingStop();
    if (callId) gateway?.sendCallDecline(callId);
    useCallStore.getState().endCall("declined");
  };

  const handleLeave = () => {
    // Leave the SFU but KEEP the user looking at the lobby.
    // The SFU disconnect (via callVoice.handleLeave) sends sendVoiceChannelLeave
    // which removes from voiceChannelMembers → broadcasts VOICE_CHANNEL_STATE_UPDATE.
    playCallEnd();
    callVoice.handleLeave?.();
    useCallStore.getState().leaveCall();
  };

  const handleCancelCall = () => {
    playRingStop();
    if (callId) gateway?.sendCallEnd(callId);
    // Let the server's CALL_CANCELLED callback handle state updates for the caller
  };



  // ── Display items ─────────────────────────────────────────────────────────

  const displayItems = [...callVoice.gridItems];

  // Resolve who the other person is for the UI overlay
  let computedRemoteUser = remoteUser;
  if (!computedRemoteUser && activeRemoteUser && otherUserId) {
    computedRemoteUser = { id: otherUserId, username: activeRemoteUser.username, avatar_url: activeRemoteUser.avatarUrl || undefined };
  } else if (!computedRemoteUser && otherUserId) {
    // Try to guess from voice members if remoteUser isn't in useCallStore anymore
    const member = voiceMembers.find(m => m.clerk_user_id === otherUserId);
    computedRemoteUser = { id: otherUserId, username: member?.name || "User", avatar_url: member?.avatar_url };
  }

  // Find if remote user is actually sitting in the voice channel natively right now
  const isRemoteUserInLobby = voiceMembers.some(m => m.clerk_user_id === computedRemoteUser?.id);
  const fakeHasConnected = hasConnected || isRemoteUserInLobby;

  if (isActive && computedRemoteUser && !fakeHasConnected && !displayItems.some(i => i.userId === computedRemoteUser?.id)) {
    // Remote user hasn't connected yet (ringing) — show their avatar with pulse
    displayItems.push({
      id: `ringing-${computedRemoteUser.id}`,
      userId: computedRemoteUser.id,
      name: computedRemoteUser.username,
      avatar: computedRemoteUser.avatar_url,
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
  displayItems.sort((a, b) => (a.isLocal ? -1 : b.isLocal ? 1 : 0));

  // When NOT in the SFU, build a participant display list.
  // Priority: call store metadata (for ringing), then voice channel members (for active/reload).
  const lobbyParticipants: { id: string; name: string; avatarUrl?: string; isLocal: boolean; isMuted: boolean; isDeafened: boolean; isInVoice: boolean }[] = [];

  if (!hasJoinedSFU && (isActive || isRingingOutgoing || isRingingIncoming)) {
    if (isRingingOutgoing || isRingingIncoming) {
      // ── Ringing state: use call store metadata ──────────────────────────
      // Show ourselves (caller always, callee with pulse)
      if (currentUser) {
        const meInVoice = voiceMembers.some((m: any) => m.clerk_user_id === currentUser.id);
        const shouldShowMe = isRingingOutgoing ? true : meInVoice;
        if (shouldShowMe) {
          lobbyParticipants.push({
            id: currentUser.id,
            name: activeCurrentUser.displayName,
            avatarUrl: activeCurrentUser.avatarUrl || undefined,
            isLocal: true,
            isMuted,
            isDeafened,
            isInVoice: meInVoice,
          });
        }
      }
      if (remoteUser) {
        const remoteMember = voiceMembers.find((m: any) => m.clerk_user_id === remoteUser.id);
        lobbyParticipants.push({
          id: remoteUser.id,
          name: activeRemoteUser.displayName,
          avatarUrl: activeRemoteUser.avatarUrl || undefined,
          isLocal: false,
          isMuted: remoteMember?.self_mute ?? false,
          isDeafened: remoteMember?.self_deaf ?? false,
          isInVoice: !!remoteMember,
        });
      }
    } else {
      // ── Active lobby (not ringing): show voice channel members ──────────
      // This handles page reload, re-joining, or viewing an ongoing call.
      // We show everyone currently in the voice channel EXCEPT ourselves.
      for (const m of voiceMembers) {
        if (m.clerk_user_id === currentUser?.id) continue; // don't show ourselves in lobby
        lobbyParticipants.push({
          id: m.clerk_user_id,
          name: m.name ?? "User",
          avatarUrl: m.avatar_url,
          isLocal: false,
          isMuted: m.self_mute ?? false,
          isDeafened: m.self_deaf ?? false,
          isInVoice: true,
        });
      }
    }
  }

  const hasVideoFeed = isActive && hasJoinedSFU && displayItems.some(i => (i.type === 'camera' && i.stream && i.stream.getVideoTracks().length > 0) || i.type === 'screen');
  const isFullscreenView = hasVideoFeed || isExpanded || isChatHidden;

  return (
    <div className={cn(
      "shrink-0 w-full flex flex-col relative overflow-hidden group transition-colors duration-300",
      "bg-black",
      isExpanded ? "fixed inset-0 z-200 border-none" : isChatHidden ? "flex-1 absolute inset-0 z-40 border-none" : "min-h-[300px] border-b border-rm-border"
    )}>

      {/* Video Grid (only when joined SFU and has video) */}
      {isFullscreenView && hasJoinedSFU ? (
        <div className="flex-1 p-0 md:p-4 w-full h-full flex flex-col justify-center">
          <div className="w-full h-full relative overflow-y-auto no-scrollbar scrollbar-hide">
            <VoiceGrid
              className="pt-4 px-4 pb-4 md:pt-6 md:px-6 md:pb-6"
              items={displayItems}
              focusedId={focusedId}
              onFocus={setFocusedId}
              globalDeafened={isDeafened}
              currentSettings={{ peerSettings: {} }}
              watchedStreams={callVoice.watchedStreams}
              streamThumbnails={callVoice.streamThumbnails}
              voiceActions={{
                onToggleScreenShare: callVoice.toggleScreenShare || (() => { }),
                isCurrentUserStreaming: callVoice.isScreenSharing,
                currentScreenQuality: callVoice.screenQuality,
                isStreamingAudio: callVoice.isStreamingAudio,
                onToggleStreamAudio: callVoice.onToggleStreamAudio || (() => { }),
                onToggleWatch: callVoice.onToggleWatch || (() => { }),
                watchedStreams: callVoice.watchedStreams,
                availableQualities: getAvailableStreamQualities(),
                onLeave: handleLeave,
                isMuted: !callVoice.isMicOn,
                onToggleMute: callVoice.toggleMic || (() => { }),
                isDeafened: isDeafened,
                onToggleDeafen: callVoice.toggleDeafen || (() => { }),
                onChangeSource: () => setIsScreenModalOpen(true),
                sfu: null
              }}
            />
          </div>
        </div>
      ) : (
        /* Avatar circles view (lobby / ringing / audio-only states) */
        <div className="flex-1 flex flex-col relative">
          <div className="absolute top-4 left-0 right-0 text-center z-10">
            {isRingingOutgoing && (
              <p className="text-sm font-medium text-white/70 animate-pulse">Calling...</p>
            )}
            {isRingingIncoming && (
              <p className="text-sm font-medium text-white/70 animate-pulse">
                {activeRemoteUser.displayName} is calling...
              </p>
            )}
          </div>

          <div className="flex-1 flex items-center justify-center p-8">
            <div className="flex items-start justify-center gap-8 sm:gap-16">
              {(isActive && hasJoinedSFU ? displayItems : lobbyParticipants).map((p: any) => {
                const isLobby = !hasJoinedSFU || !isActive;
                const item = isLobby ? {
                  id: p.id,
                  userId: p.id,
                  name: p.name || p.username,
                  avatar: p.avatarUrl || p.avatar,
                  isLocal: p.isLocal ?? (p.id === currentUser?.id),
                  isMuted: p.isMuted ?? false,
                  isDeafened: p.isDeafened ?? false,
                  isSpeaking: false,
                  isRinging: isRingingOutgoing && p.id !== currentUser?.id,
                  isRingingWhite: isRingingIncoming && p.id === currentUser?.id,
                  isInVoice: p.isInVoice ?? true,
                } : p;
                const src = item.avatar ? getAuthAssetUrl(item.avatar) : undefined;
                return (
                  <div key={item.id} className="relative flex flex-col items-center">
                    <div className={cn(
                      "h-24 w-24 md:h-32 md:w-32 rounded-full overflow-hidden border-2 transition-all",
                      item.isSpeaking ? "border-primary shadow-[0_0_20px_var(--rm-glow)]" : "border-transparent",
                      item.isRinging && "animate-pulse border-primary/50 shadow-[0_0_15px_var(--rm-glow)]",
                      item.isRingingWhite && "animate-pulse border-white shadow-[0_0_15px_rgba(255,255,255,0.7)]",
                      isLobby && !item.isLocal && !item.isInVoice && !item.isRinging && !item.isRingingWhite && "opacity-40"
                    )}>
                      {src ? (
                        <img src={src} alt={item.name} className="h-full w-full object-cover" />
                      ) : (
                        <div className="h-full w-full flex items-center justify-center bg-zinc-800 text-4xl font-bold text-zinc-400">
                          {item.name?.[0]?.toUpperCase()}
                        </div>
                      )}
                    </div>
                    {/* Mute/Deafen badge */}
                    {(item.isMuted || item.isDeafened) && (
                      <div className="absolute top-[70px] md:top-[96px] -right-2 flex h-8 w-8 items-center justify-center rounded-full bg-zinc-900 border-2 border-black">
                        {item.isDeafened ? (
                          <HeadphoneOff className="h-4 w-4 text-red-500" />
                        ) : (
                          <MicOff className="h-4 w-4 text-red-500" />
                        )}
                      </div>
                    )}
                    {item.isRinging && (
                      <span className="absolute -bottom-3 bg-zinc-900/80 backdrop-blur rounded-full px-3 py-0.5 text-[10px] font-bold text-white animate-pulse border border-zinc-700 whitespace-nowrap">
                        Calling...
                      </span>
                    )}
                    <div className="mt-4 text-center">
                      <p className="text-sm font-bold text-white">{item.name}</p>
                      {item.isLocal && <p className="text-[11px] font-medium text-white/50">You</p>}
                      {isLobby && !item.isLocal && isActive && (
                        <p className="text-[11px] font-medium text-white/50">
                          {item.isInVoice ? "In voice" : "Not in voice"}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Controls Container */}
      <div className={cn(
        "pt-4 pb-4 px-6 flex items-center justify-center transition-all duration-300",
        isFullscreenView
          ? "pointer-events-none bg-linear-to-t from-black/80 to-transparent pt-12 absolute bottom-0 left-0 right-0 z-50 opacity-0 group-hover:opacity-100"
          : "relative pb-6"
      )}>

        {/* SFU controls (when actively in the call) */}
        {isActive && hasJoinedSFU && (
          <div className="pointer-events-auto w-full mt-auto flex justify-center">
            <VoiceControls
              hasMicrophone={callVoice.hasMicrophone ?? true}
              isMicOn={callVoice.isMicOn}
              toggleMic={() => callVoice.toggleMic?.()}
              isDeafened={isDeafened}
              toggleDeafen={() => callVoice.toggleDeafen?.()}
              hasCamera={callVoice.hasCamera ?? true}
              isCameraOn={callVoice.isCameraActive}
              toggleCamera={() => callVoice.toggleCamera?.()}
              isScreenSharing={callVoice.isScreenSharing}
              toggleScreenShare={callVoice.toggleScreenShare || (() => { })}
              setIsScreenModalOpen={setIsScreenModalOpen}
              focusedItem={null}
              setFocusedId={() => { }}
              handleLeave={handleLeave}
              isFullscreen={isExpanded}
              toggleFs={() => setIsExpanded(!isExpanded)}
              showMembers={showMembers}
              setShowMembers={setShowMembers}
              ChevronUp={ChevronUp}
              variant="call"
              hideExtraControls={!hasVideoFeed}
              isChatHidden={isChatHidden}
              toggleChatHidden={() => setIsChatHidden(!isChatHidden)}
            />
          </div>
        )}

        {/* Call Action Buttons (Lobby / Ringing) */}
        {(!hasJoinedSFU && (isActive || isRingingIncoming || isRingingOutgoing)) && (
          <div className="flex items-center justify-center gap-4 pointer-events-auto w-full">

            {/* If ringing outgoing, we only show cancel */}
            {isRingingOutgoing ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={handleCancelCall}
                    className="flex items-center justify-center w-14 h-12 rounded-2xl bg-red-500 hover:bg-red-600 text-white transition-all shadow-lg"
                  >
                    <X className="h-6 w-6" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="bg-rm-bg-floating border-none text-rm-text-primary text-[13px] font-bold shadow-xl px-3 py-2 rounded-lg" sideOffset={8}>
                  <p>Cancel Call</p>
                </TooltipContent>
              </Tooltip>
            ) : (
              // For Incoming Ring OR Active Lobby
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={handleAcceptWithVideo}
                      className="flex items-center justify-center w-14 h-12 rounded-2xl bg-green-600 hover:bg-green-500 text-white transition-all shadow-lg cursor-pointer"
                    >
                      <Video className="h-6 w-6" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="bg-rm-bg-floating border-none text-rm-text-primary text-[13px] font-bold shadow-xl px-3 py-2 rounded-lg" sideOffset={8}>
                    <p>Join with Video</p>
                  </TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={handleAccept}
                      className={cn(
                        "flex items-center justify-center w-14 h-12 rounded-2xl bg-green-600 hover:bg-green-500 text-white transition-all shadow-lg cursor-pointer",
                        isRingingIncoming && "animate-pulse shadow-green-600/50"
                      )}
                    >
                      <Phone className="h-5 w-5 fill-current" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="bg-rm-bg-floating border-none text-rm-text-primary text-[13px] font-bold shadow-xl px-3 py-2 rounded-lg" sideOffset={8}>
                    <p>Join Voice</p>
                  </TooltipContent>
                </Tooltip>

                {isRingingIncoming && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={handleDecline}
                        className="flex items-center justify-center w-14 h-12 rounded-2xl bg-red-500 hover:bg-red-600 text-white transition-all shadow-lg cursor-pointer"
                      >
                        <X className="h-6 w-6" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="bg-rm-bg-floating border-none text-rm-text-primary text-[13px] font-bold shadow-xl px-3 py-2 rounded-lg" sideOffset={8}>
                      <p>Decline</p>
                    </TooltipContent>
                  </Tooltip>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {
        isActive && hasJoinedSFU && duration && (
          <div className={cn(
            "absolute right-4 text-xs font-bold text-rm-text-muted/50 tabular-nums pointer-events-none transition-opacity duration-300 z-50",
            isFullscreenView ? "top-4 opacity-0 group-hover:opacity-100" : "bottom-6"
          )}>
            {duration}
          </div>
        )
      }

      {/* Screen share modal: desktop gets the full picker, web gets quality-only */}
      <UnifiedScreenShareModal
        isOpen={isScreenModalOpen}
        onClose={() => setIsScreenModalOpen(false)}
        onStart={({ quality, withAudio, sourceId }) => {
          callVoice.toggleScreenShare?.({ quality, withAudio, sourceId });
          setIsScreenModalOpen(false);
        }}
        availableQualities={getAvailableStreamQualities()}
      />
    </div >
  );
}
