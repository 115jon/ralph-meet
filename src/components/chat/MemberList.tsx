
import { useContextMenu } from "@/hooks/useContextMenu";
import { PERMISSIONS } from "@/lib/permissions";
import type { Role, User } from '@/lib/types';
import { cn } from "@/lib/utils";
import { useChatActions } from "@/stores/chat-store";
import { useState } from "react";
import ContextMenu from "./ContextMenu";
import { AlertTriangle, Copy, Crown, MessageSquare, User as UserIcon } from "./Icons";
import UserProfilePopover from "./UserProfilePopover";

import { ArrowLeft, Bell, ChevronRight, Hash, Search, Settings, UserPlus } from "lucide-react";

interface MemberListProps {
  members: Array<{ user: User; roles?: Role[] }>;
  onlineUsers: Set<string>;
  typingUsers?: Set<string>;
  currentUserId?: string;
  onBan?: (userId: string, username: string) => void;
  onClose?: () => void;
  channelName?: string;
}

// Helper to get the highest position role for a member
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

export default function MemberList({ members, onlineUsers, typingUsers, currentUserId, onBan, onClose, channelName }: MemberListProps) {
  const { menu, openMenu, closeMenu } = useContextMenu();
  const { openDm, dispatch, setProfileUser } = useChatActions();
  const [popoverUser, setPopoverUser] = useState<User | null>(null);
  const [popoverAnchor, setPopoverAnchor] = useState<HTMLElement | null>(null);
  const online = members.filter((m) => onlineUsers.has(m.user.id) && m.user.status !== 'offline');
  const offline = members.filter((m) => !onlineUsers.has(m.user.id) || m.user.status === 'offline');

  // Sort by highest role position then name
  const sortMembers = (a: { user: User; roles?: Role[] }, b: { user: User; roles?: Role[] }) => {
    const roleA = getHighestRole(a.roles)?.position ?? -1;
    const roleB = getHighestRole(b.roles)?.position ?? -1;
    if (roleA !== roleB) return roleB - roleA; // Descending role position
    return a.user.username.localeCompare(b.user.username);
  };

  const sortedOnline = [...online].sort(sortMembers);
  const sortedOffline = [...offline].sort(sortMembers);

  // Group online members by highest role
  const groups: { name: string; members: typeof sortedOnline }[] = [];
  const addGroup = (member: typeof sortedOnline[0]) => {
    const highestRole = getHighestRole(member.roles);
    const groupName = highestRole && !highestRole.is_default ? highestRole.name : "ONLINE";
    let group = groups.find(g => g.name === groupName);
    if (!group) {
      group = { name: groupName, members: [] };
      groups.push(group);
    }
    group.members.push(member);
  };

  sortedOnline.forEach(addGroup);

  return (
    <div
      data-testid="members-list"
      className="fixed inset-y-0 right-0 z-[100] flex h-full w-full shrink-0 flex-col overflow-hidden bg-rm-bg-primary shadow-2xl animate-in slide-in-from-right-full lg:static lg:z-auto lg:w-60 lg:bg-rm-bg-sidebar lg:shadow-none lg:animate-none transition-all duration-300"
    >
      {/* Mobile-only Header */}
      <div className="flex items-center justify-between p-4 lg:hidden sticky top-0 bg-rm-bg-primary z-10 shrink-0">
        <button onClick={onClose} className="p-1 -ml-1 text-rm-text-muted hover:text-rm-text transition-colors">
          <ArrowLeft size={24} />
        </button>
        <div className="flex items-center gap-5 text-rm-text-muted">
          <button className="hover:text-rm-text transition-colors"><Search size={22} /></button>
          <button className="hover:text-rm-text transition-colors"><Bell size={22} /></button>
          <button className="hover:text-rm-text transition-colors"><Settings size={22} /></button>
        </div>
      </div>

      <div className="flex-1 flex flex-col px-4 pt-2 lg:pt-4 lg:px-2 overflow-y-auto custom-scrollbar relative pb-10">

        {/* Mobile-only Title and Tabs */}
        <div className="lg:hidden mb-6 shrink-0">
          <div className="flex items-center gap-2 mb-1">
            <Hash size={24} className="text-rm-text-muted shrink-0" />
            <h1 className="text-[26px] font-extrabold text-rm-text-primary tracking-tight leading-none truncate">{channelName || "general"}</h1>
          </div>
          <p className="text-[13px] font-medium text-rm-text-muted mb-6 ml-8">Text Channel</p>

          <div className="flex gap-6 overflow-x-auto custom-scrollbar no-scrollbar text-[15px] font-semibold text-rm-text-muted border-b border-rm-border pb-2.5">
            <div className="shrink-0 text-rm-text-primary relative cursor-pointer">
              Members
              <div className="absolute -bottom-[11px] left-0 right-0 h-0.5 bg-primary rounded-t-full" />
            </div>
            <div className="shrink-0 hover:text-rm-text cursor-pointer transition-colors">Media</div>
            <div className="shrink-0 hover:text-rm-text cursor-pointer transition-colors">Pins</div>
            <div className="shrink-0 hover:text-rm-text cursor-pointer transition-colors">Threads</div>
            <div className="shrink-0 hover:text-rm-text cursor-pointer transition-colors">Links</div>
            <div className="shrink-0 hover:text-rm-text cursor-pointer transition-colors">Files</div>
          </div>
        </div>

        {/* Mobile-only Invite Button */}
        <div className="lg:hidden mb-6 shrink-0 pt-2">
          <button className="w-full flex items-center justify-between bg-rm-bg-elevated hover:bg-rm-bg-hover text-rm-text p-4 rounded-xl transition-colors ring-1 ring-rm-border shadow-sm">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary rounded-full text-primary-foreground border border-rm-border/50">
                <UserPlus size={18} fill="currentColor" className="opacity-90" />
              </div>
              <span className="font-bold text-[16px] text-rm-text-primary">Invite Members</span>
            </div>
            <ChevronRight size={20} className="text-rm-text-muted" />
          </button>
        </div>

        {groups.map(group => (
          <div key={group.name}>
            <div className="flex items-center px-2 py-[10px] text-[11px] font-bold text-rm-text-muted">
              <span className="uppercase">{group.name}</span>
              <span className="ml-[6px] text-[11px] font-semibold tracking-[-0.02em]">{group.members.length}</span>
            </div>
            {group.members.map((member) => (
              <MemberItem
                key={member.user.id}
                member={member}
                isOnline={true}
                isTyping={typingUsers?.has(member.user.id)}
                isMe={member.user.id === currentUserId}
                onClick={(e) => {
                  setPopoverAnchor(e.currentTarget);
                  setPopoverUser(member.user);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setProfileUser(member.user);
                  openMenu(e, [
                    {
                      label: "Profile",
                      icon: <UserIcon className="h-4 w-4" />,
                      onClick: () => setProfileUser(member.user),
                    },
                    {
                      label: "Message",
                      icon: <MessageSquare className="h-4 w-4" />,
                      onClick: async () => {
                        const channelId = await openDm(member.user.id);
                        if (channelId) {
                          dispatch({ type: "SWITCH_SERVER", serverId: "@me", channelId });
                        }
                      },
                    },
                    {
                      label: "Copy ID",
                      icon: <Copy className="h-4 w-4" />,
                      onClick: () => navigator.clipboard.writeText(member.user.id),
                      divider: !!onBan && member.user.id !== currentUserId,
                    },
                    ...(onBan && member.user.id !== currentUserId ? [{
                      label: "Ban",
                      icon: <AlertTriangle className="h-4 w-4" />,
                      onClick: () => onBan(member.user.id, member.user.username),
                      variant: "danger" as const,
                    }] : []),
                  ]);
                }}
              />
            ))}
          </div>
        ))}

        {sortedOffline.length > 0 && (
          <div>
            <div className="flex items-center px-2 py-[10px] text-[11px] font-bold text-rm-text-muted">
              <span className="uppercase">Offline</span>
              <span className="ml-[6px] text-[11px] font-semibold tracking-[-0.02em]">{sortedOffline.length}</span>
            </div>
            {sortedOffline.map((m) => (
              <MemberItem
                key={m.user.id}
                member={m}
                isOnline={false}
                isTyping={typingUsers?.has(m.user.id)}
                isMe={m.user.id === currentUserId}
                onClick={(e) => {
                  setPopoverUser(m.user);
                  setPopoverAnchor(e.currentTarget);
                }}
                onContextMenu={(e) => {
                  openMenu(e, [
                    {
                      label: "Profile",
                      icon: <UserIcon className="h-4 w-4" />,
                      onClick: () => setProfileUser(m.user),
                    },
                    {
                      label: "Message",
                      icon: <MessageSquare className="h-4 w-4" />,
                      onClick: async () => {
                        const channelId = await openDm(m.user.id);
                        if (channelId) {
                          dispatch({ type: "SWITCH_SERVER", serverId: "@me", channelId });
                        }
                      },
                    },
                    {
                      label: "Copy ID",
                      icon: <Copy className="h-4 w-4" />,
                      onClick: () => navigator.clipboard.writeText(m.user.id),
                      divider: !!onBan && m.user.id !== currentUserId,
                    },
                    ...(onBan && m.user.id !== currentUserId ? [{
                      label: "Ban",
                      icon: <AlertTriangle className="h-4 w-4" />,
                      onClick: () => onBan(m.user.id, m.user.username),
                      variant: "danger" as const,
                    }] : []),
                  ]);
                }}
              />
            ))}
          </div>
        )}

        {sortedOnline.length === 0 && sortedOffline.length === 0 && (
          <div className="py-4 text-center text-xs text-rm-text-muted">No members found</div>
        )}
      </div>

      {
        menu.isOpen && (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            items={menu.items}
            onClose={closeMenu}
          />
        )
      }

      {
        popoverUser && popoverAnchor && (
          <UserProfilePopover
            userId={popoverUser.id}
            username={popoverUser.username}
            avatarUrl={popoverUser.avatar_url}
            anchorEl={popoverAnchor}
            side="left"
            onClose={() => setPopoverUser(null)}
          />
        )
      }
    </div >
  );
}



