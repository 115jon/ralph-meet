import { AvatarImage } from "@/components/chat/AvatarImage";
import { ButtonBase } from "@/components/ui/button-base";
import { getDisplayInitial, getDisplayName } from "@/lib/display-name";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useContextMenu } from "@/hooks/useContextMenu";
import { apiDelete, apiGet } from "@/lib/api-client";
import { clog } from "@/lib/console-logger";
import { getFileIcon } from "@/lib/file-icons";
import { isVideo } from "@/lib/media";
import { PERMISSIONS } from "@/lib/permissions";
import { getAuthAssetUrl, getDownloadUrl, getMediaUrl } from "@/lib/platform";
import { dispatchOpenProfileEditorEvent } from "@/lib/profile-editor-events";
import { buildProxyMediaPath } from "@/lib/proxy-media-url";
import type { Attachment, Message, Role, User } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { VideoPlaybackAvailabilityRequest } from "@/lib/video-playback-availability";
import { primeVideoPlaybackAvailability } from "@/lib/video-playback-availability";
import { useChatActions, useChatStore } from "@/stores/chat-store";
import { useCallStore } from "@/stores/useCallStore";
import type { ViewerContext } from "@/stores/useImageViewerStore";
import { useImageViewerActions } from "@/stores/useImageViewerStore";
import { UserStatusDot } from "./UserStatusDot";
import {
  ArrowLeft,
  Bell,
  ChevronRight,
  Download,
  ExternalLink,
  Hash,
  Image,
  ImageOff,
  Link2,
  MessageCircle,
  RefreshCw,
  Search,
  Settings,
  TriangleAlert,
  UserPlus,
  WifiOff,
} from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import ContextMenu from "./ContextMenu";
import {
  AlertTriangle,
  AtSign,
  Copy,
  Crown,
  MessageSquare,
  Phone,
  Pin,
  User as UserIcon,
} from "./Icons";
import InlineEmojiText from "./InlineEmojiText";
import { MarkdownRenderer } from "./MarkdownRenderer";
import MobileProfileSheet from "./MobileProfileSheet";
import { NAMEPLATE_MASK_SCALE_CSS_VAR } from "./ProfileAssetLayer";
import { UserDisplayName } from "./UserDisplayName";
import { UserNameplateLayer } from "./UserNameplateLayer";
import { UserPlatformIndicators } from "./UserPlatformIndicators";
import UserProfilePopover from "./UserProfilePopover";
import { PlayIcon } from "./VideoIcons";
import { getUserNameplatePresentation } from "./user-nameplate-presentation";

const log = clog("MemberList");

// ── Types ────────────────────────────────────────────────────────────────

type TabId = "members" | "media" | "pins" | "threads" | "links" | "files";

interface MediaItem {
  id: string;
  message_id: string;
  filename: string;
  file_key: string;
  url: string;
  source_url?: string | null;
  content_type: string;
  size_bytes: number;
  source_kind: "attachment" | "embed";
  thumbnail_url?: string | null;
  is_gif?: boolean;
  author: {
    id: string;
    username: string;
    display_name?: string | null;
    avatar_url: string | null;
    avatar_display?: User["avatar_display"];
  };
  created_at: string;
}

interface LinkItem {
  id: string;
  message_id: string;
  content: string;
  author: {
    id: string;
    username: string;
    display_name?: string | null;
    avatar_url: string | null;
    avatar_display?: User["avatar_display"];
  };
  created_at: string;
}

interface ThreadItem {
  id: string;
  content: string;
  author: {
    id: string;
    username: string;
    display_name?: string | null;
    avatar_url: string | null;
    avatar_display?: User["avatar_display"];
  };
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
  onKick?: (userId: string, username: string) => void;
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
  isDM?: boolean;
}

// Helpers

const getHighestRole = (roles?: Role[]) => {
  if (!roles || roles.length === 0) return null;
  return roles.reduce(
    (highest, current) =>
      current.position > highest.position ? current : highest,
    roles[0],
  );
};

function compareMembersByRole(
  a: { user: User; roles?: Role[] },
  b: { user: User; roles?: Role[] },
) {
  const roleA = getHighestRole(a.roles)?.position ?? -1;
  const roleB = getHighestRole(b.roles)?.position ?? -1;
  if (roleA !== roleB) return roleB - roleA;
  return a.user.username.localeCompare(b.user.username);
}

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
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function extractUrls(text: string): string[] {
  const regex = /https?:\/\/[^\s<>)"'\]]+/g;
  return Array.from(text.matchAll(regex)).map((m) => m[0]);
}

// Tabs

const TABS: { id: TabId; label: string }[] = [
  { id: "members", label: "Members" },
  { id: "media", label: "Media" },
  { id: "pins", label: "Pins" },
  { id: "threads", label: "Threads" },
  { id: "links", label: "Links" },
  { id: "files", label: "Files" },
];

// Main component

