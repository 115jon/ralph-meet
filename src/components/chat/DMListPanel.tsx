import { HIT } from "@/components/ui/interaction";
import {
  PHONE_GROUP,
  PHONE_ROW,
  SIDEBAR_LIST,
  SIDEBAR_UNREAD_PILL,
  sidebarRowClass,
} from "@/components/ui/sidebar-row";
import { toContextMenuEvent, useLongPress } from "@/hooks/useLongPress";
import { getDisplayInitial, getDisplayName } from "@/lib/display-name";
import { getAuthAssetUrl } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { UserStatusDot } from "./UserStatusDot";
import { useChatStore } from "@/stores/chat-store";
import { useMemo } from "react";
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
  /** `phone`: 12.4 rows (48px, 40px avatar) in a tinted group. */
  variant?: "sidebar" | "phone";
}

function statusLabel(status?: string | null) {
  if (status === "online") return "Online";
  if (status === "idle") return "Idle";
  if (status === "dnd") return "Do Not Disturb";
  return "Offline";
}

export function DMListPanel({
  dmChannels,
  activeChannelId,
  onSelectDm,
  isUnread,
  state,
  handleDmContextMenu,
  dispatch,
  variant = "sidebar",
}: DMListPanelProps) {
  const phone = variant === "phone";
  const bindDmLongPress = useLongPress<any>((info, dm) =>
    handleDmContextMenu(toContextMenuEvent(info), dm),
  );
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

  if (dmChannels.length === 0) {
    // Empty state (14.1): centred, unboxed, one line of guidance.
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
        <Icon name="chat" size="2xl" className="text-rm-text-muted" />
        <p className="text-ui-md font-semibold text-rm-text">No messages yet</p>
        <p className="max-w-[36ch] text-ui-sm text-pretty text-rm-text-secondary">
          Open a conversation from your friends list or a member's profile.
        </p>
      </div>
    );
  }

  const rows = dmChannels.map((dm) => {
    const selected = activeChannelId === dm.id;
    const dmIsUnread =
      !selected && isUnread(dm.id, state.readStates, state.lastMessageAt);
    const dmNotifCount = dmUnreadCounts[dm.id] ?? 0;
    const displayName = getDisplayName(dm.recipient, dm.name ?? "Unknown");
    return (
      <div
        key={dm.id}
        className={
          phone
            ? cn(PHONE_ROW, selected && "bg-rm-tint-2")
            : sidebarRowClass({ selected, unread: dmIsUnread, tall: true })
        }
      >
        <button
          type="button"
          className="absolute inset-0 rounded-md outline-none"
          onClick={() => onSelectDm(dm.id)}
          onContextMenu={(e) => handleDmContextMenu(e, dm)}
          {...bindDmLongPress(dm)}
          aria-label={`Open DM with ${displayName}`}
          aria-current={selected ? "page" : undefined}
        />
        {dmIsUnread && !phone && (
          <span aria-hidden className={SIDEBAR_UNREAD_PILL} />
        )}
        <div className="relative shrink-0">
          <button
            type="button"
            className={cn(
              "relative z-20 flex cursor-pointer items-center justify-center overflow-visible rounded-full bg-rm-accent-tint p-0 font-semibold text-rm-accent-ink outline-none",
              phone ? "size-10 text-ui-sm" : "size-8 text-ui-xs",
              HIT,
            )}
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
          <UserStatusDot
            status={dm.recipient?.status ?? "offline"}
            className={cn(
              "pointer-events-none absolute -right-0.5 -bottom-0.5 z-20 size-3 border-2",
              phone ? "border-rm-bg-primary" : "border-rm-sidebar",
            )}
          />
        </div>
        <div className="min-w-0 flex-1">
          <UserDisplayName
            user={dm.recipient}
            fallback={dm.name ?? "Unknown"}
            className={cn(
              "block truncate text-ui-base leading-5",
              dmIsUnread ? "font-semibold text-rm-text" : "font-medium",
            )}
          />
          <span className="block truncate text-ui-xs font-normal text-rm-text-secondary">
            {statusLabel(dm.recipient?.status)}
          </span>
        </div>
        {dmNotifCount > 0 && !selected && (
          <span className="badge-count shrink-0">
            {dmNotifCount > 99 ? "99+" : dmNotifCount}
          </span>
        )}
      </div>
    );
  });

  return phone ? (
    <div className="px-4 pb-4">
      <div className={PHONE_GROUP}>{rows}</div>
    </div>
  ) : (
    <div className={cn(SIDEBAR_LIST, "pt-0")}>{rows}</div>
  );
}
