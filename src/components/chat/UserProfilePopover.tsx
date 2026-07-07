import { ProfileAssetLayer } from "@/components/chat/ProfileAssetLayer";
import { AvatarImage } from "@/components/chat/AvatarImage";
import { ProfileCollectiblesLayer } from "@/components/chat/ProfileCollectiblesLayer";
import { ProfileDisplayName } from "@/components/chat/ProfileDisplayName";
import { ButtonBase } from "@/components/ui/button-base";
import { getDisplayInitial, getDisplayName } from "@/lib/display-name";
import { apiGet, apiPut } from "@/lib/api-client";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { getAuthAssetUrl } from "@/lib/platform";
import { getProfileThemeVariables } from "@/lib/profile-customization";
import type { Role, User } from "@/lib/types";
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
  avatarDisplay?: User["avatar_display"];
  anchorEl: HTMLElement;
  onClose: () => void;
  side?: "left" | "right" | "top" | "bottom";
  align?: "start" | "center" | "end";
}

const statusColors: Record<string, string> = {
  online: "bg-primary",
  idle: "bg-warning",
  dnd: "bg-destructive",
  offline: "bg-rm-text-muted/40",
};
const PROFILE_SURFACE_RATIO = 450 / 880;
const MOBILE_MAX_SURFACE_HEIGHT = 600;
const DESKTOP_MAX_SURFACE_HEIGHT = 620;
const POPOVER_ACTION_BUTTON_CLASS =
  "flex h-8 w-8 items-center justify-center rounded-full border border-[color:var(--rm-profile-custom-card-border)] bg-[var(--rm-profile-custom-card-bg-strong)] text-[color:var(--rm-profile-custom-muted)] shadow-[0_10px_24px_rgba(0,0,0,0.28)] backdrop-blur-sm transition-colors hover:bg-[var(--rm-profile-custom-card-bg)] hover:text-[color:var(--rm-profile-custom-text)]";

const INITIAL_STATE = {
  position: { top: 0, left: 0 },
  surfaceSize: { width: 320, height: 626 },
  isAssigningRoles: false,
  serverRoles: [] as Role[],
  loadingRoles: false,
  profileUser: null as User | null,
  mutualFriends: { count: 0, items: [] as Array<{ id: string; username: string; display_name?: string | null; avatar_url?: string | null; avatar_display?: User["avatar_display"] }> },
  mutualServers: { count: 0, items: [] as Array<{ id: string; name: string; icon_url?: string | null }> },
  loadingProfile: false,
};

type LocalState = typeof INITIAL_STATE;
type LocalAction = Partial<LocalState> | ((prev: LocalState) => Partial<LocalState>);

function PopoverBanner({
  bannerUrl,
  bannerContentType,
  canManageRoles,
  isMe,
}: {
  bannerUrl?: string | null;
  bannerContentType?: string | null;
  canManageRoles: boolean;
  isMe: boolean;
}) {
  return (
    <div
      className="relative h-[104px] overflow-hidden rounded-t-[inherit] transition-colors duration-500"
      style={{ background: "var(--rm-profile-custom-banner-fallback)" }}
    >
      <ProfileAssetLayer
        url={bannerUrl}
        contentType={bannerContentType}
        alt="Profile banner"
        className="opacity-95"
      />
      <div className="absolute inset-0" style={{ background: "var(--rm-profile-custom-banner-overlay)" }} />
        <div className="absolute top-3 right-3 z-20 flex items-center gap-2 opacity-100">
          {canManageRoles && (
          <ButtonBase className={POPOVER_ACTION_BUTTON_CLASS} title="Mod View">
            <Swords size={16} />
          </ButtonBase>
        )}
        {!isMe && (
          <ButtonBase className={POPOVER_ACTION_BUTTON_CLASS} title="Friends">
            <UserCheck size={16} />
          </ButtonBase>
        )}
        <ButtonBase className={POPOVER_ACTION_BUTTON_CLASS} title="More Options">
          <MoreHorizontal size={16} />
        </ButtonBase>
      </div>
    </div>
  );
}

