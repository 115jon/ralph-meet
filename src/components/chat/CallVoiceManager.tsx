"use client";

// ============================================================================
// CallVoiceManager — Bridges useCallStore with useVoiceChannel
//
// When a call becomes active (status==="active" with a voiceRoomId),
// this component renders <ActiveCallSession> which calls useVoiceChannel
// with the call's voice room. The SFU state and handlers are synced to
// useCallVoiceStore so that DMCallRegion and UserPanel can consume them.
//
// When the call ends, unmounting <ActiveCallSession> triggers cleanup.
// ============================================================================

import { VoiceMediaManager } from "@/components/chat/VoiceMediaManager";
import { useVoiceChannel } from "@/hooks/useVoiceChannel";
import { useChatStore } from "@/stores/chat-store";
import { useCallStore } from "@/stores/useCallStore";
import { useCallVoiceStore } from "@/stores/useCallVoiceStore";
import {
  getAutomaticSoundboardSessionId,
  hasAutomaticSoundboardLeaveStarted,
  playAutomaticSoundboardTrigger,
  resetAutomaticSoundboardSession,
} from "@/lib/voice/auto-soundboard";
import { useEffect, useRef } from "react";

/**
 * Top-level component — mount once in ChatPageClient.
 * Conditionally renders <ActiveCallSession> when a call is active.
 */
export function CallVoiceManager() {
  const status = useCallStore((s) => s.status);
  const voiceRoomId = useCallStore((s) => s.voiceRoomId);
  const channelId = useCallStore((s) => s.channelId);
  const hasJoinedSFU = useCallStore((s) => s.hasJoinedSFU);
  const previousStatus = useRef(status);
  const previousVoiceRoomId = useRef(voiceRoomId);

  // Reset store when call ends
  useEffect(() => {
    const wasActive = previousStatus.current === "active";
    const endedVoiceRoomId = voiceRoomId ?? previousVoiceRoomId.current;
    if (wasActive && status !== "active" && endedVoiceRoomId) {
      const sessionId = getAutomaticSoundboardSessionId(
        "call",
        endedVoiceRoomId,
      );
      const leaveAlreadyStarted = hasAutomaticSoundboardLeaveStarted(sessionId);
      void playAutomaticSoundboardTrigger("leave", sessionId).finally(() => {
        if (!leaveAlreadyStarted) {
          resetAutomaticSoundboardSession(sessionId);
        }
      });
    }
    previousStatus.current = status;
    previousVoiceRoomId.current = voiceRoomId;
    if (status !== "active") {
      useCallVoiceStore.getState().reset();
    }
  }, [status, voiceRoomId]);

  if (status !== "active" || !hasJoinedSFU || !voiceRoomId || !channelId)
    return null;

  return <ActiveCallSession voiceRoomId={voiceRoomId} channelId={channelId} />;
}

/**
 * Inner component — only renders when a call is active.
 * Uses useVoiceChannel with the call's dedicated voice room.
 */
function ActiveCallSession({
  voiceRoomId,
  channelId,
}: {
  voiceRoomId: string;
  channelId: string;
}) {
  const localUserId = useChatStore((s) => s.user?.id);

  const voice = useVoiceChannel({
    channelId,
    roomSlug: voiceRoomId,
    isCall: true,
    autoJoin: true,
    onLeft: () => {
      // SFU disconnected unexpectedly (network error, etc.)
      // Fully reset the call store so the UI cleans up (dashboard hides,
      // call button returns). The user can re-join by clicking "Join Call"
      // in the DMCallRegion if the voice channel still has members.
      useCallStore.getState().endCall("disconnected");
    },
  });

  // Sync frequently-changing voice state → useCallVoiceStore
  useEffect(() => {
    useCallVoiceStore.getState().update({
      sfu: voice.sfu,
      joined: voice.joined,
      connectionState: voice.connectionState,
      isCameraActive: voice.isCameraActive,
      isScreenSharing: voice.isScreenSharing,
      isStreamingAudio: voice.isStreamingAudio,
      screenQuality: voice.currentScreenQuality,
      currentScreenSource: voice.currentScreenSource,
      hasCamera: voice.hasCamera,
      hasMicrophone: voice.hasMicrophone,
      audioBlocked: voice.audioBlocked,
      gridItems: voice.gridItems,
      roomSlug: voice.roomSlug,
      voiceSessionId: voice.voiceSessionId,
      streamThumbnails: voice.streamThumbnails,
      watchedStreams: voice.watchedStreams,
      watchersByStreamer: voice.watchersByStreamer,
      focusedId: voice.focusedId,
      isMicOn: voice.isMicOn,
      isDeafened: voice.isDeafened,
      spatialAudioState: voice.spatialAudioState,
    });
  }, [
    voice.sfu,
    voice.joined,
    voice.connectionState,
    voice.isCameraActive,
    voice.isScreenSharing,
    voice.isStreamingAudio,
    voice.currentScreenQuality,
    voice.currentScreenSource,
    voice.hasCamera,
    voice.hasMicrophone,
    voice.audioBlocked,
    voice.gridItems,
    voice.roomSlug,
    voice.voiceSessionId,
    voice.streamThumbnails,
    voice.watchedStreams,
    voice.watchersByStreamer,
    voice.focusedId,
    voice.isMicOn,
    voice.isDeafened,
    voice.spatialAudioState,
  ]);

  // Sync stable callback refs (these are useCallback-wrapped, rarely change)
  useEffect(() => {
    useCallVoiceStore.getState().update({
      handleLeave: voice.handleLeave,
      toggleMic: voice.toggleMic,
      toggleDeafen: voice.toggleDeafen,
      toggleCamera: voice.toggleCamera,
      toggleScreenShare: voice.toggleScreenShare,
      onToggleStreamAudio: voice.onToggleStreamAudio,
      onToggleWatch: voice.onToggleWatch,
      setFocusedId: voice.setFocusedId,
      updateSharedSpatialAudioState: voice.updateSharedSpatialAudioState,
    });
  }, [
    voice.handleLeave,
    voice.toggleMic,
    voice.toggleDeafen,
    voice.toggleCamera,
    voice.toggleScreenShare,
    voice.onToggleStreamAudio,
    voice.onToggleWatch,
    voice.setFocusedId,
    voice.updateSharedSpatialAudioState,
  ]);

  // Cleanup store on unmount
  useEffect(() => {
    return () => {
      useCallVoiceStore.getState().reset();
    };
  }, []);

  return (
    <VoiceMediaManager
      sfu={voice.sfu}
      serverId={null}
      channelId={channelId}
      roomSlug={voice.roomSlug}
      voiceSessionId={voice.voiceSessionId}
      localUserId={localUserId}
    />
  );
}
