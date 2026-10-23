import { Slider } from "@/components/ContextMenu/ContextMenuItems";
import { useVoiceSettingsStore } from "@/stores/useVoiceSettingsStore";
import { cn } from "@/lib/utils";
import { PRESS } from "@/components/ui/interaction";
import { Icon } from "@/components/ui/icon";

import { extractDominantColor } from "@/lib/color-utils";
import { getAuthAssetUrl } from "@/lib/platform";
import React, { lazy, Suspense, useEffect, useState } from "react";
import { ParticipantCard } from "./ParticipantCard";
import { StickerReactionsOverlay } from "./StickerReactionsOverlay";
import { QualityMonitor } from "./QualityMonitor";
import { StreamLoadingIndicator } from "./StreamLoadingIndicator";
import { GridItem, VoiceActions } from "./types";
import { VideoPlayer } from "./VideoPlayer";

const StreamContextMenu = lazy(() =>
  import("../StreamContextMenu").then((mod) => ({
    default: mod.StreamContextMenu,
  })),
);

function getFocusedItemLabel(item: GridItem | undefined) {
  if (!item) return "";
  if (item.type !== "screen") return item.name;
  if (item.isLocal) return "Your Stream";
  const ownerName = item.name.replace(/'s Stream$/, "");
  return `${ownerName}'s Stream`;
}

function hasLiveAudioTrack(stream: MediaStream | null | undefined) {
  return (
    stream?.getAudioTracks?.().some((track) => track.readyState === "live") ??
    false
  );
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

export const VoiceGrid = React.memo(
  ({
    items,
    focusedId,
    onFocus,
    globalDeafened,
    currentSettings,
    voiceActions,
    watchedStreams,
    streamThumbnails,
    className,
    layoutMode = "grid",
  }: VoiceGridProps) => {
    const focusedItem = items.find((i) => i.id === focusedId);
    const focusedUserId = focusedItem?.userId ?? null;
    const focusedIsScreen = focusedItem?.type === "screen";
    const [contextMenu, setContextMenu] = useState<{
      x: number;
      y: number;
    } | null>(null);
    const shouldRenderStreamMenu = contextMenu != null;
    const renderedContextMenu = contextMenu;
    const [dominantColor, setDominantColor] = useState<string | null>(null);
    const setPeerVolume = useVoiceSettingsStore((s) => s.setPeerVolume);
    const setPeerStreamVolume = useVoiceSettingsStore(
      (s) => s.setPeerStreamVolume,
    );
    const focusedPeerVolume = useVoiceSettingsStore((s) => {
      if (!focusedUserId) return 100;
      const peer = s.getSettings().peerSettings[focusedUserId];
      if (!peer) return 100;
      return focusedIsScreen ? peer.streamVolume : peer.volume;
    });

    useEffect(() => {
      let cancelled = false;

      const loadDominantColor = async () => {
        if (!focusedItem?.avatar) return;

        const color = await extractDominantColor(
          getAuthAssetUrl(focusedItem.avatar),
        );
        if (!cancelled) setDominantColor(color);
      };

      void loadDominantColor();

      return () => {
        cancelled = true;
      };
    }, [focusedItem?.avatar]);

    if (focusedId && focusedItem) {
      const isFocusedScreen = focusedItem.type === "screen";
      const isFocusedCamera = focusedItem.type === "camera";
      const isPreviewHidden =
        isFocusedScreen &&
        focusedItem.isLocal &&
        !!voiceActions?.isPreviewHidden;
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
        (isFocusedScreen || isFocusedCamera) &&
        hasLiveAudioTrack(focusedItem.stream);

      return (
        <div
          data-focused-stage="true"
          className="relative flex h-full w-full flex-col items-center justify-center overflow-hidden bg-rm-bg-primary group/stage cursor-pointer transition-shadow pointer-fine:hover:ring-1 pointer-fine:hover:ring-rm-border-strong"
        >
          <StickerReactionsOverlay sfu={voiceActions?.sfu} />
          <button
            type="button"
            data-focused-bg="true"
            className="absolute inset-0 z-0 border-0 p-0 transition-colors duration-200"
            style={{
              backgroundColor:
                isStreaming || focusedThumbnailPoster
                  ? "black"
                  : dominantColor || "var(--rm-bg-primary)",
            }}
            aria-label="Clear focused participant"
            onClick={() => onFocus(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenu({ x: e.clientX, y: e.clientY });
            }}
          />

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
                  : !!currentSettings.peerSettings[focusedItem.userId]?.muted)
              }
              isLocal={focusedItem.isLocal && focusedItem.type === "camera"}
              className="w-full h-full object-contain relative z-10 pointer-events-none"
            />
          ) : focusedThumbnailPoster ? (
            <div
              data-focused-visual="true"
              className="relative z-10 h-full w-full overflow-hidden pointer-events-none"
            >
              <img
                src={focusedThumbnailPoster}
                alt={`${focusedItem.name} stream thumbnail`}
                className="h-full w-full object-contain"
              />
              <div className="absolute inset-0 bg-linear-to-t from-black/35 via-black/10 to-transparent" />
            </div>
          ) : isPreviewHidden ? (
            <div
              data-focused-visual="true"
              className="relative z-10 flex h-full w-full items-center justify-center bg-black/75 pointer-events-none"
            >
              <div className="flex flex-col items-center gap-3 text-center">
                <Icon name="eyeOff" size="xl" className="text-white/60" />
                <span className="text-ui-2xs font-semibold uppercase tracking-[0.08em] text-white/60">
                  Preview paused
                </span>
              </div>
            </div>
          ) : (
            <div
              data-focused-visual="true"
              className="w-full h-full flex items-center justify-center relative overflow-hidden z-10 pointer-events-none"
            >
              <div className="flex flex-col items-center justify-center animate-in fade-in zoom-in-95 duration-300 relative z-10 w-full h-full p-8 md:p-16">
                <div className="relative aspect-video w-full max-w-[600px] md:max-w-[800px] lg:max-w-[1000px] flex items-center justify-center">
                  <div className="w-full h-full shadow-2xl rounded-2xl flex items-center justify-center overflow-hidden bg-rm-bg-elevated/40 transition-ui">
                    {focusedItem.avatar ? (
                      <img
                        src={getAuthAssetUrl(focusedItem.avatar)}
                        alt={focusedItem.name}
                        className="w-full h-full object-contain drop-shadow-2xl"
                      />
                    ) : (
                      <span className="text-8xl md:text-9xl font-bold text-white">
                        {focusedItem.name[0]?.toUpperCase()}
                      </span>
                    )}
                    {isLoadingStream && (
                      <div className="absolute inset-0 z-20 animate-in fade-in duration-300">
                        <StreamLoadingIndicator className="bg-rm-bg-surface/90 border border-rm-border" />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {isFocusedScreen &&
            focusedItem.isLocal &&
            voiceActions?.togglePreviewHidden && (
              <div
                data-preview-toggle="true"
                className="pointer-fine:pointer-events-none absolute top-24 left-4 z-50 pointer-fine:opacity-0 transition-opacity pointer-fine:group-hover/stage:pointer-events-auto pointer-fine:group-hover/stage:opacity-100 group-focus-within/stage:pointer-events-auto group-focus-within/stage:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100 md:left-6"
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
                    "flex items-center gap-1.5 rounded-md bg-black/55 px-2.5 py-1.5 text-ui-2xs font-medium text-white backdrop-blur-md outline-none",
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

          {shouldRenderStreamMenu && renderedContextMenu && (
            <Suspense fallback={null}>
              <StreamContextMenu
                userId={focusedItem.userId}
                x={renderedContextMenu.x}
                y={renderedContextMenu.y}
                isStreaming={focusedItem.type === "screen"}
                onClose={() => setContextMenu(null)}
                isClosing={!contextMenu}
                {...(voiceActions ?? {})}
              />
            </Suspense>
          )}

          {showFocusedVolume && (
            <div className="absolute bottom-6 right-6 z-20 w-full max-w-sm animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="rounded-lg border border-rm-border bg-rm-bg-primary/90 shadow-lg">
                <div className="flex items-center justify-between px-4 pt-3">
                  <div className="flex items-center gap-2 text-rm-text">
                    <Icon
                      name="voiceChannel"
                      size="xs"
                      className="text-rm-text-muted shrink-0"
                    />
                    <span className="text-ui-2xs font-semibold uppercase tracking-[0.08em]">
                      {isFocusedScreen ? "Stream Volume" : "User Volume"}
                    </span>
                  </div>
                  <span className="text-ui-2xs font-bold tabular-nums text-rm-text-muted">
                    {focusedPeerVolume}%
                  </span>
                </div>
                <Slider
                  label={isFocusedScreen ? "Stream Volume" : "User Volume"}
                  value={focusedPeerVolume}
                  onChange={(value) => {
                    if (!focusedUserId) return;
                    if (isFocusedScreen)
                      setPeerStreamVolume(focusedUserId, value);
                    else setPeerVolume(focusedUserId, value);
                  }}
                />
              </div>
            </div>
          )}

          <div className="absolute bottom-6 left-6 z-20 pointer-events-none animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="bg-rm-bg-primary/85 px-3 py-1.5 rounded-md border border-rm-border flex items-center gap-3 shadow-md">
              <div className="flex items-center gap-1.5">
                {focusedItem.isDeafened && (
                  <Icon
                    name="deafen"
                    state="off"
                    size="xs"
                    className="text-rm-text-muted shrink-0"
                  />
                )}
                {focusedItem.isMuted && (
                  <Icon
                    name="mic"
                    state="off"
                    size="xs"
                    className={
                      focusedItem.serverMute
                        ? "text-destructive shrink-0"
                        : "text-rm-text-muted shrink-0"
                    }
                  />
                )}
              </div>

              <p className="text-ui-xs font-semibold text-rm-text">
                {focusedLabel}
              </p>

              {(focusedItem.type === "screen" ||
                focusedItem.type === "camera") && (
                <span className="bg-rm-bg-surface/60 px-1.5 rounded-xs text-ui-2xs font-bold text-rm-text uppercase tracking-tighter border border-rm-border tabular-nums">
                  <QualityMonitor
                    track={focusedItem.stream?.getVideoTracks()[0]}
                    signaledQuality={
                      focusedItem.isLocal && focusedItem.type === "screen"
                        ? voiceActions?.currentScreenQuality
                        : null
                    }
                    sfu={voiceActions?.sfu}
                    userId={focusedItem.userId}
                    type={focusedItem.type === "screen" ? "screen" : "cam"}
                  />
                </span>
              )}
            </div>
          </div>
        </div>
      );
    }

    if (layoutMode === "row") {
      return (
        <div
          className={cn(
            "flex flex-row items-center justify-center gap-2 sm:gap-4 w-full h-full py-2 px-2 overflow-hidden",
            className,
          )}
        >
          {items.map((item) => (
            <div
              key={item.id}
              className="relative flex-1 min-w-0 max-w-[400px] h-full flex items-center justify-center"
            >
              <div className="w-full flex items-center justify-center max-h-full aspect-video">
                <ParticipantCard
                  item={item}
                  isFocused={focusedId === item.id}
                  isTray={false}
                  globalDeafened={globalDeafened}
                  voiceActions={voiceActions}
                  watchedStreams={watchedStreams}
                  streamThumbnails={streamThumbnails}
                  onClick={() =>
                    onFocus(item.id === focusedId ? null : item.id)
                  }
                />
              </div>
            </div>
          ))}
        </div>
      );
    }

    return (
      <div
        className={cn(
          "grid gap-4 w-full h-full place-content-center items-center pt-20 px-6 pb-6 overflow-y-auto no-scrollbar scrollbar-hide",
          items.length === 1
            ? "grid-cols-1 max-w-5xl mx-auto"
            : items.length === 2
              ? "grid-cols-1 md:grid-cols-2"
              : items.length <= 4
                ? "grid-cols-1 sm:grid-cols-2"
                : items.length <= 9
                  ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
                  : items.length <= 16
                    ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
                    : items.length <= 25
                      ? "grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
                      : "grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6",
          className,
        )}
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        {items.map((item) => (
          <ParticipantCard
            key={item.id}
            item={item}
            isFocused={focusedId === item.id}
            isTray={false}
            globalDeafened={globalDeafened}
            voiceActions={voiceActions}
            watchedStreams={watchedStreams}
            streamThumbnails={streamThumbnails}
            onClick={() => onFocus(item.id === focusedId ? null : item.id)}
          />
        ))}
      </div>
    );
  },
);

VoiceGrid.displayName = "VoiceGrid";
