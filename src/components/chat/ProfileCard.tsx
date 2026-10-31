/**
 * The one profile card (talk-tree-spec §8 Overlays, overlays audit issue 4,
 * flow 4). The profile popover, the profile modal, the account popover's
 * identity block, the phone profile sheet, the editor preview and the
 * settings rail all draw this, at three sizes:
 *
 *   size      banner  avatar  name
 *   popover   96      72      18/600   (account popover, rail, editor preview)
 *   modal     120     88      22/600
 *   sheet     140     88      22/600
 *
 * One section order: banner, avatar (ring in the card colour, overlapping
 * the banner by half), name, `@handle · pronouns`, status line, one row of
 * actions, then About me, Roles, Mutual servers, Mutual friends and Member
 * since (only when known). Headings are sentence-case 12/16 500 ink-2.
 *
 * The card is ply-3 (a float). A profile with custom colours re-points the
 * ink, tint, line and primary tokens at its own colourway inside the card,
 * so every primitive (Button, IconButton, rows) follows it.
 */

import { AvatarImage } from "@/components/chat/AvatarImage";
import { avatarShape, isAvatarDecorated } from "@/components/ui/avatar-shape";
import {
  DECORATION_PLAY_ATTR,
  ProfileAssetLayer,
} from "@/components/chat/ProfileAssetLayer";
import {
  PROFILE_EFFECT_STAGE_HEIGHT,
  PROFILE_EFFECT_STAGE_WIDTH,
} from "@/components/chat/ProfileCollectiblesLayer";
import { ProfileDisplayName } from "@/components/chat/ProfileDisplayName";
import { ProfileSurfaceShell } from "@/components/chat/ProfileSurfaceShell";
import {
  USER_STATUS_LABELS,
  UserStatusDot,
  type UserStatus,
} from "@/components/chat/UserStatusDot";
import InlineEmojiText from "@/components/chat/InlineEmojiText";
import { ConfirmStrip, RowError } from "@/components/chat/settings/primitives";
import {
  ActionSheet,
  type ActionSheetItem,
} from "@/components/ui/action-sheet";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import { IconButton } from "@/components/ui/IconButton";
import { Num } from "@/components/ui/num";
import { apiDelete, apiPost, apiPut } from "@/lib/api-client";
import { describeApiError } from "@/lib/api-errors";
import { getAvatarDecoration, type AvatarDisplay } from "@/lib/avatar-display";
import { getDisplayInitial, getDisplayName } from "@/lib/display-name";
import { getAuthAssetUrl } from "@/lib/platform";
import {
  resolveProfileTheme,
  type DisplayNameStyle,
  type ProfileCustomizationInput,
  type ResolvedProfileTheme,
} from "@/lib/profile-customization";
import type { User } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useChatActions, useChatStore } from "@/stores/chat-store";
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useId,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

export type ProfileCardSize = "popover" | "modal" | "sheet";

/* ------------------------------------------------------------------ */
/* Theme                                                                */
/* ------------------------------------------------------------------ */

/**
 * A custom colourway: re-point the layer-2 ink, tints, lines and the primary
 * fill at the profile's own values inside the card. Only for custom themes,
 * whose values are literal colours (the token theme's values are `var(--…)`
 * references to these same tokens, which would loop).
 */
const CUSTOM_CARD_VARS = {
  "--ink-1": "var(--rm-profile-custom-text)",
  "--ink-2": "var(--rm-profile-custom-muted)",
  "--ink-3": "var(--rm-profile-custom-ghost)",
  "--tint-1":
    "color-mix(in srgb, var(--rm-profile-custom-text) 8%, transparent)",
  "--tint-2":
    "color-mix(in srgb, var(--rm-profile-custom-text) 12%, transparent)",
  "--tint-3":
    "color-mix(in srgb, var(--rm-profile-custom-text) 18%, transparent)",
  "--line": "var(--rm-profile-custom-card-border)",
  "--line-strong":
    "color-mix(in srgb, var(--rm-profile-custom-text) 18%, transparent)",
  "--primary-fill": "var(--rm-profile-custom-button-bg)",
  "--on-primary": "var(--rm-profile-custom-button-text)",
} as CSSProperties;

