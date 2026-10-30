import { LONG_PRESS_TARGET, useLongPressMenu } from "@/hooks/useLongPress";
import { useContextMenu } from "@/hooks/useContextMenu";
import { useSpeakingAttr } from "@/hooks/useIsSpeaking";
import { apiPatch } from "@/lib/api-client";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { getAuthAssetUrl, getMediaUrl } from "@/lib/platform";
import {
  isVoiceMemberReconnecting,
  shouldShowVoiceMemberStreamState,
} from "@/lib/voice-presence";
import { resolveVoiceIdentity } from "@/lib/voice-identity";
import type {
  Category,
  Channel,
  User,
  VoiceChannelStatusMedia,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import type { VoiceChannelMember } from "@/stores/chat-store";
import { useChatActions, useChatStore } from "@/stores/chat-store";
import { useActivityStore } from "@/stores/useActivityStore";
import { useVoiceSettingsStore } from "@/stores/useVoiceSettingsStore";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Icon } from "@/components/ui/icon";
import { DISABLED, HIT, PRESS } from "@/components/ui/interaction";
import { Spinner } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { CountBadge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Led } from "@/components/ui/led";
import { Num, NumClock } from "@/components/ui/num";
import { ThemeBanner } from "@/components/ui/theme-slots";
import { TreeBranch, TreeLeaf, useAnimateEnter } from "@/components/ui/tree";
import { useAppActive } from "@/hooks/useAppActive";
import { copyToClipboard } from "@/components/ui/toast";
import {
  OCCUPANT_ROW,
  ROW_ACTION_BUTTON,
  ROW_ACTIONS,
  ROW_META_SWAP,
  ROW_NAME_FADE,
  SIDEBAR_ICON_SLOT,
  SIDEBAR_UNREAD_PILL,
  TREE_BRANCH_GAP,
  TREE_BRANCH_LABEL,
  sidebarRowClass,
} from "@/components/ui/sidebar-row";
import { getChannelIcon } from "@/lib/channel-icon";

import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import ChannelInviteModal from "./ChannelInviteModal";
import ChannelSettingsModal from "./ChannelSettingsModal";
import ContextMenu from "./ContextMenu";
import CreateCategoryModal from "./CreateCategoryModal";
import CreateChannelModal from "./CreateChannelModal";
import { AvatarImage } from "./AvatarImage";
import { avatarShape } from "@/components/ui/avatar-shape";
import { UserDisplayName } from "./UserDisplayName";
import UserProfilePopover from "./UserProfilePopover";
import { VoiceStreamHoverCard } from "./VoiceStreamHoverCard";
import VoiceChannelMediaStatusModal from "./VoiceChannelMediaStatusModal";
import VoiceChannelTextStatusModal from "./VoiceChannelTextStatusModal";
import InlineEmojiText from "./InlineEmojiText";
import { ListenTogetherSidebarStatus } from "./ListenTogetherSidebarStatus";

const StreamContextMenu = lazy(() =>
  import("../StreamContextMenu").then((mod) => ({
    default: mod.StreamContextMenu,
  })),
);
const EMPTY_STREAM_THUMBNAILS: Record<string, string> = {};

const EMPTY_CATEGORIES: Category[] = [];
const EMPTY_READ_STATES: Record<string, string> = {};
const EMPTY_LAST_MESSAGE_AT: Record<string, string> = {};
const EMPTY_VOICE_STATES: Record<string, VoiceChannelMember[]> = {};
const EMPTY_MENTION_COUNTS: Record<string, number> = {};
const STREAM_PREVIEW_CARD_WIDTH = 292;
const STREAM_PREVIEW_CARD_HEIGHT = 290;

interface Props {
  channels: Channel[];
  categories?: Category[];
  activeChannelId: string | null;
  serverId: string | null;
  serverName: string;
  currentUserId?: string | null;
  onSelect: (channelId: string) => void;
  onInviteClick?: () => void;
  onSettingsClick?: () => void;
  readStates?: Record<string, string>;
  lastMessageAt?: Record<string, string>;
  voiceChannelStates?: Record<string, VoiceChannelMember[]>;
  localVoiceChannelId?: string | null;
  localVoiceConnected?: boolean;
  localVoiceSessionId?: string | null;
  localVoiceRoomSlug?: string | null;
  channelMentionCounts?: Record<string, number>;
  streamPreviewChannelId?: string | null;
  streamThumbnails?: Record<string, string>;
  onWatchStream?: (channelId: string, userId: string) => void;
  canReorder?: boolean;
  canManageChannels?: boolean;
}

interface VoiceMemberContextMenuTarget {
  x: number;
  y: number;
  target: {
    id: string;
    username: string;
    display_name?: string | null;
    avatar_url?: string | null;
    avatar_display?: User["avatar_display"];
  };
}

function isUnread(
  channelId: string,
  readStates: Record<string, string>,
  lastMessageAt: Record<string, string>,
): boolean {
  const lastMsg = lastMessageAt[channelId];
  if (!lastMsg) return false;
  const lastRead = readStates[channelId];
  if (!lastRead) return true;
  return lastMsg > lastRead;
}

interface CategoryGroup {
  id: string | null;
  name: string;
  channels: Channel[];
}

function groupChannelsByCategory(
  channels: Channel[],
  categories: Category[],
): CategoryGroup[] {
  const groups: CategoryGroup[] = [];
  const catMap = new Map<string, Category>();
  for (const cat of categories) {
    catMap.set(cat.id, cat);
  }

  // 1. Uncategorized channels (sorted by position)
  const uncategorizedText = channels
    .filter((c) => !c.category_id && c.channel_type === "text")
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const uncategorizedVoice = channels
    .filter((c) => !c.category_id && c.channel_type === "voice")
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  if (uncategorizedText.length > 0) {
    groups.push({
      id: "__uncategorized_text__",
      name: "TEXT CHANNELS",
      channels: uncategorizedText,
    });
  }
  if (uncategorizedVoice.length > 0) {
    groups.push({
      id: "__uncategorized_voice__",
      name: "VOICE CHANNELS",
      channels: uncategorizedVoice,
    });
  }

  // 2. Scheduled/Sorted categories
  const byCategory = new Map<string, Channel[]>();
  for (const ch of channels) {
    if (ch.category_id && catMap.has(ch.category_id)) {
      const list = byCategory.get(ch.category_id) ?? [];
      list.push(ch);
      byCategory.set(ch.category_id, list);
    }
  }

  const sortedCats = categories.toSorted((a, b) => a.rank - b.rank);
  for (const cat of sortedCats) {
    const chans = (byCategory.get(cat.id) ?? []).sort(
      (a, b) => (a.position ?? 0) - (b.position ?? 0),
    );
    groups.push({ id: cat.id, name: cat.name, channels: chans });
  }

  return groups;
}

// ── Sortable Channel Item ──────────────────────────────────────────────────

type VoiceMemberTarget = {
  id: string;
  username: string;
  display_name?: string | null;
  avatar_url?: string | null;
  avatar_display?: User["avatar_display"];
};

interface SortableChannelItemProps {
  channel: Channel;
  isActive: boolean;
  unread: boolean;
  mentionCount: number;
  isVoice: boolean;
  vcMembers: VoiceChannelMember[];
  localVoiceChannelId: string | null;
  localVoiceConnected: boolean;
  localVoiceSessionId: string | null;
  listenTogetherRoomSlug: string | null;
  currentUserId: string | null;
  isDraggable: boolean;
  /** Folded away by a collapsed category. */
  hidden: boolean;
  streamPreviewChannelId: string | null;
  streamThumbnails: Record<string, string>;
  canManageChannels: boolean;
  onSelect: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, channel: Channel) => void;
  onUserContextMenu: (e: React.MouseEvent, target: VoiceMemberTarget) => void;
  uiDispatch: React.Dispatch<SidebarAction>;
  onWatchStream?: (channelId: string, userId: string) => void;
}

