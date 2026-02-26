"use client";

import { useContextMenu } from "@/hooks/useContextMenu";
import type { VoiceChannelMember } from "@/lib/chat-context";
import { useChatActions, useChatState } from "@/lib/chat-context";
import type { Category, Channel } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  Bell,
  CalendarPlus,
  ChevronDown,
  Copy,
  Edit2,
  EyeOff,
  FolderPlus,
  Gem,
  Hash,
  LayoutGrid,
  MessageSquare,
  MicOff,
  Plus,
  PlusCircle,
  Settings,
  Shield,
  Trash2,
  User as UserIcon,
  UserPlus,
  Volume2
} from "lucide-react";
import NextImage from "next/image";
import { useReducer } from "react";
import ContextMenu from "./ContextMenu";
import CreateCategoryModal from "./CreateCategoryModal";
import CreateChannelModal from "./CreateChannelModal";
import UserProfilePopover from "./UserProfilePopover";

const EMPTY_CATEGORIES: Category[] = [];
const EMPTY_READ_STATES: Record<string, string> = {};
const EMPTY_LAST_MESSAGE_AT: Record<string, string> = {};
const EMPTY_VOICE_STATES: Record<string, VoiceChannelMember[]> = {};

interface Props {
  channels: Channel[];
  categories?: Category[];
  activeChannelId: string | null;
  serverId: string | null;
  serverName: string;
  onSelect: (channelId: string) => void;
  onInviteClick?: () => void;
  onSettingsClick?: () => void;
  readStates?: Record<string, string>;
  lastMessageAt?: Record<string, string>;
  voiceChannelStates?: Record<string, VoiceChannelMember[]>;
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

interface CategoryGroup {
  id: string | null;
  name: string;
  channels: Channel[];
}

function groupChannelsByCategory(channels: Channel[], categories: Category[]): CategoryGroup[] {
  const groups: CategoryGroup[] = [];
  const catMap = new Map<string, Category>();
  for (const cat of categories) {
    catMap.set(cat.id, cat);
  }

  // 1. Uncategorized channels
  const uncategorizedText = channels.filter(c => !c.category_id && c.channel_type === "text");
  const uncategorizedVoice = channels.filter(c => !c.category_id && c.channel_type === "voice");

  if (uncategorizedText.length > 0) {
    groups.push({ id: "__uncategorized_text__", name: "TEXT CHANNELS", channels: uncategorizedText });
  }
  if (uncategorizedVoice.length > 0) {
    groups.push({ id: "__uncategorized_voice__", name: "VOICE CHANNELS", channels: uncategorizedVoice });
  }

  // 2. Scheduled/Sorted categories
  const byCategory = new Map<string, Channel[]>();
  for (const ch of channels) {
    if (ch.category_id && catMap.has(ch.category_id)) {
      const list = byCategory.get(ch.category_id) ?? [];
      list.push(ch);
      byCategory.set(ch.category_id, list);
    }
  }

  const sortedCats = [...categories].sort((a, b) => a.rank - b.rank);
  for (const cat of sortedCats) {
    const chans = byCategory.get(cat.id) ?? [];
    groups.push({ id: cat.id, name: cat.name, channels: chans });
  }

  return groups;
}

export default function ChannelSidebar({
  channels,
  categories = EMPTY_CATEGORIES,
  activeChannelId,
  serverName,
  onSelect,
  onInviteClick,
  onSettingsClick,
  readStates = EMPTY_READ_STATES,
  lastMessageAt = EMPTY_LAST_MESSAGE_AT,
  voiceChannelStates = EMPTY_VOICE_STATES,
  serverId,
}: Props) {
  const {
    user,
    speakingUsers,
  } = useChatState();
  const { deleteChannel, deleteCategory, openDm, dispatch, setProfileUser } = useChatActions();

  type SidebarState = {
    collapsedCategories: Set<string>;
    showCreateCategory: boolean;
    showCreateChannel: { categoryId: string | null } | null;
    popoverUser: { id: string; username: string; avatar_url?: string } | null;
    popoverAnchor: HTMLElement | null;
  };

  const [state, uiDispatch] = useReducer((s: SidebarState, a: any) => {
    switch (a.type) {
      case 'TOGGLE_CATEGORY': {
        const next = new Set(s.collapsedCategories);
        if (next.has(a.id)) next.delete(a.id); else next.add(a.id);
        return { ...s, collapsedCategories: next };
      }
      case 'SET_CREATE_CATEGORY': return { ...s, showCreateCategory: a.value };
      case 'SET_CREATE_CHANNEL': return { ...s, showCreateChannel: a.value };
      case 'SET_POPOVER_USER': return { ...s, popoverUser: a.user, popoverAnchor: a.anchor };
      default: return s;
    }
  }, {
    collapsedCategories: new Set<string>(),
    showCreateCategory: false,
    showCreateChannel: null,
    popoverUser: null,
    popoverAnchor: null
  });

  const { collapsedCategories, showCreateCategory, showCreateChannel, popoverUser, popoverAnchor } = state;
  const { menu, openMenu, closeMenu } = useContextMenu();

  const handleChannelContextMenu = (e: React.MouseEvent, channel: Channel) => {
    openMenu(e, [
      {
        label: "Copy ID",
        icon: <Copy className="h-4 w-4" />,
        onClick: () => navigator.clipboard.writeText(channel.id),
      },
      {
        label: "Delete Channel",
        icon: <Trash2 className="h-4 w-4" />,
        onClick: () => {
          if (confirm(`Delete channel "${channel.name}"?`)) {
            deleteChannel(channel.id);
          }
        },
        variant: "danger",
      },
    ]);
  };

  const handleCategoryContextMenu = (e: React.MouseEvent, group: CategoryGroup) => {
    if (!group.id || group.id.startsWith("__")) return;
    openMenu(e, [
      {
        label: "Create Channel",
        icon: <Plus className="h-4 w-4" />,
        onClick: () => uiDispatch({ type: 'SET_CREATE_CHANNEL', value: { categoryId: group.id } }),
      },
      {
        label: "Copy ID",
        icon: <Copy className="h-4 w-4" />,
        onClick: () => navigator.clipboard.writeText(group.id!),
      },
      {
        label: "Delete Category",
        icon: <Trash2 className="h-4 w-4" />,
        onClick: () => {
          if (serverId && group.id) {
            if (confirm(`Delete category "${group.name}"?`)) {
              deleteCategory(group.id, serverId);
            }
          }
        },
        variant: "danger",
      },
    ]);
  };

  const handleUserContextMenu = (e: React.MouseEvent, target: { id: string; name: string }) => {
    openMenu(e, [
      {
        label: "Profile",
        icon: <UserIcon className="h-4 w-4" />,
        onClick: () => setProfileUser(target as any),
      },
      {
        label: "Message",
        icon: <MessageSquare className="h-4 w-4" />,
        onClick: () => openDm(target.id),
      },
      {
        label: "Copy ID",
        icon: <Copy className="h-4 w-4" />,
        onClick: () => navigator.clipboard.writeText(target.id),
      },
    ]);
  };

  const toggleCategory = (catId: string) => {
    uiDispatch({ type: 'TOGGLE_CATEGORY', id: catId });
  };

  const handleSidebarContextMenu = (e: React.MouseEvent) => {
    openMenu(e, [
      {
        label: "Create Channel",
        onClick: () => uiDispatch({ type: 'SET_CREATE_CHANNEL', value: { categoryId: null } }),
      },
      {
        label: "Create Category",
        onClick: () => uiDispatch({ type: 'SET_CREATE_CATEGORY', value: true }),
      },
      {
        label: "Invite to Server",
        divider: true,
        onClick: () => onInviteClick?.(),
      },
      {
        label: "Copy ID",
        icon: <Copy className="h-4 w-4" />,
        onClick: () => serverId && navigator.clipboard.writeText(serverId),
      },
    ]);
  };

  const handleServerHeaderClick = (e: React.MouseEvent | React.KeyboardEvent) => {
    openMenu(e as any, [
      {
        label: "Server Boost",
        icon: <Gem className="h-4 w-4" />,
        onClick: () => { },
      },
      {
        label: "Invite to Server",
        icon: <UserPlus className="h-4 w-4" />,
        divider: true,
        variant: "default",
        onClick: () => onInviteClick?.(),
      },
      {
        label: "Server Settings",
        icon: <Settings className="h-4 w-4" />,
        onClick: () => onSettingsClick?.(),
      },
      {
        label: "Create Channel",
        icon: <PlusCircle className="h-4 w-4" />,
        onClick: () => uiDispatch({ type: 'SET_CREATE_CHANNEL', value: { categoryId: null } }),
      },
      {
        label: "Create Category",
        icon: <FolderPlus className="h-4 w-4" />,
        onClick: () => uiDispatch({ type: 'SET_CREATE_CATEGORY', value: true }),
      },
      {
        label: "Create Event",
        icon: <CalendarPlus className="h-4 w-4" />,
        onClick: () => { },
      },
      {
        label: "App Directory",
        icon: <LayoutGrid className="h-4 w-4" />,
        divider: true,
        onClick: () => { },
      },
      {
        label: "Notification Settings",
        icon: <Bell className="h-4 w-4" />,
        onClick: () => { },
      },
      {
        label: "Privacy Settings",
        icon: <Shield className="h-4 w-4" />,
        divider: true,
        onClick: () => { },
      },
      {
        label: "Edit Per-server Profile",
        icon: <Edit2 className="h-4 w-4" />,
        onClick: () => { },
      },
      {
        label: "Hide Muted Channels",
        icon: <EyeOff className="h-4 w-4" />,
        onClick: () => { },
      },
    ]);
  };

  const grouped = groupChannelsByCategory(channels, categories);

  return (
    <div
      className="flex h-full flex-col bg-rm-bg-secondary select-none border-x border-rm-border rounded-tl-lg overflow-hidden"
      onContextMenu={handleSidebarContextMenu}
    >
      {/* Server Header */}
      <div
        className="flex h-12 cursor-pointer items-center justify-between px-4 font-bold text-rm-text shadow-sm transition-colors hover:bg-rm-bg-hover active:bg-rm-bg-active outline-none"
        onClick={handleServerHeaderClick}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleServerHeaderClick(e); } }}
        role="button"
        tabIndex={0}
      >
        <div className="flex items-center min-w-0">
          <h1 className="truncate text-[15px]">{serverName}</h1>
          <ChevronDown className="ml-1 h-3.5 w-3.5 opacity-60 shrink-0" />
        </div>
      </div>

      {/* Channels List */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin py-3 px-2">
        {grouped.map((group) => {
          const isCollapsed = collapsedCategories.has(group.id || "");
          const canManage = !group.id?.startsWith("__");

          return (
            <div key={group.id || "uncategorized"} className="mb-4">
              {/* Category Header */}
              <div
                className="group flex cursor-pointer items-center py-1 pr-2 transition-colors hover:text-rm-text text-rm-text-muted"
                onContextMenu={(e) => handleCategoryContextMenu(e, group)}
              >
                <div
                  className="flex flex-1 items-center gap-0.5 overflow-hidden outline-none"
                  onClick={() => group.id && toggleCategory(group.id)}
                  onKeyDown={(e) => { if (group.id && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); toggleCategory(group.id); } }}
                  role="button"
                  tabIndex={0}
                >
                  <ChevronDown
                    className={cn(
                      "h-3 w-3 shrink-0 transition-transform duration-200",
                      isCollapsed && "-rotate-90"
                    )}
                  />
                  <span className="truncate text-[12px] font-bold tracking-wide uppercase leading-none pt-0.5">
                    {group.name}
                  </span>
                </div>
                <Plus
                  className="h-4 w-4 cursor-pointer hover:text-rm-text transition-colors"
                  onClick={() => uiDispatch({ type: 'SET_CREATE_CHANNEL', value: { categoryId: group.id?.startsWith("__") ? null : group.id } })}
                />
              </div>

              {/* Channels */}
              {group.channels.map((channel) => {
                const isActive = activeChannelId === channel.id;
                const isVoice = channel.channel_type === "voice";
                const vcMembers = voiceChannelStates[channel.id] || [];
                const isConnectedVoice = isVoice && vcMembers.some((m) => m.clerk_user_id === user?.id);

                if (isCollapsed && !isActive && !isConnectedVoice) {
                  return null;
                }

                const unread = !isActive && isUnread(channel.id, readStates, lastMessageAt);

                return (
                  <div key={channel.id}>
                    <div
                      onContextMenu={(e) => handleChannelContextMenu(e, channel)}
                      onClick={() => onSelect(channel.id)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(channel.id); } }}
                      role="button"
                      tabIndex={0}
                      className={cn(
                        "group relative mb-[2px] mx-2 flex cursor-pointer items-center gap-1.5 rounded-[4px] px-2 py-1.5 transition-colors outline-none",
                        isActive ? "bg-rm-bg-active text-rm-text" : "text-rm-text-muted hover:bg-rm-bg-hover hover:text-rm-text-muted",
                        unread && !isActive && "text-rm-text font-semibold"
                      )}
                    >
                      {isVoice ? (
                        <Volume2 className="h-4 w-4 shrink-0 opacity-60" />
                      ) : (
                        <Hash className="h-4 w-4 shrink-0 opacity-60" />
                      )}

                      <span className="flex-1 truncate text-[15px] font-medium">
                        {channel.name}
                      </span>

                      {/* Icons column */}
                      <div className="flex items-center gap-1">
                        <Plus className="h-3.5 w-3.5 opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity"
                          onClick={(e) => {
                            e.stopPropagation();
                            uiDispatch({ type: 'SET_CREATE_CHANNEL', value: { categoryId: group.id?.startsWith("__") ? null : group.id } });
                          }}
                        />
                      </div>

                      {/* Unread dot */}
                      {unread && (
                        <div className="absolute -left-2 h-2 w-1 rounded-r-full bg-rm-text" />
                      )}
                    </div>

                    {/* Voice Members List */}
                    {isVoice && vcMembers.length > 0 && (
                      <div className="mb-2 ml-7 flex flex-col gap-0.5">
                        {vcMembers.map((m) => {
                          return (
                            <div
                              key={m.clerk_user_id}
                              className="group/vc-user flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 transition-colors hover:bg-rm-bg-hover outline-none"
                              onContextMenu={(e) => handleUserContextMenu(e, { id: m.clerk_user_id, name: m.name })}
                              onClick={(e) => {
                                e.stopPropagation();
                                uiDispatch({ type: 'SET_POPOVER_USER', user: { id: m.clerk_user_id, username: m.name, avatar_url: m.avatar_url }, anchor: e.currentTarget });
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  uiDispatch({ type: 'SET_POPOVER_USER', user: { id: m.clerk_user_id, username: m.name, avatar_url: m.avatar_url }, anchor: e.currentTarget });
                                }
                              }}
                              role="button"
                              tabIndex={0}
                            >
                              <div className={cn(
                                "relative h-[24px] w-[24px] shrink-0 rounded-full transition-transform active:scale-95",
                                speakingUsers[m.clerk_user_id] ? "ring-[3px] ring-primary shadow-[0_0_20px_var(--rm-glow)] ring-offset-2 ring-offset-rm-bg-secondary z-10" : "z-0"
                              )}>
                                <div className="absolute inset-0 overflow-hidden rounded-full">
                                  {m.avatar_url ? (
                                    <NextImage src={m.avatar_url} alt="" fill className="object-cover" />
                                  ) : (
                                    <div className="flex h-full w-full items-center justify-center bg-primary/10 text-[10px] font-bold text-primary">
                                      {m.name[0].toUpperCase()}
                                    </div>
                                  )}
                                </div>
                              </div>
                              <span className="flex-1 truncate text-[14px] font-medium text-rm-text-muted group-hover/vc-user:text-rm-text">
                                {m.name}
                              </span>
                              <div className="flex items-center gap-0.5 opacity-60">
                                {m.self_stream && <div className="rounded bg-rm-danger px-1 text-[8px] font-extrabold text-white">LIVE</div>}
                                {m.self_video && <Shield className="h-3 w-3" />}
                                {m.self_mute && <MicOff className="h-3 w-3 text-rm-danger" />}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>



      {/* Modals & Popovers */}
      {
        showCreateCategory && serverId && (
          <CreateCategoryModal serverId={serverId} onClose={() => uiDispatch({ type: 'SET_CREATE_CATEGORY', value: false })} />
        )
      }
      {
        showCreateChannel && serverId && (
          <CreateChannelModal serverId={serverId} defaultCategoryId={showCreateChannel.categoryId} onClose={() => uiDispatch({ type: 'SET_CREATE_CHANNEL', value: null })} />
        )
      }
      {
        popoverUser && popoverAnchor && (
          <UserProfilePopover userId={popoverUser.id} username={popoverUser.username} avatarUrl={popoverUser.avatar_url} anchorEl={popoverAnchor} onClose={() => uiDispatch({ type: 'SET_POPOVER_USER', user: null, anchor: null })} />
        )
      }

      {/* Context Menu Placeholder */}
      <div id="channel-context-menu" />
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
    </div >
  );
}
