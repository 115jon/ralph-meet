import { getDisplayInitial, getDisplayName } from "@/lib/display-name";
import { ButtonBase } from "@/components/ui/button-base";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/IconButton";
import { Input } from "@/components/ui/input";
import { Tabs, tabId } from "@/components/ui/tabs";
import { useContextMenu } from "@/hooks/useContextMenu";
import { apiDelete, apiPost, apiPut } from "@/lib/api-client";
import { getAuthAssetUrl } from "@/lib/platform";
import { DitherField } from "@/components/ui/DitherField";
import { cn } from "@/lib/utils";
import { UserStatusDot } from "./UserStatusDot";
import { useChatActions, useChatStore } from "@/stores/chat-store";
import { useCallStore } from "@/stores/useCallStore";
import { useCallback, useEffect, useReducer } from "react";
import { useShallow } from "zustand/shallow";
import ContextMenu from "./ContextMenu";
import { AvatarImage } from "./AvatarImage";
import {
  Ban,
  Check,
  Menu,
  MessageSquare,
  Phone,
  UserPlus,
  Users,
  X,
} from "./Icons";
import { UserDisplayName } from "./UserDisplayName";
import UserProfilePopover from "./UserProfilePopover";

type Tab = "online" | "all" | "pending" | "blocked";
const FRIEND_TABS: readonly Tab[] = ["online", "all", "pending", "blocked"];

interface FriendsViewState {
  tab: Tab;
  loading: boolean;
  addFriendMode: boolean;
  addUsername: string;
  addStatus: string | null;
  popoverUser: any | null;
  popoverAnchor: HTMLElement | null;
}

type FVAction =
  | { type: "SET_TAB"; value: Tab }
  | { type: "SET_LOADING"; value: boolean }
  | { type: "SET_ADD_FRIEND_MODE"; value: boolean }
  | { type: "SET_ADD_USERNAME"; value: string }
  | { type: "SET_ADD_STATUS"; value: string | null }
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

interface Props {
  onMenuClick: () => void;
  onSelectDm: (channelId: string) => void;
}

