"use client";

import { useOptionalChatState } from "@/lib/chat-context";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { useVoiceSettingsStore } from "@/stores/useVoiceSettingsStore";
import { useUser } from "@clerk/nextjs";
import {
  AlertCircle,
  MonitorX,
  Share2,
} from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useShallow } from "zustand/shallow";
import { Divider, MenuItem, Slider, SubMenuItem } from "./ContextMenu/ContextMenuItems";

const EMPTY_QUALITIES: string[] = [];
const EMPTY_WATCHED: Record<string, boolean> = {};

// ── Prop Types ──────────────────────────────────────────────────────────────

interface StreamContextMenuProps {
  /** The target user's participant ID */
  userId: string;
  /** Screen position for the menu */
  x: number;
  y: number;
  /** Close handler */
  onClose: () => void;
  /** Is the target user streaming (screen share)? */
  isStreaming?: boolean;

  // ── Voice action callbacks (passed from VoiceChannelView) ──
  /** Toggle screen share. Called with no args = stop, with options = start/change. */
  onToggleScreenShare?: (options?: { quality: string; withAudio: boolean; changeSource?: boolean }) => void;
  /** Is the current user screen sharing? */
  isCurrentUserStreaming?: boolean;
  /** Current screen share quality string */
  currentScreenQuality?: string;
  /** Available quality strings */
  availableQualities?: string[];
  /** Is screen share audio on? */
  isStreamingAudio?: boolean;
  /** Toggle stream audio */
  onToggleStreamAudio?: () => void;
  /** Leave voice channel */
  onLeave?: () => void;
  /** Is local user muted? */
  isMuted?: boolean;
  /** Toggle mute */
  onToggleMute?: () => void;
  /** Is local user deafened? */
  isDeafened?: boolean;
  /** Toggle deafen */
  onToggleDeafen?: () => void;
  /** Watched streams set (userId → boolean) */
  watchedStreams?: Record<string, boolean>;
  /** Toggle watch on a stream */
  onToggleWatch?: (userId: string) => void;
}

