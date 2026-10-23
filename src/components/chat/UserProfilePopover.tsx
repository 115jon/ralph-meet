import { useMounted } from "@/hooks/useMounted";
import { isMobileViewport, useIsMobile } from "@/hooks/useMediaQuery";
import MobileProfileSheet from "@/components/chat/MobileProfileSheet";
import { ProfileAssetLayer } from "@/components/chat/ProfileAssetLayer";
import { getProfileEffectStageHeight } from "@/components/chat/ProfileCollectiblesLayer";
import { ProfileDisplayName } from "@/components/chat/ProfileDisplayName";
import { ProfileSurfaceShell } from "@/components/chat/ProfileSurfaceShell";
import { UserPlatformIndicators } from "@/components/chat/UserPlatformIndicators";
import { AvatarImage } from "@/components/chat/AvatarImage";
import { ButtonBase } from "@/components/ui/button-base";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { apiGet, apiPut } from "@/lib/api-client";
import { getDisplayInitial, getDisplayName } from "@/lib/display-name";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { getAuthAssetUrl } from "@/lib/platform";
import { dispatchOpenProfileEditorEvent } from "@/lib/profile-editor-events";
import { resolveProfileTheme } from "@/lib/profile-customization";
import type { Role, User } from "@/lib/types";
import { cn } from "@/lib/utils";
import { UserStatusDot, type UserStatus } from "./UserStatusDot";
import InlineEmojiText from "./InlineEmojiText";
import { useChatStore } from "@/stores/chat-store";
import { Icon } from "@/components/ui/icon";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { useShallow } from "zustand/shallow";

interface Props {
  userId: string;
  username: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  avatarDisplay?: User["avatar_display"];
  seedUser?: User | null;
  anchorEl: HTMLElement;
  onClose: () => void;
  side?: "left" | "right" | "top" | "bottom";
  align?: "start" | "center" | "end";
}

const MOBILE_MAX_SURFACE_HEIGHT = 680;
const DESKTOP_MAX_SURFACE_HEIGHT = 640;
const POPOVER_ACTION_BUTTON_CLASS =
  "flex h-8 w-8 items-center justify-center rounded-full border border-[color:var(--rm-profile-custom-card-border)] bg-[var(--rm-profile-custom-card-bg-strong)] text-[color:var(--rm-profile-custom-muted)] transition-colors pointer-fine:hover:bg-[var(--rm-profile-custom-card-bg)] pointer-fine:hover:text-[color:var(--rm-profile-custom-text)]";
const SECTION_TITLE_CLASS =
  "text-ui-2xs font-semibold uppercase tracking-[0.08em] mb-2 text-[color:var(--rm-profile-custom-muted)]";

const INITIAL_STATE = {
  isAssigningRoles: false,
  serverRoles: [] as Role[],
  loadingRoles: false,
  profileUser: null as User | null,
  mutualFriends: {
    count: 0,
    items: [] as Array<{
      id: string;
      username: string;
      display_name?: string | null;
      avatar_url?: string | null;
      avatar_display?: User["avatar_display"];
    }>,
  },
  mutualServers: {
    count: 0,
    items: [] as Array<{ id: string; name: string; icon_url?: string | null }>,
  },
  loadingProfile: false,
};

type LocalState = typeof INITIAL_STATE;
type LocalAction =
  | Partial<LocalState>
  | ((prev: LocalState) => Partial<LocalState>);

function TooltipIconButton({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <ButtonBase className={cn(POPOVER_ACTION_BUTTON_CLASS, className)}>
          {children}
        </ButtonBase>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={10}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

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
      className="relative h-[112px] overflow-hidden rounded-t-[inherit]"
      style={{ background: "var(--rm-profile-custom-banner-fallback)" }}
    >
      <ProfileAssetLayer
        url={bannerUrl}
        contentType={bannerContentType}
        alt="Profile banner"
        className="opacity-95"
      />
      <div
        className="absolute inset-0"
        style={{ background: "var(--rm-profile-custom-banner-overlay)" }}
      />
      <div className="absolute right-3 top-3 z-20 flex items-center gap-2">
        {canManageRoles ? (
          <TooltipIconButton label="Mod View">
            <Icon name="sword" size="sm" />
          </TooltipIconButton>
        ) : null}
        {!isMe ? (
          <TooltipIconButton label="Friends">
            <Icon name="userCheck" size="sm" />
          </TooltipIconButton>
        ) : null}
        <TooltipIconButton label="More Options">
          <Icon name="more" size="sm" />
        </TooltipIconButton>
      </div>
    </div>
  );
}