/**
 * `resolveProfileTheme` plus the colourway tokens. A profile without custom
 * colours already sits on ply-3 (the theme module's default).
 */
export function resolveProfileCardTheme(
  input: ProfileCustomizationInput,
): ResolvedProfileTheme {
  const theme = resolveProfileTheme(input);
  if (theme.backgroundColor === null) return theme;
  return {
    ...theme,
    variables: { ...theme.variables, ...CUSTOM_CARD_VARS },
  };
}

/* ------------------------------------------------------------------ */
/* Card                                                                 */
/* ------------------------------------------------------------------ */

const BANNER: Record<ProfileCardSize, string> = {
  popover: "h-24",
  modal: "h-30",
  sheet: "h-35",
};

/** Avatar box and the half-overlap onto the banner. */
const AVATAR: Record<ProfileCardSize, string> = {
  popover: "size-18 -mt-9",
  modal: "size-22 -mt-11",
  sheet: "size-22 -mt-11",
};

const INSET: Record<ProfileCardSize, string> = {
  popover: "px-4 pb-4",
  modal: "px-5 pb-5",
  sheet: "px-4 pb-6",
};

const NAME: Record<ProfileCardSize, string> = {
  popover: "text-ui-lg",
  modal: "text-ui-xl",
  sheet: "text-ui-xl",
};

/** Expanding content fades in (140ms-ish, opacity only, no height). */
const PROFILE_REVEAL =
  "transition-opacity duration-(--dur-2) ease-out starting:opacity-0";

type ProfileCardUser = Pick<
  User,
  "username" | "display_name" | "pronouns" | "custom_status"
> & {
  id?: string;
  display_name_style?: DisplayNameStyle | string | null;
  avatar_url?: string | null;
  avatar_display?: AvatarDisplay | string | null;
  banner_url?: string | null;
  banner_content_type?: string | null;
};