// ── Main Component ──────────────────────────────────────────────────────────

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
  onLeave,
  isMuted,
  onToggleMute,
  isDeafened,
  onToggleDeafen,
  watchedStreams = EMPTY_WATCHED,
  onToggleWatch,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const settings = useVoiceSettingsStore(useShallow(s => s.getSettings()));

  const setPeerVolume = useVoiceSettingsStore(s => s.setPeerVolume);
  const setPeerMuted = useVoiceSettingsStore(s => s.setPeerMuted);
  const setPeerAlwaysHear = useVoiceSettingsStore(s => s.setPeerAlwaysHear);
  const setPeerAttenuation = useVoiceSettingsStore(s => s.setPeerAttenuation);
  const setPeerAttenuationStrength = useVoiceSettingsStore(s => s.setPeerAttenuationStrength);

  const { user: clerkUser } = useUser();
  const chatState = useOptionalChatState();

  // Determine local user — compare clerk user ID to participant ID
  const myClerkId = clerkUser?.id;
  const isLocal = userId === "me" || userId === myClerkId;

  // Server moderator check
  const myMember = chatState?.members.find(m => m.user.id === myClerkId);
  const myTotalPerms = myMember?.roles?.reduce((acc, r) => acc | r.permissions, 0) ?? 0;
  const isModerator = chatState ? (hasPermission(myTotalPerms, PERMISSIONS.MANAGE_SERVER) || hasPermission(myTotalPerms, PERMISSIONS.ADMINISTRATOR)) : false;

  // Voice channels for "Move to" submenu
  const voiceChannels = chatState?.channels.filter(c => c.channel_type === "voice") ?? [];

  // Aiming leeway state (same as target for smooth submenu handling)
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

  // ── Click-outside / Escape ──
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

  // ── Position adjustment ──
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

      setPos({ top: Math.max(10, newTop), left: Math.max(10, newLeft) });
    }
  }, [x, y]);

  // ── Action handlers ──

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
    // Stubbed — server moderation opcodes not yet implemented
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
    // Stub — could open a profile popover
    console.log("Open profile for", userId);
    onClose();
  }, [userId, onClose]);

  const handleMessage = useCallback(() => {
    console.log("Open DM for", userId);
    onClose();
  }, [userId, onClose]);

  const clearSubmenu = useCallback(() => handleMouseEnterRoot(null), [handleMouseEnterRoot]);

  // ── Render ──

  return createPortal(
    <div
      ref={containerRef}
      style={{ top: pos.top, left: pos.left }}
      onMouseLeave={clearSubmenu}
      onMouseMove={handleMouseMove}
      className="fixed z-[9999] w-[210px] bg-rm-bg-elevated border border-rm-border shadow-2xl rounded-lg p-1 pb-2 animate-in fade-in zoom-in-95 duration-100 backdrop-blur-xl flex flex-col"
    >
      <div className="flex flex-col">

        {/* ══════════════════════════════════════════════════════════════════
         * MODE 1: Local user IS streaming — stream management controls
         * ══════════════════════════════════════════════════════════════════ */}
        {isLocal && isStreaming ? (
          <>
            <MenuItem
              label="Stop Streaming"
              danger
              onMouseEnter={clearSubmenu}
              onClick={() => { onToggleScreenShare?.(); onClose(); }}
              rightElement={<MonitorX size={18} className="text-rose-500" />}
            />
            <MenuItem
              label="Change Stream"
              onMouseEnter={clearSubmenu}
              onClick={() => { onToggleScreenShare?.({ quality: currentScreenQuality || "720p30", withAudio: !!isStreamingAudio, changeSource: true }); onClose(); }}
              rightElement={<Share2 size={18} className="text-[#dbdee1]/40" />}
            />

            <SubMenuItem
              label="Stream Quality"
              active={activeSubmenu === "Stream Quality"}
              onMouseEnter={() => handleMouseEnterRoot("Stream Quality")}
              submenu={availableQualities.map(q => (
                <MenuItem
                  key={q}
                  label={q.replace("p", "p ")}
                  checked={currentScreenQuality === q}
                  onClick={() => { onToggleScreenShare?.({ quality: q, withAudio: !!isStreamingAudio }); onClose(); }}
                />
              ))}
            />

            <MenuItem
              label="Share Stream Audio"
              checked={!!isStreamingAudio}
              onMouseEnter={clearSubmenu}
              onClick={() => onToggleStreamAudio?.()}
            />

            <Divider />

            <SubMenuItem
              label="More Options"
              active={activeSubmenu === "More Options"}
              onMouseEnter={() => handleMouseEnterRoot("More Options")}
              submenu={
                <>
                  <MenuItem label="Show My Screen Share" checked={true} />
                  <MenuItem
                    label="Report Problem"
                    danger
                    onClick={onClose}
                    rightElement={<AlertCircle size={18} className="text-rose-500" />}
                  />
                </>
              }
            />

            <Divider />

            <MenuItem
              label="Disconnect"
              danger
              onMouseEnter={clearSubmenu}
              onClick={() => { onLeave?.(); onClose(); }}
            />
          </>

          /* ══════════════════════════════════════════════════════════════════
           * MODE 2: Local user NOT streaming — personal voice controls
           * ══════════════════════════════════════════════════════════════════ */
        ) : isLocal ? (
          <>
            <MenuItem label="Profile" onMouseEnter={clearSubmenu} onClick={handleProfile} />
            <Divider />
            <MenuItem label="Mute" checked={!!isMuted} onMouseEnter={clearSubmenu} onClick={onToggleMute} />
            <MenuItem label="Deafen" checked={!!isDeafened} onMouseEnter={clearSubmenu} onClick={onToggleDeafen} />

            <SubMenuItem
              label="Apps"
              active={activeSubmenu === "Apps"}
              onMouseEnter={() => handleMouseEnterRoot("Apps")}
              submenu={<MenuItem label="No Apps Installed" disabled />}
            />

            <Divider />

            {isModerator && (
              <>
                <SubMenuItem
                  label="Move to"
                  active={activeSubmenu === "Move to"}
                  onMouseEnter={() => handleMouseEnterRoot("Move to")}
                  submenu={voiceChannels.map(ch => (
                    <MenuItem
                      key={ch.id}
                      label={ch.name}
                      onClick={() => handleMove(ch.id)}
                    />
                  ))}
                />
                <Divider />
              </>
            )}

            <MenuItem label="Show Non-Video Participants" onMouseEnter={clearSubmenu} checked={true} onClick={onClose} />

            <Divider />

            {isModerator && (
              <>
                <MenuItem label="Server Mute" danger onMouseEnter={clearSubmenu} onClick={handleServerMute} />
                <MenuItem label="Server Deafen" danger onMouseEnter={clearSubmenu} onClick={handleServerDeafen} />
                <Divider />
              </>
            )}

            <MenuItem
              label="Disconnect"
              danger
              onMouseEnter={clearSubmenu}
              onClick={() => { onLeave?.(); onClose(); }}
            />

            <Divider />

            <MenuItem
              label="Copy User ID"
              onMouseEnter={clearSubmenu}
              onClick={handleCopyId}
              rightElement={<span className="text-[10px] bg-rm-bg-active px-1 rounded text-rm-text-muted/40 font-bold shadow-sm">ID</span>}
            />
          </>

          /* ══════════════════════════════════════════════════════════════════
           * MODE 3a: Remote user IS streaming but NOT watched — watch prompt
           * ══════════════════════════════════════════════════════════════════ */
        ) : isStreaming && !watchedStreams[userId] ? (
          <>
            <MenuItem
              label="Watch Stream"
              boldLabel
              onMouseEnter={clearSubmenu}
              onClick={stopWatching}
              rightElement={<MonitorX size={18} className="text-[#dbdee1]/40" />}
            />
          </>

          /* ══════════════════════════════════════════════════════════════════
           * MODE 3b: Remote user IS streaming AND being watched — full controls
           * ══════════════════════════════════════════════════════════════════ */
        ) : isStreaming ? (
          <>
            <MenuItem
              label="Stop Watching"
              boldLabel
              onMouseEnter={clearSubmenu}
              onClick={stopWatching}
              rightElement={<MonitorX size={18} className="text-[#dbdee1]/40" />}
            />

            <Divider />

            <MenuItem
              label="Mute"
              checked={peerSetting.muted}
              onMouseEnter={clearSubmenu}
              onClick={toggleMutePeer}
            />

            <Slider
              label="Stream Volume"
              value={peerSetting.volume}
              onMouseEnter={clearSubmenu}
              onChange={(val) => setPeerVolume(userId, val)}
            />

            <MenuItem
              label="Always Hear Stream Audio"
              checked={peerSetting.alwaysHear}
              onMouseEnter={clearSubmenu}
              onClick={toggleAlwaysHear}
            />

            <Divider />

            <MenuItem
              label="Stream Attenuation"
              description="Automatically reduce stream volume when people are talking."
              checked={peerSetting.attenuationEnabled}
              onMouseEnter={clearSubmenu}
              onClick={toggleAttenuation}
            />

            {peerSetting.attenuationEnabled && (
              <Slider
                label="Stream Attenuation Strength"
                value={peerSetting.attenuationStrength}
                max={100}
                onMouseEnter={clearSubmenu}
                onChange={(val) => setPeerAttenuationStrength(userId, val)}
              />
            )}

            <Divider />

            <SubMenuItem
              label="More Options"
              active={activeSubmenu === "More Options" || activeSubmenu === "StreamingApps"}
              onMouseEnter={() => handleMouseEnterRoot("More Options")}
              submenu={
                <>
                  <MenuItem label="Profile" onClick={handleProfile} />
                  <MenuItem label="Message" onClick={handleMessage} />
                  <Divider />
                  <SubMenuItem
                    label="Apps"
                    active={activeSubmenu === "StreamingApps"}
                    onMouseEnter={() => handleMouseEnterRoot("StreamingApps")}
                    submenu={<MenuItem label="No Apps" disabled />}
                  />
                  <Divider />
                  {isModerator && (
                    <>
                      <MenuItem label="Server Mute" danger onClick={handleServerMute} />
                      <MenuItem label="Server Deafen" danger onClick={handleServerDeafen} />
                    </>
                  )}
                  <MenuItem label="Disconnect" danger onClick={onClose} />
                </>
              }
            />
          </>

          /* ══════════════════════════════════════════════════════════════════
           * MODE 4: Remote user NOT streaming — standard user context menu
           * ══════════════════════════════════════════════════════════════════ */
        ) : (
          <>
            <MenuItem label="Profile" onMouseEnter={clearSubmenu} onClick={handleProfile} />
            <MenuItem label="Message" onMouseEnter={clearSubmenu} onClick={handleMessage} />

            <Divider />

            <Slider
              label="User Volume"
              value={peerSetting.volume}
              onMouseEnter={clearSubmenu}
              onChange={(val) => setPeerVolume(userId, val)}
            />

            <Divider />

            <MenuItem
              label="Mute"
              checked={peerSetting.muted}
              onMouseEnter={clearSubmenu}
              onClick={toggleMutePeer}
            />

            <Divider />

            <SubMenuItem
              label="Apps"
              active={activeSubmenu === "Apps"}
              onMouseEnter={() => handleMouseEnterRoot("Apps")}
              submenu={<MenuItem label="No Apps" disabled />}
            />

            {isModerator && (
              <SubMenuItem
                label="Move to"
                active={activeSubmenu === "Move to"}
                onMouseEnter={() => handleMouseEnterRoot("Move to")}
                submenu={voiceChannels.map(ch => (
                  <MenuItem
                    key={ch.id}
                    label={ch.name}
                    onClick={() => handleMove(ch.id)}
                  />
                ))}
              />
            )}

            <Divider />

            {isModerator && (
              <>
                <MenuItem label="Server Mute" danger onMouseEnter={clearSubmenu} onClick={handleServerMute} />
                <MenuItem label="Server Deafen" danger onMouseEnter={clearSubmenu} onClick={handleServerDeafen} />
                <Divider />
              </>
            )}

            <MenuItem label="Disconnect" danger onMouseEnter={clearSubmenu} onClick={onClose} />

            <Divider />

            <MenuItem
              label="Copy User ID"
              onMouseEnter={clearSubmenu}
              onClick={handleCopyId}
              rightElement={<span className="text-[10px] bg-rm-bg-active px-1 rounded text-rm-text-muted/40 font-bold shadow-sm">ID</span>}
            />
          </>
        )}
      </div>
    </div>,
    document.body
  );
};
