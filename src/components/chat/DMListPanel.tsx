import { HIT } from "@/components/ui/interaction";
import {
  SIDEBAR_LIST,
  SIDEBAR_UNREAD_PILL,
  sidebarRowClass,
} from "@/components/ui/sidebar-row";
import { toContextMenuEvent, useLongPress } from "@/hooks/useLongPress";
import { getDisplayName } from "@/lib/display-name";
import { getAuthAssetUrl } from "@/lib/platform";
import { cn } from "@/lib/utils";
import {
  normalizeUserStatus,
  USER_STATUS_LABELS,
  UserStatusDot,
} from "./UserStatusDot";
import { useChatStore } from "@/stores/chat-store";
import { useMemo } from "react";
import { AvatarImage } from "./AvatarImage";
import { avatarShape } from "@/components/ui/avatar-shape";
import { Avatar } from "@/components/ui/avatar";
import { CountBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { UserDisplayName } from "./UserDisplayName";

/**
 * Phone list grammar (shared with MobileYouPage): an inset grouped card,
 * rows split by hairlines. Rows are 48px, 56px with a status line; press is
 * a tint-3 overlay, hover tint-1 on fine pointers only.
 */
const PHONE_DM_GROUP =
  "overflow-hidden rounded-lg border border-line bg-ply-2 divide-y divide-line";
const PHONE_DM_ROW =
  "group relative flex min-h-12 w-full min-w-0 items-center gap-3 px-4 py-2 text-left text-ui-row text-ink-2 outline-none select-none [-webkit-tap-highlight-color:transparent] transition-colors duration-(--dur-1) ease-out active:bg-tint-3 pointer-fine:hover:bg-tint-1";

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
  /**
   * `sidebar`: the shared row anatomy (32px, 24px avatar, 40px only with a
   * custom status). `phone`: the same anatomy scaled for touch (48px, 56px
   * with a status line, 32px avatar) in an inset grouped card.
   */
  variant?: "sidebar" | "phone";
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
    // Inline empty line under the "Direct messages" label: the sidebar is a
    // list, not a page, so it gets one quiet sentence and the shortcut.
    return phone ? (
      <EmptyState
        size="sm"
        title="No conversations yet"
        description="Message a friend from your friends list or a profile."
      />
    ) : (
      <div className="flex flex-col gap-1 px-4 py-1 text-ui-sm text-ink-3">
        <p>No conversations yet.</p>
        <p className="flex items-center gap-1.5">
          Start one with
          <KbdGroup>
            <Kbd>Ctrl</Kbd>
            <Kbd>K</Kbd>
          </KbdGroup>
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
    // One line unless the person set a custom status; presence already
    // shows as the dot, so it is never repeated as text.
    const customStatus: string | null =
      dm.recipient?.custom_status?.trim() || null;
    return (
      <div
        key={dm.id}
        className={
          phone
            ? cn(
                PHONE_DM_ROW,
                customStatus && "min-h-14",
                selected && "bg-tint-2 text-ink-1",
              )
            : sidebarRowClass({
                selected,
                unread: dmIsUnread,
                tall: !!customStatus,
              })
        }
      >
        <button
          type="button"
          className="absolute inset-0 rounded-[inherit] outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
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
              "relative z-20 flex cursor-pointer items-center justify-center rounded-avatar p-0 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
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
              // AvatarImage honours the member's crop (avatar_display); the
              // ui Avatar is the fallback for everyone without a picture.
              <span
                aria-hidden="true"
                className={cn(
                  "relative flex bg-ply-2",
                  avatarShape(dm.recipient.avatar_display),
                  phone ? "size-8" : "size-6",
                )}
              >
                <AvatarImage
                  src={getAuthAssetUrl(dm.recipient.avatar_url)}
                  alt=""
                  display={dm.recipient.avatar_display}
                />
              </span>
            ) : (
              <Avatar
                name={displayName}
                size={phone ? 32 : 24}
                aria-hidden="true"
              />
            )}
          </button>
          <UserStatusDot
            status={normalizeUserStatus(dm.recipient?.status)}
            label={
              USER_STATUS_LABELS[normalizeUserStatus(dm.recipient?.status)]
            }
            ring={phone ? "bg-ply-2" : "bg-ply-1"}
            className="pointer-events-none absolute -right-1 -bottom-1 z-20 size-3"
          />
        </div>
        <div className="min-w-0 flex-1">
          <UserDisplayName
            user={dm.recipient}
            fallback={dm.name ?? "Unknown"}
            className={cn(
              "block truncate text-ui-row",
              dmIsUnread ? "font-semibold text-ink-1" : "font-medium",
            )}
          />
          {customStatus && (
            <span className="block truncate text-ui-xs font-normal text-ink-3">
              {customStatus}
            </span>
          )}
        </div>
        {dmNotifCount > 0 && !selected && (
          <CountBadge count={dmNotifCount} className="shrink-0" />
        )}
      </div>
    );
  });

  return phone ? (
    <div className="px-4 pb-4">
      <div className={PHONE_DM_GROUP}>{rows}</div>
    </div>
  ) : (
    <div className={cn(SIDEBAR_LIST, "pt-0")}>{rows}</div>
  );
}