function VoiceChannelMediaDisplay({
  media,
  onChange,
  onRemove,
  isRemoving,
  readOnly = false,
}: {
  media: VoiceChannelStatusMedia;
  onChange: () => void;
  onRemove: () => void;
  isRemoving: boolean;
  readOnly?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // Channel media is decoration in a list: a still frame at rest, playing
  // only while it is hovered or focused (spec §6: nothing loops at rest).
  const play = () => void videoRef.current?.play().catch(() => {});
  const pause = () => videoRef.current?.pause();
  return (
    <div
      className="group/media relative overflow-hidden rounded-lg border border-line bg-ply-2"
      onPointerEnter={play}
      onPointerLeave={pause}
      onFocus={play}
      onBlur={pause}
    >
      <div
        className="w-full overflow-hidden"
        style={{
          aspectRatio: `${Math.max(1, media.preview_width)} / ${Math.max(1, media.preview_height)}`,
        }}
      >
        {media.preview_content_type.startsWith("video/") ? (
          <video
            ref={videoRef}
            src={getMediaUrl(media.preview_url)}
            loop
            muted
            playsInline
            preload="metadata"
            aria-label="Voice channel media preview"
            className="h-full w-full object-contain"
          />
        ) : (
          <img
            src={getAuthAssetUrl(media.preview_url)}
            alt={media.alt_text ?? "Voice channel status media"}
            className="h-full w-full object-contain"
            loading="lazy"
          />
        )}
      </div>

      {!readOnly && (
        <div className="absolute top-1.5 right-1.5 z-10 flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Change media"
                className={cn(
                  "flex size-7 items-center justify-center rounded-md border border-line bg-ply-3 text-ink-2 shadow-float pointer-fine:hover:text-ink-1",
                  PRESS,
                  HIT,
                  "md:pointer-fine:opacity-0 md:pointer-fine:group-hover/media:opacity-100 md:pointer-fine:group-focus-within/media:opacity-100",
                )}
                onClick={(event) => {
                  event.stopPropagation();
                  onChange();
                }}
              >
                <Icon name="edit" size="sm" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={8}>
              Change media
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Remove media"
                disabled={isRemoving}
                aria-busy={isRemoving || undefined}
                className={cn(
                  "flex size-7 items-center justify-center rounded-md border border-line bg-ply-3 text-ink-2 shadow-float pointer-fine:hover:text-danger-ink",
                  PRESS,
                  HIT,
                  DISABLED,
                  "md:pointer-fine:opacity-0 md:pointer-fine:group-hover/media:opacity-100 md:pointer-fine:group-focus-within/media:opacity-100",
                )}
                onClick={(event) => {
                  event.stopPropagation();
                  onRemove();
                }}
              >
                {isRemoving ? <Spinner /> : <Icon name="trash" size="sm" />}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={8}>
              Remove media
            </TooltipContent>
          </Tooltip>
        </div>
      )}
    </div>
  );
}

/**
 * The call clock on a voice channel row. It selects only this channel's
 * start time and ticks inside NumClock, so a second passing re-renders this
 * leaf and nothing else.
 */
function VoiceChannelClock({ channelId }: { channelId: string }) {
  const startedAt = useChatStore(
    (s) => s.voiceChannelStartedAt[channelId] ?? null,
  );
  if (!startedAt) return null;
  return <NumClock since={startedAt} size="xs" className="text-ink-3" />;
}

/**
 * The trunk inside each occupant leaf: the centre of the channel row's
 * 20px icon slot (8px row inset + 10), so the guide drops from the speaker
 * glyph.
 */
const VOICE_GUIDE_X = 18;
/** Occupant rows are 28 (OCCUPANT_ROW, h-7) with a 24px square avatar. */
const OCCUPANT_ROW_H = 28;
/** The 32px channel row's 16px glyph ends 8px above the first occupant. */
const VOICE_GUIDE_STEM = 8;

// ── Occupant leave (talk-tree-spec §5c) ────────────────────────────────────
// The store drops a person the moment they leave. The tree keeps their row
// mounted locally for the exit: the LED goes out and the row fades over
// 140ms, then the siblings close up over 200ms on a height-free collapse
// (a negative margin of one row, from the row-height var; nothing measured).
// Never on first paint, under reduced motion, or while the app is inactive.

export const OCCUPANT_LEAVE_FADE_MS = 140;
export const OCCUPANT_LEAVE_CLOSE_MS = 200;

const LEAVING_ROW_STYLE: React.CSSProperties = {
  opacity: 0,
  marginBottom: "calc(var(--rm-tree-rh) * -1)",
  transition: `opacity ${OCCUPANT_LEAVE_FADE_MS}ms var(--ease-out), margin-bottom ${OCCUPANT_LEAVE_CLOSE_MS}ms var(--ease-in-out) ${OCCUPANT_LEAVE_FADE_MS}ms`,
  pointerEvents: "none",
};

export interface OccupantRow<T> {
  item: T;
  key: string;
  leaving: boolean;
}

interface LeavingRows<T> {
  items: readonly T[];
  leaving: { item: T; key: string; index: number }[];
}

function mergeLeavingRows<T>(
  state: LeavingRows<T>,
  keyOf: (item: T) => string,
): OccupantRow<T>[] {
  const rows: OccupantRow<T>[] = state.items.map((item) => ({
    item,
    key: keyOf(item),
    leaving: false,
  }));
  for (const entry of [...state.leaving].sort((a, b) => a.index - b.index)) {
    rows.splice(Math.min(entry.index, rows.length), 0, {
      item: entry.item,
      key: entry.key,
      leaving: true,
    });
  }
  return rows;
}

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * `items` plus the rows that just left, flagged `leaving`, held in their
 * old place for the exit and dropped when it ends. A key that comes back
 * mid-exit returns as a normal row.
 */
export function useLeavingRows<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
): OccupantRow<T>[] {
  const painted = useAnimateEnter();
  const appActive = useAppActive();
  const [state, setState] = useState<LeavingRows<T>>(() => ({
    items,
    leaving: [],
  }));

  let current = state;
  if (state.items !== items) {
    // Derive during render (the documented pattern for state from props),
    // so the departing row never blinks out for a frame.
    const nextKeys = new Set(items.map(keyOf));
    const kept = state.leaving.filter((entry) => !nextKeys.has(entry.key));
    const animate = painted && appActive && !prefersReducedMotion();
    const gone = animate
      ? mergeLeavingRows(state, keyOf)
          .map((row, index) => ({ ...row, index }))
          .filter((row) => !row.leaving && !nextKeys.has(row.key))
          .map(({ item, key, index }) => ({ item, key, index }))
      : [];
    current = { items, leaving: [...kept, ...gone] };
    setState(current);
  }

  // Drop each departed row once its exit has played.
  const timersRef = useRef(new Map<string, number>());
  useEffect(() => {
    const timers = timersRef.current;
    const leavingKeys = new Set(state.leaving.map((entry) => entry.key));
    for (const [key, timer] of timers) {
      if (leavingKeys.has(key)) continue;
      window.clearTimeout(timer);
      timers.delete(key);
    }
    for (const key of leavingKeys) {
      if (timers.has(key)) continue;
      timers.set(
        key,
        window.setTimeout(() => {
          timers.delete(key);
          setState((prev) => ({
            ...prev,
            leaving: prev.leaving.filter((entry) => entry.key !== key),
          }));
        }, OCCUPANT_LEAVE_FADE_MS + OCCUPANT_LEAVE_CLOSE_MS),
      );
    }
  }, [state.leaving]);
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) window.clearTimeout(timer);
      timers.clear();
    };
  }, []);

  return useMemo(() => mergeLeavingRows(current, keyOf), [current, keyOf]);
}

const occupantKey = (member: VoiceChannelMember) => member.clerk_user_id;

