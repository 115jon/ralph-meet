
import { cn } from "@/lib/utils";

import React, { useState } from "react";
import {
  Camera,
  ChevronDown,
  Headphones,
  MicOff,
  Monitor,
  MoreHorizontal
} from "../chat/Icons";
import { StreamContextMenu } from "../StreamContextMenu";
import { QualityMonitor } from "./QualityMonitor";
import { GridItem, VoiceActions } from "./types";
import { VideoPlayer } from "./VideoPlayer";

interface ParticipantCardProps {
  item: GridItem;
  isFocused: boolean;
  isTray: boolean;
  globalDeafened: boolean;
  onClick: () => void;
  voiceActions?: VoiceActions;
  watchedStreams: Record<string, boolean>;
  streamThumbnails: Record<string, string>;
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
}) => {
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number; isMini?: boolean } | null>(null);

  const isScreen = item.type === 'screen';
  const isCamera = item.type === 'camera';

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
          !isFocused && !item.isSpeaking && "ring-1 ring-rm-border hover:ring-rm-text/20",
        )}
      >
        {/* Selected Overlay */}
        {isFocused && (
          <div className="absolute inset-0 z-10 bg-black/40 shadow-[inset_0_0_100px_rgba(0,0,0,0.8)] pointer-events-none animate-in fade-in duration-300" />
        )}

        {/* Blurred Background Effect */}
        {item.avatar && (
          <div className="absolute inset-0 z-0 overflow-hidden">
            <img
              src={item.avatar}
              alt=""
              className="w-full h-full object-cover blur-3xl opacity-20 scale-150 select-none pointer-events-none"
            />
          </div>
        )}

        {/* Video Layer */}
        {item.stream && (
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
            <div className="absolute inset-0 bg-gradient-to-t from-black/20 via-transparent to-transparent opacity-100 group-hover:opacity-40 transition-opacity" />
          </div>
        )}

        {/* Watch Stream Prompt / Thumbnail Overlay */}
        {isScreen && !item.isLocal && !watchedStreams[item.userId] && (
          <div className="absolute inset-0 z-40 bg-rm-bg-primary flex flex-col items-center justify-center p-6 text-center gap-4 overflow-hidden">
            {streamThumbnails[item.userId] && (
              <img
                src={streamThumbnails[item.userId]}
                className="absolute inset-0 w-full h-full object-cover blur-sm opacity-20 scale-105 pointer-events-none"
                alt="Stream Preview"
              />
            )}
            <div className="relative z-10 flex flex-col items-center gap-4 animate-in fade-in zoom-in-95 duration-500">
              <div className="w-16 h-16 rounded-3xl bg-rm-bg-elevated/40 flex items-center justify-center text-rm-text-muted shadow-2xl backdrop-blur-md border border-rm-border group-hover:scale-110 transition-transform duration-500">
                <Monitor size={32} strokeWidth={1.5} />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-rm-text tracking-tight">{item.name} is streaming</h3>
                <p className="text-[11px] text-rm-text-muted leading-relaxed max-w-[180px]">Watch to see their screen and hear their stream audio.</p>
              </div>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                voiceActions?.onToggleWatch?.(item.userId);
              }}
              className="px-6 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl text-[11px] font-black uppercase tracking-wider transition-all shadow-xl shadow-primary/20 active:scale-95 hover:shadow-[0_0_20px_var(--rm-glow)]"
            >
              Watch Stream
            </button>
          </div>
        )}

        {/* Center Avatar (Only if not showing video and not showing stream prompt) */}
        {!((isCamera || isScreen) && item.stream) && !(isScreen && !item.isLocal && !watchedStreams[item.userId]) && (
          <div className="absolute inset-0 flex items-center justify-center z-30">
            <div className="h-full aspect-square overflow-hidden shadow-2xl bg-rm-bg-elevated flex items-center justify-center shrink-0 transition-transform duration-500 relative">
              {item.avatar ? (
                <img
                  src={item.avatar}
                  alt={item.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="text-4xl font-black text-rm-text">{item.name[0]?.toUpperCase()}</span>
              )}

              {/* Type Overlay Icon */}
              {isTray && isFocused && (
                <div className="absolute inset-0 flex items-center justify-center bg-rm-bg-primary/30 animate-in fade-in duration-300">
                  {isScreen ? (
                    <Monitor size={32} className="text-rm-text" fill="currentColor" />
                  ) : (
                    <Camera size={32} className="text-rm-text" fill="currentColor" />
                  )}
                </div>
              )}
            </div>
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

        {/* Right status (Ellipsis Bottom Right) */}
        {!isTray && (
          <div className="absolute bottom-2 right-2 z-40 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setContextMenu({ x: e.clientX, y: e.clientY, isMini: true });
              }}
              className="bg-rm-bg-primary/60 backdrop-blur-md p-1.5 rounded-lg border border-rm-border hover:bg-rm-bg-hover transition-all text-rm-text-muted hover:text-rm-text shadow-xl hover:scale-110 active:scale-95 outline-none"
            >
              <MoreHorizontal size={16} />
            </button>
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

      {contextMenu && (
        <StreamContextMenu
          {...contextMenu}
          userId={item.userId}
          isStreaming={isScreen}
          onClose={() => setContextMenu(null)}
          {...voiceActions}
          watchedStreams={watchedStreams}
        />
      )}
    </>
  );
};