function MemberItem({
  member,
  isOnline,
  isTyping,
  isMe,
  onClick,
  onContextMenu,
}: {
  member: { user: User; roles?: Role[] };
  isOnline: boolean;
  isTyping?: boolean;
  isMe?: boolean;
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onClick?.(e as any);
    }
  };

  return (
    <div
      className={cn(
        "group flex cursor-pointer items-center gap-3 lg:gap-2.5 transition-colors relative overflow-hidden",
        "bg-rm-bg-elevated px-3.5 py-3 mb-2 rounded-2xl shadow-sm border border-rm-border/30", // mobile
        "lg:bg-transparent lg:px-2 lg:py-1.5 lg:mb-0 lg:rounded-md lg:shadow-none lg:border-transparent lg:hover:bg-rm-bg-hover", // desktop
        !isOnline && "opacity-60 grayscale hover:opacity-100 hover:grayscale-0"
      )}
      onClick={(e) => { if (e.button === 0) onClick?.(e); }}
      onKeyDown={handleKeyDown}
      onContextMenu={onContextMenu}
      role="button"
      tabIndex={0}
      aria-label={`${member.user.username} (${isOnline ? 'Online' : 'Offline'})`}
    >
      <div className="relative z-10">
        <div className="flex h-10 w-10 lg:h-8 lg:w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary text-xs font-bold text-primary-foreground border border-rm-border transition-all group-hover:ring-2 group-hover:ring-primary/20">
          {member.user.avatar_url ? (
            <img
              src={member.user.avatar_url}
              alt={member.user.username}
              width={32}
              height={32}
              className="h-full w-full object-cover"
            />
          ) : (
            (member.user.username || '?').charAt(0).toUpperCase()
          )}
        </div>
        {isTyping && (member.user.status !== 'offline' || isMe) ? (
          <div className={cn(
            "absolute -bottom-0.5 -right-0.5 flex h-4 w-5 lg:h-3.5 lg:w-4.5 items-center justify-center gap-0.5 rounded-full border-2 border-rm-bg-elevated lg:border-rm-bg-sidebar px-0.5",
            (isMe && member.user.status === 'offline') ? "bg-rm-text-muted/40" : "bg-primary"
          )}>
            <span className="h-0.5 w-0.5 animate-bounce rounded-full bg-rm-bg-primary [animation-duration:0.6s]" />
            <span className="h-0.5 w-0.5 animate-bounce rounded-full bg-rm-bg-primary [animation-delay:0.2s] [animation-duration:0.6s]" />
            <span className="h-0.5 w-0.5 animate-bounce rounded-full bg-rm-bg-primary [animation-delay:0.4s] [animation-duration:0.6s]" />
          </div>
        ) : (
          <div className={cn(
            "absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 lg:h-3 lg:w-3 rounded-full border-2 border-rm-bg-elevated lg:border-rm-bg-sidebar transition-colors",
            isOnline ? (statusColors[member.user.status ?? "online"]) : "bg-rm-text-muted/40"
          )} />
        )}
      </div>
      <div className="min-w-0 flex-1 z-10">
        <div className="flex items-center gap-1.5">
          <div
            className={cn(
              "truncate text-[15px] lg:text-[13px] font-bold lg:font-medium leading-[1.1] transition-colors",
              !isOnline ? "text-rm-text-secondary" : "group-hover:text-rm-text"
            )}
            style={{ color: isOnline ? (getHighestRole(member.roles)?.color || undefined) : undefined }}
          >
            {member.user.username}
          </div>
          {(getHighestRole(member.roles)?.permissions ?? 0) & PERMISSIONS.ADMINISTRATOR ?
            <Crown className="h-3 w-3 fill-primary/20 text-primary" /> : null
          }
        </div>

        {member.user.custom_status && (
          <div className="truncate text-[11px] font-medium italic text-rm-text-muted mt-0.5">
            {member.user.custom_status}
          </div>
        )}
      </div>
    </div>
  );
}
