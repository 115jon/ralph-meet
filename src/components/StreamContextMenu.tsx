import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { useOptionalChatState } from "@/stores/chat-store";
import { useVoiceSettingsStore } from "@/stores/useVoiceSettingsStore";
import { useUser } from "@clerk/tanstack-react-start";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useShallow } from "zustand/shallow";
import { LocalMenu } from "./ContextMenu/LocalMenu";
import { RemoteMenu } from "./ContextMenu/RemoteMenu";

const EMPTY_QUALITIES: string[] = [];
const EMPTY_WATCHED: Record<string, boolean> = {};

interface StreamContextMenuProps {
  userId: string;
  x: number;
  y: number;
  onClose: () => void;
  isStreaming?: boolean;
  onToggleScreenShare?: (options?: { quality: string; withAudio: boolean; changeSource?: boolean }) => void;
  isCurrentUserStreaming?: boolean;
  currentScreenQuality?: string;
  availableQualities?: string[];
  isStreamingAudio?: boolean;
  onToggleStreamAudio?: () => void;
  onChangeSource?: () => void;
  onLeave?: () => void;
  isMuted?: boolean;
  onToggleMute?: () => void;
  isDeafened?: boolean;
  onToggleDeafen?: () => void;
  watchedStreams?: Record<string, boolean>;
  onToggleWatch?: (userId: string) => void;
}