export default function MemberList({
  members,
  onlineUsers,
  typingUsers,
  currentUserId,
  onBan,
  onKick,
  onClose,
  channelName,
  channelId,
  serverId,
  onOpenSearch,
  onOpenSettings,
  onInviteClick,
  pinnedMessages,
  loadingPins,
  canUnpin: _canUnpin,
  onUnpin: _onUnpin,
  onJumpToMessage,
  onOpenThread,
  showDetails,
  onToggleDetails,
  isDM,
}: MemberListProps) {
  const { menu, openMenu, closeMenu, isClosing } = useContextMenu();
  const { openDm, dispatch, setProfileUser } = useChatActions();
  const memberTabIdPrefix = useId().replace(/:/g, "");
  const presencePlatformsByUserId = useChatStore(
    (state) => state.presencePlatformsByUserId,
  );
  const { open: openImageViewer } = useImageViewerActions();
  const [state, setState] = useState({
    popoverUser: null as User | null,
    popoverAnchor: null as HTMLElement | null,
    mobileProfileUser: null as { user: User; roles?: Role[] } | null,
    mobileProfileUserClosing: false,
    activeTab: "members" as TabId,
    mediaItems: [] as MediaItem[],
    linkItems: [] as LinkItem[],
    fileItems: [] as MediaItem[],
    threads: [] as ThreadItem[],
    tabLoading: false,
    tabError: null as string | null,
  });
  const mobileProfileCloseTimeoutRef = useRef<number | null>(null);
  const mobileProfileAfterCloseRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      if (mobileProfileCloseTimeoutRef.current !== null) {
        window.clearTimeout(mobileProfileCloseTimeoutRef.current);
      }
      mobileProfileAfterCloseRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (state.mobileProfileUser !== null || state.mobileProfileUserClosing) {
      return;
    }

    const afterClose = mobileProfileAfterCloseRef.current;
    mobileProfileAfterCloseRef.current = null;
    afterClose?.();
  }, [state.mobileProfileUser, state.mobileProfileUserClosing]);

  // Reset tab when desktop details mode is closed
  useEffect(() => {
    if (!showDetails) {
      const t = setTimeout(
        () => setState((prev) => ({ ...prev, activeTab: "members" })),
        0,
      );
      return () => clearTimeout(t);
    }
  }, [showDetails]);

  // Reset tab when channel changes
  useEffect(() => {
    const t = setTimeout(
      () => setState((prev) => ({ ...prev, activeTab: "members" })),
      0,
    );
    return () => clearTimeout(t);
  }, [channelId]);

  // Load tab data when switching tabs
  useEffect(() => {
    if (
      !channelId ||
      state.activeTab === "members" ||
      state.activeTab === "pins"
    ) {
      return;
    }

    const controller = new AbortController();
    let isActive = true;
    const activeTab = state.activeTab;

    const loadTabData = async () => {
      setState((prev) => ({ ...prev, tabLoading: true, tabError: null }));

      const partialState: Partial<typeof state> = { tabLoading: false };

      try {
        switch (activeTab) {
          case "media": {
            const data = await apiGet<{ items: MediaItem[] }>(
              `/api/channels/${channelId}/media?type=images`,
              { signal: controller.signal },
            );
            partialState.mediaItems = data.items ?? [];
            break;
          }
          case "links": {
            const data = await apiGet<{ items: LinkItem[] }>(
              `/api/channels/${channelId}/media?type=links`,
              { signal: controller.signal },
            );
            partialState.linkItems = data.items ?? [];
            break;
          }
          case "files": {
            const data = await apiGet<{ items: MediaItem[] }>(
              `/api/channels/${channelId}/media?type=files`,
              { signal: controller.signal },
            );
            partialState.fileItems = data.items ?? [];
            break;
          }
          case "threads": {
            const data = await apiGet<{ threads: ThreadItem[] }>(
              `/api/channels/${channelId}/threads`,
              { signal: controller.signal },
            );
            partialState.threads = data.threads ?? [];
            break;
          }
        }
      } catch (err: unknown) {
        if (!isActive || controller.signal.aborted) return;
        let errMsg = `Failed to load ${activeTab}`;
        if (err instanceof Error) {
          errMsg = err.message;
        } else if (typeof err === "string") {
          errMsg = err;
        } else if (err && typeof err === "object" && "message" in err) {
          errMsg = String(err.message);
        }
        log.error(`Failed to load ${activeTab} tab:`, err);
        partialState.tabError = errMsg;
      }

      if (!isActive || controller.signal.aborted) return;
      setState((prev) => ({ ...prev, ...partialState }));
    };

    void loadTabData();

    return () => {
      isActive = false;
      controller.abort();
    };
  }, [state.activeTab, channelId]);

  // Retry handler for error states
  const handleRetry = useCallback(() => {
    setState((prev) => ({ ...prev, tabError: null, tabLoading: false }));
    // Force re-trigger by toggling tab
    const tab = state.activeTab;
    setState((prev) => ({ ...prev, activeTab: "members" }));
    setTimeout(() => setState((prev) => ({ ...prev, activeTab: tab })), 0);
  }, [state.activeTab]);

  // Member list logic
  const online = members.filter(
    (m) => onlineUsers.has(m.user.id) && m.user.status !== "offline",
  );
  const offline = members.filter(
    (m) => !onlineUsers.has(m.user.id) || m.user.status === "offline",
  );

  const sortedOnline = online.toSorted(compareMembersByRole);
  const sortedOffline = offline.toSorted(compareMembersByRole);

  // Group online members by highest role
  const groups: { name: string; members: typeof sortedOnline }[] = [];
  const addGroup = (member: (typeof sortedOnline)[0]) => {
    const highestRole = getHighestRole(member.roles);
    const groupName =
      highestRole && !highestRole.is_default ? highestRole.name : "ONLINE";
    let group = groups.find((g) => g.name === groupName);
    if (!group) {
      group = { name: groupName, members: [] };
      groups.push(group);
    }
    group.members.push(member);
  };

  sortedOnline.forEach(addGroup);

  // Stable close callback that clears both popoverUser AND popoverAnchor
  const closePopover = useCallback(() => {
    setState((prev) => ({ ...prev, popoverUser: null, popoverAnchor: null }));
  }, []);

  const closeMobileProfile = useCallback((afterClose?: () => void) => {
    if (afterClose) mobileProfileAfterCloseRef.current = afterClose;
    if (mobileProfileCloseTimeoutRef.current !== null) return;

    setState((prev) => ({ ...prev, mobileProfileUserClosing: true }));
    mobileProfileCloseTimeoutRef.current = window.setTimeout(() => {
      mobileProfileCloseTimeoutRef.current = null;
      setState((prev) => ({
        ...prev,
        mobileProfileUser: null,
        mobileProfileUserClosing: false,
      }));
    }, 300);
  }, []);

  // Shared member click/context-menu handlers
  const handleMemberClick = useCallback(
    (
      e: React.MouseEvent<HTMLButtonElement>,
      user: User,
      memberRoles?: Role[],
    ) => {
      // On mobile, show full-screen profile sheet
      if (window.innerWidth < 768) {
        setState((prev) => ({
          ...prev,
          mobileProfileUser: { user, roles: memberRoles },
        }));
        return;
      }
      // On desktop, toggle popover: close if same user, open if different
      const anchor = e.currentTarget;
      setState((prev) => {
        if (prev.popoverUser?.id === user.id) {
          return { ...prev, popoverUser: null, popoverAnchor: null };
        }
        return { ...prev, popoverAnchor: anchor, popoverUser: user };
      });
    },
    [],
  );

  const handleMemberContext = useCallback(
    async (e: React.MouseEvent, member: { user: User; roles?: Role[] }) => {
      e.preventDefault();

      // Check if we should hide the call option (already in call or ringing this user)
      const callState = useCallStore.getState();
      const dmChannels = useChatStore.getState().dmChannels;
      const dmForUser = dmChannels.find(
        (d: any) => d.recipient?.id === member.user.id,
      );

      const isRingingThisUser =
        callState.status === "ringing_outgoing" &&
        callState.remoteUser?.id === member.user.id;
      const isInCallWithUser =
        callState.status === "active" &&
        dmForUser &&
        callState.channelId === dmForUser.id &&
        callState.hasJoinedSFU;
      const hideCallOption = isRingingThisUser || isInCallWithUser;

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
        ...(!hideCallOption
          ? [
              {
                label: "Start a Call",
                icon: <Phone className="h-4 w-4" />,
                onClick: async () => {
                  const channelId =
                    dmForUser?.id ?? (await openDm(member.user.id));
                  if (channelId) {
                    dispatch({
                      type: "SWITCH_SERVER",
                      serverId: "@me",
                      channelId,
                    });
                    window.dispatchEvent(
                      new CustomEvent("request-start-call", {
                        detail: {
                          userId: member.user.id,
                          displayName:
                            member.user.display_name ?? member.user.username,
                          channelId,
                        },
                      }),
                    );
                  }
                },
              },
            ]
          : []),
        {
          label: "Copy ID",
          icon: <Copy className="h-4 w-4" />,
          onClick: () => navigator.clipboard.writeText(member.user.id),
          divider: !!onBan && member.user.id !== currentUserId,
        },
        ...(onBan && member.user.id !== currentUserId
          ? [
              {
                label: "Ban",
                icon: <AlertTriangle className="h-4 w-4" />,
                onClick: () => onBan(member.user.id, member.user.username),
                variant: "danger" as const,
              },
            ]
          : []),
      ]);
    },
    [openMenu, setProfileUser, openDm, dispatch, onBan, currentUserId],
  );

  const handleKick = useCallback(
    async (userId: string, username: string) => {
      if (onKick) {
        await onKick(userId, username);
        return;
      }
      if (!serverId || serverId === "@me") return;
      if (!confirm(`Kick ${username}?`)) return;
      try {
        await apiDelete(`/api/servers/${serverId}/members/${userId}`);
      } catch (err) {
        log.error("Failed to kick member:", err);
      }
    },
    [onKick, serverId],
  );

  // Tab content renderers

  return (
    <TooltipProvider delayDuration={0}>
      <div
        data-testid="members-list"
        className={cn(
          "fixed inset-y-0 right-0 z-100 flex h-full w-full shrink-0 flex-col overflow-hidden bg-rm-bg-primary shadow-2xl animate-in slide-in-from-right-full transition-all duration-300",
          // Desktop: static sidebar, width depends on details mode
          showDetails
            ? "lg:static lg:z-auto lg:w-[360px] lg:bg-rm-bg-sidebar lg:shadow-none lg:animate-none"
            : "lg:static lg:z-auto lg:w-60 lg:bg-rm-bg-sidebar lg:shadow-none lg:animate-none",
        )}
      >
        <MobileHeader
          onClose={onClose}
          onOpenSearch={onOpenSearch}
          onOpenSettings={onOpenSettings}
        />

        {/* Desktop details header - only shown when details mode is active */}
        {showDetails && (
          <DesktopHeader
            channelName={channelName}
            onToggleDetails={onToggleDetails}
            isDM={isDM}
          />
        )}

        <div
          className="relative flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-10 pt-2 custom-scrollbar lg:px-2 lg:pt-4"
          style={{ paddingBottom: "max(40px, var(--safe-area-bottom, 0px))" }}
        >
          <MemberListTabs
            channelName={channelName}
            activeTab={state.activeTab}
            onTabChange={(tabId) =>
              setState((prev) => ({ ...prev, activeTab: tabId }))
            }
            idPrefix={memberTabIdPrefix}
            showDetails={showDetails}
            isDM={isDM}
          />

          {/* Mobile-only Invite Button */}
          {!isDM && (
            <MobileInviteButton
              onInviteClick={onInviteClick}
              onClose={onClose}
            />
          )}

          {/* Tab Content */}
          <div
            role="tabpanel"
            id="member-details-panel"
            aria-labelledby={`${memberTabIdPrefix}-${showDetails ? "desktop" : "mobile"}-tab-${state.activeTab}`}
          >
            {(() => {
              switch (state.activeTab) {
                case "members":
                  return (
                    <MembersTabContent
                      groups={groups}
                      sortedOffline={sortedOffline}
                      sortedOnline={sortedOnline}
                      typingUsers={typingUsers}
                      currentUserId={currentUserId}
                      onMemberClick={handleMemberClick}
                      onMemberContext={handleMemberContext}
                      presencePlatformsByUserId={presencePlatformsByUserId}
                    />
                  );
                case "media":
                  return (
                    <MediaTabContent
                      loading={state.tabLoading}
                      error={state.tabError}
                      items={state.mediaItems}
                      openImageViewer={openImageViewer}
                      onRetry={handleRetry}
                      onJumpToMessage={onJumpToMessage}
                      onClose={onClose}
                    />
                  );
                case "pins":
                  return (
                    <PinsTabContent
                      loading={loadingPins}
                      messages={pinnedMessages}
                      onJumpToMessage={(id: string) => {
                        onJumpToMessage?.(id);
                        onClose?.();
                      }}
                    />
                  );
                case "threads":
                  return (
                    <ThreadsTabContent
                      loading={state.tabLoading}
                      error={state.tabError}
                      threads={state.threads}
                      onOpenThread={(id: string) => {
                        onOpenThread?.(id);
                        onClose?.();
                      }}
                      onRetry={handleRetry}
                    />
                  );
                case "links":
                  return (
                    <LinksTabContent
                      loading={state.tabLoading}
                      error={state.tabError}
                      items={state.linkItems}
                      channelName={channelName}
                      onRetry={handleRetry}
                    />
                  );
                case "files":
                  return (
                    <FilesTabContent
                      loading={state.tabLoading}
                      error={state.tabError}
                      items={state.fileItems}
                      channelName={channelName}
                      onRetry={handleRetry}
                      onJumpToMessage={onJumpToMessage}
                      onClose={onClose}
                    />
                  );
                default:
                  return null;
              }
            })()}
          </div>
        </div>

        {menu.isOpen && (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            items={menu.items}
            onClose={closeMenu}
            isClosing={isClosing}
          />
        )}

        {state.popoverUser && state.popoverAnchor && (
          <UserProfilePopover
            userId={state.popoverUser.id}
            username={state.popoverUser.username}
            displayName={state.popoverUser.display_name}
            avatarUrl={state.popoverUser.avatar_url}
            avatarDisplay={state.popoverUser.avatar_display}
            seedUser={state.popoverUser}
            anchorEl={state.popoverAnchor}
            side="left"
            onClose={closePopover}
          />
        )}

        {state.mobileProfileUser && (
          <MobileProfileSheet
            user={state.mobileProfileUser.user}
            roles={state.mobileProfileUser.roles}
            isClosing={state.mobileProfileUserClosing}
            onClose={closeMobileProfile}
            onOpenProfileEditor={() =>
              closeMobileProfile(() => dispatchOpenProfileEditorEvent())
            }
            onBan={onBan}
            onKick={handleKick}
          />
        )}
      </div>
    </TooltipProvider>
  );
}

