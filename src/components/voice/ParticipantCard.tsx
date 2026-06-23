
import { IconButton } from "@/components/ui/IconButton";
import { extractDominantColor } from "@/lib/color-utils";
import { getAuthAssetUrl } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { Eye, EyeOff, Phone } from "lucide-react";
import React, { lazy, Suspense, useEffect, useState } from "react";
import { useDelayUnmount } from "@/hooks/useDelayUnmount";
import {
  Camera,
  ChevronDown,
  Headphones,
  MicOff,
  Monitor,
  MoreHorizontal
} from "../chat/Icons";
import { QualityMonitor } from "./QualityMonitor";
import { StreamLoadingIndicator } from "./StreamLoadingIndicator";
import { GridItem, VoiceActions } from "./types";
import { VideoPlayer } from "./VideoPlayer";
import { StickerReactionsOverlay } from "./StickerReactionsOverlay";


const StreamContextMenu = lazy(() =>
  import("../StreamContextMenu").then((mod) => ({ default: mod.StreamContextMenu }))
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
  globalDeafened,
  onClick,
  voiceActions,
  watchedStreams,
  streamThumbnails,
  suppressVideo = false,
}) => {
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number; isMini?: boolean } | null>(null);
  const shouldRenderStreamMenu = useDelayUnmount(!!contextMenu, 150);
  const [dominantColor, setDominantColor] = useState<string | null>(null);

  useEffect(() => {
    if (item.avatar) {
      extractDominantColor(getAuthAssetUrl(item.avatar)).then((color: string | null) => {
        if (color) setDominantColor(color);
      });
    } else {
      setDominantColor(null);
    }
  }, [item.avatar]);

  const isScreen = item.type === 'screen';
  const isCamera = item.type === 'camera';
  const isPreviewHidden = isScreen && item.isLocal && !!voiceActions?.isPreviewHidden;
  // When preview is hidden the stream is null; we still want to show video for other cases.
  const shouldRenderVideo = !!item.stream && !suppressVideo && !isPreviewHidden;
  const isLoadingStream = (isCamera || isScreen) && !item.stream && !(isScreen && !item.isLocal && !watchedStreams[item.userId]) && !isPreviewHidden;

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick();
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          setContextMenu({ x: e.clientX, y: e.clientY, isMini: false });
        }}
        className={cn(
          "relative group rounded-2xl overflow-hidden bg-rm-bg-surface/40 backdrop-blur-xl transition-all duration-300 cursor-pointer aspect-video w-full h-full",
          isFocused && "ring-2 ring-rm-text/20 z-50",
          item.isSpeaking && "ring-[3px] ring-primary shadow-[0_0_20px_var(--rm-glow)] z-20",
          item.isRinging && "ring-[3px] ring-primary/50 shadow-[0_0_20px_var(--rm-glow)] animate-pulse z-20",
          !isFocused && !item.isSpeaking && !item.isRinging && "ring-1 ring-rm-border hover:ring-rm-text/20",
        )}
      >
        <StickerReactionsOverlay sfu={voiceActions?.sfu} senderUserId={item.userId} />

        {/* Selected Overlay */}
        {isFocused && (
          <div className="absolute inset-0 z-10 bg-black/40 shadow-[inset_0_0_100px_rgba(0,0,0,0.8)] pointer-events-none animate-in fade-in duration-300" />
        )}

        {/* Background Effect */}
        {item.avatar && (
          <div
            className="absolute inset-0 z-0 transition-colors duration-500"
            style={{ backgroundColor: ((isCamera || isScreen) && shouldRenderVideo) ? 'black' : (dominantColor || undefined) }}
          />
        )}

        {/* Video Layer */}
        {shouldRenderVideo && (
          <div className={cn(
            "absolute inset-0 z-10 transition-opacity duration-500",
            !(isCamera || isScreen) && "opacity-0 pointer-events-none"
          )}>
            <VideoPlayer
              stream={item.stream}
              label={item.name}
              muted={true} // Audio is handled by SFUClient AudioContext
              isLocal={item.isLocal && item.type === 'camera'}
              className={cn(
                "w-full h-full transition-all duration-500",
                isScreen ? "object-contain" : "object-cover",
                (isScreen && !item.isLocal && !watchedStreams[item.userId]) && "opacity-0"
              )}
            />
            {/* Dark gradient for labels */}
            <div className="absolute inset-0 bg-linear-to-t from-black/20 via-transparent to-transparent opacity-100 group-hover:opacity-40 transition-opacity" />
          </div>
        )}

        {/* Preview Paused Placeholder (local screen share hidden for performance) */}
        {isPreviewHidden && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/70 backdrop-blur-sm gap-2">
            <EyeOff size={22} className="text-white/50" />
            <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Preview paused</span>
          </div>
        )}

        {/* Loading State */}
        {isLoadingStream && <StreamLoadingIndicator />}

        {/* Watch Stream Prompt / Thumbnail Overlay */}
        {isScreen && !item.isLocal && !watchedStreams[item.userId] && (
          <div className="absolute inset-0 z-40 bg-rm-bg-primary flex flex-col items-center justify-center p-2 text-center overflow-hidden">
            {streamThumbnails[item.userId] && (
              <img
                src={streamThumbnails[item.userId]}
                className="absolute inset-0 w-full h-full object-cover blur-sm opacity-60 scale-105 pointer-events-none"
                alt="Stream Preview"
              />
            )}
            <div className="relative z-10 flex flex-col items-center justify-center p-1 sm:p-2 w-full h-full overflow-hidden">
              <div className="shrink border border-rm-border rounded-xl bg-rm-bg-elevated/60 p-2 sm:w-8 sm:h-8 text-rm-text-muted shadow-lg backdrop-blur-md flex items-center justify-center group-hover:scale-110 transition-transform duration-500">
                <Monitor className="w-3 h-3 sm:w-4 sm:h-4 text-rm-text-muted shrink-0" strokeWidth={2} />
              </div>

              <div className="shrink min-h-0 flex flex-col items-center justify-center mt-1 sm:mt-2">
                <h3 className="text-[9px] sm:text-[11px] font-bold text-rm-text tracking-tight truncate w-full text-center px-1">
                  {item.name.replace(/'s Stream$/, '')}'s Stream
                </h3>
              </div>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  voiceActions?.onToggleWatch?.(item.userId);
                }}
                className="shrink-0 mt-1 sm:mt-2 px-2 py-1 sm:px-3 sm:py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-[8px] text-[9px] sm:text-[10px] font-black uppercase tracking-wider transition-all shadow-xl shadow-primary/20 active:scale-95 hover:shadow-[0_0_20px_var(--rm-glow)] max-w-full truncate"
              >
                Watch Stream
              </button>
            </div>
          </div>
        )}

        {/* Full-size Avatar (Only if not showing video, prompt, or paused-preview placeholder) */}
        {!((isCamera || isScreen) && shouldRenderVideo) && !(isScreen && !item.isLocal && !watchedStreams[item.userId]) && !isPreviewHidden && (
          <div className="absolute inset-0 z-30 flex items-center justify-center p-4">
            {item.avatar ? (
              <img
                src={getAuthAssetUrl(item.avatar)}
                alt={item.name}
                className="w-20 h-20 sm:w-28 sm:h-28 object-cover rounded-full drop-shadow-2xl border-4 border-black/20"
              />
            ) : (
              <div className="w-20 h-20 sm:w-28 sm:h-28 flex items-center justify-center bg-black/40 rounded-full border-4 border-black/20 drop-shadow-2xl">
                <span className="text-3xl sm:text-5xl font-black text-white">{item.name[0]?.toUpperCase()}</span>
              </div>
            )}

            {/* Type Overlay Icon */}
            {isTray && isFocused && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/70 animate-in fade-in duration-300">
                {isScreen ? (
                  <Monitor size={32} className="text-white" fill="currentColor" />
                ) : isCamera ? (
                  <Camera size={32} className="text-white" fill="currentColor" />
                ) : (
                  <Phone size={32} className="text-white" fill="currentColor" />
                )}
              </div>
            )}
          </div>
        )}

        {/* Ringing Overlay Label */}
        {item.isRinging && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/40 pointer-events-none">
            <span className="bg-rm-bg-surface/80 backdrop-blur rounded-full px-3 py-1 text-xs font-bold text-rm-text animate-pulse shadow-xl">
              Calling...
            </span>
          </div>
        )}

        {/* Status Indicators & Labels */}
        <div className="absolute bottom-2 left-2 z-30 flex items-center gap-2">
          <div className="bg-rm-bg-primary/60 backdrop-blur-md px-2.5 py-1 rounded-lg border border-rm-border flex items-center gap-2 shadow-lg">
            <div className="flex items-center gap-1">
              {item.isDeafened && (
                <Headphones size={10} className="text-rm-text-muted shrink-0" />
              )}
              {item.isMuted && (
                <MicOff size={10} className={item.serverMute ? "text-destructive shrink-0" : "text-rm-text-muted shrink-0"} />
              )}
            </div>

            {isScreen && <Monitor size={10} className="text-primary shrink-0" />}
            <span className="text-[10px] font-bold text-rm-text truncate max-w-[100px]">
              {item.isLocal ? 'You' : item.name}
            </span>
            {(isScreen || isCamera) && (
              <span className="bg-rm-bg-surface/60 px-1.5 rounded-[3px] text-[8px] font-black text-rm-text uppercase tracking-tighter border border-rm-border tabular-nums">
                <QualityMonitor
                  track={item.stream?.getVideoTracks()[0]}
                  signaledQuality={item.isLocal && isScreen ? voiceActions?.currentScreenQuality : null}
                  sfu={voiceActions?.sfu}
                  userId={item.userId}
                  type={isScreen ? 'screen' : 'cam'}
                />
              </span>
            )}
            {isScreen && (
              <span className="bg-destructive text-destructive-foreground px-1 rounded-[2px] text-[7px] font-black uppercase tracking-tighter animate-pulse">LIVE</span>
            )}
          </div>
        </div>

        {/* Hide/Show Preview toggle — only on local screen tile */}
        {isScreen && item.isLocal && voiceActions?.togglePreviewHidden && (
          <div className="absolute top-2 left-2 z-40 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={(e) => {
                e.stopPropagation();
                voiceActions.togglePreviewHidden?.();
              }}
              title={isPreviewHidden ? "Resume preview" : "Pause preview (saves resources)"}
              className="flex items-center gap-1.5 bg-rm-bg-primary/70 backdrop-blur-md border border-rm-border px-2 py-1 rounded-lg text-[9px] font-bold text-rm-text-muted hover:text-rm-text transition-all shadow-lg"
            >
              {isPreviewHidden
                ? <><Eye size={11} /> <span>Resume</span></>
                : <><EyeOff size={11} /> <span>Pause</span></>}
            </button>
          </div>
        )}

        {/* Right status (Ellipsis Bottom Right) */}
        {!isTray && (
          <div className="absolute bottom-2 right-2 z-40 opacity-0 group-hover:opacity-100 transition-opacity">
            <IconButton
              icon={MoreHorizontal}
              size="xs"
              className="bg-rm-bg-primary/60 backdrop-blur-md border border-rm-border shadow-xl hover:scale-110 active:scale-95"
              onClick={(e) => {
                e.stopPropagation();
                setContextMenu({ x: e.clientX, y: e.clientY, isMini: true });
              }}
            />
          </div>
        )}
        {isTray && (
          <div className="absolute top-2 right-2 z-30 opacity-0 group-hover:opacity-100 transition-opacity">
            <div className="bg-rm-bg-primary/60 backdrop-blur-md p-1 rounded-lg border border-rm-border">
              <ChevronDown size={10} className="text-rm-text-muted" />
            </div>
          </div>
        )}

        {/* Hover Overlay */}
        <div className="absolute inset-0 bg-black opacity-0 group-hover:opacity-10 transition-opacity pointer-events-none" />
      </div>

      {shouldRenderStreamMenu && (
        <Suspense fallback={null}>
          <StreamContextMenu
            x={contextMenu?.x ?? 0}
            y={contextMenu?.y ?? 0}
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
