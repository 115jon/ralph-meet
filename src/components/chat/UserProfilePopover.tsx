import { getDisplayInitial, getDisplayName } from "@/lib/display-name";
import { apiGet, apiPut } from "@/lib/api-client";
import { extractDominantColor } from "@/lib/color-utils";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { getAuthAssetUrl } from "@/lib/platform";
import type { Role } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chat-store";
import { Check, FilePlus, MoreHorizontal, Plus, Smile, Swords, UserCheck, X } from "lucide-react";
import { useShallow } from "zustand/shallow";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import { createPortal } from "react-dom";

interface Props {
  userId: string;
  username: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  anchorEl: HTMLElement;
  onClose: () => void;
  side?: "left" | "right" | "top" | "bottom";
  align?: "start" | "center" | "end";
}

const getHighestRole = (roles?: Role[]) => {
  if (!roles || roles.length === 0) return null;
  return roles.reduce((highest, current) =>
    current.position > highest.position ? current : highest
    , roles[0]);
};

const statusColors: Record<string, string> = {
  online: "bg-primary",
  idle: "bg-warning",
  dnd: "bg-destructive",
  offline: "bg-rm-text-muted/40",
};

const INITIAL_STATE = {
  position: { top: 0, left: 0 },
  isAssigningRoles: false,
  serverRoles: [] as Role[],
  loadingRoles: false,
  bannerColor: null as string | null,
  mutualFriends: { count: 0, items: [] as Array<{ id: string; username: string; display_name?: string | null; avatar_url?: string | null }> },
  mutualServers: { count: 0, items: [] as Array<{ id: string; name: string; icon_url?: string | null }> },
  loadingProfile: false,
};

type LocalState = typeof INITIAL_STATE;
type LocalAction = Partial<LocalState> | ((prev: LocalState) => Partial<LocalState>);

function PopoverBanner({ bannerColor, canManageRoles, isMe }: { bannerColor: string | null, canManageRoles: boolean, isMe: boolean }) {
  return (
    <div
      className="relative h-[100px] group/banner transition-colors duration-500 rounded-t-2xl overflow-hidden"
      style={{ backgroundColor: bannerColor || "#A39A86" }}
    >
      <div className="absolute top-3 right-3 flex items-center gap-2 opacity-100">
        {canManageRoles && (
          <button className="bg-black/40 hover:bg-black/60 text-white p-1.5 rounded-full transition-colors backdrop-blur-sm" title="Mod View">
            <Swords size={16} />
          </button>
        )}
        {!isMe && (
          <button className="bg-black/40 hover:bg-black/60 text-white p-1.5 rounded-full transition-colors backdrop-blur-sm" title="Friends">
            <UserCheck size={16} />
          </button>
        )}
        <button className="bg-black/40 hover:bg-black/60 text-white p-1.5 rounded-full transition-colors backdrop-blur-sm" title="More Options">
          <MoreHorizontal size={16} />
        </button>
      </div>
    </div>
  );
}

function PopoverAvatar({ avatarUrl, displayName, isOnline, status }: { avatarUrl?: string | null, displayName: string, isOnline: boolean, status?: string }) {
  return (
    <div className="relative -mt-12 px-4">
      <div className="relative inline-block rounded-full bg-rm-bg-primary p-1.5">
        <div className="relative flex h-[80px] w-[80px] items-center justify-center overflow-hidden rounded-full bg-primary text-2xl font-bold text-primary-foreground border-rm-border transition-all shadow-sm">
          {avatarUrl ? (
            <img src={getAuthAssetUrl(avatarUrl)} alt={displayName} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} className="object-cover" />
          ) : (
            getDisplayInitial({ name: displayName })
          )}
        </div>
        <div className="absolute bottom-1 right-1 rounded-full bg-rm-bg-primary p-1">
          <span
            className={cn(
              "block h-5 w-5 rounded-full border-rm-bg-primary",
              isOnline ? (statusColors[status ?? "online"]) : statusColors["offline"]
            )}
          />
        </div>
      </div>
    </div>
  );
}