// ── Shared Sub-components ────────────────────────────────────────────────

function MobileHeader({
  onClose,
  onOpenSearch,
  onOpenSettings,
}: {
  onClose?: () => void;
  onOpenSearch?: () => void;
  onOpenSettings?: () => void;
}) {
  return (
    <div
      className="flex items-center justify-between pb-4 px-4 lg:hidden sticky top-0 bg-transparent z-10 shrink-0 border-b border-rm-border/30"
      style={{ paddingTop: "calc(16px + var(--safe-area-top, 0px))" }}
    >
      <ButtonBase
        onClick={onClose}
        className="p-1 -ml-1 text-rm-text-muted hover:text-rm-text transition-colors"
      >
        <ArrowLeft size={24} />
      </ButtonBase>
      <div className="flex items-center gap-5 text-rm-text-muted">
        <ButtonBase
          className="hover:text-rm-text transition-colors"
          onClick={() => {
            onOpenSearch?.();
            onClose?.();
          }}
        >
          <Search size={22} />
        </ButtonBase>
        <ButtonBase className="hover:text-rm-text transition-colors">
          <Bell size={22} />
        </ButtonBase>
        <ButtonBase
          className="hover:text-rm-text transition-colors"
          onClick={onOpenSettings}
        >
          <Settings size={22} />
        </ButtonBase>
      </div>
    </div>
  );
}