function PopoverAvatar({ avatarUrl, avatarDisplay, displayName, isOnline, status }: { avatarUrl?: string | null, avatarDisplay?: User["avatar_display"], displayName: string, isOnline: boolean, status?: string }) {
  return (
    <div className="relative z-30 -mt-12 px-4">
      <div className="relative inline-block rounded-full bg-rm-bg-primary p-1.5">
        <div className="relative flex h-[80px] w-[80px] items-center justify-center rounded-full border-rm-border bg-[var(--rm-profile-custom-button-bg)] text-2xl font-bold text-[color:var(--rm-profile-custom-button-text)] transition-all shadow-sm">
          {avatarUrl ? (
            <AvatarImage src={getAuthAssetUrl(avatarUrl)} alt={displayName} display={avatarDisplay} />
          ) : (
            getDisplayInitial({ name: displayName })
          )}
        </div>
        <div className="absolute bottom-1 right-1 z-20 rounded-full bg-rm-bg-primary p-1">
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

function PopoverInfo({ displayName, username, isMe, loadingProfile, mutualFriends, mutualServers, displayNameStyle }: {
  displayName?: string | null,
  username: string,
  isMe: boolean,
  loadingProfile: boolean,
  mutualFriends: any,
  mutualServers: any,
  displayNameStyle?: User["display_name_style"],
}) {
  return (
    <div className="relative z-20 px-4 pb-3 pt-1">
        <div className="flex items-center gap-1.5">
          <ProfileDisplayName
            text={displayName || username}
            displayNameStyle={displayNameStyle}
            className="text-xl font-bold leading-tight text-[color:var(--rm-profile-custom-text)]"
          />
          {!isMe && (
          <ButtonBase className="mt-0.5 text-[color:var(--rm-profile-custom-muted)] transition-colors hover:text-[color:var(--rm-profile-custom-text)]">
            <FilePlus size={16} />
          </ButtonBase>
        )}
      </div>
      <div className="text-sm font-medium text-[color:var(--rm-profile-custom-muted)]">@{username}</div>

      {!isMe && !loadingProfile && (mutualFriends.count > 0 || mutualServers.count > 0) ? (
        <div className="mt-3 mb-1 space-y-2">
          {mutualFriends.count > 0 && (
            <div className="flex items-center gap-2">
              <div className="flex -space-x-1.5 shrink-0">
                {mutualFriends.items.slice(0, 6).map((f: any) => {
                  const friendDisplayName = getDisplayName(f);

                  return (
                    <div key={f.id} className="flex h-5 w-5 items-center justify-center overflow-hidden rounded-full border border-[color:var(--rm-profile-custom-card-border)] bg-[var(--rm-profile-custom-card-bg-strong)]" title={friendDisplayName}>
                      {f.avatar_url ? (
                        <AvatarImage src={getAuthAssetUrl(f.avatar_url)} alt={friendDisplayName} display={f.avatar_display} />
                      ) : (
                        <span className="text-[9px] font-bold text-[color:var(--rm-profile-custom-muted)]">{getDisplayInitial(f)}</span>
                      )}
                    </div>
                  );
                })}
              </div>
              <span className="text-[11px] font-semibold text-[color:var(--rm-profile-custom-muted)]">
                {mutualFriends.count} Mutual Friend{mutualFriends.count === 1 ? '' : 's'}
              </span>
            </div>
          )}
          {mutualServers.count > 0 && (
            <div className="flex items-center gap-2">
              <div className="flex -space-x-1.5 shrink-0">
                {mutualServers.items.slice(0, 6).map((s: any) => (
                  <div key={s.id} className="flex h-5 w-5 items-center justify-center overflow-hidden rounded-md border border-[color:var(--rm-profile-custom-card-border)] bg-[var(--rm-profile-custom-card-bg-strong)]" title={s.name}>
                    {s.icon_url ? (
                      <img src={getAuthAssetUrl(s.icon_url)} alt={s.name} className="w-full h-full object-cover" />
                    ) : (
                        <span className="text-[9px] font-bold text-[color:var(--rm-profile-custom-muted)]">{s.name[0].toUpperCase()}</span>
                    )}
                  </div>
                ))}
              </div>
              <span className="text-[11px] font-semibold text-[color:var(--rm-profile-custom-muted)]">
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
  const assignableRoles = serverRoles.filter((role: Role) => !role.is_default);

  return (
    <div
      ref={dropdownRef}
      className="absolute right-4 top-8 z-[1010] w-48 rounded-lg border border-[color:var(--rm-profile-custom-card-border)] bg-[var(--rm-profile-custom-card-bg-strong)] p-1 shadow-xl animate-in fade-in zoom-in-95"
    >
      {loadingRoles ? (
        <div className="p-3 text-center text-xs text-[color:var(--rm-profile-custom-muted)]">Loading...</div>
      ) : (
        <div className="max-h-48 overflow-y-auto custom-scrollbar">
          {assignableRoles.length === 0 ? (
            <div className="p-2 text-center text-xs text-[color:var(--rm-profile-custom-muted)]">No custom roles available</div>
          ) : (
            assignableRoles.map((role: Role) => {
              const hasRole = optimisticRoles?.some((r: Role) => r.id === role.id);
              return (
                <ButtonBase
                  key={role.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    const currentRoles = optimisticRoles?.map((r: Role) => r.id) || [];
                    assignRole(role.id, currentRoles);
                  }}
                  className={cn(
                    "group flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors hover:bg-[var(--rm-profile-custom-card-bg)]",
                    hasRole ? "font-medium text-[color:var(--rm-profile-custom-text)]" : "text-[color:var(--rm-profile-custom-muted)]"
                  )}
                >
                  <div
                    className="h-3 w-3 rounded-full shrink-0"
                    style={{ backgroundColor: role.color || '#94a3b8' }}
                  />
                  <span className="flex-1 truncate">{role.name}</span>
                  {hasRole && <Check size={14} className="text-[color:var(--rm-profile-custom-accent)]" />}
                </ButtonBase>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

function PopoverRoles({ optimisticRoles, canManageRoles, assignRole, handleToggleAssignRoles, dropdownProps }: any) {
  const customRoles = optimisticRoles?.filter((role: Role) => !role.is_default) ?? [];
  return (
    <div className="px-4 pb-3 relative">
      <div className="flex flex-wrap items-center gap-1.5 mt-1">
        {customRoles.map((role: Role) => (
          <div
            key={role.id}
            className="group flex items-center gap-1.5 rounded border border-[color:var(--rm-profile-custom-card-border)] bg-[var(--rm-profile-custom-card-bg)] py-0.5 pl-2 pr-1 text-[11px] font-medium"
          >
            <div
              className="h-3 w-3 rounded-full shrink-0"
              style={{ backgroundColor: role.color || '#94a3b8' }}
            />
            <span className="max-w-[120px] truncate py-0.5 pr-1 text-[color:var(--rm-profile-custom-muted)]">{role.name}</span>
            {canManageRoles && (
              <ButtonBase
                onClick={(e) => {
                  e.stopPropagation();
                  const currentRoles = optimisticRoles?.map((r: Role) => r.id) || [];
                  assignRole(role.id, currentRoles);
                }}
                className="cursor-pointer rounded p-0.5 text-[color:var(--rm-profile-custom-muted)] opacity-0 transition-all hover:bg-black/8 hover:text-[color:var(--rm-profile-custom-text)] group-hover:opacity-100"
              >
                <X size={12} />
              </ButtonBase>
            )}
          </div>
        ))}

        {canManageRoles && (
          <ButtonBase
            onClick={handleToggleAssignRoles}
            className="flex h-6 w-6 items-center justify-center rounded text-[color:var(--rm-profile-custom-muted)] transition-colors hover:bg-[var(--rm-profile-custom-card-bg)] hover:text-[color:var(--rm-profile-custom-text)]"
            title="Manage Roles"
          >
            <Plus size={14} />
          </ButtonBase>
        )}
      </div>

      <RoleAssignmentDropdown {...dropdownProps} />
    </div>
  );
}

export default function UserProfilePopover({ userId, username, displayName, avatarUrl, avatarDisplay, anchorEl, onClose, side = "bottom", align: _align = "start" }: Props) {
  const state = useChatStore(useShallow(s => ({
    members: s.members,
    user: s.user,
    onlineUsers: s.onlineUsers,
    activeServerId: s.activeServerId,
    dispatch: s.dispatch,
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
  const resolvedUser = localState.profileUser ?? member?.user ?? (userId === state.user?.id ? state.user : null);
  const resolvedUsername = resolvedUser?.username ?? username;
  const resolvedDisplayName = resolvedUser?.display_name || displayName || resolvedUsername;
  const resolvedAvatarUrl = resolvedUser?.avatar_url ?? avatarUrl;
  const resolvedAvatarDisplay = resolvedUser?.avatar_display ?? avatarDisplay;
  const resolvedStatus = resolvedUser?.status ?? member?.user.status;
  const profileThemeStyle = getProfileThemeVariables(resolvedUser ?? {});

  useEffect(() => {
    setOptimisticRoles(member?.roles);
  }, [member?.roles]);

  const fetchUserProfile = useCallback(() => {
    if (userId && userId !== state.user?.id) {
      setLocalState({ loadingProfile: true, profileUser: null });

      apiGet<{
        user: User;
        mutualFriends: { count: number; items: Array<{ id: string; username: string; display_name?: string | null; avatar_url?: string | null }> };
        mutualServers: { count: number; items: Array<{ id: string; name: string; icon_url?: string | null }> };
      }>(`/api/users/${userId}/profile`)
        .then(data => {
          setLocalState({
            profileUser: data.user,
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
    const isMobile = window.innerWidth < 768;
    const viewportPadding = isMobile ? 8 : 10;
    const maxWidth = window.innerWidth - (viewportPadding * 2);
    const maxHeight = Math.min(
      window.innerHeight - (viewportPadding * 2),
      isMobile ? MOBILE_MAX_SURFACE_HEIGHT : DESKTOP_MAX_SURFACE_HEIGHT,
    );
    let height = maxHeight;
    let width = height * PROFILE_SURFACE_RATIO;

    if (width > maxWidth) {
      width = maxWidth;
      height = width / PROFILE_SURFACE_RATIO;
    }

    if (isMobile) {
      setLocalState({
        position: {
          top: Math.max(8, (window.innerHeight - height) / 2),
          left: Math.max(8, (window.innerWidth - width) / 2),
        },
        surfaceSize: { width, height },
      });
      return;
    }

    let top = 0;
    let left = 0;

    if (side === "left") {
      left = rect.left - width - 8;
      top = rect.top + (rect.height / 2) - (height / 2);
    } else if (side === "right") {
      left = rect.right + 8;
      top = rect.top + (rect.height / 2) - (height / 2);
    } else if (side === "top") {
      left = rect.left;
      top = rect.top - height - 8;
    } else {
      top = rect.bottom + 8;
      left = Math.min(rect.left, window.innerWidth - width - 8);
    }

    const finalTop = Math.max(10, Math.min(top, window.innerHeight - height - 10));
    const finalLeft = Math.max(10, Math.min(left, window.innerWidth - width - 10));

    setLocalState({
      position: {
        top: finalTop,
        left: finalLeft,
      },
      surfaceSize: { width, height },
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
    const serverId = state.activeServerId;
    if (!serverId) return;

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

    apiPut<Role[]>(`/api/servers/${serverId}/members/${userId}/roles`, { roleIds: newRoleIds })
      .then((roles) => {
        setOptimisticRoles(roles);
        state.dispatch({ type: "UPDATE_MEMBER_ROLES", serverId, userId, roles });
      })
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
      <section
        ref={popoverRef}
        className="fixed z-[1000] animate-in fade-in zoom-in-95 overflow-hidden rounded-[24px] border border-[color:var(--rm-profile-custom-card-border)] bg-rm-bg-elevated shadow-[0_20px_56px_rgba(0,0,0,0.62)] duration-200 outline-none md:rounded-[28px]"
        style={{
          top: localState.position.top,
          left: localState.position.left,
          width: localState.surfaceSize.width,
          height: localState.surfaceSize.height,
          ...profileThemeStyle,
          backgroundImage: "var(--rm-profile-custom-surface)",
        }}
        aria-label={`User profile for ${username}`}
        tabIndex={-1}
      >
        <div className="pointer-events-none absolute inset-0 z-0" style={{ background: "var(--rm-profile-custom-surface-overlay-strong)" }} />
        <ProfileCollectiblesLayer display={resolvedAvatarDisplay} effectOpacity={1} fit="contain" className="z-[60] opacity-[0.98]" />
        <div className="relative flex h-full flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto custom-scrollbar">
            <PopoverBanner
              bannerUrl={resolvedUser?.banner_url}
              bannerContentType={resolvedUser?.banner_content_type}
              canManageRoles={canManageRoles}
              isMe={isMe}
            />

            <PopoverAvatar avatarUrl={resolvedAvatarUrl} avatarDisplay={resolvedAvatarDisplay} displayName={resolvedDisplayName} isOnline={isOnline} status={resolvedStatus} />

            <PopoverInfo
              displayName={resolvedDisplayName}
              username={resolvedUsername}
              isMe={isMe}
              loadingProfile={localState.loadingProfile}
              mutualFriends={localState.mutualFriends}
              mutualServers={localState.mutualServers}
              displayNameStyle={resolvedUser?.display_name_style}
            />

            <div className="relative z-20">
              <PopoverRoles
                optimisticRoles={optimisticRoles}
                canManageRoles={canManageRoles}
                assignRole={assignRole}
                handleToggleAssignRoles={handleToggleAssignRoles}
                dropdownProps={dropdownProps}
              />
            </div>

            {!isMe && (
              <div className="relative z-20 mt-2 px-4 pb-4">
                <div className="group flex items-center justify-between rounded-lg border border-[color:var(--rm-profile-custom-card-border)] bg-[var(--rm-profile-custom-card-bg-strong)] px-3 py-2.5 transition-colors hover:border-white/25 focus-within:border-white/30">
                  <input
                    type="text"
                    aria-label={`Message ${resolvedUsername}`}
                    className="w-full bg-transparent text-xs font-medium text-[color:var(--rm-profile-custom-text)] outline-none placeholder:text-[color:var(--rm-profile-custom-muted)]"
                    placeholder={`Message @${resolvedUsername}`}
                  />
                  <Smile size={16} className="ml-2 shrink-0 cursor-pointer text-[color:var(--rm-profile-custom-muted)] transition-colors hover:text-[color:var(--rm-profile-custom-text)]" />
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>,
    document.body
  );
}