function PopoverInfo({ displayName, username, isMe, loadingProfile, mutualFriends, mutualServers }: {
  displayName?: string | null,
  username: string,
  isMe: boolean,
  loadingProfile: boolean,
  mutualFriends: any,
  mutualServers: any
}) {
  return (
    <div className="px-4 pb-3 pt-1">
      <div className="flex items-center gap-1.5">
        <h3 className="text-xl font-bold text-rm-text leading-tight">{displayName || username}</h3>
        {!isMe && (
          <button className="text-rm-text-muted hover:text-rm-text mt-0.5">
            <FilePlus size={16} />
          </button>
        )}
      </div>
      <div className="text-sm font-medium text-rm-text-muted">@{username}</div>

      {!isMe && !loadingProfile && (mutualFriends.count > 0 || mutualServers.count > 0) ? (
        <div className="mt-3 mb-1 space-y-2">
          {mutualFriends.count > 0 && (
            <div className="flex items-center gap-2">
              <div className="flex -space-x-1.5 shrink-0">
                {mutualFriends.items.slice(0, 6).map((f: any) => {
                  const friendDisplayName = getDisplayName(f);

                  return (
                    <div key={f.id} className="w-5 h-5 rounded-full bg-rm-bg-surface border border-rm-bg-primary flex items-center justify-center overflow-hidden" title={friendDisplayName}>
                      {f.avatar_url ? (
                        <img src={getAuthAssetUrl(f.avatar_url)} alt={friendDisplayName} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-[9px] font-bold text-rm-text-muted">{getDisplayInitial(f)}</span>
                      )}
                    </div>
                  );
                })}
              </div>
              <span className="text-[11px] font-semibold text-rm-text-muted">
                {mutualFriends.count} Mutual Friend{mutualFriends.count === 1 ? '' : 's'}
              </span>
            </div>
          )}
          {mutualServers.count > 0 && (
            <div className="flex items-center gap-2">
              <div className="flex -space-x-1.5 shrink-0">
                {mutualServers.items.slice(0, 6).map((s: any) => (
                  <div key={s.id} className="w-5 h-5 rounded-md bg-rm-bg-surface border border-rm-bg-primary flex items-center justify-center overflow-hidden" title={s.name}>
                    {s.icon_url ? (
                      <img src={getAuthAssetUrl(s.icon_url)} alt={s.name} className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-[9px] font-bold text-rm-text-muted">{s.name[0].toUpperCase()}</span>
                    )}
                  </div>
                ))}
              </div>
              <span className="text-[11px] font-semibold text-rm-text-muted">
                {mutualServers.count} Mutual Server{mutualServers.count === 1 ? '' : 's'}
              </span>
            </div>
          )}
        </div>
      ) : (
        <div className="h-4" />
      )}
    </div>
  );
}