const SortableChannelItem = memo(function SortableChannelItem({
  channel,
  isActive,
  unread,
  mentionCount,
  isVoice,
  vcMembers,
  localVoiceChannelId,
  localVoiceConnected,
  localVoiceSessionId,
  listenTogetherRoomSlug,
  currentUserId,
  isDraggable,
  hidden,
  streamPreviewChannelId,
  streamThumbnails,
  canManageChannels,
  onSelect,
  onContextMenu,
  onUserContextMenu,
  uiDispatch,
  onWatchStream,
}: SortableChannelItemProps) {
  const { dispatch } = useChatActions();
  const channelLongPress = useLongPressMenu((e) => onContextMenu(e, channel));
  // Combine server-wide permission with per-channel override
  const canManage =
    canManageChannels ||
    (channel.permissions != null &&
      hasPermission(channel.permissions, PERMISSIONS.MANAGE_CHANNELS));
  const [isVoiceTextStatusOpen, setIsVoiceTextStatusOpen] = useState(false);
  const [isVoiceMediaStatusOpen, setIsVoiceMediaStatusOpen] = useState(false);
  const [isRemovingVoiceMedia, setIsRemovingVoiceMedia] = useState(false);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: channel.id, disabled: !isDraggable });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : undefined,
  };

  const occupantRows = useLeavingRows(vcMembers, occupantKey);
  const occupied = isVoice && vcMembers.length > 0;
  const currentVoiceMember =
    vcMembers.find((member) => member.clerk_user_id === currentUserId) ?? null;
  const youAreHere = Boolean(
    isVoice &&
    currentVoiceMember &&
    localVoiceConnected &&
    localVoiceChannelId === channel.id,
  );
  const shouldRenderVoiceStatus = Boolean(
    youAreHere &&
    localVoiceSessionId &&
    currentVoiceMember &&
    !isVoiceMemberReconnecting(currentVoiceMember),
  );
  const currentStatusText = channel.voice_status?.text ?? null;
  const textStatus = currentStatusText?.trim() ?? "";
  const mediaStatus = channel.voice_status?.media ?? null;
  const textStatusLabel = textStatus ? "Edit status" : "Set status";
  const voiceSessionHeaders = localVoiceSessionId
    ? { "X-Voice-Session-Id": localVoiceSessionId }
    : undefined;
  // Read-only view: user is not in this voice channel but the channel has an active status to display.
  // Only shown when at least one member is currently present in the channel.
  const shouldRenderVoiceStatusReadOnly = Boolean(
    isVoice &&
    !shouldRenderVoiceStatus &&
    occupied &&
    (textStatus || mediaStatus),
  );
  const actionCount = canManage ? 2 : 1;

  const handleRemoveVoiceMedia = async () => {
    if (!mediaStatus || isRemovingVoiceMedia) return;
    setIsRemovingVoiceMedia(true);

    try {
      const updatedChannel = await apiPatch<Channel>(
        `/api/channels/${channel.id}/voice-status`,
        {
          voice_status: currentStatusText
            ? { text: currentStatusText, media: null }
            : null,
        },
        { headers: voiceSessionHeaders },
      );
      dispatch({ type: "UPSERT_CHANNEL", channel: updatedChannel });
    } catch (error) {
      console.error("Failed to remove voice channel media status", error);
    } finally {
      setIsRemovingVoiceMedia(false);
    }
  };

  const onPopoverUser = useCallback(
    (u: VoiceMemberTarget, anchor: HTMLElement) =>
      uiDispatch({ type: "SET_POPOVER_USER", user: u, anchor }),
    [uiDispatch],
  );

  const row = (
    <div
      className={sidebarRowClass({
        tree: true,
        selected: isActive,
        unread,
        className: cn("cursor-pointer", isActive && "font-semibold"),
      })}
      style={
        { "--row-actions-w": `${actionCount * 26}px` } as React.CSSProperties
      }
    >
      <button
        type="button"
        onClick={() => onSelect(channel.id)}
        onContextMenu={(e) => onContextMenu(e, channel)}
        {...channelLongPress}
        aria-label={`Open ${isVoice ? "voice" : "text"} channel ${channel.name}`}
        aria-current={isActive ? "page" : undefined}
        className={cn(
          "absolute inset-0 z-10 rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus",
          LONG_PRESS_TARGET,
        )}
      />
      {/* Drag handle: sits in the list's 8px gutter so it takes no width
          from the row; revealed on fine-pointer hover only. */}
      {isDraggable && (
        <span
          className="absolute top-1/2 -left-2 z-20 flex h-5 w-2 -translate-y-1/2 cursor-grab items-center justify-center text-ink-3 opacity-0 transition-opacity duration-(--dur-1) active:cursor-grabbing pointer-fine:group-hover:opacity-100"
          {...attributes}
          {...listeners}
        >
          <Icon name="dragHandle" size="xs" />
        </span>
      )}

      <span
        className={cn(SIDEBAR_ICON_SLOT, youAreHere && "text-path")}
        data-path={youAreHere ? "" : undefined}
      >
        <Icon name={getChannelIcon(channel)} size="sm" />
      </span>

      <InlineEmojiText
        text={channel.name}
        className={cn("min-w-0 flex-1 truncate", ROW_NAME_FADE)}
      />

      {/* Trailing meta: steps aside while the hover actions show. */}
      {(mentionCount > 0 || occupied) && (
        <span
          className={cn(
            "flex shrink-0 items-center gap-1.5 text-ink-3",
            ROW_META_SWAP,
          )}
        >
          {occupied && (
            <>
              <Num aria-label={`${vcMembers.length} in the call`}>
                {vcMembers.length}
              </Num>
              <span aria-hidden className="text-num-xs">
                ·
              </span>
              <VoiceChannelClock channelId={channel.id} />
            </>
          )}
          {mentionCount > 0 && <CountBadge count={mentionCount} />}
        </span>
      )}

      {/* Hover actions overlay the trailing edge; nothing is reserved. */}
      <span className={ROW_ACTIONS}>
        {canManage && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Channel settings"
                className={ROW_ACTION_BUTTON}
                onClick={(e) => {
                  e.stopPropagation();
                  uiDispatch({
                    type: "SET_CHANNEL_SETTINGS",
                    value: channel.id,
                  });
                }}
              >
                <Icon name="settings" size="sm" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={8}>
              Channel settings
            </TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Invite to channel"
              className={ROW_ACTION_BUTTON}
              onClick={(e) => {
                e.stopPropagation();
                uiDispatch({ type: "SET_INVITE_CHANNEL", value: channel.id });
              }}
            >
              <Icon name="invite" size="sm" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={8}>
            Invite to channel
          </TooltipContent>
        </Tooltip>
      </span>

      {unread && <span aria-hidden className={SIDEBAR_UNREAD_PILL} />}
    </div>
  );

  return (
    // Collapse: each row closes on the height-free grid track, so a
    // category folds without measuring and rows that stay (the open
    // channel, your call) keep their place.
    <div
      ref={setNodeRef}
      style={style}
      className="rm-collapse -mx-2"
      data-open={hidden ? undefined : ""}
      inert={hidden || undefined}
    >
      <div className="rm-collapse-inner px-2">
        {isVoice ? (
          <TreeBranch
            header={row}
            guideX={VOICE_GUIDE_X}
            rowHeight={OCCUPANT_ROW_H}
            stem={VOICE_GUIDE_STEM}
            data-you-are-here={youAreHere ? "" : undefined}
          >
            {occupantRows.map(({ item: m, leaving }) => (
              <VoiceOccupantLeaf
                key={m.clerk_user_id}
                member={m}
                leaving={leaving}
                channelId={channel.id}
                isCurrentUser={m.clerk_user_id === currentUserId}
                isCurrentClientVoiceConnected={
                  localVoiceConnected && localVoiceChannelId === channel.id
                }
                streamThumbnailUrl={
                  streamPreviewChannelId === channel.id
                    ? (streamThumbnails[m.clerk_user_id] ??
                      m.stream_preview_url ??
                      null)
                    : (m.stream_preview_url ?? null)
                }
                onContextMenu={onUserContextMenu}
                onPopoverUser={onPopoverUser}
                onWatchStream={onWatchStream}
              />
            ))}
          </TreeBranch>
        ) : (
          row
        )}

        {isVoice && localVoiceChannelId === channel.id && (
          <ListenTogetherSidebarStatus roomSlug={listenTogetherRoomSlug} />
        )}

        {shouldRenderVoiceStatus && (
          <div className="flex flex-col gap-1 pt-0.5 pb-1 pl-7">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="group/text flex h-6 max-w-full items-center gap-1.5 self-start rounded-sm px-1.5 text-left text-ui-xs font-medium outline-none transition-colors duration-(--dur-1) pointer-fine:hover:bg-tint-1 focus-visible:outline-2 focus-visible:outline-focus"
                  onClick={(event) => {
                    event.stopPropagation();
                    setIsVoiceTextStatusOpen(true);
                  }}
                >
                  <span
                    className={cn(
                      "truncate",
                      textStatus ? "text-ink-2" : "text-ink-3",
                    )}
                  >
                    <InlineEmojiText
                      text={textStatus || "Set a channel status"}
                    />
                  </span>
                  <Icon
                    name="edit"
                    size="xs"
                    className="shrink-0 text-ink-3 transition-colors pointer-fine:group-hover/text:text-ink-1"
                  />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={8}>
                {textStatusLabel}
              </TooltipContent>
            </Tooltip>

            {mediaStatus ? (
              <VoiceChannelMediaDisplay
                media={mediaStatus}
                isRemoving={isRemovingVoiceMedia}
                onChange={() => setIsVoiceMediaStatusOpen(true)}
                onRemove={() => {
                  void handleRemoveVoiceMedia();
                }}
              />
            ) : (
              <button
                type="button"
                className="flex h-6 items-center gap-1.5 self-start rounded-sm px-1.5 text-ui-xs font-medium text-ink-3 outline-none transition-colors duration-(--dur-1) pointer-fine:hover:bg-tint-1 pointer-fine:hover:text-ink-1 focus-visible:outline-2 focus-visible:outline-focus"
                onClick={(event) => {
                  event.stopPropagation();
                  setIsVoiceMediaStatusOpen(true);
                }}
              >
                <Icon name="sparkle" size="xs" className="shrink-0" />
                Set the vibe
              </button>
            )}
          </div>
        )}

        {/* Read-only voice channel status — visible to users not currently in the voice channel */}
        {shouldRenderVoiceStatusReadOnly && (
          <div className="flex flex-col gap-1 pt-0.5 pb-1 pl-7">
            {textStatus && (
              <span className="block max-w-full truncate px-1.5 text-ui-xs leading-6 font-medium text-ink-2">
                <InlineEmojiText text={textStatus} />
              </span>
            )}

            {mediaStatus && (
              <VoiceChannelMediaDisplay
                media={mediaStatus}
                isRemoving={false}
                readOnly
                onChange={() => {
                  /* no-op: read-only */
                }}
                onRemove={() => {
                  /* no-op: read-only */
                }}
              />
            )}
          </div>
        )}
      </div>

      <VoiceChannelTextStatusModal
        open={isVoiceTextStatusOpen}
        channel={channel}
        voiceSessionId={localVoiceSessionId}
        onClose={() => setIsVoiceTextStatusOpen(false)}
      />

      <VoiceChannelMediaStatusModal
        open={isVoiceMediaStatusOpen}
        channel={channel}
        voiceSessionId={localVoiceSessionId}
        onClose={() => setIsVoiceMediaStatusOpen(false)}
      />
    </div>
  );
});

