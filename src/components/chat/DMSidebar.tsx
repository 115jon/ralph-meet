import { HIT, PRESS } from "@/components/ui/interaction";
import {
  PHONE_GROUP,
  PHONE_ICON_SLOT,
  PHONE_ROW,
  SIDEBAR_CATEGORY,
  SIDEBAR_ICON_SLOT,
  SIDEBAR_LIST,
  sidebarRowClass,
} from "@/components/ui/sidebar-row";
import { useContextMenu } from "@/hooks/useContextMenu";
import { cn } from "@/lib/utils";
import { useChatActions, useChatStore } from "@/stores/chat-store";
import { useCallStore } from "@/stores/useCallStore";

import { Icon, type IconName } from "@/components/ui/icon";
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
  /**
   * `phone` is the Messages tab: a 48px page header, a 44px search field and
   * 12.4 list rows (48px, 40px avatars). `sidebar` is the 240px desktop
   * column.
   */
  variant?: "sidebar" | "phone";
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

function openCommandMenu() {
  window.dispatchEvent(new CustomEvent("open-command-menu"));
}

/** Friends / Shop: a nav row in the sidebar, a 12.4 row on the phone. */
function NavRow({
  icon,
  label,
  selected,
  badge,
  phone,
  onClick,
}: {
  icon: IconName;
  label: string;
  selected: boolean;
  badge?: number;
  phone: boolean;
  onClick?: () => void;
}) {
  if (phone) {
    return (
      <button type="button" className={PHONE_ROW} onClick={onClick}>
        <span className={PHONE_ICON_SLOT}>
          <Icon name={icon} size="lg" />
        </span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {badge ? <span className="badge-count">{badge}</span> : null}
        <Icon
          name="chevronRight"
          size="xs"
          className="shrink-0 text-rm-text-muted"
        />
      </button>
    );
  }
  return (
    <button
      type="button"
      aria-current={selected ? "page" : undefined}
      className={sidebarRowClass({ selected, className: PRESS })}
      onClick={onClick}
    >
      <span className={SIDEBAR_ICON_SLOT}>
        <Icon name={icon} size="md" state={selected ? "active" : undefined} />
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge ? <span className="badge-count">{badge}</span> : null}
    </button>
  );
}

export default function DMSidebar({
  activeChannelId,
  activeView = "friends",
  onSelectDm,
  onShowFriends,
  onShowShop,
  variant = "sidebar",
}: Props) {
  const phone = variant === "phone";
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

    // No "Close DM": the API has no way to hide a DM channel yet, so the
    // item only showed an alert.
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
    ]);
  };

  const navRows = (
    <>
      <NavRow
        icon="members"
        label="Friends"
        selected={isFriendsActive}
        badge={pendingCount}
        phone={phone}
        onClick={onShowFriends}
      />
      <NavRow
        icon="shop"
        label="Shop"
        selected={isShopActive}
        phone={phone}
        onClick={onShowShop}
      />
    </>
  );

  return (
    <div
      className={cn(
        "flex w-full min-h-0 flex-1 flex-col overflow-hidden font-sans",
        phone
          ? "bg-rm-bg-primary"
          : "shrink-0 border-r border-rm-border bg-rm-sidebar",
      )}
    >
      {phone ? (
        <>
          {/* Phone page header (12.2): 48px + safe area. */}
          <header className="flex h-[calc(48px+var(--safe-area-top,0px))] shrink-0 items-center px-4 pt-[var(--safe-area-top,0px)]">
            <h1 className="truncate text-ui-md font-semibold text-rm-text">
              Messages
            </h1>
          </header>
          <div className="shrink-0 px-4 pb-2">
            <button
              type="button"
              className={cn(
                "flex min-h-11 w-full items-center gap-2 rounded-md border border-rm-field-edge bg-rm-bg-surface px-3 text-left text-ui-md text-rm-text-muted outline-none",
                PRESS,
              )}
              onClick={openCommandMenu}
            >
              <Icon name="search" size="md" className="shrink-0" />
              <span className="truncate">Find or start a conversation</span>
            </button>
          </div>
        </>
      ) : (
        /* 48px header on the main header's line, plus the safe area. */
        <div className="flex h-[calc(48px+var(--safe-area-top,0px))] shrink-0 items-center border-b border-rm-border px-2 pt-[var(--safe-area-top,0px)]">
          <button
            type="button"
            className={cn(
              "flex h-8 w-full items-center gap-2 rounded-md bg-rm-tint-1 px-2 text-left text-ui-sm text-rm-text-muted outline-none pointer-fine:hover:text-rm-text",
              PRESS,
              HIT,
            )}
            onClick={openCommandMenu}
          >
            <Icon name="search" size="sm" className="shrink-0" />
            <span className="truncate">Find or start a conversation</span>
          </button>
        </div>
      )}

      {/* One scroller: nav rows, the DM eyebrow and the DM rows. */}
      <div
        className={cn(
          "min-h-0 flex-1 overflow-y-auto overscroll-contain custom-scrollbar",
          phone && "pb-[var(--safe-area-bottom,0px)]",
        )}
      >
        {phone ? (
          <div className="px-4 pt-2">
            <div className={PHONE_GROUP}>{navRows}</div>
          </div>
        ) : (
          <div className={cn(SIDEBAR_LIST, "pb-0")}>{navRows}</div>
        )}

        <h2 className={cn(SIDEBAR_CATEGORY, phone ? "px-4 pt-6 pb-2" : "px-4")}>
          Direct Messages
        </h2>

        <DMListPanel
          dmChannels={dmChannels}
          activeChannelId={activeChannelId}
          onSelectDm={onSelectDm}
          isUnread={isUnread}
          state={{ readStates, lastMessageAt }}
          handleDmContextMenu={handleDmContextMenu}
          dispatch={dispatch}
          variant={variant}
        />
      </div>

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
