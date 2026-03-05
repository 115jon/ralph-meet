
import { useContextMenu } from "@/hooks/useContextMenu";
import { apiGet } from "@/lib/api-client";
import { getFileIcon } from "@/lib/file-icons";
import { PERMISSIONS } from "@/lib/permissions";
import type { Attachment, Message, Role, User } from '@/lib/types';
import { cn } from "@/lib/utils";
import { useChatActions } from "@/stores/chat-store";
import { useImageViewerActions } from "@/stores/useImageViewerStore";
import { useCallback, useEffect, useState } from "react";
import ContextMenu from "./ContextMenu";
import { AlertTriangle, Copy, Crown, MessageSquare, Pin, User as UserIcon } from "./Icons";
import { MarkdownRenderer } from "./MarkdownRenderer";
import MobileProfileSheet from "./MobileProfileSheet";
import UserProfilePopover from "./UserProfilePopover";

import { ArrowLeft, Bell, ChevronRight, Download, ExternalLink, Hash, Image, ImageOff, Link2, MessageCircle, RefreshCw, Search, Settings, TriangleAlert, UserPlus, WifiOff } from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────

type TabId = 'members' | 'media' | 'pins' | 'threads' | 'links' | 'files';

interface MediaItem {
  id: string;
  message_id: string;
  filename: string;
  url: string;
  content_type: string;
  size_bytes: number;
  author: { id: string; username: string; avatar_url: string | null };
  created_at: string;
}

interface LinkItem {
  id: string;
  message_id: string;
  content: string;
  author: { id: string; username: string; avatar_url: string | null };
  created_at: string;
}

interface ThreadItem {
  id: string;
  content: string;
  author: { id: string; username: string; avatar_url: string | null };
  reply_count: number;
  last_reply_at: string;
  created_at: string;
}

