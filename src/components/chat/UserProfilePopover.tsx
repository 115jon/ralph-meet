import { useIsMobile } from "@/hooks/useMediaQuery";
import MobileProfileSheet from "@/components/chat/MobileProfileSheet";
import { ProfileAssetLayer } from "@/components/chat/ProfileAssetLayer";
import {
  PROFILE_EFFECT_STAGE_HEIGHT,
  PROFILE_EFFECT_STAGE_WIDTH,
} from "@/components/chat/ProfileCollectiblesLayer";
import { ProfileDisplayName } from "@/components/chat/ProfileDisplayName";
import { ProfileSurfaceShell } from "@/components/chat/ProfileSurfaceShell";
import { UserPlatformIndicators } from "@/components/chat/UserPlatformIndicators";
import { AvatarImage } from "@/components/chat/AvatarImage";
import { RowError } from "@/components/chat/settings/primitives";
import { Button } from "@/components/ui/button";
import { ButtonBase } from "@/components/ui/button-base";
import { HIT, REVEAL } from "@/components/ui/interaction";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent } from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { apiGet, apiPut } from "@/lib/api-client";
import { describeApiError } from "@/lib/api-errors";
import { getDisplayInitial, getDisplayName } from "@/lib/display-name";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { getAuthAssetUrl } from "@/lib/platform";
import { dispatchOpenProfileEditorEvent } from "@/lib/profile-editor-events";
import { resolveProfileTheme } from "@/lib/profile-customization";
import type { Role, User } from "@/lib/types";
import { cn } from "@/lib/utils";
import { UserStatusDot, type UserStatus } from "./UserStatusDot";
import InlineEmojiText from "./InlineEmojiText";
import { useChatActions, useChatStore } from "@/stores/chat-store";
import { Icon } from "@/components/ui/icon";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
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

/** PopoverContent variant="rich" width. */
const SECTION_TITLE_CLASS =
  "text-ui-2xs font-semibold uppercase tracking-[0.08em] mb-2 text-[color:var(--rm-profile-custom-muted)]";

