import { ProfileAssetLayer } from "@/components/chat/ProfileAssetLayer";
import { AvatarImage } from "@/components/chat/AvatarImage";
import { ProfileDisplayName } from "@/components/chat/ProfileDisplayName";
import { BaseModal } from "@/components/ui/BaseModal";
import { ButtonBase } from "@/components/ui/button-base";
import { UserPlatformIndicators } from "@/components/chat/UserPlatformIndicators";
import { apiGet } from "@/lib/api-client";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { getAuthAssetUrl } from "@/lib/platform";
import { resolveProfileReferenceDate } from "@/lib/profile-dates";
import { dispatchOpenProfileEditorEvent } from "@/lib/profile-editor-events";
import { resolveProfileTheme } from "@/lib/profile-customization";
import type { Role, User } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useChatActions, useChatStore } from "@/stores/chat-store";
import {
  ArrowLeft,
  Ban,
  Calendar,
  MessageSquare,
  Phone,
  Settings,
  UserMinus,
  UserPlus,
  Video,
} from "lucide-react";

import { useEffect, useState } from "react";
import { useShallow } from "zustand/shallow";

interface MobileProfileSheetProps {
  user: User;
  roles?: Role[];
  onClose: () => void;
  onBan?: (userId: string, username: string) => void;
  onKick?: (userId: string, username: string) => void;
  isClosing?: boolean;
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

const EMPTY_MUTUAL_FRIENDS: MutualFriendSummary = {
  count: 0,
  items: [],
};

const EMPTY_MUTUAL_SERVERS: MutualServerSummary = {
  count: 0,
  items: [],
};

const statusColors: Record<string, string> = {
  online: "bg-primary",
  idle: "bg-warning",
  dnd: "bg-destructive",
  offline: "bg-rm-text-muted/40",
};

function ProfileBanner({
  bannerUrl,
  bannerContentType,
  onClose,
  isMe,
}: {
  bannerUrl?: string | null;
  bannerContentType?: string | null;
  onClose: () => void;
  isMe: boolean;
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
      <div className="absolute top-0 inset-x-0 flex items-center justify-between p-3 z-10">
        <ButtonBase
          onClick={onClose}
          className="p-1.5 bg-black/30 hover:bg-black/50 rounded-full text-white backdrop-blur-sm transition-colors"
        >
          <ArrowLeft size={20} />
        </ButtonBase>
        <div className="flex items-center gap-2">
          {!isMe && (
            <ButtonBase className="p-1.5 bg-black/30 hover:bg-black/50 rounded-full text-white backdrop-blur-sm transition-colors">
              <UserPlus size={18} />
            </ButtonBase>
          )}
          <ButtonBase className="p-1.5 bg-black/30 hover:bg-black/50 rounded-full text-white backdrop-blur-sm transition-colors">
            <Settings size={18} />
          </ButtonBase>
        </div>
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
          <div className="relative flex h-[88px] w-[88px] items-center justify-center overflow-visible rounded-full bg-primary text-3xl font-bold text-primary-foreground ring-[5px] ring-rm-bg-primary">
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
          <div className="absolute bottom-0 right-0 z-20 rounded-full bg-rm-bg-primary p-1">
            <span
              className={cn(
                "block h-6 w-6 rounded-full",
                isOnline
                  ? statusColors[user.status ?? "online"]
                  : statusColors["offline"],
              )}
            />
          </div>
        </div>
      </div>

      <div className="px-5 mt-3">
        <div className="text-[28px] font-extrabold leading-tight">
          <ProfileDisplayName
            text={displayName}
            displayNameStyle={user.display_name_style}
            className="text-rm-text-primary"
            backgroundColor={profileTheme.backgroundColor}
            readableFallbackColor={profileTheme.textColor}
          />
        </div>
        <p className="text-[14px] text-rm-text-muted font-medium">
          @{user.username.toLowerCase()}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-rm-text-muted">
          {user.pronouns?.trim() ? <span>{user.pronouns.trim()}</span> : null}
          <UserPlatformIndicators
            userId={user.id}
            platforms={user.presence_platforms}
            status={user.status}
            iconClassName="h-4 w-4"
            color="var(--rm-profile-custom-muted)"
            offlineColor="var(--rm-profile-custom-ghost)"
          />
        </div>

        {user.custom_status && (
          <p className="text-[13px] text-rm-text-secondary mt-1 italic">
            {user.custom_status}
          </p>
        )}

        {!isMe && (mutualFriends.count > 0 || mutualServers.count > 0) && (
          <div className="flex items-center gap-2 mt-2 text-[13px] text-rm-text-muted font-medium">
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

function ProfileActions({
  isMe,
  handleMessage,
  onClose,
}: {
  isMe: boolean;
  handleMessage: () => void;
  onClose: () => void;
}) {
  return (
    <div className="px-5 mt-5">
      {isMe ? (
        <div className="space-y-2.5">
          <ButtonBase
            onClick={() => {
              dispatchOpenProfileEditorEvent();
              onClose();
            }}
            className="w-full py-3 rounded-2xl bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-[15px] transition-colors flex items-center justify-center gap-2"
          >
            <Settings size={18} />
            Edit Main Profile
          </ButtonBase>
          <ButtonBase className="w-full py-3 rounded-2xl bg-primary/20 hover:bg-primary/30 text-primary font-bold text-[15px] transition-colors flex items-center justify-center gap-2">
            <Settings size={18} />
            Edit Per-server Profile
          </ButtonBase>
        </div>
      ) : (
        <div className="flex items-center justify-center gap-8">
          <ButtonBase
            onClick={handleMessage}
            className="flex flex-col items-center gap-2"
          >
            <div className="h-14 w-14 rounded-full bg-rm-bg-elevated border border-rm-border flex items-center justify-center hover:bg-rm-bg-hover transition-colors">
              <MessageSquare size={24} className="text-rm-text-primary" />
            </div>
            <span className="text-[12px] font-semibold text-rm-text-muted">
              Message
            </span>
          </ButtonBase>
          <ButtonBase className="flex flex-col items-center gap-2">
            <div className="h-14 w-14 rounded-full bg-rm-bg-elevated border border-rm-border flex items-center justify-center hover:bg-rm-bg-hover transition-colors">
              <Phone size={24} className="text-rm-text-primary" />
            </div>
            <span className="text-[12px] font-semibold text-rm-text-muted">
              Voice Call
            </span>
          </ButtonBase>
          <ButtonBase className="flex flex-col items-center gap-2">
            <div className="h-14 w-14 rounded-full bg-rm-bg-elevated border border-rm-border flex items-center justify-center hover:bg-rm-bg-hover transition-colors">
              <Video size={24} className="text-rm-text-primary" />
            </div>
            <span className="text-[12px] font-semibold text-rm-text-muted">
              Video Call
            </span>
          </ButtonBase>
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
        <div className="bg-rm-bg-elevated rounded-2xl border border-rm-border/30 p-4">
          <h3 className="text-[13px] font-bold text-rm-text-primary uppercase tracking-wide mb-2">
            Bio
          </h3>
          <p className="text-[14px] text-rm-text-secondary leading-relaxed">
            {user.bio.trim()}
          </p>
        </div>
      )}

      <div className="bg-rm-bg-elevated rounded-2xl border border-rm-border/30 p-4">
        <h3 className="text-[13px] font-bold text-rm-text-primary uppercase tracking-wide mb-3">
          {profileReferenceDate.label}
        </h3>
        <div className="flex items-center gap-3 text-[13px] text-rm-text-secondary">
          <div className="flex items-center gap-2">
            <Calendar size={16} className="text-rm-text-muted" />
            <span>{profileReferenceDate.value}</span>
          </div>
        </div>
      </div>

      {visibleMemberRoles.length > 0 && (
        <div className="bg-rm-bg-elevated rounded-2xl border border-rm-border/30 p-4">
          <h3 className="text-[13px] font-bold text-rm-text-primary uppercase tracking-wide mb-3">
            Roles
          </h3>
          <div className="flex flex-wrap gap-2">
            {visibleMemberRoles.map((role) => (
              <div
                key={role.id}
                className="flex items-center gap-1.5 rounded-full bg-rm-bg-primary pl-2 pr-3 py-1 border border-rm-border/50 text-[12px] font-medium"
              >
                <div
                  className="h-3 w-3 rounded-full shrink-0"
                  style={{
                    backgroundColor: role.color || "#94a3b8",
                  }}
                />
                <span className="text-rm-text-secondary">{role.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {hasModActions && (
        <div className="bg-rm-bg-elevated rounded-2xl border border-rm-border/30 p-4">
          <h3 className="text-[13px] font-bold text-rm-text-primary uppercase tracking-wide mb-3">
            Moderator Actions
          </h3>
          <div className="space-y-0.5">
            {canManage && (
              <ButtonBase
                disabled
                className="w-full flex items-center gap-4 px-2 py-3 rounded-xl opacity-60 cursor-not-allowed"
              >
                <Settings size={22} className="text-rm-text-muted shrink-0" />
                <span className="text-[15px] font-medium text-rm-text-primary">
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
                className="w-full flex items-center gap-4 px-2 py-3 rounded-xl hover:bg-rm-bg-hover transition-colors"
              >
                <UserMinus size={22} className="text-destructive shrink-0" />
                <span className="text-[15px] font-medium text-destructive">
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
                className="w-full flex items-center gap-4 px-2 py-3 rounded-xl hover:bg-rm-bg-hover transition-colors"
              >
                <Ban size={22} className="text-destructive shrink-0" />
                <span className="text-[15px] font-medium text-destructive">
                  Ban
                </span>
              </ButtonBase>
            )}
          </div>
        </div>
      )}

      <div className="bg-rm-bg-elevated rounded-2xl border border-rm-border/30 p-4">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-medium text-rm-text-muted">
            Note (only visible to you)
          </span>
        </div>
      </div>
    </div>
  );
}

export default function MobileProfileSheet({
  user,
  roles,
  onClose,
  onBan,
  onKick,
  isClosing,
}: MobileProfileSheetProps) {
  const { chatUser, members, onlineUsers } = useChatStore(
    useShallow((s) => ({
      chatUser: s.user,
      members: s.members,
      onlineUsers: s.onlineUsers,
    })),
  );
  const { openDm, dispatch } = useChatActions();
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

  return (
    <BaseModal onClose={onClose}>
      <div
        className={cn(
          "fixed inset-0 z-300 flex flex-col bg-rm-bg-primary animate-in slide-in-from-bottom duration-300",
          isClosing && "animate-out slide-out-to-bottom fade-out",
        )}
        style={{
          ...profileThemeStyle,
          backgroundImage: "var(--rm-profile-custom-surface)",
        }}
      >
        <div className="absolute top-2 left-1/2 -translate-x-1/2 w-10 h-1 rounded-full bg-rm-text-muted/30 z-20" />

        <ProfileBanner
          bannerUrl={resolvedUser.banner_url}
          bannerContentType={resolvedUser.banner_content_type}
          onClose={onClose}
          isMe={isMe}
        />

        <div className="flex-1 overflow-y-auto -mt-12 relative z-10">
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
            onClose={onClose}
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
    </BaseModal>
  );
}
