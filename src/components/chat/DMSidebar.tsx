import { useContextMenu } from "@/hooks/useContextMenu";
import { apiDelete, apiPost, apiPut } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useChatActions, useChatStore } from "@/stores/chat-store";

import { useCallback, useEffect, useReducer } from "react";
import { useShallow } from "zustand/shallow";
import ContextMenu from "./ContextMenu";
import { DMListPanel } from "./DMListPanel";
import { FriendListPanel } from "./FriendListPanel";
import { Copy, MessageSquare, Trash2, User as UserIcon, Users } from "./Icons";
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
  const { relationships, dmChannels, readStates, lastMessageAt } = useChatStore(useShallow(s => ({
    relationships: s.relationships,
    dmChannels: s.dmChannels,
    readStates: s.readStates,
    lastMessageAt: s.lastMessageAt,
  })));
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

  const filteredFriends = relationships.filter((f) => {
    if (tab === "online") return f.type === 0 && f.user.status === "online";
    if (tab === "all") return f.type === 0;
    if (tab === "pending") return f.type === 2 || f.type === 3;
    if (tab === "blocked") return f.type === 1;
    return false;
  });

  const pendingCount = relationships.filter((f) => f.type === 2).length;

  return (
    <div className="flex w-full shrink-0 flex-1 flex-col overflow-hidden border-r border-rm-border bg-rm-sidebar backdrop-blur-xl font-sans">
      {/* Header tabs */}
      <div
        className="flex shrink-0 border-b border-rm-border"
        style={{ paddingTop: 'calc(8px + var(--safe-area-top, 0px))' }}
      >
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
        <DMListPanel
          dmChannels={dmChannels}
          activeChannelId={activeChannelId}
          onSelectDm={onSelectDm}
          isUnread={isUnread}
          state={{ readStates, lastMessageAt }}
          handleDmContextMenu={handleDmContextMenu}
          dispatch={dispatch}
        />
      ) : (
        <FriendListPanel
          tab={tab}
          addFriendMode={addFriendMode}
          addUsername={addUsername}
          addStatus={addStatus}
          loading={loading}
          filteredFriends={filteredFriends}
          pendingCount={pendingCount}
          dispatch={dispatch}
          handleAddFriend={handleAddFriend}
          handleOpenDm={handleOpenDm}
          handleAcceptFriend={handleAcceptFriend}
          handleRemoveFriend={handleRemoveFriend}
          handleFriendContextMenu={handleFriendContextMenu}
        />
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
