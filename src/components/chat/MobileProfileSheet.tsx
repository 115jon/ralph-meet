import { ProfileAssetLayer } from "@/components/chat/ProfileAssetLayer";
import { AvatarImage } from "@/components/chat/AvatarImage";
import { ProfileDisplayName } from "@/components/chat/ProfileDisplayName";
import { Drawer, DrawerContent, DrawerHandle } from "@/components/ui/drawer";
import { ProfileSurfaceShell } from "@/components/chat/ProfileSurfaceShell";
import { Button } from "@/components/ui/button";
import { ButtonBase } from "@/components/ui/button-base";
import { UserPlatformIndicators } from "@/components/chat/UserPlatformIndicators";
import { apiGet, apiPost } from "@/lib/api-client";

import { HIT, PRESS } from "@/components/ui/interaction";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { getAuthAssetUrl } from "@/lib/platform";
import { resolveProfileReferenceDate } from "@/lib/profile-dates";
import { resolveProfileTheme } from "@/lib/profile-customization";
import type { Role, User } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  normalizeUserStatus,
  USER_STATUS_LABELS,
  type UserStatus,
  UserStatusDot,
} from "./UserStatusDot";
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

/**
 * Round toolbar buttons over the banner. Media-overlay ink only when a banner
 * image sits behind them; otherwise they read from the profile theme.
 */
function bannerButtonClass(hasBannerImage: boolean) {
  return cn(
    "inline-flex size-10 items-center justify-center rounded-full disabled:cursor-not-allowed",
    hasBannerImage
      ? "bg-black/35 text-white" // ds-allow:palette-color media overlay on a banner image
      : "bg-[var(--rm-profile-custom-card-bg-strong)] text-[color:var(--rm-profile-custom-text)]",
    PRESS,
    HIT,
  );
}

function ProfileBanner({
  bannerUrl,
  bannerContentType,
}: {
  bannerUrl?: string | null;
  bannerContentType?: string | null;
}) {
  return (
    <div
      className="relative h-35 shrink-0 overflow-hidden"
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
  friendAction,
  hasBannerImage,
}: {
  onClose: () => void;
  /** "add" shows Add friend, "sent" a disabled pending state, null nothing. */
  friendAction: { state: "add" | "sent"; onAdd: () => void } | null;
  hasBannerImage: boolean;
}) {
  const buttonClass = bannerButtonClass(hasBannerImage);
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between px-4 pt-[max(16px,var(--safe-area-top,0px))] [&>*]:pointer-events-auto">
      <button
        type="button"
        onClick={onClose}
        aria-label="Close profile"
        className={buttonClass}
      >
        <Icon name="back" size="lg" />
      </button>
      {friendAction ? (
        <button
          type="button"
          aria-label={
            friendAction.state === "sent" ? "Friend request sent" : "Add friend"
          }
          disabled={friendAction.state === "sent"}
          onClick={friendAction.onAdd}
          className={buttonClass}
        >
          <Icon
            name={friendAction.state === "sent" ? "userCheck" : "invite"}
            size="md"
          />
        </button>
      ) : null}
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
  const status: UserStatus = isOnline
    ? normalizeUserStatus(user.status ?? "online")
    : "offline";

  return (
    <>
      <div className="px-4">
        <div className="relative inline-block">
          <div className="relative flex size-22 items-center justify-center overflow-visible rounded-full bg-[var(--rm-profile-custom-button-bg)] text-ui-2xl font-semibold text-[color:var(--rm-profile-custom-button-text)] ring-4 ring-[color:var(--rm-profile-custom-background)]">
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
          <div className="absolute bottom-0 right-0 z-20 rounded-full bg-[var(--rm-profile-custom-background)] p-1">
            <UserStatusDot
              status={status}
              label={USER_STATUS_LABELS[status]}
              cutoutClassName="bg-[var(--rm-profile-custom-background)]"
              className="size-5"
            />
          </div>
        </div>
      </div>

      <div className="mt-3 px-4">
        <h2 className="text-ui-2xl font-semibold leading-tight">
          <ProfileDisplayName
            text={displayName}
            displayNameStyle={user.display_name_style}
            className="text-[color:var(--rm-profile-custom-text)]"
            backgroundColor={profileTheme.backgroundColor}
            readableFallbackColor={profileTheme.textColor}
          />
        </h2>
        <p className="text-ui-sm font-medium text-[color:var(--rm-profile-custom-muted)]">
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
          <p className="mt-1 text-ui-sm italic text-[color:var(--rm-profile-custom-muted)]">
            {user.custom_status}
          </p>
        )}

        {!isMe && (mutualFriends.count > 0 || mutualServers.count > 0) && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-ui-sm font-medium text-[color:var(--rm-profile-custom-muted)]">
            {mutualFriends.count > 0 && (
              <span>
                {mutualFriends.count === 1
                  ? "1 mutual friend"
                  : `${mutualFriends.count} mutual friends`}
              </span>
            )}
            {mutualFriends.count > 0 && mutualServers.count > 0 && (
              <span aria-hidden="true">·</span>
            )}
            {mutualServers.count > 0 && (
              <span>
                {mutualServers.count === 1
                  ? "1 mutual server"
                  : `${mutualServers.count} mutual servers`}
              </span>
            )}
          </div>
        )}
      </div>
    </>
  );
}

