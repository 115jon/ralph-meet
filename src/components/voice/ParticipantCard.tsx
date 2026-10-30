import { useLongPressMenu } from "@/hooks/useLongPress";
import { useSpeakingAttr } from "@/hooks/useIsSpeaking";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/IconButton";
import { HIT, PRESS, REVEAL } from "@/components/ui/interaction";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import { LedLabel } from "@/components/ui/led";
import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import InlineEmojiText from "@/components/chat/InlineEmojiText";
import { QualityMonitor } from "./QualityMonitor";
import { StreamWatcherList } from "./StreamWatcherList";
import { StreamLoadingIndicator } from "./StreamLoadingIndicator";
import { GridItem, VoiceActions } from "./types";
import { VideoPlayer } from "./VideoPlayer";
import { StickerReactionsOverlay } from "./StickerReactionsOverlay";
import { TileAvatar, TileNameplate } from "./TileParts";
import {
  cardPropsEqual,
  ROW_TILE_AVATAR_BOX,
  ROW_TILE_AVATAR_SIZE,
  streamOwnerName,
  tileDisplayName,
  TILE_SURFACE,
  useTileTintStyle,
} from "./tile-utils";

const StreamContextMenu = lazy(() =>
  import("../StreamContextMenu").then((mod) => ({
    default: mod.StreamContextMenu,
  })),
);

export interface ParticipantCardProps {
  item: GridItem;
  isFocused: boolean;
  isTray: boolean;
  /** A tile in the DM call's row (always 16:9; see ROW_TILE_AVATAR_SIZE). */
  row?: boolean;
  globalDeafened: boolean;
  onClick: () => void;
  voiceActions?: VoiceActions;
  watchedStreams: Record<string, boolean>;
  streamThumbnails: Record<string, string>;
  suppressVideo?: boolean;
  /** Entrance order on join (spec §6: 30ms stagger, capped at 6 tiles). */
  enterIndex?: number;
  className?: string;
}

/**
 * One person (or one stream) in the call (talk-tree-spec §8 Voice). The
 * outer box carries `.rm-speak` and this person's `data-speaking` from
 * useSpeakingAttr, so a speaking flip re-renders this leaf only; the card is
 * memoised and ignores `item.isSpeaking` for the same reason.
 */
