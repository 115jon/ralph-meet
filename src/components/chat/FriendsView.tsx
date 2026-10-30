import { getDisplayName } from "@/lib/display-name";
import { CountBadge } from "@/components/ui/badge";
import { ButtonBase } from "@/components/ui/button-base";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/IconButton";
import { Input } from "@/components/ui/input";
import { HIT } from "@/components/ui/interaction";
import { Label } from "@/components/ui/label";
import { Num } from "@/components/ui/num";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import {
  ROW_ACTION_BUTTON,
  ROW_ACTIONS,
  ROW_NAME_FADE,
  sidebarRowClass,
  TREE_BRANCH_GAP,
  TREE_BRANCH_LABEL,
} from "@/components/ui/sidebar-row";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, tabId } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useContextMenu } from "@/hooks/useContextMenu";
import {
  LONG_PRESS_TARGET,
  toContextMenuEvent,
  useLongPress,
} from "@/hooks/useLongPress";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { apiDelete, apiPost, apiPut } from "@/lib/api-client";
import { describeApiError } from "@/lib/api-errors";
import type { Relationship } from "@/lib/types";
import { cn } from "@/lib/utils";
import { normalizeUserStatus, UserStatusDot } from "./UserStatusDot";
import { useChatActions, useChatStore } from "@/stores/chat-store";
import { useCallStore } from "@/stores/useCallStore";
import {
  useCallback,
  useEffect,
  useId,
  useReducer,
  useRef,
  useState,
} from "react";
import { useShallow } from "zustand/shallow";
import ContextMenu from "./ContextMenu";
import { MiniAvatar } from "./MiniAvatar";
import { Icon, type IconName } from "@/components/ui/icon";
import { UserDisplayName } from "./UserDisplayName";
import UserProfilePopover from "./UserProfilePopover";

type Tab = "online" | "all" | "pending" | "blocked";
const FRIEND_TABS: readonly Tab[] = ["online", "all", "pending", "blocked"];
const TAB_LABEL: Record<Tab, string> = {
  online: "Online",
  all: "All",
  pending: "Pending",
  blocked: "Blocked",
};
const LIST_LABEL: Record<Tab, string> = {
  online: "Online",
  all: "All friends",
  pending: "Pending",
  blocked: "Blocked",
};
const EMPTY: Record<Tab, { title: string; body?: string }> = {
  online: { title: "No friends online" },
  all: {
    title: "No friends yet",
    body: "Add a friend by their username to start a conversation.",
  },
  pending: { title: "No pending requests" },
  blocked: { title: "No blocked users" },
};

type AddStatus = { kind: "success" | "error"; message: string } | null;

/**
 * Below this column width the tabs don't fit beside the title and Add friend
 * (the md column beside the channel list and member panel is ~456px), so
 * they move to their own scrollable strip, as on phones (N3).
 */
const INLINE_TABS_MIN_WIDTH = 560;

/** True while the element is narrower than `min` (a JS container query). */
function useNarrowerThan(
  ref: React.RefObject<HTMLElement | null>,
  min: number,
) {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? el.clientWidth;
      // 0 means not laid out yet (hidden tab, jsdom); keep the last answer.
      if (width > 0) setNarrow(width < min);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, min]);
  return narrow;
}

/** A pending remove/reject/cancel, confirmed in a ResponsiveDialog. */
type RemoveTarget = { user: any; relType: number } | null;

interface FriendsViewState {
  tab: Tab;
  loading: boolean;
  addFriendMode: boolean;
  addUsername: string;
  addStatus: AddStatus;
  popoverUser: any | null;
  popoverAnchor: HTMLElement | null;
}

type FVAction =
  | { type: "SET_TAB"; value: Tab }
  | { type: "SET_LOADING"; value: boolean }
  | { type: "SET_ADD_FRIEND_MODE"; value: boolean }
  | { type: "SET_ADD_USERNAME"; value: string }
  | { type: "SET_ADD_STATUS"; value: AddStatus }
  | { type: "SET_POPOVER"; user: any; anchor: HTMLElement | null };