const ROUND_ACTION =
  "flex size-14 items-center justify-center rounded-full border border-[color:var(--rm-profile-custom-card-border)] bg-[var(--rm-profile-custom-card-bg-strong)]";
const ROUND_ACTION_BUTTON = cn(
  "group flex flex-col items-center gap-2",
  PRESS,
  "after:hidden",
);
const ROUND_ACTION_LABEL =
  "text-ui-xs font-medium text-[color:var(--rm-profile-custom-muted)]";

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
    <div className="mt-5 px-4">
      {isMe ? (
        <Button
          size="lg"
          onClick={onOpenProfileEditor}
          className="w-full bg-[var(--rm-profile-custom-button-bg)] text-[color:var(--rm-profile-custom-button-text)]"
        >
          <Icon name="edit" size="md" />
          Edit profile
        </Button>
      ) : (
        <div className="flex items-center justify-center gap-8">
          <button
            type="button"
            onClick={handleMessage}
            className={ROUND_ACTION_BUTTON}
          >
            <span className={ROUND_ACTION}>
              <Icon
                name="chat"
                size="xl"
                className="text-[color:var(--rm-profile-custom-text)]"
              />
            </span>
            <span className={ROUND_ACTION_LABEL}>Message</span>
          </button>
          {handleCall ? (
            <button
              type="button"
              onClick={handleCall}
              className={ROUND_ACTION_BUTTON}
            >
              <span className={ROUND_ACTION}>
                <Icon
                  name="call"
                  size="xl"
                  className="text-[color:var(--rm-profile-custom-text)]"
                />
              </span>
              <span className={ROUND_ACTION_LABEL}>Call</span>
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

const PROFILE_CARD =
  "rounded-lg border border-[color:var(--rm-profile-custom-card-border)] bg-[var(--rm-profile-custom-card-bg)] p-4";
const CARD_EYEBROW =
  "text-ui-2xs font-semibold uppercase tracking-[0.08em] text-[color:var(--rm-profile-custom-muted)]";
const MOD_ROW = cn(
  "-mx-2 flex min-h-11 items-center gap-3 rounded-md px-2 text-start text-rm-danger-ink",
  PRESS,
);

function ProfileCards({
  user,
  memberRoles,
  profileReferenceDate,
  onBan,
  onKick,
  onClose,
}: {
  user: User;
  memberRoles: Role[] | undefined;
  profileReferenceDate: { label: string; value: string };
  /** Passed only when the viewer may ban / kick this member. */
  onBan?: (userId: string, username: string) => void;
  onKick?: (userId: string, username: string) => void;
  onClose: () => void;
}) {
  const visibleMemberRoles =
    memberRoles?.filter((role) => !role.is_default) ?? [];

  return (
    <div className="mt-6 flex flex-col gap-4 px-4 pb-10">
      {user.bio?.trim() && (
        <section className={PROFILE_CARD}>
          <h3 className={cn(CARD_EYEBROW, "mb-2")}>Bio</h3>
          <p className="text-ui-sm leading-relaxed text-[color:var(--rm-profile-custom-text)]">
            {user.bio.trim()}
          </p>
        </section>
      )}

      <section className={PROFILE_CARD}>
        <h3 className={cn(CARD_EYEBROW, "mb-2")}>
          {profileReferenceDate.label}
        </h3>
        <div className="flex items-center gap-2 text-ui-sm text-[color:var(--rm-profile-custom-text)]">
          <Icon
            name="calendar"
            size="sm"
            className="text-[color:var(--rm-profile-custom-muted)]"
          />
          <span>{profileReferenceDate.value}</span>
        </div>
      </section>

      {visibleMemberRoles.length > 0 && (
        <section className={PROFILE_CARD}>
          <h3 className={cn(CARD_EYEBROW, "mb-3")}>Roles</h3>
          <div className="flex flex-wrap gap-2">
            {visibleMemberRoles.map((role) => (
              <div
                key={role.id}
                className="flex items-center gap-1.5 rounded-full border border-[color:var(--rm-profile-custom-card-border)] py-1 pl-2 pr-3 text-ui-xs font-medium"
              >
                <span
                  aria-hidden="true"
                  className="size-3 shrink-0 rounded-full"
                  // User-chosen role colour; theme ink when the role has none.
                  style={{
                    backgroundColor: role.color || "var(--rm-text-muted)",
                  }}
                />
                <span className="text-[color:var(--rm-profile-custom-text)]">
                  <InlineEmojiText text={role.name} />
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {onKick || onBan ? (
        <section className={PROFILE_CARD}>
          <h3 className={cn(CARD_EYEBROW, "mb-2")}>Moderator actions</h3>
          <div className="flex flex-col">
            {onKick && (
              <ButtonBase
                onClick={() => {
                  onKick(user.id, user.username);
                  onClose();
                }}
                className={MOD_ROW}
              >
                <Icon name="userRemove" size="md" className="shrink-0" />
                <span className="text-ui-base font-medium">Kick</span>
              </ButtonBase>
            )}
            {onBan && (
              <ButtonBase
                onClick={() => {
                  onBan(user.id, user.username);
                  onClose();
                }}
                className={MOD_ROW}
              >
                <Icon name="ban" size="md" className="shrink-0" />
                <span className="text-ui-base font-medium">Ban</span>
              </ButtonBase>
            )}
          </div>
        </section>
      ) : null}
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
  const hasBannerImage = Boolean(resolvedUser.banner_url);
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

  // 0 friend, 1 blocked, 2 incoming, 3 outgoing (see FriendsView).
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
            <DrawerHandle
              className={cn(
                "absolute inset-x-0 top-0 z-20",
                hasBannerImage
                  ? "bg-white/60" // ds-allow:palette-color media overlay on a banner image
                  : "bg-[var(--rm-profile-custom-card-border)]",
              )}
            />
            <ProfileToolbar
              onClose={onClose}
              friendAction={friendAction}
              hasBannerImage={hasBannerImage}
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
                  // Anyone but a blocked user can be called.
                  handleCall={relationship?.type === 1 ? undefined : handleCall}
                  onOpenProfileEditor={onOpenProfileEditor}
                />

                <ProfileCards
                  user={resolvedUser}
                  memberRoles={memberRoles}
                  profileReferenceDate={profileReferenceDate}
                  onBan={!isMe && canBanPerm ? onBan : undefined}
                  onKick={!isMe && canKick ? onKick : undefined}
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
