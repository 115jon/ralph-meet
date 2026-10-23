import { AvatarImage } from "@/components/chat/AvatarImage";
import InlineEmojiText from "@/components/chat/InlineEmojiText";
import { ProfileAssetLayer } from "@/components/chat/ProfileAssetLayer";
import { ProfileDisplayName } from "@/components/chat/ProfileDisplayName";
import {
  UserStatusDot,
  type UserStatus,
} from "@/components/chat/UserStatusDot";
import { ConfirmStrip, RowError } from "@/components/chat/settings/primitives";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/IconButton";
import { Icon } from "@/components/ui/icon";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  ResponsiveDialog,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api-client";
import { describeApiError } from "@/lib/api-errors";
import { getDisplayInitial, getDisplayName } from "@/lib/display-name";
import { getAuthAssetUrl } from "@/lib/platform";
import { resolveProfileTheme } from "@/lib/profile-customization";
import { resolveProfileReferenceDate } from "@/lib/profile-dates";
import type { User } from "@/lib/types";
import { useChatActions, useChatStore } from "@/stores/chat-store";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

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

type MutualFriendSummary = {
  count: number;
  items: Array<{
    id: string;
    username: string;
    display_name?: string | null;
    avatar_url?: string | null;
    avatar_display?: User["avatar_display"];
  }>;
};

type MutualServerSummary = {
  count: number;
  items: Array<{
    id: string;
    name: string;
    icon_url?: string | null;
  }>;
};

type ProfileResponse = {
  user: User;
  mutualFriends: MutualFriendSummary;
  mutualServers: MutualServerSummary;
};

type RelationshipAction = "add" | "remove" | "accept" | "block" | "unblock";

const STATUS_LABELS: Record<UserStatus, string> = {
  online: "Online",
  idle: "Idle",
  dnd: "Do Not Disturb",
  offline: "Offline",
};

/** Verb phrases for describeApiError, read after "Unable to". */
const ACTION_COPY: Record<RelationshipAction, (name: string) => string> = {
  add: (name) => `send ${name} a friend request`,
  accept: (name) => `accept ${name}'s friend request`,
  remove: (name) => `update your friendship with ${name}`,
  block: (name) => `block ${name}`,
  unblock: (name) => `unblock ${name}`,
};

const EYEBROW =
  "text-ui-2xs font-semibold uppercase tracking-[0.08em] text-rm-text-muted";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className={EYEBROW}>{title}</h3>
      {children}
    </section>
  );
}

function Chip({ media, label }: { media: ReactNode; label: ReactNode }) {
  return (
    <li className="flex min-w-0 max-w-full items-center gap-2 rounded-full bg-rm-tint-1 py-1 pr-3 pl-1">
      <span className="relative flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-rm-tint-2 text-ui-2xs font-semibold text-rm-text-secondary">
        {media}
      </span>
      <span className="min-w-0 truncate text-ui-sm text-rm-text">{label}</span>
    </li>
  );
}

/**
 * The full profile card (Friends menu → Profile). A content-width dialog on
 * desktop, a bottom drawer on phones; one scroller either way. Only sections
 * backed by real data: about, member since, mutual servers and friends.
 */