// ── Types ────────────────────────────────────────────────────────────────

type SidebarState = {
  collapsedCategories: Set<string>;
  showCreateCategory: boolean;
  showCreateChannel: { categoryId: string | null } | null;
  showChannelSettings: string | null;
  inviteChannel: string | null;
  popoverUser: {
    id: string;
    username: string;
    display_name?: string | null;
    avatar_url?: string | null;
    avatar_display?: User["avatar_display"];
  } | null;
  popoverAnchor: HTMLElement | null;
};

type SidebarAction =
  | { type: "TOGGLE_CATEGORY"; id: string }
  | { type: "SET_CREATE_CATEGORY"; value: boolean }
  | { type: "SET_CREATE_CHANNEL"; value: { categoryId: string | null } | null }
  | { type: "SET_CHANNEL_SETTINGS"; value: string | null }
  | { type: "SET_INVITE_CHANNEL"; value: string | null }
  | {
      type: "SET_POPOVER_USER";
      user: {
        id: string;
        username: string;
        display_name?: string | null;
        avatar_url?: string | null;
        avatar_display?: User["avatar_display"];
      } | null;
      anchor: HTMLElement | null;
    };

// ── Main Sidebar Component ─────────────────────────────────────────────────

export default function ChannelSidebar({
  channels,
  categories = EMPTY_CATEGORIES,
  activeChannelId,
  serverName,
  currentUserId = null,
  onSelect,
  onInviteClick,
  onSettingsClick,
  readStates = EMPTY_READ_STATES,
  lastMessageAt = EMPTY_LAST_MESSAGE_AT,
  voiceChannelStates = EMPTY_VOICE_STATES,
  localVoiceChannelId = null,
  localVoiceConnected = false,
  localVoiceSessionId = null,
  localVoiceRoomSlug = null,
  channelMentionCounts = EMPTY_MENTION_COUNTS,
  streamPreviewChannelId = null,
  streamThumbnails = EMPTY_STREAM_THUMBNAILS,
  onWatchStream,
  serverId,
  canReorder = false,
  canManageChannels = false,
}: Props) {
  // The sidebar never subscribes to the speaking set: each occupant leaf
  // selects its own flag (useSpeakingAttr), so a VAD edge re-renders one row.
  const user = useChatStore((s) => s.user);
  const effectiveCurrentUserId = currentUserId ?? user?.id ?? null;
  const {
    deleteChannel,
    deleteCategory,
    openDm,
    dispatch,
    setProfileUser,
    reorderChannels,
    markChannelRead,
    createChannel,
  } = useChatActions();

  // DnD sensors. Mouse drags after 5px; touch needs a 250ms hold first, so a
  // finger scrolling the list never picks up a channel.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const [state, uiDispatch] = useReducer(
    (s: SidebarState, a: SidebarAction) => {
      switch (a.type) {
        case "TOGGLE_CATEGORY": {
          const next = new Set(s.collapsedCategories);
          if (next.has(a.id)) next.delete(a.id);
          else next.add(a.id);
          return { ...s, collapsedCategories: next };
        }
        case "SET_CREATE_CATEGORY":
          return { ...s, showCreateCategory: a.value };
        case "SET_CREATE_CHANNEL":
          return { ...s, showCreateChannel: a.value };
        case "SET_CHANNEL_SETTINGS":
          return { ...s, showChannelSettings: a.value };
        case "SET_INVITE_CHANNEL":
          return { ...s, inviteChannel: a.value };
        case "SET_POPOVER_USER":
          return { ...s, popoverUser: a.user, popoverAnchor: a.anchor };
        default:
          return s;
      }
    },
    {
      collapsedCategories: new Set<string>(),
      showCreateCategory: false,
      showCreateChannel: null,
      showChannelSettings: null,
      inviteChannel: null,
      popoverUser: null,
      popoverAnchor: null,
    },
  );

  const {
    collapsedCategories,
    showCreateCategory,
    showCreateChannel,
    showChannelSettings,
    inviteChannel,
    popoverUser,
    popoverAnchor,
  } = state;
  const liveChannelSettings = showChannelSettings
    ? (channels.find((channel) => channel.id === showChannelSettings) ?? null)
    : null;
  const liveInviteChannel = inviteChannel
    ? (channels.find((channel) => channel.id === inviteChannel) ?? null)
    : null;
  const [retainedChannelSettings, setRetainedChannelSettings] =
    useState<Channel | null>(liveChannelSettings);
  const [retainedInviteChannel, setRetainedInviteChannel] =
    useState<Channel | null>(liveInviteChannel);
  const [retainedCreateChannel, setRetainedCreateChannel] = useState<{
    categoryId: string | null;
  } | null>(showCreateChannel);
  useEffect(() => {
    if (liveChannelSettings) {
      // Retain the controlled dialog payload through Radix's exit state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRetainedChannelSettings(liveChannelSettings);
    }
  }, [liveChannelSettings]);
  useEffect(() => {
    if (liveInviteChannel) {
      // Retain the controlled dialog payload through Radix's exit state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRetainedInviteChannel(liveInviteChannel);
    }
  }, [liveInviteChannel]);
  useEffect(() => {
    if (showCreateChannel) {
      // Retain the category payload while the controlled dialog exits.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRetainedCreateChannel(showCreateChannel);
    }
  }, [showCreateChannel]);
  const shouldRenderCreateCategory = showCreateCategory;
  const shouldRenderCreateChannel = !!showCreateChannel;
  const shouldRenderChannelSettings = showChannelSettings != null;
  const renderedChannelSettings = retainedChannelSettings;
  const shouldRenderInviteChannel = inviteChannel != null;
  const renderedInviteChannel = retainedInviteChannel;
  const { menu, openMenu, closeMenu } = useContextMenu();
  const voiceSettings = useVoiceSettingsStore((s) => s.getSettings(user?.id));
  const setIsMuted = useVoiceSettingsStore((s) => s.setIsMuted);
  const setIsDeafened = useVoiceSettingsStore((s) => s.setIsDeafened);
  const [voiceMemberMenu, setVoiceMemberMenu] =
    useState<VoiceMemberContextMenuTarget | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(
    null,
  );

  const {
    handleChannelContextMenu,
    handleCategoryContextMenu,
    handleSidebarContextMenu,
    handleServerHeaderClick,
  } = useSidebarContextMenus({
    canManageChannels,
    serverId: serverId ?? undefined,
    onInviteClick,
    onSettingsClick,
    onRequestDelete: setPendingDelete,
    uiDispatch,
    openMenu,
    markChannelRead,
    createChannel,
  });

  const handleVoiceMemberContextMenu = useCallback(
    (
      e: React.MouseEvent,
      target: {
        id: string;
        username: string;
        display_name?: string | null;
        avatar_url?: string | null;
        avatar_display?: User["avatar_display"];
      },
    ) => {
      e.preventDefault();
      e.stopPropagation();
      setVoiceMemberMenu({
        x: e.clientX,
        y: e.clientY,
        target,
      });
    },
    [],
  );

  const toggleCategory = useCallback(
    (catId: string) => {
      uiDispatch({ type: "TOGGLE_CATEGORY", id: catId });
    },
    [uiDispatch],
  );

  const grouped = useMemo(
    () => groupChannelsByCategory(channels, categories),
    [channels, categories],
  );

  // Handle drag end — reorder channels within a category group
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id || !serverId) return;

      // Find the group containing the dragged channel
      const sourceGroup = grouped.find((g) =>
        g.channels.some((c) => c.id === active.id),
      );
      const targetGroup = grouped.find((g) =>
        g.channels.some((c) => c.id === over.id),
      );
      if (!sourceGroup || !targetGroup) return;

      // Only allow reordering within the same group for now
      if (sourceGroup.id !== targetGroup.id) return;

      const groupChannels = [...sourceGroup.channels];
      const oldIndex = groupChannels.findIndex((c) => c.id === active.id);
      const newIndex = groupChannels.findIndex((c) => c.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      // Compute the new order
      const reordered = arrayMove(groupChannels, oldIndex, newIndex);
      const targetCategoryId = sourceGroup.id?.startsWith("__")
        ? null
        : sourceGroup.id;

      // Build the new positions payload
      const channelUpdates = reordered.map((ch, i) => ({
        id: ch.id,
        position: i,
        category_id: targetCategoryId,
      }));

      // Optimistic update: replace positions locally so UI doesn't snap back
      const updatedChannels = channels.map((ch) => {
        const update = channelUpdates.find((u) => u.id === ch.id);
        if (update) {
          return {
            ...ch,
            position: update.position,
            category_id: update.category_id ?? undefined,
          };
        }
        return ch;
      });
      dispatch({ type: "SET_CHANNELS", channels: updatedChannels });

      // Persist to DB + broadcast to all clients
      reorderChannels(serverId, channelUpdates);
    },
    [grouped, serverId, channels, reorderChannels, dispatch],
  );

  return (
    <TooltipProvider>
      <div
        className="flex h-full flex-col overflow-hidden bg-ply-1 select-none"
        onContextMenu={handleSidebarContextMenu}
      >
        {/* Server header: 48px, Bricolage 17/800 with the chevron on the
            far edge. The theme banner slot decorates it without changing
            its structure. */}
        <button
          type="button"
          className="relative flex shrink-0 cursor-pointer items-center justify-between gap-2 border-b border-line px-4 text-left font-display-tuned text-[17px] leading-6 font-extrabold tracking-[-0.01em] text-ink-1 outline-none transition-colors duration-(--dur-1) ease-out pointer-fine:hover:bg-tint-1 active:bg-tint-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
          style={{
            height: "calc(48px + var(--safe-area-top, 0px))",
            paddingTop: "var(--safe-area-top, 0px)",
          }}
          aria-label="Open server menu"
          onClick={handleServerHeaderClick}
        >
          <InlineEmojiText text={serverName} className="min-w-0 truncate" />
          <Icon
            name="chevronDown"
            size="sm"
            className="relative z-10 shrink-0 text-ink-2"
          />
          <ThemeBanner />
        </button>

        {/* The Talk Tree */}
        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-2 pb-2">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            {grouped.map((group) => (
              <ChannelCategoryGroup
                key={group.id || "uncategorized"}
                group={group}
                isCollapsed={collapsedCategories.has(group.id || "")}
                activeChannelId={activeChannelId}
                readStates={readStates}
                lastMessageAt={lastMessageAt}
                voiceChannelStates={voiceChannelStates}
                localVoiceChannelId={localVoiceChannelId}
                localVoiceConnected={localVoiceConnected}
                localVoiceSessionId={localVoiceSessionId}
                listenTogetherRoomSlug={localVoiceRoomSlug}
                channelMentionCounts={channelMentionCounts}
                streamPreviewChannelId={streamPreviewChannelId}
                streamThumbnails={streamThumbnails}
                currentUserId={effectiveCurrentUserId}
                canReorder={canReorder}
                canManageChannels={canManageChannels}
                onSelect={onSelect}
                toggleCategory={toggleCategory}
                handleCategoryContextMenu={handleCategoryContextMenu}
                handleChannelContextMenu={handleChannelContextMenu}
                handleUserContextMenu={handleVoiceMemberContextMenu}
                uiDispatch={uiDispatch}
                onWatchStream={onWatchStream}
              />
            ))}
          </DndContext>
        </div>

        {/* Modals & Popovers */}
        {serverId && (
          <CreateCategoryModal
            open={shouldRenderCreateCategory}
            serverId={serverId}
            onClose={() =>
              uiDispatch({ type: "SET_CREATE_CATEGORY", value: false })
            }
          />
        )}
        {serverId && (
          <CreateChannelModal
            open={shouldRenderCreateChannel}
            serverId={serverId}
            defaultCategoryId={retainedCreateChannel?.categoryId}
            onClose={() =>
              uiDispatch({ type: "SET_CREATE_CHANNEL", value: null })
            }
          />
        )}
        {serverId && renderedChannelSettings && (
          <ChannelSettingsModal
            open={shouldRenderChannelSettings}
            serverId={serverId}
            channel={renderedChannelSettings}
            onUpdated={(updates) =>
              dispatch({
                type: "UPSERT_CHANNEL",
                channel: { ...renderedChannelSettings, ...updates },
              })
            }
            onClose={() =>
              uiDispatch({ type: "SET_CHANNEL_SETTINGS", value: null })
            }
          />
        )}
        {serverId && renderedInviteChannel && (
          <ChannelInviteModal
            open={shouldRenderInviteChannel}
            serverId={serverId}
            serverName={serverName}
            channel={renderedInviteChannel}
            onClose={() =>
              uiDispatch({ type: "SET_INVITE_CHANNEL", value: null })
            }
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
              uiDispatch({ type: "SET_POPOVER_USER", user: null, anchor: null })
            }
          />
        )}

        <ConfirmDialog
          open={pendingDelete !== null}
          onOpenChange={(open) => {
            if (!open) setPendingDelete(null);
          }}
          irreversible
          {...deleteConfirmCopy(pendingDelete)}
          onConfirm={() => {
            if (!pendingDelete) return;
            return pendingDelete.kind === "channel"
              ? deleteChannel(pendingDelete.id)
              : deleteCategory(pendingDelete.serverId, pendingDelete.id);
          }}
        />

        {/* Context Menu Placeholder */}
        <div id="channel-context-menu" />
        {menu.isOpen && (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            items={menu.items}
            onClose={closeMenu}
          />
        )}
        {voiceMemberMenu && (
          <Suspense fallback={null}>
            <StreamContextMenu
              userId={voiceMemberMenu.target.id}
              x={voiceMemberMenu.x}
              y={voiceMemberMenu.y}
              onClose={() => setVoiceMemberMenu(null)}
              isMuted={voiceSettings.isMuted}
              onToggleMute={() => setIsMuted(!voiceSettings.isMuted)}
              isDeafened={voiceSettings.isDeafened}
              onToggleDeafen={() => setIsDeafened(!voiceSettings.isDeafened)}
              onOpenProfile={() =>
                setProfileUser(voiceMemberMenu.target as unknown as User)
              }
              onOpenMessage={() => openDm(voiceMemberMenu.target.id)}
              showDisconnect={false}
            />
          </Suspense>
        )}
      </div>
    </TooltipProvider>
  );
}

