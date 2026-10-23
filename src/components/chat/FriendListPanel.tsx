import { getDisplayInitial, getDisplayName } from "@/lib/display-name";
import { getAuthAssetUrl } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { UserStatusDot } from "./UserStatusDot";
import React from "react";
import { AvatarImage } from "./AvatarImage";
import { Icon } from "@/components/ui/icon";
import { UserDisplayName } from "./UserDisplayName";

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
              "relative cursor-pointer rounded-md border-none px-2.5 py-1 text-ui-2xs font-semibold transition-colors outline-none",
              tab === t
                ? "bg-rm-bg-elevated text-rm-text shadow-sm"
                : "text-rm-text-muted pointer-fine:hover:bg-rm-bg-elevated pointer-fine:hover:text-rm-text-secondary",
            )}
            onClick={() => dispatch({ type: "SET_TAB", value: t })}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
            {t === "pending" && pendingCount > 0 && (
              <span className="badge-count ml-1">{pendingCount}</span>
            )}
          </button>
        ))}
        <button
          className={cn(
            "ml-auto cursor-pointer rounded-md border-none px-2.5 py-1 text-ui-2xs font-semibold transition-colors outline-none",
            addFriendMode
              ? "bg-primary/20 text-primary"
              : "text-primary pointer-fine:hover:bg-primary/10",
          )}
          onClick={() =>
            dispatch({ type: "SET_ADD_FRIEND_MODE", value: !addFriendMode })
          }
        >
          <Icon name="invite" size="xs" className="mr-1 inline" />
          Add
        </button>
      </div>

      {/* Add friend form */}
      {addFriendMode && (
        <div className="border-b border-rm-border px-3 py-3">
          <p className="mb-2 text-ui-xs text-rm-text-muted">
            Add a friend by their username
          </p>
          <div className="flex gap-2">
            <input
              className="flex-1 rounded-lg border border-rm-border bg-rm-bg-surface px-3 py-1.5 text-ui-sm text-rm-text outline-none transition-ui placeholder:text-rm-text-muted/20 focus:border-primary/30 focus:ring-2 focus:ring-primary/20"
              aria-label="Friend username"
              placeholder="Enter a username"
              value={addUsername}
              onChange={(e) =>
                dispatch({ type: "SET_ADD_USERNAME", value: e.target.value })
              }
              onKeyDown={(e) => e.key === "Enter" && handleAddFriend()}
            />
            <button
              className="rounded-lg bg-primary px-3 py-1.5 text-ui-xs font-semibold text-primary-foreground transition-colors pointer-fine:hover:brightness-110 disabled:opacity-40"
              onClick={handleAddFriend}
              disabled={!addUsername.trim()}
            >
              Send
            </button>
          </div>
          {addStatus && (
            <p className="mt-2 text-ui-xs text-primary">{addStatus}</p>
          )}
        </div>
      )}

      {/* Friends list */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <div className="space-y-0.5 p-2">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-4 text-primary/60">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <span className="text-ui-2xs font-semibold uppercase tracking-[0.08em]">
                Loading...
              </span>
            </div>
          )}
          {!loading && filteredFriends.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-8 text-center text-rm-text-muted/40">
              {tab === "pending" ? (
                <Icon name="invite" size="xl" className="opacity-20" />
              ) : tab === "blocked" ? (
                <Icon name="ban" size="xl" className="opacity-20" />
              ) : (
                <Icon name="members" size="xl" className="opacity-20" />
              )}
              <span className="text-ui-xs">
                {tab === "online"
                  ? "No friends online"
                  : tab === "all"
                    ? "No friends yet"
                    : tab === "pending"
                      ? "No pending requests"
                      : "No blocked users"}
              </span>
            </div>
          )}
          {!loading &&
            filteredFriends.map((rel) =>
              (() => {
                const displayName = getDisplayName(rel.user);
                return (
                  <div
                    key={rel.user.id}
                    className="group relative flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 transition-colors pointer-fine:hover:bg-rm-bg-elevated outline-none"
                  >
                    <button
                      type="button"
                      onClick={() => handleOpenDm(rel.user.id)}
                      onContextMenu={(e) =>
                        handleFriendContextMenu(e, rel.user)
                      }
                      aria-label={`Message ${displayName}`}
                      className="absolute inset-0 z-10 rounded-md outline-none"
                    />
                    <button
                      type="button"
                      className="relative z-20 cursor-pointer border-0 bg-transparent p-0 outline-none"
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
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-visible rounded-full bg-primary text-ui-xs font-semibold text-primary-foreground ring-1 ring-white/10 pointer-fine:group-hover:ring-white/30 transition-ui relative">
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
                        className="absolute -bottom-0.5 -right-0.5 h-3 w-3 border-2 border-rm-bg-surface transition-colors"
                      />
                    </button>
                    <div className="min-w-0 flex-1">
                      <UserDisplayName
                        user={rel.user}
                        className="block truncate text-ui-sm font-medium text-rm-text-secondary"
                      />
                      <span className="text-ui-2xs text-rm-text-muted">
                        {rel.type === 0
                          ? rel.user.status === "online"
                            ? "Online"
                            : "Offline"
                          : rel.type === 2
                            ? "Incoming request"
                            : rel.type === 3
                              ? "Outgoing request"
                              : "Blocked"}
                      </span>
                    </div>
                    <div className="relative z-20 flex gap-1 pointer-fine:opacity-0 transition-opacity pointer-fine:group-hover:opacity-100">
                      {rel.type === 0 && (
                        <button
                          className="cursor-pointer rounded-lg p-1.5 text-rm-text-muted transition-colors pointer-fine:hover:bg-rm-bg-elevated pointer-fine:hover:text-rm-text-secondary outline-none"
                          title="Message"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenDm(rel.user.id);
                          }}
                        >
                          <Icon name="chat" size="sm" />
                        </button>
                      )}
                      {rel.type === 2 && (
                        <button
                          className="cursor-pointer rounded-lg p-1.5 text-primary/60 transition-colors pointer-fine:hover:bg-primary/10 pointer-fine:hover:text-primary outline-none"
                          title="Accept"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAcceptFriend(rel.user.id);
                          }}
                        >
                          <Icon name="check" size="sm" />
                        </button>
                      )}
                      <button
                        className="cursor-pointer rounded-lg p-1.5 text-destructive/60 transition-colors pointer-fine:hover:bg-destructive/10 pointer-fine:hover:text-destructive outline-none"
                        title={
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
                      >
                        <Icon name="close" size="sm" />
                      </button>
                    </div>
                  </div>
                );
              })(),
            )}
        </div>
      </div>
    </div>
  );
}
