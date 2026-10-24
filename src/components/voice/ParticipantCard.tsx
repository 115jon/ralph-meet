import { useLongPressMenu } from "@/hooks/useLongPress";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/IconButton";
import { HIT, PRESS } from "@/components/ui/interaction";
import { extractDominantColor } from "@/lib/color-utils";
import { getAuthAssetUrl } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import React, { lazy, Suspense, useEffect, useState } from "react";
import { AvatarImage } from "@/components/chat/AvatarImage";
import InlineEmojiText from "@/components/chat/InlineEmojiText";
import { QualityMonitor } from "./QualityMonitor";
import { StreamWatcherList } from "./StreamWatcherList";
import { StreamLoadingIndicator } from "./StreamLoadingIndicator";
import { GridItem, VoiceActions } from "./types";
import { VideoPlayer } from "./VideoPlayer";
import { StickerReactionsOverlay } from "./StickerReactionsOverlay";

/* Tile avatar: 64 by default, 80 from a 320px tile, 112 from 448; 48 in
 * the 160px members tray. Driven by the tile's own `@container`. */
const AVATAR_SIZE_TILE = "size-16 @min-[320px]:size-20 @min-[448px]:size-28";

const StreamContextMenu = lazy(() =>
  import("../StreamContextMenu").then((mod) => ({
    default: mod.StreamContextMenu,
  })),
);

interface ParticipantCardProps {
  item: GridItem;
  isFocused: boolean;
  isTray: boolean;
  globalDeafened: boolean;
  onClick: () => void;
  voiceActions?: VoiceActions;
  watchedStreams: Record<string, boolean>;
  streamThumbnails: Record<string, string>;
  suppressVideo?: boolean;
}