// ── Shared Sub-components & Hooks ────────────────────────────────────────────────

/** A delete waiting on its ConfirmDialog. */
type PendingDelete =
  | { kind: "channel"; id: string; name: string }
  | { kind: "category"; serverId: string; id: string; name: string };

function deleteConfirmCopy(target: PendingDelete | null) {
  if (target?.kind === "category") {
    return {
      title: "Delete category",
      description: `${target.name} will be deleted. Its channels stay and move out of the category.`,
      confirmLabel: "Delete category",
      errorAction: "delete this category",
    };
  }
  return {
    title: "Delete channel",
    description: `#${target?.name ?? ""} and all of its messages will be deleted. This can't be undone.`,
    confirmLabel: "Delete channel",
    errorAction: "delete this channel",
  };
}

interface UseSidebarContextMenusProps {
  canManageChannels: boolean;
  serverId?: string;
  onInviteClick?: () => void;
  onSettingsClick?: () => void;
  onRequestDelete: (target: PendingDelete) => void;
  uiDispatch: React.Dispatch<SidebarAction>;
  openMenu: (e: React.MouseEvent, items: any[]) => void;
  markChannelRead: (channelId: string) => void;
  createChannel: (
    serverId: string,
    name: string,
    type?: string,
    categoryId?: string,
  ) => Promise<any>;
}

