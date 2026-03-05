
import { useContextMenu } from "@/hooks/useContextMenu";
import { apiDelete, apiPost, apiPut } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useChatActions, useChatState } from "@/stores/chat-store";

import { useCallback, useEffect, useReducer } from "react";
import ContextMenu from "./ContextMenu";
import { Ban, Check, Copy, MessageSquare, Trash2, User as UserIcon, UserPlus, Users, X } from "./Icons";
import UserProfilePopover from "./UserProfilePopover";

interface Props {
  activeChannelId: string | null;
  onSelectDm: (channelId: string) => void;
}

type Tab = "online" | "all" | "pending" | "blocked";

interface UIState {
  tab: Tab;
  loading: boolean;
  addFriendMode: boolean;
  addUsername: string;
  addStatus: string | null;
  showFriends: boolean;
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

export default function DMSidebar({ activeChannelId, onSelectDm }: Props) {
  const state = useChatState();
  const { loadDmChannels, openDm, loadRelationships, setProfileUser } = useChatActions();
  const { menu, openMenu, closeMenu } = useContextMenu();

  const [uiState, dispatch] = useReducer((s: UIState, a: any): UIState => {
    switch (a.type) {
      case 'SET_TAB': return { ...s, tab: a.value };
      case 'SET_LOADING': return { ...s, loading: a.value };
      case 'SET_ADD_FRIEND_MODE': return { ...s, addFriendMode: a.value };
      case 'SET_ADD_USERNAME': return { ...s, addUsername: a.value };
      case 'SET_ADD_STATUS': return { ...s, addStatus: a.value };
      case 'SET_SHOW_FRIENDS': return { ...s, showFriends: a.value };
      case 'SET_POPOVER': return { ...s, popoverUser: a.user, popoverAnchor: a.anchor };
      default: return s;
    }
  }, {
    tab: "online",
    loading: false,
    addFriendMode: false,
    addUsername: "",
    addStatus: null,
    showFriends: false,
    popoverUser: null,
    popoverAnchor: null,
  });

  const { tab, loading, addFriendMode, addUsername, addStatus, showFriends, popoverUser, popoverAnchor } = uiState;

  useEffect(() => {
    loadDmChannels();
  }, [loadDmChannels]);

  const fetchFriends = useCallback(async () => {
    dispatch({ type: 'SET_LOADING', value: true });
    await loadRelationships();
    dispatch({ type: 'SET_LOADING', value: false });
  }, [loadRelationships]);

  const toggleFriends = useCallback((show: boolean) => {
    dispatch({ type: 'SET_SHOW_FRIENDS', value: show });
    if (show) fetchFriends();
  }, [fetchFriends]);

  const handleAddFriend = useCallback(async () => {
    if (!addUsername.trim()) return;
    try {
      const data = await apiPost<{ type?: number }>("/api/friends", { username: addUsername.trim() });
      dispatch({ type: 'SET_ADD_STATUS', value: data.type === 0 ? "Friend added!" : "Friend request sent!" });
      dispatch({ type: 'SET_ADD_USERNAME', value: "" });
      fetchFriends();
    } catch (err: any) {
      dispatch({ type: 'SET_ADD_STATUS', value: err.message || "Failed to send request" });
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
      }
    ]);
  };

  const handleFriendContextMenu = (e: React.MouseEvent, friend: any) => {
    openMenu(e, [
      {
        label: "Profile",
        icon: <UserIcon className="h-4 w-4" />,
        onClick: () => setProfileUser(friend),
      },
      {
        label: "Message",
        icon: <MessageSquare className="h-4 w-4" />,
        onClick: () => handleOpenDm(friend.id),
      },
      {
        label: "Copy ID",
        icon: <Copy className="h-4 w-4" />,
        onClick: () => navigator.clipboard.writeText(friend.id),
        divider: true,
      },
      {
        label: "Remove Friend",
        icon: <Trash2 className="h-4 w-4" />,
        onClick: () => handleRemoveFriend(friend.id),
        variant: "danger",
      }
    ]);
  };

  const filteredFriends = state.relationships.filter((f) => {
    if (tab === "online") return f.type === 0 && f.user.status === "online";
    if (tab === "all") return f.type === 0;
    if (tab === "pending") return f.type === 2 || f.type === 3;
    if (tab === "blocked") return f.type === 1;
    return false;
  });

  const pendingCount = state.relationships.filter((f) => f.type === 2).length;