export const ParticipantCard: React.FC<ParticipantCardProps> = ({
  item,
  isFocused,
  isTray,
  globalDeafened: _globalDeafened,
  onClick,
  voiceActions,
  watchedStreams,
  streamThumbnails,
  suppressVideo = false,
}) => {
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    isMini?: boolean;
  } | null>(null);
  const tileLongPress = useLongPressMenu((e) =>
    setContextMenu({ x: e.clientX, y: e.clientY, isMini: false }),
  );
  const shouldRenderStreamMenu = contextMenu != null;
  const renderedContextMenu = contextMenu;
  const [dominantColor, setDominantColor] = useState<string | null>(null);

  useEffect(() => {
    if (!item.avatar) return;

    let isActive = true;
    extractDominantColor(getAuthAssetUrl(item.avatar)).then(
      (color: string | null) => {
        if (isActive) {
          setDominantColor(color);
        }
      },
    );

    return () => {
      isActive = false;
    };
  }, [item.avatar]);

  const resolvedDominantColor = item.avatar ? dominantColor : null;

  const isScreen = item.type === "screen";
  const isCamera = item.type === "camera";
  const isPreviewHidden =
    isScreen && item.isLocal && !!voiceActions?.isPreviewHidden;
  const isEffectivelyWatchingStream =
    isScreen && (item.isLocal || !!watchedStreams[item.userId] || isFocused);
  const streamWatchers = isScreen
    ? (voiceActions?.watchersByStreamer?.[item.userId] ?? [])
    : [];
  const streamDisplayName = isScreen
    ? item.isLocal
      ? "You"
      : item.name.replace(/(?:'s|') Stream$/, "")
    : item.isLocal
      ? "You"
      : item.name;
  const shouldShowWatchers =
    !isTray && streamWatchers.length > 0 && isEffectivelyWatchingStream;
  // When preview is hidden the stream is null; we still want to show video for other cases.
  const shouldRenderVideo = !!item.stream && !suppressVideo && !isPreviewHidden;
  const shouldShowWatchPrompt =
    isScreen && !item.isLocal && !isEffectivelyWatchingStream;
  const shouldRenderThumbnailPoster =
    isScreen &&
    !shouldRenderVideo &&
    !!streamThumbnails[item.userId] &&
    !shouldShowWatchPrompt &&
    !isPreviewHidden;
  const shouldShowFocusedStreamOverlay =
    isScreen && isTray && isFocused && shouldRenderThumbnailPoster;
  const AVATAR_SIZE = isTray ? "size-12" : AVATAR_SIZE_TILE;
  const isLoadingStream =
    (isCamera || isScreen) &&
    !item.stream &&
    !shouldShowWatchPrompt &&
    !isPreviewHidden;

  return (
    <>
      <div
        className={cn(
          // Tile (12.13): surface + hairline ring, its own stacking context
          // so nothing inside paints over the header or dock (VC-17).
          "@container isolate relative group aspect-video h-full w-full cursor-pointer overflow-hidden rounded-xl bg-rm-bg-surface",
          // Speaking is presence green, never the accent (accent = selected).
          item.isSpeaking
            ? "ring-2 ring-rm-status-online"
            : item.isRinging
              ? "ring-2 ring-rm-status-online/50 motion-safe:animate-pulse"
              : isFocused
                ? "ring-2 ring-rm-accent-ink"
                : "ring-1 ring-rm-border pointer-fine:hover:ring-rm-border-strong",
        )}
      >
        <button
          type="button"
          onClick={onClick}
          onContextMenu={(e) => {
            e.preventDefault();
            setContextMenu({ x: e.clientX, y: e.clientY, isMini: false });
          }}
          {...tileLongPress}
          aria-label={`Open participant tile for ${item.name}`}
          className="absolute inset-0 z-0 rounded-xl outline-none"
        />
        <StickerReactionsOverlay
          sfu={voiceActions?.sfu}
          senderUserId={item.userId}
        />

        {/* Selected Overlay */}
        {isFocused && (
          <div className="pointer-events-none absolute inset-0 z-10 bg-black/40 animate-in fade-in duration-200" />
        )}

        {/* Background Effect */}
        {item.avatar && (
          <div
            className="pointer-events-none absolute inset-0 z-0 transition-colors duration-200"
            style={{
              backgroundColor:
                (isCamera || isScreen) && shouldRenderVideo
                  ? "black"
                  : resolvedDominantColor || undefined,
            }}
          />
        )}

        {/* Video Layer */}
        {shouldRenderVideo && (
          <div
            className={cn(
              "pointer-events-none absolute inset-0 z-10 transition-opacity duration-200",
              !(isCamera || isScreen) && "opacity-0",
            )}
          >
            <VideoPlayer
              stream={item.stream}
              label={item.name}
              muted={true} // Audio is handled by SFUClient AudioContext
              isLocal={item.isLocal && item.type === "camera"}
              className={cn(
                "w-full h-full transition-ui",
                isScreen ? "object-contain" : "object-cover",
                shouldShowWatchPrompt && "opacity-0",
              )}
            />
            {/* Dark gradient for labels */}
            <div className="absolute inset-0 bg-linear-to-t from-black/20 via-transparent to-transparent opacity-100 pointer-fine:group-hover:opacity-40 transition-opacity" />
          </div>
        )}

        {shouldRenderThumbnailPoster && (
          <div className="pointer-events-none absolute inset-0 z-10">
            <img
              src={streamThumbnails[item.userId]}
              alt={`${item.name} stream thumbnail`}
              className="h-full w-full object-cover transition-opacity duration-200"
            />
            <div className="absolute inset-0 bg-linear-to-t from-black/30 via-black/5 to-transparent" />
          </div>
        )}

        {shouldShowFocusedStreamOverlay && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-black/30 animate-in fade-in duration-200">
            <Icon
              name="screenShare"
              state="active"
              size="2xl"
              className="text-white"
            />
          </div>
        )}

        {/* Preview Paused Placeholder (local screen share hidden for performance) */}
        {isPreviewHidden && (
          <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-rm-bg-elevated">
            <Icon name="eyeOff" size="xl" className="text-rm-text-muted" />
            <span className="text-ui-xs font-medium text-rm-text-secondary">
              Preview paused
            </span>
          </div>
        )}

        {/* Loading State */}
        {isLoadingStream && <StreamLoadingIndicator />}

        {/* Watch stream Prompt / Thumbnail Overlay */}
        {shouldShowWatchPrompt && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 overflow-hidden bg-rm-bg-surface p-2 text-center @min-[240px]:gap-2">
            {streamThumbnails[item.userId] && (
              <img
                src={streamThumbnails[item.userId]}
                className="pointer-events-none absolute inset-0 h-full w-full object-cover"
                alt=""
              />
            )}
            {/* Theme scrim over the frame so the prompt reads on any image. */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-rm-bg-surface/85"
            />
            <span className="relative flex size-8 shrink-0 items-center justify-center rounded-lg bg-rm-tint-2 text-rm-text-secondary">
              <Icon name="monitor" size="sm" />
            </span>
            <h3 className="relative w-full truncate px-1 text-ui-xs font-semibold text-rm-text">
              <InlineEmojiText text={`${streamDisplayName}'s Stream`} />
            </h3>
            <Button
              size="xs"
              variant="secondary"
              onClick={(e) => {
                e.stopPropagation();
                voiceActions?.onToggleWatch?.(item.userId);
              }}
              className="relative max-w-full truncate"
            >
              Watch stream
            </Button>
          </div>
        )}

        {/* Full-size Avatar (Only if not showing video, prompt, or paused-preview placeholder) */}
        {!((isCamera || isScreen) && shouldRenderVideo) &&
          !shouldShowWatchPrompt &&
          !isPreviewHidden &&
          !shouldRenderThumbnailPoster && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-4">
              {/* Avatar size follows the tile's own width, so it never
                  outgrows a short tile (VC-09): 9/16 of 240 is 135. */}
              {item.avatar ? (
                <div
                  className={cn("overflow-visible rounded-full", AVATAR_SIZE)}
                >
                  <AvatarImage
                    src={getAuthAssetUrl(item.avatar)}
                    alt={item.name}
                    display={item.avatarDisplay}
                  />
                </div>
              ) : (
                <div
                  className={cn(
                    "flex items-center justify-center rounded-full bg-rm-tint-2 font-semibold text-rm-text",
                    AVATAR_SIZE,
                    isTray ? "text-ui-md" : "text-ui-2xl",
                  )}
                >
                  {item.name[0]?.toUpperCase()}
                </div>
              )}

              {/* Type Overlay Icon */}
              {isTray && isFocused && (
                // On stage: the tray tile has no media here, so the marker
                // sits on theme surface, not a black media overlay.
                <div className="absolute inset-0 flex items-center justify-center bg-rm-bg-elevated text-rm-accent-ink animate-in fade-in duration-300">
                  {isScreen ? (
                    <Icon name="screenShare" state="active" size="2xl" />
                  ) : isCamera ? (
                    <Icon name="camera" state="active" size="2xl" />
                  ) : (
                    <Icon name="call" state="active" size="2xl" />
                  )}
                </div>
              )}
            </div>
          )}

        {/* Ringing Overlay Label */}
        {item.isRinging && (
          <span className="pointer-events-none absolute top-2 left-2 z-10 rounded-sm bg-black/60 px-1.5 py-0.5 text-ui-xs font-medium text-white">
            Calling…
          </span>
        )}

        {shouldShowWatchers && (
          <div className="pointer-events-none absolute right-2 top-2 z-10 max-w-[75%]">
            <StreamWatcherList watchers={streamWatchers} />
          </div>
        )}

        {/* Name chip (12.13): a media overlay, so black/60 + white on every
            theme. Status glyphs render only when there is a status. */}
        <div className="pointer-events-none absolute bottom-2 left-2 z-10 flex max-w-[calc(100%-3rem)] items-center gap-1 rounded-sm bg-black/60 px-1.5 py-0.5 text-white">
          {!isScreen && item.isDeafened && (
            <Icon
              name="deafen"
              state="off"
              size="xs"
              label="Deafened"
              className="shrink-0 text-white/80"
            />
          )}
          {!isScreen &&
            item.isMuted &&
            (item.serverMute ? (
              <span className="flex shrink-0 items-center justify-center rounded-xs bg-rm-danger p-0.5 text-rm-on-danger">
                <Icon name="mic" state="off" size="xs" label="Server muted" />
              </span>
            ) : (
              <Icon
                name="mic"
                state="off"
                size="xs"
                label="Muted"
                className="shrink-0 text-white/80"
              />
            ))}
          <span className="min-w-0 truncate text-ui-xs font-medium">
            <InlineEmojiText text={streamDisplayName} />
          </span>
          {isCamera && (
            <span className="shrink-0 rounded-xs bg-white/15 px-1 text-ui-2xs font-semibold tabular-nums">
              <QualityMonitor
                track={item.stream?.getVideoTracks()[0]}
                signaledQuality={null}
                sfu={voiceActions?.sfu}
                userId={item.userId}
                type="cam"
              />
            </span>
          )}
        </div>

        {/* Hide/Show Preview toggle — only on local screen tile */}
        {isScreen && item.isLocal && voiceActions?.togglePreviewHidden && (
          <div
            data-preview-toggle="true"
            className="pointer-fine:pointer-events-none absolute top-2 left-2 z-10 pointer-fine:opacity-0 transition-opacity pointer-fine:group-hover:pointer-events-auto pointer-fine:group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100"
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                voiceActions.togglePreviewHidden?.();
              }}
              title={
                isPreviewHidden
                  ? "Resume preview"
                  : "Pause preview (saves resources)"
              }
              aria-label={isPreviewHidden ? "Resume preview" : "Pause preview"}
              className={cn(
                PRESS,
                HIT,
                "flex items-center gap-1.5 rounded-md bg-black/60 px-2 py-1 text-ui-2xs font-medium text-white outline-none",
              )}
            >
              {isPreviewHidden ? (
                <>
                  <Icon name="eye" size="xs" /> <span>Resume</span>
                </>
              ) : (
                <>
                  <Icon name="eyeOff" size="xs" /> <span>Pause</span>
                </>
              )}
            </button>
          </div>
        )}

        {/* Right status (Ellipsis Bottom Right) */}
        {!isTray && (
          <div className="pointer-fine:pointer-events-none absolute bottom-2 right-2 z-10 pointer-fine:opacity-0 transition-opacity pointer-fine:group-hover:pointer-events-auto pointer-fine:group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100">
            <IconButton
              aria-label={`More options for ${item.name}`}
              icon="more"
              size="xs"
              variant="plain"
              className="bg-black/60 text-white"
              onClick={(e) => {
                e.stopPropagation();
                setContextMenu({ x: e.clientX, y: e.clientY, isMini: true });
              }}
            />
          </div>
        )}
      </div>

      {shouldRenderStreamMenu && renderedContextMenu && (
        <Suspense fallback={null}>
          <StreamContextMenu
            x={renderedContextMenu.x}
            y={renderedContextMenu.y}
            userId={item.userId}
            isStreaming={isScreen}
            onClose={() => setContextMenu(null)}
            isClosing={!contextMenu}
            {...voiceActions}
            watchedStreams={watchedStreams}
            currentScreenSource={voiceActions?.currentScreenSource}
          />
        </Suspense>
      )}
    </>
  );
};
