
import { Slider } from "@/components/ContextMenu/ContextMenuItems";
import { useDelayUnmount } from "@/hooks/useDelayUnmount";
import { useVoiceSettingsStore } from "@/stores/useVoiceSettingsStore";
import { cn } from "@/lib/utils";
import {
  Headphones,
  MicOff,
  Volume2,
} from "lucide-react";

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
  import("../StreamContextMenu").then((mod) => ({ default: mod.StreamContextMenu }))
);

function getFocusedItemLabel(item: GridItem | undefined) {
  if (!item) return "";
  if (item.type !== "screen") return item.name;
  if (item.isLocal) return "Your Stream";
  const ownerName = item.name.replace(/'s Stream$/, "");
  return `${ownerName}'s Stream`;
}

function hasLiveAudioTrack(stream: MediaStream | null | undefined) {
  return stream?.getAudioTracks?.().some((track) => track.readyState === "live") ?? false;
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

export const VoiceGrid = React.memo(({
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
  const focusedItem = items.find(i => i.id === focusedId);
  const focusedUserId = focusedItem?.userId ?? null;
  const focusedIsScreen = focusedItem?.type === 'screen';
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const shouldRenderStreamMenu = useDelayUnmount(!!contextMenu, 150);
  const [dominantColor, setDominantColor] = useState<string | null>(null);
  const setPeerVolume = useVoiceSettingsStore((s) => s.setPeerVolume);
  const setPeerStreamVolume = useVoiceSettingsStore((s) => s.setPeerStreamVolume);
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

      const color = await extractDominantColor(getAuthAssetUrl(focusedItem.avatar));
      if (!cancelled) setDominantColor(color);
    };

    void loadDominantColor();

    return () => {
      cancelled = true;
    };
  }, [focusedItem?.avatar]);

  if (focusedId && focusedItem) {
    const isFocusedScreen = focusedItem.type === 'screen';
    const isFocusedCamera = focusedItem.type === 'camera';
    const isStreaming = (isFocusedCamera || isFocusedScreen) && !!focusedItem.stream;
    const isLoadingStream = (isFocusedCamera || isFocusedScreen) && !focusedItem.stream;
    const focusedLabel = getFocusedItemLabel(focusedItem);
    const showFocusedVolume = !focusedItem.isLocal && (isFocusedScreen || isFocusedCamera) && hasLiveAudioTrack(focusedItem.stream);

    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-rm-bg-primary overflow-hidden relative group/stage cursor-pointer hover:ring-2 hover:ring-rm-text/20 transition-all">
        <StickerReactionsOverlay sfu={voiceActions?.sfu} />
        <button
          type="button"
          data-focused-bg="true"
          className="absolute inset-0 z-0 border-0 p-0 transition-colors duration-500"
          style={{ backgroundColor: isStreaming ? 'black' : (dominantColor || 'var(--rm-bg-primary)') }}
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
            muted={isFocusedScreen || globalDeafened || (focusedItem.isLocal ? true : !!currentSettings.peerSettings[focusedItem.userId]?.muted)}
            isLocal={focusedItem.isLocal && focusedItem.type === 'camera'}
            className="w-full h-full object-contain relative z-10 pointer-events-none"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center relative overflow-hidden z-10">
            <div className="flex flex-col items-center justify-center animate-in fade-in zoom-in-95 duration-700 relative z-10 w-full h-full p-8 md:p-16">
              <div className="relative aspect-video w-full max-w-[600px] md:max-w-[800px] lg:max-w-[1000px] flex items-center justify-center">
                <div className="w-full h-full shadow-[0_30px_100px_rgba(0,0,0,0.6)] rounded-3xl md:rounded-[2.5rem] flex items-center justify-center overflow-hidden bg-black/20 backdrop-blur-3xl transition-all duration-500">
                  {focusedItem.avatar ? (
                    <img
                      src={getAuthAssetUrl(focusedItem.avatar)}
                      alt={focusedItem.name}
                      className="w-full h-full object-contain drop-shadow-2xl"
                    />
                  ) : (
                    <span className="text-8xl md:text-9xl font-black text-white">{focusedItem.name[0]?.toUpperCase()}</span>
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

        {shouldRenderStreamMenu && (
          <Suspense fallback={null}>
            <StreamContextMenu
              userId={focusedItem.userId}
              x={contextMenu?.x ?? 0}
              y={contextMenu?.y ?? 0}
              isStreaming={focusedItem.type === 'screen'}
              onClose={() => setContextMenu(null)}
              isClosing={!contextMenu}
              onToggleScreenShare={voiceActions?.onToggleScreenShare}
              isCurrentUserStreaming={voiceActions?.isCurrentUserStreaming}
              currentScreenQuality={voiceActions?.currentScreenQuality}
              availableQualities={voiceActions?.availableQualities}
              isStreamingAudio={voiceActions?.isStreamingAudio}
              onToggleStreamAudio={voiceActions?.onToggleStreamAudio}
              onChangeSource={voiceActions?.onChangeSource}
              onLeave={voiceActions?.onLeave}
              isMuted={voiceActions?.isMuted}
              onToggleMute={voiceActions?.onToggleMute}
              isDeafened={voiceActions?.isDeafened}
              onToggleDeafen={voiceActions?.onToggleDeafen}
              watchedStreams={voiceActions?.watchedStreams}
              onToggleWatch={voiceActions?.onToggleWatch}
              currentScreenSource={voiceActions?.currentScreenSource}
            />
          </Suspense>
        )}

        {showFocusedVolume && (
          <div className="absolute bottom-6 right-6 z-20 w-full max-w-sm animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="rounded-xl border border-rm-border bg-rm-bg-primary/60 shadow-xl backdrop-blur-md">
              <div className="flex items-center justify-between px-4 pt-3">
                <div className="flex items-center gap-2 text-rm-text">
                  <Volume2 size={13} className="text-rm-text-muted shrink-0" />
                  <span className="text-[11px] font-bold uppercase tracking-wide">
                    {isFocusedScreen ? 'Stream Volume' : 'User Volume'}
                  </span>
                </div>
                <span className="text-[11px] font-bold tabular-nums text-rm-text-muted">
                  {focusedPeerVolume}%
                </span>
              </div>
              <Slider
                label={isFocusedScreen ? 'Stream Volume' : 'User Volume'}
                value={focusedPeerVolume}
                onChange={(value) => {
                  if (!focusedUserId) return;
                  if (isFocusedScreen) setPeerStreamVolume(focusedUserId, value);
                  else setPeerVolume(focusedUserId, value);
                }}
              />
            </div>
          </div>
        )}

        <div className="absolute bottom-6 left-6 z-20 pointer-events-none animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="bg-rm-bg-primary/60 backdrop-blur-md px-3 py-1.5 rounded-lg border border-rm-border flex items-center gap-3 shadow-xl">
            <div className="flex items-center gap-1.5">
              {focusedItem.isDeafened && (
                <Headphones size={12} className="text-rm-text-muted shrink-0" />
              )}
              {focusedItem.isMuted && (
                <MicOff size={12} className={focusedItem.serverMute ? "text-destructive shrink-0" : "text-rm-text-muted shrink-0"} />
              )}
            </div>

            <p className="text-xs font-bold text-rm-text">{focusedLabel}</p>

            {(focusedItem.type === 'screen' || focusedItem.type === 'camera') && (
              <span className="bg-rm-bg-surface/60 px-1.5 rounded-[3px] text-[8px] font-black text-rm-text uppercase tracking-tighter border border-rm-border tabular-nums">
                <QualityMonitor
                  track={focusedItem.stream?.getVideoTracks()[0]}
                  signaledQuality={focusedItem.isLocal && focusedItem.type === 'screen' ? voiceActions?.currentScreenQuality : null}
                  sfu={voiceActions?.sfu}
                  userId={focusedItem.userId}
                  type={focusedItem.type === 'screen' ? 'screen' : 'cam'}
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
      <div className={cn(
        "flex flex-row items-center justify-center gap-2 sm:gap-4 w-full h-full py-2 px-2 overflow-hidden",
        className
      )}>
        {items.map((item) => (
          <div key={item.id} className="relative flex-1 min-w-0 max-w-[400px] h-full flex items-center justify-center">
            <div className="w-full flex items-center justify-center max-h-full aspect-video">
              <ParticipantCard
                item={item}
                isFocused={focusedId === item.id}
                isTray={false}
                globalDeafened={globalDeafened}
                voiceActions={voiceActions}
                watchedStreams={watchedStreams}
                streamThumbnails={streamThumbnails}
                onClick={() => onFocus(item.id === focusedId ? null : item.id)}
              />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={cn(
      "grid gap-4 w-full h-full place-content-center items-center pt-20 px-6 pb-6 overflow-y-auto no-scrollbar scrollbar-hide",
      items.length === 1 ? "grid-cols-1 max-w-5xl mx-auto" :
        items.length === 2 ? "grid-cols-1 md:grid-cols-2" :
          items.length <= 4 ? "grid-cols-1 sm:grid-cols-2" :
            items.length <= 9 ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" :
              items.length <= 16 ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" :
                items.length <= 25 ? "grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" :
                  "grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6",
      className
    )} style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
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
});

VoiceGrid.displayName = 'VoiceGrid';
