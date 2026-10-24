import { useIsMobile } from "@/hooks/useMediaQuery";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import type {
  ScreenShareOptions,
  ScreenShareSourceState,
} from "@/lib/screen-share-types";
import type { SFUClient } from "@/lib/sfu-client";
import {
  getSoundboardServerKey,
  stopSoundboardPlaybacksByOwner,
} from "@/lib/voice/soundboard";
import { useChatStore } from "@/stores/chat-store";
import { useVoiceSettingsStore } from "@/stores/useVoiceSettingsStore";
import { useUser } from "@kova/react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/shallow";
import { clog } from "@/lib/console-logger";
import { ActionSheet } from "@/components/ui/action-sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  pointAnchor,
} from "@/components/ui/dropdown-menu";
import {
  StreamMenuEntries,
  toActionSheetItems,
  type StreamMenuEntry,
} from "./ContextMenu/ContextMenuItems";
import { buildLocalMenu } from "./ContextMenu/LocalMenu";
import { buildRemoteMenu } from "./ContextMenu/RemoteMenu";

const log = clog("Mod");

const EMPTY_QUALITIES: string[] = [];
const EMPTY_WATCHED: Record<string, boolean> = {};

export interface StreamContextMenuProps {
  isClosing?: boolean;
  userId: string;
  x: number;
  y: number;
  onClose: () => void;
  isStreaming?: boolean;
  onToggleScreenShare?: (options?: ScreenShareOptions) => void;
  isCurrentUserStreaming?: boolean;
  currentScreenQuality?: string;
  currentScreenSource?: ScreenShareSourceState | null;
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
  onOpenProfile?: () => void;
  onOpenMessage?: () => void;
  onOpenProfileUser?: (userId: string) => void;
  onOpenMessageUser?: (userId: string) => void;
  showDisconnect?: boolean;
  sfu?: SFUClient | null;
  serverId?: string | null;
  localUserId?: string | null;
  alwaysShowStreamPreview?: boolean;
  onToggleAlwaysShowStreamPreview?: () => void;
}

