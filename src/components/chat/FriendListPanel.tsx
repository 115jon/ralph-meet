import { getDisplayInitial, getDisplayName } from "@/lib/display-name";
import { getAuthAssetUrl } from "@/lib/platform";
import { cn } from "@/lib/utils";
import React from 'react';
import { Ban, Check, MessageSquare, UserPlus, Users, X } from "./Icons";

type Tab = "online" | "all" | "pending" | "blocked";

interface FriendListPanelProps {
  tab: Tab;
  addFriendMode: boolean;
  addUsername: string;
  addStatus: string | null;
  loading: boolean;
  filteredFriends: any[];
  pendingCount: number;
  dispatch: React.Dispatch<any>;
  handleAddFriend: () => void;
  handleOpenDm: (userId: string) => void;
  handleAcceptFriend: (userId: string) => void;
  handleRemoveFriend: (userId: string) => void;
  handleFriendContextMenu: (e: React.MouseEvent, user: any) => void;
}

export function FriendListPanel({
  tab,
  addFriendMode,
  addUsername,
  addStatus,
  loading,
  filteredFriends,
  pendingCount,
  dispatch,
  handleAddFriend,
  handleOpenDm,
  handleAcceptFriend,
  handleRemoveFriend,
  handleFriendContextMenu,
}: FriendListPanelProps) {
  return (
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
              aria-label="Friend username"
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
            (() => {
              const displayName = getDisplayName(rel.user);
              return (
            <div
              key={rel.user.id}
              className="group relative flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 transition-colors hover:bg-rm-bg-elevated outline-none"
            >
              <button
                type="button"
                onClick={() => handleOpenDm(rel.user.id)}
                onContextMenu={(e) => handleFriendContextMenu(e, rel.user)}
                aria-label={`Message ${displayName}`}
                className="absolute inset-0 z-10 rounded-md outline-none"
              />
              <button
                type="button"
                className="relative z-20 cursor-pointer border-0 bg-transparent p-0 outline-none"
                onClick={(e) => {
                  e.stopPropagation();
                  dispatch({ type: 'SET_POPOVER', user: rel.user, anchor: e.currentTarget });
                }}
                aria-label={`View ${displayName}'s profile`}
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary text-xs font-bold text-primary-foreground ring-1 ring-white/10 group-hover:ring-white/30 transition-all relative">
                  {rel.user.avatar_url ? (
                    <img src={getAuthAssetUrl(rel.user.avatar_url)} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} className="object-cover" />
                  ) : (
                    getDisplayInitial(rel.user)
                  )}
                </div>
                <div className={cn(
                  "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-rm-bg-surface transition-colors",
                  rel.user.status === "online" ? "bg-primary" : "bg-zinc-500"
                )} />
              </button>
              <div className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-rm-text-secondary">{displayName}</span>
                <span className="text-[10px] text-rm-text-muted">
                  {rel.type === 0 ? (rel.user.status === "online" ? "Online" : "Offline") :
                    rel.type === 2 ? "Incoming request" :
                      rel.type === 3 ? "Outgoing request" : "Blocked"}
                </span>
              </div>
              <div className="relative z-20 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
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
              );
            })()
          ))}
        </div>
      </div>
    </div>
  );
}