function DesktopHeader({
  channelName,
  onToggleDetails,
  isDM,
}: {
  channelName?: string;
  onToggleDetails?: () => void;
  isDM?: boolean;
}) {
  return (
    <div className="hidden lg:flex items-center justify-between px-4 py-3 border-b border-rm-border bg-transparent shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        {isDM ? (
          <AtSign className="h-[18px] w-[18px] text-rm-text-muted shrink-0" />
        ) : (
          <Hash className="h-[18px] w-[18px] text-rm-text-muted shrink-0" />
        )}
        <h2 className="text-[15px] font-bold text-rm-text-primary truncate">
          <InlineEmojiText
            text={channelName || (isDM ? "details" : "general")}
          />
        </h2>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <ButtonBase
            onClick={onToggleDetails}
            className="p-1.5 text-rm-text-muted hover:text-rm-text hover:bg-rm-bg-hover rounded-lg transition-colors shrink-0"
          >
            <ArrowLeft size={18} />
          </ButtonBase>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          sideOffset={10}
          className="rounded-lg border-none bg-rm-bg-floating px-3 py-2 text-[12px] font-bold text-rm-text-primary shadow-xl"
        >
          Close details
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

function MemberListTabs({
  channelName,
  activeTab,
  onTabChange,
  idPrefix,
  showDetails,
  isDM,
}: {
  channelName?: string;
  activeTab: TabId;
  onTabChange: (id: TabId) => void;
  idPrefix: string;
  showDetails?: boolean;
  isDM?: boolean;
}) {
  const renderTabs = (className: string, variant: "mobile" | "desktop") => (
    <div role="tablist" aria-label="Member details" className={className}>
      {TABS.map((tab) => (
        <MemberTabButton
          key={tab.id}
          tab={tab}
          activeTab={activeTab}
          onTabChange={onTabChange}
          idPrefix={`${idPrefix}-${variant}`}
        />
      ))}
    </div>
  );

  return (
    <>
      <div className="lg:hidden mb-6 shrink-0">
        <div className="flex items-center gap-2 mb-1">
          {isDM ? (
            <AtSign className="h-[24px] w-[24px] text-rm-text-muted shrink-0" />
          ) : (
            <Hash className="h-[24px] w-[24px] text-rm-text-muted shrink-0" />
          )}
          <h1 className="text-[26px] font-extrabold text-rm-text-primary tracking-tight leading-none truncate">
            <InlineEmojiText
              text={channelName || (isDM ? "details" : "general")}
            />
          </h1>
        </div>
        <p className="text-[13px] font-medium text-rm-text-muted mb-6 ml-8">
          {isDM ? "Direct Message" : "Text Channel"}
        </p>

        {renderTabs(
          "flex gap-6 overflow-x-auto custom-scrollbar no-scrollbar text-[15px] font-semibold text-rm-text-muted border-b border-rm-border pb-2.5",
          "mobile",
        )}
      </div>

      {showDetails && (
        <div className="hidden lg:block mb-4 shrink-0 px-2">
          {renderTabs(
            "flex gap-4 overflow-x-auto custom-scrollbar no-scrollbar text-[13px] font-semibold text-rm-text-muted border-b border-rm-border pb-2",
            "desktop",
          )}
        </div>
      )}
    </>
  );
}

function MemberTabButton({
  tab,
  activeTab,
  onTabChange,
  idPrefix,
}: {
  tab: { id: TabId; label: string };
  activeTab: TabId;
  onTabChange: (id: TabId) => void;
  idPrefix: string;
}) {
  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onTabChange(tab.id);
      return;
    }
    if (
      ![
        "ArrowRight",
        "ArrowDown",
        "ArrowLeft",
        "ArrowUp",
        "Home",
        "End",
      ].includes(event.key)
    ) {
      return;
    }
    event.preventDefault();
    const currentIndex = TABS.findIndex((item) => item.id === tab.id);
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? TABS.length - 1
          : (currentIndex +
              (event.key === "ArrowRight" || event.key === "ArrowDown"
                ? 1
                : -1) +
              TABS.length) %
            TABS.length;
    const tablist = event.currentTarget.parentElement;
    tablist
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      .item(nextIndex)
      ?.focus();
  };

  return (
    <button
      type="button"
      role="tab"
      id={`${idPrefix}-tab-${tab.id}`}
      aria-controls="member-details-panel"
      aria-selected={activeTab === tab.id}
      tabIndex={activeTab === tab.id ? 0 : -1}
      className={cn(
        "shrink-0 cursor-pointer transition-colors relative outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-rm-bg-primary rounded-sm",
        activeTab === tab.id ? "text-rm-text-primary" : "hover:text-rm-text",
      )}
      onClick={() => onTabChange(tab.id)}
      onKeyDown={handleKeyDown}
    >
      {tab.label}
      {activeTab === tab.id && (
        <span className="absolute -bottom-[11px] left-0 right-0 h-0.5 bg-primary rounded-t-full" />
      )}
    </button>
  );
}

function MobileInviteButton({
  onInviteClick,
  onClose,
}: {
  onInviteClick?: () => void;
  onClose?: () => void;
}) {
  return (
    <div className="lg:hidden mb-6 shrink-0 pt-2">
      <ButtonBase
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
          <span className="font-bold text-[16px] text-rm-text-primary">
            Invite Members
          </span>
        </div>
        <ChevronRight size={20} className="text-rm-text-muted" />
      </ButtonBase>
    </div>
  );
}
// ── Extracted Tab Components ──────────────────────────────────────────────

interface MembersTabContentProps {
  groups: { name: string; members: { user: User; roles?: Role[] }[] }[];
  sortedOffline: { user: User; roles?: Role[] }[];
  sortedOnline: { user: User; roles?: Role[] }[];
  presencePlatformsByUserId: Record<string, User["presence_platforms"]>;
  typingUsers?: Set<string>;
  currentUserId?: string;
  onMemberClick: (
    e: React.MouseEvent<HTMLButtonElement>,
    user: User,
    roles?: Role[],
  ) => void;
  onMemberContext: (
    e: React.MouseEvent,
    member: { user: User; roles?: Role[] },
  ) => void;
}
function MembersTabContent({
  groups,
  sortedOffline,
  sortedOnline,
  presencePlatformsByUserId,
  typingUsers,
  currentUserId,
  onMemberClick,
  onMemberContext,
}: MembersTabContentProps) {
  return (
    <>
      {groups.map((group) => (
        <div key={group.name}>
          <div className="flex items-center px-2 py-[10px] text-[11px] font-bold text-rm-text-muted">
            <span className="uppercase">{group.name}</span>
            <span className="ml-[6px] text-[11px] font-semibold tracking-[-0.02em]">
              {group.members.length}
            </span>
          </div>
          {group.members.map((member) => (
            <MemberItem
              key={member.user.id}
              member={member}
              isOnline={true}
              isTyping={typingUsers?.has(member.user.id)}
              isMe={member.user.id === currentUserId}
              platforms={
                presencePlatformsByUserId[member.user.id] ??
                member.user.presence_platforms
              }
              onClick={(e) => onMemberClick(e, member.user, member.roles)}
              onContextMenu={(e) => onMemberContext(e, member)}
            />
          ))}
        </div>
      ))}

      {sortedOffline.length > 0 && (
        <div>
          <div className="flex items-center px-2 py-[10px] text-[11px] font-bold text-rm-text-muted">
            <span className="uppercase">Offline</span>
            <span className="ml-[6px] text-[11px] font-semibold tracking-[-0.02em]">
              {sortedOffline.length}
            </span>
          </div>
          {sortedOffline.map((m) => (
            <MemberItem
              key={m.user.id}
              member={m}
              isOnline={false}
              isTyping={typingUsers?.has(m.user.id)}
              isMe={m.user.id === currentUserId}
              platforms={
                presencePlatformsByUserId[m.user.id] ??
                m.user.presence_platforms
              }
              onClick={(e) => onMemberClick(e, m.user, m.roles)}
              onContextMenu={(e) => onMemberContext(e, m)}
            />
          ))}
        </div>
      )}

      {sortedOnline.length === 0 && sortedOffline.length === 0 && (
        <div className="py-4 text-center text-xs text-rm-text-muted">
          No members found
        </div>
      )}
    </>
  );
}