type ProfileCardProps = {
  size: ProfileCardSize;
  user: ProfileCardUser;
  /** From `resolveProfileCardTheme`; defaults to the user's own colours. */
  theme: ResolvedProfileTheme;
  /** Display name to show (defaults to display name, then username). */
  name?: string;
  /** Resolved avatar URL (editor drafts); defaults to the user's avatar. */
  avatarSrc?: string | null;
  /** Presence for the status line; omit to hide the line. */
  status?: UserStatus | null;
  /** Replaces the status line (the account popover's custom-status row). */
  statusLine?: ReactNode;
  /** Beside the name (platform indicators). */
  nameAdornment?: ReactNode;
  /** The one row of buttons under the identity block. */
  actions?: ReactNode;
  /** Everything after the actions: notices, sections, footer. */
  children?: ReactNode;
  /** Above the banner, outside the scroller (the phone drawer handle). */
  header?: ReactNode;
  /** Classes for the scroller (max height). */
  scrollClassName?: string;
  playAnimation?: boolean;
  /**
   * Replay the profile effect when a mouse enters the banner (someone else's
   * profile). Own-profile and editing surfaces leave it off: the effect plays
   * once per open and rests.
   */
  replayEffectOnBannerHover?: boolean;
  /** Change it to replay the effect once (the editor's Preview button). */
  effectReplayKey?: number;
  renderFrame?: boolean;
  className?: string;
  surfaceClassName?: string;
  style?: CSSProperties;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "children" | "style">;

export const ProfileCard = forwardRef<HTMLDivElement, ProfileCardProps>(
  function ProfileCard(
    {
      size,
      user,
      theme,
      name,
      avatarSrc,
      status,
      statusLine,
      nameAdornment,
      actions,
      children,
      header,
      scrollClassName,
      playAnimation = true,
      replayEffectOnBannerHover = false,
      effectReplayKey = 0,
      renderFrame = true,
      className,
      surfaceClassName,
      style,
      ...props
    },
    ref,
  ) {
    const [bannerHoverReplays, setBannerHoverReplays] = useState(0);
    const displayName = name ?? getDisplayName(user);
    const pronouns = user.pronouns?.trim() ?? "";
    const avatar =
      avatarSrc !== undefined
        ? avatarSrc
        : user.avatar_url
          ? getAuthAssetUrl(user.avatar_url)
          : null;

    const line =
      statusLine !== undefined ? (
        statusLine
      ) : status ? (
        <ProfileStatusLine status={status} customStatus={user.custom_status} />
      ) : null;

    return (
      <ProfileSurfaceShell
        ref={ref}
        {...props}
        // An open profile plays its name effect and decorations; a still
        // card (the settings rail) keeps them on their resting frame.
        {...(playAnimation ? { [DECORATION_PLAY_ATTR]: "" } : {})}
        variant={
          size === "sheet" ? "sheet" : size === "modal" ? "card" : "popover"
        }
        display={user.avatar_display}
        playAnimation={playAnimation}
        effectReplayKey={effectReplayKey + bannerHoverReplays}
        renderFrame={renderFrame}
        className={className}
        surfaceClassName={surfaceClassName}
        style={{ ...theme.variables, ...style }}
        // The effect is authored for a 450x880 card: pin it to the top at
        // that aspect, whatever width the card ends up (a frame insets it).
        effectStageClassName="bottom-auto"
        effectStageStyle={{
          aspectRatio: `${PROFILE_EFFECT_STAGE_WIDTH} / ${PROFILE_EFFECT_STAGE_HEIGHT}`,
        }}
      >
        <div className="flex h-full min-h-0 flex-col">
          {header}
          <div
            className={cn(
              "min-h-0 flex-1 overflow-y-auto overscroll-contain",
              scrollClassName,
            )}
          >
            <div
              className={cn("relative shrink-0 overflow-hidden", BANNER[size])}
              style={{ background: "var(--rm-profile-custom-banner-fallback)" }}
              onPointerEnter={
                replayEffectOnBannerHover
                  ? (event) => {
                      if (event.pointerType === "mouse")
                        setBannerHoverReplays((count) => count + 1);
                    }
                  : undefined
              }
            >
              <ProfileAssetLayer
                url={user.banner_url}
                contentType={user.banner_content_type}
                alt=""
              />
              <div
                className="absolute inset-0"
                style={{
                  background: "var(--rm-profile-custom-banner-overlay)",
                }}
              />
            </div>

            <div className={cn("relative flex flex-col gap-4", INSET[size])}>
              <div className="flex flex-col gap-3">
                <ProfileAvatar
                  size={size}
                  src={avatar}
                  name={displayName}
                  display={user.avatar_display}
                />
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <ProfileDisplayName
                      text={displayName}
                      displayNameStyle={user.display_name_style}
                      className={cn(
                        "min-w-0 truncate font-semibold text-ink-1",
                        NAME[size],
                      )}
                      backgroundColor={theme.backgroundColor}
                      readableFallbackColor={theme.textColor}
                    />
                    {nameAdornment}
                  </div>
                  <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-ui-sm text-ink-2">
                    <span className="break-all">@{user.username}</span>
                    {pronouns ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{pronouns}</span>
                      </>
                    ) : null}
                  </p>
                  {line}
                </div>
              </div>
              {actions}
              <ProfileCardSizeContext.Provider value={size}>
                {children}
              </ProfileCardSizeContext.Provider>
            </div>
          </div>
        </div>
      </ProfileSurfaceShell>
    );
  },
);

