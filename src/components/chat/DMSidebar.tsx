import { useContextMenu } from "@/hooks/useContextMenu";
import { cn } from "@/lib/utils";
import { useChatActions, useChatStore } from "@/stores/chat-store";

import { useEffect, useReducer } from "react";
import { useShallow } from "zustand/shallow";
import ContextMenu from "./ContextMenu";
import { DMListPanel } from "./DMListPanel";
import { Copy, Trash2, User as UserIcon, Users } from "./Icons";
import UserProfilePopover from "./UserProfilePopover";

interface Props {
  activeChannelId: string | null;
  onSelectDm: (channelId: string) => void;
  onShowFriends?: () => void;
}

interface UIState {
  popoverUser: any | null;
  popoverAnchor: HTMLElement | null;
}

function isUnread(
  channelId: string,
  readStates: Record<string, string>,
  lastMessageAt: Record<string, string>
): boolean {
  const lastMsg = lastMessageAt[channelId];
  if (!lastMsg) return false;
  const lastRead = readStates[channelId];
  if (!lastRead) return true;
  return lastMsg > lastRead;
}

export default function DMSidebar({ activeChannelId, onSelectDm, onShowFriends }: Props) {
  const { relationships, dmChannels, readStates, lastMessageAt } = useChatStore(useShallow(s => ({
    relationships: s.relationships,
    dmChannels: s.dmChannels,
    readStates: s.readStates,
    lastMessageAt: s.lastMessageAt,
  })));
  const { loadDmChannels, setProfileUser } = useChatActions();
  const { menu, openMenu, closeMenu } = useContextMenu();

  const [uiState, dispatch] = useReducer((s: UIState, a: any): UIState => {
    switch (a.type) {
      case 'SET_POPOVER': return { ...s, popoverUser: a.user, popoverAnchor: a.anchor };
      default: return s;
    }
  }, {
    popoverUser: null,
    popoverAnchor: null,
  });

  const { popoverUser, popoverAnchor } = uiState;

  useEffect(() => {
    loadDmChannels();
  }, [loadDmChannels]);

  const pendingCount = relationships.filter((f) => f.type === 2).length;
  const isFriendsActive = !activeChannelId;

  const handleDmContextMenu = (e: React.MouseEvent, dm: any) => {
    openMenu(e, [
      {
        label: "Profile",
        icon: <UserIcon className="h-4 w-4" />,
        onClick: () => setProfileUser(dm.recipient),
      },
      {
        label: "Copy ID",
        icon: <Copy className="h-4 w-4" />,
        onClick: () => navigator.clipboard.writeText(dm.id),
      },
      {
        label: "Close DM",
        icon: <Trash2 className="h-4 w-4" />,
        onClick: () => alert("Close DM not implemented yet"),
        variant: "danger",
      }
    ]);
  };

  return (
    <div className="flex w-full shrink-0 flex-1 flex-col overflow-hidden border-r border-rm-border bg-rm-sidebar backdrop-blur-xl font-sans">
      {/* Header */}
      <div
        className="shrink-0 border-b border-rm-border px-3"
        style={{ paddingTop: 'calc(8px + var(--safe-area-top, 0px))' }}
      >
        {/* Search placeholder */}
        <button
          className="mb-2 mt-1 flex w-full items-center gap-2 rounded-md bg-rm-bg-surface px-3 py-1.5 text-xs text-rm-text-muted/40 transition-colors hover:bg-rm-bg-elevated cursor-pointer outline-none border-none"
          onClick={() => window.dispatchEvent(new CustomEvent("open-command-menu"))}
        >
          Find or start a conversation
        </button>
      </div>

      {/* Friends nav button */}
      <div className="px-2 pt-2">
        <button
          className={cn(
            "group flex w-full cursor-pointer items-center gap-2.5 rounded-md border-none px-2.5 py-2 text-left transition-all outline-none",
            isFriendsActive
              ? "bg-rm-bg-elevated text-rm-text shadow-sm"
              : "text-rm-text-muted hover:bg-rm-bg-elevated/50 hover:text-rm-text-secondary"
          )}
          onClick={onShowFriends}
        >
          <Users className="h-5 w-5 shrink-0" />
          <span className="text-[13px] font-medium">Friends</span>
          {pendingCount > 0 && (
            <span className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
              {pendingCount}
            </span>
          )}
        </button>
      </div>

      {/* DM section header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-1">
        <span className="text-[10px] font-bold uppercase tracking-widest text-rm-text-muted/60">
          Direct Messages
        </span>
      </div>

      {/* DM list */}
      <DMListPanel
        dmChannels={dmChannels}
        activeChannelId={activeChannelId}
        onSelectDm={onSelectDm}
        isUnread={isUnread}
        state={{ readStates, lastMessageAt }}
        handleDmContextMenu={handleDmContextMenu}
        dispatch={dispatch}
      />

      {menu.isOpen && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menu.items}
          onClose={closeMenu}
        />
      )}

      {popoverUser && popoverAnchor && (
        <UserProfilePopover
          userId={popoverUser.id}
          username={popoverUser.username}
          avatarUrl={popoverUser.avatar_url}
          anchorEl={popoverAnchor}
          side="right"
          onClose={() => dispatch({ type: 'SET_POPOVER', user: null, anchor: null })}
        />
      )}
    </div>
  );
}