interface MediaTabContentProps {
  loading: boolean;
  error: string | null;
  items: MediaItem[];
  openImageViewer: (
    attachments: Attachment[],
    index: number,
    context?: ViewerContext,
  ) => void;
  onRetry: () => void;
  onJumpToMessage?: (messageId: string) => void;
  onClose?: () => void;
}
function MediaTabContent({
  loading,
  error,
  items,
  openImageViewer,
  onRetry,
  onJumpToMessage,
  onClose,
}: MediaTabContentProps) {
  const getMediaItemSourceUrl = useCallback(
    (item: MediaItem) => item.url || item.file_key,
    [],
  );
  const getMediaItemPlaybackUrl = useCallback(
    (item: MediaItem) => {
      const sourceUrl = item.source_url ?? undefined;
      if (item.source_kind === "embed" && isVideo(item.content_type)) {
        return buildProxyMediaPath(getMediaItemSourceUrl(item), sourceUrl);
      }
      return getMediaItemSourceUrl(item);
    },
    [getMediaItemSourceUrl],
  );
  const getMediaItemPosterUrl = useCallback((item: MediaItem) => {
    const thumbnailUrl = item.thumbnail_url?.trim();
    if (!thumbnailUrl) return null;

    return item.source_kind === "embed"
      ? buildProxyMediaPath(thumbnailUrl, item.source_url ?? undefined)
      : thumbnailUrl;
  }, []);

  const mediaToAttachment = useCallback(
    (item: MediaItem): Attachment => ({
      id: item.id,
      message_id: item.message_id,
      filename: item.filename,
      file_key: item.file_key,
      content_type: item.content_type,
      size_bytes: item.size_bytes,
      url: isVideo(item.content_type)
        ? getMediaItemPlaybackUrl(item)
        : getMediaItemSourceUrl(item),
      isGif: item.is_gif,
      thumbnailUrl: item.thumbnail_url ?? null,
      sourceUrl: item.source_url ?? null,
    }),
    [getMediaItemPlaybackUrl, getMediaItemSourceUrl],
  );

  const handleMediaClick = useCallback(
    (index: number) => {
      const attachments = items.map(mediaToAttachment);
      const item = items[index];
      openImageViewer(attachments, index, {
        username: item.author.username,
        display_name: item.author.display_name ?? null,
        avatar_url: item.author.avatar_url,
        avatar_display: item.author.avatar_display,
        created_at: item.created_at,
        onJumpToMessage: onJumpToMessage
          ? (messageId: string) => {
              onJumpToMessage(messageId);
              onClose?.();
            }
          : undefined,
      });
    },
    [items, mediaToAttachment, onClose, onJumpToMessage, openImageViewer],
  );

  if (loading) return <MediaSkeletonGrid />;
  if (error) return <TabErrorState message={error} onRetry={onRetry} />;
  if (items.length === 0)
    return (
      <TabEmptyState icon={<Image size={40} />} label="No media shared yet" />
    );

  return (
    <div className="grid grid-cols-3 gap-1.5">
      {items.map((item, idx: number) => {
        const isItemVideo = isVideo(item.content_type);
        const displayName = getDisplayName(item.author);
        return (
          <ButtonBase
            key={item.id}
            onClick={() => handleMediaClick(idx)}
            className="aspect-square rounded-xl overflow-hidden bg-rm-bg-elevated border border-rm-border/20 hover:border-primary/40 transition-all group relative"
          >
            <div className="absolute top-1.5 right-1.5 z-10">
              <div className="h-6 w-6 rounded-full overflow-visible border-2 border-black/30 shadow-md bg-rm-bg-elevated">
                {item.author.avatar_url ? (
                  <AvatarImage
                    src={getAuthAssetUrl(item.author.avatar_url)}
                    alt={displayName}
                    display={item.author.avatar_display}
                  />
                ) : (
                  <div className="h-full w-full flex items-center justify-center bg-primary text-[9px] font-bold text-primary-foreground">
                    {getDisplayInitial(item.author)}
                  </div>
                )}
              </div>
            </div>
            <MediaGridImage
              src={
                isItemVideo
                  ? getMediaUrl(getMediaItemPlaybackUrl(item))
                  : getAuthAssetUrl(getMediaItemSourceUrl(item))
              }
              alt={item.filename}
              isVideo={isItemVideo}
              posterSrc={
                isItemVideo
                  ? (getMediaItemPosterUrl(item) ?? undefined)
                  : undefined
              }
              playbackProbe={
                isItemVideo && !item.is_gif
                  ? {
                      src: getMediaUrl(getMediaItemPlaybackUrl(item)),
                      contentType: item.content_type,
                      posterUrl: getMediaItemPosterUrl(item) ?? undefined,
                      sourceUrl: item.source_url ?? undefined,
                      isAnimated: false,
                    }
                  : undefined
              }
            />
            <div className="absolute inset-0 bg-linear-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2">
              <span className="text-[10px] font-bold text-white truncate">
                {item.filename}
              </span>
            </div>
          </ButtonBase>
        );
      })}
    </div>
  );
}

