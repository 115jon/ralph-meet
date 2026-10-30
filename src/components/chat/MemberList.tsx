import { AvatarImage } from "@/components/chat/AvatarImage";
import { avatarShape } from "@/components/ui/avatar-shape";
import { isMobileViewport } from "@/hooks/useMediaQuery";
import { ButtonBase } from "@/components/ui/button-base";
import { Button, Spinner } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { copyToClipboard, toast } from "@/components/ui/toast";
import { describeApiError } from "@/lib/api-errors";
import { HIT, PRESS, REVEAL } from "@/components/ui/interaction";
import { IconButton } from "@/components/ui/IconButton";
import { EmptyState } from "@/components/ui/empty-state";
import { Led } from "@/components/ui/led";
import { Num } from "@/components/ui/num";
import {
  PHONE_GROUP,
  PHONE_ICON_SLOT,
  PHONE_ROW,
  sidebarRowClass,
  TREE_BRANCH_GAP,
  TREE_BRANCH_LABEL,
} from "@/components/ui/sidebar-row";
import { TreeBranch, TreeLeaf } from "@/components/ui/tree";
import { useSpeakingAttr } from "@/hooks/useIsSpeaking";
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
import { getAuthAssetUrl, getDownloadUrl, getMediaUrl } from "@/lib/platform";
import { dispatchOpenProfileEditorEvent } from "@/lib/profile-editor-events";
import { buildProxyMediaPath } from "@/lib/proxy-media-url";
import type { Attachment, Role, User } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { VideoPlaybackAvailabilityRequest } from "@/lib/video-playback-availability";
import { primeVideoPlaybackAvailability } from "@/lib/video-playback-availability";
import {
  type VoiceChannelMember,
  useChatActions,
  useChatStore,
} from "@/stores/chat-store";
import { useCallStore } from "@/stores/useCallStore";
import type { ViewerContext } from "@/stores/useImageViewerStore";
import { useImageViewerActions } from "@/stores/useImageViewerStore";
import { TypingDots } from "./TypingDots";
import { normalizeUserStatus } from "./UserStatusDot";
import { PRESENCE_LED } from "@/components/ui/avatar";
import { Icon } from "@/components/ui/icon";
import {
  type CSSProperties,
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import ContextMenu from "./ContextMenu";
import InlineEmojiText from "./InlineEmojiText";
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

type TabId = "members" | "media" | "threads" | "links" | "files";

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
  onJumpToMessage,
  onOpenThread,
  showDetails,
  onToggleDetails,
  isDM,
}: MemberListProps) {
  const { menu, openMenu, closeMenu, isClosing } = useContextMenu();
  const { openDm, dispatch, setProfileUser } = useChatActions();
  const memberTabIdPrefix = useId().replace(/:/g, "");
  // Both select a primitive, so the list re-renders only when the owner or
  // your call changes; presence platforms, speaking and call membership are
  // selected per row.
  const ownerId = useChatStore((s) =>
    serverId && serverId !== "@me"
      ? (s.servers.find((server) => server.id === serverId)?.owner_id ?? null)
      : null,
  );
  const callChannelId = useChatStore((s) =>
    findCallChannelId(s.voiceChannelStates, currentUserId ?? s.user?.id),
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
    if (!channelId || state.activeTab === "members") {
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

  // Role groups (online, by highest role) and Offline, as tree branches.
  const groups = useMemo<MemberGroup[]>(() => {
    const isOnline = (m: MemberEntry) =>
      onlineUsers.has(m.user.id) && m.user.status !== "offline";
    const result: MemberGroup[] = [];
    for (const member of members
      .filter(isOnline)
      .toSorted(compareMembersByRole)) {
      const highestRole = getHighestRole(member.roles);
      const name =
        highestRole && !highestRole.is_default ? highestRole.name : "Online";
      let group = result.find((g) => g.online && g.name === name);
      if (!group) {
        group = { key: `role:${name}`, name, online: true, members: [] };
        result.push(group);
      }
      group.members.push(member);
    }
    const offline = members
      .filter((m) => !isOnline(m))
      .toSorted(compareMembersByRole);
    if (offline.length > 0) {
      result.push({
        key: "offline",
        name: "Offline",
        online: false,
        members: offline,
      });
    }
    return result;
  }, [members, onlineUsers]);

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
    (e: React.MouseEvent<HTMLButtonElement>, member: MemberEntry) => {
      const user = member.user;
      // On mobile, show full-screen profile sheet
      if (isMobileViewport()) {
        setState((prev) => ({ ...prev, mobileProfileUser: member }));
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
    async (e: React.MouseEvent, member: MemberEntry) => {
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
          onClick: () => void copyToClipboard(member.user.id, "User ID copied"),
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

  // Kick waits on a ConfirmDialog; the request runs from its confirm button.
  const [kickTarget, setKickTarget] = useState<{
    userId: string;
    username: string;
  } | null>(null);

  const handleKick = useCallback(
    (userId: string, username: string) => {
      if (onKick) {
        onKick(userId, username);
        return;
      }
      if (!serverId || serverId === "@me") return;
      setKickTarget({ userId, username });
    },
    [onKick, serverId],
  );

  const confirmKick = useCallback(async () => {
    if (!kickTarget || !serverId) return;
    try {
      await apiDelete(`/api/servers/${serverId}/members/${kickTarget.userId}`);
    } catch (err) {
      log.error("Failed to kick member:", err);
      throw err;
    }
    toast.success(`Kicked ${kickTarget.username}`);
  }, [kickTarget, serverId]);

  // Tab content renderers

  return (
    <TooltipProvider>
      <div
        data-testid="members-list"
        // The host's SidePanel places it: docked at lg, a sheet below, a
        // right drawer on phones.
        className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden md:bg-ply-0"
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
          className={cn(
            "relative flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4 pt-4 md:px-2",
            // The first branch's own 8px gap puts its label on the channel
            // tree's first-label baseline; details mode has tabs above.
            showDetails ? "md:pt-2" : "md:pt-0",
          )}
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
                      // A new server is a fresh list: rows must not play
                      // their join motion.
                      key={serverId ?? "none"}
                      groups={groups}
                      typingUsers={typingUsers}
                      currentUserId={currentUserId}
                      ownerId={ownerId}
                      callChannelId={callChannelId}
                      onMemberClick={handleMemberClick}
                      onMemberContext={handleMemberContext}
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

        <ConfirmDialog
          open={kickTarget !== null}
          onOpenChange={(open) => {
            if (!open) setKickTarget(null);
          }}
          title="Kick member"
          description={`${kickTarget?.username ?? ""} will be removed from this server. They can rejoin with an invite.`}
          confirmLabel="Kick"
          irreversible
          errorAction="kick this member"
          onConfirm={confirmKick}
        />
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
    <div className="flex h-[calc(48px+var(--safe-area-top,0px))] shrink-0 items-center justify-between gap-2 border-b border-line px-2 pt-[var(--safe-area-top,0px)] md:hidden">
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
    <div className="hidden h-12 shrink-0 items-center justify-between gap-2 border-b border-line px-4 md:flex">
      <div className="flex min-w-0 items-center gap-2">
        <Icon
          name={isDM ? "mention" : "textChannel"}
          size="md"
          className="shrink-0 text-ink-3"
        />
        <h2 className="truncate font-display-tuned text-[17px] leading-6 font-extrabold tracking-[-0.01em] text-ink-1">
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
            className="shrink-0 text-ink-3"
          />
          <h1 className="truncate font-display-tuned text-ui-xl font-extrabold tracking-[-0.02em] text-ink-1">
            <InlineEmojiText
              text={channelName || (isDM ? "details" : "general")}
            />
          </h1>
        </div>
        <p className="mt-1 mb-4 text-ui-sm text-ink-2">
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
          className="-mx-4 gap-6 border-b border-line px-4"
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
            className="h-10 border-b border-line"
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
            className={cn(PHONE_ICON_SLOT, "bg-accent-tint text-accent-ink")}
          >
            <Icon name="invite" size="lg" />
          </span>
          <span className="min-w-0 flex-1 truncate">Invite members</span>
          <Icon name="chevronRight" size="xs" className="shrink-0 text-ink-3" />
        </button>
      </div>
    </div>
  );
}
// ── Extracted Tab Components ──────────────────────────────────────────────

/**
 * Role groups (component kit, MemberPanel): a silkscreen label with its count
 * right-aligned, then 40px member rows with 32px square avatars. The groups
 * keep the TreeBranch structure (an in-call member's talk LED is its node)
 * but draw no guides; the LED sits in the row's left gutter. On phones each
 * group is one tinted, hairline-divided block (12.4).
 */
const MEMBER_GROUP =
  "max-md:divide-y max-md:divide-line max-md:overflow-hidden max-md:rounded-lg max-md:bg-tint-1";
/** The trunk drops from the label's first letter (list inset 8 + label px-2). */
const MEMBER_GUIDE_X = 8;
const MEMBER_ROW_H = 40;

type MemberEntry = { user: User; roles?: Role[] };
type MemberGroup = {
  key: string;
  name: string;
  online: boolean;
  members: MemberEntry[];
};

/** The voice channel a user is connected to, from the shared voice roster. */
function findCallChannelId(
  voiceChannelStates: Record<string, VoiceChannelMember[]>,
  userId: string | null | undefined,
): string | null {
  if (!userId) return null;
  for (const channelId in voiceChannelStates) {
    if (
      voiceChannelStates[channelId]?.some((m) => m.clerk_user_id === userId)
    ) {
      return channelId;
    }
  }
  return null;
}

interface MembersTabContentProps {
  groups: MemberGroup[];
  typingUsers?: Set<string>;
  currentUserId?: string;
  ownerId: string | null;
  callChannelId: string | null;
  onMemberClick: (
    e: React.MouseEvent<HTMLButtonElement>,
    member: MemberEntry,
  ) => void;
  onMemberContext: (e: React.MouseEvent, member: MemberEntry) => void;
}
function MembersTabContent({
  groups,
  typingUsers,
  currentUserId,
  ownerId,
  callChannelId,
  onMemberClick,
  onMemberContext,
}: MembersTabContentProps) {
  if (groups.length === 0) {
    return (
      <EmptyState
        size="sm"
        title="No members to show"
        description="People who join this server appear here."
      />
    );
  }

  return (
    <>
      {groups.map((group) => (
        <TreeBranch
          key={group.key}
          className={TREE_BRANCH_GAP}
          guideX={MEMBER_GUIDE_X}
          rowHeight={MEMBER_ROW_H}
          childrenClassName={MEMBER_GROUP}
          header={
            <h3 className={cn(TREE_BRANCH_LABEL, "max-md:mb-1 max-md:px-4")}>
              <span className="min-w-0 flex-1 truncate">
                {group.online ? (
                  <InlineEmojiText text={group.name} />
                ) : (
                  group.name
                )}
              </span>
              <Num className="shrink-0 text-ink-3">{group.members.length}</Num>
            </h3>
          }
        >
          {group.members.map((member) => (
            <MemberItem
              key={member.user.id}
              member={member}
              isOnline={group.online}
              isTyping={typingUsers?.has(member.user.id) ?? false}
              isMe={member.user.id === currentUserId}
              isOwner={!!ownerId && member.user.id === ownerId}
              callChannelId={callChannelId}
              onClick={onMemberClick}
              onContextMenu={onMemberContext}
            />
          ))}
        </TreeBranch>
      ))}
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
            className="aspect-square rounded-xl overflow-hidden bg-ply-2 border border-line/20 pointer-fine:hover:border-primary/40 transition-ui group relative"
          >
            <div className="absolute top-1.5 right-1.5 z-10">
              <div
                className={cn(
                  "h-6 w-6 border-2 border-black/30 shadow-md bg-ply-2",
                  avatarShape(
                    item.author.avatar_url && item.author.avatar_display,
                  ),
                )}
              >
                {item.author.avatar_url ? (
                  <AvatarImage
                    src={getAuthAssetUrl(item.author.avatar_url)}
                    alt={displayName}
                    display={item.author.avatar_display}
                  />
                ) : (
                  <div className="h-full w-full flex items-center justify-center bg-tint-2 text-ui-2xs font-semibold text-ink-2">
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
              <span className="text-ui-2xs font-semibold text-white truncate">
                {item.filename}
              </span>
            </div>
          </ButtonBase>
        );
      })}
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
              className="w-full text-left bg-ply-2 pointer-fine:hover:bg-tint-1 border border-line rounded-lg p-3 transition-colors group"
              onClick={() => onOpenThread(thread.id)}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <div
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center bg-tint-2 text-ui-2xs font-semibold text-ink-2",
                    avatarShape(
                      thread.author.avatar_url && thread.author.avatar_display,
                    ),
                  )}
                >
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
                <span className="text-ui-xs font-semibold text-ink-1 truncate">
                  <InlineEmojiText text={displayName} />
                </span>
              </div>
              <div className="text-ui-sm text-ink-2 line-clamp-2 leading-relaxed mb-2">
                <InlineEmojiText text={thread.content} />
              </div>
              <div className="flex items-center gap-3 text-ui-2xs text-ink-3">
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
            className="bg-ply-2 border border-line rounded-lg p-3 transition-colors pointer-fine:hover:bg-tint-1"
          >
            <div className="flex items-center gap-2 mb-2">
              <div
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center bg-tint-2 text-ui-2xs font-semibold text-ink-2",
                  avatarShape(
                    item.author.avatar_url && item.author.avatar_display,
                  ),
                )}
              >
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
              <span className="text-ui-xs font-semibold text-ink-1 truncate">
                <InlineEmojiText text={displayName} />
              </span>
              {channelName && (
                <>
                  <span className="text-ink-3/30">&middot;</span>
                  <span className="text-ui-2xs text-ink-3 flex items-center gap-0.5 shrink-0">
                    <Icon name="textChannel" size="xs" className="opacity-60" />
                    <InlineEmojiText text={channelName} />
                  </span>
                </>
              )}
              <span className="text-ui-2xs text-ink-3 ml-auto shrink-0">
                {formatRelativeTime(item.created_at)}
              </span>
            </div>
            {urls.map((url) => (
              <a
                key={url}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-ui-sm text-accent-ink pointer-fine:hover:underline truncate mt-1"
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
            className="group relative flex cursor-pointer items-center gap-3 rounded-lg border border-line bg-ply-2 p-3 transition-colors pointer-fine:hover:bg-tint-1 outline-none focus-within:ring-2 focus-within:ring-primary/20"
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
                "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-ply-2 border border-line/30",
                colorClass,
              )}
            >
              <Icon name={fileTypeIcon} size="xl" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-ui-sm font-semibold text-ink-1 truncate">
                {item.filename}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-ui-2xs text-ink-3">
                  {formatFileSize(item.size_bytes)}
                </span>
                <span className="text-ink-3/30">&middot;</span>
                <span className="text-ui-2xs text-ink-3">{uploadDate}</span>
              </div>
              <div className="flex items-center gap-1.5 mt-1">
                <div
                  className={cn(
                    "h-4 w-4 bg-ply-2 border border-line/30 shrink-0",
                    avatarShape(
                      item.author.avatar_url && item.author.avatar_display,
                    ),
                  )}
                >
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
                      className="size-full rounded-full bg-accent-tint"
                    />
                  )}
                </div>
                <span className="text-ui-2xs font-medium text-ink-3 truncate">
                  <InlineEmojiText text={displayName} />
                </span>
                {channelName && (
                  <>
                    <span className="text-ink-3/30">&middot;</span>
                    <span className="text-ui-2xs text-ink-3 flex items-center gap-0.5 shrink-0">
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
                    "relative z-20 flex size-8 shrink-0 items-center justify-center rounded-md text-ink-3 pointer-fine:hover:bg-tint-1 pointer-fine:hover:text-ink-1",
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
          className="h-14 animate-pulse rounded-md bg-tint-1 motion-reduce:animate-none"
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
          className="aspect-square animate-pulse rounded-lg bg-tint-1 motion-reduce:animate-none"
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
      <div className="w-full h-full flex items-center justify-center bg-ply-2">
        <Icon name="imageBroken" size="lg" className="text-ink-3/30" />
      </div>
    );
  }

  if (isVideo) {
    if (posterSrc) {
      return (
        <>
          {!loaded && (
            <div className="absolute inset-0 flex items-center justify-center bg-tint-1 text-ink-3">
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
          <div className="absolute inset-0 flex items-center justify-center bg-tint-1 text-ink-3">
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
        <div className="absolute inset-0 flex items-center justify-center bg-tint-1 text-ink-3">
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
      <Icon name="offline" size="2xl" className="text-ink-3" />
      <p className="text-ui-md font-semibold text-danger-ink">
        Unable to load this tab
      </p>
      <p className="max-w-[36ch] text-ui-sm text-pretty text-ink-2">
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
      <div className="text-ink-3">{icon}</div>
      <p className="text-ui-md font-semibold text-ink-1">{label}</p>
    </div>
  );
}

/**
 * One member row (component kit, MemberPanel): 40px, a 32px square avatar
 * with a presence LED cut from ply-0, text-ui-row 500 in ink-2,
 * ink-1 on hover. Someone in your call carries a talk LED on the guide that
 * lights while they speak; the leaf subscribes to that one user's flag, so a
 * speaking flip re-renders only this row. Offline rows dim to half.
 */
const MemberItem = memo(function MemberItem({
  member,
  isOnline,
  isTyping,
  isMe,
  isOwner,
  callChannelId,
  onClick,
  onContextMenu,
}: {
  member: MemberEntry;
  isOnline: boolean;
  isTyping: boolean;
  isMe: boolean;
  isOwner: boolean;
  callChannelId: string | null;
  onClick: (
    e: React.MouseEvent<HTMLButtonElement>,
    member: MemberEntry,
  ) => void;
  onContextMenu: (e: React.MouseEvent, member: MemberEntry) => void;
}) {
  const userId = member.user.id;
  const livePlatforms = useChatStore(
    (state) => state.presencePlatformsByUserId[userId],
  );
  const platforms = livePlatforms ?? member.user.presence_platforms;
  const inCall = useChatStore((state) =>
    callChannelId
      ? (state.voiceChannelStates[callChannelId]?.some(
          (m) => m.clerk_user_id === userId,
        ) ?? false)
      : false,
  );
  const speakingAttr = useSpeakingAttr(inCall ? userId : null);

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
  const status = isOnline ? (member.user.status ?? "online") : "offline";
  const showTyping = isTyping && (member.user.status !== "offline" || isMe);
  const shouldExtendNameplateMask =
    hasNameplate && (Boolean(platforms?.length) || isOwner);
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
  }, [shouldExtendNameplateMask, displayName, isOwner, platforms]);

  return (
    <TreeLeaf
      {...speakingAttr}
      node={inCall ? <Led state="talk" follow="speaking" /> : undefined}
      // No guides: the LED (when in your call) moves into the row's left
      // gutter so every avatar in the group starts on the same x.
      className="[&>.rm-tree-guide]:hidden"
      rowClassName="pl-0 max-md:h-auto [&>span:first-child]:absolute [&>span:first-child]:inset-y-0 [&>span:first-child]:left-0.5 [&>span:first-child]:z-20 max-md:[&>span:first-child]:left-1.5"
    >
      <ButtonBase
        ref={buttonRef}
        className={cn(
          sidebarRowClass({ tall: true }),
          "min-w-0 flex-1 cursor-pointer gap-3 overflow-hidden pl-2.5 transition-[color,background-color,opacity] focus-visible:outline-offset-[-2px]",
          // Phone (12.4): a 48px row inside the role's tinted group.
          "max-md:h-auto max-md:min-h-12 max-md:gap-3 max-md:rounded-none max-md:px-4 max-md:py-1.5 max-md:text-ui-base max-md:text-ink-1 max-md:active:bg-tint-2",
          !isOnline && "opacity-50 pointer-fine:hover:opacity-100",
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
          if (e.button === 0) onClick(e, member);
        }}
        onContextMenu={(e) => onContextMenu(e, member)}
        aria-label={`${displayName} (${isOnline ? "Online" : "Offline"}${showTyping ? ", typing" : ""})`}
      >
        {hasNameplate && (
          <UserNameplateLayer
            user={member.user}
            alt={`${displayName} nameplate`}
            className="pointer-events-none z-0 opacity-[0.98]"
            useMeasuredMask={shouldExtendNameplateMask}
          />
        )}
        <span className="relative z-10 shrink-0">
          <span
            className={cn(
              "flex size-10 items-center justify-center bg-tint-3 font-display-tuned text-[18px] leading-none font-extrabold text-ink-1 md:size-8 md:text-[14px]",
              avatarShape(member.user.avatar_url && member.user.avatar_display),
            )}
          >
            {member.user.avatar_url ? (
              <AvatarImage
                src={getAuthAssetUrl(member.user.avatar_url)}
                alt={displayName}
                display={member.user.avatar_display}
              />
            ) : (
              getDisplayInitial(member.user)
            )}
          </span>
          {showTyping ? (
            // Static: nothing loops in a list you can reach during a call.
            <span
              aria-hidden="true"
              className="absolute -right-1 -bottom-0.5 z-20 flex rounded-[2px] bg-ply-2 p-0.5 md:bg-ply-0"
            >
              <TypingDots variant="badge" />
            </span>
          ) : (
            // Presence: an LED in a square cut out of the panel ply.
            <span
              aria-hidden="true"
              data-presence={normalizeUserStatus(status)}
              className="absolute -right-0.5 -bottom-0.5 z-20 flex size-3.5 items-center justify-center rounded-[2px] bg-ply-2 md:size-3 md:bg-ply-0"
            >
              <Led state={PRESENCE_LED[normalizeUserStatus(status)]} />
            </span>
          )}
        </span>
        <span className="relative z-10 flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 shrink">
              <UserDisplayName
                user={member.user}
                text={displayName}
                className={cn(
                  "block min-w-0 truncate",
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
            </span>
            <div
              ref={trailingIconsRef}
              className="flex shrink-0 items-center gap-1.5"
            >
              <UserPlatformIndicators
                userId={userId}
                platforms={platforms}
                status={member.user.status}
                className="shrink-0"
                iconSize="xs"
              />
              {isOwner ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      role="img"
                      aria-label="Server owner"
                      className="flex shrink-0 items-center text-warning-ink"
                    >
                      <Icon name="crown" size="xs" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" sideOffset={8}>
                    Server owner
                  </TooltipContent>
                </Tooltip>
              ) : null}
            </div>
          </span>
          {member.user.custom_status && (
            <span className="truncate text-ui-xs font-normal text-ink-3">
              {member.user.custom_status}
            </span>
          )}
        </span>
      </ButtonBase>
    </TreeLeaf>
  );
});
