
import { useContextMenu } from "@/hooks/useContextMenu";
import { getAuthAssetUrl } from "@/lib/platform";
import type { Channel, Server } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useMemo, useState } from "react";
import ContextMenu from "./ContextMenu";
import CreateServerModal from "./CreateServerModal";
import { HomeIcon } from "./HomeIcon";
import { Copy, Plus, Trash2 } from "./Icons";

const EMPTY_CHANNELS: Channel[] = [];
const EMPTY_OBJECT = {};
const EMPTY_MENTION_COUNTS: Record<string, number> = {};
const EMPTY_UNREAD_DMS: UnreadDm[] = [];

/** Max DM avatars to show in the nav bar before collapsing */
const MAX_VISIBLE_DMS = 3;

interface UnreadDm {
  channelId: string;
  recipient: { id: string; username: string; avatar_url?: string };
}

interface Props {
  servers: Server[];
  activeServerId: string | null;
  activeChannelId?: string | null;
  onSelect: (serverId: string) => void;
  channels?: Channel[];
  readStates?: Record<string, string>;
  lastMessageAt?: Record<string, string>;
  serverMentionCounts?: Record<string, number>;
  homeBadgeCount?: number;
  unreadDms?: UnreadDm[];
  onSelectDm?: (channelId: string) => void;
}

function serverHasUnread(
  serverId: string,
  channels: Channel[],
  readStates: Record<string, string>,
  lastMessageAt: Record<string, string>
): boolean {
  const serverChannels = channels.filter((c) => c.server_id === serverId);
  return serverChannels.some((ch) => {
    const lastMsg = lastMessageAt[ch.id];
    if (!lastMsg) return false;
    const lastRead = readStates[ch.id];
    if (!lastRead) return true;
    return lastMsg > lastRead;
  });
}

