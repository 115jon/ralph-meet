import { getDisplayInitial, getDisplayName } from "@/lib/display-name";
import { useContextMenu } from "@/hooks/useContextMenu";
import { apiDelete, apiPost, apiPut } from "@/lib/api-client";
import { getAuthAssetUrl } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { useChatActions, useChatStore } from "@/stores/chat-store";
import { useCallStore } from "@/stores/useCallStore";
import { useCallback, useEffect, useReducer } from "react";
import { useShallow } from "zustand/shallow";
import ContextMenu from "./ContextMenu";
import { Ban, Check, Menu, MessageSquare, Phone, UserPlus, Users, X } from "./Icons";
import UserProfilePopover from "./UserProfilePopover";

type Tab = "online" | "all" | "pending" | "blocked";

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
    case "SET_TAB": return { ...s, tab: a.value };
    case "SET_LOADING": return { ...s, loading: a.value };
    case "SET_ADD_FRIEND_MODE": return { ...s, addFriendMode: a.value };
    case "SET_ADD_USERNAME": return { ...s, addUsername: a.value };
    case "SET_ADD_STATUS": return { ...s, addStatus: a.value };
    case "SET_POPOVER": return { ...s, popoverUser: a.user, popoverAnchor: a.anchor };
    default: return s;
  }
}

interface Props {
  onMenuClick: () => void;
  onSelectDm: (channelId: string) => void;
}

