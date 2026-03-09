import { getAuthAssetUrl } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { Menu, MessageSquare, Volume2 } from "../chat/Icons";
import { QualityMonitor } from "./QualityMonitor";

interface VoiceHeaderProps {
  channelName: string;
  connectionState: string;
  joined: boolean;
  focusedItem: any;
  currentScreenQuality: string | null | undefined;
  sfu: any;
  showTextChat: boolean;
  onToggleTextChat: () => void;
  onMenuClick?: () => void;
}

export function VoiceHeader({
  channelName,
  connectionState,
  joined,
  focusedItem,
  currentScreenQuality,
  sfu,
  showTextChat,
  onToggleTextChat,
  onMenuClick,
}: VoiceHeaderProps) {
  return (
    <div className={cn(
      "absolute top-0 inset-x-0 h-24 flex items-start pt-4 justify-between px-4 md:px-6 z-[100] transition-all duration-300 pointer-events-none",
      focusedItem ? "bg-gradient-to-b from-black/80 via-black/40 to-transparent" : "bg-rm-bg-primary/20 h-16 items-center pt-0"
    )}>
      <div className={cn("flex items-center gap-2 md:gap-4 pointer-events-auto", focusedItem && "drop-shadow-[0_2px_10px_rgba(0,0,0,0.8)]")}>
        {onMenuClick && (
          <button
            className={cn("cursor-pointer border-none bg-transparent p-1 transition-colors md:hidden", focusedItem ? "text-white/70 hover:text-white" : "text-rm-text-muted hover:text-rm-text")}
            onClick={onMenuClick}
          >
            <Menu className="h-5 w-5" />
          </button>
        )}
        <div className={cn("flex items-center gap-2", focusedItem ? "text-white/80" : "text-rm-text-muted")}>
          <Volume2 size={18} />
          <span className={cn("text-sm font-bold tracking-tight", focusedItem ? "text-white" : "text-rm-text")}>{channelName}</span>
        </div>
        <div className={cn("h-4 w-px", focusedItem ? "bg-white/20" : "bg-rm-border")} />
        <div className="flex items-center gap-2">
          <span className={cn("text-[10px] font-black uppercase tracking-widest", focusedItem ? "text-white/60" : "text-rm-text-muted/40")}>
            {connectionState === "connected" ? "Stable" :
              connectionState === "connecting" ? "Connecting" :
                joined ? "Stable" :
                  connectionState === "new" ? "Connecting…" :
                    connectionState === "failed" ? "Failed" : connectionState}
          </span>
        </div>
        {focusedItem && (
          <>
            <div className={cn("w-px h-4 mx-1", focusedItem ? "bg-white/20" : "bg-rm-border")} />
            <div className={cn("flex items-center gap-2 backdrop-blur-md px-3 py-1.5 rounded-full border", focusedItem ? "bg-black/40 border-white/10" : "bg-rm-bg-elevated/40 border-rm-border")}>
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
              <span className={cn("text-xs font-bold", focusedItem ? "text-white" : "text-rm-text/90")}>{focusedItem.name}{focusedItem.isStreaming ? "'s Screen" : ""}</span>
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
          <button title="Chat" className={cn("p-2 rounded-full transition-all outline-none", focusedItem ? "text-white/70 hover:text-white hover:bg-white/10" : "text-rm-text-muted hover:text-rm-text hover:bg-rm-bg-hover")} onClick={onToggleTextChat}>
            <MessageSquare size={18} />
          </button>
        )}
      </div>
    </div>
  );
}
