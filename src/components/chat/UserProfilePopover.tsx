"use client";

import { apiGet, apiPut } from "@/lib/api-client";
import { useChatState } from "@/lib/chat-context";
import { extractDominantColor } from "@/lib/color-utils";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import type { Role } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Check, FilePlus, MoreHorizontal, Plus, Smile, Swords, UserCheck, X } from "lucide-react";
import NextImage from "next/image";
import { useEffect, useRef, useState } from "react";

import { createPortal } from "react-dom";

interface Props {
  userId: string;
  username: string;
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

export default function UserProfilePopover({ userId, username, avatarUrl, anchorEl, onClose, side = "bottom", align = "start" }: Props) {
  const state = useChatState();
  const popoverRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [isAssigningRoles, setIsAssigningRoles] = useState(false);
  const [serverRoles, setServerRoles] = useState<Role[]>([]);
  const [loadingRoles, setLoadingRoles] = useState(false);
  const [bannerColor, setBannerColor] = useState<string | null>(null);
  const [mutualFriends, setMutualFriends] = useState(0);
  const [mutualServers, setMutualServers] = useState(0);
  const [loadingProfile, setLoadingProfile] = useState(false);

  const member = state.members.find((m) => m.user.id === userId);
  const [optimisticRoles, setOptimisticRoles] = useState<Role[] | undefined>(member?.roles);

  useEffect(() => {
    setOptimisticRoles(member?.roles);
  }, [member?.roles]);

  useEffect(() => {
    if (avatarUrl) {
      extractDominantColor(avatarUrl).then(color => {
        if (color) setBannerColor(color);
      });
    }
  }, [avatarUrl]);

  useEffect(() => {
    if (userId && userId !== state.user?.id) {
      setLoadingProfile(true);

      apiGet<{ mutualFriends: number; mutualServers: number; }>(`/api/users/${userId}/profile`)
        .then(data => {
          setMutualFriends(data.mutualFriends || 0);
          setMutualServers(data.mutualServers || 0);
        })
        .catch(console.error)
        .finally(() => setLoadingProfile(false));
    }
  }, [userId, state.user?.id]);

  useEffect(() => {
    const rect = anchorEl.getBoundingClientRect();
    const width = 280;
    const height = 320; // Estimated max height

    let top = 0;
    let left = 0;

    if (side === "left") {
      left = rect.left - width - 8;
      top = rect.top + (rect.height / 2) - (150); // Center relative to anchor
    } else if (side === "right") {
      left = rect.right + 8;
      top = rect.top + (rect.height / 2) - 150;
    } else if (side === "top") {
      left = rect.left;
      top = rect.top - height - 8;
    } else {
      // Bottom (default)
      top = rect.bottom + 8;
      left = Math.min(rect.left, window.innerWidth - width - 8);
    }

    // Boundary checks
    const finalTop = Math.max(8, Math.min(top, window.innerHeight - 350));
    const finalLeft = Math.max(8, Math.min(left, window.innerWidth - width - 8));

    setPosition({
      top: finalTop,
      left: finalLeft,
    });
  }, [anchorEl, side]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        !(dropdownRef.current && dropdownRef.current.contains(e.target as Node))
      ) {
        onClose();
      }
    };
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handler);
    }, 50);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handler);
    };
  }, [onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const isOnline = state.onlineUsers.has(userId);
  const highestRole = getHighestRole(optimisticRoles);
  const roleLabel = highestRole?.name || "Member";

  // Check if current user has permission to manage roles
  const myMember = state.members.find((m) => m.user.id === state.user?.id);
  const myTotalPerms = myMember?.roles?.reduce((acc, r) => acc | r.permissions, 0) ?? 0;
  const canManageRoles = hasPermission(myTotalPerms, PERMISSIONS.MANAGE_ROLES);

  const fetchRoles = async () => {
    if (serverRoles.length > 0) return;
    setLoadingRoles(true);
    try {
      const data = await apiGet<Role[]>(`/api/servers/${state.activeServerId}/roles`);
      setServerRoles(data);
    } catch (err) {
      console.error("Failed to fetch roles:", err);
    } finally {
      setLoadingRoles(false);
    }
  };

  const handleToggleAssignRoles = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isAssigningRoles) fetchRoles();
    setIsAssigningRoles(!isAssigningRoles);
  };

  const assignRole = (roleId: string, currentRoleIds: string[]) => {
    if (!state.activeServerId) return;

    const roleObj = serverRoles.find(r => r.id === roleId);
    if (!roleObj) return;

    const isAdding = !currentRoleIds.includes(roleId);
    const newRoleIds = isAdding
      ? [...currentRoleIds, roleId]
      : currentRoleIds.filter(id => id !== roleId);

    // Optimistic UI Update
    if (isAdding) {
      setOptimisticRoles(prev => prev ? [...prev, roleObj] : [roleObj]);
    } else {
      setOptimisticRoles(prev => prev?.filter(r => r.id !== roleId) || []);
    }

    // Fire API asynchronously
    apiPut(`/api/servers/${state.activeServerId}/members/${userId}/roles`, { roleIds: newRoleIds })
      .catch(err => {
        console.error("Failed to assign role:", err);
        // Revert optimistic update on failure
        setOptimisticRoles(member?.roles);
      });
  };

  return createPortal(
    <>
      {/* Overlay to block interaction and close on click-outside */}
      <div
        className="fixed inset-0 z-[999] cursor-default bg-transparent"
        onClick={onClose}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " " || e.key === "Escape") onClose(); }}
        role="presentation"
        aria-hidden="true"
      />
      <div
        ref={popoverRef}
        className="fixed z-[1000] w-[280px] animate-in fade-in zoom-in-95 rounded-2xl border border-rm-border bg-rm-bg-primary shadow-[0_16px_48px_rgba(0,0,0,0.6)] duration-200 outline-none"
        style={{ top: position.top, left: position.left }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") e.stopPropagation(); }}
        role="dialog"
        aria-modal="true"
        aria-label={`User profile for ${username}`}
        tabIndex={-1}
      >
        {/* Banner with Action Buttons */}
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
            {userId !== state.user?.id && (
              <button className="bg-black/40 hover:bg-black/60 text-white p-1.5 rounded-full transition-colors backdrop-blur-sm" title="Friends">
                <UserCheck size={16} />
              </button>
            )}
            <button className="bg-black/40 hover:bg-black/60 text-white p-1.5 rounded-full transition-colors backdrop-blur-sm" title="More Options">
              <MoreHorizontal size={16} />
            </button>
          </div>
        </div>

        {/* Avatar */}
        <div className="relative -mt-12 px-4">
          <div className="relative inline-block rounded-full bg-rm-bg-primary p-1.5">
            <div className="relative flex h-[80px] w-[80px] items-center justify-center overflow-hidden rounded-full bg-primary text-2xl font-bold text-primary-foreground border-rm-border transition-all shadow-sm">
              {avatarUrl ? (
                <NextImage src={avatarUrl} alt={username} fill className="object-cover" />
              ) : (
                username[0].toUpperCase()
              )}
            </div>
            <div className="absolute bottom-1 right-1 rounded-full bg-rm-bg-primary p-1">
              <span
                className={cn(
                  "block h-5 w-5 rounded-full border-rm-bg-primary",
                  isOnline ? (statusColors[member?.user.status ?? "online"]) : statusColors["offline"]
                )}
              />
            </div>
          </div>
        </div>

        {/* Info & Mutuals */}
        <div className="px-4 pb-3 pt-1">
          <div className="flex items-center gap-1.5">
            <h3 className="text-xl font-bold text-rm-text leading-tight">{username}</h3>
            {userId !== state.user?.id && (
              <button className="text-rm-text-muted hover:text-rm-text mt-0.5">
                <FilePlus size={16} />
              </button>
            )}
          </div>
          <div className="text-sm font-medium text-rm-text-muted">{username.toLowerCase()}</div>

          {userId !== state.user?.id && !loadingProfile && (mutualFriends > 0 || mutualServers > 0) ? (
            <div className="flex items-center gap-2 text-[11px] font-semibold text-rm-text-muted mt-3 mb-1">
              <div className="flex -space-x-1 shrink-0">
                <div className="w-4 h-4 rounded-full bg-rm-bg-surface border border-rm-border flex items-center justify-center overflow-hidden">
                  <NextImage src="https://github.com/shadcn.png" alt="friend" width={16} height={16} />
                </div>
              </div>
              <span>
                {mutualFriends > 0 && `${mutualFriends} Mutual Friend${mutualFriends === 1 ? '' : 's'}`}
                {mutualFriends > 0 && mutualServers > 0 && ' • '}
                {mutualServers > 0 && `${mutualServers} Mutual Server${mutualServers === 1 ? '' : 's'}`}
              </span>
            </div>
          ) : (
            <div className="h-4" />
          )}
        </div>

        {/* Roles */}
        <div className="px-4 pb-3 relative">
          <div className="flex flex-wrap items-center gap-1.5 mt-1">
            {optimisticRoles?.filter(r => !r.is_default).map(role => (
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
                      const currentRoles = optimisticRoles?.map(r => r.id) || [];
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

          {/* Role Assignment Dropdown */}
          {isAssigningRoles && (
            <div
              ref={dropdownRef}
              className="absolute right-4 top-8 w-48 z-[1010] bg-rm-bg-secondary rounded-lg border border-rm-border shadow-xl p-1 animate-in fade-in zoom-in-95"
            >
              {loadingRoles ? (
                <div className="p-3 text-center text-xs text-rm-text-muted">Loading...</div>
              ) : (
                <div className="max-h-48 overflow-y-auto custom-scrollbar">
                  {serverRoles.filter(r => !r.is_default).length === 0 ? (
                    <div className="p-2 text-center text-xs text-rm-text-muted">No custom roles available</div>
                  ) : (
                    serverRoles.filter(r => !r.is_default).map(role => {
                      const hasRole = optimisticRoles?.some(r => r.id === role.id);
                      return (
                        <button
                          key={role.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            const currentRoles = optimisticRoles?.map(r => r.id) || [];
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
          )}
        </div>

        {userId !== state.user?.id && (
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
    </>,
    document.body
  );
}