function useSidebarContextMenus({
  canManageChannels,
  serverId,
  onInviteClick,
  onSettingsClick,
  onRequestDelete,
  uiDispatch,
  openMenu,
  markChannelRead,
  createChannel,
}: UseSidebarContextMenusProps) {
  const handleChannelContextMenu = useCallback(
    (e: React.MouseEvent, channel: Channel) => {
      const channelCanManage =
        canManageChannels ||
        (channel.permissions != null &&
          hasPermission(channel.permissions, PERMISSIONS.MANAGE_CHANNELS));
      const items = [
        // ── Mark as read ───────────────────────────────────────────────
        {
          label: "Mark as read",
          icon: <Icon name="markRead" size="sm" />,
          onClick: () => markChannelRead(channel.id),
          divider: true,
        },
        // ── Invite / Link ──────────────────────────────────────────────
        {
          label: "Invite to channel",
          icon: <Icon name="invite" size="sm" />,
          onClick: () =>
            uiDispatch({ type: "SET_INVITE_CHANNEL", value: channel.id }),
        },
        {
          label: "Copy link",
          icon: <Icon name="link" size="sm" />,
          onClick: () => {
            const path = `/chat/${serverId ?? ""}/${channel.id}`;
            void copyToClipboard(
              `${window.location.origin}${path}`,
              "Channel link copied",
            );
          },
          divider: true,
        },
        // ── Notifications (placeholders — need backend) ────────────────
        {
          label: "Mute channel",
          icon: <Icon name="speakerOff" size="sm" />,
          rightIcon: <Icon name="chevronRight" size="xs" />,
          onClick: () => {
            /* needs backend: per-user per-channel mute */
          },
          disabled: true,
        },
        {
          label: "Notification settings",
          subtitle: "All messages",
          icon: <Icon name="bell" size="sm" />,
          rightIcon: <Icon name="chevronRight" size="xs" />,
          onClick: () => {
            /* needs backend: per-user per-channel notification prefs */
          },
          disabled: true,
          divider: true,
        },
        // ── Channel management ─────────────────────────────────────────
        ...(channelCanManage
          ? [
              {
                label: "Edit channel",
                icon: <Icon name="settings" size="sm" />,
                onClick: () =>
                  uiDispatch({
                    type: "SET_CHANNEL_SETTINGS",
                    value: channel.id,
                  }),
              },
              {
                label: "Duplicate channel",
                icon: <Icon name="copy" size="sm" />,
                onClick: () => {
                  if (serverId) {
                    createChannel(
                      serverId,
                      `${channel.name}-copy`,
                      channel.channel_type,
                      channel.category_id,
                    );
                  }
                },
              },
            ]
          : []),
        ...(canManageChannels
          ? [
              {
                label: "Create text channel",
                icon: <Icon name="add" size="sm" />,
                onClick: () =>
                  uiDispatch({
                    type: "SET_CREATE_CHANNEL",
                    value: { categoryId: channel.category_id ?? null },
                  }),
              },
            ]
          : []),
        ...(channelCanManage
          ? [
              {
                label: "Delete channel",
                icon: <Icon name="trash" size="sm" />,
                onClick: () =>
                  onRequestDelete({
                    kind: "channel",
                    id: channel.id,
                    name: channel.name,
                  }),
                variant: "danger" as const,
                divider: true,
              },
            ]
          : [{ label: "", onClick: () => {}, divider: true, disabled: true }]),
        // ── Copy channel ID ────────────────────────────────────────────
        {
          label: "Copy channel ID",
          icon: <Icon name="copy" size="sm" />,
          rightIcon: (
            <span className="rounded-xs bg-tint-2 px-1 text-ui-xs font-medium text-ink-2">
              ID
            </span>
          ),
          onClick: () => void copyToClipboard(channel.id, "Channel ID copied"),
        },
      ];
      openMenu(e, items);
    },
    [
      canManageChannels,
      onRequestDelete,
      openMenu,
      uiDispatch,
      markChannelRead,
      createChannel,
      serverId,
    ],
  );

  const handleCategoryContextMenu = useCallback(
    (e: React.MouseEvent, group: CategoryGroup) => {
      if (!group.id || group.id.startsWith("__")) return;
      openMenu(e, [
        ...(canManageChannels
          ? [
              {
                label: "Create channel",
                icon: <Icon name="add" size="sm" />,
                onClick: () =>
                  uiDispatch({
                    type: "SET_CREATE_CHANNEL",
                    value: { categoryId: group.id },
                  }),
              },
            ]
          : []),
        {
          label: "Copy ID",
          icon: <Icon name="copy" size="sm" />,
          onClick: () => void copyToClipboard(group.id!, "Category ID copied"),
        },
        ...(canManageChannels
          ? [
              {
                label: "Delete category",
                icon: <Icon name="trash" size="sm" />,
                onClick: () => {
                  if (serverId && group.id) {
                    onRequestDelete({
                      kind: "category",
                      serverId,
                      id: group.id,
                      name: group.name,
                    });
                  }
                },
                variant: "danger" as const,
              },
            ]
          : []),
      ]);
    },
    [canManageChannels, onRequestDelete, openMenu, serverId, uiDispatch],
  );

  const handleSidebarContextMenu = useCallback(
    (e: React.MouseEvent) => {
      openMenu(e, [
        ...(canManageChannels
          ? [
              {
                label: "Create channel",
                onClick: () =>
                  uiDispatch({
                    type: "SET_CREATE_CHANNEL",
                    value: { categoryId: null },
                  }),
              },
              {
                label: "Create category",
                onClick: () =>
                  uiDispatch({ type: "SET_CREATE_CATEGORY", value: true }),
              },
            ]
          : []),
        {
          label: "Invite to server",
          divider: true,
          onClick: () => onInviteClick?.(),
        },
        {
          label: "Copy ID",
          icon: <Icon name="copy" size="sm" />,
          onClick: () =>
            serverId && void copyToClipboard(serverId, "Server ID copied"),
        },
      ]);
    },
    [canManageChannels, onInviteClick, openMenu, serverId, uiDispatch],
  );

  const handleServerHeaderClick = useCallback(
    (e: React.MouseEvent | React.KeyboardEvent) => {
      openMenu(e as unknown as React.MouseEvent, [
        {
          label: "Server boost",
          icon: <Icon name="gem" size="sm" />,
          onClick: () => {},
        },
        {
          label: "Invite to server",
          icon: <Icon name="invite" size="sm" />,
          divider: canManageChannels,
          variant: "default",
          onClick: () => onInviteClick?.(),
        },
        ...(canManageChannels
          ? [
              {
                label: "Server settings",
                icon: <Icon name="settings" size="sm" />,
                onClick: () => onSettingsClick?.(),
              },
              {
                label: "Create channel",
                icon: <Icon name="add" size="sm" />,
                onClick: () =>
                  uiDispatch({
                    type: "SET_CREATE_CHANNEL",
                    value: { categoryId: null },
                  }),
              },
              {
                label: "Create category",
                icon: <Icon name="folderAdd" size="sm" />,
                onClick: () =>
                  uiDispatch({ type: "SET_CREATE_CATEGORY", value: true }),
              },
              {
                label: "Create event",
                icon: <Icon name="event" size="sm" />,
                onClick: () => {},
              },
              {
                label: "App directory",
                icon: <Icon name="grid" size="sm" />,
                divider: true,
                onClick: () => {},
              },
            ]
          : []),
        {
          label: "Notification settings",
          icon: <Icon name="bell" size="sm" />,
          onClick: () => {},
        },
        {
          label: "Privacy settings",
          icon: <Icon name="shield" size="sm" />,
          divider: true,
          onClick: () => {},
        },
        {
          label: "Edit Per-server Profile",
          icon: <Icon name="edit" size="sm" />,
          onClick: () => {},
        },
        {
          label: "Hide muted channels",
          icon: <Icon name="eyeOff" size="sm" />,
          onClick: () => {},
        },
      ]);
    },
    [canManageChannels, onInviteClick, onSettingsClick, openMenu, uiDispatch],
  );

  return {
    handleChannelContextMenu,
    handleCategoryContextMenu,
    handleSidebarContextMenu,
    handleServerHeaderClick,
  };
}