function fvReducer(s: FriendsViewState, a: FVAction): FriendsViewState {
  switch (a.type) {
    case "SET_TAB":
      return { ...s, tab: a.value };
    case "SET_LOADING":
      return { ...s, loading: a.value };
    case "SET_ADD_FRIEND_MODE":
      return { ...s, addFriendMode: a.value };
    case "SET_ADD_USERNAME":
      return { ...s, addUsername: a.value };
    case "SET_ADD_STATUS":
      return { ...s, addStatus: a.value };
    case "SET_POPOVER":
      return { ...s, popoverUser: a.user, popoverAnchor: a.anchor };
    default:
      return s;
  }
}

/**
 * The second line of a friend row: the person's custom status, if they set
 * one. Presence is already the dot, and the branch label says what kind of
 * request a row is, so a row without a custom status stays one line.
 */
function statusLine(rel: Relationship): string | null {
  if (rel.type !== 0) return null;
  const text = rel.user.custom_status?.trim();
  return text ? text : null;
}

/**
 * Add-friend failures in the person's terms. The server's own strings are
 * log copy, so map the statuses /api/friends returns: 404 unknown username,
 * 400 yourself, 409 already friends / blocked / request pending.
 */
function addFriendError(err: unknown) {
  const status = (err as { status?: unknown } | null)?.status;
  if (status === 404)
    return "No one has that username. Check the spelling and try again.";
  if (status === 400) return "You can't add yourself.";
  if (status === 409)
    return "You're already friends, have a request pending, or blocked this person.";
  return describeApiError(err, "send that friend request");
}

/** Remove (friend), Reject (incoming) or Cancel (outgoing). */
function removeCopy(relType: number) {
  if (relType === 0)
    return {
      action: "Remove friend",
      title: "Remove friend",
      body: (name: string) =>
        `${name} will be removed from your friends. You can send a new request later.`,
      confirm: "Remove",
    };
  if (relType === 2)
    return {
      action: "Ignore",
      title: "Ignore request",
      body: (name: string) => `Ignore the friend request from ${name}?`,
      confirm: "Ignore",
    };
  return {
    action: "Cancel",
    title: "Cancel request",
    body: (name: string) => `Cancel your friend request to ${name}?`,
    confirm: "Cancel request",
  };
}

interface Props {
  onMenuClick: () => void;
  onSelectDm: (channelId: string) => void;
  /** Tab to open on (fixtures and deep links); defaults to Online. */
  initialTab?: Tab;
}