function ProfileAvatar({
  size,
  src,
  name,
  display,
}: {
  size: ProfileCardSize;
  src: string | null;
  name: string;
  display?: AvatarDisplay | string | null;
}) {
  const decorated = Boolean(getAvatarDecoration(display));
  return (
    // The ring is the card colour; the fallback is laid over the opaque card
    // colour so the banner never shows through a translucent tint.
    <div
      className={cn(
        // A square key; a decoration's ring art is drawn for a circle, so a
        // decorated avatar keeps the round halo and crop (AvatarImage's rule).
        decorated ? "rounded-full" : "rounded-avatar",
        "relative z-10 flex shrink-0 items-center justify-center bg-[var(--rm-profile-custom-background)] bg-[linear-gradient(var(--tint-2),var(--tint-2))] font-display text-ui-2xl font-extrabold text-ink-1 shadow-[0_0_0_4px_var(--rm-profile-custom-background)]",
        AVATAR[size],
      )}
    >
      {src ? (
        <AvatarImage src={src} alt="" display={display} />
      ) : (
        <span aria-hidden="true">{getDisplayInitial({ name })}</span>
      )}
    </div>
  );
}

/** Presence dot plus label, and the custom status after it. */
function ProfileStatusLine({
  status,
  customStatus,
}: {
  status: UserStatus;
  customStatus?: string | null;
}) {
  const custom = customStatus?.trim() ?? "";
  return (
    <p className="flex min-w-0 items-center gap-2 text-ui-sm">
      <UserStatusDot status={status} className="size-2 shrink-0" />
      <span className="shrink-0 text-ink-2">{USER_STATUS_LABELS[status]}</span>
      {custom ? (
        <>
          <span aria-hidden="true" className="text-ink-3">
            ·
          </span>
          <span className="min-w-0 truncate text-ink-1">
            <InlineEmojiText text={custom} />
          </span>
        </>
      ) : null}
    </p>
  );
}

/* ------------------------------------------------------------------ */
/* Sections                                                             */
/* ------------------------------------------------------------------ */

/**
 * Section labels, sentence case at 12/16 ink-2. The phone sheet uses the
 * one phone section label (600, as on the You page); larger cards use 500
 * so the label sits under the 22/600 name.
 */
const SECTION_LABEL: Record<ProfileCardSize, string> = {
  popover: "font-medium",
  modal: "font-medium",
  sheet: "font-semibold",
};

/** The size of the card a section renders in (set by `ProfileCard`). */
const ProfileCardSizeContext = createContext<ProfileCardSize>("modal");

export function ProfileSection({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: ReactNode;
}) {
  const size = useContext(ProfileCardSizeContext);
  return (
    <section className={cn("flex flex-col gap-2", PROFILE_REVEAL)}>
      <h3
        className={cn(
          "flex items-center gap-1.5 text-ui-xs text-ink-2",
          SECTION_LABEL[size],
        )}
      >
        {title}
        {count !== undefined ? <Num className="text-ink-3">{count}</Num> : null}
      </h3>
      {children}
    </section>
  );
}

type MutualSummary<T> = { count: number; items: T[] };

export type MutualServer = {
  id: string;
  name: string;
  icon_url?: string | null;
};
export type MutualFriend = {
  id: string;
  username: string;
  display_name?: string | null;
  avatar_url?: string | null;
  avatar_display?: User["avatar_display"];
};

function Chip({
  media,
  label,
  decorated = false,
}: {
  media: ReactNode;
  label: ReactNode;
  /** The media is an avatar wearing a decoration (see avatarShape). */
  decorated?: boolean;
}) {
  return (
    <li className="flex h-6 min-w-0 max-w-full items-center gap-1.5 rounded-[2px] bg-tint-1 pr-2.5 pl-0.5">
      <span
        className={cn(
          "relative flex size-5 shrink-0 items-center justify-center bg-tint-3 font-display text-[11px] font-extrabold text-ink-1",
          avatarShape(decorated),
        )}
      >
        {media}
      </span>
      <span className="min-w-0 truncate text-ui-sm text-ink-1">{label}</span>
    </li>
  );
}