export const StreamContextMenu: React.FC<StreamContextMenuProps> = ({
  userId,
  x,
  y,
  onClose,
  isStreaming,
  onToggleScreenShare,
  isCurrentUserStreaming: _isCurrentUserStreaming,
  currentScreenQuality,
  currentScreenSource,
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
  onOpenProfile,
  onOpenMessage,
  onOpenProfileUser,
  onOpenMessageUser,
  showDisconnect = true,
  sfu: _sfu,
  serverId,
  localUserId: _localUserId,
  alwaysShowStreamPreview,
  onToggleAlwaysShowStreamPreview,
}) => {
  const isMobile = useIsMobile();
  const anchor = useMemo(() => pointAnchor(x, y), [x, y]);
  const settings = useVoiceSettingsStore(useShallow((s) => s.getSettings()));

  const setPeerVolume = useVoiceSettingsStore((s) => s.setPeerVolume);
  const setPeerStreamVolume = useVoiceSettingsStore(
    (s) => s.setPeerStreamVolume,
  );
  const setPeerMuted = useVoiceSettingsStore((s) => s.setPeerMuted);
  const setPeerAlwaysHear = useVoiceSettingsStore((s) => s.setPeerAlwaysHear);
  const setPeerAttenuation = useVoiceSettingsStore((s) => s.setPeerAttenuation);
  const setPeerAttenuationStrength = useVoiceSettingsStore(
    (s) => s.setPeerAttenuationStrength,
  );
  const setPeerSoundboardMuted = useVoiceSettingsStore(
    (s) => s.setPeerSoundboardMuted,
  );

  const { user: clerkUser } = useUser();
  const members = useChatStore((s) => s.members);
  const channels = useChatStore((s) => s.channels);

  const myClerkId = clerkUser?.id;
  const isLocal = userId === "me" || userId === myClerkId;
  const resolvedTargetUserId = userId === "me" ? (myClerkId ?? null) : userId;

  const myMember = members.find((m: any) => m.user.id === myClerkId);
  const myTotalPerms =
    myMember?.roles?.reduce((acc: number, r: any) => acc | r.permissions, 0) ??
    0;
  const isModerator =
    hasPermission(myTotalPerms, PERMISSIONS.MANAGE_SERVER) ||
    hasPermission(myTotalPerms, PERMISSIONS.ADMINISTRATOR);
  const soundboardServerKey = getSoundboardServerKey(serverId);

  const voiceChannels = channels.filter((c: any) => c.channel_type === "voice");

  const peerSetting = settings?.peerSettings?.[userId] || {
    volume: 100,
    streamVolume: 100,
    muted: false,
    alwaysHear: false,
    attenuationEnabled: false,
    attenuationStrength: 50,
    soundboardMuted: false,
  };

  const stopWatching = useCallback(() => {
    onToggleWatch?.(userId);
    onClose();
  }, [onToggleWatch, userId, onClose]);

  const toggleMutePeer = useCallback(() => {
    setPeerMuted(userId, !peerSetting.muted);
  }, [setPeerMuted, userId, peerSetting.muted]);

  const toggleSoundboardMute = useCallback(() => {
    const nextMuted = !peerSetting.soundboardMuted;
    setPeerSoundboardMuted(userId, nextMuted);
    if (nextMuted) stopSoundboardPlaybacksByOwner(userId, soundboardServerKey);
  }, [
    peerSetting.soundboardMuted,
    setPeerSoundboardMuted,
    soundboardServerKey,
    userId,
  ]);

  const toggleAttenuation = useCallback(() => {
    setPeerAttenuation(userId, !peerSetting.attenuationEnabled);
  }, [setPeerAttenuation, userId, peerSetting.attenuationEnabled]);

  const toggleAlwaysHear = useCallback(() => {
    setPeerAlwaysHear(userId, !peerSetting.alwaysHear);
  }, [setPeerAlwaysHear, userId, peerSetting.alwaysHear]);

  const handleCopyId = useCallback(() => {
    navigator.clipboard.writeText(userId === "me" ? myClerkId || "" : userId);
    onClose();
  }, [userId, myClerkId, onClose]);

  const handleServerMute = useCallback(() => {
    log.info("Server mute toggled for", userId);
    alert("Server mute: coming soon");
  }, [userId]);

  const handleServerDeafen = useCallback(() => {
    log.info("Server deafen toggled for", userId);
    alert("Server deafen: coming soon");
  }, [userId]);

  const handleMove = useCallback(
    (targetChannelId: string) => {
      log.info("Move user", userId, "to channel", targetChannelId);
      alert("Move To: coming soon");
      onClose();
    },
    [userId, onClose],
  );

  const handleProfile = useCallback(() => {
    if (resolvedTargetUserId && onOpenProfileUser) {
      onOpenProfileUser?.(resolvedTargetUserId);
    } else {
      onOpenProfile?.();
    }
    onClose();
  }, [onClose, onOpenProfile, onOpenProfileUser, resolvedTargetUserId]);

  const handleMessage = useCallback(() => {
    if (resolvedTargetUserId && onOpenMessageUser) {
      onOpenMessageUser?.(resolvedTargetUserId);
    } else {
      onOpenMessage?.();
    }
    onClose();
  }, [onClose, onOpenMessage, onOpenMessageUser, resolvedTargetUserId]);

  const entries: StreamMenuEntry[] = isLocal
    ? buildLocalMenu({
        isStreaming,
        onToggleScreenShare,
        onClose,
        onChangeSource,
        availableQualities,
        currentScreenQuality,
        currentScreenSource,
        isStreamingAudio,
        onToggleStreamAudio,
        onLeave,
        handleProfile,
        isMuted,
        onToggleMute,
        isDeafened,
        onToggleDeafen,
        isModerator,
        voiceChannels,
        handleMove,
        handleServerMute,
        handleServerDeafen,
        handleCopyId,
        showDisconnect,
        alwaysShowStreamPreview,
        onToggleAlwaysShowStreamPreview,
      })
    : buildRemoteMenu({
        userId,
        isStreaming,
        watchedStreams,
        stopWatching,
        peerSetting,
        toggleMutePeer,
        toggleSoundboardMute,
        setPeerVolume,
        setPeerStreamVolume,
        toggleAlwaysHear,
        toggleAttenuation,
        setPeerAttenuationStrength,
        handleProfile,
        handleMessage,
        isModerator,
        handleServerMute,
        handleServerDeafen,
        onClose,
        voiceChannels,
        handleMove,
        handleCopyId,
        showDisconnect,
      });

  return (
    // The menu portals to <body>, but React events still bubble to the tile
    // or preview that opened it; keep its presses and clicks inside.
    <div
      className="contents"
      onPointerDown={stopPropagation}
      onPointerUp={stopPropagation}
      onClick={stopPropagation}
      onContextMenu={stopPropagation}
    >
      {isMobile ? (
        <StreamActionSheet entries={entries} onClose={onClose} />
      ) : (
        <DropdownMenu open onOpenChange={(open) => !open && onClose()}>
          <DropdownMenuContent
            anchor={anchor}
            side="bottom"
            align="start"
            sideOffset={2}
            aria-label="User actions"
            data-stream-preview-interactive="true"
            className="w-52"
          >
            <StreamMenuEntries entries={entries} panelProps={PANEL_PROPS} />
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
};

function stopPropagation(event: React.SyntheticEvent) {
  event.stopPropagation();
}

const PANEL_PROPS = {
  "data-stream-preview-interactive": "true",
} as React.ComponentPropsWithoutRef<"div">;

/** Phone form: the same entries as an ActionSheet (13.1 "context actions"). */
function StreamActionSheet({
  entries,
  onClose,
}: {
  entries: StreamMenuEntry[];
  onClose: () => void;
}) {
  const [open, setOpen] = useState(true);
  // Owners unmount the menu on close; let the sheet slide away first.
  useEffect(() => {
    if (open) return;
    const timer = window.setTimeout(onClose, 280);
    return () => window.clearTimeout(timer);
  }, [open, onClose]);

  return (
    <ActionSheet
      open={open}
      onOpenChange={setOpen}
      items={toActionSheetItems(entries)}
      title="User actions"
    />
  );
}