export default function FriendsView({ onMenuClick, onSelectDm }: Props) {
  const { relationships } = useChatStore(useShallow(s => ({
    relationships: s.relationships,
  })));
  const { loadRelationships, openDm, setProfileUser } = useChatActions();
  const { menu, openMenu, closeMenu, shouldRender, isClosing } = useContextMenu();

  const [state, dispatch] = useReducer(fvReducer, {
    tab: "online",
    loading: false,
    addFriendMode: false,
    addUsername: "",
    addStatus: null,
    popoverUser: null,
    popoverAnchor: null,
  });

  const { tab, loading, addFriendMode, addUsername, addStatus, popoverUser, popoverAnchor } = state;

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
      const data = await apiPost<{ type?: number }>("/api/friends", { username: addUsername.trim() });
      dispatch({ type: "SET_ADD_STATUS", value: data.type === 0 ? "Friend added!" : "Friend request sent!" });
      dispatch({ type: "SET_ADD_USERNAME", value: "" });
      fetchFriends();
    } catch (err: any) {
      dispatch({ type: "SET_ADD_STATUS", value: err.message || "Failed to send request" });
    }
  }, [addUsername, fetchFriends]);

  const handleAcceptFriend = useCallback(async (targetUserId: string) => {
    await apiPut("/api/friends", { target_user_id: targetUserId, action: "accept" });
    fetchFriends();
  }, [fetchFriends]);

  const handleRemoveFriend = useCallback(async (targetUserId: string) => {
    if (!window.confirm("Are you sure you want to remove this friend?")) return;
    await apiDelete("/api/friends", { target_user_id: targetUserId });
    fetchFriends();
  }, [fetchFriends]);

  const handleOpenDm = useCallback(async (targetUserId: string) => {
    const channelId = await openDm(targetUserId);
    if (channelId) onSelectDm(channelId);
  }, [openDm, onSelectDm]);

  const handleFriendContextMenu = (e: React.MouseEvent, friend: any) => {
    // Check if we should hide the call option (already in call or ringing this user)
    const callState = useCallStore.getState();
    const dmChannels = useChatStore.getState().dmChannels;
    const dmForUser = dmChannels.find((d: any) => d.recipient?.id === friend.id);

    const isRingingThisUser =
      callState.status === "ringing_outgoing" && callState.remoteUser?.id === friend.id;
    const isInCallWithUser =
      callState.status === "active" && dmForUser && callState.channelId === dmForUser.id && callState.hasJoinedSFU;
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
      ...(!hideCallOption ? [{
        label: "Start a Call",
        icon: <Phone className="h-4 w-4" />,
        onClick: async () => {
          const channelId = dmForUser?.id ?? await openDm(friend.id);
          if (channelId) {
            onSelectDm(channelId);
            window.dispatchEvent(new CustomEvent("request-start-call", {
              detail: {
                userId: friend.id,
                displayName: friend.display_name ?? friend.username,
                channelId,
              }
            }));
          }
        },
      }] : []),
      {
        label: "Remove Friend",
        icon: <X className="h-4 w-4" />,
        onClick: () => handleRemoveFriend(friend.id),
        variant: "danger",
      }
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
      <header className="h-12 flex shrink-0 items-center gap-3 border-b border-rm-border bg-rm-bg-primary/60 px-4 z-10 backdrop-blur-md">
        <button
          className="cursor-pointer border-none bg-transparent p-1 text-rm-text-muted transition-colors hover:text-rm-text md:hidden"
          onClick={onMenuClick}
        >
          <Menu className="h-5 w-5" />
        </button>

        <Users className="h-5 w-5 text-rm-text-muted" />
        <span className="text-sm font-semibold text-rm-text">Friends</span>

        <div className="h-5 w-px bg-rm-border mx-1" />

        {/* Tabs in header */}
        {(["online", "all", "pending", "blocked"] as Tab[]).map((t) => (
          <button
            key={t}
            className={cn(
              "relative cursor-pointer rounded-md border-none px-3 py-1 text-[13px] font-medium transition-colors outline-none",
              tab === t
                ? "bg-rm-bg-elevated text-rm-text"
                : "text-rm-text-muted hover:bg-rm-bg-elevated/50 hover:text-rm-text-secondary"
            )}
            onClick={() => dispatch({ type: "SET_TAB", value: t })}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
            {t === "pending" && pendingCount > 0 && (
              <span className="ml-1.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
                {pendingCount}
              </span>
            )}
          </button>
        ))}

        <button
          className={cn(
            "ml-auto cursor-pointer rounded-md border-none px-3 py-1.5 text-[13px] font-medium transition-colors outline-none",
            addFriendMode
              ? "bg-primary/20 text-primary"
              : "text-primary hover:bg-primary/10"
          )}
          onClick={() => dispatch({ type: "SET_ADD_FRIEND_MODE", value: !addFriendMode })}
        >
          <UserPlus className="mr-1.5 inline h-4 w-4" />
          Add Friend
        </button>
      </header>

      {/* Add friend form */}
      {addFriendMode && (
        <div className="border-b border-rm-border px-6 py-4 bg-rm-bg-primary">
          <p className="mb-1 text-sm font-medium text-rm-text">Add Friend</p>
          <p className="mb-3 text-xs text-rm-text-muted">You can add friends by their username.</p>
          <div className="flex gap-2 max-w-lg">
            <input
              className="flex-1 rounded-lg border border-rm-border bg-rm-bg-surface px-4 py-2 text-sm text-rm-text outline-none transition-all placeholder:text-rm-text-muted/30 focus:border-primary/30 focus:ring-2 focus:ring-primary/20"
              aria-label="Friend username"
              placeholder="Enter a username"
              value={addUsername}
              onChange={(e) => dispatch({ type: "SET_ADD_USERNAME", value: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && handleAddFriend()}
            />
            <button
              className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:brightness-110 disabled:opacity-40"
              onClick={handleAddFriend}
              disabled={!addUsername.trim()}
            >
              Send Request
            </button>
          </div>
          {addStatus && (
            <p className="mt-2 text-xs text-primary">{addStatus}</p>
          )}
        </div>
      )}

      {/* Friend count label */}
      <div className="px-6 py-3 border-b border-rm-border/50">
        <span className="text-[11px] font-bold uppercase tracking-widest text-rm-text-muted">
          {tab === "online" ? "Online" : tab === "all" ? "All Friends" : tab === "pending" ? "Pending" : "Blocked"} — {filteredFriends.length}
        </span>
      </div>

      {/* Friends list */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <div className="px-4 py-1">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-12 text-primary/60">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <span className="text-sm font-medium">Loading friends...</span>
            </div>
          )}

          {!loading && filteredFriends.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              {tab === "pending" ? <UserPlus className="h-12 w-12 text-rm-text-muted/20" /> :
                tab === "blocked" ? <Ban className="h-12 w-12 text-rm-text-muted/20" /> :
                  <Users className="h-12 w-12 text-rm-text-muted/20" />}
              <span className="text-base font-semibold text-rm-text-muted/60">
                {tab === "online" ? "No friends online" :
                  tab === "all" ? "No friends yet" :
                    tab === "pending" ? "No pending requests" :
                      "No blocked users"}
              </span>
              {tab === "all" && (
                <span className="text-xs text-rm-text-muted/40">
                  Add friends using the button above to get started
                </span>
              )}
            </div>
          )}

          {!loading && filteredFriends.map((rel) => (
            (() => {
              const displayName = getDisplayName(rel.user);
              return (
            <div
              key={rel.user.id}
              className="group flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-rm-bg-elevated/60 border-b border-rm-border/30 outline-none"
              onClick={() => handleOpenDm(rel.user.id)}
              onContextMenu={(e) => handleFriendContextMenu(e, rel.user)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleOpenDm(rel.user.id);
                }
              }}
              role="button"
              tabIndex={0}
            >
              {/* Avatar */}
              <button
                type="button"
                className="relative shrink-0 cursor-pointer outline-none"
                onClick={(e) => {
                  e.stopPropagation();
                  dispatch({ type: "SET_POPOVER", user: rel.user, anchor: e.currentTarget });
                }}
                aria-label={`View ${displayName}'s profile`}
              >
                <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-primary text-sm font-bold text-primary-foreground ring-1 ring-white/10 group-hover:ring-white/20 transition-all relative">
                  {rel.user.avatar_url ? (
                    <img
                      src={getAuthAssetUrl(rel.user.avatar_url)}
                      alt=""
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                  ) : (
                    getDisplayInitial(rel.user)
                  )}
                </div>
                <div className={cn(
                  "absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-[2.5px] border-rm-bg-primary transition-colors",
                  rel.user.status === "online" ? "bg-emerald-500" :
                    rel.user.status === "idle" ? "bg-amber-500" :
                      rel.user.status === "dnd" ? "bg-rose-500" : "bg-zinc-500"
                )} />
              </button>

              {/* Info */}
              <div className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-rm-text">{displayName}</span>
                <span className="text-xs text-rm-text-muted">
                  {rel.type === 0 ? (
                    rel.user.status === "online" ? "Online" :
                      rel.user.status === "idle" ? "Idle" :
                        rel.user.status === "dnd" ? "Do Not Disturb" : "Offline"
                  ) :
                    rel.type === 2 ? "Incoming friend request" :
                      rel.type === 3 ? "Outgoing friend request" : "Blocked"}
                </span>
              </div>

              {/* Actions */}
              <div className="flex gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                {rel.type === 0 && (
                  <button
                    className="cursor-pointer rounded-full p-2 text-rm-text-muted transition-colors hover:bg-rm-bg-elevated hover:text-rm-text outline-none"
                    title="Message"
                    onClick={(e) => { e.stopPropagation(); handleOpenDm(rel.user.id); }}
                  >
                    <MessageSquare className="h-4 w-4" />
                  </button>
                )}
                {rel.type === 2 && (
                  <button
                    className="cursor-pointer rounded-full p-2 text-emerald-400/60 transition-colors hover:bg-emerald-500/10 hover:text-emerald-400 outline-none"
                    title="Accept"
                    onClick={(e) => { e.stopPropagation(); handleAcceptFriend(rel.user.id); }}
                  >
                    <Check className="h-4 w-4" />
                  </button>
                )}
                <button
                  className="cursor-pointer rounded-full p-2 text-rm-text-muted/40 transition-colors hover:bg-rose-500/10 hover:text-rose-400 outline-none"
                  title={rel.type === 0 ? "Remove Friend" : rel.type === 2 ? "Reject" : "Cancel"}
                  onClick={(e) => { e.stopPropagation(); handleRemoveFriend(rel.user.id); }}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
              );
            })()
          ))}
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
          anchorEl={popoverAnchor}
          side="right"
          onClose={() => dispatch({ type: "SET_POPOVER", user: null, anchor: null })}
        />
      )}
    </div>
  );
}
