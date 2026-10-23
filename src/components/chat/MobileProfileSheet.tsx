import { ProfileAssetLayer } from "@/components/chat/ProfileAssetLayer";
import { AvatarImage } from "@/components/chat/AvatarImage";
import { ProfileDisplayName } from "@/components/chat/ProfileDisplayName";
import { Drawer, DrawerContent, DrawerHandle } from "@/components/ui/drawer";
import { ProfileSurfaceShell } from "@/components/chat/ProfileSurfaceShell";
import { ButtonBase } from "@/components/ui/button-base";
import { UserPlatformIndicators } from "@/components/chat/UserPlatformIndicators";
import { apiGet, apiPost } from "@/lib/api-client";

import { PRESS } from "@/components/ui/interaction";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { getAuthAssetUrl } from "@/lib/platform";
import { resolveProfileReferenceDate } from "@/lib/profile-dates";
import { resolveProfileTheme } from "@/lib/profile-customization";
import type { Role, User } from "@/lib/types";
import { cn } from "@/lib/utils";
import { UserStatusDot } from "./UserStatusDot";
import InlineEmojiText from "./InlineEmojiText";
import { useChatActions, useChatStore } from "@/stores/chat-store";
import { Icon } from "@/components/ui/icon";

import { useEffect, useState } from "react";
import { useShallow } from "zustand/shallow";

interface MobileProfileSheetProps {
  open: boolean;
  user: User;
  roles?: Role[];
  onClose: () => void;
  onOpenProfileEditor: () => void;
  onBan?: (userId: string, username: string) => void;
  onKick?: (userId: string, username: string) => void;
}

type MutualFriendSummary = {
  count: number;
  items: Array<{ id: string; username: string; avatar_url?: string | null }>;
};

type MutualServerSummary = {
  count: number;
  items: Array<{ id: string; name: string; icon_url?: string | null }>;
};

interface MobileProfileResponse {
  user: User;
  mutualFriends: MutualFriendSummary;
  mutualServers: MutualServerSummary;
}

interface ProfileFetchState {
  userId: string;
  user: User | null;
  mutualFriends: MutualFriendSummary;
  mutualServers: MutualServerSummary;
}

/** Opens just short of full height (the chat peeks above); drag up for all. */
const SNAP_POINTS = [0.92, 1];

const EMPTY_MUTUAL_FRIENDS: MutualFriendSummary = {
  count: 0,
  items: [],
};

const EMPTY_MUTUAL_SERVERS: MutualServerSummary = {
  count: 0,
  items: [],
};

const BANNER_BUTTON = cn(
  "inline-flex size-10 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur-sm transition-colors duration-150 pointer-fine:hover:bg-black/50 disabled:opacity-60",
  PRESS,
);

function ProfileBanner({
  bannerUrl,
  bannerContentType,
}: {
  bannerUrl?: string | null;
  bannerContentType?: string | null;
}) {
  return (
    <div
      className="relative h-[140px] shrink-0 overflow-hidden"
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
    </div>
  );
}