function RoleAssignmentDropdown({ isAssigningRoles, loadingRoles, serverRoles, optimisticRoles, assignRole, dropdownRef }: any) {
  if (!isAssigningRoles) return null;

  return (
    <div
      ref={dropdownRef}
      className="absolute right-4 top-8 w-48 z-[1010] bg-rm-bg-secondary rounded-lg border border-rm-border shadow-xl p-1 animate-in fade-in zoom-in-95"
    >
      {loadingRoles ? (
        <div className="p-3 text-center text-xs text-rm-text-muted">Loading...</div>
      ) : (
        <div className="max-h-48 overflow-y-auto custom-scrollbar">
          {serverRoles.filter((r: Role) => !r.is_default).length === 0 ? (
            <div className="p-2 text-center text-xs text-rm-text-muted">No custom roles available</div>
          ) : (
            serverRoles.filter((r: Role) => !r.is_default).map((role: Role) => {
              const hasRole = optimisticRoles?.some((r: Role) => r.id === role.id);
              return (
                <button
                  key={role.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    const currentRoles = optimisticRoles?.map((r: Role) => r.id) || [];
                    assignRole(role.id, currentRoles);
                  }}
                  className={cn(
                    "w-full text-left flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors hover:bg-rm-bg-hover group",
                    hasRole ? "text-rm-text font-medium" : "text-rm-text-secondary"
                  )}
                >
                  <div
                    className="h-3 w-3 rounded-full shrink-0"
                    style={{ backgroundColor: role.color || '#94a3b8' }}
                  />
                  <span className="flex-1 truncate">{role.name}</span>
                  {hasRole && <Check size={14} className="text-primary" />}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

function PopoverRoles({ optimisticRoles, canManageRoles, assignRole, handleToggleAssignRoles, dropdownProps }: any) {
  return (
    <div className="px-4 pb-3 relative">
      <div className="flex flex-wrap items-center gap-1.5 mt-1">
        {optimisticRoles?.filter((r: Role) => !r.is_default).map((role: Role) => (
          <div
            key={role.id}
            className="flex items-center gap-1.5 rounded bg-[#202225] pl-2 pr-1 py-0.5 border border-rm-border/50 text-[11px] font-medium group"
          >
            <div
              className="h-3 w-3 rounded-full shrink-0"
              style={{ backgroundColor: role.color || '#94a3b8' }}
            />
            <span className="text-rm-text-secondary py-0.5 pr-1 truncate max-w-[120px]">{role.name}</span>
            {canManageRoles && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const currentRoles = optimisticRoles?.map((r: Role) => r.id) || [];
                  assignRole(role.id, currentRoles);
                }}
                className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-rm-text-muted/20 rounded cursor-pointer text-rm-text-muted hover:text-rm-text transition-all"
              >
                <X size={12} />
              </button>
            )}
          </div>
        ))}

        {canManageRoles && (
          <button
            onClick={handleToggleAssignRoles}
            className="flex items-center justify-center w-6 h-6 text-rm-text-muted hover:bg-rm-bg-elevated hover:text-rm-text rounded transition-colors"
            title="Manage Roles"
          >
            <Plus size={14} />
          </button>
        )}
      </div>

      <RoleAssignmentDropdown {...dropdownProps} />
    </div>
  );
}

export default function UserProfilePopover({ userId, username, displayName, avatarUrl, anchorEl, onClose, side = "bottom", align = "start" }: Props) {
  const state = useChatStore(useShallow(s => ({
    members: s.members,
    user: s.user,
    onlineUsers: s.onlineUsers,
    activeServerId: s.activeServerId,
  })));
  const popoverRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  // Keep a stable ref to onClose so effects don't re-register listeners
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const [localState, setLocalState] = useReducer(
    (prev: LocalState, next: LocalAction) => ({ ...prev, ...(typeof next === 'function' ? next(prev) : next) }),
    INITIAL_STATE
  );

  const member = state.members.find((m) => m.user.id === userId);
  const [optimisticRoles, setOptimisticRoles] = useState<Role[] | undefined>(member?.roles);

  useEffect(() => {
    setOptimisticRoles(member?.roles);
  }, [member?.roles]);

  const fetchBannerColor = useCallback(() => {
    if (avatarUrl) {
      extractDominantColor(avatarUrl).then(color => {
        if (color) setLocalState({ bannerColor: color });
      });
    }
  }, [avatarUrl]);

  useEffect(() => {
    fetchBannerColor();
  }, [fetchBannerColor]);

  const fetchUserProfile = useCallback(() => {
    if (userId && userId !== state.user?.id) {
      setLocalState({ loadingProfile: true });

      apiGet<{
        mutualFriends: { count: number; items: Array<{ id: string; username: string; display_name?: string | null; avatar_url?: string | null }> };
        mutualServers: { count: number; items: Array<{ id: string; name: string; icon_url?: string | null }> };
      }>(`/api/users/${userId}/profile`)
        .then(data => {
          setLocalState({
            mutualFriends: data.mutualFriends ?? { count: 0, items: [] },
            mutualServers: data.mutualServers ?? { count: 0, items: [] }
          });
        })
        .catch(console.error)
        .finally(() => setLocalState({ loadingProfile: false }));
    }
  }, [userId, state.user?.id]);

  useEffect(() => {
    fetchUserProfile();
  }, [fetchUserProfile]);

  useEffect(() => {
    const rect = anchorEl.getBoundingClientRect();
    const width = 280;
    const height = 320;

    const isMobile = window.innerWidth < 768;

    if (isMobile) {
      setLocalState({
        position: {
          top: Math.max(8, (window.innerHeight - height) / 2),
          left: Math.max(8, (window.innerWidth - width) / 2),
        }
      });
      return;
    }

    let top = 0;
    let left = 0;

    if (side === "left") {
      left = rect.left - width - 8;
      top = rect.top + (rect.height / 2) - (150);
    } else if (side === "right") {
      left = rect.right + 8;
      top = rect.top + (rect.height / 2) - 150;
    } else if (side === "top") {
      left = rect.left;
      top = rect.top - height - 8;
    } else {
      top = rect.bottom + 8;
      left = Math.min(rect.left, window.innerWidth - width - 8);
    }

    const finalTop = Math.max(8, Math.min(top, window.innerHeight - 350));
    const finalLeft = Math.max(8, Math.min(left, window.innerWidth - width - 8));

    setLocalState({
      position: {
        top: finalTop,
        left: finalLeft,
      }
    });
  }, [anchorEl, side]);

  // Use a stable ref for onClose so the mousedown effect only registers once
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        !(dropdownRef.current && dropdownRef.current.contains(e.target as Node)) &&
        !(anchorEl && anchorEl.contains(e.target as Node))
      ) {
        onCloseRef.current();
      }
    };
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handler);
    }, 50);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handler);
    };
  }, [anchorEl]); // depends on anchorEl instead of empty, so handler captures latest anchor

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []); // stable — no dependency on onClose

  const isOnline = state.onlineUsers.has(userId);

  const myMember = state.members.find((m) => m.user.id === state.user?.id);
  const myTotalPerms = myMember?.roles?.reduce((acc, r) => acc | r.permissions, 0) ?? 0;
  const canManageRoles = hasPermission(myTotalPerms, PERMISSIONS.MANAGE_ROLES);
  const isMe = userId === state.user?.id;

  const fetchRoles = async () => {
    if (localState.serverRoles.length > 0) return;
    setLocalState({ loadingRoles: true });
    try {
      const data = await apiGet<Role[]>(`/api/servers/${state.activeServerId}/roles`);
      setLocalState({ serverRoles: data });
    } catch (err) {
      console.error("Failed to fetch roles:", err);
    } finally {
      setLocalState({ loadingRoles: false });
    }
  };

  const handleToggleAssignRoles = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!localState.isAssigningRoles) fetchRoles();
    setLocalState(prev => ({ isAssigningRoles: !prev.isAssigningRoles }));
  };

  const assignRole = (roleId: string, currentRoleIds: string[]) => {
    if (!state.activeServerId) return;

    const roleObj = localState.serverRoles.find(r => r.id === roleId);
    if (!roleObj) return;

    const isAdding = !currentRoleIds.includes(roleId);
    const newRoleIds = isAdding
      ? [...currentRoleIds, roleId]
      : currentRoleIds.filter(id => id !== roleId);

    if (isAdding) {
      setOptimisticRoles(prev => prev ? [...prev, roleObj] : [roleObj]);
    } else {
      setOptimisticRoles(prev => prev?.filter(r => r.id !== roleId) || []);
    }

    apiPut(`/api/servers/${state.activeServerId}/members/${userId}/roles`, { roleIds: newRoleIds })
      .catch(err => {
        console.error("Failed to assign role:", err);
        setOptimisticRoles(member?.roles);
      });
  };

  const dropdownProps = {
    isAssigningRoles: localState.isAssigningRoles,
    loadingRoles: localState.loadingRoles,
    serverRoles: localState.serverRoles,
    optimisticRoles,
    assignRole,
    dropdownRef,
  };

  return createPortal(
    <div className="contents">
      <div
        className="fixed inset-0 z-[999] cursor-default bg-black/50 md:bg-transparent backdrop-blur-sm md:backdrop-blur-none md:pointer-events-none animate-in fade-in duration-200"
        onClick={onClose}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " " || e.key === "Escape") onClose(); }}
        role="presentation"
        aria-hidden="true"
      />
      <div
        ref={popoverRef}
        className="fixed z-[1000] w-[280px] animate-in fade-in zoom-in-95 rounded-2xl border border-rm-border bg-rm-bg-primary shadow-[0_16px_48px_rgba(0,0,0,0.6)] duration-200 outline-none"
        style={{ top: localState.position.top, left: localState.position.left }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") e.stopPropagation(); }}
        role="dialog"
        aria-modal="true"
        aria-label={`User profile for ${username}`}
        tabIndex={-1}
      >
        <PopoverBanner bannerColor={localState.bannerColor} canManageRoles={canManageRoles} isMe={isMe} />

        <PopoverAvatar avatarUrl={avatarUrl} displayName={displayName || username} isOnline={isOnline} status={member?.user.status} />

        <PopoverInfo
          displayName={displayName}
          username={username}
          isMe={isMe}
          loadingProfile={localState.loadingProfile}
          mutualFriends={localState.mutualFriends}
          mutualServers={localState.mutualServers}
        />

        <PopoverRoles
          optimisticRoles={optimisticRoles}
          canManageRoles={canManageRoles}
          assignRole={assignRole}
          handleToggleAssignRoles={handleToggleAssignRoles}
          dropdownProps={dropdownProps}
        />

        {!isMe && (
          <div className="px-4 pb-4 mt-2">
            <div className="border border-rm-border/50 bg-[#111214] rounded-lg px-3 py-2.5 flex items-center justify-between group transition-colors hover:border-rm-border focus-within:border-rm-border">
              <input
                type="text"
                className="bg-transparent text-xs font-medium text-rm-text outline-none placeholder:text-rm-text-muted w-full"
                placeholder={`Message @${username}`}
              />
              <Smile size={16} className="text-rm-text-muted/50 transition-colors shrink-0 ml-2 hover:text-rm-text cursor-pointer" />
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
