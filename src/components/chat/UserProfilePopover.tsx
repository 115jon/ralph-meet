import { useIsMobile } from "@/hooks/useMediaQuery";
import MobileProfileSheet from "@/components/chat/MobileProfileSheet";
import {
  ProfileActionNotices,
  ProfileActionRow,
  ProfileBlockConfirm,
  ProfileCard,
  ProfileRoleChips,
  ProfileSections,
  resolveProfileCardTheme,
  useProfileActions,
  type MutualFriend,
  type MutualServer,
} from "@/components/chat/ProfileCard";
import { UserPlatformIndicators } from "@/components/chat/UserPlatformIndicators";
import { normalizeUserStatus } from "@/components/chat/UserStatusDot";
import { RowError } from "@/components/chat/settings/primitives";
import { Button } from "@/components/ui/button";
import { lastInputWasKeyboard } from "@/components/ui/dialog-stack";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconButton } from "@/components/ui/IconButton";
import { Popover, PopoverContent } from "@/components/ui/popover";
import { apiGet, apiPut } from "@/lib/api-client";
import { describeApiError } from "@/lib/api-errors";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { dispatchOpenProfileEditorEvent } from "@/lib/profile-editor-events";
import type { Role, User } from "@/lib/types";
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

const INITIAL_STATE = {
  serverRoles: [] as Role[],
  loadingRoles: false,
  profileUser: null as User | null,
  mutualFriends: { count: 0, items: [] as MutualFriend[] },
  mutualServers: { count: 0, items: [] as MutualServer[] },
  loadingProfile: false,
};

type LocalState = typeof INITIAL_STATE;
type LocalAction =
  | Partial<LocalState>
  | ((prev: LocalState) => Partial<LocalState>);

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
      <DropdownMenuTrigger
        render={
          <IconButton
            icon="add"
            size={24}
            variant="muted"
            className="rounded-[2px] bg-tint-1"
            aria-label="Add a role"
          />
        }
      />
      {/* Opened from the popover: the layer above it. */}
      <DropdownMenuContent align="start" aria-label="Roles" stacked>
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
                    className="size-2.5 rounded-full"
                    style={{
                      backgroundColor: role.color || "var(--ink-3)",
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

/**
 * The profile popover: the shared ProfileCard at popover size (340 wide).
 * Opening with the pointer focuses the surface (no ring); opening from the
 * keyboard lands on the primary action.
 */
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
  const cardRef = useRef<HTMLDivElement>(null);
  // Read once, at open: keyboard opens focus the first action.
  const [openedByKeyboard] = useState(() => lastInputWasKeyboard());
  const { loadRelationships } = useChatActions();
  const [error, setError] = useState<string | null>(null);
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
  const resolvedStatus =
    resolvedUser.status ?? member?.user.status ?? "offline";
  const resolvedPlatforms = state.presencePlatformsByUserId[userId]?.length
    ? state.presencePlatformsByUserId[userId]
    : resolvedUser.presence_platforms;
  const theme = resolveProfileCardTheme(resolvedUser);
  const isOnline =
    state.onlineUsers.has(userId) && resolvedStatus !== "offline";
  const viewerIsTarget = isMe || isCurrentUserTarget;

  const actions = useProfileActions({
    userId,
    username: resolvedUsername,
    displayName: resolvedDisplayName,
    isMe: viewerIsTarget,
    onMessageOpened: onClose,
  });

  useEffect(() => {
    setOptimisticRoles(member?.roles);
  }, [member?.roles]);

  useEffect(() => {
    if (!viewerIsTarget) void loadRelationships();
  }, [loadRelationships, viewerIsTarget]);

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

    const role =
      localState.serverRoles.find((currentRole) => currentRole.id === roleId) ??
      optimisticRoles?.find((currentRole) => currentRole.id === roleId);
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

  const handleOpenProfileEditor = () => {
    dispatchOpenProfileEditorEvent(anchorEl);
    onClose();
  };

  const customRoles = optimisticRoles?.filter((role) => !role.is_default) ?? [];
  const showRoles = customRoles.length > 0 || canManageRoles;
  const currentRoleIds = optimisticRoles?.map((role) => role.id) ?? [];

  return (
    <Popover
      open
      onOpenChange={(open, details) => {
        if (open) return;
        // Escape backs out of the block confirmation before the profile.
        if (actions.confirmBlock && details?.reason === "escape-key") {
          actions.cancelBlock();
          return;
        }
        onClose();
      }}
    >
      <PopoverContent
        ref={popupRef}
        anchor={anchorEl}
        side={side}
        align={align}
        sideOffset={8}
        collisionPadding={12}
        variant="panel"
        // Pointer opens land on the surface (no ring); keyboard opens on the
        // first action in the card.
        initialFocus={() =>
          openedByKeyboard
            ? (cardRef.current?.querySelector<HTMLElement>(
                "[data-profile-actions] button",
              ) ?? popupRef.current)
            : popupRef.current
        }
        aria-label={`User profile for ${resolvedUsername}`}
        // Name effects and decorations play while the profile is open.
        data-decoration-play=""
        // The profile card is the panel: it carries the radius, line and
        // shadow, and its frame art may overhang the edge.
        className="overflow-visible rounded-none border-0 bg-transparent p-0 shadow-none"
      >
        <ProfileCard
          ref={cardRef}
          size="popover"
          user={resolvedUser}
          theme={theme}
          name={resolvedDisplayName}
          status={normalizeUserStatus(isOnline ? resolvedStatus : "offline")}
          replayEffectOnBannerHover
          className="w-full"
          scrollClassName="max-h-[calc(min(640px,var(--available-height,100dvh))-var(--rm-profile-frame-reserve-y,0px))]"
          nameAdornment={
            <UserPlatformIndicators
              userId={userId}
              platforms={resolvedPlatforms}
              status={resolvedStatus}
              className="shrink-0"
              iconSize="sm"
              color="var(--ink-2)"
              offlineColor="var(--ink-3)"
            />
          }
          actions={
            <div data-profile-actions="">
              <ProfileActionRow
                controller={actions}
                size="popover"
                selfAction={
                  <Button
                    onClick={handleOpenProfileEditor}
                    className="max-md:flex-1"
                  >
                    <Icon name="edit" size="sm" />
                    Edit profile
                  </Button>
                }
              />
            </div>
          }
        >
          <ProfileActionNotices controller={actions} />
          {error ? <RowError className="mt-0">{error}</RowError> : null}
          <ProfileSections
            bio={resolvedUser.bio}
            roles={
              showRoles ? (
                <ProfileRoleChips
                  roles={customRoles}
                  onRemove={
                    canManageRoles
                      ? (roleId) => assignRole(roleId, currentRoleIds)
                      : undefined
                  }
                  trailing={
                    canManageRoles ? (
                      <RoleAssignmentMenu
                        loadingRoles={localState.loadingRoles}
                        serverRoles={localState.serverRoles}
                        optimisticRoles={optimisticRoles}
                        assignRole={assignRole}
                        onOpen={() => void fetchRoles()}
                      />
                    ) : null
                  }
                />
              ) : null
            }
            mutualServers={
              isMe || localState.loadingProfile
                ? null
                : localState.mutualServers
            }
            mutualFriends={
              isMe || localState.loadingProfile
                ? null
                : localState.mutualFriends
            }
            limit={6}
          />
          <ProfileBlockConfirm controller={actions} />
        </ProfileCard>
      </PopoverContent>
    </Popover>
  );
}