function PopoverAvatar({
  avatarUrl,
  avatarDisplay,
  displayName,
  isOnline,
  status,
}: {
  avatarUrl?: string | null;
  avatarDisplay?: User["avatar_display"];
  displayName: string;
  isOnline: boolean;
  status: UserStatus;
}) {
  return (
    <div className="relative z-30 -mt-12 px-4">
      <div className="relative inline-block rounded-full bg-[var(--rm-profile-custom-card-bg-strong)] p-1.5">
        <div className="relative flex h-[84px] w-[84px] items-center justify-center rounded-full bg-[var(--rm-profile-custom-button-bg)] text-ui-2xl font-semibold text-[color:var(--rm-profile-custom-button-text)]">
          {avatarUrl ? (
            <AvatarImage
              src={getAuthAssetUrl(avatarUrl)}
              alt={displayName}
              display={avatarDisplay}
            />
          ) : (
            getDisplayInitial({ name: displayName })
          )}
        </div>
        <div className="absolute bottom-1 right-1 z-20 rounded-full bg-[var(--rm-profile-custom-card-bg-strong)] p-1">
          <UserStatusDot
            status={isOnline ? status : "offline"}
            className="h-5 w-5 border-rm-bg-primary"
          />
        </div>
      </div>
    </div>
  );
}

