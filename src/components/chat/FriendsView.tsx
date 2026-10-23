import { getDisplayInitial, getDisplayName } from "@/lib/display-name";
import { ButtonBase } from "@/components/ui/button-base";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/IconButton";
import { Input } from "@/components/ui/input";
import { HIT, REVEAL } from "@/components/ui/interaction";
import { Label } from "@/components/ui/label";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { Tabs, tabId } from "@/components/ui/tabs";
import { useContextMenu } from "@/hooks/useContextMenu";
import {
  LONG_PRESS_TARGET,
  toContextMenuEvent,
  useLongPress,
} from "@/hooks/useLongPress";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { apiDelete, apiPost, apiPut } from "@/lib/api-client";
import { getAuthAssetUrl } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { UserStatusDot } from "./UserStatusDot";
import { useChatActions, useChatStore } from "@/stores/chat-store";
import { useCallStore } from "@/stores/useCallStore";
import { useCallback, useEffect, useId, useReducer, useState } from "react";
import { useShallow } from "zustand/shallow";
import ContextMenu from "./ContextMenu";
import { AvatarImage } from "./AvatarImage";
import { Icon, type IconName } from "@/components/ui/icon";
import { UserDisplayName } from "./UserDisplayName";
import UserProfilePopover from "./UserProfilePopover";

type Tab = "online" | "all" | "pending" | "blocked";
const FRIEND_TABS: readonly Tab[] = ["online", "all", "pending", "blocked"];
const TAB_LABEL: Record<Tab, string> = {
  online: "Online",
  all: "All",
  pending: "Pending",
  blocked: "Blocked",
};
const LIST_LABEL: Record<Tab, string> = {
  online: "Online",
  all: "All friends",
  pending: "Pending",
  blocked: "Blocked",
};
const EMPTY: Record<Tab, { icon: IconName; title: string; body?: string }> = {
  online: { icon: "members", title: "No friends online" },
  all: {
    icon: "members",
    title: "No friends yet",
    body: "Add a friend by their username to start a conversation.",
  },
  pending: { icon: "invite", title: "No pending requests" },
  blocked: { icon: "ban", title: "No blocked users" },
};

type AddStatus = { kind: "success" | "error"; message: string } | null;

/** A pending remove/reject/cancel, confirmed in a ResponsiveDialog. */
type RemoveTarget = { user: any; relType: number } | null;

interface FriendsViewState {
  tab: Tab;
  loading: boolean;
  addFriendMode: boolean;
  addUsername: string;
  addStatus: AddStatus;
  popoverUser: any | null;
  popoverAnchor: HTMLElement | null;
}

type FVAction =
  | { type: "SET_TAB"; value: Tab }
  | { type: "SET_LOADING"; value: boolean }
  | { type: "SET_ADD_FRIEND_MODE"; value: boolean }
  | { type: "SET_ADD_USERNAME"; value: string }
  | { type: "SET_ADD_STATUS"; value: AddStatus }
  | { type: "SET_POPOVER"; user: any; anchor: HTMLElement | null };

function fvReducer(s: FriendsViewState, a: FVAction): FriendsViewState {
  switch (a.type) {
    case "SET_TAB":
      return { ...s, tab: a.value };
    case "SET_LOADING":
      return { ...s, loading: a.value };
    case "SET_ADD_FRIEND_MODE":
      return { ...s, addFriendMode: a.value };
    case "SET_ADD_USERNAME":
      return { ...s, addUsername: a.value };
    case "SET_ADD_STATUS":
      return { ...s, addStatus: a.value };
    case "SET_POPOVER":
      return { ...s, popoverUser: a.user, popoverAnchor: a.anchor };
    default:
      return s;
  }
}

function relationLabel(rel: { type: number; user: { status?: string } }) {
  if (rel.type === 2) return "Incoming friend request";
  if (rel.type === 3) return "Outgoing friend request";
  if (rel.type === 1) return "Blocked";
  if (rel.user.status === "online") return "Online";
  if (rel.user.status === "idle") return "Idle";
  if (rel.user.status === "dnd") return "Do Not Disturb";
  return "Offline";
}

