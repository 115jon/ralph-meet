import { getDisplayInitial, getDisplayName } from "@/lib/display-name";
import { getAuthAssetUrl } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { UserStatusDot } from "./UserStatusDot";
import { useChatStore } from "@/stores/chat-store";
import { useMemo } from "react";
import { DitherField } from "@/components/ui/DitherField";
import { AvatarImage } from "./AvatarImage";
import { Icon } from "@/components/ui/icon";
import { UserDisplayName } from "./UserDisplayName";

interface DMListPanelProps {
  dmChannels: any[];
  activeChannelId: string | null;
  onSelectDm: (channelId: string) => void;
  isUnread: (
    channelId: string,
    readStates: Record<string, string>,
    lastMessageAt: Record<string, string>,
  ) => boolean;
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
  const notifications = useChatStore((s) => s.notifications);
  const dmUnreadCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const n of notifications) {
      if (n.is_read) continue;
      if (n.type === "dm" || n.type === "mention" || n.type === "reply") {
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
          <div className="relative mx-1 mt-1 flex flex-col items-center gap-1 overflow-hidden rounded-lg border border-rm-border px-4 pb-5 pt-[80px] text-center">
            <DitherField
              className="inset-x-0 top-0 bottom-auto h-[72px]"
              cell={4}
              intensity={0.5}
              opacity={0.9}
              fade="bottom"
              tone="quiet"
              seed={7}
            />
            <Icon name="chat" size="lg" className="text-rm-text-muted" />
            <span className="text-ui-sm font-medium text-rm-text">
              No DMs yet
            </span>
            <span className="text-ui-xs text-rm-text-muted">
              Open a DM from the friends list
            </span>
          </div>
        )}
        {dmChannels.map((dm) => {
          const dmIsUnread =
            activeChannelId !== dm.id &&
            isUnread(dm.id, state.readStates, state.lastMessageAt);
          const dmNotifCount = dmUnreadCounts[dm.id] ?? 0;
          const displayName = getDisplayName(
            dm.recipient,
            dm.name ?? "Unknown",
          );
          return (
            <div
              key={dm.id}
              className={cn(
                "group relative flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-ui",
                activeChannelId === dm.id
                  ? "bg-rm-bg-elevated text-rm-text shadow-sm"
                  : "text-rm-text-muted hover:bg-rm-bg-elevated/50 hover:text-rm-text-secondary",
              )}
            >
              <button
                type="button"
                className="absolute inset-0 rounded-md outline-none"
                onClick={() => onSelectDm(dm.id)}
                onContextMenu={(e) => handleDmContextMenu(e, dm)}
                aria-label={`Open DM with ${displayName}`}
              />
              {/* Pill indicator — small dot only when unread */}
              {dmIsUnread && (
                <div className="absolute left-[-4px] top-1/2 w-1 h-2 -translate-y-1/2 rounded-r-full bg-rm-text transition-ui" />
              )}
              <div className="relative shrink-0">
                <button
                  type="button"
                  className="relative z-20 flex h-8 w-8 cursor-pointer items-center justify-center overflow-visible rounded-full border-0 bg-primary p-0 text-xs font-bold text-primary-foreground ring-1 ring-rm-border outline-none hover:ring-rm-border-strong"
                  onClick={(e) => {
                    e.stopPropagation();
                    dispatch({
                      type: "SET_POPOVER",
                      user: dm.recipient,
                      anchor: e.currentTarget,
                    });
                  }}
                  aria-label={`View ${displayName}'s profile`}
                >
                  {dm.recipient?.avatar_url ? (
                    <AvatarImage
                      src={getAuthAssetUrl(dm.recipient.avatar_url)}
                      alt=""
                      display={dm.recipient.avatar_display}
                    />
                  ) : (
                    getDisplayInitial(dm.recipient, "?")
                  )}
                </button>
                {/* Status dot */}
                <UserStatusDot
                  status={dm.recipient?.status ?? "offline"}
                  className="absolute -bottom-0.5 -right-0.5 h-3 w-3 border-2 border-rm-sidebar"
                />
              </div>
              <div className="min-w-0 flex-1">
                <UserDisplayName
                  user={dm.recipient}
                  fallback={dm.name ?? "Unknown"}
                  className={cn(
                    "block truncate text-ui-sm font-medium leading-tight transition-colors",
                    activeChannelId === dm.id
                      ? "text-rm-text"
                      : "text-rm-text-secondary",
                    dmIsUnread && "font-semibold text-rm-text",
                  )}
                />
                <span className="block truncate text-ui-2xs text-rm-text-muted leading-tight">
                  {dm.recipient?.status === "online"
                    ? "Online"
                    : dm.recipient?.status === "idle"
                      ? "Idle"
                      : dm.recipient?.status === "dnd"
                        ? "Do Not Disturb"
                        : "Offline"}
                </span>
              </div>
              {/* DM unread count badge */}
              {dmNotifCount > 0 && activeChannelId !== dm.id && (
                <div className="badge-count shrink-0">
                  {dmNotifCount > 99 ? "99+" : dmNotifCount}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
