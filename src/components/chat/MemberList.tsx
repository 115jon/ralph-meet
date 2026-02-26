'use client';

import { useContextMenu } from "@/hooks/useContextMenu";
import { useChatActions } from "@/lib/chat-context";
import type { User } from '@/lib/types';
import { cn } from "@/lib/utils";
import { useState } from "react";
import ContextMenu from "./ContextMenu";
import { Copy, Crown, MessageSquare, ShieldCheck, User as UserIcon } from "./Icons";
import UserProfilePopover from "./UserProfilePopover";

interface MemberListProps {
  members: Array<{ user: User; role: number }>;
  onlineUsers: Set<string>;
  typingUsers?: Set<string>; // For the active channel
  currentUserId?: string;
}

const roleColorClasses: Record<number, string> = {
  3: 'text-primary',
  2: 'text-destructive',
  1: 'text-primary/70',
  0: 'text-rm-text-secondary',
};

const statusColors: Record<string, string> = {
  online: "bg-primary",
  idle: "bg-warning",
  dnd: "bg-destructive",
  offline: "bg-rm-text-muted/40",
};

export default function MemberList({ members, onlineUsers, typingUsers, currentUserId }: MemberListProps) {
  const { menu, openMenu, closeMenu } = useContextMenu();
  const { openDm, dispatch, setProfileUser } = useChatActions();
  const [popoverUser, setPopoverUser] = useState<User | null>(null);
  const [popoverAnchor, setPopoverAnchor] = useState<HTMLElement | null>(null);
  const online = members.filter((m) => onlineUsers.has(m.user.id) && m.user.status !== 'offline');
  const offline = members.filter((m) => !onlineUsers.has(m.user.id) || m.user.status === 'offline');

  // Sort by role then name
  const sortMembers = (a: { user: User; role: number }, b: { user: User; role: number }) => {
    if (b.role !== a.role) return b.role - a.role;
    return a.user.username.localeCompare(b.user.username);
  };

  const sortedOnline = [...online].sort(sortMembers);
  const sortedOffline = [...offline].sort(sortMembers);

  return (
    <div data-testid="members-list" className="hidden h-full w-60 shrink-0 flex-col overflow-hidden bg-rm-bg-sidebar backdrop-blur-xl lg:flex">

      <div className="flex-1 space-y-6 overflow-y-auto p-3 custom-scrollbar">
        {sortedOnline.length > 0 && (
          <div>
            <div className="mb-2 flex items-center justify-between px-2 text-[11px] font-semibold uppercase tracking-[0.05em] text-rm-text-muted">
              <span>Online — {sortedOnline.length}</span>
            </div>
            <div className="space-y-1">
              {sortedOnline.map((m) => (
                <MemberItem
                  key={m.user.id}
                  member={m}
                  isOnline
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
                        divider: false,
                      }
                    ]);
                  }}
                />
              ))}
            </div>
          </div>
        )}
        {sortedOffline.length > 0 && (
          <div>
            <div className="mb-2 mt-4 px-2 text-[11px] font-semibold uppercase tracking-[0.05em] text-rm-text-muted">
              Offline — {sortedOffline.length}
            </div>
            <div className="space-y-1">
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
                        divider: false,
                      }
                    ]);
                  }}
                />
              ))}
            </div>
          </div>
        )}
        {sortedOnline.length === 0 && sortedOffline.length === 0 && (
          <div className="py-4 text-center text-xs text-rm-text-muted">No members found</div>
        )}
      </div>

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
          side="left"
          onClose={() => setPopoverUser(null)}
        />
      )}
    </div>
  );
}

import NextImage from "next/image";

function MemberItem({
  member,
  isOnline,
  isTyping,
  isMe,
  onClick,
  onContextMenu,
}: {
  member: { user: User; role: number };
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
        "group flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-rm-bg-hover",
        !isOnline && "opacity-50 grayscale hover:opacity-100 hover:grayscale-0"
      )}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      onContextMenu={onContextMenu}
      role="button"
      tabIndex={0}
      aria-label={`${member.user.username} (${isOnline ? 'Online' : 'Offline'})`}
    >
      <div className="relative">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary text-xs font-bold text-primary-foreground border border-rm-border transition-all group-hover:ring-2 group-hover:ring-primary/20">
          {member.user.avatar_url ? (
            <NextImage
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
            "absolute -bottom-0.5 -right-0.5 flex h-3.5 w-4.5 items-center justify-center gap-0.5 rounded-full border-2 border-rm-bg-sidebar px-0.5",
            (isMe && member.user.status === 'offline') ? "bg-rm-text-muted/40" : "bg-primary"
          )}>
            <span className="h-0.5 w-0.5 animate-bounce rounded-full bg-rm-bg-primary [animation-duration:0.6s]" />
            <span className="h-0.5 w-0.5 animate-bounce rounded-full bg-rm-bg-primary [animation-delay:0.2s] [animation-duration:0.6s]" />
            <span className="h-0.5 w-0.5 animate-bounce rounded-full bg-rm-bg-primary [animation-delay:0.4s] [animation-duration:0.6s]" />
          </div>
        ) : (
          <div className={cn(
            "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-rm-bg-sidebar transition-colors",
            isOnline ? (statusColors[member.user.status ?? "online"]) : "bg-rm-text-muted/40"
          )} />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <div className={cn(
            "truncate text-[13px] font-medium leading-[1.1] transition-colors",
            roleColorClasses[member.role] || "text-rm-text-secondary",
            !isOnline ? "" : "group-hover:text-rm-text"
          )}>
            {member.user.username}
          </div>
          {member.role === 3 && <Crown className="h-3 w-3 fill-primary/20 text-primary" />}
          {member.role === 2 && <ShieldCheck className="h-3 w-3 fill-destructive/20 text-destructive" />}
          {member.role === 1 && <ShieldCheck className="h-3 w-3 fill-primary/20 text-primary/70" />}
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