export default function ServerList({
  servers,
  activeServerId,
  activeChannelId,
  onSelect,
  channels = EMPTY_CHANNELS,
  readStates = EMPTY_OBJECT,
  lastMessageAt = EMPTY_OBJECT,
  serverMentionCounts = EMPTY_MENTION_COUNTS,
  homeBadgeCount = 0,
  unreadDms = EMPTY_UNREAD_DMS,
  onSelectDm,
}: Props) {
  const [showCreate, setShowCreate] = useState(false);
  const [dmExpanded, setDmExpanded] = useState(false);
  const { menu, openMenu, closeMenu } = useContextMenu();

  const handleServerContextMenu = (e: React.MouseEvent, server: Server) => {
    openMenu(e, [
      {
        label: "Copy ID",
        icon: <Copy className="h-4 w-4" />,
        onClick: () => navigator.clipboard.writeText(server.id),
      },
      {
        label: "Leave Server",
        icon: <Trash2 className="h-4 w-4" />,
        onClick: () => alert("Leave server not implemented yet"),
        variant: "danger",
      },
    ]);
  };

  // Determine which DMs to display in the nav bar
  const { visibleDms, overflowCount } = useMemo(() => {
    if (dmExpanded || unreadDms.length <= MAX_VISIBLE_DMS) {
      return { visibleDms: unreadDms, overflowCount: 0 };
    }
    return {
      visibleDms: unreadDms.slice(0, MAX_VISIBLE_DMS),
      overflowCount: unreadDms.length - MAX_VISIBLE_DMS,
    };
  }, [unreadDms, dmExpanded]);

  const hasDmSection = unreadDms.length > 0;

  return (
    <div
      className="flex flex-col items-center gap-2 bg-rm-bg-floating overflow-y-auto no-scrollbar pt-3 w-full h-full relative z-100"
      style={{
        paddingTop: 'calc(12px + var(--safe-area-top, 0px))',
        paddingBottom: 'calc(12px + var(--safe-area-bottom, 0px))'
      }}
    >
      {/* Home / DM button */}
      <div className="relative flex w-full justify-center group">
        <button
          className={cn(
            "relative flex h-12 w-12 cursor-pointer items-center justify-center rounded-[24px] bg-rm-bg-elevated text-rm-text-primary transition-all duration-300 hover:rounded-[16px] hover:bg-primary hover:text-primary-foreground",
            activeServerId === "@me" && "rounded-[16px] bg-primary text-primary-foreground shadow-[0_0_20px_var(--rm-glow)]"
          )}
          onClick={() => onSelect("@me")}
        >
          <HomeIcon className="h-7 w-7" />
          {/* Home badge — unread DMs + pending friend requests */}
          {homeBadgeCount > 0 && (
            <div className="absolute -bottom-1 -right-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white ring-[3px] ring-rm-bg-floating animate-in zoom-in duration-200 pointer-events-none">
              {homeBadgeCount > 99 ? "99+" : homeBadgeCount}
            </div>
          )}
        </button>
        {/* Indicator pill */}
        <div className={cn(
          "absolute left-0 top-1/2 -translate-y-1/2 w-1 rounded-r-full bg-rm-text transition-all duration-300",
          activeServerId === "@me" ? "h-10" : "h-0 group-hover:h-5"
        )} />
      </div>

      {/* ── Unread DM Avatars ─────────────────────────────────────── */}
      {hasDmSection && (
        <>
          <div className="mx-auto h-[2px] w-8 rounded-full bg-rm-border" />

          {visibleDms.map((dm) => {
            const isActiveDm = activeServerId === "@me" && activeChannelId === dm.channelId;
            return (
              <div key={dm.channelId} className="relative flex w-full justify-center group">
                <button
                  className={cn(
                    "relative flex h-12 w-12 cursor-pointer items-center justify-center rounded-full transition-all duration-300",
                    isActiveDm
                      ? "ring-2 ring-primary shadow-[0_0_20px_var(--rm-glow)]"
                      : "ring-1 ring-white/10 hover:ring-white/30"
                  )}
                  onClick={() => onSelectDm?.(dm.channelId)}
                >
                  {dm.recipient.avatar_url ? (
                    <img
                      src={getAuthAssetUrl(dm.recipient.avatar_url)}
                      alt={dm.recipient.username}
                      className="h-full w-full rounded-[inherit] object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center rounded-[inherit] bg-rm-bg-elevated text-sm font-bold text-rm-text">
                      {dm.recipient.username[0]?.toUpperCase() ?? "?"}
                    </div>
                  )}
                  {/* Tooltip */}
                  <div className="hidden md:block pointer-events-none fixed left-[80px] z-150 whitespace-nowrap rounded bg-rm-bg-floating px-2 py-1 text-xs font-medium text-rm-text opacity-0 shadow-xl transition-opacity group-hover:opacity-100 border border-rm-border">
                    {dm.recipient.username}
                  </div>
                  {/* DM unread badge — always show since these are unread */}
                  <div className="absolute -bottom-1 -right-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white ring-[3px] ring-rm-bg-floating pointer-events-none">
                    !
                  </div>
                </button>
                {/* White indicator pill */}
                <div className={cn(
                  "absolute left-0 top-1/2 -translate-y-1/2 w-1 rounded-r-full bg-rm-text transition-all duration-300",
                  isActiveDm ? "h-10" : "h-2 group-hover:h-5"
                )} />
              </div>
            );
          })}

          {/* Overflow indicator — show remaining count */}
          {overflowCount > 0 && (
            <button
              className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full bg-rm-bg-elevated text-[11px] font-bold text-rm-text-muted transition-all hover:bg-rm-bg-hover hover:text-rm-text"
              onClick={() => setDmExpanded(true)}
            >
              +{overflowCount}
            </button>
          )}

          {/* Collapse button when expanded and there are >MAX DMs */}
          {dmExpanded && unreadDms.length > MAX_VISIBLE_DMS && (
            <button
              className="flex h-6 w-10 cursor-pointer items-center justify-center rounded-full bg-rm-bg-elevated text-[10px] font-medium text-rm-text-muted transition-all hover:bg-rm-bg-hover hover:text-rm-text"
              onClick={() => setDmExpanded(false)}
            >
              Less
            </button>
          )}
        </>
      )}

      <div className="mx-auto h-[2px] w-8 rounded-full bg-rm-border" />

      {/* Server icons */}
      {servers.map((server) => {
        const isActive = activeServerId === server.id;
        const hasUnread = !isActive && serverHasUnread(server.id, channels, readStates, lastMessageAt);
        const mentionCount = serverMentionCounts[server.id] ?? 0;
        return (
          <div key={server.id} className="relative flex w-full justify-center group">
            <button
              className={cn(
                "relative flex h-12 w-12 cursor-pointer items-center justify-center rounded-[24px] font-bold transition-all duration-300 hover:rounded-[16px]",
                isActive ? "bg-primary text-primary-foreground shadow-[0_0_20px_var(--rm-glow)]" : "bg-rm-bg-elevated text-rm-text hover:bg-primary hover:text-primary-foreground"
              )}
              onClick={() => onSelect(server.id)}
              onContextMenu={(e) => handleServerContextMenu(e, server)}
            >
              {server.icon_url ? (
                <img
                  src={getAuthAssetUrl(server.icon_url)}
                  alt={server.name}
                  className="h-full w-full rounded-[inherit] object-cover"
                />
              ) : (
                server.name.charAt(0).toUpperCase()
              )}
              {/* Tooltip */}
              <div className="hidden md:block pointer-events-none fixed left-[80px] z-150 whitespace-nowrap rounded bg-rm-bg-floating px-2 py-1 text-xs font-medium text-rm-text opacity-0 shadow-xl transition-opacity group-hover:opacity-100 border border-rm-border">
                {server.name}
              </div>
              {/* Mention count badge — bottom-right */}
              {mentionCount > 0 && (
                <div className="absolute -bottom-1 -right-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white ring-[3px] ring-rm-bg-floating animate-in zoom-in duration-200 pointer-events-none">
                  {mentionCount > 99 ? "99+" : mentionCount}
                </div>
              )}
            </button>
            {/* Indicator pill */}
            <div className={cn(
              "absolute left-0 top-1/2 -translate-y-1/2 w-1 rounded-r-full bg-rm-text transition-all duration-300",
              isActive ? "h-10" : hasUnread ? "h-2 group-hover:h-5" : "h-0 group-hover:h-5"
            )} />
          </div>
        );
      })}

      {/* Add server */}
      <button
        className="group relative flex h-12 w-12 cursor-pointer items-center justify-center rounded-[24px] bg-rm-bg-elevated text-rm-text-primary transition-all duration-300 hover:rounded-[16px] hover:bg-primary hover:text-primary-foreground"
        onClick={() => setShowCreate(true)}
      >
        <Plus className="h-6 w-6" />
      </button>

      {showCreate && (
        <CreateServerModal onClose={() => setShowCreate(false)} />
      )}

      {menu.isOpen && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menu.items}
          onClose={closeMenu}
        />
      )}
    </div>
  );
}