const INITIAL_STATE = {
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

function PopoverBanner({
  bannerUrl,
  bannerContentType,
}: {
  bannerUrl?: string | null;
  bannerContentType?: string | null;
}) {
  return (
    <div
      className="relative h-28 overflow-hidden rounded-t-[inherit]"
      style={{ background: "var(--rm-profile-custom-banner-fallback)" }}
    >
      <ProfileAssetLayer
        url={bannerUrl}
        contentType={bannerContentType}
        alt=""
        className="opacity-95"
      />
      <div
        className="absolute inset-0"
        style={{ background: "var(--rm-profile-custom-banner-overlay)" }}
      />
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
        <div className="relative flex size-20 items-center justify-center rounded-full bg-[var(--rm-profile-custom-button-bg)] text-ui-2xl font-semibold text-[color:var(--rm-profile-custom-button-text)]">
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
            className="size-4"
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
                        <span className="text-ui-2xs font-semibold text-[color:var(--rm-profile-custom-muted)]">
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
            {mutualFriends.count === 1
              ? "1 mutual friend"
              : `${mutualFriends.count} mutual friends`}
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
                      <span className="text-ui-2xs font-semibold text-[color:var(--rm-profile-custom-muted)]">
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
            {mutualServers.count === 1
              ? "1 mutual server"
              : `${mutualServers.count} mutual servers`}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function RoleAssignmentMenu({
  loadingRoles,
  serverRoles,
  optimisticRoles,
  assignRole,
  onOpen,
}: {
  loadingRoles: boolean;
  serverRoles: Role[];
  optimisticRoles?: Role[];
  assignRole: (roleId: string, currentRoleIds: string[]) => void;
  onOpen: () => void;
}) {
  const assignableRoles = serverRoles.filter((role) => !role.is_default);

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) onOpen();
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger
            render={
              <ButtonBase
                aria-label="Add a role"
                className={cn(
                  "relative flex size-6 items-center justify-center rounded-sm text-[color:var(--rm-profile-custom-muted)] transition-colors pointer-fine:hover:bg-[var(--rm-profile-custom-card-bg)] pointer-fine:hover:text-[color:var(--rm-profile-custom-text)]",
                  HIT,
                )}
              />
            }
          >
            <Icon name="add" size="sm" />
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={8}>
          Add a role
        </TooltipContent>
      </Tooltip>
      {/* Opened from the popover: the stacked layer above it (11.1). */}
      <DropdownMenuContent align="end" aria-label="Roles" stacked>
        {loadingRoles ? (
          <DropdownMenuItem disabled>Loading roles…</DropdownMenuItem>
        ) : assignableRoles.length === 0 ? (
          <DropdownMenuItem disabled>No roles to assign yet</DropdownMenuItem>
        ) : (
          assignableRoles.map((role) => {
            const hasRole = Boolean(
              optimisticRoles?.some(
                (currentRole) => currentRole.id === role.id,
              ),
            );

            return (
              <DropdownMenuCheckboxItem
                key={role.id}
                checked={hasRole}
                onCheckedChange={() => {
                  const currentRoles =
                    optimisticRoles?.map((currentRole) => currentRole.id) || [];
                  assignRole(role.id, currentRoles);
                }}
                icon={
                  <span
                    className="size-3 rounded-full"
                    style={{
                      backgroundColor: role.color || "var(--rm-text-muted)",
                    }}
                  />
                }
              >
                <InlineEmojiText text={role.name} />
              </DropdownMenuCheckboxItem>
            );
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PopoverRoles({
  optimisticRoles,
  canManageRoles,
  assignRole,
  menuProps,
}: {
  optimisticRoles?: Role[];
  canManageRoles: boolean;
  assignRole: (roleId: string, currentRoleIds: string[]) => void;
  menuProps: React.ComponentProps<typeof RoleAssignmentMenu>;
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
            className="group flex items-center gap-1.5 rounded-sm border border-[color:var(--rm-profile-custom-card-border)] bg-[var(--rm-profile-custom-card-bg)] py-0.5 pl-2 pr-1 text-ui-2xs font-medium"
          >
            <div
              className="size-3 shrink-0 rounded-full"
              style={{ backgroundColor: role.color || "var(--rm-text-muted)" }}
            />
            <span className="max-w-[120px] truncate py-0.5 pr-1 text-[color:var(--rm-profile-custom-muted)]">
              <InlineEmojiText text={role.name} />
            </span>
            {canManageRoles ? (
              <ButtonBase
                aria-label={`Remove the ${role.name} role`}
                onClick={(event) => {
                  event.stopPropagation();
                  const currentRoles =
                    optimisticRoles?.map((currentRole) => currentRole.id) || [];
                  assignRole(role.id, currentRoles);
                }}
                className={cn(
                  "relative rounded-xs p-0.5 text-[color:var(--rm-profile-custom-muted)] pointer-fine:hover:bg-rm-tint-2 pointer-fine:hover:text-[color:var(--rm-profile-custom-text)]",
                  HIT,
                  REVEAL,
                )}
              >
                <Icon name="close" size="xs" />
              </ButtonBase>
            ) : null}
          </div>
        ))}

        {canManageRoles ? <RoleAssignmentMenu {...menuProps} /> : null}
      </div>
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
  align = "start",
}: Props) {
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

  const popupRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const { openDm } = useChatActions();
  const [error, setError] = useState<string | null>(null);
  const [openingDm, setOpeningDm] = useState(false);
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
      .catch((cause) =>
        setError(
          describeApiError(cause, `load ${displayName || username}'s profile`),
        ),
      )
      .finally(() => setLocalState({ loadingProfile: false }));
  }, [isMe, userId, displayName, username]);

  useEffect(() => {
    fetchUserProfile();
  }, [fetchUserProfile]);

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
    } catch (cause) {
      setError(describeApiError(cause, "load this server's roles"));
    } finally {
      setLocalState({ loadingRoles: false });
    }
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
      .catch((cause) => {
        setOptimisticRoles(member?.roles);
        setError(
          describeApiError(cause, `update ${resolvedDisplayName}'s roles`),
        );
      });
  };

  const handleMessage = async () => {
    setOpeningDm(true);
    setError(null);
    const channelId = await openDm(userId);
    setOpeningDm(false);
    if (!channelId) {
      setError(
        `Unable to open your messages with ${resolvedDisplayName}. Check your connection and try again.`,
      );
      return;
    }
    state.dispatch({ type: "SWITCH_SERVER", serverId: "@me", channelId });
    onClose();
  };

  const handleOpenProfileEditor = () => {
    dispatchOpenProfileEditorEvent(anchorEl);
    onClose();
  };

  const roleMenuProps = {
    loadingRoles: localState.loadingRoles,
    serverRoles: localState.serverRoles,
    optimisticRoles,
    assignRole,
    onOpen: () => void fetchRoles(),
  };

  return (
    <TooltipProvider delayDuration={0}>
      <Popover
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <PopoverContent
          ref={popupRef}
          anchor={anchorEl}
          side={side}
          align={align}
          sideOffset={10}
          variant="rich"
          // Land on the primary action (Message / Edit profile), not the
          // first role chip or a tooltip trigger.
          initialFocus={primaryRef}
          aria-label={`User profile for ${resolvedUsername}`}
          // The profile surface is the panel: it carries the radius, border
          // and shadow, and its frame art may overhang the edge.
          className="overflow-visible rounded-none border-0 bg-transparent p-0 shadow-none dark:bg-transparent"
        >
          <ProfileSurfaceShell
            variant="popover"
            display={resolvedAvatarDisplay}
            className="w-full"
            style={profileThemeStyle}
            // The effect is authored for a 450x880 card: pin it to the top
            // at that aspect, whatever width the card ends up (a frame
            // insets it).
            effectStageClassName="bottom-auto"
            effectStageStyle={{
              aspectRatio: `${PROFILE_EFFECT_STAGE_WIDTH} / ${PROFILE_EFFECT_STAGE_HEIGHT}`,
            }}
          >
            <div className="max-h-[calc(min(640px,var(--available-height,100dvh))-var(--rm-profile-frame-reserve-y,0px))] overflow-y-auto custom-scrollbar">
              <div className="relative">
                <PopoverBanner
                  bannerUrl={resolvedUser.banner_url}
                  bannerContentType={resolvedUser.banner_content_type}
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
                        <ProfileDisplayName
                          text={resolvedDisplayName}
                          displayNameStyle={resolvedUser.display_name_style}
                          className="text-ui-lg font-semibold leading-tight text-[color:var(--rm-profile-custom-text)]"
                          backgroundColor={profileTheme.backgroundColor}
                          readableFallbackColor={profileTheme.textColor}
                        />

                        <UserPlatformIndicators
                          userId={userId}
                          platforms={resolvedPlatforms}
                          status={resolvedStatus}
                          className="shrink-0"
                          iconSize="sm"
                          color="var(--rm-profile-custom-muted)"
                          offlineColor="var(--rm-profile-custom-ghost)"
                        />
                      </div>

                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-ui-sm font-medium text-[color:var(--rm-profile-custom-muted)]">
                        <span>@{resolvedUsername}</span>

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
                    <div className="mt-4 rounded-lg border border-[color:var(--rm-profile-custom-card-border)] bg-[var(--rm-profile-custom-card-bg-strong)] px-3 py-2.5 text-ui-sm text-[color:var(--rm-profile-custom-text)]">
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
                  menuProps={roleMenuProps}
                />

                <div className="relative z-20 flex flex-col gap-3 px-4 pb-4">
                  {error ? <RowError className="mt-0">{error}</RowError> : null}
                  {isMe ? (
                    <Button
                      ref={primaryRef}
                      variant="secondary"
                      size="lg"
                      onClick={handleOpenProfileEditor}
                      className="w-full"
                    >
                      <Icon name="edit" size="sm" />
                      Edit profile
                    </Button>
                  ) : (
                    <Button
                      ref={primaryRef}
                      variant="secondary"
                      size="lg"
                      loading={openingDm}
                      onClick={() => void handleMessage()}
                      className="w-full"
                    >
                      <Icon name="chat" size="sm" />
                      Message
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </ProfileSurfaceShell>
        </PopoverContent>
      </Popover>
    </TooltipProvider>
  );
}