export default function UserProfileModal({
  open,
  user,
  onClose,
  initialBlockConfirm = false,
}: Props) {
  const relationships = useChatStore((state) => state.relationships);
  const currentUser = useChatStore((state) => state.user);
  const memberRecord = useChatStore(
    (state) =>
      (state.members as JoinedMemberRecord[]).find(
        (member) => member.user.id === user.id,
      ) ?? null,
  );
  const { openDm, loadRelationships, dispatch } = useChatActions();

  const [busy, setBusy] = useState<RelationshipAction | "message" | null>(null);
  const [profileData, setProfileData] = useState<ProfileResponse | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmBlock, setConfirmBlock] = useState(initialBlockConfirm);
  const [blockError, setBlockError] = useState<string | null>(null);
  const blockTriggerRef = useRef<HTMLButtonElement>(null);

  const relationship = relationships.find((entry) => entry.user.id === user.id);
  const seededUser =
    memberRecord?.user ?? (currentUser?.id === user.id ? currentUser : user);
  const resolvedUser = profileData?.user ?? seededUser;
  const isMe = currentUser?.id === resolvedUser.id;
  const displayName = getDisplayName(resolvedUser);
  const profileTheme = resolveProfileTheme(resolvedUser);
  const referenceDate = resolveProfileReferenceDate({
    joinedAt: memberRecord?.joined_at,
    createdAt: resolvedUser.created_at ?? null,
  });
  // "Unknown" when neither date is on record: not worth a section.
  const hasReferenceDate = Boolean(
    memberRecord?.joined_at || resolvedUser.created_at,
  );
  const mutualFriends = isMe ? null : profileData?.mutualFriends;
  const mutualServers = isMe ? null : profileData?.mutualServers;
  const customStatus = resolvedUser.custom_status?.trim() ?? "";
  const pronouns = resolvedUser.pronouns?.trim() ?? "";
  const bio = resolvedUser.bio?.trim() ?? "";
  const status = (resolvedUser.status ?? "offline") as UserStatus;
  const statusLabel = STATUS_LABELS[status] ?? STATUS_LABELS.offline;
  const isBlocked = relationship?.type === 1;
  const fallbackName = getDisplayName(user);

  useEffect(() => {
    void loadRelationships();
  }, [loadRelationships]);

  useEffect(() => {
    if (isMe) return undefined;

    let cancelled = false;
    setProfileError(null);

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
  }, [isMe, user.id, fallbackName]);

  const runRelationshipAction = useCallback(
    async (action: RelationshipAction) => {
      setBusy(action);
      setActionError(null);
      try {
        if (action === "add") {
          await apiPost("/api/friends", { username: resolvedUser.username });
        } else if (action === "accept" || action === "block") {
          await apiPut("/api/friends", {
            target_user_id: resolvedUser.id,
            action,
          });
        } else {
          await apiDelete("/api/friends", { target_user_id: resolvedUser.id });
        }
        await loadRelationships();
        return true;
      } catch (error) {
        const copy = describeApiError(error, ACTION_COPY[action](displayName));
        if (action === "block") setBlockError(copy);
        else setActionError(copy);
        return false;
      } finally {
        setBusy(null);
      }
    },
    [displayName, loadRelationships, resolvedUser.id, resolvedUser.username],
  );

  const cancelBlock = useCallback(() => {
    setConfirmBlock(false);
    setBlockError(null);
    requestAnimationFrame(() => blockTriggerRef.current?.focus());
  }, []);

  const handleBlock = async () => {
    if (await runRelationshipAction("block")) setConfirmBlock(false);
  };

  const handleMessage = async () => {
    if (isMe) return;
    setBusy("message");
    setActionError(null);
    const channelId = await openDm(resolvedUser.id);
    setBusy(null);
    if (!channelId) {
      setActionError(
        `Unable to open your messages with ${displayName}. Check your connection and try again.`,
      );
      return;
    }
    dispatch({ type: "SWITCH_SERVER", serverId: "@me", channelId });
    onClose();
  };

  const handleCopyUserId = async () => {
    try {
      await navigator.clipboard.writeText(resolvedUser.id);
    } catch {
      // Clipboard can be unavailable (insecure context); the ID is not lost.
    }
  };

  const relationshipButtons = (() => {
    const pending = busy !== null;
    switch (relationship?.type) {
      case 0:
        return (
          <Button
            variant="secondary"
            loading={busy === "remove"}
            disabled={pending && busy !== "remove"}
            onClick={() => void runRelationshipAction("remove")}
          >
            <Icon name="userRemove" size="sm" />
            Remove friend
          </Button>
        );
      case 1:
        return (
          <Button
            variant="secondary"
            loading={busy === "unblock"}
            disabled={pending && busy !== "unblock"}
            onClick={() => void runRelationshipAction("unblock")}
          >
            Unblock
          </Button>
        );
      case 2:
        return (
          <>
            <Button
              variant="secondary"
              loading={busy === "accept"}
              disabled={pending && busy !== "accept"}
              onClick={() => void runRelationshipAction("accept")}
            >
              <Icon name="check" size="sm" />
              Accept request
            </Button>
            <Button
              variant="ghost"
              loading={busy === "remove"}
              disabled={pending && busy !== "remove"}
              onClick={() => void runRelationshipAction("remove")}
            >
              Decline
            </Button>
          </>
        );
      case 3:
        return (
          <Button variant="secondary" disabled>
            Friend request sent
          </Button>
        );
      default:
        return (
          <Button
            variant="secondary"
            loading={busy === "add"}
            disabled={pending && busy !== "add"}
            onClick={() => void runRelationshipAction("add")}
          >
            <Icon name="invite" size="sm" />
            Add friend
          </Button>
        );
    }
  })();

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <ResponsiveDialogContent
        showCloseButton={false}
        onEscapeKeyDown={(event) => {
          // Escape backs out of the block confirmation before the profile.
          if (!confirmBlock) return;
          event.preventDefault();
          cancelBlock();
        }}
        style={profileTheme.variables}
        className="gap-0"
        drawerClassName="px-0"
        dialogClassName="flex max-h-[min(720px,calc(100dvh-32px))] flex-col overflow-hidden p-0 md:max-w-lg"
      >
        <ResponsiveDialogTitle className="sr-only">
          {`${displayName}'s profile`}
        </ResponsiveDialogTitle>
        <ResponsiveDialogDescription className="sr-only">
          {`@${resolvedUser.username}, ${statusLabel}`}
        </ResponsiveDialogDescription>

        <ResponsiveDialogClose asChild>
          <IconButton
            icon="close"
            size="sm"
            // The dialog close step (12.8) over a banner photo: a surface chip.
            iconSize="sm"
            aria-label="Close profile"
            className="absolute top-3 right-3 z-20 bg-rm-bg-surface text-rm-text-secondary max-md:hidden dark:bg-rm-bg-elevated"
          />
        </ResponsiveDialogClose>

        <div className="flex flex-col md:min-h-0 md:flex-1 md:overflow-y-auto md:overscroll-contain">
          <div
            className="relative h-28 shrink-0 overflow-hidden max-md:mx-4 max-md:rounded-lg"
            style={{ background: "var(--rm-profile-custom-banner-fallback)" }}
          >
            <ProfileAssetLayer
              url={resolvedUser.banner_url}
              contentType={resolvedUser.banner_content_type}
              alt=""
            />
          </div>

          <div className="flex flex-col gap-6 px-4 pb-2 md:px-6 md:pb-6">
            <div className="flex flex-col gap-3">
              <div className="relative -mt-10 size-20 shrink-0 max-md:ml-2">
                <div className="flex size-full items-center justify-center overflow-hidden rounded-full bg-rm-tint-3 text-ui-2xl font-semibold text-rm-text ring-4 ring-rm-bg-surface dark:ring-rm-bg-elevated">
                  {resolvedUser.avatar_url ? (
                    <AvatarImage
                      src={getAuthAssetUrl(resolvedUser.avatar_url)}
                      alt=""
                      display={resolvedUser.avatar_display}
                    />
                  ) : (
                    getDisplayInitial({ name: displayName })
                  )}
                </div>
                <span className="absolute right-0 bottom-0 rounded-full bg-rm-bg-surface p-1 dark:bg-rm-bg-elevated">
                  <UserStatusDot status={status} className="size-4" />
                </span>
              </div>

              <div className="min-w-0">
                <ProfileDisplayName
                  text={displayName}
                  displayNameStyle={resolvedUser.display_name_style}
                  className="block truncate text-ui-lg font-semibold text-rm-text"
                />
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-ui-sm text-rm-text-secondary">
                  <span className="break-words">@{resolvedUser.username}</span>
                  {pronouns ? (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{pronouns}</span>
                    </>
                  ) : null}
                  <span aria-hidden="true">·</span>
                  <span>{statusLabel}</span>
                </p>
                {customStatus ? (
                  <p className="mt-2 text-ui-sm text-pretty text-rm-text">
                    {customStatus}
                  </p>
                ) : null}
              </div>

              {!isMe ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    loading={busy === "message"}
                    disabled={busy !== null && busy !== "message"}
                    onClick={() => void handleMessage()}
                  >
                    <Icon name="chat" size="sm" />
                    Message
                  </Button>
                  {relationshipButtons}
                  <TooltipProvider>
                    <IconButton
                      icon="copy"
                      variant="muted"
                      iconSize="sm"
                      tooltip="Copy user ID"
                      onClick={() => void handleCopyUserId()}
                    />
                  </TooltipProvider>
                </div>
              ) : null}

              {actionError ? (
                <RowError className="mt-0">{actionError}</RowError>
              ) : null}
              {profileError ? (
                <RowError className="mt-0">{profileError}</RowError>
              ) : null}
            </div>

            {bio ? (
              <Section title="About me">
                <p className="max-w-[62ch] text-ui-sm whitespace-pre-line text-pretty text-rm-text">
                  {bio}
                </p>
              </Section>
            ) : null}

            {hasReferenceDate ? (
              <Section title={referenceDate.label}>
                <p className="text-ui-sm text-rm-text">{referenceDate.value}</p>
              </Section>
            ) : null}

            {mutualServers && mutualServers.count > 0 ? (
              <Section title={`Mutual servers · ${mutualServers.count}`}>
                <ul className="flex flex-wrap gap-2">
                  {mutualServers.items.map((server) => (
                    <Chip
                      key={server.id}
                      media={
                        server.icon_url ? (
                          <img
                            src={getAuthAssetUrl(server.icon_url)}
                            alt=""
                            className="size-full object-cover"
                          />
                        ) : (
                          server.name.charAt(0).toUpperCase()
                        )
                      }
                      label={<InlineEmojiText text={server.name} />}
                    />
                  ))}
                </ul>
              </Section>
            ) : null}

            {mutualFriends && mutualFriends.count > 0 ? (
              <Section title={`Mutual friends · ${mutualFriends.count}`}>
                <ul className="flex flex-wrap gap-2">
                  {mutualFriends.items.map((friend) => (
                    <Chip
                      key={friend.id}
                      media={
                        friend.avatar_url ? (
                          <AvatarImage
                            src={getAuthAssetUrl(friend.avatar_url)}
                            alt=""
                            display={friend.avatar_display}
                          />
                        ) : (
                          getDisplayInitial(friend)
                        )
                      }
                      label={getDisplayName(friend)}
                    />
                  ))}
                </ul>
              </Section>
            ) : null}

            {!isMe && !isBlocked ? (
              <div className="@container border-t border-rm-border pt-1">
                {confirmBlock ? (
                  <ConfirmStrip
                    consequence={`Block ${displayName}? They'll be removed from your friends and can't send you friend requests. You can unblock them later.`}
                    confirmLabel={`Block ${displayName}`}
                    onConfirm={() => void handleBlock()}
                    onCancel={cancelBlock}
                    busy={busy === "block"}
                    error={blockError}
                  />
                ) : (
                  <Button
                    ref={blockTriggerRef}
                    variant="destructive"
                    size="sm"
                    className="mt-3"
                    disabled={busy !== null}
                    onClick={() => setConfirmBlock(true)}
                  >
                    <Icon name="ban" size="sm" />
                    Block
                  </Button>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