export default function FriendsView({ onMenuClick, onSelectDm }: Props) {
  const { relationships } = useChatStore(
    useShallow((s) => ({
      relationships: s.relationships,
    })),
  );
  const { loadRelationships, openDm, setProfileUser } = useChatActions();
  const { menu, openMenu, closeMenu, shouldRender, isClosing } =
    useContextMenu();

  const [state, dispatch] = useReducer(fvReducer, {
    tab: "online",
    loading: false,
    addFriendMode: false,
    addUsername: "",
    addStatus: null,
    popoverUser: null,
    popoverAnchor: null,
  });

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
    if (!addUsername.trim()) return;
    try {
      const data = await apiPost<{ type?: number }>("/api/friends", {
        username: addUsername.trim(),
      });
      dispatch({
        type: "SET_ADD_STATUS",
        value: data.type === 0 ? "Friend added!" : "Friend request sent!",
      });
      dispatch({ type: "SET_ADD_USERNAME", value: "" });
      fetchFriends();
    } catch (err: any) {
      dispatch({
        type: "SET_ADD_STATUS",
        value: err.message || "Failed to send request",
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

  const handleRemoveFriend = useCallback(
    async (targetUserId: string) => {
      if (!window.confirm("Are you sure you want to remove this friend?"))
        return;
      await apiDelete("/api/friends", { target_user_id: targetUserId });
      fetchFriends();
    },
    [fetchFriends],
  );

  const handleOpenDm = useCallback(
    async (targetUserId: string) => {
      const channelId = await openDm(targetUserId);
      if (channelId) onSelectDm(channelId);
    },
    [openDm, onSelectDm],
  );

  const handleFriendContextMenu = (e: React.MouseEvent, friend: any) => {
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
        icon: <Users className="h-4 w-4" />,
        onClick: () => setProfileUser(friend),
      },
      {
        label: "Message",
        icon: <MessageSquare className="h-4 w-4" />,
        onClick: () => handleOpenDm(friend.id),
      },
      ...(!hideCallOption
        ? [
            {
              label: "Start a Call",
              icon: <Phone className="h-4 w-4" />,
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
      {
        label: "Remove Friend",
        icon: <X className="h-4 w-4" />,
        onClick: () => handleRemoveFriend(friend.id),
        variant: "danger",
      },
    ]);
  };

  const filteredFriends = relationships.filter((f) => {
    if (tab === "online") return f.type === 0 && f.user.status === "online";
    if (tab === "all") return f.type === 0;
    if (tab === "pending") return f.type === 2 || f.type === 3;
    if (tab === "blocked") return f.type === 1;
    return false;
  });

  const pendingCount = relationships.filter((f) => f.type === 2).length;

  return (
    <div className="flex flex-1 flex-col bg-rm-bg-primary relative overflow-hidden">
      {/* Header */}
      <header className="h-12 flex shrink-0 items-center gap-3 border-b border-rm-border bg-rm-bg-primary px-4 z-10">
        <IconButton
          icon={Menu}
          variant="muted"
          size="sm"
          className="md:hidden"
          aria-label="Open sidebar"
          onClick={onMenuClick}
        />

        <Users aria-hidden className="h-5 w-5 text-rm-text-muted" />
        <span className="text-ui-sm font-semibold text-rm-text">Friends</span>

        <div aria-hidden className="h-5 w-px bg-rm-border mx-1" />

        <Tabs
          label="Friends"
          idBase="friends"
          panelId="friends-panel"
          className="h-full self-stretch"
          value={tab}
          onValueChange={(t) => dispatch({ type: "SET_TAB", value: t })}
          items={FRIEND_TABS.map((t) => ({
            value: t,
            label: t.charAt(0).toUpperCase() + t.slice(1),
            adornment:
              t === "pending" && pendingCount > 0 ? (
                <span className="badge-count">{pendingCount}</span>
              ) : undefined,
          }))}
        />

        <Button
          variant={addFriendMode ? "secondary" : "ghost"}
          size="sm"
          className="ml-auto"
          aria-pressed={addFriendMode}
          onClick={() =>
            dispatch({ type: "SET_ADD_FRIEND_MODE", value: !addFriendMode })
          }
        >
          <UserPlus aria-hidden />
          Add Friend
        </Button>
      </header>

      {/* Add friend form */}
      {addFriendMode && (
        <div className="border-b border-rm-border px-6 py-4 bg-rm-bg-primary">
          <p className="mb-1 text-sm font-medium text-rm-text">Add Friend</p>
          <p className="mb-3 text-xs text-rm-text-muted">
            You can add friends by their username.
          </p>
          <div className="flex gap-2 max-w-lg">
            <Input
              className="flex-1"
              aria-label="Friend username"
              placeholder="Enter a username"
              value={addUsername}
              onChange={(e) =>
                dispatch({ type: "SET_ADD_USERNAME", value: e.target.value })
              }
              onKeyDown={(e) => e.key === "Enter" && handleAddFriend()}
            />
            <Button
              size="lg"
              className="h-9"
              onClick={handleAddFriend}
              disabled={!addUsername.trim()}
            >
              Send Request
            </Button>
          </div>
          {addStatus && (
            <p className="mt-2 text-xs text-primary">{addStatus}</p>
          )}
        </div>
      )}

      {/* Friend count label */}
      <div className="px-6 py-3 border-b border-rm-border/50">
        <span className="text-ui-2xs font-semibold uppercase tracking-[0.08em] text-rm-text-muted">
          {tab === "online"
            ? "Online"
            : tab === "all"
              ? "All Friends"
              : tab === "pending"
                ? "Pending"
                : "Blocked"}{" "}
          — {filteredFriends.length}
        </span>
      </div>

      {/* Friends list */}
      <div
        id="friends-panel"
        role="tabpanel"
        aria-labelledby={tabId("friends", tab)}
        className="flex-1 overflow-y-auto custom-scrollbar"
      >
        <div className="px-4 py-1">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-12 text-primary/60">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <span className="text-sm font-medium">Loading friends...</span>
            </div>
          )}

          {!loading && filteredFriends.length === 0 && (
            <div className="mx-auto mt-16 flex w-full max-w-[360px] flex-col items-center gap-1 text-center">
              <div className="relative mb-4 flex h-16 w-16 items-center justify-center overflow-hidden rounded-lg border border-rm-border shadow-sm">
                <DitherField cell={4} intensity={0.55} seed={3} />
                {tab === "pending" ? (
                  <UserPlus className="relative z-10 h-7 w-7 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]" />
                ) : tab === "blocked" ? (
                  <Ban className="relative z-10 h-7 w-7 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]" />
                ) : (
                  <Users className="relative z-10 h-7 w-7 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]" />
                )}
              </div>
              <span className="text-ui-lg font-semibold text-rm-text text-balance">
                {tab === "online"
                  ? "No friends online"
                  : tab === "all"
                    ? "No friends yet"
                    : tab === "pending"
                      ? "No pending requests"
                      : "No blocked users"}
              </span>
              {tab === "all" && (
                <span className="text-ui-sm text-rm-text-muted text-pretty">
                  Add friends using the button above to get started
                </span>
              )}
            </div>
          )}

          {!loading &&
            filteredFriends.map((rel) =>
              (() => {
                const displayName = getDisplayName(rel.user);
                return (
                  <div
                    key={rel.user.id}
                    className="group relative flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 outline-none pointer-fine:hover:bg-rm-tint-1"
                  >
                    <ButtonBase
                      onClick={() => handleOpenDm(rel.user.id)}
                      onContextMenu={(e) =>
                        handleFriendContextMenu(e, rel.user)
                      }
                      aria-label={`Message ${displayName}`}
                      className="absolute inset-0 z-10 rounded-lg outline-none"
                    />
                    {/* Avatar */}
                    <ButtonBase
                      className="relative z-20 shrink-0 cursor-pointer outline-none"
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
                      <div className="flex h-10 w-10 items-center justify-center overflow-visible rounded-full bg-primary text-sm font-bold text-primary-foreground ring-1 ring-white/10 group-hover:ring-white/20 transition-ui relative">
                        {rel.user.avatar_url ? (
                          <AvatarImage
                            src={getAuthAssetUrl(rel.user.avatar_url)}
                            alt=""
                            display={rel.user.avatar_display}
                          />
                        ) : (
                          getDisplayInitial(rel.user)
                        )}
                      </div>
                      <UserStatusDot
                        status={rel.user.status ?? "offline"}
                        className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 border-[2.5px] border-rm-bg-primary transition-colors"
                      />
                    </ButtonBase>

                    {/* Info */}
                    <div className="min-w-0 flex-1">
                      <UserDisplayName
                        user={rel.user}
                        className="block truncate text-sm font-medium text-rm-text"
                      />
                      <span className="text-xs text-rm-text-muted">
                        {rel.type === 0
                          ? rel.user.status === "online"
                            ? "Online"
                            : rel.user.status === "idle"
                              ? "Idle"
                              : rel.user.status === "dnd"
                                ? "Do Not Disturb"
                                : "Offline"
                          : rel.type === 2
                            ? "Incoming friend request"
                            : rel.type === 3
                              ? "Outgoing friend request"
                              : "Blocked"}
                      </span>
                    </div>

                    {/* Actions */}
                    <div className="relative z-20 flex gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100">
                      {rel.type === 0 && (
                        <IconButton
                          icon={MessageSquare}
                          iconSize={16}
                          size="sm"
                          shape="circle"
                          title="Message"
                          aria-label="Message"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenDm(rel.user.id);
                          }}
                        />
                      )}
                      {rel.type === 2 && (
                        <IconButton
                          icon={Check}
                          iconSize={16}
                          size="sm"
                          shape="circle"
                          className="text-rm-success-ink"
                          title="Accept"
                          aria-label="Accept"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAcceptFriend(rel.user.id);
                          }}
                        />
                      )}
                      <IconButton
                        icon={X}
                        iconSize={16}
                        size="sm"
                        shape="circle"
                        variant="destructive"
                        title={
                          rel.type === 0
                            ? "Remove Friend"
                            : rel.type === 2
                              ? "Reject"
                              : "Cancel"
                        }
                        aria-label={
                          rel.type === 0
                            ? "Remove Friend"
                            : rel.type === 2
                              ? "Reject"
                              : "Cancel"
                        }
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveFriend(rel.user.id);
                        }}
                      />
                    </div>
                  </div>
                );
              })(),
            )}
        </div>
      </div>

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
