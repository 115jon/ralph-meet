import { getAuthAssetUrl } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chat-store";
import { useMemo } from "react";
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
  // Compute per-DM unread notification counts
  const notifications = useChatStore(s => s.notifications);
  const dmUnreadCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const n of notifications) {
      if (n.is_read) continue;
      if (n.type === 'dm' || n.type === 'mention' || n.type === 'reply') {
        // Only count for DM channels (server_id is null for DMs)
        if (!n.server_id) {
          counts[n.channel_id] = (counts[n.channel_id] ?? 0) + 1;
        }
      }
    }
    return counts;
  }, [notifications]);

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
        {dmChannels.map((dm) => {
          const dmIsUnread = activeChannelId !== dm.id && isUnread(dm.id, state.readStates, state.lastMessageAt);
          const dmNotifCount = dmUnreadCounts[dm.id] ?? 0;
          return (
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
              {/* Pill indicator — small dot only when unread */}
              {dmIsUnread && (
                <div className="absolute left-[-4px] top-1/2 w-1 h-2 -translate-y-1/2 rounded-r-full bg-rm-text transition-all duration-300" />
              )}
              <div className="relative shrink-0">
                <div
                  className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-primary text-xs font-bold text-primary-foreground ring-1 ring-white/10 cursor-pointer hover:ring-white/30 relative outline-none"
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
                {/* Status dot */}
                <div className={cn(
                  "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-rm-sidebar",
                  dm.recipient?.status === "online" ? "bg-emerald-500" :
                    dm.recipient?.status === "idle" ? "bg-amber-500" :
                      dm.recipient?.status === "dnd" ? "bg-rose-500" : "bg-zinc-500"
                )} />
              </div>
              <div className="min-w-0 flex-1">
                <span className={cn(
                  "block truncate text-[13px] font-medium transition-colors leading-tight",
                  activeChannelId === dm.id ? "text-rm-text" : "text-rm-text-secondary",
                  dmIsUnread && "font-semibold text-rm-text"
                )}>
                  {dm.recipient?.display_name ?? dm.recipient?.username ?? dm.name}
                </span>
                <span className="block truncate text-[11px] text-rm-text-muted leading-tight">
                  {dm.recipient?.status === "online" ? "Online" :
                    dm.recipient?.status === "idle" ? "Idle" :
                      dm.recipient?.status === "dnd" ? "Do Not Disturb" : "Offline"}
                </span>
              </div>
              {/* DM unread count badge */}
              {dmNotifCount > 0 && activeChannelId !== dm.id && (
                <div className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white leading-none">
                  {dmNotifCount > 99 ? "99+" : dmNotifCount}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