/** Role chips; with `onRemove` each chip gets a remove button. */
export function ProfileRoleChips({
  roles,
  onRemove,
  trailing,
}: {
  roles: Array<{ id: string; name: string; color?: string | null }>;
  onRemove?: (roleId: string, roleName: string) => void;
  trailing?: ReactNode;
}) {
  return (
    <ul className="flex flex-wrap items-center gap-1.5">
      {roles.map((role) => (
        <li
          key={role.id}
          className="flex h-6 max-w-full items-center gap-1.5 rounded-[2px] bg-tint-1 pr-2.5 pl-2 text-ui-xs font-medium text-ink-1"
        >
          <span
            aria-hidden="true"
            className="size-2.5 shrink-0 rounded-full"
            // User-chosen role colour; ink when the role has none.
            style={{ backgroundColor: role.color || "var(--ink-3)" }}
          />
          <span className="min-w-0 truncate">
            <InlineEmojiText text={role.name} />
          </span>
          {onRemove ? (
            <IconButton
              icon="close"
              size={24}
              variant="muted"
              aria-label={`Remove the ${role.name} role`}
              onClick={() => onRemove(role.id, role.name)}
              className="-mr-2 size-5"
            />
          ) : null}
        </li>
      ))}
      {trailing ? <li className="flex">{trailing}</li> : null}
    </ul>
  );
}

/**
 * The fixed section order. Pass only what's known; empty sections don't
 * render, and Member since needs a real date.
 */
