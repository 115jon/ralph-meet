import { PRESS } from "@/components/ui/interaction";
import { useContextMenu } from "@/hooks/useContextMenu";
import { cn } from "@/lib/utils";
import { useChatActions, useChatStore } from "@/stores/chat-store";
import { useCallStore } from "@/stores/useCallStore";

import { Icon } from "@/components/ui/icon";
import { useReducer } from "react";
import { useShallow } from "zustand/shallow";
import ContextMenu from "./ContextMenu";
import { DMListPanel } from "./DMListPanel";
import UserProfilePopover from "./UserProfilePopover";

interface Props {
  activeChannelId: string | null;
  activeView?: "friends" | "shop";
  onSelectDm: (channelId: string) => void;
  onShowFriends?: () => void;
  onShowShop?: () => void;
}

interface UIState {
  popoverUser: any | null;
  popoverAnchor: HTMLElement | null;
}

function isUnread(
  channelId: string,
  readStates: Record<string, string>,
  lastMessageAt: Record<string, string>,
): boolean {
  const lastMsg = lastMessageAt[channelId];
  if (!lastMsg) return false;
  const lastRead = readStates[channelId];
  if (!lastRead) return true;
  return lastMsg > lastRead;
}

export default function DMSidebar({
  activeChannelId,
  activeView = "friends",
  onSelectDm,
  onShowFriends,
  onShowShop,
}: Props) {
  const { relationships, dmChannels, readStates, lastMessageAt } = useChatStore(
    useShallow((s) => ({
      relationships: s.relationships,
      dmChannels: s.dmChannels,
      readStates: s.readStates,
      lastMessageAt: s.lastMessageAt,
    })),
  );
  const { setProfileUser } = useChatActions();
  const { menu, openMenu, closeMenu } = useContextMenu();

  const [uiState, dispatch] = useReducer(
    (s: UIState, a: any): UIState => {
      switch (a.type) {
        case "SET_POPOVER":
          return { ...s, popoverUser: a.user, popoverAnchor: a.anchor };
        default:
          return s;
      }
    },
    {
      popoverUser: null,
      popoverAnchor: null,
    },
  );

  const { popoverUser, popoverAnchor } = uiState;

  const pendingCount = relationships.filter((f) => f.type === 2).length;
  const isFriendsActive = !activeChannelId && activeView === "friends";
  const isShopActive = !activeChannelId && activeView === "shop";

  const handleDmContextMenu = (e: React.MouseEvent, dm: any) => {
    // Check if we should hide the call option (already in call or ringing this user)
    const callState = useCallStore.getState();

    const isRingingThisUser =
      callState.status === "ringing_outgoing" &&
      callState.remoteUser?.id === dm.recipient?.id;
    const isInCallOnChannel =
      callState.status === "active" &&
      callState.channelId === dm.id &&
      callState.hasJoinedSFU;
    const hideCallOption = isRingingThisUser || isInCallOnChannel;

    openMenu(e, [
      {
        label: "Profile",
        icon: <Icon name="account" size="sm" />,
        onClick: () => setProfileUser(dm.recipient),
      },
      ...(!hideCallOption
        ? [
            {
              label: "Start a Call",
              icon: <Icon name="call" size="sm" />,
              onClick: () => {
                onSelectDm(dm.id);
                window.dispatchEvent(
                  new CustomEvent("request-start-call", {
                    detail: {
                      userId: dm.recipient.id,
                      displayName:
                        dm.recipient.display_name ?? dm.recipient.username,
                      channelId: dm.id,
                    },
                  }),
                );
              },
            },
          ]
        : []),
      {
        label: "Copy ID",
        icon: <Icon name="copy" size="sm" />,
        onClick: () => navigator.clipboard.writeText(dm.id),
      },
      {
        label: "Close DM",
        icon: <Icon name="trash" size="sm" />,
        onClick: () => alert("Close DM not implemented yet"),
        variant: "danger",
      },
    ]);
  };

  return (
    <div className="flex w-full shrink-0 flex-1 flex-col overflow-hidden border-r border-rm-border bg-rm-sidebar font-sans">
      {/* Header */}
      <div
        className="shrink-0 border-b border-rm-border px-3"
        style={{ paddingTop: "calc(8px + var(--safe-area-top, 0px))" }}
      >
        {/* Search placeholder */}
        <button
          className={cn(
            "mb-2 mt-1 flex h-8 w-full items-center gap-2 rounded-md bg-rm-tint-1 px-3 text-ui-sm text-rm-text-muted cursor-pointer outline-none pointer-fine:hover:text-rm-text",
            PRESS,
          )}
          onClick={() =>
            window.dispatchEvent(new CustomEvent("open-command-menu"))
          }
        >
          Find or start a conversation
        </button>
      </div>

      {/* Friends nav button */}
      <div className="px-2 pt-2">
        <button
          className={cn(
            "group flex w-full cursor-pointer items-center gap-2.5 rounded-md border-none px-2.5 py-1.5 text-left transition-ui outline-none enabled:active:scale-[0.98]",
            isFriendsActive
              ? "bg-rm-bg-active text-rm-text"
              : "text-rm-text-muted pointer-fine:hover:bg-rm-bg-elevated/50 pointer-fine:hover:text-rm-text-secondary",
          )}
          onClick={onShowFriends}
        >
          <Icon name="members" size="lg" className="shrink-0" />
          <span className="text-ui-sm font-medium">Friends</span>
          {pendingCount > 0 && (
            <span className="badge-count ml-auto">{pendingCount}</span>
          )}
        </button>
      </div>

      <div className="px-2 pt-2">
        <button
          className={cn(
            "group flex w-full cursor-pointer items-center gap-2.5 rounded-md border-none px-2.5 py-1.5 text-left transition-ui outline-none enabled:active:scale-[0.98]",
            isShopActive
              ? "bg-rm-bg-active text-rm-text"
              : "text-rm-text-muted pointer-fine:hover:bg-rm-bg-elevated/50 pointer-fine:hover:text-rm-text-secondary",
          )}
          onClick={onShowShop}
        >
          <Icon name="shop" size="lg" className="shrink-0" />
          <span className="text-ui-sm font-medium">Shop</span>
        </button>
      </div>

      {/* DM section header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-1">
        <span className="text-ui-2xs font-semibold uppercase tracking-[0.08em] text-rm-text-muted">
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
          displayName={popoverUser.display_name}
          avatarUrl={popoverUser.avatar_url}
          avatarDisplay={popoverUser.avatar_display}
          seedUser={popoverUser}
          anchorEl={popoverAnchor}
          side="right"
          onClose={() =>
            dispatch({ type: "SET_POPOVER", user: null, anchor: null })
          }
        />
      )}
    </div>
  );
}
