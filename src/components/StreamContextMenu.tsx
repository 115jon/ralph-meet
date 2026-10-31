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
import { copyToClipboard } from "@/components/ui/toast";
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

  const { user: authUser } = useUser();
  const members = useChatStore((s) => s.members);

  const myUserId = authUser?.id;
  const isLocal = userId === "me" || userId === myUserId;
  const resolvedTargetUserId = userId === "me" ? (myUserId ?? null) : userId;

  const myMember = members.find((m: any) => m.user.id === myUserId);
  const myTotalPerms =
    myMember?.roles?.reduce((acc: number, r: any) => acc | r.permissions, 0) ??
    0;
  const isModerator =
    hasPermission(myTotalPerms, PERMISSIONS.MANAGE_SERVER) ||
    hasPermission(myTotalPerms, PERMISSIONS.ADMINISTRATOR);
  const soundboardServerKey = getSoundboardServerKey(serverId);

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
    void copyToClipboard(
      userId === "me" ? myUserId || "" : userId,
      "User ID copied",
    );
    onClose();
  }, [userId, myUserId, onClose]);

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

  const builtEntries: StreamMenuEntry[] = isLocal
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
        onClose,
        handleCopyId,
        showDisconnect,
      });
  const entries = presentEntries(builtEntries);

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

/**
 * Presentation pass over the built entries:
 *  - the "Apps" submenu only ever held a disabled "No apps" row, so it goes
 *    (with the divider it leaves behind);
 *  - the red leave item says what it leaves ("Leave call"), so it can't be
 *    read as stopping a stream.
 */
const PLACEHOLDER_SUBMENUS = new Set(["apps", "streaming-apps"]);

function presentEntries(entries: StreamMenuEntry[]): StreamMenuEntry[] {
  const mapped = entries
    .filter(
      (entry) =>
        !(entry.type === "submenu" && PLACEHOLDER_SUBMENUS.has(entry.key)),
    )
    .map((entry): StreamMenuEntry => {
      if (entry.type === "item" && entry.key === "disconnect") {
        return { ...entry, label: "Leave call" };
      }
      if (entry.type === "submenu") {
        return { ...entry, entries: presentEntries(entry.entries) };
      }
      return entry;
    });
  // Drop leading, trailing and doubled dividers.
  return mapped.filter((entry, index) => {
    if (entry.type !== "divider") return true;
    const previous = mapped[index - 1];
    const next = mapped[index + 1];
    return (
      previous !== undefined &&
      previous.type !== "divider" &&
      next !== undefined
    );
  });
}

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