export const StreamContextMenu: React.FC<StreamContextMenuProps> = ({
  userId,
  x,
  y,
  onClose,
  isStreaming,
  onToggleScreenShare,
  isCurrentUserStreaming,
  currentScreenQuality,
  availableQualities = EMPTY_QUALITIES,
  isStreamingAudio,
  onToggleStreamAudio,
  onChangeSource,
  onLeave,
  isMuted,
  onToggleMute,
  isDeafened,
  onToggleDeafen,
  watchedStreams = EMPTY_WATCHED,
  onToggleWatch,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const settings = useVoiceSettingsStore(useShallow((s) => s.getSettings()));

  const setPeerVolume = useVoiceSettingsStore((s) => s.setPeerVolume);
  const setPeerMuted = useVoiceSettingsStore((s) => s.setPeerMuted);
  const setPeerAlwaysHear = useVoiceSettingsStore((s) => s.setPeerAlwaysHear);
  const setPeerAttenuation = useVoiceSettingsStore((s) => s.setPeerAttenuation);
  const setPeerAttenuationStrength = useVoiceSettingsStore((s) => s.setPeerAttenuationStrength);

  const { user: clerkUser } = useUser();
  const chatState = useOptionalChatState();

  const myClerkId = clerkUser?.id;
  const isLocal = userId === "me" || userId === myClerkId;

  const myMember = chatState?.members.find((m) => m.user.id === myClerkId);
  const myTotalPerms = myMember?.roles?.reduce((acc, r) => acc | r.permissions, 0) ?? 0;
  const isModerator = chatState ? (hasPermission(myTotalPerms, PERMISSIONS.MANAGE_SERVER) || hasPermission(myTotalPerms, PERMISSIONS.ADMINISTRATOR)) : false;

  const voiceChannels = chatState?.channels.filter((c) => c.channel_type === "voice") ?? [];

  const [activeSubmenu, setActiveSubmenu] = useState<string | null>(null);
  const aimingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastMousePos = useRef({ x: 0, y: 0 });
  const currentMousePos = useRef({ x: 0, y: 0 });

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    lastMousePos.current = { ...currentMousePos.current };
    currentMousePos.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleMouseEnterRoot = useCallback((label: string | null) => {
    if (aimingTimeoutRef.current) {
      clearTimeout(aimingTimeoutRef.current);
      aimingTimeoutRef.current = null;
    }

    const isAimingAtSubmenu = () => {
      if (!activeSubmenu || !label || label === activeSubmenu) return false;
      const dx = currentMousePos.current.x - lastMousePos.current.x;
      return dx > 3;
    };

    if (isAimingAtSubmenu()) {
      aimingTimeoutRef.current = setTimeout(() => {
        setActiveSubmenu(label);
        aimingTimeoutRef.current = null;
      }, 100);
      return;
    }

    setActiveSubmenu(label);
  }, [activeSubmenu]);

  const peerSetting = settings?.peerSettings?.[userId] || {
    volume: 100,
    muted: false,
    alwaysHear: false,
    attenuationEnabled: false,
    attenuationStrength: 50,
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const [pos, setPos] = useState({ top: y, left: x });

  useEffect(() => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const screenWidth = window.innerWidth;
      const screenHeight = window.innerHeight;

      let newLeft = x;
      let newTop = y;

      if (x + rect.width > screenWidth) newLeft = x - rect.width;
      if (y + rect.height > screenHeight) newTop = y - rect.height;

      const timeout = setTimeout(() => {
        setPos({ top: Math.max(10, newTop), left: Math.max(10, newLeft) });
      }, 0);
      return () => clearTimeout(timeout);
    }
  }, [x, y]);

  const stopWatching = useCallback(() => {
    onToggleWatch?.(userId);
    onClose();
  }, [onToggleWatch, userId, onClose]);

  const toggleMutePeer = useCallback(() => {
    setPeerMuted(userId, !peerSetting.muted);
  }, [setPeerMuted, userId, peerSetting.muted]);

  const toggleAttenuation = useCallback(() => {
    setPeerAttenuation(userId, !peerSetting.attenuationEnabled);
  }, [setPeerAttenuation, userId, peerSetting.attenuationEnabled]);

  const toggleAlwaysHear = useCallback(() => {
    setPeerAlwaysHear(userId, !peerSetting.alwaysHear);
  }, [setPeerAlwaysHear, userId, peerSetting.alwaysHear]);

  const handleCopyId = useCallback(() => {
    navigator.clipboard.writeText(userId === "me" ? (myClerkId || "") : userId);
    onClose();
  }, [userId, myClerkId, onClose]);

  const handleServerMute = useCallback(() => {
    console.log("[Mod] Server mute toggled for", userId);
    alert("Server Mute: coming soon");
  }, [userId]);

  const handleServerDeafen = useCallback(() => {
    console.log("[Mod] Server deafen toggled for", userId);
    alert("Server Deafen: coming soon");
  }, [userId]);

  const handleMove = useCallback((targetChannelId: string) => {
    console.log("[Mod] Move user", userId, "to channel", targetChannelId);
    alert("Move To: coming soon");
    onClose();
  }, [userId, onClose]);

  const handleProfile = useCallback(() => {
    console.log("Open profile for", userId);
    onClose();
  }, [userId, onClose]);

  const handleMessage = useCallback(() => {
    console.log("Open DM for", userId);
    onClose();
  }, [userId, onClose]);

  const clearSubmenu = useCallback(() => handleMouseEnterRoot(null), [handleMouseEnterRoot]);

  return createPortal(
    <div
      ref={containerRef}
      style={{ top: pos.top, left: pos.left }}
      onMouseLeave={clearSubmenu}
      onMouseMove={handleMouseMove}
      className="fixed z-[9999] w-[210px] bg-rm-bg-elevated border border-rm-border shadow-2xl rounded-lg p-1 pb-2 animate-in fade-in zoom-in-95 duration-100 backdrop-blur-xl flex flex-col"
    >
      <div className="flex flex-col">
        {isLocal ? (
          <LocalMenu
            isStreaming={isStreaming}
            onToggleScreenShare={onToggleScreenShare}
            onClose={onClose}
            onChangeSource={onChangeSource}
            activeSubmenu={activeSubmenu}
            handleMouseEnterRoot={handleMouseEnterRoot}
            clearSubmenu={clearSubmenu}
            availableQualities={availableQualities}
            currentScreenQuality={currentScreenQuality}
            isStreamingAudio={isStreamingAudio}
            onToggleStreamAudio={onToggleStreamAudio}
            onLeave={onLeave}
            handleProfile={handleProfile}
            isMuted={isMuted}
            onToggleMute={onToggleMute}
            isDeafened={isDeafened}
            onToggleDeafen={onToggleDeafen}
            isModerator={isModerator}
            voiceChannels={voiceChannels}
            handleMove={handleMove}
            handleServerMute={handleServerMute}
            handleServerDeafen={handleServerDeafen}
            handleCopyId={handleCopyId}
          />
        ) : (
          <RemoteMenu
            userId={userId}
            isStreaming={isStreaming}
            watchedStreams={watchedStreams}
            stopWatching={stopWatching}
            clearSubmenu={clearSubmenu}
            peerSetting={peerSetting}
            toggleMutePeer={toggleMutePeer}
            setPeerVolume={setPeerVolume}
            toggleAlwaysHear={toggleAlwaysHear}
            toggleAttenuation={toggleAttenuation}
            setPeerAttenuationStrength={setPeerAttenuationStrength}
            activeSubmenu={activeSubmenu}
            handleMouseEnterRoot={handleMouseEnterRoot}
            handleProfile={handleProfile}
            handleMessage={handleMessage}
            isModerator={isModerator}
            handleServerMute={handleServerMute}
            handleServerDeafen={handleServerDeafen}
            onClose={onClose}
            voiceChannels={voiceChannels}
            handleMove={handleMove}
            handleCopyId={handleCopyId}
          />
        )}
      </div>
    </div>,
    document.body
  );
};