/** Pinned over the banner; stays put while the profile scrolls. */
function ProfileToolbar({
  onClose,
  isMe,
  friendAction,
  onOpenProfileEditor,
}: {
  onClose: () => void;
  isMe: boolean;
  /** "add" shows Add friend, "sent" a disabled pending state, null nothing. */
  friendAction: { state: "add" | "sent"; onAdd: () => void } | null;
  onOpenProfileEditor: () => void;
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-50 flex items-center justify-between p-3 pt-4 [&>*]:pointer-events-auto">
      <button
        type="button"
        onClick={onClose}
        aria-label="Close profile"
        className={BANNER_BUTTON}
      >
        <Icon name="back" size="lg" />
      </button>
      <div className="flex items-center gap-2">
        {friendAction ? (
          <button
            type="button"
            aria-label={
              friendAction.state === "sent"
                ? "Friend request sent"
                : "Add friend"
            }
            disabled={friendAction.state === "sent"}
            onClick={friendAction.onAdd}
            className={BANNER_BUTTON}
          >
            <Icon
              name={friendAction.state === "sent" ? "userCheck" : "invite"}
              size="md"
            />
          </button>
        ) : null}
        {isMe ? (
          <button
            type="button"
            aria-label="Edit profile"
            onClick={onOpenProfileEditor}
            className={BANNER_BUTTON}
          >
            <Icon name="edit" size="md" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

function ProfileHeader({
  user,
  isOnline,
  mutualFriends,
  mutualServers,
  isMe,
}: {
  user: User;
  isOnline: boolean;
  mutualFriends: { count: number };
  mutualServers: { count: number };
  isMe: boolean;
}) {
  const displayName = user.display_name?.trim() || user.username;
  const profileTheme = resolveProfileTheme(user);

  return (
    <>
      <div className="px-5">
        <div className="relative inline-block">
          <div className="relative flex h-[88px] w-[88px] items-center justify-center overflow-visible rounded-full bg-[var(--rm-profile-custom-button-bg)] text-3xl font-bold text-[color:var(--rm-profile-custom-button-text)] ring-[5px] ring-[color:var(--rm-profile-custom-card-border)]">
            {user.avatar_url ? (
              <AvatarImage
                src={getAuthAssetUrl(user.avatar_url)}
                alt={displayName}
                display={user.avatar_display}
              />
            ) : (
              displayName[0].toUpperCase()
            )}
          </div>
          <div className="absolute bottom-0 right-0 z-20 rounded-full bg-[var(--rm-profile-custom-card-bg-strong)] p-1">
            <UserStatusDot
              status={isOnline ? (user.status ?? "online") : "offline"}
              className="h-6 w-6"
            />
          </div>
        </div>
      </div>

      <div className="px-5 mt-3">
        <div className="text-[28px] font-semibold leading-tight">
          <ProfileDisplayName
            text={displayName}
            displayNameStyle={user.display_name_style}
            className="text-[color:var(--rm-profile-custom-text)]"
            backgroundColor={profileTheme.backgroundColor}
            readableFallbackColor={profileTheme.textColor}
          />
        </div>
        <p className="text-[14px] text-[color:var(--rm-profile-custom-muted)] font-medium">
          @{user.username.toLowerCase()}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-ui-sm text-[color:var(--rm-profile-custom-muted)]">
          {user.pronouns?.trim() ? <span>{user.pronouns.trim()}</span> : null}
          <UserPlatformIndicators
            userId={user.id}
            platforms={user.presence_platforms}
            status={user.status}
            iconSize="sm"
            color="var(--rm-profile-custom-muted)"
            offlineColor="var(--rm-profile-custom-ghost)"
          />
        </div>

        {user.custom_status && (
          <p className="text-ui-sm text-[color:var(--rm-profile-custom-muted)] mt-1 italic">
            {user.custom_status}
          </p>
        )}

        {!isMe && (mutualFriends.count > 0 || mutualServers.count > 0) && (
          <div className="flex items-center gap-2 mt-2 text-ui-sm text-[color:var(--rm-profile-custom-muted)] font-medium">
            {mutualFriends.count > 0 && (
              <span>
                {mutualFriends.count} Mutual Friend
                {mutualFriends.count === 1 ? "" : "s"}
              </span>
            )}
            {mutualFriends.count > 0 && mutualServers.count > 0 && (
              <span>·</span>
            )}
            {mutualServers.count > 0 && (
              <span>
                {mutualServers.count} Mutual Server
                {mutualServers.count === 1 ? "" : "s"}
              </span>
            )}
          </div>
        )}
      </div>
    </>
  );
}

const ROUND_ACTION =
  "flex h-14 w-14 items-center justify-center rounded-full border border-[color:var(--rm-profile-custom-card-border)] bg-[var(--rm-profile-custom-card-bg-strong)] transition-colors duration-150 pointer-fine:group-hover:bg-[var(--rm-profile-custom-card-bg)]";

function ProfileActions({
  isMe,
  handleMessage,
  handleCall,
  onOpenProfileEditor,
}: {
  isMe: boolean;
  handleMessage: () => void;
  /** Starts a DM call; omitted when a call can't be placed. */
  handleCall?: () => void;
  onOpenProfileEditor: () => void;
}) {
  return (
    <div className="px-5 mt-5">
      {isMe ? (
        <div>
          <button
            type="button"
            onClick={onOpenProfileEditor}
            className={cn(
              "flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--rm-profile-custom-button-bg)] py-3 text-ui-base font-bold text-[color:var(--rm-profile-custom-button-text)] transition-[filter] pointer-fine:hover:brightness-110",
              PRESS,
            )}
          >
            <Icon name="edit" size="md" />
            Edit Main Profile
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-center gap-8">
          <button
            type="button"
            onClick={handleMessage}
            className={cn(
              "group flex flex-col items-center gap-2",
              PRESS,
              "after:hidden",
            )}
          >
            <span className={ROUND_ACTION}>
              <Icon
                name="chat"
                size="xl"
                className="text-[color:var(--rm-profile-custom-text)]"
              />
            </span>
            <span className="text-ui-xs font-semibold text-[color:var(--rm-profile-custom-muted)]">
              Message
            </span>
          </button>
          {handleCall ? (
            <button
              type="button"
              onClick={handleCall}
              className={cn(
                "group flex flex-col items-center gap-2",
                PRESS,
                "after:hidden",
              )}
            >
              <span className={ROUND_ACTION}>
                <Icon
                  name="call"
                  size="xl"
                  className="text-[color:var(--rm-profile-custom-text)]"
                />
              </span>
              <span className="text-ui-xs font-semibold text-[color:var(--rm-profile-custom-muted)]">
                Call
              </span>
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

function ProfileCards({
  user,
  memberRoles,
  profileReferenceDate,
  hasModActions,
  canManage,
  canKick,
  canBanPerm,
  onBan,
  onKick,
  onClose,
}: {
  user: User;
  memberRoles: Role[] | undefined;
  profileReferenceDate: { label: string; value: string };
  hasModActions: boolean;
  canManage: boolean;
  canKick: boolean;
  canBanPerm: boolean;
  onBan?: (userId: string, username: string) => void;
  onKick?: (userId: string, username: string) => void;
  onClose: () => void;
}) {
  const visibleMemberRoles =
    memberRoles?.filter((role) => !role.is_default) ?? [];

  return (
    <div className="px-5 mt-6 space-y-3 pb-10">
      {user.bio?.trim() && (
        <div className="bg-[var(--rm-profile-custom-card-bg-strong)] rounded-2xl border border-[color:var(--rm-profile-custom-card-border)] p-4">
          <h3 className="text-ui-2xs font-semibold uppercase tracking-[0.08em] text-[color:var(--rm-profile-custom-text)] mb-2">
            Bio
          </h3>
          <p className="text-[14px] text-[color:var(--rm-profile-custom-muted)] leading-relaxed">
            {user.bio.trim()}
          </p>
        </div>
      )}

      <div className="bg-[var(--rm-profile-custom-card-bg-strong)] rounded-2xl border border-[color:var(--rm-profile-custom-card-border)] p-4">
        <h3 className="text-ui-2xs font-semibold uppercase tracking-[0.08em] text-[color:var(--rm-profile-custom-text)] mb-3">
          {profileReferenceDate.label}
        </h3>
        <div className="flex items-center gap-3 text-ui-sm text-[color:var(--rm-profile-custom-muted)]">
          <div className="flex items-center gap-2">
            <Icon
              name="calendar"
              size="sm"
              className="text-[color:var(--rm-profile-custom-muted)]"
            />
            <span>{profileReferenceDate.value}</span>
          </div>
        </div>
      </div>

      {visibleMemberRoles.length > 0 && (
        <div className="bg-[var(--rm-profile-custom-card-bg-strong)] rounded-2xl border border-[color:var(--rm-profile-custom-card-border)] p-4">
          <h3 className="text-ui-2xs font-semibold uppercase tracking-[0.08em] text-[color:var(--rm-profile-custom-text)] mb-3">
            Roles
          </h3>
          <div className="flex flex-wrap gap-2">
            {visibleMemberRoles.map((role) => (
              <div
                key={role.id}
                className="flex items-center gap-1.5 rounded-full bg-[var(--rm-profile-custom-card-bg)] pl-2 pr-3 py-1 border border-[color:var(--rm-profile-custom-card-border)] text-ui-xs font-medium"
              >
                <div
                  className="h-3 w-3 rounded-full shrink-0"
                  style={{
                    backgroundColor: role.color || "#94a3b8",
                  }}
                />
                <span className="text-[color:var(--rm-profile-custom-muted)]">
                  <InlineEmojiText text={role.name} />
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {hasModActions && (
        <div className="bg-[var(--rm-profile-custom-card-bg-strong)] rounded-2xl border border-[color:var(--rm-profile-custom-card-border)] p-4">
          <h3 className="text-ui-2xs font-semibold uppercase tracking-[0.08em] text-[color:var(--rm-profile-custom-text)] mb-3">
            Moderator Actions
          </h3>
          <div className="space-y-0.5">
            {canManage && (
              <ButtonBase
                disabled
                className="w-full flex items-center gap-4 px-2 py-3 rounded-xl opacity-60 cursor-not-allowed"
              >
                <Icon
                  name="settings"
                  size="xl"
                  className="text-[color:var(--rm-profile-custom-muted)] shrink-0"
                />
                <span className="text-ui-base font-medium text-[color:var(--rm-profile-custom-text)]">
                  Manage
                </span>
              </ButtonBase>
            )}
            {canKick && onKick && (
              <ButtonBase
                onClick={() => {
                  onKick(user.id, user.username);
                  onClose();
                }}
                className="w-full flex items-center gap-4 px-2 py-3 rounded-xl pointer-fine:hover:bg-[var(--rm-profile-custom-card-bg)] transition-colors"
              >
                <Icon
                  name="userRemove"
                  size="xl"
                  className="text-destructive shrink-0"
                />
                <span className="text-ui-base font-medium text-destructive">
                  Kick
                </span>
              </ButtonBase>
            )}
            {canBanPerm && onBan && (
              <ButtonBase
                onClick={() => {
                  onBan(user.id, user.username);
                  onClose();
                }}
                className="w-full flex items-center gap-4 px-2 py-3 rounded-xl pointer-fine:hover:bg-[var(--rm-profile-custom-card-bg)] transition-colors"
              >
                <Icon
                  name="ban"
                  size="xl"
                  className="text-destructive shrink-0"
                />
                <span className="text-ui-base font-medium text-destructive">
                  Ban
                </span>
              </ButtonBase>
            )}
          </div>
        </div>
      )}

      <div className="bg-[var(--rm-profile-custom-card-bg-strong)] rounded-2xl border border-[color:var(--rm-profile-custom-card-border)] p-4">
        <div className="flex items-center justify-between">
          <span className="text-ui-sm font-medium text-[color:var(--rm-profile-custom-muted)]">
            Note (only visible to you)
          </span>
        </div>
      </div>
    </div>
  );
}

export default function MobileProfileSheet({
  open,
  user,
  roles,
  onClose,
  onOpenProfileEditor,
  onBan,
  onKick,
}: MobileProfileSheetProps) {
  const { chatUser, members, onlineUsers, relationships } = useChatStore(
    useShallow((s) => ({
      chatUser: s.user,
      members: s.members,
      onlineUsers: s.onlineUsers,
      relationships: s.relationships,
    })),
  );
  const { openDm, dispatch, loadRelationships } = useChatActions();
  const [friendRequestSent, setFriendRequestSent] = useState(false);
  const [snap, setSnap] = useState<number | string | null>(SNAP_POINTS[0]!);
  const [profileData, setProfileData] = useState<ProfileFetchState | null>(
    null,
  );

  const isMe = user.id === chatUser?.id;
  const activeProfileData =
    profileData?.userId === user.id ? profileData : null;
  const resolvedUser = activeProfileData?.user ?? user;
  const mutualFriends = !isMe
    ? (activeProfileData?.mutualFriends ?? EMPTY_MUTUAL_FRIENDS)
    : EMPTY_MUTUAL_FRIENDS;
  const mutualServers = !isMe
    ? (activeProfileData?.mutualServers ?? EMPTY_MUTUAL_SERVERS)
    : EMPTY_MUTUAL_SERVERS;
  const profileThemeStyle = resolveProfileTheme(resolvedUser).variables;
  const isOnline = onlineUsers.has(user.id);
  const member = members.find((m) => m.user.id === user.id);
  const memberRoles = roles || member?.roles;
  const profileReferenceDate = resolveProfileReferenceDate({
    joinedAt: member?.joined_at,
    createdAt: resolvedUser.created_at ?? null,
  });

  const myMember = members.find((m) => m.user.id === chatUser?.id);
  const myTotalPerms =
    myMember?.roles?.reduce((acc, r) => acc | r.permissions, 0) ?? 0;
  const canKick = hasPermission(myTotalPerms, PERMISSIONS.KICK_MEMBERS);
  const canBanPerm = hasPermission(myTotalPerms, PERMISSIONS.BAN_MEMBERS);
  const canManage = hasPermission(myTotalPerms, PERMISSIONS.MANAGE_SERVER);
  const hasModActions = !isMe && (canKick || canBanPerm || canManage);

  useEffect(() => {
    if (isMe || !user.id) return;

    let cancelled = false;
    const targetUserId = user.id;

    void apiGet<MobileProfileResponse>(`/api/users/${targetUserId}/profile`)
      .then((data) => {
        if (cancelled) return;

        setProfileData({
          userId: targetUserId,
          user: data.user ?? null,
          mutualFriends: data.mutualFriends ?? EMPTY_MUTUAL_FRIENDS,
          mutualServers: data.mutualServers ?? EMPTY_MUTUAL_SERVERS,
        });
      })
      .catch(console.error);

    return () => {
      cancelled = true;
    };
  }, [user.id, isMe]);

  const handleMessage = async () => {
    const channelId = await openDm(user.id);
    if (channelId) {
      dispatch({ type: "SWITCH_SERVER", serverId: "@me", channelId });
      onClose();
    }
  };

  // Same path as the member context menu's "Start a Call".
  const handleCall = async () => {
    const channelId = await openDm(user.id);
    if (!channelId) return;
    dispatch({ type: "SWITCH_SERVER", serverId: "@me", channelId });
    window.dispatchEvent(
      new CustomEvent("request-start-call", {
        detail: {
          userId: user.id,
          displayName: resolvedUser.display_name ?? resolvedUser.username,
          channelId,
        },
      }),
    );
    onClose();
  };

  // 0 blocked, 1 friends, 2 incoming, 3 outgoing (see UserProfileModal).
  const relationship = relationships.find((entry) => entry.user.id === user.id);
  const friendAction =
    isMe || (relationship && relationship.type !== 3)
      ? null
      : relationship?.type === 3 || friendRequestSent
        ? { state: "sent" as const, onAdd: () => {} }
        : {
            state: "add" as const,
            onAdd: () => {
              setFriendRequestSent(true);
              void apiPost("/api/friends", { username: resolvedUser.username })
                .then(() => loadRelationships())
                .catch(() => setFriendRequestSent(false));
            },
          };

  return (
    <Drawer
      open={open}
      onOpenChange={(nextOpen) => !nextOpen && onClose()}
      snapPoints={SNAP_POINTS}
      snapPoint={snap}
      onSnapPointChange={setSnap}
    >
      <DrawerContent
        aria-label={`${resolvedUser.display_name?.trim() || resolvedUser.username}'s profile`}
        showHandle={false}
        className="h-dvh max-h-none overflow-hidden rounded-t-2xl border-0 bg-transparent pb-0 dark:bg-transparent"
        style={profileThemeStyle}
      >
        <ProfileSurfaceShell
          variant="sheet"
          display={resolvedUser.avatar_display}
          className="h-full rounded-t-2xl"
          surfaceClassName="inset-y-0"
        >
          <div className="relative flex h-full flex-col">
            <DrawerHandle className="absolute inset-x-0 top-0 z-50 bg-white/60" />
            <ProfileToolbar
              onClose={onClose}
              isMe={isMe}
              friendAction={friendAction}
              onOpenProfileEditor={onOpenProfileEditor}
            />
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <ProfileBanner
                bannerUrl={resolvedUser.banner_url}
                bannerContentType={resolvedUser.banner_content_type}
              />
              <div className="relative z-10 -mt-12 pb-[calc(var(--safe-area-bottom,0px)+8dvh)]">
                <ProfileHeader
                  user={resolvedUser}
                  isOnline={isOnline}
                  mutualFriends={mutualFriends}
                  mutualServers={mutualServers}
                  isMe={isMe}
                />

                <ProfileActions
                  isMe={isMe}
                  handleMessage={handleMessage}
                  handleCall={relationship?.type === 0 ? undefined : handleCall}
                  onOpenProfileEditor={onOpenProfileEditor}
                />

                <ProfileCards
                  user={resolvedUser}
                  memberRoles={memberRoles}
                  profileReferenceDate={profileReferenceDate}
                  hasModActions={hasModActions}
                  canManage={canManage}
                  canKick={canKick}
                  canBanPerm={canBanPerm}
                  onBan={onBan}
                  onKick={onKick}
                  onClose={onClose}
                />
              </div>
            </div>
          </div>
        </ProfileSurfaceShell>
      </DrawerContent>
    </Drawer>
  );
}