// ── Voice occupant leaf ─────────────────────────────────────────────────────
// One person hanging off the voice channel's guide. Its LED is the node at
// the tick's end and lights from this leaf's own speaking flag
// (useSpeakingAttr), so a VAD edge re-renders this row and nothing else.
// Resolves the avatar from the members store when the gateway-provided
// VoiceChannelMember.avatar_url is missing.

interface VoiceOccupantLeafProps {
  member: VoiceChannelMember;
  /** Left the channel: held for the exit (LED out, fade, close up). */
  leaving?: boolean;
  channelId: string;
  isCurrentUser: boolean;
  isCurrentClientVoiceConnected: boolean;
  streamThumbnailUrl: string | null;
  onContextMenu: (e: React.MouseEvent, target: VoiceMemberTarget) => void;
  onPopoverUser: (u: VoiceMemberTarget, anchor: HTMLElement) => void;
  onWatchStream?: (channelId: string, userId: string) => void;
}

const VoiceOccupantLeaf = memo(function VoiceOccupantLeaf({
  member,
  leaving = false,
  channelId,
  isCurrentUser,
  isCurrentClientVoiceConnected,
  streamThumbnailUrl,
  onContextMenu,
  onPopoverUser,
  onWatchStream,
}: VoiceOccupantLeafProps) {
  const speakingAttr = useSpeakingAttr(member.clerk_user_id);
  const activity = useActivityStore((state) => {
    const presence = state.activeByUser[member.clerk_user_id];
    return presence?.channelId === channelId ? presence : undefined;
  });
  const isReconnecting =
    isVoiceMemberReconnecting(member) ||
    (isCurrentUser && !isCurrentClientVoiceConnected);
  const isMutedByCurrentUser = useVoiceSettingsStore((state) => {
    const settings = state.getSettings();
    return settings.peerSettings[member.clerk_user_id]?.muted ?? false;
  });
  const shouldShowStreamState = shouldShowVoiceMemberStreamState(member, {
    isCurrentUser,
    isCurrentClientVoiceConnected,
  });
  const [streamPreviewPosition, setStreamPreviewPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const closePreviewTimeoutRef = useRef<number | null>(null);
  // Use a targeted selector so this component only re-renders when the specific member's avatar changes
  const resolvedAvatarUrl = useChatStore((s) => {
    if (Object.prototype.hasOwnProperty.call(member, "avatar_url")) {
      return member.avatar_url ?? null;
    }
    const m = s.members.find((m) => m.user.id === member.clerk_user_id);
    if (m?.user.avatar_url) return m.user.avatar_url;
    const r = s.relationships.find((r) => r.user.id === member.clerk_user_id);
    if (r?.user.avatar_url) return r.user.avatar_url;
    return null;
  });
  const resolvedAvatarDisplay = useChatStore((s) => {
    if (Object.prototype.hasOwnProperty.call(member, "avatar_display")) {
      return member.avatar_display ?? null;
    }
    const m = s.members.find((m) => m.user.id === member.clerk_user_id);
    if (m?.user.avatar_display) return m.user.avatar_display;
    const r = s.relationships.find((r) => r.user.id === member.clerk_user_id);
    if (r?.user.avatar_display) return r.user.avatar_display;
    return null;
  });
  const resolvedDisplayNameStyle = useChatStore((s) => {
    if (Object.prototype.hasOwnProperty.call(member, "display_name_style")) {
      return member.display_name_style ?? null;
    }
    const m = s.members.find((m) => m.user.id === member.clerk_user_id);
    if (m?.user.display_name_style) return m.user.display_name_style;
    const r = s.relationships.find((r) => r.user.id === member.clerk_user_id);
    if (r?.user.display_name_style) return r.user.display_name_style;
    const dm = s.dmChannels.find(
      (channel) => channel.recipient?.id === member.clerk_user_id,
    );
    return dm?.recipient?.display_name_style ?? null;
  });

  const resolvedIdentity = useMemo(
    () =>
      resolveVoiceIdentity({
        name: member.name,
        username: member.username ?? member.name,
        display_name: member.display_name ?? null,
        avatar_url: resolvedAvatarUrl,
      }),
    [member.name, member.username, member.display_name, resolvedAvatarUrl],
  );

  const userInfo = useMemo(
    () => ({
      id: member.clerk_user_id,
      username: resolvedIdentity.username,
      display_name: resolvedIdentity.displayName,
      avatar_url: resolvedIdentity.avatarUrl,
      avatar_display: resolvedAvatarDisplay,
    }),
    [
      member.clerk_user_id,
      resolvedIdentity.username,
      resolvedIdentity.displayName,
      resolvedIdentity.avatarUrl,
      resolvedAvatarDisplay,
    ],
  );

  const clearPreviewCloseTimeout = useCallback(() => {
    const closePreviewTimeout = closePreviewTimeoutRef.current;
    if (closePreviewTimeout !== null) {
      closePreviewTimeoutRef.current = null;
      window.clearTimeout(closePreviewTimeout);
    }
  }, []);

  const closeStreamPreview = useCallback(() => {
    clearPreviewCloseTimeout();
    setStreamPreviewPosition(null);
  }, [clearPreviewCloseTimeout]);

  const scheduleStreamPreviewClose = useCallback(() => {
    clearPreviewCloseTimeout();
    closePreviewTimeoutRef.current = window.setTimeout(() => {
      setStreamPreviewPosition(null);
      closePreviewTimeoutRef.current = null;
    }, 90);
  }, [clearPreviewCloseTimeout]);

  const openStreamPreview = useCallback(
    (anchor: HTMLElement) => {
      if (!shouldShowStreamState) return;

      clearPreviewCloseTimeout();

      const rect = anchor.getBoundingClientRect();
      const preferredLeft = rect.right + 12;
      const maxLeft = window.innerWidth - STREAM_PREVIEW_CARD_WIDTH - 12;
      const fallbackLeft = rect.left - STREAM_PREVIEW_CARD_WIDTH - 12;
      const left =
        preferredLeft <= maxLeft ? preferredLeft : Math.max(12, fallbackLeft);
      const centerY = rect.top + rect.height / 2;
      const minCenterY = STREAM_PREVIEW_CARD_HEIGHT / 2 + 12;
      const maxCenterY =
        window.innerHeight - STREAM_PREVIEW_CARD_HEIGHT / 2 - 12;
      const top = Math.min(maxCenterY, Math.max(minCenterY, centerY));

      setStreamPreviewPosition({ left, top });
    },
    [clearPreviewCloseTimeout, shouldShowStreamState],
  );

  useEffect(() => clearPreviewCloseTimeout, [clearPreviewCloseTimeout]);

  const silenced = member.self_mute || member.self_deaf || isMutedByCurrentUser;

  return (
    <TreeLeaf
      self={isCurrentUser && !isReconnecting && !leaving}
      node={
        <Led
          state={isReconnecting || silenced || leaving ? "off" : "talk"}
          follow="speaking"
        />
      }
      data-voice-connection-state={
        isReconnecting ? "reconnecting" : "connected"
      }
      data-leaving={leaving ? "" : undefined}
      aria-hidden={leaving || undefined}
      inert={leaving || undefined}
      className={cn(
        isReconnecting && "opacity-50",
        // The row above a departing last row stops drawing its lower trunk
        // at once, so no stub hangs under it while the exit plays.
        "[&:has(+[data-leaving]:last-child)>[data-seg=down]]:opacity-0",
      )}
      style={leaving ? LEAVING_ROW_STYLE : undefined}
      {...(leaving ? null : speakingAttr)}
    >
      <button
        type="button"
        className={cn(
          OCCUPANT_ROW,
          "-ml-1 pl-1 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus in-data-speaking:text-ink-1",
          isCurrentUser && "text-ink-1",
        )}
        aria-label={`Open profile for ${resolvedIdentity.name}`}
        onMouseEnter={(event) => openStreamPreview(event.currentTarget)}
        onMouseLeave={scheduleStreamPreviewClose}
        onFocus={(event) => openStreamPreview(event.currentTarget)}
        onBlur={scheduleStreamPreviewClose}
        onContextMenu={(e) => onContextMenu(e, userInfo)}
        onClick={(e) => {
          e.stopPropagation();
          if (e.button === 0) onPopoverUser(userInfo, e.currentTarget);
        }}
      >
        <span
          className={cn(
            "relative size-6 shrink-0 in-data-speaking:outline-2 in-data-speaking:-outline-offset-2 in-data-speaking:outline-talk",
            avatarShape(resolvedIdentity.avatarUrl && resolvedAvatarDisplay),
          )}
        >
          {resolvedIdentity.avatarUrl ? (
            <AvatarImage
              src={getAuthAssetUrl(resolvedIdentity.avatarUrl)}
              alt=""
              display={resolvedAvatarDisplay}
            />
          ) : (
            <Avatar name={resolvedIdentity.name} size={24} />
          )}
        </span>
        <UserDisplayName
          text={resolvedIdentity.name}
          displayNameStyle={resolvedDisplayNameStyle}
          className="min-w-0 flex-1 truncate"
        />
        <span className="ml-auto flex shrink-0 items-center gap-1 text-ink-3 [&_svg]:size-3.5">
          {shouldShowStreamState && (
            <span aria-label="Live" role="img" className="flex">
              <Icon name="screenShare" size="xs" className="text-live-ink" />
            </span>
          )}
          {activity && (
            <Icon name="activities" size="xs" className="text-accent-ink" />
          )}
          {member.self_video && (
            <Icon
              name="camera"
              state="active"
              size="xs"
              className="text-live-ink"
            />
          )}
          {member.self_mute && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span aria-label="Self-muted" className="flex">
                  <Icon
                    name="mic"
                    state="off"
                    size="xs"
                    className="text-muted-state"
                  />
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={6}>
                Self-muted
              </TooltipContent>
            </Tooltip>
          )}
          {member.self_deaf && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span aria-label="Self-deafened" className="flex">
                  <Icon
                    name="deafen"
                    state="off"
                    size="xs"
                    className="text-muted-state"
                  />
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={6}>
                Self-deafened
              </TooltipContent>
            </Tooltip>
          )}
          {isMutedByCurrentUser && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span aria-label="Muted by you" className="flex">
                  <Icon
                    name="speakerOff"
                    size="xs"
                    className="text-muted-state"
                  />
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={6}>
                Muted by you
              </TooltipContent>
            </Tooltip>
          )}
        </span>
      </button>

      {shouldShowStreamState && streamPreviewPosition && !leaving && (
        <div
          className="fixed z-30"
          style={{
            left: streamPreviewPosition.left,
            top: streamPreviewPosition.top,
            transform: "translateY(-50%)",
          }}
          onMouseEnter={clearPreviewCloseTimeout}
          onMouseLeave={scheduleStreamPreviewClose}
        >
          <VoiceStreamHoverCard
            displayName={resolvedIdentity.name}
            thumbnailUrl={streamThumbnailUrl}
            isCurrentUser={isCurrentUser}
            onWatchStream={
              onWatchStream
                ? () => {
                    closeStreamPreview();
                    onWatchStream(channelId, member.clerk_user_id);
                  }
                : undefined
            }
          />
        </div>
      )}
    </TreeLeaf>
  );
});

