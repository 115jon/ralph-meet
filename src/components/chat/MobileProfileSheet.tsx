import {
  ProfileActionNotices,
  ProfileActionRow,
  ProfileBlockConfirm,
  ProfileCard,
  ProfileRoleChips,
  ProfileSection,
  ProfileSections,
  resolveProfileCardTheme,
  useProfileActions,
  type MutualFriend,
  type MutualServer,
} from "@/components/chat/ProfileCard";
import { UserPlatformIndicators } from "@/components/chat/UserPlatformIndicators";
import { Button } from "@/components/ui/button";
import { ButtonBase } from "@/components/ui/button-base";
import { Drawer, DrawerContent, DrawerHandle } from "@/components/ui/drawer";
import { PRESS } from "@/components/ui/interaction";
import { apiGet } from "@/lib/api-client";
import { getDisplayName } from "@/lib/display-name";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { resolveProfileReferenceDate } from "@/lib/profile-dates";
import type { Role, User } from "@/lib/types";
import { cn } from "@/lib/utils";
import { normalizeUserStatus, type UserStatus } from "./UserStatusDot";
import { useChatActions, useChatStore } from "@/stores/chat-store";
import { Icon } from "@/components/ui/icon";
import { IconButton } from "@/components/ui/IconButton";

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

type MutualSummary<T> = { count: number; items: T[] };

interface MobileProfileResponse {
  user: User;
  mutualFriends: MutualSummary<MutualFriend>;
  mutualServers: MutualSummary<MutualServer>;
}

interface ProfileFetchState {
  userId: string;
  user: User | null;
  mutualFriends: MutualSummary<MutualFriend>;
  mutualServers: MutualSummary<MutualServer>;
}

/** Opens just short of full height (the chat peeks above); drag up for all. */
const SNAP_POINTS = [0.92, 1];

const EMPTY_MUTUALS = { count: 0, items: [] };

const MOD_ROW = cn(
  "-mx-2 flex min-h-11 items-center gap-3 rounded-md px-2 text-start text-ui-row font-medium text-danger-ink",
  PRESS,
);

/**
 * The phone profile: the shared ProfileCard at sheet size in a bottom
 * drawer. The stock drawer handle sits on the card above the banner, never
 * over the banner art.
 */
