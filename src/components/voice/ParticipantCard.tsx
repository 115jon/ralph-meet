import { useLongPressMenu } from "@/hooks/useLongPress";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/IconButton";
import { PRESS } from "@/components/ui/interaction";
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
  const isLoadingStream =
    (isCamera || isScreen) &&
    !item.stream &&
    !shouldShowWatchPrompt &&
    !isPreviewHidden;

  return (
    <>
      <div
        className={cn(
          "relative group rounded-xl overflow-hidden bg-rm-bg-elevated/40 transition-[box-shadow,opacity] cursor-pointer aspect-video w-full h-full",
          isFocused && "ring-2 ring-rm-text/20 z-50",
          item.isSpeaking &&
            "ring-2 ring-primary shadow-[0_6px_18px_-6px_var(--rm-glow)] z-20",
          item.isRinging &&
            "ring-2 ring-primary/50 shadow-[0_6px_18px_-6px_var(--rm-glow)] animate-pulse z-20",
          !isFocused &&
            !item.isSpeaking &&
            !item.isRinging &&
            "ring-1 ring-rm-border pointer-fine:hover:ring-rm-border-strong",
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
          className="absolute inset-0 z-10 rounded-xl outline-none"
        />
        <StickerReactionsOverlay
          sfu={voiceActions?.sfu}
          senderUserId={item.userId}
        />

        {/* Selected Overlay */}
        {isFocused && (
          <div className="absolute inset-0 z-10 bg-black/40 shadow-[inset_0_0_100px_rgba(0,0,0,0.8)] pointer-events-none animate-in fade-in duration-300" />
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
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/30 pointer-events-none animate-in fade-in duration-300">
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
          <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-black/70 backdrop-blur-sm">
            <Icon name="eyeOff" size="xl" className="text-white/50" />
            <span className="text-ui-2xs font-semibold text-white/60 uppercase tracking-[0.08em]">
              Preview paused
            </span>
          </div>
        )}

        {/* Loading State */}
        {isLoadingStream && <StreamLoadingIndicator />}

        {/* Watch Stream Prompt / Thumbnail Overlay */}
        {shouldShowWatchPrompt && (
          <div className="absolute inset-0 z-40 bg-rm-bg-primary flex flex-col items-center justify-center p-2 text-center overflow-hidden">
            {streamThumbnails[item.userId] && (
              <img
                src={streamThumbnails[item.userId]}
                className="absolute inset-0 w-full h-full object-cover blur-sm opacity-60 scale-105 pointer-events-none"
                alt="Stream Preview"
              />
            )}
            <div className="relative z-10 flex flex-col items-center justify-center p-1 sm:p-2 w-full h-full overflow-hidden">
              <div className="shrink border border-rm-border rounded-xl bg-rm-bg-elevated/60 p-2 sm:w-8 sm:h-8 text-rm-text-muted shadow-lg backdrop-blur-md flex items-center justify-center transition-transform duration-200">
                <Icon
                  name="monitor"
                  size="xs"
                  className="sm:w-4 sm:h-4 text-rm-text-muted shrink-0"
                />
              </div>

              <div className="shrink min-h-0 flex flex-col items-center justify-center mt-1 sm:mt-2">
                <h3 className="text-ui-2xs sm:text-ui-2xs font-bold text-rm-text tracking-tight truncate w-full text-center px-1">
                  <InlineEmojiText text={`${streamDisplayName}'s Stream`} />
                </h3>
              </div>

              <Button
                size="xs"
                onClick={(e) => {
                  e.stopPropagation();
                  voiceActions?.onToggleWatch?.(item.userId);
                }}
                className="mt-1 max-w-full truncate text-ui-2xs font-semibold uppercase tracking-[0.08em] sm:mt-2 sm:h-7 sm:px-3"
              >
                Watch Stream
              </Button>
            </div>
          </div>
        )}

        {/* Full-size Avatar (Only if not showing video, prompt, or paused-preview placeholder) */}
        {!((isCamera || isScreen) && shouldRenderVideo) &&
          !shouldShowWatchPrompt &&
          !isPreviewHidden &&
          !shouldRenderThumbnailPoster && (
            <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center p-4">
              {item.avatar ? (
                <div className="h-20 w-20 overflow-visible rounded-full shadow-lg sm:h-28 sm:w-28">
                  <AvatarImage
                    src={getAuthAssetUrl(item.avatar)}
                    alt={item.name}
                    display={item.avatarDisplay}
                  />
                </div>
              ) : (
                <div className="w-20 h-20 sm:w-28 sm:h-28 flex items-center justify-center bg-black/40 rounded-full shadow-lg">
                  <span className="text-ui-2xl sm:text-display-lg font-semibold text-white">
                    {item.name[0]?.toUpperCase()}
                  </span>
                </div>
              )}

              {/* Type Overlay Icon */}
              {isTray && isFocused && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/70 animate-in fade-in duration-300">
                  {isScreen ? (
                    <Icon
                      name="screenShare"
                      state="active"
                      size="2xl"
                      className="text-white"
                    />
                  ) : isCamera ? (
                    <Icon
                      name="camera"
                      state="active"
                      size="2xl"
                      className="text-white"
                    />
                  ) : (
                    <Icon
                      name="call"
                      state="active"
                      size="2xl"
                      className="text-white"
                    />
                  )}
                </div>
              )}
            </div>
          )}

        {/* Ringing Overlay Label */}
        {item.isRinging && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/40 pointer-events-none">
            <span className="bg-rm-bg-surface/80 backdrop-blur rounded-full px-3 py-1 text-ui-xs font-semibold text-rm-text animate-pulse shadow-xl">
              Calling...
            </span>
          </div>
        )}

        {shouldShowWatchers && (
          <div className="pointer-events-none absolute right-2 top-2 z-40 max-w-[75%]">
            <StreamWatcherList watchers={streamWatchers} />
          </div>
        )}

        {/* Status Indicators & Labels */}
        <div className="pointer-events-none absolute bottom-2 left-2 z-30 flex items-center gap-2">
          {isScreen ? (
            <div className="bg-rm-bg-primary/85 px-2 py-1 rounded-md border border-rm-border">
              <span className="text-ui-2xs font-semibold text-rm-text truncate max-w-[120px]">
                <InlineEmojiText text={streamDisplayName} />
              </span>
            </div>
          ) : (
            <div className="bg-rm-bg-primary/85 px-2 py-1 rounded-md border border-rm-border flex items-center gap-2">
              <div className="flex items-center gap-1">
                {item.isDeafened && (
                  <Icon
                    name="deafen"
                    state="off"
                    size="xs"
                    className="text-rm-text-muted shrink-0"
                  />
                )}
                {item.isMuted && (
                  <Icon
                    name="mic"
                    state="off"
                    size="xs"
                    className={
                      item.serverMute
                        ? "text-destructive shrink-0"
                        : "text-rm-text-muted shrink-0"
                    }
                  />
                )}
              </div>

              <span className="text-ui-2xs font-semibold text-rm-text truncate max-w-[100px]">
                <InlineEmojiText text={streamDisplayName} />
              </span>
              {isCamera && (
                <span className="bg-rm-bg-surface/60 px-1.5 rounded-xs text-ui-2xs font-bold text-rm-text uppercase tracking-tighter border border-rm-border tabular-nums">
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
          )}
        </div>

        {/* Hide/Show Preview toggle — only on local screen tile */}
        {isScreen && item.isLocal && voiceActions?.togglePreviewHidden && (
          <div
            data-preview-toggle="true"
            className="pointer-fine:pointer-events-none absolute top-2 left-2 z-50 pointer-fine:opacity-0 transition-opacity pointer-fine:group-hover:pointer-events-auto pointer-fine:group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100"
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
                "flex items-center gap-1.5 rounded-md bg-black/55 px-2 py-1 text-ui-2xs font-medium text-white backdrop-blur-md outline-none",
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
          <div className="pointer-fine:pointer-events-none absolute bottom-2 right-2 z-50 pointer-fine:opacity-0 transition-opacity pointer-fine:group-hover:pointer-events-auto pointer-fine:group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100">
            <IconButton
              aria-label="More options"
              icon="more"
              size="xs"
              className="rounded-md bg-rm-bg-primary/60 backdrop-blur-md border border-rm-border"
              onClick={(e) => {
                e.stopPropagation();
                setContextMenu({ x: e.clientX, y: e.clientY, isMini: true });
              }}
            />
          </div>
        )}
        {isTray && (
          <div className="pointer-events-none absolute top-2 right-2 z-30 opacity-0 transition-opacity pointer-fine:group-hover:opacity-100">
            <div className="bg-rm-bg-primary/60 backdrop-blur-md p-1 rounded-lg border border-rm-border">
              <Icon
                name="chevronDown"
                size="xs"
                className="text-rm-text-muted"
              />
            </div>
          </div>
        )}

        {/* Hover Overlay */}
        <div className="absolute inset-0 bg-black opacity-0 pointer-fine:group-hover:opacity-10 transition-opacity pointer-events-none" />
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
