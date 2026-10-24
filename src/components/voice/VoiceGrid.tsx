import { Slider } from "@/components/ContextMenu/ContextMenuItems";
import { useVoiceSettingsStore } from "@/stores/useVoiceSettingsStore";
import { cn } from "@/lib/utils";
import { HIT, PRESS } from "@/components/ui/interaction";
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
import { gridColumnsClass } from "./grid-columns";

const StreamContextMenu = lazy(() =>
  import("../StreamContextMenu").then((mod) => ({
    default: mod.StreamContextMenu,
  })),
);

function getFocusedItemLabel(item: GridItem | undefined) {
  if (!item) return "";
  if (item.type !== "screen") return item.name;
  if (item.isLocal) return "Your stream";
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
          className="group/stage relative isolate flex h-full w-full flex-col items-center justify-center overflow-hidden bg-rm-bg-primary"
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
              <div className="relative z-10 flex h-full w-full flex-col items-center justify-center p-4 animate-in fade-in zoom-in-[0.97] duration-200 md:p-16">
                <div className="relative flex aspect-video w-full max-w-[1000px] items-center justify-center">
                  <div className="flex h-full w-full items-center justify-center overflow-hidden rounded-xl bg-rm-bg-surface ring-1 ring-rm-border">
                    {focusedItem.avatar ? (
                      <img
                        src={getAuthAssetUrl(focusedItem.avatar)}
                        alt={focusedItem.name}
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      <span className="flex size-24 items-center justify-center rounded-full bg-rm-tint-2 text-ui-2xl font-semibold text-rm-text md:size-32">
                        {focusedItem.name[0]?.toUpperCase()}
                      </span>
                    )}
                    {isLoadingStream && (
                      <div className="absolute inset-0 z-10 animate-in fade-in duration-200">
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
                className="pointer-fine:pointer-events-none absolute top-16 left-4 z-10 pointer-fine:opacity-0 transition-opacity pointer-fine:group-hover/stage:pointer-events-auto pointer-fine:group-hover/stage:opacity-100 group-focus-within/stage:pointer-events-auto group-focus-within/stage:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100 md:left-6"
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
                    "flex items-center gap-1.5 rounded-md bg-black/60 px-2.5 py-1.5 text-ui-2xs font-medium text-white outline-none",
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

          {/* Bottom of the stage: the name chip over the volume card on a
              phone, side by side above md, both inside the stage (VC-16). */}
          <div className="pointer-events-none absolute inset-x-4 bottom-4 z-10 flex flex-col items-start gap-2 md:flex-row md:items-end md:justify-between">
            <div className="flex max-w-full items-center gap-1.5 rounded-sm bg-black/60 px-1.5 py-0.5 text-white animate-in fade-in duration-200">
              {focusedItem.isDeafened && (
                <Icon
                  name="deafen"
                  state="off"
                  size="xs"
                  label="Deafened"
                  className="shrink-0 text-white/80"
                />
              )}
              {focusedItem.isMuted &&
                (focusedItem.serverMute ? (
                  <span className="flex shrink-0 items-center justify-center rounded-xs bg-rm-danger p-0.5 text-rm-on-danger">
                    <Icon
                      name="mic"
                      state="off"
                      size="xs"
                      label="Server muted"
                    />
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
              <p className="truncate text-ui-xs font-medium">{focusedLabel}</p>
              {(focusedItem.type === "screen" ||
                focusedItem.type === "camera") && (
                <span className="shrink-0 rounded-xs bg-white/15 px-1 text-ui-2xs font-semibold tabular-nums">
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

            {showFocusedVolume && (
              <div className="pointer-events-auto w-full rounded-lg border border-rm-border bg-rm-bg-surface shadow-lg animate-in fade-in duration-200 md:w-[360px] dark:bg-rm-bg-elevated">
                <div className="flex items-center justify-between px-4 pt-3">
                  <div className="flex items-center gap-2 text-rm-text">
                    <Icon
                      name="voiceChannel"
                      size="sm"
                      className="shrink-0 text-rm-text-muted"
                    />
                    <span className="text-ui-xs font-medium">
                      {isFocusedScreen ? "Stream volume" : "User volume"}
                    </span>
                  </div>
                  <span className="text-ui-xs font-medium tabular-nums text-rm-text-muted">
                    {focusedPeerVolume}%
                  </span>
                </div>
                <Slider
                  label={isFocusedScreen ? "Stream volume" : "User volume"}
                  value={focusedPeerVolume}
                  onChange={(value) => {
                    if (!focusedUserId) return;
                    if (isFocusedScreen)
                      setPeerStreamVolume(focusedUserId, value);
                    else setPeerVolume(focusedUserId, value);
                  }}
                />
              </div>
            )}
          </div>
        </div>
      );
    }

    if (layoutMode === "row") {
      return (
        <div
          className={cn(
            "flex flex-row items-center justify-center gap-2 md:gap-4 w-full h-full py-2 px-2 overflow-hidden",
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
      <div className="@container h-full min-h-0 w-full">
        <div
          data-voice-grid
          className={cn(
            // `safe center` centres a short grid but starts at the top once it
            // overflows, so the first tiles stay reachable (VC-21).
            "grid h-full w-full auto-rows-max place-content-[safe_center] items-center gap-2 overflow-y-auto overscroll-contain p-4 md:gap-3 md:p-6",
            gridColumnsClass(items.length),
            className,
          )}
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
      </div>
    );
  },
);

VoiceGrid.displayName = "VoiceGrid";