/** Remove (friend), Reject (incoming) or Cancel (outgoing). */
function removeCopy(relType: number) {
  if (relType === 0)
    return {
      action: "Remove Friend",
      title: "Remove friend",
      body: (name: string) =>
        `${name} will be removed from your friends. You can send a new request later.`,
      confirm: "Remove",
    };
  if (relType === 2)
    return {
      action: "Reject",
      title: "Reject request",
      body: (name: string) => `Reject the friend request from ${name}?`,
      confirm: "Reject",
    };
  return {
    action: "Cancel",
    title: "Cancel request",
    body: (name: string) => `Cancel your friend request to ${name}?`,
    confirm: "Cancel request",
  };
}

interface Props {
  onMenuClick: () => void;
  onSelectDm: (channelId: string) => void;
  /** Tab to open on (fixtures and deep links); defaults to Online. */
  initialTab?: Tab;
}

export default function FriendsView({
  onMenuClick,
  onSelectDm,
  initialTab = "online",
}: Props) {
  const { relationships } = useChatStore(
    useShallow((s) => ({
      relationships: s.relationships,
    })),
  );
  const { loadRelationships, openDm, setProfileUser } = useChatActions();
  const { menu, openMenu, closeMenu, shouldRender, isClosing } =
    useContextMenu();
  const isMobile = useIsMobile();
  const addStatusId = useId();

  const [state, dispatch] = useReducer(fvReducer, {
    tab: initialTab,
    loading: false,
    addFriendMode: false,
    addUsername: "",
    addStatus: null,
    popoverUser: null,
    popoverAnchor: null,
  });
  const [removeTarget, setRemoveTarget] = useState<RemoveTarget>(null);
  const [removing, setRemoving] = useState(false);

  const {
    tab,
    loading,
    addFriendMode,
    addUsername,
    addStatus,
    popoverUser,
    popoverAnchor,
  } = state;

  const fetchFriends = useCallback(async () => {
    dispatch({ type: "SET_LOADING", value: true });
    await loadRelationships();
    dispatch({ type: "SET_LOADING", value: false });
  }, [loadRelationships]);

  useEffect(() => {
    fetchFriends();
  }, [fetchFriends]);

  const handleAddFriend = useCallback(async () => {
    if (!addUsername.trim()) {
      dispatch({
        type: "SET_ADD_STATUS",
        value: { kind: "error", message: "Enter a username." },
      });
      return;
    }
    try {
      const data = await apiPost<{ type?: number }>("/api/friends", {
        username: addUsername.trim(),
      });
      dispatch({
        type: "SET_ADD_STATUS",
        value: {
          kind: "success",
          message: data.type === 0 ? "Friend added." : "Friend request sent.",
        },
      });
      dispatch({ type: "SET_ADD_USERNAME", value: "" });
      fetchFriends();
    } catch (err: any) {
      dispatch({
        type: "SET_ADD_STATUS",
        value: {
          kind: "error",
          message: err?.message || "Couldn't send the request. Try again.",
        },
      });
    }
  }, [addUsername, fetchFriends]);

  const handleAcceptFriend = useCallback(
    async (targetUserId: string) => {
      await apiPut("/api/friends", {
        target_user_id: targetUserId,
        action: "accept",
      });
      fetchFriends();
    },
    [fetchFriends],
  );

  const confirmRemove = useCallback(async () => {
    if (!removeTarget) return;
    setRemoving(true);
    try {
      await apiDelete("/api/friends", { target_user_id: removeTarget.user.id });
      setRemoveTarget(null);
      fetchFriends();
    } finally {
      setRemoving(false);
    }
  }, [removeTarget, fetchFriends]);

  const handleOpenDm = useCallback(
    async (targetUserId: string) => {
      const channelId = await openDm(targetUserId);
      if (channelId) onSelectDm(channelId);
    },
    [openDm, onSelectDm],
  );

  const handleFriendContextMenu = (
    e: React.MouseEvent,
    friend: any,
    relType: number,
  ) => {
    // Check if we should hide the call option (already in call or ringing this user)
    const callState = useCallStore.getState();
    const dmChannels = useChatStore.getState().dmChannels;
    const dmForUser = dmChannels.find(
      (d: any) => d.recipient?.id === friend.id,
    );

    const isRingingThisUser =
      callState.status === "ringing_outgoing" &&
      callState.remoteUser?.id === friend.id;
    const isInCallWithUser =
      callState.status === "active" &&
      dmForUser &&
      callState.channelId === dmForUser.id &&
      callState.hasJoinedSFU;
    const hideCallOption = isRingingThisUser || isInCallWithUser;

    openMenu(e, [
      {
        label: "Profile",
        icon: <Icon name="members" size="sm" />,
        onClick: () => setProfileUser(friend),
      },
      {
        label: "Message",
        icon: <Icon name="chat" size="sm" />,
        onClick: () => handleOpenDm(friend.id),
      },
      ...(!hideCallOption
        ? [
            {
              label: "Start a Call",
              icon: <Icon name="call" size="sm" />,
              onClick: async () => {
                const channelId = dmForUser?.id ?? (await openDm(friend.id));
                if (channelId) {
                  onSelectDm(channelId);
                  window.dispatchEvent(
                    new CustomEvent("request-start-call", {
                      detail: {
                        userId: friend.id,
                        displayName: friend.display_name ?? friend.username,
                        channelId,
                      },
                    }),
                  );
                }
              },
            },
          ]
        : []),
      ...(relType !== 1
        ? [
            {
              label: removeCopy(relType).action,
              icon: <Icon name="close" size="sm" />,
              onClick: () => setRemoveTarget({ user: friend, relType }),
              variant: "danger" as const,
            },
          ]
        : []),
    ]);
  };

  // Long-press on touch opens the same menu as right-click (9.5).
  const bindLongPress = useLongPress<{ user: any; relType: number }>(
    (info, rel) =>
      handleFriendContextMenu(toContextMenuEvent(info), rel.user, rel.relType),
  );

  const filteredFriends = relationships.filter((f) => {
    if (tab === "online") return f.type === 0 && f.user.status === "online";
    if (tab === "all") return f.type === 0;
    if (tab === "pending") return f.type === 2 || f.type === 3;
    if (tab === "blocked") return f.type === 1;
    return false;
  });

  const pendingCount = relationships.filter((f) => f.type === 2).length;

  const toggleAddFriend = () =>
    dispatch({ type: "SET_ADD_FRIEND_MODE", value: !addFriendMode });

  // One tab list, placed inline in the header on desktop and in its own
  // swipeable strip under the header on phones (it doesn't fit beside the
  // title at 390).
  const tabs = (
    <Tabs
      label="Friends"
      idBase="friends"
      panelId="friends-panel"
      scrollable
      className={isMobile ? "h-11 gap-6 px-4" : "h-full min-w-0 self-stretch"}
      value={tab}
      onValueChange={(t) => dispatch({ type: "SET_TAB", value: t })}
      items={FRIEND_TABS.map((t) => ({
        value: t,
        label: TAB_LABEL[t],
        adornment:
          t === "pending" && pendingCount > 0 ? (
            <span className="badge-count">{pendingCount}</span>
          ) : undefined,
      }))}
    />
  );

  const empty = EMPTY[tab];
  const removal = removeTarget ? removeCopy(removeTarget.relType) : null;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-rm-bg-primary">
      {/* Header (12.1 / 12.2): 48px + safe area. */}
      <header
        data-testid="friends-header"
        className="z-20 flex h-[calc(48px+var(--safe-area-top,0px))] shrink-0 items-center gap-2 border-b border-rm-border bg-rm-bg-primary px-4 pt-[var(--safe-area-top,0px)] max-md:pl-2"
      >
        <IconButton
          icon="menu"
          variant="muted"
          size="md"
          className="md:hidden"
          aria-label="Open sidebar"
          onClick={onMenuClick}
        />

        <Icon
          name="members"
          size="lg"
          className="shrink-0 text-rm-text-muted max-md:hidden"
        />
        <h1 className="shrink-0 text-ui-md font-semibold whitespace-nowrap text-rm-text">
          Friends
        </h1>

        {!isMobile && (
          <>
            <div aria-hidden className="mx-2 h-5 w-px shrink-0 bg-rm-border" />
            {tabs}
          </>
        )}

        <div className="ml-auto flex shrink-0 items-center">
          {isMobile ? (
            <IconButton
              icon="invite"
              size="md"
              variant="ghost"
              aria-label="Add Friend"
              aria-pressed={addFriendMode}
              onClick={toggleAddFriend}
            />
          ) : (
            <Button
              variant={addFriendMode ? "secondary" : "ghost"}
              size="sm"
              aria-pressed={addFriendMode}
              onClick={toggleAddFriend}
            >
              <Icon name="invite" size="sm" />
              Add Friend
            </Button>
          )}
        </div>
      </header>

      {isMobile && (
        <div
          data-testid="friends-tab-strip"
          className="shrink-0 border-b border-rm-border"
        >
          {tabs}
        </div>
      )}

      {/* Add friend form */}
      {addFriendMode && (
        <form
          className="flex shrink-0 flex-col gap-2 border-b border-rm-border px-4 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            void handleAddFriend();
          }}
        >
          <Label htmlFor="friend-username">Add Friend</Label>
          <p className="text-ui-xs text-rm-text-secondary">
            You can add friends by their username.
          </p>
          <div className="flex max-w-lg gap-2">
            <Input
              id="friend-username"
              name="username"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              className="flex-1 max-md:min-h-11 max-md:text-ui-md"
              placeholder="Enter a username"
              value={addUsername}
              aria-invalid={addStatus?.kind === "error" || undefined}
              aria-describedby={addStatus ? addStatusId : undefined}
              onChange={(e) => {
                dispatch({ type: "SET_ADD_USERNAME", value: e.target.value });
                if (addStatus?.kind === "error")
                  dispatch({ type: "SET_ADD_STATUS", value: null });
              }}
            />
            <Button type="submit" className="max-md:min-h-11">
              Send Request
            </Button>
          </div>
          <p
            id={addStatusId}
            role="status"
            className={cn(
              "min-h-4 text-ui-xs",
              addStatus?.kind === "error"
                ? "text-rm-danger-ink"
                : "text-rm-success-ink",
            )}
          >
            {addStatus?.message}
          </p>
        </form>
      )}

      {/* Friends list */}
      <div
        id="friends-panel"
        role="tabpanel"
        aria-labelledby={tabId("friends", tab)}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain custom-scrollbar"
      >
        <h2 className="px-4 pt-4 pb-2 text-ui-2xs font-semibold tracking-[0.08em] text-rm-text-muted uppercase">
          {LIST_LABEL[tab]} — {filteredFriends.length}
        </h2>

        {loading && filteredFriends.length === 0 && (
          <div
            role="status"
            className="flex items-center justify-center gap-2 py-12 text-rm-text-secondary"
          >
            <Icon name="loader" size="md" className="animate-spin" />
            <span className="text-ui-sm">Loading friends…</span>
          </div>
        )}

        {!loading && filteredFriends.length === 0 && (
          <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <Icon
              name={empty.icon}
              size={isMobile ? "2xl" : "3xl"}
              className="text-rm-text-muted"
            />
            <p className="text-ui-md font-semibold text-balance text-rm-text">
              {empty.title}
            </p>
            {empty.body && (
              <p className="max-w-[36ch] text-ui-sm text-pretty text-rm-text-secondary">
                {empty.body}
              </p>
            )}
            {tab === "all" && !addFriendMode && (
              <Button variant="secondary" onClick={toggleAddFriend}>
                Add Friend
              </Button>
            )}
          </div>
        )}

        {filteredFriends.length > 0 && (
          <ul className="flex flex-col pb-4 md:gap-0.5 md:px-2">
            {filteredFriends.map((rel) => {
              const displayName = getDisplayName(rel.user);
              const remove = removeCopy(rel.type);
              return (
                <li
                  key={rel.user.id}
                  data-testid="friend-row"
                  className={cn(
                    "group relative flex min-h-12 items-center gap-3 px-4 py-1.5 transition-colors duration-150 ease-(--rm-ease-out) md:min-h-14 md:rounded-md md:px-2 pointer-fine:hover:bg-rm-tint-1",
                    LONG_PRESS_TARGET,
                  )}
                >
                  <ButtonBase
                    onClick={() => handleOpenDm(rel.user.id)}
                    onContextMenu={(e) =>
                      handleFriendContextMenu(e, rel.user, rel.type)
                    }
                    {...bindLongPress({ user: rel.user, relType: rel.type })}
                    aria-label={`Message ${displayName}`}
                    className="absolute inset-0 z-10 outline-none md:rounded-md"
                  />
                  {/* Avatar */}
                  <ButtonBase
                    className={cn(
                      "relative z-20 shrink-0 cursor-pointer rounded-full outline-none",
                      HIT,
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      dispatch({
                        type: "SET_POPOVER",
                        user: rel.user,
                        anchor: e.currentTarget,
                      });
                    }}
                    aria-label={`View ${displayName}'s profile`}
                  >
                    <span className="relative flex size-10 items-center justify-center overflow-visible rounded-full bg-rm-accent-tint text-ui-sm font-semibold text-rm-accent-ink ring-1 ring-rm-border">
                      {rel.user.avatar_url ? (
                        <AvatarImage
                          src={getAuthAssetUrl(rel.user.avatar_url)}
                          alt=""
                          display={rel.user.avatar_display}
                        />
                      ) : (
                        getDisplayInitial(rel.user)
                      )}
                    </span>
                    <UserStatusDot
                      status={rel.user.status ?? "offline"}
                      className="absolute -right-0.5 -bottom-0.5 size-3.5 border-2 border-rm-bg-primary"
                    />
                  </ButtonBase>

                  {/* Info */}
                  <div className="min-w-0 flex-1">
                    <UserDisplayName
                      user={rel.user}
                      className="block truncate text-ui-base font-medium text-rm-text"
                    />
                    <span className="block truncate text-ui-xs text-rm-text-secondary">
                      {relationLabel(rel)}
                    </span>
                  </div>

                  {/* Actions: revealed on hover/focus for fine pointers,
                      always visible on touch. */}
                  <div
                    className={cn("relative z-20 flex shrink-0 gap-2", REVEAL)}
                  >
                    {rel.type === 0 && (
                      <IconButton
                        icon="chat"
                        size="sm"
                        shape="circle"
                        tooltip="Message"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenDm(rel.user.id);
                        }}
                      />
                    )}
                    {rel.type === 2 && (
                      <IconButton
                        icon="check"
                        size="sm"
                        shape="circle"
                        className="text-rm-success-ink"
                        tooltip="Accept"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAcceptFriend(rel.user.id);
                        }}
                      />
                    )}
                    {rel.type !== 1 && (
                      <IconButton
                        icon="close"
                        size="sm"
                        shape="circle"
                        variant="destructive"
                        tooltip={remove.action}
                        onClick={(e) => {
                          e.stopPropagation();
                          setRemoveTarget({
                            user: rel.user,
                            relType: rel.type,
                          });
                        }}
                      />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <ResponsiveDialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open && !removing) setRemoveTarget(null);
        }}
      >
        <ResponsiveDialogContent className="md:max-w-sm">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{removal?.title}</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              {removeTarget && removal
                ? removal.body(getDisplayName(removeTarget.user))
                : null}
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <ResponsiveDialogFooter>
            <Button
              variant="secondary"
              disabled={removing}
              onClick={() => setRemoveTarget(null)}
            >
              Keep
            </Button>
            <Button
              variant="danger"
              loading={removing}
              onClick={() => void confirmRemove()}
            >
              {removal?.confirm}
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {shouldRender && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menu.items}
          onClose={closeMenu}
          isClosing={isClosing}
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