function PopoverMutuals({
  loadingProfile,
  mutualFriends,
  mutualServers,
}: {
  loadingProfile: boolean;
  mutualFriends: LocalState["mutualFriends"];
  mutualServers: LocalState["mutualServers"];
}) {
  if (
    loadingProfile ||
    (mutualFriends.count === 0 && mutualServers.count === 0)
  ) {
    return null;
  }

  return (
    <div className="mt-4 space-y-2">
      {mutualFriends.count > 0 ? (
        <div className="flex items-center gap-2">
          <div className="flex -space-x-1.5 shrink-0">
            {mutualFriends.items.slice(0, 6).map((friend) => {
              const friendDisplayName = getDisplayName(friend);

              return (
                <Tooltip key={friend.id}>
                  <TooltipTrigger asChild>
                    <div className="flex h-5 w-5 items-center justify-center overflow-hidden rounded-full border border-[color:var(--rm-profile-custom-card-border)] bg-[var(--rm-profile-custom-card-bg-strong)]">
                      {friend.avatar_url ? (
                        <AvatarImage
                          src={getAuthAssetUrl(friend.avatar_url)}
                          alt={friendDisplayName}
                          display={friend.avatar_display}
                        />
                      ) : (
                        <span className="text-ui-2xs font-bold text-[color:var(--rm-profile-custom-muted)]">
                          {getDisplayInitial(friend)}
                        </span>
                      )}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top" sideOffset={8}>
                    {friendDisplayName}
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
          <span className="text-ui-2xs font-semibold text-[color:var(--rm-profile-custom-muted)]">
            {mutualFriends.count} Mutual Friend
            {mutualFriends.count === 1 ? "" : "s"}
          </span>
        </div>
      ) : null}

      {mutualServers.count > 0 ? (
        <div className="flex items-center gap-2">
          <div className="flex -space-x-1.5 shrink-0">
            {mutualServers.items.slice(0, 6).map((server) => (
              <Tooltip key={server.id}>
                <TooltipTrigger asChild>
                  <div className="flex h-5 w-5 items-center justify-center overflow-hidden rounded-md border border-[color:var(--rm-profile-custom-card-border)] bg-[var(--rm-profile-custom-card-bg-strong)]">
                    {server.icon_url ? (
                      <img
                        src={getAuthAssetUrl(server.icon_url)}
                        alt={server.name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="text-ui-2xs font-bold text-[color:var(--rm-profile-custom-muted)]">
                        {server.name[0]?.toUpperCase()}
                      </span>
                    )}
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={8}>
                  <InlineEmojiText text={server.name} />
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
          <span className="text-ui-2xs font-semibold text-[color:var(--rm-profile-custom-muted)]">
            {mutualServers.count} Mutual Server
            {mutualServers.count === 1 ? "" : "s"}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function RoleAssignmentDropdown({
  isAssigningRoles,
  loadingRoles,
  serverRoles,
  optimisticRoles,
  assignRole,
  dropdownRef,
}: {
  isAssigningRoles: boolean;
  loadingRoles: boolean;
  serverRoles: Role[];
  optimisticRoles?: Role[];
  assignRole: (roleId: string, currentRoleIds: string[]) => void;
  dropdownRef: RefObject<HTMLDivElement | null>;
}) {
  if (!isAssigningRoles) return null;

  const assignableRoles = serverRoles.filter((role) => !role.is_default);

  return (
    <div
      ref={dropdownRef}
      className="absolute right-0 top-7 z-70 w-48 rounded-lg border border-[color:var(--rm-profile-custom-card-border)] bg-[var(--rm-profile-custom-card-bg-strong)] p-1 shadow-xl animate-in fade-in zoom-in-95"
    >
      {loadingRoles ? (
        <div className="p-3 text-center text-ui-xs text-[color:var(--rm-profile-custom-muted)]">
          Loading...
        </div>
      ) : (
        <div className="max-h-48 overflow-y-auto custom-scrollbar">
          {assignableRoles.length === 0 ? (
            <div className="p-2 text-center text-ui-xs text-[color:var(--rm-profile-custom-muted)]">
              No custom roles available
            </div>
          ) : (
            assignableRoles.map((role) => {
              const hasRole = optimisticRoles?.some(
                (currentRole) => currentRole.id === role.id,
              );

              return (
                <ButtonBase
                  key={role.id}
                  onClick={(event) => {
                    event.stopPropagation();
                    const currentRoles =
                      optimisticRoles?.map((currentRole) => currentRole.id) ||
                      [];
                    assignRole(role.id, currentRoles);
                  }}
                  className={cn(
                    "group flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-ui-xs transition-colors pointer-fine:hover:bg-[var(--rm-profile-custom-card-bg)]",
                    hasRole
                      ? "font-medium text-[color:var(--rm-profile-custom-text)]"
                      : "text-[color:var(--rm-profile-custom-muted)]",
                  )}
                >
                  <div
                    className="h-3 w-3 shrink-0 rounded-full"
                    style={{ backgroundColor: role.color || "#94a3b8" }}
                  />
                  <InlineEmojiText
                    text={role.name}
                    className="flex-1 truncate"
                  />
                  {hasRole ? (
                    <Icon
                      name="check"
                      size="sm"
                      className="text-[color:var(--rm-profile-custom-accent)]"
                    />
                  ) : null}
                </ButtonBase>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

function PopoverRoles({
  optimisticRoles,
  canManageRoles,
  assignRole,
  handleToggleAssignRoles,
  dropdownProps,
}: {
  optimisticRoles?: Role[];
  canManageRoles: boolean;
  assignRole: (roleId: string, currentRoleIds: string[]) => void;
  handleToggleAssignRoles: (event: React.MouseEvent) => void;
  dropdownProps: {
    isAssigningRoles: boolean;
    loadingRoles: boolean;
    serverRoles: Role[];
    optimisticRoles?: Role[];
    assignRole: (roleId: string, currentRoleIds: string[]) => void;
    dropdownRef: RefObject<HTMLDivElement | null>;
  };
}) {
  const customRoles = optimisticRoles?.filter((role) => !role.is_default) ?? [];

  if (customRoles.length === 0 && !canManageRoles) return null;

  return (
    <div className="relative px-4 pb-4">
      <div className={SECTION_TITLE_CLASS}>Roles</div>
      <div className="flex flex-wrap items-center gap-1.5">
        {customRoles.map((role) => (
          <div
            key={role.id}
            className="group flex items-center gap-1.5 rounded border border-[color:var(--rm-profile-custom-card-border)] bg-[var(--rm-profile-custom-card-bg)] py-0.5 pl-2 pr-1 text-ui-2xs font-medium"
          >
            <div
              className="h-3 w-3 shrink-0 rounded-full"
              style={{ backgroundColor: role.color || "#94a3b8" }}
            />
            <span className="max-w-[120px] truncate py-0.5 pr-1 text-[color:var(--rm-profile-custom-muted)]">
              <InlineEmojiText text={role.name} />
            </span>
            {canManageRoles ? (
              <ButtonBase
                onClick={(event) => {
                  event.stopPropagation();
                  const currentRoles =
                    optimisticRoles?.map((currentRole) => currentRole.id) || [];
                  assignRole(role.id, currentRoles);
                }}
                className="rounded p-0.5 text-[color:var(--rm-profile-custom-muted)] pointer-fine:opacity-0 transition-ui pointer-fine:hover:bg-black/8 pointer-fine:hover:text-[color:var(--rm-profile-custom-text)] pointer-fine:group-hover:opacity-100"
              >
                <Icon name="close" size="xs" />
              </ButtonBase>
            ) : null}
          </div>
        ))}

        {canManageRoles ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <ButtonBase
                onClick={handleToggleAssignRoles}
                className="flex h-6 w-6 items-center justify-center rounded text-[color:var(--rm-profile-custom-muted)] transition-colors pointer-fine:hover:bg-[var(--rm-profile-custom-card-bg)] pointer-fine:hover:text-[color:var(--rm-profile-custom-text)]"
              >
                <Icon name="add" size="sm" />
              </ButtonBase>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={8}>
              Manage Roles
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>

      <RoleAssignmentDropdown {...dropdownProps} />
    </div>
  );
}

/**
 * One profile surface per form factor: the anchored popover on desktop, the
 * draggable profile drawer (MobileProfileSheet) on phones.
 */
export default function UserProfilePopover(props: Props) {
  const isMobile = useIsMobile();
  return isMobile ? (
    <MobileUserProfile {...props} />
  ) : (
    <DesktopUserProfilePopover {...props} />
  );
}

function MobileUserProfile({
  userId,
  username,
  displayName,
  avatarUrl,
  avatarDisplay,
  seedUser,
  onClose,
}: Props) {
  const [open, setOpen] = useState(true);
  // Let the drawer animate out before the owner unmounts it.
  useEffect(() => {
    if (open) return;
    const timer = window.setTimeout(onClose, 300);
    return () => window.clearTimeout(timer);
  }, [open, onClose]);

  const user: User = seedUser ?? {
    id: userId,
    username,
    display_name: displayName ?? null,
    avatar_url: avatarUrl ?? null,
    avatar_display: avatarDisplay,
  };

  return (
    <MobileProfileSheet
      open={open}
      user={user}
      onClose={() => setOpen(false)}
      onOpenProfileEditor={() => {
        setOpen(false);
        dispatchOpenProfileEditorEvent();
      }}
    />
  );
}

function DesktopUserProfilePopover({
  userId,
  username,
  displayName,
  avatarUrl,
  avatarDisplay,
  seedUser,
  anchorEl,
  onClose,
  side = "bottom",
  align: _align = "start",
}: Props) {
  const mounted = useMounted();
  const state = useChatStore(
    useShallow((store) => ({
      members: store.members,
      user: store.user,
      onlineUsers: store.onlineUsers,
      activeServerId: store.activeServerId,
      dispatch: store.dispatch,
      presencePlatformsByUserId: store.presencePlatformsByUserId,
    })),
  );

  const popoverRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const [surfaceStyle, setSurfaceStyle] = useState<CSSProperties>({
    opacity: 0,
    width: 340,
    height: 460,
  });
  const [localState, setLocalState] = useReducer(
    (previous: LocalState, next: LocalAction) => ({
      ...previous,
      ...(typeof next === "function" ? next(previous) : next),
    }),
    INITIAL_STATE,
  );

  const isMe = userId === state.user?.id;
  const isCurrentUserTarget = Boolean(
    state.user &&
    (isMe ||
      username === state.user.username ||
      seedUser?.username === state.user.username ||
      displayName === state.user.username ||
      displayName === state.user.display_name),
  );
  const member = state.members.find(
    (currentMember) => currentMember.user.id === userId,
  );
  const [optimisticRoles, setOptimisticRoles] = useState<Role[] | undefined>(
    member?.roles,
  );

  const fallbackUser = {
    ...seedUser,
    id: userId,
    username: seedUser?.username ?? username,
    display_name: displayName ?? seedUser?.display_name ?? null,
    avatar_url: avatarUrl ?? seedUser?.avatar_url ?? null,
    avatar_display: avatarDisplay ?? seedUser?.avatar_display ?? null,
    status: state.onlineUsers.has(userId)
      ? "online"
      : (seedUser?.status ?? "offline"),
  } as User;

  const seededUser = isCurrentUserTarget
    ? (state.user ?? member?.user ?? seedUser ?? fallbackUser)
    : (member?.user ?? seedUser ?? fallbackUser);
  const liveProfileUser =
    localState.profileUser?.id === userId ? localState.profileUser : null;
  const resolvedUser = liveProfileUser ?? seededUser;
  const resolvedUsername = resolvedUser.username ?? username;
  const resolvedDisplayName =
    resolvedUser.display_name?.trim() || displayName || resolvedUsername;
  const resolvedAvatarUrl = resolvedUser.avatar_url ?? avatarUrl;
  const resolvedAvatarDisplay = resolvedUser.avatar_display ?? avatarDisplay;
  const resolvedStatus =
    resolvedUser.status ?? member?.user.status ?? "offline";
  const resolvedPlatforms = state.presencePlatformsByUserId[userId]?.length
    ? state.presencePlatformsByUserId[userId]
    : resolvedUser.presence_platforms;
  const profileTheme = resolveProfileTheme(resolvedUser);
  const profileThemeStyle = profileTheme.variables;
  const isOnline =
    state.onlineUsers.has(userId) && resolvedStatus !== "offline";
  const surfaceWidth =
    typeof surfaceStyle.width === "number" ? surfaceStyle.width : 340;
  const profileEffectStageHeight = getProfileEffectStageHeight(surfaceWidth);

  useEffect(() => {
    setOptimisticRoles(member?.roles);
  }, [member?.roles]);

  const fetchUserProfile = useCallback(() => {
    if (!userId || isMe) return;

    setLocalState({
      loadingProfile: true,
      mutualFriends: INITIAL_STATE.mutualFriends,
      mutualServers: INITIAL_STATE.mutualServers,
    });
    apiGet<{
      user: User;
      mutualFriends: LocalState["mutualFriends"];
      mutualServers: LocalState["mutualServers"];
    }>(`/api/users/${userId}/profile`)
      .then((data) => {
        setLocalState({
          profileUser: data.user,
          mutualFriends: data.mutualFriends ?? INITIAL_STATE.mutualFriends,
          mutualServers: data.mutualServers ?? INITIAL_STATE.mutualServers,
        });
      })
      .catch(console.error)
      .finally(() => setLocalState({ loadingProfile: false }));
  }, [isMe, userId]);

  useEffect(() => {
    fetchUserProfile();
  }, [fetchUserProfile]);

  useLayoutEffect(() => {
    if (
      typeof window === "undefined" ||
      !popoverRef.current ||
      !contentRef.current
    )
      return undefined;

    let frameId = 0;

    const updateSurface = () => {
      if (!popoverRef.current || !contentRef.current) return;

      const rect = anchorEl.getBoundingClientRect();
      const isMobile = isMobileViewport();
      const viewportPadding = isMobile ? 8 : 10;
      const maxWidth = window.innerWidth - viewportPadding * 2;
      const maxHeight = Math.min(
        window.innerHeight - viewportPadding * 2,
        isMobile ? MOBILE_MAX_SURFACE_HEIGHT : DESKTOP_MAX_SURFACE_HEIGHT,
      );
      const width = Math.min(isMobile ? maxWidth : 344, maxWidth);

      popoverRef.current.style.width = `${width}px`;
      popoverRef.current.style.height = "auto";

      const naturalHeight = Math.ceil(
        contentRef.current.getBoundingClientRect().height,
      );
      const height = Math.min(naturalHeight, maxHeight);

      let left = viewportPadding;
      let top = viewportPadding;

      if (isMobile) {
        left = Math.max(viewportPadding, (window.innerWidth - width) / 2);
        top = Math.max(viewportPadding, (window.innerHeight - height) / 2);
      } else if (side === "left") {
        left = rect.left - width - 10;
        top = rect.top + rect.height / 2 - height / 2;
      } else if (side === "right") {
        left = rect.right + 10;
        top = rect.top + rect.height / 2 - height / 2;
      } else if (side === "top") {
        left = Math.min(rect.left, window.innerWidth - width - viewportPadding);
        top = rect.top - height - 10;
      } else {
        left = Math.min(rect.left, window.innerWidth - width - viewportPadding);
        top = rect.bottom + 10;
      }

      if (!isMobile) {
        if (top < viewportPadding) {
          top = Math.min(
            window.innerHeight - height - viewportPadding,
            rect.bottom + 10,
          );
        }
        if (left < viewportPadding && side === "left") {
          left = Math.min(
            window.innerWidth - width - viewportPadding,
            rect.right + 10,
          );
        }
        left = Math.max(
          viewportPadding,
          Math.min(left, window.innerWidth - width - viewportPadding),
        );
        top = Math.max(
          viewportPadding,
          Math.min(top, window.innerHeight - height - viewportPadding),
        );
      }

      setSurfaceStyle((previous) => {
        if (
          previous.opacity === 1 &&
          previous.width === width &&
          previous.height === height &&
          previous.left === left &&
          previous.top === top
        ) {
          return previous;
        }

        return {
          opacity: 1,
          width,
          height,
          left,
          top,
        };
      });
    };

    const scheduleUpdate = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(updateSurface);
    };

    scheduleUpdate();

    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => scheduleUpdate())
        : null;
    resizeObserver?.observe(contentRef.current);

    window.addEventListener("resize", scheduleUpdate);
    window.addEventListener("scroll", scheduleUpdate, true);

    return () => {
      window.cancelAnimationFrame(frameId);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", scheduleUpdate);
      window.removeEventListener("scroll", scheduleUpdate, true);
    };
  }, [anchorEl, side]);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(event.target as Node) &&
        !(
          dropdownRef.current &&
          dropdownRef.current.contains(event.target as Node)
        ) &&
        !anchorEl.contains(event.target as Node)
      ) {
        onCloseRef.current();
      }
    };

    const timer = window.setTimeout(() => {
      document.addEventListener("mousedown", handler);
    }, 50);

    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("mousedown", handler);
    };
  }, [anchorEl]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCloseRef.current();
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const myMember = state.members.find(
    (currentMember) => currentMember.user.id === state.user?.id,
  );
  const myTotalPerms =
    myMember?.roles?.reduce(
      (accumulator, role) => accumulator | role.permissions,
      0,
    ) ?? 0;
  const canManageRoles = hasPermission(myTotalPerms, PERMISSIONS.MANAGE_ROLES);

  const fetchRoles = async () => {
    if (localState.serverRoles.length > 0 || !state.activeServerId) return;
    setLocalState({ loadingRoles: true });
    try {
      const data = await apiGet<Role[]>(
        `/api/servers/${state.activeServerId}/roles`,
      );
      setLocalState({ serverRoles: data });
    } catch (error) {
      console.error("Failed to fetch roles:", error);
    } finally {
      setLocalState({ loadingRoles: false });
    }
  };

  const handleToggleAssignRoles = (event: React.MouseEvent) => {
    event.stopPropagation();
    if (!localState.isAssigningRoles) {
      void fetchRoles();
    }
    setLocalState((previous) => ({
      isAssigningRoles: !previous.isAssigningRoles,
    }));
  };

  const assignRole = (roleId: string, currentRoleIds: string[]) => {
    const serverId = state.activeServerId;
    if (!serverId) return;

    const role = localState.serverRoles.find(
      (currentRole) => currentRole.id === roleId,
    );
    if (!role) return;

    const isAdding = !currentRoleIds.includes(roleId);
    const newRoleIds = isAdding
      ? [...currentRoleIds, roleId]
      : currentRoleIds.filter((currentRoleId) => currentRoleId !== roleId);

    if (isAdding) {
      setOptimisticRoles((previous) =>
        previous ? [...previous, role] : [role],
      );
    } else {
      setOptimisticRoles(
        (previous) =>
          previous?.filter((currentRole) => currentRole.id !== roleId) || [],
      );
    }

    void apiPut<Role[]>(`/api/servers/${serverId}/members/${userId}/roles`, {
      roleIds: newRoleIds,
    })
      .then((roles) => {
        setOptimisticRoles(roles);
        state.dispatch({
          type: "UPDATE_MEMBER_ROLES",
          serverId,
          userId,
          roles,
        });
      })
      .catch((error) => {
        console.error("Failed to assign role:", error);
        setOptimisticRoles(member?.roles);
      });
  };

  const handleOpenProfileEditor = () => {
    dispatchOpenProfileEditorEvent(anchorEl);
    onClose();
  };

  const dropdownProps = {
    isAssigningRoles: localState.isAssigningRoles,
    loadingRoles: localState.loadingRoles,
    serverRoles: localState.serverRoles,
    optimisticRoles,
    assignRole,
    dropdownRef,
  };

  if (!mounted) return null;

  return createPortal(
    <TooltipProvider delayDuration={0}>
      <div className="contents">
        <div
          className="fixed inset-0 z-40 cursor-default bg-black/50 md:bg-transparent md:pointer-events-none animate-in fade-in duration-200"
          onClick={onClose}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" ||
              event.key === " " ||
              event.key === "Escape"
            ) {
              onClose();
            }
          }}
          role="presentation"
          aria-hidden="true"
        />

        <ProfileSurfaceShell
          ref={popoverRef}
          variant="popover"
          display={resolvedAvatarDisplay}
          className="fixed z-60 animate-in fade-in zoom-in-95 duration-200 outline-none"
          style={{
            ...surfaceStyle,
            ...profileThemeStyle,
          }}
          effectStageClassName="left-0 top-0 w-full"
          effectStageStyle={{ height: profileEffectStageHeight }}
          aria-label={`User profile for ${resolvedUsername}`}
          tabIndex={-1}
        >
          <div className="relative h-full overflow-y-auto custom-scrollbar">
            <div ref={contentRef} className="relative">
              <PopoverBanner
                bannerUrl={resolvedUser.banner_url}
                bannerContentType={resolvedUser.banner_content_type}
                canManageRoles={canManageRoles}
                isMe={isMe}
              />

              <PopoverAvatar
                avatarUrl={resolvedAvatarUrl}
                avatarDisplay={resolvedAvatarDisplay}
                displayName={resolvedDisplayName}
                isOnline={isOnline}
                status={resolvedStatus}
              />

              <div className="relative z-20 px-4 pb-4 pt-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      {isMe ? (
                        <button
                          type="button"
                          onClick={handleOpenProfileEditor}
                          className="rounded-md text-left transition pointer-fine:hover:underline pointer-fine:hover:decoration-[color:var(--rm-profile-custom-text)]/65 pointer-fine:hover:underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
                        >
                          <ProfileDisplayName
                            text={resolvedDisplayName}
                            displayNameStyle={resolvedUser.display_name_style}
                            className="text-ui-xl font-semibold leading-tight text-[color:var(--rm-profile-custom-text)]"
                            backgroundColor={profileTheme.backgroundColor}
                            readableFallbackColor={profileTheme.textColor}
                          />
                        </button>
                      ) : (
                        <ProfileDisplayName
                          text={resolvedDisplayName}
                          displayNameStyle={resolvedUser.display_name_style}
                          className="text-ui-xl font-semibold leading-tight text-[color:var(--rm-profile-custom-text)]"
                          backgroundColor={profileTheme.backgroundColor}
                          readableFallbackColor={profileTheme.textColor}
                        />
                      )}

                      <UserPlatformIndicators
                        userId={userId}
                        platforms={resolvedPlatforms}
                        status={resolvedStatus}
                        className="shrink-0"
                        iconSize="sm"
                        color="var(--rm-profile-custom-muted)"
                        offlineColor="var(--rm-profile-custom-ghost)"
                      />

                      {!isMe ? (
                        <ButtonBase className="text-[color:var(--rm-profile-custom-muted)] transition-colors pointer-fine:hover:text-[color:var(--rm-profile-custom-text)]">
                          <Icon name="fileAdd" size="sm" />
                        </ButtonBase>
                      ) : null}
                    </div>

                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-ui-sm font-medium text-[color:var(--rm-profile-custom-muted)]">
                      {isMe ? (
                        <button
                          type="button"
                          onClick={handleOpenProfileEditor}
                          className="rounded-md text-left transition pointer-fine:hover:underline pointer-fine:hover:decoration-[color:var(--rm-profile-custom-text)]/55 pointer-fine:hover:underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
                        >
                          @{resolvedUsername}
                        </button>
                      ) : (
                        <span>@{resolvedUsername}</span>
                      )}

                      {resolvedUser.pronouns?.trim() ? (
                        <>
                          <span
                            aria-hidden="true"
                            className="text-[color:var(--rm-profile-custom-muted)]/65"
                          >
                            •
                          </span>
                          <span>{resolvedUser.pronouns.trim()}</span>
                        </>
                      ) : null}
                    </div>

                    {resolvedUser.custom_status?.trim() ? (
                      <p className="mt-3 text-ui-sm italic text-[color:var(--rm-profile-custom-muted)]">
                        {resolvedUser.custom_status.trim()}
                      </p>
                    ) : null}
                  </div>
                </div>

                {resolvedUser.bio?.trim() ? (
                  <div className="mt-4 rounded-xl border border-[color:var(--rm-profile-custom-card-border)] bg-[var(--rm-profile-custom-card-bg-strong)]/92 px-4 py-3 text-ui-sm leading-6 text-[color:var(--rm-profile-custom-text)]">
                    {resolvedUser.bio.trim()}
                  </div>
                ) : null}

                {!isMe ? (
                  <PopoverMutuals
                    loadingProfile={localState.loadingProfile}
                    mutualFriends={localState.mutualFriends}
                    mutualServers={localState.mutualServers}
                  />
                ) : null}
              </div>

              <PopoverRoles
                optimisticRoles={optimisticRoles}
                canManageRoles={canManageRoles}
                assignRole={assignRole}
                handleToggleAssignRoles={handleToggleAssignRoles}
                dropdownProps={dropdownProps}
              />

              {!isMe ? (
                <div className="relative z-20 mt-1 px-4 pb-4">
                  <div className="group flex items-center justify-between rounded-xl border border-[color:var(--rm-profile-custom-card-border)] bg-[var(--rm-profile-custom-card-bg-strong)] px-3 py-2.5 transition-colors pointer-fine:hover:border-white/25 focus-within:border-white/30">
                    <input
                      type="text"
                      aria-label={`Message ${resolvedUsername}`}
                      className="w-full bg-transparent text-ui-xs font-medium text-[color:var(--rm-profile-custom-text)] outline-none placeholder:text-[color:var(--rm-profile-custom-muted)]"
                      placeholder={`Message @${resolvedUsername}`}
                    />
                    <Icon
                      name="emoji"
                      size="sm"
                      className="ml-2 shrink-0 cursor-pointer text-[color:var(--rm-profile-custom-muted)] transition-colors pointer-fine:hover:text-[color:var(--rm-profile-custom-text)]"
                    />
                  </div>
                </div>
              ) : (
                <div className="relative z-20 px-4 pb-4">
                  <button
                    type="button"
                    onClick={handleOpenProfileEditor}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border border-primary/28 bg-primary/18 px-4 py-3 text-ui-sm font-semibold text-[color:var(--rm-profile-custom-text)] transition pointer-fine:hover:bg-primary/24 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
                  >
                    <Icon name="edit" size="sm" />
                    Edit Profile
                  </button>
                </div>
              )}
            </div>
          </div>
        </ProfileSurfaceShell>
      </div>
    </TooltipProvider>,
    document.body,
  );
}