function ParticipantCardImpl({
  item,
  isFocused,
  isTray,
  row = false,
  globalDeafened: _globalDeafened,
  onClick,
  voiceActions,
  watchedStreams,
  streamThumbnails,
  suppressVideo = false,
  enterIndex,
  className,
}: ParticipantCardProps) {
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    isMini?: boolean;
  } | null>(null);
  const tileLongPress = useLongPressMenu((e) =>
    setContextMenu({ x: e.clientX, y: e.clientY, isMini: false }),
  );
  // The card is memoised without comparing onClick, so call the latest one.
  const onClickRef = useRef(onClick);
  useLayoutEffect(() => {
    onClickRef.current = onClick;
  });
  const handleClick = useCallback(() => onClickRef.current(), []);

  const isScreen = item.type === "screen";
  const isCamera = item.type === "camera";
  const speakingAttr = useSpeakingAttr(isScreen ? null : item.userId);
  const tintStyle = useTileTintStyle(item.userId);

  const isPreviewHidden =
    isScreen && item.isLocal && !!voiceActions?.isPreviewHidden;
  const isEffectivelyWatchingStream =
    isScreen && (item.isLocal || !!watchedStreams[item.userId] || isFocused);
  const streamWatchers = isScreen
    ? (voiceActions?.watchersByStreamer?.[item.userId] ?? [])
    : [];
  const ownerName = streamOwnerName(item);
  const displayName = tileDisplayName(item);
  const shouldShowWatchers =
    !isTray && streamWatchers.length > 0 && isEffectivelyWatchingStream;
  const shouldRenderVideo = !!item.stream && !suppressVideo && !isPreviewHidden;
  const shouldShowWatchPrompt =
    isScreen && !item.isLocal && !isEffectivelyWatchingStream;
  const shouldRenderThumbnailPoster =
    isScreen &&
    !shouldRenderVideo &&
    !!streamThumbnails[item.userId] &&
    !shouldShowWatchPrompt &&
    !isPreviewHidden;
  const isLoadingStream =
    (isCamera || isScreen) &&
    !item.stream &&
    !shouldShowWatchPrompt &&
    !isPreviewHidden &&
    !shouldRenderThumbnailPoster;
  const showsMedia =
    ((isCamera || isScreen) && shouldRenderVideo) ||
    shouldRenderThumbnailPoster;
  const showAvatar =
    !showsMedia &&
    !shouldShowWatchPrompt &&
    !isPreviewHidden &&
    !isLoadingStream;

  const enterDelay =
    enterIndex === undefined ? undefined : `${Math.min(enterIndex, 5) * 30}ms`;

  return (
    <>
      <div
        {...speakingAttr}
        data-tile=""
        data-tile-kind={item.type}
        className={cn(
          // Outer box: the speaking ring (::after, inset -2px) and the join
          // entrance. The inner box clips media, so the ring lives out here.
          "rm-speak relative aspect-video h-full w-full rounded-lg",
          enterIndex !== undefined &&
            "transition-[opacity,scale] duration-(--dur-3) ease-out starting:scale-(--motion-scale-in) starting:opacity-0",
          className,
        )}
        style={enterDelay ? { transitionDelay: enterDelay } : undefined}
      >
        <div
          style={tintStyle}
          className={cn(
            "@container group isolate relative h-full w-full cursor-pointer overflow-hidden rounded-lg border",
            TILE_SURFACE,
            isFocused
              ? "border-accent-ink"
              : "border-line pointer-fine:hover:border-line-strong",
          )}
        >
          <button
            type="button"
            onClick={handleClick}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenu({ x: e.clientX, y: e.clientY, isMini: false });
            }}
            {...tileLongPress}
            aria-label={`Open participant tile for ${item.name}`}
            aria-pressed={isTray ? isFocused : undefined}
            className="absolute inset-0 z-0 rounded-lg outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
          />
          <StickerReactionsOverlay
            sfu={voiceActions?.sfu}
            senderUserId={item.userId}
          />

          {shouldRenderVideo && (isCamera || isScreen) && (
            <div className="pointer-events-none absolute inset-0 z-10 bg-black">
              <VideoPlayer
                stream={item.stream}
                label={item.name}
                muted={true} // Audio is handled by SFUClient AudioContext
                isLocal={item.isLocal && item.type === "camera"}
                className={cn(
                  "h-full w-full",
                  isScreen ? "object-contain" : "object-cover",
                )}
              />
            </div>
          )}

          {shouldRenderThumbnailPoster && (
            <div className="pointer-events-none absolute inset-0 z-10 bg-black">
              <img
                src={streamThumbnails[item.userId]}
                alt={`${item.name} stream thumbnail`}
                className="h-full w-full object-cover"
              />
            </div>
          )}

          {/* Local share with its preview paused to save resources. */}
          {isPreviewHidden && (
            <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2">
              <Icon name="eyeOff" size="lg" className="text-ink-3" />
              <span className="text-ui-xs font-medium text-ink-2">
                Preview paused
              </span>
            </div>
          )}

          {isLoadingStream && (
            <StreamLoadingIndicator
              name={ownerName}
              className="bg-transparent"
            />
          )}

          {/* An unwatched remote share: a still of it under a scrim, Watch. */}
          {shouldShowWatchPrompt && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 overflow-hidden p-2 text-center">
              {streamThumbnails[item.userId] && (
                <img
                  src={streamThumbnails[item.userId]}
                  className="pointer-events-none absolute inset-0 h-full w-full object-cover"
                  alt=""
                />
              )}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-ply-2/85"
              />
              <span className="relative flex size-8 shrink-0 items-center justify-center rounded-md bg-live-tint text-live-ink">
                <Icon name="screenShare" state="active" size="sm" />
              </span>
              <p className="relative w-full truncate px-1 text-ui-xs font-medium text-ink-1">
                <InlineEmojiText text={`${ownerName} is sharing`} />
              </p>
              <Button
                size="sm"
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

          {showAvatar && (
            <div
              className={cn(
                "pointer-events-none absolute inset-0 z-10 flex justify-center",
                // A tray tile is short: the avatar sits high so the nameplate
                // under it never overlaps the square.
                isTray
                  ? "items-start pt-2"
                  : row
                    ? ROW_TILE_AVATAR_BOX
                    : "items-center p-4",
              )}
            >
              <TileAvatar
                name={item.name}
                avatar={item.avatar}
                avatarDisplay={item.avatarDisplay}
                ringing={!!item.isRinging}
                sizeClassName={
                  isTray ? "size-10" : row ? ROW_TILE_AVATAR_SIZE : undefined
                }
                initialClassName={isTray ? "text-ui-md" : undefined}
              />
            </div>
          )}

          {shouldShowWatchers && (
            <div className="pointer-events-none absolute top-2 right-2 z-10 max-w-[75%]">
              <StreamWatcherList watchers={streamWatchers} />
            </div>
          )}

          <TileNameplate
            name={isScreen ? ownerName : displayName}
            overMedia={showsMedia}
            state={
              isScreen
                ? undefined
                : {
                    isMuted: item.isMuted,
                    isDeafened: item.isDeafened,
                    serverMute: item.serverMute,
                  }
            }
            kindIcon={isScreen ? "screenShare" : undefined}
            kindLabel={isScreen ? "Screen" : undefined}
            meta={
              item.isRinging ? (
                <LedLabel state="idle" size={6} className="shrink-0">
                  Ringing
                </LedLabel>
              ) : isCamera && !isTray ? (
                <span
                  className={cn(
                    "shrink-0 rounded-xs px-1 text-num-xs",
                    showsMedia ? "bg-white/15" : "bg-tint-2 text-ink-2",
                  )}
                >
                  <QualityMonitor
                    track={item.stream?.getVideoTracks()[0]}
                    signaledQuality={null}
                    sfu={voiceActions?.sfu}
                    userId={item.userId}
                    type="cam"
                  />
                </span>
              ) : null
            }
            className={cn(
              "absolute bottom-2 left-2 z-10",
              isTray && "bottom-1 left-1",
            )}
          />

          {/* Local share: pause / resume its preview. */}
          {isScreen && item.isLocal && voiceActions?.togglePreviewHidden && (
            <div
              data-preview-toggle="true"
              className={cn("absolute top-2 left-2 z-10", REVEAL)}
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
                aria-label={
                  isPreviewHidden ? "Resume preview" : "Pause preview"
                }
                className={cn(
                  PRESS,
                  HIT,
                  "flex h-6 items-center gap-1.5 rounded-sm bg-black/60 px-2 text-ui-xs font-medium text-white outline-none focus-visible:outline-2 focus-visible:outline-focus",
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

          {!isTray && (
            <div className={cn("absolute right-2 bottom-2 z-10", REVEAL)}>
              <IconButton
                aria-label={`More options for ${item.name}`}
                icon="more"
                size={24}
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
      </div>

      {contextMenu && (
        <Suspense fallback={null}>
          <StreamContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            userId={item.userId}
            isStreaming={isScreen}
            onClose={() => setContextMenu(null)}
            isClosing={false}
            {...voiceActions}
            watchedStreams={watchedStreams}
            currentScreenSource={voiceActions?.currentScreenSource}
          />
        </Suspense>
      )}
    </>
  );
}

export const ParticipantCard = memo(ParticipantCardImpl, cardPropsEqual);
ParticipantCard.displayName = "ParticipantCard";
