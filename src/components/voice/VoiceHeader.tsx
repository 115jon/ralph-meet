import { IconButton } from "@/components/ui/IconButton";
import type { StreamWatcherIdentity } from "@/lib/stream-watchers";
import { StreamingStatsPanel } from "@/components/voice/StreamingStatsPanel";
import { StreamWatcherList } from "@/components/voice/StreamWatcherList";
import { getAuthAssetUrl } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { Menu, MessageSquare, Volume2 } from "../chat/Icons";
import { QualityMonitor } from "./QualityMonitor";

function getFocusedItemLabel(item: { type?: string; isLocal?: boolean; name?: string } | null | undefined) {
  if (!item?.name) return "";
  if (item.type !== "screen") return item.name;
  if (item.isLocal) return "Your Stream";
  const ownerName = item.name.replace(/'s Stream$/, "");
  return `${ownerName}'s Stream`;
}

interface VoiceHeaderProps {
  channelName: string;
  connectionState: string;
  joined: boolean;
  focusedItem: any;
  focusedWatchers?: StreamWatcherIdentity[];
  currentScreenQuality: string | null | undefined;
  sfu: any;
  showTextChat: boolean;
  onToggleTextChat: () => void;
  onMenuClick?: () => void;
}

const EMPTY_FOCUSED_WATCHERS: StreamWatcherIdentity[] = [];

export function VoiceHeader({
  channelName,
  connectionState,
  joined,
  focusedItem,
  focusedWatchers = EMPTY_FOCUSED_WATCHERS,
  currentScreenQuality,
  sfu,
  showTextChat,
  onToggleTextChat,
  onMenuClick,
}: VoiceHeaderProps) {
  const focusedLabel = getFocusedItemLabel(focusedItem);

  return (
    <div className={cn(
      "absolute top-0 inset-x-0 h-24 flex items-start pt-4 justify-between px-4 md:px-6 z-[100] transition-all duration-300 pointer-events-none",
      focusedItem ? "bg-gradient-to-b from-black/80 via-black/40 to-transparent" : "bg-rm-bg-primary/20 h-16 items-center pt-0"
    )}>
      <div className={cn("flex min-w-0 flex-wrap items-center gap-2 md:gap-4 pointer-events-auto", focusedItem && "drop-shadow-[0_2px_10px_rgba(0,0,0,0.8)]")}>
        {onMenuClick && (
          <IconButton
            icon={Menu}
            size="sm"
            className={cn("md:hidden", focusedItem ? "text-white/70 hover:text-white" : "text-rm-text-muted hover:text-rm-text")}
            onClick={onMenuClick}
          />
        )}
        <div className={cn("flex items-center gap-2", focusedItem ? "text-white/80" : "text-rm-text-muted")}>
          <Volume2 size={18} />
          <span className={cn("text-sm font-bold tracking-tight", focusedItem ? "text-white" : "text-rm-text")}>{channelName}</span>
        </div>
        <div className={cn("h-4 w-px", focusedItem ? "bg-white/20" : "bg-rm-border")} />
        <div className="flex items-center gap-2">
          <StreamingStatsPanel
            connectionState={connectionState}
            joined={joined}
            emphasized={!!focusedItem}
          />
        </div>
        {focusedItem && (
          <>
            <div className={cn("w-px h-4 mx-1", focusedItem ? "bg-white/20" : "bg-rm-border")} />
            <div className={cn(
              "flex min-w-0 items-center gap-2 backdrop-blur-md px-3 py-1.5 rounded-full border",
              focusedItem ? "bg-black/40 border-white/10" : "bg-rm-bg-elevated/40 border-rm-border",
            )}>
              <div className="flex min-w-0 items-center gap-2">
                <div className={cn("w-10 h-10 rounded-full overflow-hidden flex items-center justify-center relative", focusedItem ? "bg-white/10" : "bg-rm-bg-surface")}>
                  {focusedItem.avatar ? (
                    <img
                      src={getAuthAssetUrl(focusedItem.avatar)}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className={cn("text-[10px] font-bold", focusedItem ? "text-white" : "text-rm-text")}>{focusedItem.name[0]}</span>
                  )}
                </div>
                <span className={cn("truncate text-xs font-bold", focusedItem ? "text-white" : "text-rm-text/90")}>{focusedLabel}</span>
              </div>
              {focusedWatchers.length > 0 && (
                <>
                  <div className={cn("h-5 w-px shrink-0", focusedItem ? "bg-white/10" : "bg-rm-border")} />
                  <StreamWatcherList
                    watchers={focusedWatchers}
                    variant="inline"
                    className="max-w-[min(42vw,18rem)]"
                  />
                </>
              )}
            </div>
          </>
        )}
      </div>
      <div className={cn("flex items-center gap-3 pointer-events-auto", focusedItem && "drop-shadow-[0_2px_10px_rgba(0,0,0,0.8)]")}>
        {focusedItem && focusedItem?.isStreaming && (
          <div className="flex items-center gap-1.5 bg-primary/10 backdrop-blur-md px-2.5 py-1 rounded-md border border-primary/20 mr-2 group/hw">
            <span className="text-[10px] font-black text-primary uppercase tracking-tight tabular-nums">
              <QualityMonitor
                track={focusedItem.stream?.getVideoTracks()[0]}
                signaledQuality={focusedItem.isLocal ? currentScreenQuality : null}
                sfu={sfu}
                userId={focusedItem.userId}
                type={focusedItem.type === 'screen' ? 'screen' : 'cam'}
              />
            </span>
            <div className="bg-destructive px-1 rounded-[2px] text-[9px] font-black text-destructive-foreground uppercase animate-pulse">LIVE</div>
          </div>
        )}
        {!showTextChat && (
          <IconButton
            icon={MessageSquare}
            size="sm"
            shape="circle"
            tooltip="Chat"
            className={cn(focusedItem ? "text-white/70 hover:text-white hover:bg-white/10" : "text-rm-text-muted hover:text-rm-text hover:bg-rm-bg-hover")}
            onClick={onToggleTextChat}
          />
        )}
      </div>
    </div>
  );
}