export function ProfileSections({
  bio,
  roles,
  mutualServers,
  mutualFriends,
  memberSince,
  limit = 8,
}: {
  bio?: string | null;
  roles?: ReactNode;
  mutualServers?: MutualSummary<MutualServer> | null;
  mutualFriends?: MutualSummary<MutualFriend> | null;
  memberSince?: { label: string; value: string } | null;
  /** Chips shown per mutuals list. */
  limit?: number;
}) {
  const about = bio?.trim() ?? "";
  return (
    <>
      {about ? (
        <ProfileSection title="About me">
          <p className="max-w-[62ch] text-ui-sm whitespace-pre-line text-pretty break-words text-ink-1">
            {about}
          </p>
        </ProfileSection>
      ) : null}
      {roles ? <ProfileSection title="Roles">{roles}</ProfileSection> : null}
      {mutualServers && mutualServers.count > 0 ? (
        <ProfileSection title="Mutual servers" count={mutualServers.count}>
          <ul className="flex flex-wrap gap-1.5">
            {mutualServers.items.slice(0, limit).map((server) => (
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
        </ProfileSection>
      ) : null}
      {mutualFriends && mutualFriends.count > 0 ? (
        <ProfileSection title="Mutual friends" count={mutualFriends.count}>
          <ul className="flex flex-wrap gap-1.5">
            {mutualFriends.items.slice(0, limit).map((friend) => (
              <Chip
                key={friend.id}
                decorated={isAvatarDecorated(
                  friend.avatar_url && friend.avatar_display,
                )}
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
        </ProfileSection>
      ) : null}
      {memberSince ? (
        <ProfileSection title={memberSince.label}>
          <p className="text-ui-sm text-ink-1">{memberSince.value}</p>
        </ProfileSection>
      ) : null}
    </>
  );
}

/** A neutral strip (not an error): "You blocked Grace…". */
function ProfileNotice({ children }: { children: ReactNode }) {
  return (
    <p
      role="status"
      className={cn(
        "flex items-start gap-2 rounded-md bg-tint-1 px-3 py-2 text-ui-sm text-pretty text-ink-2",
        PROFILE_REVEAL,
      )}
    >
      <Icon name="ban" size="sm" className="mt-px shrink-0 text-ink-3" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/* ------------------------------------------------------------------ */
/* Relationship actions                                                 */
/* ------------------------------------------------------------------ */

/** 0 friend, 1 blocked, 2 incoming, 3 outgoing (see FriendsView). */
export type ProfileRelation =
  | "self"
  | "none"
  | "friend"
  | "blocked"
  | "incoming"
  | "outgoing";

type RelationshipAction = "add" | "remove" | "accept" | "block" | "unblock";
type Busy = RelationshipAction | "message" | "cancel" | "decline";

/** Verb phrases for describeApiError, read after "Unable to". */
const ACTION_COPY: Record<Busy, (name: string) => string> = {
  add: (name) => `send ${name} a friend request`,
  accept: (name) => `accept ${name}'s friend request`,
  decline: (name) => `decline ${name}'s friend request`,
  cancel: (name) => `cancel your friend request to ${name}`,
  remove: (name) => `update your friendship with ${name}`,
  block: (name) => `block ${name}`,
  unblock: (name) => `unblock ${name}`,
  message: (name) => `open your messages with ${name}`,
};

function relationFor(type: number | undefined): ProfileRelation {
  switch (type) {
    case 0:
      return "friend";
    case 1:
      return "blocked";
    case 2:
      return "incoming";
    case 3:
      return "outgoing";
    default:
      return "none";
  }
}

/**
 * Relationship state and actions for one person's card: Message, friend
 * requests, block (behind an inline confirm), copy ID.
 */
export function useProfileActions({
  userId,
  username,
  displayName,
  isMe,
  onMessageOpened,
  initialBlockConfirm = false,
}: {
  userId: string;
  username: string;
  displayName: string;
  isMe: boolean;
  /** After the DM opened and the view switched (close the surface). */
  onMessageOpened?: () => void;
  initialBlockConfirm?: boolean;
}) {
  const relationship = useChatStore((state) =>
    state.relationships.find((entry) => entry.user.id === userId),
  );
  const { openDm, loadRelationships, dispatch } = useChatActions();
  const [busy, setBusy] = useState<Busy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmBlock, setConfirmBlock] = useState(initialBlockConfirm);
  const [blockError, setBlockError] = useState<string | null>(null);
  // Focus goes back to the overflow trigger when the confirm is cancelled.
  const overflowId = useId();
  const relation: ProfileRelation = isMe
    ? "self"
    : relationFor(relationship?.type);

  const run = useCallback(
    async (action: RelationshipAction, label: Busy = action) => {
      setBusy(label);
      setError(null);
      try {
        if (action === "add") {
          await apiPost("/api/friends", { username });
        } else if (action === "accept" || action === "block") {
          await apiPut("/api/friends", { target_user_id: userId, action });
        } else {
          await apiDelete("/api/friends", { target_user_id: userId });
        }
        await loadRelationships();
        return true;
      } catch (cause) {
        const copy = describeApiError(cause, ACTION_COPY[label](displayName));
        if (action === "block") setBlockError(copy);
        else setError(copy);
        return false;
      } finally {
        setBusy(null);
      }
    },
    [displayName, loadRelationships, userId, username],
  );

  const message = useCallback(async () => {
    if (isMe) return;
    setBusy("message");
    setError(null);
    const channelId = await openDm(userId);
    setBusy(null);
    if (!channelId) {
      setError(
        `Unable to open your messages with ${displayName}. Check your connection and try again.`,
      );
      return;
    }
    dispatch({ type: "SWITCH_SERVER", serverId: "@me", channelId });
    onMessageOpened?.();
  }, [dispatch, displayName, isMe, onMessageOpened, openDm, userId]);

  const cancelBlock = useCallback(() => {
    setConfirmBlock(false);
    setBlockError(null);
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>(`[data-profile-overflow="${overflowId}"]`)
        ?.focus(),
    );
  }, [overflowId]);

  const block = useCallback(async () => {
    if (await run("block")) setConfirmBlock(false);
  }, [run]);

  const copyId = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(userId);
    } catch {
      // Clipboard can be unavailable (insecure context); nothing is lost.
    }
  }, [userId]);

  return {
    relation,
    displayName,
    busy,
    error,
    setError,
    confirmBlock,
    askBlock: () => {
      setBlockError(null);
      setConfirmBlock(true);
    },
    cancelBlock,
    block,
    blockError,
    overflowId,
    message,
    add: () => void run("add"),
    accept: () => void run("accept"),
    decline: () => void run("remove", "decline"),
    cancelRequest: () => void run("remove", "cancel"),
    removeFriend: () => void run("remove"),
    unblock: () => void run("unblock"),
    copyId,
  };
}

export type ProfileActionsController = ReturnType<typeof useProfileActions>;

/**
 * The one row of buttons. The primary follows the relationship (overlays
 * issue 10):
 *
 *   friend            Message                    overflow: Remove friend
 *   incoming          Accept, Message, Decline (ghost)
 *   outgoing          Message, Cancel request
 *   none              Message, Add friend
 *   blocked           Unblock (no primary) and the neutral strip
 *   error             Try again only
 */
export function ProfileActionRow({
  controller,
  size,
  loadError,
  onRetry,
  selfAction,
  extra,
}: {
  controller: ProfileActionsController;
  size: ProfileCardSize;
  /** The profile failed to load: Try again is the only action. */
  loadError?: boolean;
  onRetry?: () => void;
  /** Your own card (Edit profile). */
  selfAction?: ReactNode;
  /** Extra secondary buttons after the relationship ones (Call). */
  extra?: ReactNode;
}) {
  const c = controller;
  const buttonSize = size === "sheet" ? "lg" : "md";
  const pending = c.busy !== null;
  const lock = (key: Busy) => pending && c.busy !== key;
  // With a secondary beside it (Add friend, Call, Cancel request), the
  // primary spans the row and the secondaries share the next one with the
  // overflow key. Three keys never fit a popover or a 360 sheet in one
  // row, and wrapping left the "..." alone on a line of its own.
  const hasSecondary =
    c.relation === "incoming" ||
    c.relation === "outgoing" ||
    c.relation === "none" ||
    (c.relation === "friend" && Boolean(extra));
  const primaryClass = hasSecondary ? "basis-full!" : "max-md:flex-1";

  if (loadError && onRetry) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size={buttonSize} onClick={onRetry}>
          <Icon name="refresh" size="sm" />
          Try again
        </Button>
      </div>
    );
  }

  if (c.relation === "self") {
    return selfAction ? (
      <div className="flex flex-wrap items-center gap-2">{selfAction}</div>
    ) : null;
  }

  const messageButton = (variant: "primary" | "secondary") => (
    <Button
      variant={variant}
      size={buttonSize}
      className={variant === "primary" ? primaryClass : undefined}
      loading={c.busy === "message"}
      disabled={lock("message")}
      onClick={() => void c.message()}
    >
      <Icon name="chat" size="sm" />
      Message
    </Button>
  );

  let buttons: ReactNode;
  switch (c.relation) {
    case "friend":
      buttons = messageButton("primary");
      break;
    case "incoming":
      buttons = (
        <>
          <Button
            size={buttonSize}
            className={primaryClass}
            loading={c.busy === "accept"}
            disabled={lock("accept")}
            onClick={c.accept}
          >
            <Icon name="check" size="sm" />
            Accept
          </Button>
          {messageButton("secondary")}
          <Button
            variant="ghost"
            size={buttonSize}
            loading={c.busy === "decline"}
            disabled={lock("decline")}
            onClick={c.decline}
          >
            Decline
          </Button>
        </>
      );
      break;
    case "outgoing":
      buttons = (
        <>
          {messageButton("primary")}
          <Button
            variant="secondary"
            size={buttonSize}
            loading={c.busy === "cancel"}
            disabled={lock("cancel")}
            onClick={c.cancelRequest}
          >
            Cancel request
          </Button>
        </>
      );
      break;
    case "blocked":
      buttons = (
        <Button
          variant="secondary"
          size={buttonSize}
          loading={c.busy === "unblock"}
          disabled={lock("unblock")}
          onClick={c.unblock}
        >
          Unblock
        </Button>
      );
      break;
    default:
      buttons = (
        <>
          {messageButton("primary")}
          <Button
            variant="secondary"
            size={buttonSize}
            loading={c.busy === "add"}
            disabled={lock("add")}
            onClick={c.add}
          >
            <Icon name="invite" size="sm" />
            Add friend
          </Button>
        </>
      );
  }

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2",
        hasSecondary && "[&>*:not([data-profile-overflow])]:flex-1",
      )}
    >
      {buttons}
      {c.relation !== "blocked" ? extra : null}
      <ProfileOverflow controller={c} size={size} />
    </div>
  );
}

