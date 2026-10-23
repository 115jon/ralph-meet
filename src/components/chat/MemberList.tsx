import { AvatarImage } from "@/components/chat/AvatarImage";
import { isMobileViewport } from "@/hooks/useMediaQuery";
import { ButtonBase } from "@/components/ui/button-base";
import { Button, Spinner } from "@/components/ui/button";
import { describeApiError } from "@/lib/api-errors";
import { HIT, PRESS, REVEAL } from "@/components/ui/interaction";
import { IconButton } from "@/components/ui/IconButton";
import {
  PHONE_GROUP,
  PHONE_ICON_SLOT,
  PHONE_ROW,
} from "@/components/ui/sidebar-row";
import { Tabs } from "@/components/ui/tabs";
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
import { Icon } from "@/components/ui/icon";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import ContextMenu from "./ContextMenu";
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
        log.error(`Failed to load ${activeTab} tab:`, err);
        partialState.tabError = describeApiError(err, `load ${activeTab}`);
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
      if (isMobileViewport()) {
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
          icon: <Icon name="account" size="sm" />,
          onClick: () => setProfileUser(member.user),
        },
        {
          label: "Message",
          icon: <Icon name="chat" size="sm" />,
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
                label: "Start a call",
                icon: <Icon name="call" size="sm" />,
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
          icon: <Icon name="copy" size="sm" />,
          onClick: () => navigator.clipboard.writeText(member.user.id),
          divider: !!onBan && member.user.id !== currentUserId,
        },
        ...(onBan && member.user.id !== currentUserId
          ? [
              {
                label: "Ban",
                icon: <Icon name="ban" size="sm" />,
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
        // The host's SidePanel places it: docked at lg, a sheet below, a
        // right drawer on phones.
        className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden"
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
          className="relative flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4 pt-4 custom-scrollbar md:px-2 md:pt-2"
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
            open={!state.mobileProfileUserClosing}
            user={state.mobileProfileUser.user}
            roles={state.mobileProfileUser.roles}
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
  /** Channel settings; omitted when you can't manage the channel. */
  onOpenSettings?: () => void;
}) {
  // Phone page header (12.2): 48px + safe area, 40px buttons at the edges.
  return (
    <div className="flex h-[calc(48px+var(--safe-area-top,0px))] shrink-0 items-center justify-between gap-2 border-b border-rm-border px-2 pt-[var(--safe-area-top,0px)] md:hidden">
      <IconButton
        aria-label="Close member list"
        icon="back"
        variant="muted"
        size="md"
        onClick={onClose}
      />
      <div className="flex items-center gap-2">
        <IconButton
          aria-label="Search this channel"
          icon="search"
          variant="muted"
          size="md"
          onClick={() => {
            onOpenSearch?.();
            onClose?.();
          }}
        />
        {onOpenSettings ? (
          <IconButton
            aria-label="Channel settings"
            icon="settings"
            variant="muted"
            size="md"
            onClick={onOpenSettings}
          />
        ) : null}
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
    <div className="hidden h-12 shrink-0 items-center justify-between gap-2 border-b border-rm-border px-4 md:flex">
      <div className="flex min-w-0 items-center gap-2">
        <Icon
          name={isDM ? "mention" : "textChannel"}
          size="md"
          className="shrink-0 text-rm-text-muted"
        />
        <h2 className="truncate text-ui-md font-semibold text-rm-text">
          <InlineEmojiText
            text={channelName || (isDM ? "details" : "general")}
          />
        </h2>
      </div>
      <IconButton
        icon="back"
        variant="muted"
        size="sm"
        tooltip="Close details"
        onClick={onToggleDetails}
      />
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
  const items = TABS.map((tab) => ({ value: tab.id, label: tab.label }));

  return (
    <>
      <div className="mb-4 shrink-0 md:hidden">
        <div className="flex min-w-0 items-center gap-2">
          <Icon
            name={isDM ? "mention" : "textChannel"}
            size="xl"
            className="shrink-0 text-rm-text-muted"
          />
          <h1 className="truncate text-ui-xl font-semibold text-rm-text">
            <InlineEmojiText
              text={channelName || (isDM ? "details" : "general")}
            />
          </h1>
        </div>
        <p className="mt-1 mb-4 text-ui-sm text-rm-text-secondary">
          {isDM ? "Direct message" : "Text channel"}
        </p>

        {/* Scrolls sideways with an edge fade, so "Files" is never clipped
            without a cue; 44px tall on touch. */}
        <Tabs
          label="Member details"
          idBase={`${idPrefix}-mobile`}
          panelId="member-details-panel"
          items={items}
          value={activeTab}
          onValueChange={onTabChange}
          scrollable
          className="-mx-4 gap-6 border-b border-rm-border px-4"
        />
      </div>

      {showDetails && (
        <div className="mb-2 hidden shrink-0 px-2 md:block">
          <Tabs
            label="Member details"
            idBase={`${idPrefix}-desktop`}
            panelId="member-details-panel"
            items={items}
            value={activeTab}
            onValueChange={onTabChange}
            scrollable
            className="h-10 border-b border-rm-border"
          />
        </div>
      )}
    </>
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
    <div className="mb-2 shrink-0 md:hidden">
      <div className={PHONE_GROUP}>
        <button
          type="button"
          className={PHONE_ROW}
          onClick={() => {
            onInviteClick?.();
            onClose?.();
          }}
        >
          <span
            className={cn(
              PHONE_ICON_SLOT,
              "bg-rm-accent-tint text-rm-accent-ink",
            )}
          >
            <Icon name="invite" size="lg" />
          </span>
          <span className="min-w-0 flex-1 truncate">Invite members</span>
          <Icon
            name="chevronRight"
            size="xs"
            className="shrink-0 text-rm-text-muted"
          />
        </button>
      </div>
    </div>
  );
}
// ── Extracted Tab Components ──────────────────────────────────────────────

/**
 * Role groups: on phones one tinted, hairline-divided group per role (12.4);
 * on desktop bare rows under the eyebrow (12.3).
 */
const MEMBER_GROUP =
  "flex flex-col max-md:divide-y max-md:divide-rm-border max-md:overflow-hidden max-md:rounded-lg max-md:bg-rm-tint-1 md:gap-0.5";
const MEMBER_GROUP_LABEL =
  "flex items-center px-4 pt-6 pb-2 text-ui-2xs font-semibold uppercase tracking-[0.08em] text-rm-text-muted group-first/role:pt-2 md:px-2 md:pt-4 md:pb-1";

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
        <div key={group.name} className="group/role">
          <h3 className={MEMBER_GROUP_LABEL}>
            <InlineEmojiText text={group.name} className="uppercase" />
            <span className="ml-1.5 font-medium tabular-nums tracking-normal">
              {group.members.length}
            </span>
          </h3>
          <div className={MEMBER_GROUP}>
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
        </div>
      ))}

      {sortedOffline.length > 0 && (
        <div className="group/role">
          <h3 className={MEMBER_GROUP_LABEL}>
            <span className="uppercase">Offline</span>
            <span className="ml-1.5 font-medium tabular-nums tracking-normal">
              {sortedOffline.length}
            </span>
          </h3>
          <div className={MEMBER_GROUP}>
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
        </div>
      )}

      {sortedOnline.length === 0 && sortedOffline.length === 0 && (
        <div className="py-4 text-center text-ui-xs text-rm-text-muted">
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
      <TabEmptyState
        icon={<Icon name="image" size="2xl" />}
        label="No media shared yet"
      />
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
            className="aspect-square rounded-xl overflow-hidden bg-rm-bg-elevated border border-rm-border/20 pointer-fine:hover:border-primary/40 transition-ui group relative"
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
                  <div className="h-full w-full flex items-center justify-center bg-primary text-ui-2xs font-bold text-primary-foreground">
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
            <div className="absolute inset-0 bg-linear-to-t from-black/60 to-transparent opacity-0 pointer-fine:group-hover:opacity-100 transition-opacity flex items-end p-2">
              <span className="text-ui-2xs font-bold text-white truncate">
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
      <TabEmptyState
        icon={<Icon name="pin" size="2xl" />}
        label="No pinned messages"
      />
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
              className="w-full text-left bg-rm-bg-surface pointer-fine:hover:bg-rm-tint-1 border border-rm-border rounded-lg p-3 transition-colors group"
              onClick={() => onJumpToMessage(msg.id)}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-ui-2xs font-bold text-primary overflow-visible">
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
                <span className="text-ui-xs font-semibold text-rm-text truncate">
                  <InlineEmojiText text={displayName} />
                </span>
                <span className="text-ui-2xs text-rm-text-muted ml-auto shrink-0">
                  {formatRelativeTime(msg.created_at)}
                </span>
              </div>
              <div className="text-ui-sm text-rm-text-secondary line-clamp-2 leading-relaxed">
                <MarkdownRenderer content={msg.content.slice(0, 200)} />
              </div>
              {msg.attachments && msg.attachments.length > 0 && (
                <div className="mt-2 flex items-center gap-1.5 text-ui-2xs text-rm-text-muted">
                  <Icon name="image" size="xs" />
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
        icon={<Icon name="chat" size="2xl" />}
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
              className="w-full text-left bg-rm-bg-surface pointer-fine:hover:bg-rm-tint-1 border border-rm-border rounded-lg p-3 transition-colors group"
              onClick={() => onOpenThread(thread.id)}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-ui-2xs font-bold text-primary overflow-visible">
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
                <span className="text-ui-xs font-semibold text-rm-text truncate">
                  <InlineEmojiText text={displayName} />
                </span>
              </div>
              <div className="text-ui-sm text-rm-text-secondary line-clamp-2 leading-relaxed mb-2">
                <InlineEmojiText text={thread.content} />
              </div>
              <div className="flex items-center gap-3 text-ui-2xs text-rm-text-muted">
                <div className="flex items-center gap-1">
                  <Icon name="chat" size="xs" />
                  <span className="font-semibold">{thread.reply_count}</span>
                  <span>{thread.reply_count === 1 ? "reply" : "replies"}</span>
                </div>
                <span className="text-ui-2xs">
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
      <TabEmptyState
        icon={<Icon name="link" size="2xl" />}
        label="No links shared yet"
      />
    );
  return (
    <div className="space-y-2.5">
      {items.map((item) => {
        const urls = extractUrls(item.content);
        const displayName = getDisplayName(item.author);

        return (
          <div
            key={item.id}
            className="bg-rm-bg-surface border border-rm-border rounded-lg p-3 transition-colors pointer-fine:hover:bg-rm-tint-1"
          >
            <div className="flex items-center gap-2 mb-2">
              <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-ui-2xs font-bold text-primary overflow-visible">
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
              <span className="text-ui-xs font-semibold text-rm-text truncate">
                <InlineEmojiText text={displayName} />
              </span>
              {channelName && (
                <>
                  <span className="text-rm-text-muted/30">&middot;</span>
                  <span className="text-ui-2xs text-rm-text-muted flex items-center gap-0.5 shrink-0">
                    <Icon name="textChannel" size="xs" className="opacity-60" />
                    <InlineEmojiText text={channelName} />
                  </span>
                </>
              )}
              <span className="text-ui-2xs text-rm-text-muted ml-auto shrink-0">
                {formatRelativeTime(item.created_at)}
              </span>
            </div>
            {urls.map((url) => (
              <a
                key={url}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-ui-sm text-primary pointer-fine:hover:underline truncate mt-1"
              >
                <Icon name="externalLink" size="xs" className="shrink-0" />
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
    const { icon: emptyIcon } = getFileIcon("file.txt");
    return (
      <TabEmptyState
        icon={<Icon name={emptyIcon} size="2xl" />}
        label="No files shared yet"
      />
    );
  }
  return (
    <div className="space-y-2">
      {items.map((item) => {
        const { icon: fileTypeIcon, colorClass } = getFileIcon(
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
            className="group relative flex cursor-pointer items-center gap-3 rounded-lg border border-rm-border bg-rm-bg-surface p-3 transition-colors pointer-fine:hover:bg-rm-tint-1 outline-none focus-within:ring-2 focus-within:ring-primary/20"
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
              <Icon name={fileTypeIcon} size="xl" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-ui-sm font-semibold text-rm-text truncate">
                {item.filename}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-ui-2xs text-rm-text-muted">
                  {formatFileSize(item.size_bytes)}
                </span>
                <span className="text-rm-text-muted/30">&middot;</span>
                <span className="text-ui-2xs text-rm-text-muted">
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
                    // 16px is too small for a legible initial; the name sits
                    // beside it, so the fallback is a plain tint.
                    <div
                      aria-hidden
                      className="size-full rounded-full bg-rm-accent-tint"
                    />
                  )}
                </div>
                <span className="text-ui-2xs font-medium text-rm-text-muted truncate">
                  <InlineEmojiText text={displayName} />
                </span>
                {channelName && (
                  <>
                    <span className="text-rm-text-muted/30">&middot;</span>
                    <span className="text-ui-2xs text-rm-text-muted flex items-center gap-0.5 shrink-0">
                      <Icon
                        name="textChannel"
                        size="xs"
                        className="opacity-60"
                      />
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
                  aria-label={`Download ${item.filename}`}
                  className={cn(
                    "relative z-20 flex size-8 shrink-0 items-center justify-center rounded-md text-rm-text-muted pointer-fine:hover:bg-rm-tint-1 pointer-fine:hover:text-rm-text",
                    PRESS,
                    HIT,
                    "relative",
                    REVEAL,
                  )}
                >
                  <Icon name="download" size="sm" />
                </a>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={10}>
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

/** Skeleton rows for the text tabs (threads, links, files, pins), 14.2. */
function TabSpinnerState() {
  return (
    <div role="status" className="flex flex-col gap-2 py-2">
      <span className="sr-only">Loading</span>
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          aria-hidden
          className="h-14 animate-pulse rounded-md bg-rm-tint-1 motion-reduce:animate-none"
        />
      ))}
    </div>
  );
}

/** Skeleton tiles for the Media tab, at the real tile size. */
function MediaSkeletonGrid() {
  return (
    <div role="status" className="grid grid-cols-3 gap-1.5">
      <span className="sr-only">Loading</span>
      {Array.from({ length: 9 }).map((_, i) => (
        <div
          key={i}
          aria-hidden
          className="aspect-square animate-pulse rounded-lg bg-rm-tint-1 motion-reduce:animate-none"
        />
      ))}
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
        <Icon name="imageBroken" size="lg" className="text-rm-text-muted/30" />
      </div>
    );
  }

  if (isVideo) {
    if (posterSrc) {
      return (
        <>
          {!loaded && (
            <div className="absolute inset-0 flex items-center justify-center bg-rm-tint-1 text-rm-text-muted">
              <Spinner />
            </div>
          )}
          <img
            src={getAuthAssetUrl(posterSrc)}
            alt={alt}
            className={cn(
              "w-full h-full object-cover transition-ui",
              loaded ? "opacity-100" : "opacity-0",
            )}
            loading="lazy"
            onLoad={() => setLoaded(true)}
            onError={() => setError(true)}
          />
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
            <div className="w-10 h-10 rounded-full bg-black/60 flex items-center justify-center shadow-lg border border-white/10">
              <PlayIcon className="w-5 h-5 text-white" />
            </div>
          </div>
        </>
      );
    }

    return (
      <>
        {!loaded && (
          <div className="absolute inset-0 flex items-center justify-center bg-rm-tint-1 text-rm-text-muted">
            <Spinner />
          </div>
        )}
        <video
          src={src.includes("#") ? src : `${src}#t=0.001`}
          muted
          preload="metadata"
          aria-label={alt}
          className={cn(
            "w-full h-full object-cover transition-ui",
            loaded ? "opacity-100" : "opacity-0",
          )}
          onLoadedData={() => setLoaded(true)}
          onError={() => setError(true)}
        />
        {/* Play icon overlay */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <div className="w-10 h-10 rounded-full bg-black/60 flex items-center justify-center shadow-lg border border-white/10">
            <PlayIcon className="w-5 h-5 text-white" />
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-rm-tint-1 text-rm-text-muted">
          <Spinner />
        </div>
      )}
      <img
        src={src}
        alt={alt}
        className={cn(
          "w-full h-full object-cover transition-ui",
          loaded ? "opacity-100" : "opacity-0",
        )}
        loading="lazy"
        onLoad={() => setLoaded(true)}
        onError={() => setError(true)}
      />
    </>
  );
}

/** Whole-tab error: the empty-state anatomy with a danger title (14.3). */
function TabErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 px-6 py-12 text-center"
    >
      <Icon name="offline" size="2xl" className="text-rm-text-muted" />
      <p className="text-ui-md font-semibold text-rm-danger-ink">
        Unable to load this tab
      </p>
      <p className="max-w-[36ch] text-ui-sm text-pretty text-rm-text-secondary">
        {message}
      </p>
      <Button variant="secondary" onClick={onRetry}>
        <Icon name="refresh" size="sm" />
        Try again
      </Button>
    </div>
  );
}

/** Empty tab (14.1): muted illustration and a title, no box. */
function TabEmptyState({
  icon,
  label,
}: {
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <div className="text-rm-text-muted">{icon}</div>
      <p className="text-ui-md font-semibold text-rm-text">{label}</p>
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
  // Role colour for the name; light themes darken it in CSS (.rm-role-name).
  const roleNameColor =
    !hasNameplate && isOnline && !member.user.display_name_style
      ? highestRole?.color || undefined
      : undefined;
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
        // Phone (12.4): a 48px row inside the role's tinted group.
        "group relative flex min-h-12 w-full cursor-pointer items-center gap-3 overflow-hidden px-4 py-1.5 text-left text-rm-text outline-none transition-colors duration-150 ease-(--rm-ease-out) active:bg-rm-tint-2",
        // Desktop (12.3): the tall sidebar row.
        "md:h-10 md:min-h-0 md:gap-2.5 md:rounded-md md:px-2 md:py-0 md:pointer-coarse:min-h-11 pointer-fine:hover:bg-rm-tint-1",
        hasNameplate && "isolate",
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
      <div className="relative z-10 shrink-0">
        <div className="flex size-10 shrink-0 items-center justify-center overflow-visible rounded-full bg-rm-accent-tint text-ui-sm font-semibold text-rm-accent-ink md:size-8 md:text-ui-xs">
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
              "absolute -right-0.5 -bottom-0.5 z-20 flex h-4 w-5 items-center justify-center gap-0.5 rounded-full border-2 border-rm-bg-surface px-0.5 md:border-rm-bg-sidebar",
              isMe && member.user.status === "offline"
                ? "bg-rm-text-muted"
                : "bg-rm-accent-solid",
            )}
          >
            <span className="h-0.5 w-0.5 rounded-full bg-rm-bg-primary animate-[pulse_900ms_cubic-bezier(0.16,1,0.3,1)_infinite]" />
            <span className="h-0.5 w-0.5 rounded-full bg-rm-bg-primary animate-[pulse_900ms_cubic-bezier(0.16,1,0.3,1)_infinite] [animation-delay:150ms]" />
            <span className="h-0.5 w-0.5 rounded-full bg-rm-bg-primary animate-[pulse_900ms_cubic-bezier(0.16,1,0.3,1)_infinite] [animation-delay:300ms]" />
          </div>
        ) : (
          <UserStatusDot
            status={isOnline ? (member.user.status ?? "online") : "offline"}
            className="absolute -right-0.5 -bottom-0.5 z-20 size-3 border-2 border-rm-bg-surface md:border-rm-bg-sidebar"
          />
        )}
      </div>
      <div className="relative z-10 min-w-0 flex-1">
        <div className="relative min-w-0">
          <div className="relative min-w-0">
            <div className="flex min-w-0 items-center gap-1.5">
              <div className="min-w-0 shrink">
                <UserDisplayName
                  user={member.user}
                  text={displayName}
                  className={cn(
                    "block min-w-0 truncate text-ui-base leading-5 font-medium",
                    hasNameplate || isOnline
                      ? "text-rm-text"
                      : "text-rm-text-muted",
                    roleNameColor && "rm-role-name",
                  )}
                  minContrastRatio={hasNameplate ? 2.8 : undefined}
                  style={
                    roleNameColor
                      ? ({
                          color: roleNameColor,
                          "--rm-role-color": roleNameColor,
                        } as CSSProperties)
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
                  iconSize="sm"
                />
                {isAdmin ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="flex shrink-0 items-center">
                        <Icon name="crown" size="xs" className="text-primary" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" sideOffset={8}>
                      Administrator
                    </TooltipContent>
                  </Tooltip>
                ) : null}
              </div>
            </div>

            {member.user.custom_status && (
              <div className={cn("truncate text-ui-xs text-rm-text-secondary")}>
                {member.user.custom_status}
              </div>
            )}
          </div>
        </div>
      </div>
    </ButtonBase>
  );
}