interface MemberListProps {
  members: Array<{ user: User; roles?: Role[] }>;
  onlineUsers: Set<string>;
  typingUsers?: Set<string>;
  currentUserId?: string;
  onBan?: (userId: string, username: string) => void;
  onClose?: () => void;
  channelName?: string;
  // New callbacks for mobile channel details
  channelId?: string | null;
  serverId?: string | null;
  onOpenSearch?: () => void;
  onOpenSettings?: () => void;
  onInviteClick?: () => void;
  // Pins support
  pinnedMessages?: Message[];
  loadingPins?: boolean;
  canUnpin?: boolean;
  onUnpin?: (messageId: string, skipConfirm: boolean) => void;
  onJumpToMessage?: (messageId: string) => void;
  // Threads support
  onOpenThread?: (messageId: string) => void;
  // Desktop channel details mode
  showDetails?: boolean;
  onToggleDetails?: () => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────

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

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatRelativeTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function extractUrls(text: string): string[] {
  const regex = /https?:\/\/[^\s<>)"'\]]+/g;
  return Array.from(text.matchAll(regex)).map(m => m[0]);
}

// ── Tabs ─────────────────────────────────────────────────────────────────

const TABS: { id: TabId; label: string }[] = [
  { id: 'members', label: 'Members' },
  { id: 'media', label: 'Media' },
  { id: 'pins', label: 'Pins' },
  { id: 'threads', label: 'Threads' },
  { id: 'links', label: 'Links' },
  { id: 'files', label: 'Files' },
];

// ── Main Component ──────────────────────────────────────────────────────

export default function MemberList({
  members, onlineUsers, typingUsers, currentUserId, onBan, onClose, channelName,
  channelId, serverId,
  onOpenSearch, onOpenSettings, onInviteClick,
  pinnedMessages, loadingPins, canUnpin, onUnpin, onJumpToMessage,
  onOpenThread,
  showDetails, onToggleDetails,
}: MemberListProps) {
  const { menu, openMenu, closeMenu } = useContextMenu();
  const { openDm, dispatch, setProfileUser } = useChatActions();
  const { open: openImageViewer } = useImageViewerActions();
  const [popoverUser, setPopoverUser] = useState<User | null>(null);
  const [popoverAnchor, setPopoverAnchor] = useState<HTMLElement | null>(null);
  const [mobileProfileUser, setMobileProfileUser] = useState<{ user: User; roles?: Role[] } | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('members');

  // Reset tab when desktop details mode is closed
  useEffect(() => {
    if (!showDetails) {
      setActiveTab('members');
    }
  }, [showDetails]);

  // Tab data states
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [linkItems, setLinkItems] = useState<LinkItem[]>([]);
  const [fileItems, setFileItems] = useState<MediaItem[]>([]);
  const [threads, setThreads] = useState<ThreadItem[]>([]);
  const [tabLoading, setTabLoading] = useState(false);
  const [tabError, setTabError] = useState<string | null>(null);

  // Reset tab when channel changes
  useEffect(() => {
    setActiveTab('members');
  }, [channelId]);

  // Load tab data when switching tabs
  useEffect(() => {
    if (!channelId) return;

    const loadTabData = async () => {
      setTabLoading(true);
      setTabError(null);
      try {
        switch (activeTab) {
          case 'media': {
            const data = await apiGet<{ items: MediaItem[] }>(`/api/channels/${channelId}/media?type=images`);
            setMediaItems(data.items ?? []);
            break;
          }
          case 'links': {
            const data = await apiGet<{ items: LinkItem[] }>(`/api/channels/${channelId}/media?type=links`);
            setLinkItems(data.items ?? []);
            break;
          }
          case 'files': {
            const data = await apiGet<{ items: MediaItem[] }>(`/api/channels/${channelId}/media?type=files`);
            setFileItems(data.items ?? []);
            break;
          }
          case 'threads': {
            const data = await apiGet<{ threads: ThreadItem[] }>(`/api/channels/${channelId}/threads`);
            setThreads(data.threads ?? []);
            break;
          }
          // 'members' and 'pins' use data already passed via props
        }
      } catch (err: any) {
        console.error(`[MemberList] Failed to load ${activeTab} tab:`, err);
        setTabError(err?.message || `Failed to load ${activeTab}`);
      }
      setTabLoading(false);
    };

    if (activeTab !== 'members' && activeTab !== 'pins') {
      loadTabData();
    }
  }, [activeTab, channelId]);

  // Retry handler for error states
  const handleRetry = useCallback(() => {
    setTabError(null);
    setTabLoading(false);
    // Force re-trigger by toggling tab
    const tab = activeTab;
    setActiveTab('members');
    setTimeout(() => setActiveTab(tab), 0);
  }, [activeTab]);

  // Member list logic
  const online = members.filter((m) => onlineUsers.has(m.user.id) && m.user.status !== 'offline');
  const offline = members.filter((m) => !onlineUsers.has(m.user.id) || m.user.status === 'offline');

  const sortMembers = (a: { user: User; roles?: Role[] }, b: { user: User; roles?: Role[] }) => {
    const roleA = getHighestRole(a.roles)?.position ?? -1;
    const roleB = getHighestRole(b.roles)?.position ?? -1;
    if (roleA !== roleB) return roleB - roleA;
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

  // Shared member click/context-menu handlers
  const handleMemberClick = useCallback((e: React.MouseEvent<HTMLDivElement>, user: User, memberRoles?: Role[]) => {
    // On mobile, show full-screen profile sheet
    if (window.innerWidth < 768) {
      setMobileProfileUser({ user, roles: memberRoles });
      return;
    }
    // On desktop, show popover
    setPopoverAnchor(e.currentTarget);
    setPopoverUser(user);
  }, []);

  const handleMemberContext = useCallback((e: React.MouseEvent, member: { user: User; roles?: Role[] }) => {
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
  }, [openMenu, setProfileUser, openDm, dispatch, onBan, currentUserId]);

  // ── Tab Content Renderers ─────────────────────────────────────────────

  const renderMembersTab = () => (
    <>
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
              onClick={(e) => handleMemberClick(e, member.user, member.roles)}
              onContextMenu={(e) => handleMemberContext(e, member)}
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
              onClick={(e) => handleMemberClick(e, m.user, m.roles)}
              onContextMenu={(e) => handleMemberContext(e, m)}
            />
          ))}
        </div>
      )}

      {sortedOnline.length === 0 && sortedOffline.length === 0 && (
        <div className="py-4 text-center text-xs text-rm-text-muted">No members found</div>
      )}
    </>
  );

  // Convert MediaItem to Attachment for the image viewer
  const mediaToAttachment = useCallback((item: MediaItem): Attachment => ({
    id: item.id,
    message_id: item.message_id,
    filename: item.filename,
    file_key: item.url.replace('/api/', ''),
    content_type: item.content_type,
    size_bytes: item.size_bytes,
    url: item.url,
  }), []);

  const handleMediaClick = useCallback((index: number) => {
    const attachments = mediaItems.map(mediaToAttachment);
    const item = mediaItems[index];
    openImageViewer(attachments, index, {
      username: item.author.username,
      avatar_url: item.author.avatar_url,
      created_at: item.created_at,
    });
  }, [mediaItems, mediaToAttachment, openImageViewer]);

  const renderMediaTab = () => {
    if (tabLoading) return <MediaSkeletonGrid />;
    if (tabError) return <TabErrorState message={tabError} onRetry={handleRetry} />;
    if (mediaItems.length === 0) return <TabEmptyState icon={<Image size={40} />} label="No media shared yet" />;
    return (
      <div className="grid grid-cols-3 gap-1.5">
        {mediaItems.map((item, idx) => (
          <button
            key={item.id}
            onClick={() => handleMediaClick(idx)}
            className="aspect-square rounded-xl overflow-hidden bg-rm-bg-elevated border border-rm-border/20 hover:border-primary/40 transition-all group relative"
          >
            {/* User avatar overlay — top right */}
            <div className="absolute top-1.5 right-1.5 z-10">
              <div className="h-6 w-6 rounded-full overflow-hidden border-2 border-black/30 shadow-md bg-rm-bg-elevated">
                {item.author.avatar_url ? (
                  <img src={item.author.avatar_url} alt={item.author.username} className="h-full w-full object-cover" />
                ) : (
                  <div className="h-full w-full flex items-center justify-center bg-primary text-[9px] font-bold text-primary-foreground">
                    {item.author.username[0]?.toUpperCase()}
                  </div>
                )}
              </div>
            </div>

            <MediaGridImage src={item.url} alt={item.filename} />

            <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2">
              <span className="text-[10px] font-bold text-white truncate">{item.filename}</span>
            </div>
          </button>
        ))}
      </div>
    );
  };

  const renderPinsTab = () => {
    if (loadingPins) return <TabSpinnerState />;
    if (!pinnedMessages || pinnedMessages.length === 0) {
      return <TabEmptyState icon={<Pin size={40} />} label="No pinned messages" />;
    }
    return (
      <div className="space-y-3">
        {pinnedMessages.map((msg) => (
          <button
            key={msg.id}
            className="w-full text-left bg-rm-bg-elevated hover:bg-rm-bg-hover border border-rm-border/30 rounded-xl p-3.5 transition-colors group"
            onClick={() => {
              onJumpToMessage?.(msg.id);
              onClose?.();
            }}
          >
            <div className="flex items-center gap-2 mb-1.5">
              <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[9px] font-bold text-primary overflow-hidden">
                {msg.author?.avatar_url ? (
                  <img src={msg.author.avatar_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  (msg.author?.username ?? '?')[0].toUpperCase()
                )}
              </div>
              <span className="text-[12px] font-bold text-rm-text-primary truncate">{msg.author?.username ?? "Unknown"}</span>
              <span className="text-[10px] text-rm-text-muted ml-auto shrink-0">{formatRelativeTime(msg.created_at)}</span>
            </div>
            <div className="text-[13px] text-rm-text-secondary line-clamp-2 leading-relaxed">
              <MarkdownRenderer content={msg.content.slice(0, 200)} />
            </div>
            {msg.attachments && msg.attachments.length > 0 && (
              <div className="mt-2 flex items-center gap-1.5 text-[10px] text-rm-text-muted">
                <Image size={12} />
                <span>{msg.attachments.length} attachment{msg.attachments.length > 1 ? 's' : ''}</span>
              </div>
            )}
          </button>
        ))}
      </div>
    );
  };

  const renderThreadsTab = () => {
    if (tabLoading) return <TabSpinnerState />;
    if (tabError) return <TabErrorState message={tabError} onRetry={handleRetry} />;
    if (threads.length === 0) return <TabEmptyState icon={<MessageCircle size={40} />} label="No threads in this channel" />;
    return (
      <div className="space-y-2.5">
        {threads.map((thread) => (
          <button
            key={thread.id}
            className="w-full text-left bg-rm-bg-elevated hover:bg-rm-bg-hover border border-rm-border/30 rounded-xl p-3.5 transition-colors group"
            onClick={() => {
              onOpenThread?.(thread.id);
              onClose?.();
            }}
          >
            <div className="flex items-center gap-2 mb-1.5">
              <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[9px] font-bold text-primary overflow-hidden">
                {thread.author.avatar_url ? (
                  <img src={thread.author.avatar_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  thread.author.username[0].toUpperCase()
                )}
              </div>
              <span className="text-[12px] font-bold text-rm-text-primary truncate">{thread.author.username}</span>
            </div>
            <div className="text-[13px] text-rm-text-secondary line-clamp-2 leading-relaxed mb-2">
              {thread.content}
            </div>
            <div className="flex items-center gap-3 text-[11px] text-rm-text-muted">
              <div className="flex items-center gap-1">
                <MessageCircle size={12} />
                <span className="font-semibold">{thread.reply_count}</span>
                <span>{thread.reply_count === 1 ? 'reply' : 'replies'}</span>
              </div>
              <span className="text-[10px]">{formatRelativeTime(thread.last_reply_at)}</span>
            </div>
          </button>
        ))}
      </div>
    );
  };

  const renderLinksTab = () => {
    if (tabLoading) return <TabSpinnerState />;
    if (tabError) return <TabErrorState message={tabError} onRetry={handleRetry} />;
    if (linkItems.length === 0) return <TabEmptyState icon={<Link2 size={40} />} label="No links shared yet" />;
    return (
      <div className="space-y-2.5">
        {linkItems.map((item) => {
          const urls = extractUrls(item.content);
          return (
            <div key={item.id} className="bg-rm-bg-elevated border border-rm-border/30 rounded-xl p-3.5 transition-colors hover:bg-rm-bg-hover">
              <div className="flex items-center gap-2 mb-2">
                <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[9px] font-bold text-primary overflow-hidden">
                  {item.author.avatar_url ? (
                    <img src={item.author.avatar_url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    item.author.username[0].toUpperCase()
                  )}
                </div>
                <span className="text-[12px] font-bold text-rm-text-primary truncate">{item.author.username}</span>
                {channelName && (
                  <>
                    <span className="text-rm-text-muted/30">·</span>
                    <span className="text-[11px] text-rm-text-muted flex items-center gap-0.5 shrink-0">
                      <Hash size={10} className="opacity-60" />
                      {channelName}
                    </span>
                  </>
                )}
                <span className="text-[10px] text-rm-text-muted ml-auto shrink-0">{formatRelativeTime(item.created_at)}</span>
              </div>
              {urls.map((url, idx) => (
                <a
                  key={idx}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-[13px] text-primary hover:underline truncate mt-1"
                >
                  <ExternalLink size={12} className="shrink-0" />
                  <span className="truncate">{url}</span>
                </a>
              ))}
            </div>
          );
        })}
      </div>
    );
  };

  const renderFilesTab = () => {
    if (tabLoading) return <TabSpinnerState />;
    if (tabError) return <TabErrorState message={tabError} onRetry={handleRetry} />;
    if (fileItems.length === 0) {
      const { Icon: EmptyIcon } = getFileIcon('file.txt');
      return <TabEmptyState icon={<EmptyIcon size={40} />} label="No files shared yet" />;
    }
    return (
      <div className="space-y-2">
        {fileItems.map((item) => {
          const { Icon: FileTypeIcon, colorClass } = getFileIcon(item.filename, item.content_type);
          const uploadDate = new Date(item.created_at).toLocaleDateString(undefined, {
            month: 'short', day: 'numeric', year: 'numeric'
          });
          return (
            <div
              key={item.id}
              className="flex items-center gap-3 bg-rm-bg-elevated hover:bg-rm-bg-hover border border-rm-border/30 rounded-xl p-3.5 transition-colors group cursor-pointer"
              onClick={() => {
                // Close the panel first so the message is visible, then jump
                onClose?.();
                // Slight delay to let the panel animate out before scrolling
                setTimeout(() => onJumpToMessage?.(item.message_id), 150);
              }}
            >
              <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-rm-bg-surface border border-rm-border/30", colorClass)}>
                <FileTypeIcon size={22} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-bold text-rm-text-primary truncate">{item.filename}</div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[11px] text-rm-text-muted">{formatFileSize(item.size_bytes)}</span>
                  <span className="text-rm-text-muted/30">·</span>
                  <span className="text-[11px] text-rm-text-muted">{uploadDate}</span>
                </div>
                <div className="flex items-center gap-1.5 mt-1">
                  <div className="h-4 w-4 rounded-full overflow-hidden bg-rm-bg-surface border border-rm-border/30 shrink-0">
                    {item.author.avatar_url ? (
                      <img src={item.author.avatar_url} alt={item.author.username} className="h-full w-full object-cover" />
                    ) : (
                      <div className="h-full w-full flex items-center justify-center bg-primary text-[7px] font-bold text-primary-foreground">
                        {item.author.username[0]?.toUpperCase()}
                      </div>
                    )}
                  </div>
                  <span className="text-[11px] font-medium text-rm-text-muted truncate">{item.author.username}</span>
                  {channelName && (
                    <>
                      <span className="text-rm-text-muted/30">·</span>
                      <span className="text-[11px] text-rm-text-muted flex items-center gap-0.5 shrink-0">
                        <Hash size={10} className="opacity-60" />
                        {channelName}
                      </span>
                    </>
                  )}
                </div>
              </div>
              <a
                href={item.url}
                download={item.filename}
                onClick={(e) => e.stopPropagation()}
                className="p-2 text-rm-text-muted opacity-0 group-hover:opacity-100 hover:text-primary transition-all rounded-lg hover:bg-primary/10 shrink-0"
                title="Download"
              >
                <Download size={16} />
              </a>
            </div>
          );
        })}
      </div>
    );
  };

  const renderActiveTab = () => {
    switch (activeTab) {
      case 'members': return renderMembersTab();
      case 'media': return renderMediaTab();
      case 'pins': return renderPinsTab();
      case 'threads': return renderThreadsTab();
      case 'links': return renderLinksTab();
      case 'files': return renderFilesTab();
    }
  };

  return (
    <div
      data-testid="members-list"
      className={cn(
        "fixed inset-y-0 right-0 z-[100] flex h-full w-full shrink-0 flex-col overflow-hidden bg-rm-bg-primary shadow-2xl animate-in slide-in-from-right-full transition-all duration-300",
        // Desktop: static sidebar, width depends on details mode
        showDetails
          ? "lg:static lg:z-auto lg:w-[360px] lg:bg-rm-bg-sidebar lg:shadow-none lg:animate-none"
          : "lg:static lg:z-auto lg:w-60 lg:bg-rm-bg-sidebar lg:shadow-none lg:animate-none"
      )}
    >
      {/* Mobile-only Header */}
      <div className="flex items-center justify-between p-4 lg:hidden sticky top-0 bg-rm-bg-primary z-10 shrink-0">
        <button onClick={onClose} className="p-1 -ml-1 text-rm-text-muted hover:text-rm-text transition-colors">
          <ArrowLeft size={24} />
        </button>
        <div className="flex items-center gap-5 text-rm-text-muted">
          <button
            className="hover:text-rm-text transition-colors"
            onClick={() => {
              onOpenSearch?.();
              onClose?.();
            }}
          >
            <Search size={22} />
          </button>
          <button className="hover:text-rm-text transition-colors">
            <Bell size={22} />
          </button>
          <button
            className="hover:text-rm-text transition-colors"
            onClick={() => {
              onOpenSettings?.();
            }}
          >
            <Settings size={22} />
          </button>
        </div>
      </div>

      {/* Desktop Details Header — only shown when details mode is active */}
      {showDetails && (
        <div className="hidden lg:flex items-center justify-between px-4 py-3 border-b border-rm-border bg-rm-bg-elevated/40 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Hash size={18} className="text-rm-text-muted shrink-0" />
            <h2 className="text-[15px] font-bold text-rm-text-primary truncate">{channelName || 'general'}</h2>
          </div>
          <button
            onClick={onToggleDetails}
            className="p-1.5 text-rm-text-muted hover:text-rm-text hover:bg-rm-bg-hover rounded-lg transition-colors shrink-0"
            title="Close details"
          >
            <ArrowLeft size={18} />
          </button>
        </div>
      )}

      <div className="flex-1 flex flex-col px-4 pt-2 lg:pt-4 lg:px-2 overflow-y-auto custom-scrollbar relative pb-10">

        {/* Mobile Title and Tabs (always shown) */}
        <div className="lg:hidden mb-6 shrink-0">
          <div className="flex items-center gap-2 mb-1">
            <Hash size={24} className="text-rm-text-muted shrink-0" />
            <h1 className="text-[26px] font-extrabold text-rm-text-primary tracking-tight leading-none truncate">{channelName || "general"}</h1>
          </div>
          <p className="text-[13px] font-medium text-rm-text-muted mb-6 ml-8">Text Channel</p>

          <div className="flex gap-6 overflow-x-auto custom-scrollbar no-scrollbar text-[15px] font-semibold text-rm-text-muted border-b border-rm-border pb-2.5">
            {TABS.map(tab => (
              <div
                key={tab.id}
                className={cn(
                  "shrink-0 cursor-pointer transition-colors relative",
                  activeTab === tab.id ? "text-rm-text-primary" : "hover:text-rm-text"
                )}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
                {activeTab === tab.id && (
                  <div className="absolute -bottom-[11px] left-0 right-0 h-0.5 bg-primary rounded-t-full" />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Desktop Details Tabs (only in details mode) */}
        {showDetails && (
          <div className="hidden lg:block mb-4 shrink-0 px-2">
            <div className="flex gap-4 overflow-x-auto custom-scrollbar no-scrollbar text-[13px] font-semibold text-rm-text-muted border-b border-rm-border pb-2">
              {TABS.map(tab => (
                <div
                  key={tab.id}
                  className={cn(
                    "shrink-0 cursor-pointer transition-colors relative py-1",
                    activeTab === tab.id ? "text-rm-text-primary" : "hover:text-rm-text"
                  )}
                  onClick={() => setActiveTab(tab.id)}
                >
                  {tab.label}
                  {activeTab === tab.id && (
                    <div className="absolute -bottom-[9px] left-0 right-0 h-0.5 bg-primary rounded-t-full" />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Mobile-only Invite Button */}
        <div className="lg:hidden mb-6 shrink-0 pt-2">
          <button
            className="w-full flex items-center justify-between bg-rm-bg-elevated hover:bg-rm-bg-hover text-rm-text p-4 rounded-xl transition-colors ring-1 ring-rm-border shadow-sm"
            onClick={() => {
              onInviteClick?.();
              onClose?.();
            }}
          >
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary rounded-full text-primary-foreground border border-rm-border/50">
                <UserPlus size={18} fill="currentColor" className="opacity-90" />
              </div>
              <span className="font-bold text-[16px] text-rm-text-primary">Invite Members</span>
            </div>
            <ChevronRight size={20} className="text-rm-text-muted" />
          </button>
        </div>

        {/* Tab Content */}
        {renderActiveTab()}
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

      {mobileProfileUser && (
        <MobileProfileSheet
          user={mobileProfileUser.user}
          roles={mobileProfileUser.roles}
          onClose={() => setMobileProfileUser(null)}
          onBan={onBan}
        />
      )}
    </div >
  );
}


// ── Shared Sub-components ────────────────────────────────────────────────

/** Spinner state for text-based tabs (threads, links, files, pins) */
function TabSpinnerState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3">
      <div className="h-6 w-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      <span className="text-[12px] font-bold text-rm-text-muted">Loading…</span>
    </div>
  );
}

/** Animated skeleton grid for the Media tab */
function MediaSkeletonGrid() {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {Array.from({ length: 9 }).map((_, i) => (
        <div key={i} className="aspect-square rounded-xl overflow-hidden bg-rm-bg-elevated border border-rm-border/20 relative">
          {/* Shimmer animation */}
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-rm-text-muted/5 to-transparent animate-shimmer" />
          {/* Fake avatar skeleton */}
          <div className="absolute top-1.5 right-1.5 z-10 h-6 w-6 rounded-full bg-rm-text-muted/10 animate-pulse" />
        </div>
      ))}

      {/* Inline shimmer keyframe */}
      <style>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        .animate-shimmer {
          animation: shimmer 1.5s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}

/** Individual media grid image with its own loading/error state */
function MediaGridImage({ src, alt }: { src: string; alt: string }) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  if (error) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-rm-bg-elevated">
        <ImageOff size={20} className="text-rm-text-muted/30" />
      </div>
    );
  }

  return (
    <>
      {!loaded && (
        <div className="absolute inset-0 bg-rm-bg-elevated flex items-center justify-center">
          <div className="h-5 w-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      )}
      <img
        src={src}
        alt={alt}
        className={cn(
          "w-full h-full object-cover transition-all duration-300 group-hover:scale-105",
          loaded ? "opacity-100" : "opacity-0"
        )}
        loading="lazy"
        onLoad={() => setLoaded(true)}
        onError={() => setError(true)}
      />
    </>
  );
}

/** Error state with graphic and retry option */
function TabErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-5">
      {/* Error graphic */}
      <div className="relative">
        <div className="h-20 w-20 rounded-2xl bg-destructive/10 flex items-center justify-center border border-destructive/20">
          <WifiOff size={32} className="text-destructive/60" />
        </div>
        <div className="absolute -bottom-1 -right-1 h-7 w-7 rounded-full bg-destructive/20 flex items-center justify-center border border-destructive/30">
          <TriangleAlert size={14} className="text-destructive" />
        </div>
      </div>

      <div className="text-center space-y-1.5">
        <p className="text-[14px] font-bold text-rm-text-primary">Failed to load</p>
        <p className="text-[12px] text-rm-text-muted max-w-[200px] leading-relaxed">{message}</p>
      </div>

      <button
        onClick={onRetry}
        className="flex items-center gap-2 px-4 py-2 bg-rm-bg-elevated hover:bg-rm-bg-hover border border-rm-border rounded-xl text-[13px] font-bold text-rm-text-primary transition-colors"
      >
        <RefreshCw size={14} />
        Retry
      </button>
    </div>
  );
}

function TabEmptyState({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-4 text-rm-text-muted">
      <div className="opacity-20">{icon}</div>
      <span className="text-[13px] font-bold">{label}</span>
    </div>
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