interface PinsTabContentProps {
  loading?: boolean;
  messages?: Message[];
  onJumpToMessage: (id: string) => void;
}
function PinsTabContent({
  loading,
  messages,
  onJumpToMessage,
}: PinsTabContentProps) {
  if (loading) return <TabSpinnerState />;
  if (!messages || messages.length === 0) {
    return (
      <TabEmptyState icon={<Pin size={40} />} label="No pinned messages" />
    );
  }
  return (
    <div className="space-y-3">
      {messages.map((msg) =>
        (() => {
          const displayName = getDisplayName(msg.author);
          return (
            <ButtonBase
              key={msg.id}
              className="w-full text-left bg-rm-bg-elevated hover:bg-rm-bg-hover border border-rm-border/30 rounded-xl p-3.5 transition-colors group"
              onClick={() => onJumpToMessage(msg.id)}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[9px] font-bold text-primary overflow-visible">
                  {msg.author?.avatar_url ? (
                    <AvatarImage
                      src={getAuthAssetUrl(msg.author.avatar_url)}
                      alt=""
                      display={msg.author.avatar_display}
                    />
                  ) : (
                    getDisplayInitial(msg.author)
                  )}
                </div>
                <span className="text-[12px] font-bold text-rm-text-primary truncate">
                  {displayName}
                </span>
                <span className="text-[10px] text-rm-text-muted ml-auto shrink-0">
                  {formatRelativeTime(msg.created_at)}
                </span>
              </div>
              <div className="text-[13px] text-rm-text-secondary line-clamp-2 leading-relaxed">
                <MarkdownRenderer content={msg.content.slice(0, 200)} />
              </div>
              {msg.attachments && msg.attachments.length > 0 && (
                <div className="mt-2 flex items-center gap-1.5 text-[10px] text-rm-text-muted">
                  <Image size={12} />
                  <span>
                    {msg.attachments.length} attachment
                    {msg.attachments.length > 1 ? "s" : ""}
                  </span>
                </div>
              )}
            </ButtonBase>
          );
        })(),
      )}
    </div>
  );
}

interface ThreadsTabContentProps {
  loading: boolean;
  error: string | null;
  threads: ThreadItem[];
  onOpenThread: (id: string) => void;
  onRetry: () => void;
}
function ThreadsTabContent({
  loading,
  error,
  threads,
  onOpenThread,
  onRetry,
}: ThreadsTabContentProps) {
  if (loading) return <TabSpinnerState />;
  if (error) return <TabErrorState message={error} onRetry={onRetry} />;
  if (threads.length === 0)
    return (
      <TabEmptyState
        icon={<MessageCircle size={40} />}
        label="No threads in this channel"
      />
    );
  return (
    <div className="space-y-2.5">
      {threads.map((thread) =>
        (() => {
          const displayName = getDisplayName(thread.author);
          return (
            <ButtonBase
              key={thread.id}
              className="w-full text-left bg-rm-bg-elevated hover:bg-rm-bg-hover border border-rm-border/30 rounded-xl p-3.5 transition-colors group"
              onClick={() => onOpenThread(thread.id)}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[9px] font-bold text-primary overflow-visible">
                  {thread.author.avatar_url ? (
                    <AvatarImage
                      src={getAuthAssetUrl(thread.author.avatar_url)}
                      alt=""
                      display={thread.author.avatar_display}
                    />
                  ) : (
                    getDisplayInitial(thread.author)
                  )}
                </div>
                <span className="text-[12px] font-bold text-rm-text-primary truncate">
                  {displayName}
                </span>
              </div>
              <div className="text-[13px] text-rm-text-secondary line-clamp-2 leading-relaxed mb-2">
                {thread.content}
              </div>
              <div className="flex items-center gap-3 text-[11px] text-rm-text-muted">
                <div className="flex items-center gap-1">
                  <MessageCircle size={12} />
                  <span className="font-semibold">{thread.reply_count}</span>
                  <span>{thread.reply_count === 1 ? "reply" : "replies"}</span>
                </div>
                <span className="text-[10px]">
                  {formatRelativeTime(thread.last_reply_at)}
                </span>
              </div>
            </ButtonBase>
          );
        })(),
      )}
    </div>
  );
}