/** Copy ID, Block, Remove friend. A menu on desktop, an action sheet on phones. */
function ProfileOverflow({
  controller: c,
  size,
}: {
  controller: ProfileActionsController;
  size: ProfileCardSize;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const canBlock = c.relation !== "blocked";
  const canRemove = c.relation === "friend";
  const label = `More actions for ${c.displayName}`;
  // Matches the sheet's 48px (lg) action keys.
  const triggerSize = size === "sheet" ? "lg" : 32;

  if (size === "sheet") {
    const items: ActionSheetItem[] = [
      {
        key: "copy",
        label: "Copy user ID",
        icon: <Icon name="copyId" size="md" />,
        onClick: () => void c.copyId(),
      },
      ...(canRemove
        ? [
            {
              key: "remove",
              label: "Remove friend",
              icon: <Icon name="userRemove" size="md" />,
              variant: "danger" as const,
              onClick: c.removeFriend,
            },
          ]
        : []),
      ...(canBlock
        ? [
            {
              key: "block",
              label: "Block",
              icon: <Icon name="ban" size="md" />,
              variant: "danger" as const,
              onClick: c.askBlock,
            },
          ]
        : []),
    ];
    return (
      <>
        <IconButton
          data-profile-overflow={c.overflowId}
          icon="more"
          size={triggerSize}
          variant="ghost"
          className="bg-tint-1"
          aria-label={label}
          onClick={() => setSheetOpen(true)}
        />
        <ActionSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          items={items}
          title={label}
        />
      </>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <IconButton
            data-profile-overflow={c.overflowId}
            icon="more"
            size={triggerSize}
            variant="ghost"
            className="bg-tint-1"
            aria-label={label}
          />
        }
      />
      {/* Opened from a dialog or popover: the layer above it. */}
      <DropdownMenuContent align="end" stacked aria-label={label}>
        <DropdownMenuItem
          icon={<Icon name="copyId" size="sm" />}
          onClick={() => void c.copyId()}
        >
          Copy user ID
        </DropdownMenuItem>
        {canRemove || canBlock ? <DropdownMenuSeparator /> : null}
        {canRemove ? (
          <DropdownMenuItem
            variant="danger"
            icon={<Icon name="userRemove" size="sm" />}
            onClick={c.removeFriend}
          >
            Remove friend
          </DropdownMenuItem>
        ) : null}
        {canBlock ? (
          <DropdownMenuItem
            variant="danger"
            icon={<Icon name="ban" size="sm" />}
            onClick={c.askBlock}
          >
            Block
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Notices for the action row: the blocked strip and the last action error.
 * Render right under the actions.
 */
export function ProfileActionNotices({
  controller: c,
}: {
  controller: ProfileActionsController;
}) {
  return (
    <>
      {c.relation === "blocked" ? (
        <ProfileNotice>
          You blocked {c.displayName}. They can&apos;t message you or send
          requests.
        </ProfileNotice>
      ) : null}
      {c.error ? <RowError className="mt-0">{c.error}</RowError> : null}
    </>
  );
}

/** The block confirm, at the bottom of the card. */
export function ProfileBlockConfirm({
  controller: c,
}: {
  controller: ProfileActionsController;
}) {
  if (!c.confirmBlock || c.relation === "blocked" || c.relation === "self") {
    return null;
  }
  return (
    <div className={cn("@container", PROFILE_REVEAL)}>
      <ConfirmStrip
        consequence={`Block ${c.displayName}? They'll be removed from your friends and can't send you friend requests. You can unblock them later.`}
        confirmLabel={`Block ${c.displayName}`}
        onConfirm={() => void c.block()}
        onCancel={c.cancelBlock}
        busy={c.busy === "block"}
        error={c.blockError}
      />
    </div>
  );
}
