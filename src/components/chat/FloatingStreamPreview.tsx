import type { StreamContextMenuProps } from "@/components/StreamContextMenu";
import { StreamContextMenu } from "@/components/StreamContextMenu";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { IconButton } from "@/components/ui/IconButton";
import { TooltipProvider } from "@/components/ui/tooltip";
import { VideoPlayer } from "@/components/voice/VideoPlayer";
import { useState } from "react";

import { FloatingSurface } from "./floating/FloatingSurface";
import InlineEmojiText from "./InlineEmojiText";

interface FloatingStreamPreviewProps {
  userId: string;
  channelName: string;
  displayName: string;
  previewStream: MediaStream | null;
  slotIndex?: number;
  isPreviewPaused?: boolean;
  pausedTitle?: string;
  pausedDescription?: string;
  primaryActionTooltip: string;
  primaryActionAriaLabel: string;
  onPrimaryAction: () => void;
  onNavigateToVoiceChannel: () => void;
  menuProps: Omit<StreamContextMenuProps, "x" | "y" | "onClose" | "userId">;
}

/** The video (or the paused card) at 16:9, filling its box. */
function PreviewMedia({
  previewStream,
  isPreviewPaused,
  displayName,
  pausedTitle,
  pausedDescription,
  dense = false,
}: {
  previewStream: MediaStream | null;
  isPreviewPaused: boolean;
  displayName: string;
  pausedTitle: string;
  pausedDescription: string;
  dense?: boolean;
}) {
  const live = !isPreviewPaused && previewStream;
  return (
    <div className="relative aspect-video overflow-hidden bg-black">
      {live ? (
        <VideoPlayer
          stream={previewStream}
          muted
          label={`${displayName} stream preview`}
          className="h-full w-full bg-black object-contain"
        />
      ) : dense ? (
        <div className="absolute inset-0 flex items-center justify-center text-white/70">
          <Icon name="screenShare" size="lg" />
        </div>
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
          <p className="text-ui-md font-semibold text-white">{pausedTitle}</p>
          <p className="mt-1 text-ui-sm text-white/70">{pausedDescription}</p>
        </div>
      )}
    </div>
  );
}

/**
 * A screen share preview that floats over the chat: your own stream while
 * you're away from the voice channel, or a stream you watch. Desktop: a
 * resizable 16:9 card. Phone: a picture-in-picture thumbnail; tap for a sheet
 * with the full preview and actions. Minimises to a bubble; drags to any
 * corner.
 */
export default function FloatingStreamPreview({
  userId,
  channelName,
  displayName,
  previewStream,
  slotIndex = 0,
  isPreviewPaused = false,
  pausedTitle = "This stream is still running!",
  pausedDescription = "We couldn't render the preview right now.",
  primaryActionTooltip,
  primaryActionAriaLabel,
  onPrimaryAction,
  onNavigateToVoiceChannel,
  menuProps,
}: FloatingStreamPreviewProps) {
  const [menuPosition, setMenuPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const media = (dense = false) => (
    <PreviewMedia
      previewStream={previewStream}
      isPreviewPaused={isPreviewPaused}
      displayName={displayName}
      pausedTitle={pausedTitle}
      pausedDescription={pausedDescription}
      dense={dense}
    />
  );

  const label = `${displayName}'s stream`;

  return (
    <TooltipProvider delayDuration={0}>
      <FloatingSurface
        id={`stream-preview-${slotIndex}`}
        label="Stream preview"
        title={<InlineEmojiText text={label} className="truncate" />}
        // Bottom left, as before: clear of now playing (bottom right) and
        // the soundboard (top right).
        defaultCorner="bottom-left"
        width={{ min: 240, max: 640, default: 360 }}
        phoneWidth={184}
        portal={false}
        minimizeLabel="Minimise stream preview"
        restoreLabel={`Open ${displayName}'s stream preview`}
        bubble={<Icon name="screenShare" size="lg" />}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setMenuPosition({ x: event.clientX, y: event.clientY });
        }}
        headerActions={
          <IconButton
            icon="arrowRight"
            size="xs"
            variant="muted"
            tooltip={`Go to ${channelName}`}
            aria-label={`Go to ${channelName}`}
            onClick={onNavigateToVoiceChannel}
          />
        }
        compact={
          <div className="relative">
            {media(true)}
            <span className="absolute bottom-1.5 left-1.5 max-w-[calc(100%-12px)] truncate rounded-sm bg-black/60 px-1.5 text-ui-2xs font-semibold text-white">
              <InlineEmojiText text={displayName} />
            </span>
          </div>
        }
        sheetTitle={label}
        sheetDescription={channelName}
        sheet={
          <div className="flex flex-col gap-3">
            <div className="overflow-hidden rounded-lg">{media()}</div>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="secondary"
                size="lg"
                onClick={onNavigateToVoiceChannel}
              >
                <Icon name="arrowRight" size="sm" />
                Go to channel
              </Button>
              <Button
                variant="secondary"
                size="lg"
                aria-label="Open stream settings"
                onClick={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  setMenuPosition({ x: rect.left, y: rect.top });
                }}
              >
                <Icon name="sliders" size="sm" />
                Settings
              </Button>
            </div>
            <Button
              variant="destructive"
              size="lg"
              aria-label={primaryActionAriaLabel}
              onClick={() => {
                onPrimaryAction();
                setMenuPosition(null);
              }}
            >
              <Icon name="streamOff" size="sm" />
              {primaryActionTooltip}
            </Button>
          </div>
        }
        overlay={
          menuPosition ? (
            <StreamContextMenu
              {...menuProps}
              x={menuPosition.x}
              y={menuPosition.y}
              userId={userId}
              onClose={() => setMenuPosition(null)}
            />
          ) : null
        }
      >
        <div className="group relative">
          {media()}
          <div className="absolute right-2 bottom-2 z-20 flex items-center gap-1.5">
            <IconButton
              icon="sliders"
              size="sm"
              variant="plain"
              tooltip="Stream Settings"
              aria-label="Open stream settings"
              className="bg-black/55 text-white/85 pointer-fine:hover:bg-black/70 pointer-fine:hover:text-white"
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                setMenuPosition((current) =>
                  current ? null : { x: rect.right + 4, y: rect.top - 4 },
                );
              }}
            />
            <IconButton
              icon="streamOff"
              size="sm"
              variant="plain"
              tooltip={primaryActionTooltip}
              aria-label={primaryActionAriaLabel}
              className="bg-black/55 text-white/85 transition-colors pointer-fine:hover:bg-destructive pointer-fine:hover:text-destructive-foreground"
              onClick={() => {
                onPrimaryAction();
                setMenuPosition(null);
              }}
            />
          </div>
        </div>
      </FloatingSurface>
    </TooltipProvider>
  );
}