interface LinksTabContentProps {
  loading: boolean;
  error: string | null;
  items: LinkItem[];
  channelName?: string;
  onRetry: () => void;
}
function LinksTabContent({
  loading,
  error,
  items,
  channelName,
  onRetry,
}: LinksTabContentProps) {
  if (loading) return <TabSpinnerState />;
  if (error) return <TabErrorState message={error} onRetry={onRetry} />;
  if (items.length === 0)
    return (
      <TabEmptyState icon={<Link2 size={40} />} label="No links shared yet" />
    );
  return (
    <div className="space-y-2.5">
      {items.map((item) => {
        const urls = extractUrls(item.content);
        const displayName = getDisplayName(item.author);

        return (
          <div
            key={item.id}
            className="bg-rm-bg-elevated border border-rm-border/30 rounded-xl p-3.5 transition-colors hover:bg-rm-bg-hover"
          >
            <div className="flex items-center gap-2 mb-2">
              <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[9px] font-bold text-primary overflow-visible">
                {item.author.avatar_url ? (
                  <AvatarImage
                    src={getAuthAssetUrl(item.author.avatar_url)}
                    alt={displayName}
                    display={item.author.avatar_display}
                  />
                ) : (
                  getDisplayInitial(item.author)
                )}
              </div>
              <span className="text-[12px] font-bold text-rm-text-primary truncate">
                {displayName}
              </span>
              {channelName && (
                <>
                  <span className="text-rm-text-muted/30">&middot;</span>
                  <span className="text-[11px] text-rm-text-muted flex items-center gap-0.5 shrink-0">
                    <Hash size={10} className="opacity-60" />
                    <InlineEmojiText text={channelName} />
                  </span>
                </>
              )}
              <span className="text-[10px] text-rm-text-muted ml-auto shrink-0">
                {formatRelativeTime(item.created_at)}
              </span>
            </div>
            {urls.map((url) => (
              <a
                key={url}
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
}

interface FilesTabContentProps {
  loading: boolean;
  error: string | null;
  items: MediaItem[];
  channelName?: string;
  onRetry: () => void;
  onJumpToMessage?: (id: string) => void;
  onClose?: () => void;
}
function FilesTabContent({
  loading,
  error,
  items,
  channelName,
  onRetry,
  onJumpToMessage,
  onClose,
}: FilesTabContentProps) {
  if (loading) return <TabSpinnerState />;
  if (error) return <TabErrorState message={error} onRetry={onRetry} />;
  if (items.length === 0) {
    const { Icon: EmptyIcon } = getFileIcon("file.txt");
    return (
      <TabEmptyState
        icon={<EmptyIcon size={40} />}
        label="No files shared yet"
      />
    );
  }
  return (
    <div className="space-y-2">
      {items.map((item) => {
        const { Icon: FileTypeIcon, colorClass } = getFileIcon(
          item.filename,
          item.content_type,
        );
        const uploadDate = new Date(item.created_at).toLocaleDateString(
          undefined,
          {
            month: "short",
            day: "numeric",
            year: "numeric",
          },
        );
        const displayName = getDisplayName(item.author);
        return (
          <div
            key={item.id}
            className="group relative flex cursor-pointer items-center gap-3 rounded-xl border border-rm-border/30 bg-rm-bg-elevated p-3.5 transition-colors hover:bg-rm-bg-hover outline-none focus-within:ring-2 focus-within:ring-primary/20"
          >
            <ButtonBase
              onClick={() => {
                onClose?.();
                setTimeout(() => onJumpToMessage?.(item.message_id), 150);
              }}
              aria-label={`Jump to shared file ${item.filename}`}
              className="absolute inset-0 z-10 rounded-xl outline-none"
            />
            <div
              className={cn(
                "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-rm-bg-surface border border-rm-border/30",
                colorClass,
              )}
            >
              <FileTypeIcon size={22} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-bold text-rm-text-primary truncate">
                {item.filename}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[11px] text-rm-text-muted">
                  {formatFileSize(item.size_bytes)}
                </span>
                <span className="text-rm-text-muted/30">&middot;</span>
                <span className="text-[11px] text-rm-text-muted">
                  {uploadDate}
                </span>
              </div>
              <div className="flex items-center gap-1.5 mt-1">
                <div className="h-4 w-4 rounded-full overflow-visible bg-rm-bg-surface border border-rm-border/30 shrink-0">
                  {item.author.avatar_url ? (
                    <AvatarImage
                      src={getAuthAssetUrl(item.author.avatar_url)}
                      alt={displayName}
                      display={item.author.avatar_display}
                    />
                  ) : (
                    <div className="h-full w-full flex items-center justify-center bg-primary text-[7px] font-bold text-primary-foreground">
                      {getDisplayInitial(item.author)}
                    </div>
                  )}
                </div>
                <span className="text-[11px] font-medium text-rm-text-muted truncate">
                  {displayName}
                </span>
                {channelName && (
                  <>
                    <span className="text-rm-text-muted/30">&middot;</span>
                    <span className="text-[11px] text-rm-text-muted flex items-center gap-0.5 shrink-0">
                      <Hash size={10} className="opacity-60" />
                      <InlineEmojiText text={channelName} />
                    </span>
                  </>
                )}
              </div>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <a
                  href={getDownloadUrl(item.url)}
                  download={item.filename}
                  onClick={(e) => e.stopPropagation()}
                  className="relative z-20 shrink-0 rounded-lg p-2 text-rm-text-muted opacity-0 transition-all hover:bg-primary/10 hover:text-primary group-hover:opacity-100"
                >
                  <Download size={16} />
                </a>
              </TooltipTrigger>
              <TooltipContent
                side="top"
                sideOffset={10}
                className="rounded-lg border-none bg-rm-bg-floating px-3 py-2 text-[12px] font-bold text-rm-text-primary shadow-xl"
              >
                Download
              </TooltipContent>
            </Tooltip>
          </div>
        );
      })}
    </div>
  );
}

// Shared sub-components

/** Spinner state for text-based tabs (threads, links, files, pins) */
function TabSpinnerState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3">
      <div className="h-6 w-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      <span className="text-[12px] font-bold text-rm-text-muted">
        Loading...
      </span>
    </div>
  );
}

/** Animated skeleton grid for the Media tab */
function MediaSkeletonGrid() {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {Array.from({ length: 9 }).map((_, i) => (
        <div
          key={i}
          className="aspect-square rounded-xl overflow-hidden bg-rm-bg-elevated border border-rm-border/20 relative"
        >
          {/* Shimmer animation */}
          <div className="absolute inset-0 bg-linear-to-r from-transparent via-rm-text-muted/5 to-transparent animate-shimmer" />
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

/** Individual media grid image/video with its own loading/error state */
function MediaGridImage({
  src,
  alt,
  isVideo,
  posterSrc,
  playbackProbe,
}: {
  src: string;
  alt: string;
  isVideo?: boolean;
  posterSrc?: string;
  playbackProbe?: VideoPlaybackAvailabilityRequest;
}) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!playbackProbe) return;
    void primeVideoPlaybackAvailability(playbackProbe);
  }, [playbackProbe]);

  if (error) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-rm-bg-elevated">
        <ImageOff size={20} className="text-rm-text-muted/30" />
      </div>
    );
  }

  if (isVideo) {
    if (posterSrc) {
      return (
        <>
          {!loaded && (
            <div className="absolute inset-0 bg-rm-bg-elevated flex items-center justify-center">
              <div className="h-5 w-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            </div>
          )}
          <img
            src={getAuthAssetUrl(posterSrc)}
            alt={alt}
            className={cn(
              "w-full h-full object-cover transition-all duration-300 group-hover:scale-105",
              loaded ? "opacity-100" : "opacity-0",
            )}
            loading="lazy"
            onLoad={() => setLoaded(true)}
            onError={() => setError(true)}
          />
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-5">
            <div className="w-10 h-10 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center shadow-lg border border-white/10">
              <PlayIcon className="w-5 h-5 text-white" />
            </div>
          </div>
        </>
      );
    }

    return (
      <>
        {!loaded && (
          <div className="absolute inset-0 bg-rm-bg-elevated flex items-center justify-center">
            <div className="h-5 w-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
        )}
        <video
          src={src.includes("#") ? src : `${src}#t=0.001`}
          muted
          preload="metadata"
          aria-label={alt}
          className={cn(
            "w-full h-full object-cover transition-all duration-300 group-hover:scale-105",
            loaded ? "opacity-100" : "opacity-0",
          )}
          onLoadedData={() => setLoaded(true)}
          onError={() => setError(true)}
        />
        {/* Play icon overlay */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-5">
          <div className="w-10 h-10 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center shadow-lg border border-white/10">
            <PlayIcon className="w-5 h-5 text-white" />
          </div>
        </div>
      </>
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
          loaded ? "opacity-100" : "opacity-0",
        )}
        loading="lazy"
        onLoad={() => setLoaded(true)}
        onError={() => setError(true)}
      />
    </>
  );
}

/** Error state with graphic and retry option */
function TabErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
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
        <p className="text-[14px] font-bold text-rm-text-primary">
          Failed to load
        </p>
        <p className="text-[12px] text-rm-text-muted max-w-[200px] leading-relaxed">
          {message}
        </p>
      </div>

      <ButtonBase
        onClick={onRetry}
        className="flex items-center gap-2 px-4 py-2 bg-rm-bg-elevated hover:bg-rm-bg-hover border border-rm-border rounded-xl text-[13px] font-bold text-rm-text-primary transition-colors"
      >
        <RefreshCw size={14} />
        Retry
      </ButtonBase>
    </div>
  );
}

function TabEmptyState({
  icon,
  label,
}: {
  icon: React.ReactNode;
  label: string;
}) {
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
  platforms,
  onClick,
  onContextMenu,
}: {
  member: { user: User; roles?: Role[] };
  isOnline: boolean;
  isTyping?: boolean;
  isMe?: boolean;
  platforms?: User["presence_platforms"];
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onContextMenu?: (e: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  const displayName = getDisplayName(member.user);
  const nameplatePresentation = getUserNameplatePresentation(member.user);
  const hasNameplate = nameplatePresentation.hasNameplate;
  const nameplateTheme = nameplatePresentation.theme;
  const highestRole = getHighestRole(member.roles);
  const isAdmin = Boolean(
    (highestRole?.permissions ?? 0) & PERMISSIONS.ADMINISTRATOR,
  );
  const shouldExtendNameplateMask =
    hasNameplate && (Boolean(platforms?.length) || isAdmin);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const trailingIconsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const rootNode = buttonRef.current;
    if (!rootNode) return;

    if (!shouldExtendNameplateMask) {
      rootNode.style.removeProperty(NAMEPLATE_MASK_SCALE_CSS_VAR);
      return;
    }

    const measure = () => {
      const trailingIconsNode = trailingIconsRef.current;
      if (!rootNode || !trailingIconsNode) return;

      const rootRect = rootNode.getBoundingClientRect();
      const trailingIconsRect = trailingIconsNode.getBoundingClientRect();
      if (rootRect.width <= 0 || trailingIconsRect.width <= 0) return;

      const nextFullOpacityStart = Math.min(
        99,
        Math.max(
          92.86,
          ((trailingIconsRect.right - rootRect.left + 12) / rootRect.width) *
            100,
        ),
      );
      const nextMaskScale = nextFullOpacityStart / 92.86;
      const currentMaskScale = Number.parseFloat(
        rootNode.style.getPropertyValue(NAMEPLATE_MASK_SCALE_CSS_VAR),
      );
      if (
        Number.isFinite(currentMaskScale) &&
        Math.abs(currentMaskScale * 92.86 - nextFullOpacityStart) < 0.25
      ) {
        return;
      }
      rootNode.style.setProperty(
        NAMEPLATE_MASK_SCALE_CSS_VAR,
        nextMaskScale.toString(),
      );
    };

    measure();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }

    const observer = new ResizeObserver(measure);
    if (buttonRef.current) observer.observe(buttonRef.current);
    if (trailingIconsRef.current) observer.observe(trailingIconsRef.current);
    return () => observer.disconnect();
  }, [shouldExtendNameplateMask, displayName, isAdmin, platforms]);

  return (
    <ButtonBase
      ref={buttonRef}
      className={cn(
        "group relative flex w-full cursor-pointer items-center gap-3 overflow-hidden border-0 bg-transparent p-0 text-left transition-colors lg:gap-2.5",
        "bg-rm-bg-elevated px-3.5 py-3 mb-2 rounded-2xl", // mobile
        hasNameplate
          ? "border border-transparent"
          : "border border-rm-border/30",
        hasNameplate && "isolate",
        hasNameplate
          ? "lg:bg-transparent lg:px-2 lg:py-1.5 lg:mb-0 lg:rounded-md lg:border-transparent lg:hover:bg-white/8"
          : "lg:bg-transparent lg:px-2 lg:py-1.5 lg:mb-0 lg:rounded-md lg:border-transparent lg:hover:bg-rm-bg-hover", // desktop
        !isOnline && "opacity-60 grayscale hover:opacity-100 hover:grayscale-0",
      )}
      style={
        hasNameplate && nameplateTheme
          ? {
              boxShadow: `inset 0 1px 0 ${nameplateTheme.rowBorder}, 0 0 0 1px ${nameplateTheme.rowBorder}, 0 14px 28px ${nameplateTheme.rowGlow}`,
            }
          : undefined
      }
      onClick={(e) => {
        if (e.button === 0) onClick?.(e);
      }}
      onContextMenu={onContextMenu}
      aria-label={`${displayName} (${isOnline ? "Online" : "Offline"})`}
    >
      {hasNameplate && (
        <>
          <UserNameplateLayer
            user={member.user}
            alt={`${displayName} nameplate`}
            className="pointer-events-none z-0 opacity-[0.98]"
            useMeasuredMask={shouldExtendNameplateMask}
          />
        </>
      )}
      <div className="relative z-10">
        <div className="flex h-10 w-10 lg:h-8 lg:w-8 shrink-0 items-center justify-center overflow-visible rounded-full bg-primary text-xs font-bold text-primary-foreground border border-rm-border transition-all group-hover:ring-2 group-hover:ring-primary/20">
          {member.user.avatar_url ? (
            <AvatarImage
              src={getAuthAssetUrl(member.user.avatar_url)}
              alt={displayName}
              display={member.user.avatar_display}
            />
          ) : (
            getDisplayInitial(member.user)
          )}
        </div>
        {isTyping && (member.user.status !== "offline" || isMe) ? (
          <div
            className={cn(
              "absolute -bottom-0.5 -right-0.5 z-20 flex h-4 w-5 lg:h-3.5 lg:w-4.5 items-center justify-center gap-0.5 rounded-full border-2 border-rm-bg-elevated lg:border-rm-bg-sidebar px-0.5",
              isMe && member.user.status === "offline"
                ? "bg-rm-text-muted/40"
                : "bg-primary",
            )}
          >
            <span className="h-0.5 w-0.5 rounded-full bg-rm-bg-primary animate-[pulse_900ms_cubic-bezier(0.16,1,0.3,1)_infinite]" />
            <span className="h-0.5 w-0.5 rounded-full bg-rm-bg-primary animate-[pulse_900ms_cubic-bezier(0.16,1,0.3,1)_infinite] [animation-delay:150ms]" />
            <span className="h-0.5 w-0.5 rounded-full bg-rm-bg-primary animate-[pulse_900ms_cubic-bezier(0.16,1,0.3,1)_infinite] [animation-delay:300ms]" />
          </div>
        ) : (
          <UserStatusDot
            status={isOnline ? (member.user.status ?? "online") : "offline"}
            className="absolute -bottom-0.5 -right-0.5 z-20 h-3.5 w-3.5 border-2 border-rm-bg-elevated transition-colors lg:h-3 lg:w-3 lg:border-rm-bg-sidebar"
          />
        )}
      </div>
      <div className="relative z-10 min-w-0 flex-1">
        <div className={cn("relative min-w-0 px-2 -ml-1 py-1")}>
          <div className="relative min-w-0">
            <div className="flex min-w-0 items-center gap-1.5">
              <div className="min-w-0 shrink">
                <UserDisplayName
                  user={member.user}
                  text={displayName}
                  className={cn(
                    "block min-w-0 truncate text-[15px] lg:text-[13px] font-bold lg:font-medium leading-[1.1] transition-colors",
                    hasNameplate
                      ? "text-rm-text-primary"
                      : !isOnline
                        ? "text-rm-text-secondary"
                        : "group-hover:text-rm-text",
                  )}
                  minContrastRatio={hasNameplate ? 2.8 : undefined}
                  style={
                    !hasNameplate && isOnline && !member.user.display_name_style
                      ? { color: highestRole?.color || undefined }
                      : undefined
                  }
                />
              </div>
              <div
                ref={trailingIconsRef}
                className="flex shrink-0 items-center gap-1.5 pl-0.5"
              >
                <UserPlatformIndicators
                  userId={member.user.id}
                  platforms={platforms}
                  status={member.user.status}
                  className="shrink-0"
                  iconClassName="h-3.5 w-3.5"
                />
                {isAdmin ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="flex shrink-0 items-center">
                        <Crown className="h-3 w-3 fill-primary/20 text-primary" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent
                      side="top"
                      sideOffset={8}
                      className="rounded-lg border-none bg-rm-bg-floating px-3 py-2 text-[12px] font-bold text-rm-text-primary shadow-xl"
                    >
                      Administrator
                    </TooltipContent>
                  </Tooltip>
                ) : null}
              </div>
            </div>

            {member.user.custom_status && (
              <div
                className={cn(
                  "mt-0.5 truncate text-[11px] font-medium italic",
                  hasNameplate
                    ? "text-rm-text-secondary"
                    : "text-rm-text-muted",
                )}
              >
                {member.user.custom_status}
              </div>
            )}
          </div>
        </div>
      </div>
    </ButtonBase>
  );
}