// ── Category branch ──────────────────────────────────────────────────────

interface ChannelCategoryGroupProps {
  group: CategoryGroup;
  isCollapsed: boolean;
  activeChannelId: string | null;
  readStates: Record<string, string>;
  lastMessageAt: Record<string, string>;
  voiceChannelStates: Record<string, VoiceChannelMember[]>;
  localVoiceChannelId: string | null;
  localVoiceConnected: boolean;
  localVoiceSessionId: string | null;
  listenTogetherRoomSlug: string | null;
  currentUserId: string | null;
  channelMentionCounts: Record<string, number>;
  streamPreviewChannelId: string | null;
  streamThumbnails: Record<string, string>;
  canReorder: boolean;
  canManageChannels: boolean;
  onSelect: (channelId: string) => void;
  toggleCategory: (catId: string) => void;
  handleCategoryContextMenu: (
    e: React.MouseEvent,
    group: CategoryGroup,
  ) => void;
  handleChannelContextMenu: (e: React.MouseEvent, channel: Channel) => void;
  handleUserContextMenu: (
    e: React.MouseEvent,
    target: VoiceMemberTarget,
  ) => void;
  uiDispatch: React.Dispatch<SidebarAction>;
  onWatchStream?: (channelId: string, userId: string) => void;
}

const EMPTY_VOICE_MEMBERS: VoiceChannelMember[] = [];

const ChannelCategoryGroup = memo(function ChannelCategoryGroup({
  group,
  isCollapsed,
  activeChannelId,
  readStates,
  lastMessageAt,
  voiceChannelStates,
  localVoiceChannelId,
  localVoiceConnected,
  localVoiceSessionId,
  listenTogetherRoomSlug,
  currentUserId,
  channelMentionCounts,
  streamPreviewChannelId,
  streamThumbnails,
  canReorder,
  canManageChannels,
  onSelect,
  toggleCategory,
  handleCategoryContextMenu,
  handleChannelContextMenu,
  handleUserContextMenu,
  uiDispatch,
  onWatchStream,
}: ChannelCategoryGroupProps) {
  const channelIds = useMemo(
    () => group.channels.map((c) => c.id),
    [group.channels],
  );
  const categoryLongPress = useLongPressMenu((e) =>
    handleCategoryContextMenu(e, group),
  );

  return (
    <div
      role="group"
      aria-label={group.name}
      className={cn("flex flex-col gap-0.5", TREE_BRANCH_GAP)}
    >
      {/* Branch label: silkscreen in a fixed 24px row; the chevron sits in
          the 20px icon column so the label starts on the channel-name edge. */}
      <div
        className={cn(TREE_BRANCH_LABEL, "group", LONG_PRESS_TARGET)}
        onContextMenu={(e) => handleCategoryContextMenu(e, group)}
        {...categoryLongPress}
      >
        <button
          type="button"
          className={cn(
            "absolute inset-0 z-10 rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus",
            HIT,
          )}
          aria-expanded={!isCollapsed}
          aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${group.name}`}
          onClick={() => group.id && toggleCategory(group.id)}
        />
        <span className="flex size-5 shrink-0 items-center justify-center">
          <Icon
            name="chevronDown"
            size="xs"
            className={cn(
              "transition-transform duration-(--dur-2) ease-out",
              isCollapsed && "-rotate-90",
            )}
          />
        </span>
        <span className="min-w-0 flex-1 truncate transition-colors duration-(--dur-1) pointer-fine:group-hover:text-ink-2">
          <InlineEmojiText text={group.name} />
        </span>
        {canManageChannels && (
          <span className={ROW_ACTIONS}>
            <button
              type="button"
              className={cn(ROW_ACTION_BUTTON, "size-5 [&_svg]:size-3.5")}
              aria-label={`Create channel in ${group.name}`}
              onClick={() =>
                uiDispatch({
                  type: "SET_CREATE_CHANNEL",
                  value: {
                    categoryId: group.id?.startsWith("__") ? null : group.id,
                  },
                })
              }
            >
              <Icon name="add" size="sm" />
            </button>
          </span>
        )}
      </div>

      {/* Channels */}
      <SortableContext
        items={channelIds}
        strategy={verticalListSortingStrategy}
      >
        {group.channels.map((channel) => {
          const isActive = activeChannelId === channel.id;
          const isVoice = channel.channel_type === "voice";
          const vcMembers =
            voiceChannelStates[channel.id] ?? EMPTY_VOICE_MEMBERS;
          const isConnectedVoice =
            isVoice && vcMembers.some((m) => m.clerk_user_id === currentUserId);
          const unread =
            !isActive && isUnread(channel.id, readStates, lastMessageAt);

          return (
            <SortableChannelItem
              key={channel.id}
              channel={channel}
              isActive={isActive}
              unread={unread}
              hidden={isCollapsed && !isActive && !isConnectedVoice}
              mentionCount={channelMentionCounts[channel.id] ?? 0}
              isVoice={isVoice}
              vcMembers={vcMembers}
              localVoiceChannelId={localVoiceChannelId}
              localVoiceConnected={localVoiceConnected}
              localVoiceSessionId={localVoiceSessionId}
              listenTogetherRoomSlug={listenTogetherRoomSlug}
              currentUserId={currentUserId}
              isDraggable={canReorder}
              streamPreviewChannelId={streamPreviewChannelId}
              streamThumbnails={streamThumbnails}
              canManageChannels={canManageChannels}
              onSelect={onSelect}
              onContextMenu={handleChannelContextMenu}
              onUserContextMenu={handleUserContextMenu}
              uiDispatch={uiDispatch}
              onWatchStream={onWatchStream}
            />
          );
        })}
      </SortableContext>
    </div>
  );
});
