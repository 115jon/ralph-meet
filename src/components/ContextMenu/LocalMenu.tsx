import type { ScreenShareOptions } from "@/lib/screen-share-types";
import type { ScreenShareSourceState } from "@/lib/screen-share-types";
import { Monitor, MonitorX, Share2 } from "lucide-react";
import React from "react";
import { Divider, MenuItem, SubMenuItem } from "./ContextMenuItems";

interface LocalMenuProps {
  isStreaming?: boolean;
  onToggleScreenShare?: (options?: ScreenShareOptions) => void;
  onClose: () => void;
  onChangeSource?: () => void;
  activeSubmenu: string | null;
  handleMouseEnterRoot: (label: string | null) => void;
  clearSubmenu: () => void;
  availableQualities: string[];
  currentScreenQuality?: string;
  currentScreenSource?: ScreenShareSourceState | null;
  isStreamingAudio?: boolean;
  onToggleStreamAudio?: () => void;
  onLeave?: () => void;
  handleProfile: () => void;
  isMuted?: boolean;
  onToggleMute?: () => void;
  isDeafened?: boolean;
  onToggleDeafen?: () => void;
  isModerator: boolean;
  voiceChannels: any[];
  handleMove: (channelId: string) => void;
  handleServerMute: () => void;
  handleServerDeafen: () => void;
  handleCopyId: () => void;
  showDisconnect?: boolean;
  alwaysShowStreamPreview?: boolean;
  onToggleAlwaysShowStreamPreview?: () => void;
}

export const LocalMenu: React.FC<LocalMenuProps> = ({
  isStreaming,
  onToggleScreenShare,
  onClose,
  onChangeSource,
  activeSubmenu,
  handleMouseEnterRoot,
  clearSubmenu,
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
  showDisconnect = true,
  alwaysShowStreamPreview,
  onToggleAlwaysShowStreamPreview,
}) => {
  if (isStreaming) {
    return (
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
          onClick={() => { onChangeSource?.(); onClose(); }}
          rightElement={<Share2 size={18} className="text-[#dbdee1]/40" />}
        />

        <SubMenuItem
          label="Stream Quality"
          active={activeSubmenu === "Stream Quality"}
          onMouseEnter={() => handleMouseEnterRoot("Stream Quality")}
          submenu={availableQualities.map((q) => (
            <MenuItem
              key={q}
              label={q.replace("p", "p ")}
              checked={currentScreenQuality === q}
              onClick={() => {
                onToggleScreenShare?.({
                  quality: q,
                  withAudio: !!isStreamingAudio,
                  sourceId: currentScreenSource?.sourceId ?? undefined,
                  captureId: currentScreenSource?.captureId ?? undefined,
                  sourceName: currentScreenSource?.sourceName ?? undefined,
                  sourceKind: currentScreenSource?.sourceKind ?? undefined,
                });
                onClose();
              }}
            />
          ))}
        />

        <MenuItem
          label="Share Stream Audio"
          checked={!!isStreamingAudio}
          onMouseEnter={clearSubmenu}
          onClick={() => {
            onToggleStreamAudio?.();
            onClose();
          }}
        />

        {onToggleAlwaysShowStreamPreview && (
          <>
            <Divider />
            <MenuItem
              label="Always Show Stream Preview"
              checked={!!alwaysShowStreamPreview}
              onMouseEnter={clearSubmenu}
              onClick={() => {
                onToggleAlwaysShowStreamPreview?.();
                onClose();
              }}
              rightElement={<Monitor size={16} className="text-[#dbdee1]/40" />}
            />
          </>
        )}

        {showDisconnect && (
          <>
            <Divider />
            <MenuItem
              label="Disconnect"
              danger
              onMouseEnter={clearSubmenu}
              onClick={() => { onLeave?.(); onClose(); }}
            />
          </>
        )}
      </>
    );
  }

  return (
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
            submenu={voiceChannels.map((ch) => (
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

      {showDisconnect && (
        <>
          <MenuItem
            label="Disconnect"
            danger
            onMouseEnter={clearSubmenu}
            onClick={() => { onLeave?.(); onClose(); }}
          />
          <Divider />
        </>
      )}

      <MenuItem
        label="Copy User ID"
        onMouseEnter={clearSubmenu}
        onClick={handleCopyId}
        rightElement={<span className="text-[10px] bg-rm-bg-active px-1 rounded text-rm-text-muted/40 font-bold shadow-sm">ID</span>}
      />
    </>
  );
};
