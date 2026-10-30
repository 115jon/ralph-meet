import {
  ProfileActionNotices,
  ProfileActionRow,
  ProfileBlockConfirm,
  ProfileCard,
  ProfileSections,
  resolveProfileCardTheme,
  useProfileActions,
  type MutualFriend,
  type MutualServer,
} from "@/components/chat/ProfileCard";
import {
  USER_STATUS_LABELS,
  type UserStatus,
} from "@/components/chat/UserStatusDot";
import { RowError } from "@/components/chat/settings/primitives";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { apiGet } from "@/lib/api-client";
import { describeApiError } from "@/lib/api-errors";
import { getDisplayName } from "@/lib/display-name";
import { resolveProfileReferenceDate } from "@/lib/profile-dates";
import type { User } from "@/lib/types";
import { useChatActions, useChatStore } from "@/stores/chat-store";
import { useCallback, useEffect, useState } from "react";

interface Props {
  open: boolean;
  user: User;
  onClose: () => void;
  /** Open with the block confirmation showing (fixtures). */
  initialBlockConfirm?: boolean;
}

type JoinedMemberRecord = {
  user: User;
  joined_at?: string | number | null;
};

type ProfileResponse = {
  user: User;
  mutualFriends: { count: number; items: MutualFriend[] };
  mutualServers: { count: number; items: MutualServer[] };
};

/**
 * The full profile card (Friends menu → Profile): the shared ProfileCard at
 * modal size. A top-anchored content dialog on desktop (it grows downward,
 * so loading or the block confirm never recentre it), a bottom drawer on
 * phones; one scroller either way.
 */
export default function UserProfileModal({
  open,
  user,
  onClose,
  initialBlockConfirm = false,
}: Props) {
  const currentUser = useChatStore((state) => state.user);
  const memberRecord = useChatStore(
    (state) =>
      (state.members as JoinedMemberRecord[]).find(
        (member) => member.user.id === user.id,
      ) ?? null,
  );
  const { loadRelationships } = useChatActions();
  const isMobile = useIsMobile();

  const [profileData, setProfileData] = useState<ProfileResponse | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const seededUser =
    memberRecord?.user ?? (currentUser?.id === user.id ? currentUser : user);
  const resolvedUser = profileData?.user ?? seededUser;
  const isMe = currentUser?.id === resolvedUser.id;
  const displayName = getDisplayName(resolvedUser);
  const fallbackName = getDisplayName(user);
  const theme = resolveProfileCardTheme(resolvedUser);
  const status = (resolvedUser.status ?? "offline") as UserStatus;
  const statusLabel = USER_STATUS_LABELS[status] ?? USER_STATUS_LABELS.offline;
  const hasReferenceDate = Boolean(
    memberRecord?.joined_at || resolvedUser.created_at,
  );
  const referenceDate = resolveProfileReferenceDate({
    joinedAt: memberRecord?.joined_at,
    createdAt: resolvedUser.created_at ?? null,
  });

  const actions = useProfileActions({
    userId: resolvedUser.id,
    username: resolvedUser.username,
    displayName,
    isMe,
    onMessageOpened: onClose,
    initialBlockConfirm,
  });
  const { confirmBlock, cancelBlock } = actions;

  useEffect(() => {
    void loadRelationships();
  }, [loadRelationships]);

  useEffect(() => {
    if (isMe) return undefined;

    let cancelled = false;

    void apiGet<ProfileResponse>(`/api/users/${user.id}/profile`)
      .then((data) => {
        if (!cancelled) setProfileData(data);
      })
      .catch((error) => {
        if (cancelled) return;
        setProfileError(
          describeApiError(error, `load ${fallbackName}'s profile`),
        );
      });

    return () => {
      cancelled = true;
    };
  }, [isMe, user.id, fallbackName, attempt]);

  const retry = useCallback(() => {
    setProfileError(null);
    setAttempt((value) => value + 1);
  }, []);

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <ResponsiveDialogContent
        size="lg"
        placement="top"
        initialFocus="surface"
        aria-label={`${displayName}'s profile`}
        // Name effects and decorations play while the profile is open.
        data-decoration-play=""
        onEscapeKeyDown={(event) => {
          // Escape backs out of the block confirmation before the profile.
          if (!confirmBlock) return;
          event.preventDefault();
          cancelBlock();
        }}
        className="gap-0"
        drawerClassName="px-0 pt-0"
        // The profile card is the panel (radius, line, ply-3, shadow); its
        // frame art sits in the dialog box around it. The primitive's close
        // (28/16 at 16/16) sits on the banner.
        dialogClassName="flex flex-col overflow-visible border-0 bg-transparent p-0 shadow-none"
      >
        <ResponsiveDialogTitle className="sr-only">
          {`${displayName}'s profile`}
        </ResponsiveDialogTitle>
        <ResponsiveDialogDescription className="sr-only">
          {`@${resolvedUser.username}, ${statusLabel}`}
        </ResponsiveDialogDescription>

        <ProfileCard
          size={isMobile ? "sheet" : "modal"}
          user={resolvedUser}
          theme={theme}
          name={displayName}
          status={status}
          renderFrame={!isMobile}
          replayEffectOnBannerHover
          className={isMobile ? "rounded-t-2xl" : undefined}
          surfaceClassName={isMobile ? undefined : "shadow-modal"}
          scrollClassName="md:max-h-[calc(100dvh-max(48px,12vh)-24px-var(--rm-profile-frame-reserve-y,0px))]"
          actions={
            <ProfileActionRow
              controller={actions}
              size={isMobile ? "sheet" : "modal"}
              loadError={Boolean(profileError)}
              onRetry={retry}
            />
          }
        >
          <ProfileActionNotices controller={actions} />
          {profileError ? (
            <RowError className="mt-0">{profileError}</RowError>
          ) : null}
          <ProfileSections
            bio={resolvedUser.bio}
            mutualServers={isMe ? null : profileData?.mutualServers}
            mutualFriends={isMe ? null : profileData?.mutualFriends}
            memberSince={hasReferenceDate ? referenceDate : null}
          />
          <ProfileBlockConfirm controller={actions} />
        </ProfileCard>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
