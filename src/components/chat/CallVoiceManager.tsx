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

import { useVoiceChannel } from "@/hooks/useVoiceChannel";
import { useChatStore } from "@/stores/chat-store";
import { useCallStore } from "@/stores/useCallStore";
import { useCallVoiceStore } from "@/stores/useCallVoiceStore";
import { useEffect } from "react";

/**
 * Top-level component — mount once in ChatPageClient.
 * Conditionally renders <ActiveCallSession> when a call is active.
 */
export function CallVoiceManager() {
  const status = useCallStore((s) => s.status);
  const voiceRoomId = useCallStore((s) => s.voiceRoomId);
  const channelId = useCallStore((s) => s.channelId);

  // Reset store when call ends
  useEffect(() => {
    if (status !== "active") {
      useCallVoiceStore.getState().reset();
    }
  }, [status]);

  if (status !== "active" || !voiceRoomId || !channelId) return null;

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
  const callId = useCallStore((s) => s.callId);
  const gateway = useChatStore((s) => s.gateway);

  const voice = useVoiceChannel({
    channelId,
    roomSlug: voiceRoomId,
    isCall: true,
    autoJoin: true,
    onLeft: () => {
      // Only send CallEnd for unexpected disconnects (network error, etc.)
      // If the user intentionally ended the call, status is already "idle"
      // and we don't want to send a duplicate op:39 to the server.
      const { status, callId: currentCallId } = useCallStore.getState();
      if (status === "active" && currentCallId && gateway) {
        gateway.sendCallEnd(currentCallId);
        useCallStore.getState().endCall("disconnected");
      }
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
      hasCamera: voice.hasCamera,
      hasMicrophone: voice.hasMicrophone,
      audioBlocked: voice.audioBlocked,
      gridItems: voice.gridItems,
      isMicOn: voice.isMicOn,
      isDeafened: voice.isDeafened,
    });
  }, [
    voice.sfu,
    voice.joined,
    voice.connectionState,
    voice.isCameraActive,
    voice.isScreenSharing,
    voice.isStreamingAudio,
    voice.currentScreenQuality,
    voice.hasCamera,
    voice.hasMicrophone,
    voice.audioBlocked,
    voice.gridItems,
    voice.isMicOn,
    voice.isDeafened,
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
    });
  }, [
    voice.handleLeave,
    voice.toggleMic,
    voice.toggleDeafen,
    voice.toggleCamera,
    voice.toggleScreenShare,
    voice.onToggleStreamAudio,
  ]);

  // Cleanup store on unmount
  useEffect(() => {
    return () => {
      useCallVoiceStore.getState().reset();
    };
  }, []);

  // This component renders nothing — it just manages the SFU lifecycle
  return null;
}
