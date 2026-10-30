import { Slider } from "@/components/ContextMenu/ContextMenuItems";
import { useVoiceSettingsStore } from "@/stores/useVoiceSettingsStore";
import { cn } from "@/lib/utils";
import { HIT, PRESS } from "@/components/ui/interaction";
import { Avatar } from "@/components/ui/avatar";
import { Icon } from "@/components/ui/icon";
import { getAuthAssetUrl } from "@/lib/platform";
import InlineEmojiText from "@/components/chat/InlineEmojiText";
import React, {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { flushSync } from "react-dom";
import { ParticipantCard } from "./ParticipantCard";
import { StickerReactionsOverlay } from "./StickerReactionsOverlay";
import { StreamLoadingIndicator } from "./StreamLoadingIndicator";
import { GridItem, VoiceActions } from "./types";
import { VideoPlayer } from "./VideoPlayer";
import {
  fitGrid,
  GRID_GAP,
  gridColumnsClass,
  tileAspectClass,
  type GridFit,
} from "./grid-columns";
import { TileAvatar } from "./TileParts";
import {
  FOCUSED_AVATAR_SIZE,
  streamOwnerName,
  TILE_SURFACE,
  useTileTintStyle,
} from "./tile-utils";

const StreamContextMenu = lazy(() =>
  import("../StreamContextMenu").then((mod) => ({
    default: mod.StreamContextMenu,
  })),
);

function getFocusedItemLabel(item: GridItem | undefined) {
  if (!item) return "";
  if (item.type !== "screen") return item.name;
  if (item.isLocal) return "Your stream";
  return `${streamOwnerName(item)}'s Stream`;
}

function hasLiveAudioTrack(stream: MediaStream | null | undefined) {
  return (
    stream?.getAudioTracks?.().some((track) => track.readyState === "live") ??
    false
  );
}

/** Stage padding (p-4) on each side, subtracted before fitting tiles. */
const STAGE_PAD = 16;

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

/** A view-transition-name from an item id (idents can't start with a digit). */
function tileTransitionName(id: string) {
  return `tile-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

/**
 * Join and leave reflow with View Transitions (spec §6): when the set of
 * tiles changes, the new set is committed inside `startViewTransition`, so
 * the tile that left fades and the rest glide to their new cells
 * (`view-transition-class: tile`, motion.css). Content changes to the same
 * set render straight through. Skipped under reduced motion, while the app is
 * inactive, and where the API is missing.
 */
function useReflowTransition(items: GridItem[], enabled: boolean): GridItem[] {
  const key = items.map((item) => item.id).join("\u0000");
  const [shown, setShown] = useState(() => ({ key, items }));
  const pending = key !== shown.key;

  useEffect(() => {
    if (!pending) return;
    const commit = () => setShown({ key, items });
    const doc = document as Document & {
      startViewTransition?: (cb: () => void) => unknown;
    };
    if (
      !enabled ||
      !doc.startViewTransition ||
      doc.hidden ||
      doc.documentElement.hasAttribute("data-app-inactive") ||
      prefersReducedMotion()
    ) {
      commit();
      return;
    }
    doc.startViewTransition(() => flushSync(commit));
  }, [pending, key, items, enabled]);

  return pending ? shown.items : items;
}

/**
 * Measures the stage box and fits tiles to its width AND height: 16:9, or
 * filling the stage's height for 2–4 people on a phone-width stage.
 */
function useGridFit(
  ref: React.RefObject<HTMLDivElement | null>,
  count: number,
): GridFit | null {
  const [fit, setFit] = useState<GridFit | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const next = fitGrid(
        el.clientWidth - STAGE_PAD * 2,
        el.clientHeight - STAGE_PAD * 2,
        count,
      );
      setFit((prev) =>
        prev &&
        prev.cols === next.cols &&
        prev.tileW === next.tileW &&
        prev.tileH === next.tileH &&
        prev.scrolls === next.scrolls &&
        prev.aspect === next.aspect
          ? prev
          : next,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, count]);
  return fit;
}

interface VoiceGridProps {
  items: GridItem[];
  focusedId: string | null;
  onFocus: (id: string | null) => void;
  globalDeafened: boolean;
  currentSettings: any;
  voiceActions?: VoiceActions;
  watchedStreams: Record<string, boolean>;
  streamThumbnails: Record<string, string>;
  className?: string;
  layoutMode?: "grid" | "row";
}

export const VoiceGrid = React.memo((props: VoiceGridProps) => {
  const { items, focusedId } = props;
  const focusedItem = focusedId
    ? items.find((i) => i.id === focusedId)
    : undefined;
  if (focusedItem) return <FocusedStage {...props} focusedItem={focusedItem} />;
  if (props.layoutMode === "row") return <RowLayout {...props} />;
  return <FitGridLayout {...props} />;
});

VoiceGrid.displayName = "VoiceGrid";

function RowLayout({
  items,
  focusedId,
  onFocus,
  globalDeafened,
  voiceActions,
  watchedStreams,
  streamThumbnails,
  className,
}: VoiceGridProps) {
  return (
    <div
      data-voice-grid="row"
      className={cn(
        "flex h-full w-full flex-row items-center justify-center gap-2 overflow-hidden p-2",
        className,
      )}
    >
      {items.map((item, index) => (
        <div
          key={item.id}
          className="relative flex h-full max-w-[400px] min-w-0 flex-1 items-center justify-center"
        >
          <div className="flex aspect-video max-h-full w-full items-center justify-center">
            <ParticipantCard
              item={item}
              isFocused={focusedId === item.id}
              isTray={false}
              row
              globalDeafened={globalDeafened}
              voiceActions={voiceActions}
              watchedStreams={watchedStreams}
              streamThumbnails={streamThumbnails}
              enterIndex={index}
              onClick={() => onFocus(item.id === focusedId ? null : item.id)}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * The stage grid (spec §3): 16:9 tiles sized to fit the stage's width and
 * height, 8px gaps, centred; it scrolls only when tiles would drop under
 * 200px wide. Before the first measurement it falls back to container-query
 * columns.
 */
function FitGridLayout({
  items,
  focusedId,
  onFocus,
  globalDeafened,
  voiceActions,
  watchedStreams,
  streamThumbnails,
  className,
}: VoiceGridProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const shownItems = useReflowTransition(items, true);
  const fit = useGridFit(scrollerRef, shownItems.length);
  const aspectClass = tileAspectClass(fit, shownItems.length);
  const gridStyle: CSSProperties | undefined = fit
    ? {
        gridTemplateColumns: `repeat(${fit.cols}, ${fit.tileW}px)`,
        gridAutoRows: fit.tileH ? `${fit.tileH}px` : undefined,
        gap: GRID_GAP,
      }
    : undefined;

  return (
    <div
      ref={scrollerRef}
      data-voice-grid-scroller=""
      className="@container flex h-full min-h-0 w-full flex-col overflow-y-auto overscroll-contain p-4"
    >
      <div
        data-voice-grid
        data-fit={fit ? `${fit.cols}x${fit.tileW}` : undefined}
        data-tile-aspect={fit?.aspect}
        className={cn(
          // `safe center` centres a grid that fits but starts at the top once
          // it overflows, so the first tiles stay reachable.
          // Auto margins centre it vertically while it fits and fall back to
          // the top once it overflows.
          "my-auto grid w-full shrink-0 auto-rows-max place-content-[safe_center] gap-2",
          !fit && gridColumnsClass(shownItems.length),
          className,
        )}
        style={gridStyle}
      >
        {shownItems.map((item, index) => (
          <div
            key={item.id}
            className="min-w-0"
            style={
              {
                viewTransitionName: tileTransitionName(item.id),
                viewTransitionClass: "tile",
              } as CSSProperties
            }
          >
            <ParticipantCard
              item={item}
              isFocused={focusedId === item.id}
              isTray={false}
              globalDeafened={globalDeafened}
              voiceActions={voiceActions}
              watchedStreams={watchedStreams}
              streamThumbnails={streamThumbnails}
              enterIndex={index}
              className={aspectClass}
              onClick={() => onFocus(item.id === focusedId ? null : item.id)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * One tile on stage. The header is a bar above (never an overlay on the
 * stream), media sits letterboxed in its own black box inside the stage
 * padding, and a person without media gets an 80px avatar on their tinted
 * 16:9 surface (never their picture stretched across the frame).
 */
function FocusedStage({
  focusedItem,
  onFocus,
  globalDeafened,
  currentSettings,
  voiceActions,
  streamThumbnails,
}: VoiceGridProps & { focusedItem: GridItem }) {
  const focusedUserId = focusedItem.userId;
  const isFocusedScreen = focusedItem.type === "screen";
  const isFocusedCamera = focusedItem.type === "camera";
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const setPeerVolume = useVoiceSettingsStore((s) => s.setPeerVolume);
  const setPeerStreamVolume = useVoiceSettingsStore(
    (s) => s.setPeerStreamVolume,
  );
  const focusedPeerVolume = useVoiceSettingsStore((s) => {
    const peer = s.getSettings().peerSettings[focusedUserId];
    if (!peer) return 100;
    return isFocusedScreen ? peer.streamVolume : peer.volume;
  });
  const tintStyle = useTileTintStyle(focusedUserId);

  const isPreviewHidden =
    isFocusedScreen && focusedItem.isLocal && !!voiceActions?.isPreviewHidden;
  const focusedThumbnailPoster =
    isFocusedScreen && !isPreviewHidden
      ? streamThumbnails[focusedItem.userId]
      : null;
  const isStreaming =
    (isFocusedCamera || isFocusedScreen) &&
    !!focusedItem.stream &&
    !isPreviewHidden;
  const isLoadingStream =
    (isFocusedCamera || isFocusedScreen) &&
    !focusedItem.stream &&
    !isPreviewHidden &&
    !focusedThumbnailPoster;
  const focusedLabel = getFocusedItemLabel(focusedItem);
  const showFocusedVolume =
    !focusedItem.isLocal &&
    (isFocusedScreen ? hasLiveAudioTrack(focusedItem.stream) : true);
  const overMedia = isStreaming || !!focusedThumbnailPoster || isPreviewHidden;

  return (
    <section
      data-focused-stage="true"
      aria-label={focusedLabel}
      className="group/stage relative isolate flex h-full w-full flex-col overflow-hidden bg-ply-0 p-4"
    >
      <StickerReactionsOverlay sfu={voiceActions?.sfu} />
      <button
        type="button"
        data-focused-bg="true"
        className="absolute inset-0 z-0 border-0 bg-transparent p-0 outline-none"
        aria-label="Clear focused participant"
        onClick={() => onFocus(null)}
        onContextMenu={(e) => {
          e.preventDefault();
          setContextMenu({ x: e.clientX, y: e.clientY });
        }}
      />

      <div className="pointer-events-none relative z-10 flex min-h-0 flex-1 items-center justify-center">
        {overMedia ? (
          <div
            data-focused-visual="true"
            className="relative h-full w-full overflow-hidden rounded-lg bg-black"
          >
            {isStreaming ? (
              <VideoPlayer
                stream={focusedItem.stream}
                label={focusedItem.name}
                muted={
                  isFocusedScreen ||
                  globalDeafened ||
                  !focusedItem.isLocal ||
                  (focusedItem.isLocal
                    ? true
                    : !!currentSettings?.peerSettings?.[focusedItem.userId]
                        ?.muted)
                }
                isLocal={focusedItem.isLocal && focusedItem.type === "camera"}
                className="h-full w-full object-contain"
              />
            ) : focusedThumbnailPoster ? (
              <img
                src={focusedThumbnailPoster}
                alt={`${focusedItem.name} stream thumbnail`}
                className="h-full w-full object-contain"
              />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-center">
                <Icon name="eyeOff" size="lg" className="text-white/60" />
                <span className="text-ui-xs font-medium text-white/70">
                  Preview paused
                </span>
              </div>
            )}
          </div>
        ) : (
          <div
            data-focused-visual="true"
            style={tintStyle}
            className={cn(
              "relative flex aspect-video max-h-full w-full max-w-[960px] flex-col items-center justify-center gap-3 overflow-hidden rounded-lg border border-line",
              TILE_SURFACE,
            )}
          >
            {focusedItem.avatar ? (
              <Avatar
                name={focusedItem.name}
                src={getAuthAssetUrl(focusedItem.avatar)}
                size={80}
              />
            ) : (
              <TileAvatar
                name={focusedItem.name}
                sizeClassName={FOCUSED_AVATAR_SIZE}
              />
            )}
            <p className="max-w-[80%] truncate font-display [font-optical-sizing:auto] text-[18px] leading-6 font-bold text-ink-1">
              <InlineEmojiText text={focusedItem.name} />
            </p>
            {isLoadingStream && (
              <StreamLoadingIndicator
                name={streamOwnerName(focusedItem)}
                className="bg-ply-2/90"
              />
            )}
          </div>
        )}

        {isFocusedScreen &&
          focusedItem.isLocal &&
          voiceActions?.togglePreviewHidden && (
            <div
              data-preview-toggle="true"
              className="pointer-events-auto absolute top-3 left-3 z-10 pointer-fine:opacity-0 transition-opacity duration-(--dur-1) pointer-fine:group-hover/stage:opacity-100 group-focus-within/stage:opacity-100"
            >
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
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
                  "flex h-7 items-center gap-1.5 rounded-sm bg-black/60 px-2 text-ui-xs font-medium text-white outline-none focus-visible:outline-2 focus-visible:outline-focus",
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
      </div>

      {showFocusedVolume && (
        <div className="pointer-events-auto absolute right-7 bottom-7 z-20 w-[min(300px,calc(100%-3.5rem))] rounded-lg border border-line bg-ply-3 py-1 shadow-float">
          <Slider
            label={isFocusedScreen ? "Stream volume" : "User volume"}
            value={focusedPeerVolume}
            onChange={(value) => {
              if (isFocusedScreen) setPeerStreamVolume(focusedUserId, value);
              else setPeerVolume(focusedUserId, value);
            }}
          />
        </div>
      )}

      {contextMenu && (
        <Suspense fallback={null}>
          <StreamContextMenu
            userId={focusedItem.userId}
            x={contextMenu.x}
            y={contextMenu.y}
            isStreaming={focusedItem.type === "screen"}
            onClose={() => setContextMenu(null)}
            isClosing={false}
            {...(voiceActions ?? {})}
          />
        </Suspense>
      )}
    </section>
  );
}