export default function MobileProfileSheet({
  open,
  user,
  roles,
  onClose,
  onOpenProfileEditor,
  onBan,
  onKick,
}: MobileProfileSheetProps) {
  const { chatUser, members, onlineUsers } = useChatStore(
    useShallow((s) => ({
      chatUser: s.user,
      members: s.members,
      onlineUsers: s.onlineUsers,
    })),
  );
  const { openDm, dispatch } = useChatActions();
  const [snap, setSnap] = useState<number | string | null>(SNAP_POINTS[0]!);
  const [profileData, setProfileData] = useState<ProfileFetchState | null>(
    null,
  );

  const isMe = user.id === chatUser?.id;
  const activeProfileData =
    profileData?.userId === user.id ? profileData : null;
  const resolvedUser = activeProfileData?.user ?? user;
  const displayName = getDisplayName(resolvedUser);
  const theme = resolveProfileCardTheme(resolvedUser);
  const isOnline = onlineUsers.has(user.id);
  const status: UserStatus = isOnline
    ? normalizeUserStatus(resolvedUser.status ?? "online")
    : "offline";
  const member = members.find((m) => m.user.id === user.id);
  const memberRoles = (roles || member?.roles)?.filter(
    (role) => !role.is_default,
  );
  const hasReferenceDate = Boolean(
    member?.joined_at || resolvedUser.created_at,
  );
  const profileReferenceDate = resolveProfileReferenceDate({
    joinedAt: member?.joined_at,
    createdAt: resolvedUser.created_at ?? null,
  });

  const myMember = members.find((m) => m.user.id === chatUser?.id);
  const myTotalPerms =
    myMember?.roles?.reduce((acc, r) => acc | r.permissions, 0) ?? 0;
  const canKick =
    !isMe && hasPermission(myTotalPerms, PERMISSIONS.KICK_MEMBERS);
  const canBan = !isMe && hasPermission(myTotalPerms, PERMISSIONS.BAN_MEMBERS);

  const actions = useProfileActions({
    userId: user.id,
    username: resolvedUser.username,
    displayName,
    isMe,
    onMessageOpened: onClose,
  });

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
          mutualFriends: data.mutualFriends ?? EMPTY_MUTUALS,
          mutualServers: data.mutualServers ?? EMPTY_MUTUALS,
        });
      })
      .catch(console.error);

    return () => {
      cancelled = true;
    };
  }, [user.id, isMe]);

  // Same path as the member context menu's "Start a call".
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

  const modActions =
    (canKick && onKick) || (canBan && onBan) ? (
      <ProfileSection title="Moderator actions">
        <div className="flex flex-col">
          {canKick && onKick ? (
            <ButtonBase
              onClick={() => {
                onKick(user.id, user.username);
                onClose();
              }}
              className={MOD_ROW}
            >
              <Icon name="userRemove" size="md" className="shrink-0" />
              Kick
            </ButtonBase>
          ) : null}
          {canBan && onBan ? (
            <ButtonBase
              onClick={() => {
                onBan(user.id, user.username);
                onClose();
              }}
              className={MOD_ROW}
            >
              <Icon name="ban" size="md" className="shrink-0" />
              Ban
            </ButtonBase>
          ) : null}
        </div>
      </ProfileSection>
    ) : null;

  return (
    <Drawer
      open={open}
      onOpenChange={(nextOpen) => !nextOpen && onClose()}
      snapPoints={SNAP_POINTS}
      snapPoint={snap}
      onSnapPointChange={setSnap}
    >
      <DrawerContent
        aria-label={`${displayName}'s profile`}
        showHandle={false}
        className="h-dvh max-h-none overflow-hidden rounded-t-2xl border-0 bg-transparent pb-0"
      >
        <ProfileCard
          size="sheet"
          user={resolvedUser}
          theme={theme}
          name={displayName}
          status={status}
          className="h-full rounded-t-2xl"
          surfaceClassName="inset-y-0"
          // The stock handle, on the card above the banner (overlays §3b),
          // and a close X: a drag or the scrim is not the only way out.
          header={
            <div className="relative shrink-0">
              <DrawerHandle className="my-2" />
              <IconButton
                icon="close"
                size={40}
                shape="circle"
                aria-label="Close profile"
                onClick={onClose}
                // 8px inside the banner's top-right corner (the handle row
                // is 20px); the ply-3 disc keeps the glyph legible on any
                // banner art.
                className="absolute top-7 right-2 z-40 bg-ply-3 shadow-float"
              />
            </div>
          }
          scrollClassName="pb-[calc(var(--safe-area-bottom,0px)+8dvh)]"
          nameAdornment={
            <UserPlatformIndicators
              userId={resolvedUser.id}
              platforms={resolvedUser.presence_platforms}
              status={resolvedUser.status}
              iconSize="sm"
              color="var(--ink-2)"
              offlineColor="var(--ink-3)"
            />
          }
          actions={
            <ProfileActionRow
              controller={actions}
              size="sheet"
              selfAction={
                <Button
                  size="lg"
                  className="flex-1"
                  onClick={onOpenProfileEditor}
                >
                  <Icon name="edit" size="sm" />
                  Edit profile
                </Button>
              }
              extra={
                <Button
                  variant="secondary"
                  size="lg"
                  onClick={() => void handleCall()}
                >
                  <Icon name="call" size="sm" />
                  Call
                </Button>
              }
            />
          }
        >
          <ProfileActionNotices controller={actions} />
          <ProfileSections
            bio={resolvedUser.bio}
            roles={
              memberRoles && memberRoles.length > 0 ? (
                <ProfileRoleChips roles={memberRoles} />
              ) : null
            }
            mutualServers={isMe ? null : activeProfileData?.mutualServers}
            mutualFriends={isMe ? null : activeProfileData?.mutualFriends}
            memberSince={hasReferenceDate ? profileReferenceDate : null}
          />
          {modActions}
          <ProfileBlockConfirm controller={actions} />
        </ProfileCard>
      </DrawerContent>
    </Drawer>
  );
}
