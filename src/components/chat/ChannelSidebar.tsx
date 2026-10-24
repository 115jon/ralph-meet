import { LONG_PRESS_TARGET, useLongPressMenu } from "@/hooks/useLongPress";
import { useContextMenu } from "@/hooks/useContextMenu";
import { useUptime } from "@/hooks/useUptime";
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
import { IconButton } from "@/components/ui/IconButton";
import { DISABLED, HIT, PRESS, REVEAL } from "@/components/ui/interaction";
import { Spinner } from "@/components/ui/button";
import {
  SIDEBAR_CATEGORY,
  SIDEBAR_ICON_SLOT,
  SIDEBAR_UNREAD_PILL,
  sidebarRowClass,
} from "@/components/ui/sidebar-row";
import { getChannelIcon } from "@/lib/channel-icon";

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { useShallow } from "zustand/shallow";
import { useTheme } from "next-themes";
import ChannelInviteModal from "./ChannelInviteModal";
import ChannelSettingsModal from "./ChannelSettingsModal";
import ContextMenu from "./ContextMenu";
import CreateCategoryModal from "./CreateCategoryModal";
import CreateChannelModal from "./CreateChannelModal";
import { AvatarImage } from "./AvatarImage";
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
  groupId: string | null;
  speakingUsers: Record<string, boolean>;
  streamPreviewChannelId: string | null;
  streamThumbnails: Record<string, string>;
  user: User | null;
  canManageChannels: boolean;
  onSelect: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, channel: Channel) => void;
  onUserContextMenu: (
    e: React.MouseEvent,
    target: {
      id: string;
      username: string;
      display_name?: string | null;
      avatar_url?: string | null;
      avatar_display?: User["avatar_display"];
    },
  ) => void;
  onCreateChannel: (categoryId: string | null) => void;
  onEditChannel: (channel: Channel) => void;
  onInviteToChannel: (channel: Channel) => void;
  onPopoverUser: (
    u: {
      id: string;
      username: string;
      display_name?: string | null;
      avatar_url?: string | null;
      avatar_display?: User["avatar_display"];
    },
    anchor: HTMLElement,
  ) => void;
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
  return (
    <div className="group/media relative overflow-hidden rounded-xl border border-white/8 bg-black/30">
      <div
        className="w-full overflow-hidden bg-black/25"
        style={{
          aspectRatio: `${Math.max(1, media.preview_width)} / ${Math.max(1, media.preview_height)}`,
        }}
      >
        {media.preview_content_type.startsWith("video/") ? (
          <video
            src={getMediaUrl(media.preview_url)}
            autoPlay
            loop
            muted
            playsInline
            aria-label="Voice channel media preview"
            className="h-full w-full object-contain transition-transform duration-200"
          />
        ) : (
          <img
            src={getAuthAssetUrl(media.preview_url)}
            alt={media.alt_text ?? "Voice channel status media"}
            className="h-full w-full object-contain transition-transform duration-200"
            loading="lazy"
          />
        )}
      </div>

      {!readOnly && (
        <div className="absolute right-2 top-2 z-10 flex items-center gap-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Change media"
                className={cn(
                  // Media overlay chip over the channel media (6.5).
                  "flex size-8 items-center justify-center rounded-full bg-black/60 text-white",
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
                  "flex size-8 items-center justify-center rounded-full bg-black/60 text-white",
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

function SortableChannelItem({
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
  groupId: _groupId,
  speakingUsers,
  streamPreviewChannelId,
  streamThumbnails,
  user: _user,
  canManageChannels,
  onSelect,
  onContextMenu,
  onUserContextMenu,
  onCreateChannel: _onCreateChannel,
  onEditChannel,
  onInviteToChannel,
  onPopoverUser,
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

  const voiceStartedAt = useChatStore((s) =>
    isVoice && vcMembers.length > 0
      ? (s.voiceChannelStartedAt[channel.id] ?? null)
      : null,
  );
  const uptime = useUptime(voiceStartedAt, isVoice && vcMembers.length > 0);
  const currentVoiceMember =
    vcMembers.find((member) => member.clerk_user_id === currentUserId) ?? null;
  const shouldRenderVoiceStatus = Boolean(
    isVoice &&
    currentVoiceMember &&
    localVoiceConnected &&
    localVoiceSessionId &&
    localVoiceChannelId === channel.id &&
    !isVoiceMemberReconnecting(currentVoiceMember),
  );
  const currentStatusText = channel.voice_status?.text ?? null;
  const textStatus = currentStatusText?.trim() ?? "";
  const mediaStatus = channel.voice_status?.media ?? null;
  const textStatusLabel = textStatus ? "Edit status" : "Set status";
  const mediaStatusLabel = mediaStatus ? "Change media" : "Set media";
  const voiceSessionHeaders = localVoiceSessionId
    ? { "X-Voice-Session-Id": localVoiceSessionId }
    : undefined;
  // Read-only view: user is not in this voice channel but the channel has an active status to display.
  // Only shown when at least one member is currently present in the channel.
  const shouldRenderVoiceStatusReadOnly = Boolean(
    isVoice &&
    !shouldRenderVoiceStatus &&
    vcMembers.length > 0 &&
    (textStatus || mediaStatus),
  );

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

  return (
    <div ref={setNodeRef} style={style}>
      <div
        className={sidebarRowClass({
          selected: isActive,
          unread,
          className: "cursor-pointer",
        })}
      >
        <button
          type="button"
          onClick={() => onSelect(channel.id)}
          onContextMenu={(e) => onContextMenu(e, channel)}
          {...channelLongPress}
          aria-label={`Open ${isVoice ? "voice" : "text"} channel ${channel.name}`}
          aria-current={isActive ? "page" : undefined}
          className={cn(
            "absolute inset-0 z-10 rounded-md outline-none",
            LONG_PRESS_TARGET,
          )}
        />
        {/* Drag handle: sits in the list's 8px gutter so it takes no width
            from the row; revealed on fine-pointer hover only. */}
        {isDraggable && (
          <span
            className="absolute top-1/2 -left-2 z-20 flex h-5 w-3 -translate-y-1/2 cursor-grab items-center justify-center text-rm-text-muted opacity-0 transition-opacity duration-150 active:cursor-grabbing pointer-fine:group-hover:opacity-100"
            {...attributes}
            {...listeners}
          >
            <Icon name="dragHandle" size="xs" />
          </span>
        )}

        <span className={SIDEBAR_ICON_SLOT}>
          <Icon name={getChannelIcon(channel)} size="md" />
        </span>

        <InlineEmojiText
          text={channel.name}
          className="min-w-0 flex-1 truncate"
        />

        {/* Icons column */}
        <div className="flex shrink-0 items-center gap-1">
          {/* Mention count badge */}
          {mentionCount > 0 && (
            <div className="badge-count">
              {mentionCount > 99 ? "99+" : mentionCount}
            </div>
          )}
          {/* Voice channel uptime — visible by default, hidden on hover */}
          {uptime && (
            <span className="block text-ui-xs font-medium tabular-nums text-rm-success-ink pointer-fine:group-hover:hidden pointer-fine:group-focus-within:hidden">
              {uptime}
            </span>
          )}
          {/* Action buttons (mutually exclusive with uptime). Hover-revealed,
              so hidden on touch, where the long-press sheet has both. */}
          <div
            className={cn(
              "relative z-20 items-center gap-1 pointer-coarse:hidden!",
              uptime
                ? "hidden pointer-fine:group-hover:flex pointer-fine:group-focus-within:flex"
                : "flex",
            )}
          >
            {canManage && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="Channel settings"
                    className={cn(
                      "flex size-6 items-center justify-center rounded-sm text-rm-text-muted pointer-fine:hover:bg-rm-tint-2 pointer-fine:hover:text-rm-text",
                      REVEAL,
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      onEditChannel(channel);
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
                  className={cn(
                    "flex size-6 items-center justify-center rounded-sm text-rm-text-muted pointer-fine:hover:bg-rm-tint-2 pointer-fine:hover:text-rm-text",
                    REVEAL,
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    onInviteToChannel(channel);
                  }}
                >
                  <Icon name="invite" size="sm" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={8}>
                Invite to channel
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        {unread && <span aria-hidden className={SIDEBAR_UNREAD_PILL} />}
      </div>

      {isVoice && localVoiceChannelId === channel.id && (
        <ListenTogetherSidebarStatus roomSlug={listenTogetherRoomSlug} />
      )}

      {shouldRenderVoiceStatus && (
        <>
          <div className="mb-1 ml-8">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="group/text inline-flex max-w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-left transition-colors pointer-fine:hover:bg-rm-tint-1"
                  onClick={(event) => {
                    event.stopPropagation();
                    setIsVoiceTextStatusOpen(true);
                  }}
                >
                  <span
                    className={cn(
                      "truncate text-ui-xs font-medium leading-4",
                      textStatus
                        ? "text-rm-text-secondary"
                        : "text-rm-text-muted",
                    )}
                  >
                    <InlineEmojiText
                      text={textStatus || "Set a channel status"}
                    />
                  </span>
                  <Icon
                    name="edit"
                    size="xs"
                    className="shrink-0 text-rm-text-muted transition-colors pointer-fine:group-hover/text:text-rm-text"
                  />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={8}>
                {textStatusLabel}
              </TooltipContent>
            </Tooltip>
          </div>

          <div className="mb-2 ml-8">
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
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="group/vibe flex min-h-[96px] w-full flex-col items-start justify-center rounded-lg border border-dashed border-rm-border-strong bg-rm-tint-1 px-4 py-4 text-left text-rm-text-muted transition-colors pointer-fine:hover:border-rm-accent-ink pointer-fine:hover:bg-rm-tint-2 pointer-fine:hover:text-rm-text md:min-h-[108px]"
                    onClick={(event) => {
                      event.stopPropagation();
                      setIsVoiceMediaStatusOpen(true);
                    }}
                  >
                    <div className="mb-2 inline-flex h-9 w-9 items-center justify-center rounded-md bg-rm-tint-2 text-rm-text-muted transition-colors pointer-fine:group-hover/vibe:bg-rm-tint-3 pointer-fine:group-hover/vibe:text-rm-text">
                      <Icon name="sparkle" size="sm" />
                    </div>
                    <span className="text-ui-sm font-semibold text-rm-text">
                      Set the vibe
                    </span>
                    <span className="mt-1 text-ui-xs leading-5 text-rm-text-muted">
                      Add a GIF, still image, or short clip for this channel.
                    </span>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={8}>
                  {mediaStatusLabel}
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </>
      )}

      {/* Read-only voice channel status — visible to users not currently in the voice channel */}
      {shouldRenderVoiceStatusReadOnly && (
        <>
          {textStatus && (
            <div className="mb-1 ml-8">
              <span className="inline-block max-w-full truncate px-1 py-0.5 text-ui-xs font-medium leading-4 text-rm-text-secondary">
                <InlineEmojiText text={textStatus} />
              </span>
            </div>
          )}

          {mediaStatus && (
            <div className="mb-2 ml-8">
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
            </div>
          )}
        </>
      )}

      {/* Voice Members List */}
      {isVoice && vcMembers.length > 0 && (
        <div className="mb-1 flex flex-col gap-0.5">
          {vcMembers.map((m) => (
            <VoiceChannelMemberRow
              key={m.clerk_user_id}
              member={m}
              channelId={channel.id}
              isCurrentUser={m.clerk_user_id === currentUserId}
              isCurrentClientVoiceConnected={
                localVoiceConnected && localVoiceChannelId === channel.id
              }
              isSpeaking={!!speakingUsers[m.clerk_user_id]}
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
        </div>
      )}

      <>
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
      </>
    </div>
  );
}

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
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const timeout = setTimeout(() => setMounted(true), 0);
    return () => clearTimeout(timeout);
  }, []);
  const isMiku =
    mounted &&
    (resolvedTheme === "miku-light" || resolvedTheme === "miku-dark");
  const isSpiderman =
    mounted &&
    (resolvedTheme === "spiderman-light" || resolvedTheme === "spiderman-dark");
  const { user, speakingUsers } = useChatStore(
    useShallow((s) => ({ user: s.user, speakingUsers: s.speakingUsers })),
  );
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
    deleteChannel,
    deleteCategory,
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

  const toggleCategory = (catId: string) => {
    uiDispatch({ type: "TOGGLE_CATEGORY", id: catId });
  };

  const grouped = groupChannelsByCategory(channels, categories);

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
    <TooltipProvider delayDuration={0}>
      <div
        className="flex h-full flex-col bg-rm-bg-secondary select-none border-x border-rm-border overflow-hidden"
        onContextMenu={handleSidebarContextMenu}
      >
        {/* Server Header */}
        {isMiku || isSpiderman ? (
          <button
            type="button"
            className="server-banner-box flex cursor-pointer flex-col justify-start p-4 relative border-b-2 border-rm-border select-none outline-none group/banner overflow-hidden shrink-0"
            aria-label="Open server menu"
            onClick={handleServerHeaderClick}
          >
            <div className="server-banner-content relative z-10 text-white flex flex-col items-start w-full">
              <h1 className="font-black text-ui-xl tracking-wide leading-tight uppercase truncate max-w-full drop-shadow-md">
                {serverName.split(" ").map((word, i) => (
                  <span key={i} className="block">
                    <InlineEmojiText text={word} />
                  </span>
                ))}
              </h1>
              <div className="flex items-center gap-2 mt-1 opacity-90">
                <span className="font-black text-ui-lg text-white/50">
                  {isMiku ? "01" : "🕸️"}
                </span>
                <span className="text-ui-2xs font-semibold uppercase tracking-[0.08em]">
                  {isMiku ? "初音ミク" : "SPIDER-MAN"}
                </span>
              </div>
            </div>
            <Icon
              name="chevronDown"
              size="xs"
              className="absolute right-3 bottom-3 text-rm-text/75 dark:text-white/60 pointer-fine:group-hover/banner:opacity-100 transition-opacity z-10"
            />
          </button>
        ) : (
          <button
            type="button"
            className="flex cursor-pointer items-center justify-between border-b border-rm-border px-4 font-semibold text-rm-text transition-colors pointer-fine:hover:bg-rm-tint-1 active:bg-rm-tint-2 outline-none"
            style={{
              height: "calc(48px + var(--safe-area-top, 0px))",
              paddingTop: "var(--safe-area-top, 0px)",
            }}
            aria-label="Open server menu"
            onClick={handleServerHeaderClick}
          >
            <div className="flex items-center min-w-0">
              <InlineEmojiText
                text={serverName}
                className="truncate text-ui-base"
              />
              <Icon
                name="chevronDown"
                size="xs"
                className="ml-1 shrink-0 text-rm-text-muted"
              />
            </div>
          </button>
        )}

        {/* Channels List */}
        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-2 py-2 scrollbar-thin">
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
                user={user}
                speakingUsers={speakingUsers}
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

interface UseSidebarContextMenusProps {
  canManageChannels: boolean;
  serverId?: string;
  onInviteClick?: () => void;
  onSettingsClick?: () => void;
  deleteChannel: (id: string) => void;
  deleteCategory: (serverId: string, categoryId: string) => void;
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
  deleteChannel,
  deleteCategory,
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
            const path = `/channels/${serverId ?? ""}/${channel.id}`;
            navigator.clipboard.writeText(`${window.location.origin}${path}`);
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
                onClick: () => {
                  if (confirm(`Delete channel "${channel.name}"?`)) {
                    deleteChannel(channel.id);
                  }
                },
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
            <span className="text-ui-2xs font-bold bg-rm-bg-surface border border-rm-border rounded px-1 py-0.5 leading-none">
              ID
            </span>
          ),
          onClick: () => navigator.clipboard.writeText(channel.id),
        },
      ];
      openMenu(e, items);
    },
    [
      canManageChannels,
      deleteChannel,
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
          onClick: () => navigator.clipboard.writeText(group.id!),
        },
        ...(canManageChannels
          ? [
              {
                label: "Delete category",
                icon: <Icon name="trash" size="sm" />,
                onClick: () => {
                  if (serverId && group.id) {
                    if (confirm(`Delete category "${group.name}"?`)) {
                      deleteCategory(serverId, group.id);
                    }
                  }
                },
                variant: "danger" as const,
              },
            ]
          : []),
      ]);
    },
    [canManageChannels, deleteCategory, openMenu, serverId, uiDispatch],
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
          onClick: () => serverId && navigator.clipboard.writeText(serverId),
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

// ── Voice Channel Member Row ────────────────────────────────────────────────
// Resolves the user's avatar from the server members store as a fallback when
// the gateway-provided VoiceChannelMember.avatar_url is missing (e.g. when the
// user hasn't uploaded a custom avatar and the Clerk profile fetch didn't run).

interface VoiceChannelMemberRowProps {
  member: VoiceChannelMember;
  channelId: string;
  isCurrentUser: boolean;
  isCurrentClientVoiceConnected: boolean;
  isSpeaking: boolean;
  streamThumbnailUrl: string | null;
  onContextMenu: (
    e: React.MouseEvent,
    target: {
      id: string;
      username: string;
      display_name?: string | null;
      avatar_url?: string | null;
      avatar_display?: User["avatar_display"];
    },
  ) => void;
  onPopoverUser: (
    u: {
      id: string;
      username: string;
      display_name?: string | null;
      avatar_url?: string | null;
      avatar_display?: User["avatar_display"];
    },
    anchor: HTMLElement,
  ) => void;
  onWatchStream?: (channelId: string, userId: string) => void;
}

function VoiceChannelMemberRow({
  member,
  channelId,
  isCurrentUser,
  isCurrentClientVoiceConnected,
  isSpeaking,
  streamThumbnailUrl,
  onContextMenu,
  onPopoverUser,
  onWatchStream,
}: VoiceChannelMemberRowProps) {
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

  return (
    <>
      <button
        type="button"
        data-voice-connection-state={
          isReconnecting ? "reconnecting" : "connected"
        }
        className={cn(
          sidebarRowClass(),
          "group/vc-user",
          isReconnecting && "opacity-50 grayscale",
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
        {/* Empty icon slot: the avatar starts on the channel name's edge. */}
        <span aria-hidden className="size-5 shrink-0" />
        <span
          className={cn(
            "relative size-6 shrink-0 overflow-hidden rounded-full",
            isSpeaking &&
              "ring-2 ring-rm-success ring-offset-2 ring-offset-rm-bg-secondary",
          )}
        >
          {resolvedIdentity.avatarUrl ? (
            <AvatarImage
              src={getAuthAssetUrl(resolvedIdentity.avatarUrl)}
              alt=""
              display={resolvedAvatarDisplay}
            />
          ) : (
            <span className="flex size-full items-center justify-center bg-rm-accent-tint text-ui-2xs font-semibold text-rm-accent-ink">
              {resolvedIdentity.name[0]?.toUpperCase()}
            </span>
          )}
        </span>
        <UserDisplayName
          text={resolvedIdentity.name}
          displayNameStyle={resolvedDisplayNameStyle}
          className="min-w-0 flex-1 truncate"
        />
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {shouldShowStreamState && (
            <span className="rounded-xs bg-rm-danger px-1 text-ui-2xs font-semibold leading-4 text-rm-on-danger">
              LIVE
            </span>
          )}
          {activity && (
            <Icon name="activities" size="sm" className="text-rm-accent-ink" />
          )}
          <div className="flex items-center gap-1 text-rm-text-muted">
            {member.self_video && (
              <Icon name="camera" state="active" size="sm" />
            )}
            {member.self_mute && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span aria-label="Self-muted">
                    <Icon
                      name="mic"
                      state="off"
                      size="sm"
                      className="text-rm-danger-ink"
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
                  <span aria-label="Self-deafened">
                    <Icon
                      name="deafen"
                      state="off"
                      size="sm"
                      className="text-rm-danger-ink"
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
                  <span aria-label="Muted by you">
                    <Icon
                      name="speakerOff"
                      size="sm"
                      className="text-rm-danger-ink"
                    />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={6}>
                  Muted by you
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
      </button>

      {shouldShowStreamState && streamPreviewPosition && (
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
    </>
  );
}

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
  user: User | null;
  speakingUsers: Record<string, boolean>;
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
    target: {
      id: string;
      username: string;
      display_name?: string | null;
      avatar_url?: string | null;
      avatar_display?: User["avatar_display"];
    },
  ) => void;
  uiDispatch: React.Dispatch<SidebarAction>;
  onWatchStream?: (channelId: string, userId: string) => void;
}

function ChannelCategoryGroup({
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
  user,
  speakingUsers,
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
  const channelIds = group.channels.map((c) => c.id);
  const categoryLongPress = useLongPressMenu((e) =>
    handleCategoryContextMenu(e, group),
  );

  return (
    <div className="group/category flex flex-col gap-0.5">
      {/* Category Header: first group pt-2, the rest pt-4 (12.3). */}
      <div
        className={cn(
          SIDEBAR_CATEGORY,
          "pr-0 group-first/category:pt-2",
          LONG_PRESS_TARGET,
        )}
        onContextMenu={(e) => handleCategoryContextMenu(e, group)}
        {...categoryLongPress}
      >
        <button
          type="button"
          className={cn(
            "relative flex min-w-0 flex-1 items-center gap-1 self-stretch rounded-sm text-left uppercase outline-none transition-colors duration-150 pointer-fine:hover:text-rm-text pointer-coarse:min-h-11",
            HIT,
          )}
          aria-expanded={!isCollapsed}
          aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${group.name}`}
          onClick={() => group.id && toggleCategory(group.id)}
        >
          <Icon
            name="chevronDown"
            size="xs"
            className={cn(
              "shrink-0 transition-transform duration-150 ease-(--rm-ease-out) motion-reduce:transition-none",
              isCollapsed && "-rotate-90",
            )}
          />
          <span className="truncate">
            <InlineEmojiText text={group.name} />
          </span>
        </button>
        {canManageChannels && (
          <IconButton
            icon="add"
            size="xs"
            variant="muted"
            aria-label={`Create channel in ${group.name}`}
            onClick={() =>
              uiDispatch({
                type: "SET_CREATE_CHANNEL",
                value: {
                  categoryId: group.id?.startsWith("__") ? null : group.id,
                },
              })
            }
          />
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
          const vcMembers = voiceChannelStates[channel.id] || [];
          const isConnectedVoice =
            isVoice && vcMembers.some((m) => m.clerk_user_id === currentUserId);

          if (isCollapsed && !isActive && !isConnectedVoice) {
            return null;
          }

          const unread =
            !isActive && isUnread(channel.id, readStates, lastMessageAt);

          return (
            <SortableChannelItem
              key={channel.id}
              channel={channel}
              isActive={isActive}
              unread={unread}
              mentionCount={channelMentionCounts[channel.id] ?? 0}
              isVoice={isVoice}
              vcMembers={vcMembers}
              localVoiceChannelId={localVoiceChannelId}
              localVoiceConnected={localVoiceConnected}
              localVoiceSessionId={localVoiceSessionId}
              listenTogetherRoomSlug={listenTogetherRoomSlug}
              currentUserId={currentUserId}
              isDraggable={canReorder}
              groupId={group.id}
              speakingUsers={speakingUsers}
              streamPreviewChannelId={streamPreviewChannelId}
              streamThumbnails={streamThumbnails}
              user={user}
              canManageChannels={canManageChannels}
              onSelect={onSelect}
              onContextMenu={handleChannelContextMenu}
              onUserContextMenu={handleUserContextMenu}
              onCreateChannel={(categoryId) =>
                uiDispatch({
                  type: "SET_CREATE_CHANNEL",
                  value: { categoryId },
                })
              }
              onEditChannel={(ch) =>
                uiDispatch({ type: "SET_CHANNEL_SETTINGS", value: ch.id })
              }
              onInviteToChannel={(ch) =>
                uiDispatch({ type: "SET_INVITE_CHANNEL", value: ch.id })
              }
              onPopoverUser={(u, anchor) =>
                uiDispatch({ type: "SET_POPOVER_USER", user: u, anchor })
              }
              onWatchStream={onWatchStream}
            />
          );
        })}
      </SortableContext>
    </div>
  );
}
