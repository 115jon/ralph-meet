import { ProfileAssetLayer } from "@/components/chat/ProfileAssetLayer";
import { BaseModal } from "@/components/ui/BaseModal";
import { apiGet } from "@/lib/api-client";
import { extractDominantColor } from "@/lib/color-utils";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { getAuthAssetUrl } from "@/lib/platform";
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

const statusColors: Record<string, string> = {
  online: "bg-primary",
  idle: "bg-warning",
  dnd: "bg-destructive",
  offline: "bg-rm-text-muted/40",
};

function ProfileBanner({
  bannerColor,
  bannerUrl,
  bannerContentType,
  onClose,
  isMe,
}: {
  bannerColor: string | null;
  bannerUrl?: string | null;
  bannerContentType?: string | null;
  onClose: () => void;
  isMe: boolean;
}) {
  return (
    <div
      className="relative h-[140px] shrink-0 overflow-hidden"
      style={{ backgroundColor: bannerColor || "#5865F2" }}
    >
      <ProfileAssetLayer
        url={bannerUrl}
        contentType={bannerContentType}
        alt="Profile banner"
        className="opacity-95"
      />
      <div className="absolute inset-0 bg-linear-to-r from-black/18 via-transparent to-black/28" />
      <div className="absolute top-0 inset-x-0 flex items-center justify-between p-3 z-10">
        <button
          onClick={onClose}
          className="p-1.5 bg-black/30 hover:bg-black/50 rounded-full text-white backdrop-blur-sm transition-colors"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="flex items-center gap-2">
          {!isMe && (
            <button className="p-1.5 bg-black/30 hover:bg-black/50 rounded-full text-white backdrop-blur-sm transition-colors">
              <UserPlus size={18} />
            </button>
          )}
          <button className="p-1.5 bg-black/30 hover:bg-black/50 rounded-full text-white backdrop-blur-sm transition-colors">
            <Settings size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}

function ProfileHeader({ user, isOnline, mutualFriends, mutualServers, isMe }: {
  user: User,
  isOnline: boolean,
  mutualFriends: { count: number },
  mutualServers: { count: number },
  isMe: boolean
}) {
  const displayName = user.display_name?.trim() || user.username;

  return (
    <>
      <div className="px-5">
        <div className="relative inline-block">
          <div className="relative flex h-[88px] w-[88px] items-center justify-center overflow-hidden rounded-full bg-primary text-3xl font-bold text-primary-foreground ring-[5px] ring-rm-bg-primary">
            {user.avatar_url ? (
              <img
                src={getAuthAssetUrl(user.avatar_url)}
                alt={displayName}
                className="absolute inset-0 w-full h-full object-cover"
              />
            ) : (
              displayName[0].toUpperCase()
            )}
          </div>
          <div className="absolute bottom-0 right-0 rounded-full bg-rm-bg-primary p-1">
            <span
              className={cn(
                "block h-6 w-6 rounded-full",
                isOnline
                  ? statusColors[user.status ?? "online"]
                  : statusColors["offline"]
              )}
            />
          </div>
        </div>
      </div>

      <div className="px-5 mt-3">
        <h1 className="text-[28px] font-extrabold text-rm-text-primary leading-tight">
          {displayName}
        </h1>
        <p className="text-[14px] text-rm-text-muted font-medium">
          @{user.username.toLowerCase()}
        </p>

        {user.custom_status && (
          <p className="text-[13px] text-rm-text-secondary mt-1 italic">
            {user.custom_status}
          </p>
        )}

        {!isMe &&
          (mutualFriends.count > 0 || mutualServers.count > 0) && (
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

function ProfileActions({ isMe, handleMessage }: { isMe: boolean, handleMessage: () => void }) {
  return (
    <div className="px-5 mt-5">
      {isMe ? (
        <div className="space-y-2.5">
          <button className="w-full py-3 rounded-2xl bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-[15px] transition-colors flex items-center justify-center gap-2">
            <Settings size={18} />
            Edit Main Profile
          </button>
          <button className="w-full py-3 rounded-2xl bg-primary/20 hover:bg-primary/30 text-primary font-bold text-[15px] transition-colors flex items-center justify-center gap-2">
            <Settings size={18} />
            Edit Per-server Profile
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-center gap-8">
          <button
            onClick={handleMessage}
            className="flex flex-col items-center gap-2"
          >
            <div className="h-14 w-14 rounded-full bg-rm-bg-elevated border border-rm-border flex items-center justify-center hover:bg-rm-bg-hover transition-colors">
              <MessageSquare size={24} className="text-rm-text-primary" />
            </div>
            <span className="text-[12px] font-semibold text-rm-text-muted">
              Message
            </span>
          </button>
          <button className="flex flex-col items-center gap-2">
            <div className="h-14 w-14 rounded-full bg-rm-bg-elevated border border-rm-border flex items-center justify-center hover:bg-rm-bg-hover transition-colors">
              <Phone size={24} className="text-rm-text-primary" />
            </div>
            <span className="text-[12px] font-semibold text-rm-text-muted">
              Voice Call
            </span>
          </button>
          <button className="flex flex-col items-center gap-2">
            <div className="h-14 w-14 rounded-full bg-rm-bg-elevated border border-rm-border flex items-center justify-center hover:bg-rm-bg-hover transition-colors">
              <Video size={24} className="text-rm-text-primary" />
            </div>
            <span className="text-[12px] font-semibold text-rm-text-muted">
              Video Call
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

function ProfileCards({ user, memberRoles, hasModActions, canManage, canKick, canBanPerm, onBan, onKick, onClose }: {
  user: User,
  memberRoles: Role[] | undefined,
  hasModActions: boolean,
  canManage: boolean,
  canKick: boolean,
  canBanPerm: boolean,
  onBan?: (userId: string, username: string) => void,
  onKick?: (userId: string, username: string) => void,
  onClose: () => void
}) {
  const visibleMemberRoles = memberRoles?.filter((role) => !role.is_default) ?? [];

  return (
    <div className="px-5 mt-6 space-y-3 pb-10">
      {user.custom_status && (
        <div className="bg-rm-bg-elevated rounded-2xl border border-rm-border/30 p-4">
          <h3 className="text-[13px] font-bold text-rm-text-primary uppercase tracking-wide mb-2">
            Bio
          </h3>
          <p className="text-[14px] text-rm-text-secondary leading-relaxed">
            {user.custom_status}
          </p>
        </div>
      )}

      <div className="bg-rm-bg-elevated rounded-2xl border border-rm-border/30 p-4">
        <h3 className="text-[13px] font-bold text-rm-text-primary uppercase tracking-wide mb-3">
          Member Since
        </h3>
        <div className="flex items-center gap-3 text-[13px] text-rm-text-secondary">
          <div className="flex items-center gap-2">
            <Calendar size={16} className="text-rm-text-muted" />
            <span>Member</span>
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
                  <span className="text-rm-text-secondary">
                    {role.name}
                  </span>
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
              <button disabled className="w-full flex items-center gap-4 px-2 py-3 rounded-xl opacity-60 cursor-not-allowed">
                <Settings
                  size={22}
                  className="text-rm-text-muted shrink-0"
                />
                <span className="text-[15px] font-medium text-rm-text-primary">
                  Manage
                </span>
              </button>
            )}
            {canKick && onKick && (
              <button
                onClick={() => {
                  onKick(user.id, user.username);
                  onClose();
                }}
                className="w-full flex items-center gap-4 px-2 py-3 rounded-xl hover:bg-rm-bg-hover transition-colors"
              >
                <UserMinus
                  size={22}
                  className="text-destructive shrink-0"
                />
                <span className="text-[15px] font-medium text-destructive">
                  Kick
                </span>
              </button>
            )}
            {canBanPerm && onBan && (
              <button
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
              </button>
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
  const { chatUser, members, onlineUsers } = useChatStore(useShallow(s => ({
    chatUser: s.user,
    members: s.members,
    onlineUsers: s.onlineUsers,
  })));
  const { openDm, dispatch } = useChatActions();
  const [bannerColor, setBannerColor] = useState<string | null>(null);
  const [profileUser, setProfileUser] = useState<User | null>(null);
  const [mutualFriends, setMutualFriends] = useState<{
    count: number;
    items: Array<{ id: string; username: string; avatar_url?: string | null }>;
  }>({ count: 0, items: [] });
  const [mutualServers, setMutualServers] = useState<{
    count: number;
    items: Array<{ id: string; name: string; icon_url?: string | null }>;
  }>({ count: 0, items: [] });

  const isMe = user.id === chatUser?.id;
  const resolvedUser = profileUser ?? user;
  const isOnline = onlineUsers.has(user.id);
  const member = members.find((m) => m.user.id === user.id);
  const memberRoles = roles || member?.roles;

  const myMember = members.find((m) => m.user.id === chatUser?.id);
  const myTotalPerms =
    myMember?.roles?.reduce((acc, r) => acc | r.permissions, 0) ?? 0;
  const canKick = hasPermission(myTotalPerms, PERMISSIONS.KICK_MEMBERS);
  const canBanPerm = hasPermission(myTotalPerms, PERMISSIONS.BAN_MEMBERS);
  const canManage = hasPermission(myTotalPerms, PERMISSIONS.MANAGE_SERVER);
  const hasModActions =
    !isMe && (canKick || canBanPerm || canManage);

  useEffect(() => {
    if (resolvedUser.avatar_url) {
      extractDominantColor(getAuthAssetUrl(resolvedUser.avatar_url)).then((color) => {
        if (color) setBannerColor(color);
      });
      return;
    }
    setBannerColor(null);
  }, [resolvedUser.avatar_url]);

  useEffect(() => {
    setProfileUser(null);
    setMutualFriends({ count: 0, items: [] });
    setMutualServers({ count: 0, items: [] });

    if (!isMe && user.id) {
      apiGet<{
        user: User;
        mutualFriends: {
          count: number;
          items: Array<{
            id: string;
            username: string;
            avatar_url?: string | null;
          }>;
        };
        mutualServers: {
          count: number;
          items: Array<{
            id: string;
            name: string;
            icon_url?: string | null;
          }>;
        };
      }>(`/api/users/${user.id}/profile`)
        .then((data) => {
          setProfileUser(data.user ?? null);
          setMutualFriends(data.mutualFriends ?? { count: 0, items: [] });
          setMutualServers(data.mutualServers ?? { count: 0, items: [] });
        })
        .catch(console.error);
    }
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
      <div className={cn(
        "fixed inset-0 z-300 flex flex-col bg-rm-bg-primary animate-in slide-in-from-bottom duration-300",
        isClosing && "animate-out slide-out-to-bottom fade-out"
      )}>
        <div className="absolute top-2 left-1/2 -translate-x-1/2 w-10 h-1 rounded-full bg-rm-text-muted/30 z-20" />

        <ProfileBanner
          bannerColor={bannerColor}
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

          <ProfileActions isMe={isMe} handleMessage={handleMessage} />

          <ProfileCards
            user={resolvedUser}
            memberRoles={memberRoles}
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
