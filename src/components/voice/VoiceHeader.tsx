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
      "absolute top-0 inset-x-0 h-16 flex items-center justify-between px-4 md:px-6 z-[100] transition-all duration-300 pointer-events-none",
      focusedItem ? "bg-gradient-to-b from-rm-bg-primary/80 to-transparent" : "bg-rm-bg-primary/20"
    )}>
      <div className="flex items-center gap-2 md:gap-4 pointer-events-auto">
        {onMenuClick && (
          <button
            className="cursor-pointer border-none bg-transparent p-1 text-rm-text-muted transition-colors hover:text-rm-text md:hidden"
            onClick={onMenuClick}
          >
            <Menu className="h-5 w-5" />
          </button>
        )}
        <div className="flex items-center gap-2 text-rm-text-muted">
          <Volume2 size={18} />
          <span className="text-sm font-bold text-rm-text tracking-tight">{channelName}</span>
        </div>
        <div className="h-4 w-px bg-rm-border" />
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-black text-rm-text-muted/40 uppercase tracking-widest">
            {connectionState === "connected" ? "Stable" :
              connectionState === "connecting" ? "Connecting" :
                joined ? "Stable" :
                  connectionState === "new" ? "Connecting…" :
                    connectionState === "failed" ? "Failed" : connectionState}
          </span>
        </div>
        {focusedItem && (
          <>
            <div className="w-px h-4 bg-rm-border mx-1" />
            <div className="flex items-center gap-2 bg-rm-bg-elevated/40 backdrop-blur-md px-3 py-1.5 rounded-full border border-rm-border">
              <div className="w-10 h-10 rounded-full overflow-hidden flex items-center justify-center bg-rm-bg-surface relative">
                {focusedItem.avatar ? (
                  <img
                    src={focusedItem.avatar}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-[10px] font-bold text-rm-text">{focusedItem.name[0]}</span>
                )}
              </div>
              <span className="text-xs font-bold text-rm-text/90">{focusedItem.name}{focusedItem.isStreaming ? "'s Screen" : ""}</span>
            </div>
          </>
        )}
      </div>
      <div className="flex items-center gap-3 pointer-events-auto">
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
          <button title="Chat" className="p-2 text-rm-text-muted hover:text-rm-text hover:bg-rm-bg-hover rounded-full transition-all outline-none" onClick={onToggleTextChat}>
            <MessageSquare size={18} />
          </button>
        )}
      </div>
    </div>
  );
}