  return (
    <div className="flex w-full shrink-0 flex-1 flex-col overflow-hidden border-r border-rm-border bg-[var(--rm-sidebar)] backdrop-blur-xl font-sans">
      {/* Header tabs */}
      <div className="flex shrink-0 border-b border-rm-border">
        <button
          className={cn(
            "flex-1 cursor-pointer border-b-2 px-3 py-2.5 text-center text-xs font-semibold transition-colors outline-none",
            !showFriends
              ? "border-primary text-primary"
              : "border-transparent text-rm-text-muted hover:text-rm-text-secondary"
          )}
          onClick={() => toggleFriends(false)}
        >
          <MessageSquare className="mr-1.5 inline h-3.5 w-3.5" />
          DMs
        </button>
        <button
          className={cn(
            "flex-1 cursor-pointer border-b-2 px-3 py-2.5 text-center text-xs font-semibold transition-colors outline-none",
            showFriends
              ? "border-primary text-primary"
              : "border-transparent text-rm-text-muted hover:text-rm-text-secondary"
          )}
          onClick={() => toggleFriends(true)}
        >
          <Users className="mr-1.5 inline h-3.5 w-3.5" />
          Friends
        </button>
      </div>

      {!showFriends ? (
        /* DM Channel list */
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          <div className="space-y-0.5 p-2">
            {state.dmChannels.length === 0 && (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <MessageSquare className="h-6 w-6 text-rm-text-muted/40" />
                <span className="text-xs text-rm-text-muted">No DMs yet</span>
                <span className="text-[11px] text-rm-text-muted/40">
                  Open a DM from the friends list
                </span>
              </div>
            )}
            {state.dmChannels.map((dm) => (
              <button
                key={dm.id}
                className={cn(
                  "group relative flex w-full cursor-pointer items-center gap-2.5 rounded-md border-none px-2.5 py-2 text-left transition-all outline-none",
                  activeChannelId === dm.id
                    ? "bg-rm-bg-elevated text-rm-text shadow-sm"
                    : "text-rm-text-muted hover:bg-rm-bg-elevated/50 hover:text-rm-text-secondary"
                )}
                onClick={() => onSelectDm(dm.id)}
                onContextMenu={(e) => handleDmContextMenu(e, dm)}
              >
                {/* Unread Indicator */}
                {activeChannelId !== dm.id && isUnread(dm.id, state.readStates, state.lastMessageAt) && (
                  <div className="absolute left-[-4px] top-1/2 h-2 w-1 -translate-y-1/2 rounded-r-full bg-rm-text shadow-sm transition-all duration-300" />
                )}
                <div
                  className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary text-xs font-bold text-primary-foreground ring-1 ring-white/10 cursor-pointer hover:ring-white/30 relative outline-none"
                  onClick={(e) => {
                    e.stopPropagation();
                    dispatch({ type: 'SET_POPOVER', user: dm.recipient, anchor: e.currentTarget });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      dispatch({ type: 'SET_POPOVER', user: dm.recipient, anchor: e.currentTarget as HTMLElement });
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label={`View ${dm.recipient?.username ?? dm.name}'s profile`}
                >
                  {dm.recipient?.avatar_url ? (
                    <img src={dm.recipient.avatar_url} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} className="object-cover" />
                  ) : (
                    (dm.recipient?.username ?? dm.name ?? "?")[0].toUpperCase()
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <span className={cn(
                    "block truncate text-[13px] font-medium transition-colors",
                    activeChannelId === dm.id ? "text-rm-text" : "text-rm-text-secondary",
                    activeChannelId !== dm.id && isUnread(dm.id, state.readStates, state.lastMessageAt) && "font-semibold text-rm-text"
                  )}>
                    {dm.recipient?.username ?? dm.name}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : (
        /* Friends panel */
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Tab bar */}
          <div className="flex flex-wrap gap-1 border-b border-rm-border px-2 py-2">
            {(["online", "all", "pending", "blocked"] as Tab[]).map((t) => (
              <button
                key={t}
                className={cn(
                  "relative cursor-pointer rounded-md border-none px-2.5 py-1 text-[11px] font-semibold transition-colors outline-none",
                  tab === t
                    ? "bg-rm-bg-elevated text-rm-text shadow-sm"
                    : "text-rm-text-muted hover:bg-rm-bg-elevated hover:text-rm-text-secondary"
                )}
                onClick={() => dispatch({ type: 'SET_TAB', value: t })}
              >
                {t.charAt(0).toUpperCase() + t.slice(1)}
                {t === "pending" && pendingCount > 0 && (
                  <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold text-destructive-foreground">
                    {pendingCount}
                  </span>
                )}
              </button>
            ))}
            <button
              className={cn(
                "ml-auto cursor-pointer rounded-md border-none px-2.5 py-1 text-[11px] font-semibold transition-colors outline-none",
                addFriendMode
                  ? "bg-primary/20 text-primary"
                  : "text-primary hover:bg-primary/10"
              )}
              onClick={() => dispatch({ type: 'SET_ADD_FRIEND_MODE', value: !addFriendMode })}
            >
              <UserPlus className="mr-1 inline h-3 w-3" />
              Add
            </button>
          </div>

          {/* Add friend form */}
          {addFriendMode && (
            <div className="border-b border-rm-border px-3 py-3">
              <p className="mb-2 text-xs text-rm-text-muted">Add a friend by their username</p>
              <div className="flex gap-2">
                <input
                  className="flex-1 rounded-lg border border-rm-border bg-rm-bg-surface px-3 py-1.5 text-sm text-rm-text outline-none transition-all placeholder:text-rm-text-muted/20 focus:border-primary/30 focus:ring-2 focus:ring-primary/20"
                  placeholder="Enter a username"
                  value={addUsername}
                  onChange={(e) => dispatch({ type: 'SET_ADD_USERNAME', value: e.target.value })}
                  onKeyDown={(e) => e.key === "Enter" && handleAddFriend()}
                />
                <button
                  className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:brightness-110 disabled:opacity-40"
                  onClick={handleAddFriend}
                  disabled={!addUsername.trim()}
                >
                  Send
                </button>
              </div>
              {addStatus && (
                <p className="mt-2 text-xs text-primary">{addStatus}</p>
              )}
            </div>
          )}

          {/* Friends list */}
          <div className="flex-1 overflow-y-auto custom-scrollbar">
            <div className="space-y-0.5 p-2">
              {loading && (
                <div className="flex items-center justify-center gap-2 py-4 text-primary/60">
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  <span className="text-[11px] font-black uppercase tracking-widest">Loading...</span>
                </div>
              )}
              {!loading && filteredFriends.length === 0 && (
                <div className="flex flex-col items-center gap-2 py-8 text-center text-rm-text-muted/40">
                  {tab === "pending" ? <UserPlus className="h-6 w-6 opacity-20" /> :
                    tab === "blocked" ? <Ban className="h-6 w-6 opacity-20" /> :
                      <Users className="h-6 w-6 opacity-20" />}
                  <span className="text-xs">
                    {tab === "online" ? "No friends online" :
                      tab === "all" ? "No friends yet" :
                        tab === "pending" ? "No pending requests" :
                          "No blocked users"}
                  </span>
                </div>
              )}
              {!loading && filteredFriends.map((rel) => (
                <div
                  key={rel.user.id}
                  className="group flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 transition-colors hover:bg-rm-bg-elevated outline-none"
                  onClick={() => handleOpenDm(rel.user.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleOpenDm(rel.user.id);
                    }
                  }}
                  onContextMenu={(e) => handleFriendContextMenu(e, rel.user)}
                  role="button"
                  tabIndex={0}
                >
                  <div
                    className="relative cursor-pointer outline-none"
                    onClick={(e) => {
                      e.stopPropagation();
                      dispatch({ type: 'SET_POPOVER', user: rel.user, anchor: e.currentTarget });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        e.stopPropagation();
                        dispatch({ type: 'SET_POPOVER', user: rel.user, anchor: e.currentTarget as HTMLElement });
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    aria-label={`View ${rel.user.username}'s profile`}
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary text-xs font-bold text-primary-foreground ring-1 ring-white/10 group-hover:ring-white/30 transition-all relative">
                      {rel.user.avatar_url ? (
                        <img src={rel.user.avatar_url} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} className="object-cover" />
                      ) : (
                        rel.user.username[0].toUpperCase()
                      )}
                    </div>
                    <div className={cn(
                      "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-rm-bg-surface transition-colors",
                      rel.user.status === "online" ? "bg-primary" : "bg-zinc-500"
                    )} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-rm-text-secondary">{rel.user.username}</span>
                    <span className="text-[10px] text-rm-text-muted">
                      {rel.type === 0 ? (rel.user.status === "online" ? "Online" : "Offline") :
                        rel.type === 2 ? "Incoming request" :
                          rel.type === 3 ? "Outgoing request" : "Blocked"}
                    </span>
                  </div>
                  <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    {rel.type === 0 && (
                      <button
                        className="cursor-pointer rounded-lg p-1.5 text-rm-text-muted transition-colors hover:bg-rm-bg-elevated hover:text-rm-text-secondary outline-none"
                        title="Message"
                        onClick={(e) => { e.stopPropagation(); handleOpenDm(rel.user.id); }}
                      >
                        <MessageSquare className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {rel.type === 2 && (
                      <button
                        className="cursor-pointer rounded-lg p-1.5 text-primary/60 transition-colors hover:bg-primary/10 hover:text-primary outline-none"
                        title="Accept"
                        onClick={(e) => { e.stopPropagation(); handleAcceptFriend(rel.user.id); }}
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button
                      className="cursor-pointer rounded-lg p-1.5 text-destructive/60 transition-colors hover:bg-destructive/10 hover:text-destructive outline-none"
                      title={rel.type === 0 ? "Remove Friend" : rel.type === 2 ? "Reject" : "Cancel"}
                      onClick={(e) => { e.stopPropagation(); handleRemoveFriend(rel.user.id); }}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

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
