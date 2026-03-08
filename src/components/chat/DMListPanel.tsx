import { getAuthAssetUrl } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { MessageSquare } from "./Icons";

interface DMListPanelProps {
  dmChannels: any[];
  activeChannelId: string | null;
  onSelectDm: (channelId: string) => void;
  isUnread: (channelId: string, readStates: Record<string, string>, lastMessageAt: Record<string, string>) => boolean;
  state: any;
  handleDmContextMenu: (e: React.MouseEvent, dm: any) => void;
  dispatch: React.Dispatch<any>;
}

export function DMListPanel({
  dmChannels,
  activeChannelId,
  onSelectDm,
  isUnread,
  state,
  handleDmContextMenu,
  dispatch,
}: DMListPanelProps) {
  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar">
      <div className="space-y-0.5 p-2">
        {dmChannels.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <MessageSquare className="h-6 w-6 text-rm-text-muted/40" />
            <span className="text-xs text-rm-text-muted">No DMs yet</span>
            <span className="text-[11px] text-rm-text-muted/40">
              Open a DM from the friends list
            </span>
          </div>
        )}
        {dmChannels.map((dm) => (
          <button
            key={dm.id}
            className={cn(
              "group relative flex w-full cursor-pointer items-center gap-2.5 rounded-md border-none px-2.5 py-2 text-left transition-all outline-none",
              activeChannelId === dm.id
                ? "bg-rm-bg-elevated text-rm-text shadow-sm"
                : "text-rm-text-muted hover:bg-rm-bg-elevated/50 hover:text-rm-text-secondary"
            )}
            onClick={() => onSelectDm(dm.id)}
            onContextMenu={(e) => handleDmContextMenu(e, dm)}
          >
            {/* Unread Indicator */}
            {activeChannelId !== dm.id && isUnread(dm.id, state.readStates, state.lastMessageAt) && (
              <div className="absolute left-[-4px] top-1/2 h-2 w-1 -translate-y-1/2 rounded-r-full bg-rm-text shadow-sm transition-all duration-300" />
            )}
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary text-xs font-bold text-primary-foreground ring-1 ring-white/10 cursor-pointer hover:ring-white/30 relative outline-none"
              onClick={(e) => {
                e.stopPropagation();
                dispatch({ type: 'SET_POPOVER', user: dm.recipient, anchor: e.currentTarget });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  dispatch({ type: 'SET_POPOVER', user: dm.recipient, anchor: e.currentTarget as HTMLElement });
                }
              }}
              role="button"
              tabIndex={0}
              aria-label={`View ${dm.recipient?.username ?? dm.name}'s profile`}
            >
              {dm.recipient?.avatar_url ? (
                <img src={getAuthAssetUrl(dm.recipient.avatar_url)} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} className="object-cover" />
              ) : (
                (dm.recipient?.username ?? dm.name ?? "?")[0].toUpperCase()
              )}
            </div>
            <div className="min-w-0 flex-1">
              <span className={cn(
                "block truncate text-[13px] font-medium transition-colors",
                activeChannelId === dm.id ? "text-rm-text" : "text-rm-text-secondary",
                activeChannelId !== dm.id && isUnread(dm.id, state.readStates, state.lastMessageAt) && "font-semibold text-rm-text"
              )}>
                {dm.recipient?.username ?? dm.name}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