export default function FriendsView({
  onMenuClick,
  onSelectDm,
  initialTab = "online",
}: Props) {
  const { relationships } = useChatStore(
    useShallow((s) => ({
      relationships: s.relationships,
    })),
  );
  const { loadRelationships, openDm, setProfileUser } = useChatActions();
  const { menu, openMenu, closeMenu, shouldRender, isClosing } =
    useContextMenu();
  const isMobile = useIsMobile();
  const rootRef = useRef<HTMLDivElement>(null);
  const narrow = useNarrowerThan(rootRef, INLINE_TABS_MIN_WIDTH);
  // Tabs leave the header on phones and in narrow columns (768 with panels).
  const tabsInStrip = isMobile || narrow;
  const addStatusId = useId();

  const [state, dispatch] = useReducer(fvReducer, {
    tab: initialTab,
    loading: false,
    addFriendMode: false,
    addUsername: "",
    addStatus: null,
    popoverUser: null,
    popoverAnchor: null,
  });
  const [removeTarget, setRemoveTarget] = useState<RemoveTarget>(null);
  const [removing, setRemoving] = useState(false);

  const {
    tab,
    loading,
    addFriendMode,
    addUsername,
    addStatus,
    popoverUser,
    popoverAnchor,
  } = state;

  const fetchFriends = useCallback(async () => {
    dispatch({ type: "SET_LOADING", value: true });
    await loadRelationships();
    dispatch({ type: "SET_LOADING", value: false });
  }, [loadRelationships]);

  useEffect(() => {
    fetchFriends();
  }, [fetchFriends]);

  const handleAddFriend = useCallback(async () => {
    if (!addUsername.trim()) {
      dispatch({
        type: "SET_ADD_STATUS",
        value: { kind: "error", message: "Enter a username." },
      });
      return;
    }
    try {
      const data = await apiPost<{ type?: number }>("/api/friends", {
        username: addUsername.trim(),
      });
      dispatch({
        type: "SET_ADD_STATUS",
        value: {
          kind: "success",
          message: data.type === 0 ? "Friend added." : "Friend request sent.",
        },
      });
      dispatch({ type: "SET_ADD_USERNAME", value: "" });
      fetchFriends();
    } catch (err) {
      dispatch({
        type: "SET_ADD_STATUS",
        value: {
          kind: "error",
          message: addFriendError(err),
        },
      });
    }
  }, [addUsername, fetchFriends]);

  const handleAcceptFriend = useCallback(
    async (targetUserId: string) => {
      await apiPut("/api/friends", {
        target_user_id: targetUserId,
        action: "accept",
      });
      fetchFriends();
    },
    [fetchFriends],
  );

  const confirmRemove = useCallback(async () => {
    if (!removeTarget) return;
    setRemoving(true);
    try {
      await apiDelete("/api/friends", { target_user_id: removeTarget.user.id });
      setRemoveTarget(null);
      fetchFriends();
    } finally {
      setRemoving(false);
    }
  }, [removeTarget, fetchFriends]);

  const handleOpenDm = useCallback(
    async (targetUserId: string) => {
      const channelId = await openDm(targetUserId);
      if (channelId) onSelectDm(channelId);
    },
    [openDm, onSelectDm],
  );

  const handleFriendContextMenu = (
    e: React.MouseEvent,
    friend: any,
    relType: number,
  ) => {
    // Check if we should hide the call option (already in call or ringing this user)
    const callState = useCallStore.getState();
    const dmChannels = useChatStore.getState().dmChannels;
    const dmForUser = dmChannels.find(
      (d: any) => d.recipient?.id === friend.id,
    );

    const isRingingThisUser =
      callState.status === "ringing_outgoing" &&
      callState.remoteUser?.id === friend.id;
    const isInCallWithUser =
      callState.status === "active" &&
      dmForUser &&
      callState.channelId === dmForUser.id &&
      callState.hasJoinedSFU;
    const hideCallOption = isRingingThisUser || isInCallWithUser;

    openMenu(e, [
      {
        label: "Profile",
        icon: <Icon name="members" size="sm" />,
        onClick: () => setProfileUser(friend),
      },
      {
        label: "Message",
        icon: <Icon name="chat" size="sm" />,
        onClick: () => handleOpenDm(friend.id),
      },
      ...(!hideCallOption
        ? [
            {
              label: "Start a call",
              icon: <Icon name="call" size="sm" />,
              onClick: async () => {
                const channelId = dmForUser?.id ?? (await openDm(friend.id));
                if (channelId) {
                  onSelectDm(channelId);
                  window.dispatchEvent(
                    new CustomEvent("request-start-call", {
                      detail: {
                        userId: friend.id,
                        displayName: friend.display_name ?? friend.username,
                        channelId,
                      },
                    }),
                  );
                }
              },
            },
          ]
        : []),
      ...(relType !== 1
        ? [
            {
              label: removeCopy(relType).action,
              icon: <Icon name="close" size="sm" />,
              onClick: () => setRemoveTarget({ user: friend, relType }),
              variant: "danger" as const,
            },
          ]
        : []),
    ]);
  };

  // Long-press on touch opens the same menu as right-click (9.5).
  const bindLongPress = useLongPress<{ user: any; relType: number }>(
    (info, rel) =>
      handleFriendContextMenu(toContextMenuEvent(info), rel.user, rel.relType),
  );

  const filteredFriends = relationships.filter((f) => {
    if (tab === "online") return f.type === 0 && f.user.status === "online";
    if (tab === "all") return f.type === 0;
    if (tab === "pending") return f.type === 2 || f.type === 3;
    if (tab === "blocked") return f.type === 1;
    return false;
  });

  // Pending splits into what needs you (Incoming) and what waits on them
  // (Sent); the other tabs are one branch.
  const branches: Array<{ id: string; label: string; rows: Relationship[] }> =
    tab === "pending"
      ? [
          {
            id: "incoming",
            label: "Incoming",
            rows: filteredFriends.filter((f) => f.type === 2),
          },
          {
            id: "sent",
            label: "Sent",
            rows: filteredFriends.filter((f) => f.type === 3),
          },
        ].filter((b) => b.rows.length > 0)
      : [{ id: tab, label: LIST_LABEL[tab], rows: filteredFriends }];

  const pendingCount = relationships.filter((f) => f.type === 2).length;

  const toggleAddFriend = () =>
    dispatch({ type: "SET_ADD_FRIEND_MODE", value: !addFriendMode });

  // One tab list, placed inline in the header on desktop and in its own
  // swipeable strip under the header on phones and narrow columns (it doesn't
  // fit beside the title at 390, or in the 456px column at 768).
  const tabs = (
    <Tabs
      label="Friends"
      idBase="friends"
      panelId="friends-panel"
      scrollable
      className={
        tabsInStrip ? "h-11 gap-6 px-4" : "h-full min-w-0 self-stretch"
      }
      value={tab}
      onValueChange={(t) => dispatch({ type: "SET_TAB", value: t })}
      items={FRIEND_TABS.map((t) => ({
        value: t,
        label: TAB_LABEL[t],
        // Incoming requests need you, so they earn the count badge; totals
        // never do (spec §7 Count badge).
        adornment:
          t === "pending" && pendingCount > 0 ? (
            <CountBadge count={pendingCount} />
          ) : undefined,
      }))}
    />
  );

  const empty = EMPTY[tab];
  const removal = removeTarget ? removeCopy(removeTarget.relType) : null;

  const askRemove = (rel: Relationship) =>
    setRemoveTarget({ user: rel.user, relType: rel.type });

  const renderRow = (rel: Relationship) => {
    const displayName = getDisplayName(rel.user);
    const status = statusLine(rel);
    const incoming = rel.type === 2;
    // Friends and sent requests keep their actions in a hover overlay;
    // incoming requests always show Accept and Ignore.
    const hoverActions = rel.type === 0 || rel.type === 3;
    return (
      <li
        key={rel.user.id}
        data-testid="friend-row"
        className={cn(
          sidebarRowClass({ tall: !!status }),
          "gap-2.5",
          LONG_PRESS_TARGET,
        )}
        style={
          rel.type === 3
            ? ({ "--row-actions-w": "28px" } as React.CSSProperties)
            : undefined
        }
      >
        <ButtonBase
          onClick={() => handleOpenDm(rel.user.id)}
          onContextMenu={(e) => handleFriendContextMenu(e, rel.user, rel.type)}
          {...bindLongPress({ user: rel.user, relType: rel.type })}
          aria-label={`Message ${displayName}`}
          className="absolute inset-0 z-10 rounded-sm outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
        />
        <ButtonBase
          className={cn(
            "relative z-20 shrink-0 cursor-pointer rounded-avatar outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus",
            HIT,
          )}
          onClick={(e) => {
            e.stopPropagation();
            dispatch({
              type: "SET_POPOVER",
              user: rel.user,
              anchor: e.currentTarget,
            });
          }}
          aria-label={`View ${displayName}'s profile`}
        >
          <MiniAvatar
            avatarUrl={rel.user.avatar_url}
            avatarDisplay={rel.user.avatar_display}
            displayName={rel.user.display_name}
            username={rel.user.username}
            size={24}
          />
          {rel.type !== 1 && (
            <UserStatusDot
              status={normalizeUserStatus(rel.user.status)}
              ring="bg-ply-0"
              className="absolute -right-1 -bottom-1 size-3"
            />
          )}
        </ButtonBase>

        <div
          className={cn(
            "flex min-w-0 flex-1 flex-col",
            hoverActions && ROW_NAME_FADE,
          )}
        >
          <UserDisplayName
            user={rel.user}
            className="block truncate text-ui-row font-medium"
          />
          {status && (
            <span className="block truncate text-ui-xs font-normal text-ink-3">
              {status}
            </span>
          )}
        </div>

        {incoming && (
          <div className="relative z-20 flex shrink-0 items-center gap-1">
            <Button
              size="sm"
              variant="secondary"
              onClick={(e) => {
                e.stopPropagation();
                void handleAcceptFriend(rel.user.id);
              }}
              aria-label={`Accept ${displayName}`}
            >
              Accept
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-ink-2"
              onClick={(e) => {
                e.stopPropagation();
                askRemove(rel);
              }}
              aria-label={`Ignore ${displayName}`}
            >
              Ignore
            </Button>
          </div>
        )}

        {hoverActions && (
          <div className={ROW_ACTIONS}>
            {rel.type === 0 && (
              <RowAction
                icon="chat"
                label="Message"
                onClick={() => handleOpenDm(rel.user.id)}
              />
            )}
            <RowAction
              icon="close"
              label={removeCopy(rel.type).action}
              tone="danger"
              onClick={() => askRemove(rel)}
            />
          </div>
        )}
      </li>
    );
  };

  return (
    <div
      ref={rootRef}
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-ply-0"
    >
      {/* Header: 48px + safe area, the same bar as the chat header. */}
      <header
        data-testid="friends-header"
        className="z-20 flex h-[calc(48px+var(--safe-area-top,0px))] shrink-0 items-center gap-2 border-b border-line bg-ply-0 px-4 pt-[var(--safe-area-top,0px)] max-md:pl-2"
      >
        <IconButton
          icon="menu"
          variant="muted"
          size="md"
          className="md:hidden"
          aria-label="Open sidebar"
          onClick={onMenuClick}
        />

        <Icon
          name="members"
          size="lg"
          className="shrink-0 text-ink-3 max-md:hidden"
        />
        <h1 className="shrink-0 text-ui-xl font-semibold whitespace-nowrap text-ink-1 max-md:text-ui-md">
          Friends
        </h1>

        {!tabsInStrip && (
          <>
            <div aria-hidden className="mx-2 h-5 w-px shrink-0 bg-line" />
            {tabs}
          </>
        )}

        <div className="ml-auto flex shrink-0 items-center">
          {isMobile ? (
            <IconButton
              icon="invite"
              size="md"
              variant="ghost"
              aria-label="Add friend"
              aria-pressed={addFriendMode}
              onClick={toggleAddFriend}
            />
          ) : (
            // The page's one primary action; it steps back to secondary while
            // its form is open, so Send request is the primary then.
            <Button
              variant={addFriendMode ? "secondary" : "primary"}
              size="sm"
              aria-pressed={addFriendMode}
              onClick={toggleAddFriend}
            >
              <Icon name="invite" size="sm" />
              Add friend
            </Button>
          )}
        </div>
      </header>

      {tabsInStrip && (
        <div
          data-testid="friends-tab-strip"
          className="shrink-0 border-b border-line"
        >
          {tabs}
        </div>
      )}

      {/* Add friend form */}
      {addFriendMode && (
        <form
          className="flex shrink-0 flex-col gap-1.5 border-b border-line px-4 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            void handleAddFriend();
          }}
        >
          <Label htmlFor="friend-username">Add friend</Label>
          <p className="text-ui-sm text-ink-2">
            You can add friends by their username.
          </p>
          <div className="mt-1 flex max-w-lg gap-2">
            <Input
              id="friend-username"
              name="username"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              className="flex-1 max-md:min-h-11 max-md:text-ui-md"
              placeholder="Enter a username"
              value={addUsername}
              aria-invalid={addStatus?.kind === "error" || undefined}
              aria-describedby={addStatus ? addStatusId : undefined}
              onChange={(e) => {
                dispatch({ type: "SET_ADD_USERNAME", value: e.target.value });
                if (addStatus?.kind === "error")
                  dispatch({ type: "SET_ADD_STATUS", value: null });
              }}
            />
            <Button type="submit" className="max-md:min-h-11">
              Send request
            </Button>
          </div>
          <p
            id={addStatusId}
            role="status"
            className={cn(
              "min-h-4 text-ui-xs",
              addStatus?.kind === "error"
                ? "text-danger-ink"
                : "text-success-ink",
            )}
          >
            {addStatus?.message}
          </p>
        </form>
      )}

      {/* Friends list: rows share the member / DM row anatomy, capped at
          720 so hover tints don't span the window. */}
      <div
        id="friends-panel"
        role="tabpanel"
        aria-labelledby={tabId("friends", tab)}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain custom-scrollbar"
      >
        <div className="max-w-[720px] px-2 pb-4">
          {loading && filteredFriends.length === 0 && (
            <div role="status" className="flex flex-col gap-0.5 pt-2">
              <span className="sr-only">Loading friends</span>
              <div aria-hidden className="flex h-6 items-center px-2">
                <Skeleton className="h-2.5 w-16 rounded-xs!" />
              </div>
              {[36, 24, 30].map((w) => (
                <div
                  key={w}
                  aria-hidden
                  className="flex h-8 items-center gap-2.5 px-2"
                >
                  <Skeleton className="size-6 shrink-0 rounded-avatar" />
                  <Skeleton
                    className="h-3 rounded-xs!"
                    style={{ width: `${w}%` }}
                  />
                </div>
              ))}
            </div>
          )}

          {!loading && filteredFriends.length === 0 && (
            <EmptyState
              title={empty.title}
              description={empty.body}
              className="py-16"
              action={
                tab === "all" && !addFriendMode ? (
                  <Button variant="secondary" onClick={toggleAddFriend}>
                    Add friend
                  </Button>
                ) : undefined
              }
            />
          )}

          {filteredFriends.length > 0 &&
            branches.map((branch) => {
              const labelId = `friends-branch-${branch.id}`;
              return (
                <section
                  key={branch.id}
                  aria-labelledby={labelId}
                  className={TREE_BRANCH_GAP}
                >
                  <h2 id={labelId} className={TREE_BRANCH_LABEL}>
                    <span className="truncate">{branch.label}</span>
                    <Num className="text-ink-3">{branch.rows.length}</Num>
                  </h2>
                  <ul className="flex flex-col gap-0.5 pt-0.5">
                    {branch.rows.map(renderRow)}
                  </ul>
                </section>
              );
            })}
        </div>
      </div>

      <ResponsiveDialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open && !removing) setRemoveTarget(null);
        }}
      >
        <ResponsiveDialogContent className="md:max-w-sm">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{removal?.title}</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              {removeTarget && removal
                ? removal.body(getDisplayName(removeTarget.user))
                : null}
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <ResponsiveDialogFooter>
            <Button
              variant="secondary"
              disabled={removing}
              onClick={() => setRemoveTarget(null)}
            >
              Keep
            </Button>
            <Button
              variant="danger"
              loading={removing}
              onClick={() => void confirmRemove()}
            >
              {removal?.confirm}
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {shouldRender && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menu.items}
          onClose={closeMenu}
          isClosing={isClosing}
        />
      )}

      {popoverUser && popoverAnchor && (
        <UserProfilePopover
          userId={popoverUser.id}
          username={popoverUser.username}
          displayName={popoverUser.display_name}
          avatarUrl={popoverUser.avatar_url}
          avatarDisplay={popoverUser.avatar_display}
          seedUser={popoverUser}
          anchorEl={popoverAnchor}
          side="right"
          onClose={() =>
            dispatch({ type: "SET_POPOVER", user: null, anchor: null })
          }
        />
      )}
    </div>
  );
}

/** A 24px action in a row's hover overlay, named by its tooltip. */
function RowAction({
  icon,
  label,
  tone,
  onClick,
}: {
  icon: IconName;
  label: string;
  tone?: "danger";
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={(e) => {
            e.stopPropagation();
            onClick();
          }}
          className={cn(
            ROW_ACTION_BUTTON,
            tone === "danger" &&
              "pointer-fine:hover:bg-danger-tint pointer-fine:hover:text-danger-ink",
          )}
        >
          <Icon name={icon} size="sm" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">
        <p>{label}</p>
      </TooltipContent>
    </Tooltip>
  );
}
