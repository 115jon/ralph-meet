
import { cn } from "@/lib/utils";
import {
  Headphones,
  MicOff
} from "lucide-react";

import React, { useState } from "react";
import { StreamContextMenu } from "../StreamContextMenu";
import { ParticipantCard } from "./ParticipantCard";
import { QualityMonitor } from "./QualityMonitor";
import { GridItem, VoiceActions } from "./types";
import { VideoPlayer } from "./VideoPlayer";

interface VoiceGridProps {
  items: GridItem[];
  focusedId: string | null;
  onFocus: (id: string | null) => void;
  globalDeafened: boolean;
  currentSettings: any;
  voiceActions?: VoiceActions;
  watchedStreams: Record<string, boolean>;
  streamThumbnails: Record<string, string>;
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
}: VoiceGridProps) => {
  const focusedItem = items.find(i => i.id === focusedId);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  if (focusedId && focusedItem) {
    return (
      <div
        onContextMenu={(e) => {
          e.preventDefault();
          setContextMenu({ x: e.clientX, y: e.clientY });
        }}
        className="w-full h-full flex flex-col items-center justify-center bg-rm-bg-primary overflow-hidden relative group/stage"
      >
        {focusedItem.stream ? (
          <VideoPlayer
            stream={focusedItem.stream}
            label={focusedItem.name}
            muted={globalDeafened || (focusedItem.isLocal ? true : !!currentSettings.peerSettings[focusedItem.userId]?.muted)}
            isLocal={focusedItem.isLocal && focusedItem.type === 'camera'}
            className="w-full h-full object-contain"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center relative overflow-hidden">
            {/* Stage Glassmorphism Background */}
            {focusedItem.avatar && (
              <div className="absolute inset-0 z-0">
                <img
                  src={focusedItem.avatar}
                  alt=""
                  className="w-full h-full object-cover blur-[80px] opacity-40 scale-125 select-none pointer-events-none"
                />
              </div>
            )}

            <div className="flex flex-col items-center justify-center animate-in fade-in zoom-in-95 duration-700 relative z-10 w-full h-full">
              <div className="relative w-full h-full flex items-center justify-center">
                <div className="h-full shadow-[0_0_100px_rgba(0,0,0,0.3)] flex items-center justify-center overflow-hidden bg-rm-bg-elevated backdrop-blur-2xl transition-all duration-500">
                  {focusedItem.avatar ? (
                    <img
                      src={focusedItem.avatar}
                      alt={focusedItem.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="text-8xl font-black text-rm-text">{focusedItem.name[0]?.toUpperCase()}</span>
                  )}
                </div>
                {focusedItem.isMuted && (
                  <div className="absolute -bottom-1 -right-1 p-2 bg-rm-bg-primary rounded-md border border-rm-border shadow-lg backdrop-blur-sm">
                    <MicOff size={16} className={focusedItem.serverMute ? "text-destructive" : "text-rm-text-muted"} />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {contextMenu && (
          <StreamContextMenu
            userId={focusedItem.userId}
            x={contextMenu.x}
            y={contextMenu.y}
            isStreaming={focusedItem.type === 'screen'}
            onClose={() => setContextMenu(null)}
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
          />
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

            <p className="text-xs font-bold text-rm-text">
              {focusedItem.isStreaming ? `${focusedItem.name}'s Screen` : focusedItem.name}
            </p>

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

  return (
    <div className={cn(
      "grid gap-4 w-full h-full content-start pt-20 px-6 pb-6 overflow-y-auto no-scrollbar scrollbar-hide",
      items.length === 1 ? "grid-cols-1 max-w-5xl mx-auto" :
        items.length === 2 ? "grid-cols-1 md:grid-cols-2" :
          items.length <= 4 ? "grid-cols-1 sm:grid-cols-2" :
            items.length <= 9 ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" :
              items.length <= 16 ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" :
                items.length <= 25 ? "grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" :
                  "grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6"
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
