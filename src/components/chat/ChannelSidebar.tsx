
import { useContextMenu } from "@/hooks/useContextMenu";
import { useUptime } from "@/hooks/useUptime";
import { apiPatch } from "@/lib/api-client";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { getAuthAssetUrl, getMediaUrl } from "@/lib/platform";
import { isVoiceMemberReconnecting, shouldShowVoiceMemberStreamState } from "@/lib/voice-presence";
import { resolveVoiceIdentity } from "@/lib/voice-identity";
import type { Category, Channel, User, VoiceChannelStatusMedia } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { VoiceChannelMember } from "@/stores/chat-store";
import { useChatActions, useChatStore } from "@/stores/chat-store";
import { useVoiceActivityStore } from "@/stores/useVoiceActivityStore";
import { useVoiceSettingsStore } from "@/stores/useVoiceSettingsStore";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
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
import {
  Bell,
  CalendarPlus,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Copy,
  CopyPlus,
  Edit2,
  EyeOff,
  FolderPlus,
  Gamepad2,
  Gem,
  GripVertical,
  Hash,
  LayoutGrid,
  Link,
  Loader2,
  MicOff,
  Plus,
  PlusCircle,
  Settings,
  Shield,
  Sparkles,
  Trash2,
  UserPlus,
  Volume2,
  VolumeX
} from "lucide-react";

import { lazy, Suspense, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useShallow } from "zustand/shallow";
import { useTheme } from "next-themes";
import ChannelInviteModal from "./ChannelInviteModal";
import ChannelSettingsModal from "./ChannelSettingsModal";
import ContextMenu from "./ContextMenu";
import CreateCategoryModal from "./CreateCategoryModal";
import CreateChannelModal from "./CreateChannelModal";
import UserProfilePopover from "./UserProfilePopover";
import { VoiceStreamHoverCard } from "./VoiceStreamHoverCard";
import VoiceChannelMediaStatusModal from "./VoiceChannelMediaStatusModal";
import VoiceChannelTextStatusModal from "./VoiceChannelTextStatusModal";
import { useDelayUnmount } from "@/hooks/useDelayUnmount";

const StreamContextMenu = lazy(() =>
  import("../StreamContextMenu").then((mod) => ({ default: mod.StreamContextMenu }))
);
const EMPTY_STREAM_THUMBNAILS: Record<string, string> = {};

const EMPTY_CATEGORIES: Category[] = [];
const EMPTY_READ_STATES: Record<string, string> = {};
const EMPTY_LAST_MESSAGE_AT: Record<string, string> = {};
const EMPTY_VOICE_STATES: Record<string, VoiceChannelMember[]> = {};
const EMPTY_MENTION_COUNTS: Record<string, number> = {};
const CHANNEL_TOOLTIP_CONTENT_CLASS = "bg-rm-bg-floating border-none text-rm-text-primary text-[13px] font-bold shadow-xl px-3 py-2 rounded-lg";
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
  target: { id: string; username: string; display_name?: string | null; avatar_url?: string | null };
}

function isUnread(
  channelId: string,
  readStates: Record<string, string>,
  lastMessageAt: Record<string, string>
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

function groupChannelsByCategory(channels: Channel[], categories: Category[]): CategoryGroup[] {
  const groups: CategoryGroup[] = [];
  const catMap = new Map<string, Category>();
  for (const cat of categories) {
    catMap.set(cat.id, cat);
  }

  // 1. Uncategorized channels (sorted by position)
  const uncategorizedText = channels.filter(c => !c.category_id && c.channel_type === "text").sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const uncategorizedVoice = channels.filter(c => !c.category_id && c.channel_type === "voice").sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  if (uncategorizedText.length > 0) {
    groups.push({ id: "__uncategorized_text__", name: "TEXT CHANNELS", channels: uncategorizedText });
  }
  if (uncategorizedVoice.length > 0) {
    groups.push({ id: "__uncategorized_voice__", name: "VOICE CHANNELS", channels: uncategorizedVoice });
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
    const chans = (byCategory.get(cat.id) ?? []).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
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
  onUserContextMenu: (e: React.MouseEvent, target: { id: string; username: string; display_name?: string | null; avatar_url?: string | null }) => void;
  onCreateChannel: (categoryId: string | null) => void;
  onEditChannel: (channel: Channel) => void;
  onInviteToChannel: (channel: Channel) => void;
  onPopoverUser: (u: { id: string; username: string; display_name?: string | null; avatar_url?: string | null }, anchor: HTMLElement) => void;
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
    <div className="group/media relative overflow-hidden rounded-[18px] border border-white/8 bg-black/30 shadow-[0_16px_34px_rgba(0,0,0,0.28)]">
      <div
        className="w-full overflow-hidden bg-black/25"
        style={{ aspectRatio: `${Math.max(1, media.preview_width)} / ${Math.max(1, media.preview_height)}` }}
      >
        {media.preview_content_type.startsWith("video/") ? (
          <video
            src={getMediaUrl(media.preview_url)}
            autoPlay
            loop
            muted
            playsInline
            aria-label="Voice channel media preview"
            className="h-full w-full object-contain transition-transform duration-300 md:group-hover/media:scale-[1.02]"
          />
        ) : (
          <img
            src={getAuthAssetUrl(media.preview_url)}
            alt={media.alt_text ?? "Voice channel status media"}
            className="h-full w-full object-contain transition-transform duration-300 md:group-hover/media:scale-[1.02]"
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
                className="flex h-8 w-8 items-center justify-center rounded-full border border-white/12 bg-black/60 text-white/85 shadow-lg backdrop-blur-sm transition-all hover:border-white/30 hover:bg-black/75 hover:text-white md:translate-y-1 md:opacity-0 md:group-hover/media:translate-y-0 md:group-hover/media:opacity-100"
                onClick={(event) => {
                  event.stopPropagation();
                  onChange();
                }}
              >
                <Edit2 className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={8} className={CHANNEL_TOOLTIP_CONTENT_CLASS}>
              Change media
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Remove media"
                disabled={isRemoving}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-white/12 bg-black/60 text-white/85 shadow-lg backdrop-blur-sm transition-all hover:border-red-400/50 hover:bg-red-500/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-60 md:translate-y-1 md:opacity-0 md:group-hover/media:translate-y-0 md:group-hover/media:opacity-100"
                onClick={(event) => {
                  event.stopPropagation();
                  onRemove();
                }}
              >
                {isRemoving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={8} className={CHANNEL_TOOLTIP_CONTENT_CLASS}>
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
  currentUserId,
  isDraggable,
  groupId,
  speakingUsers,
  streamPreviewChannelId,
  streamThumbnails,
  user,
  canManageChannels,
  onSelect,
  onContextMenu,
  onUserContextMenu,
  onCreateChannel,
  onEditChannel,
  onInviteToChannel,
  onPopoverUser,
  onWatchStream,
}: SortableChannelItemProps) {
  const { dispatch } = useChatActions();
  // Combine server-wide permission with per-channel override
  const canManage = canManageChannels ||
    (channel.permissions != null && hasPermission(channel.permissions, PERMISSIONS.MANAGE_CHANNELS));
  const [isVoiceTextStatusOpen, setIsVoiceTextStatusOpen] = useState(false);
  const shouldRenderTextStatus = useDelayUnmount(isVoiceTextStatusOpen, 200);
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

  const voiceStartedAt = useChatStore(s => isVoice && vcMembers.length > 0 ? s.voiceChannelStartedAt[channel.id] ?? null : null);
  const uptime = useUptime(voiceStartedAt, isVoice && vcMembers.length > 0);
  const currentVoiceMember = vcMembers.find((member) => member.clerk_user_id === currentUserId) ?? null;
  const shouldRenderVoiceStatus = Boolean(
    isVoice &&
    currentVoiceMember &&
    localVoiceConnected &&
    localVoiceSessionId &&
    localVoiceChannelId === channel.id &&
    !isVoiceMemberReconnecting(currentVoiceMember)
  );
  const currentStatusText = channel.voice_status?.text ?? null;
  const textStatus = currentStatusText?.trim() ?? "";
  const mediaStatus = channel.voice_status?.media ?? null;
  const textStatusLabel = textStatus ? "Edit status" : "Set status";
  const mediaStatusLabel = mediaStatus ? "Change media" : "Set media";
  const voiceSessionHeaders = localVoiceSessionId ? { "X-Voice-Session-Id": localVoiceSessionId } : undefined;
  // Read-only view: user is not in this voice channel but the channel has an active status to display.
  // Only shown when at least one member is currently present in the channel.
  const shouldRenderVoiceStatusReadOnly = Boolean(
    isVoice &&
    !shouldRenderVoiceStatus &&
    vcMembers.length > 0 &&
    (textStatus || mediaStatus)
  );

  const handleRemoveVoiceMedia = async () => {
    if (!mediaStatus || isRemovingVoiceMedia) return;
    setIsRemovingVoiceMedia(true);

    try {
      const updatedChannel = await apiPatch<Channel>(`/api/channels/${channel.id}/voice-status`, {
        voice_status: currentStatusText ? { text: currentStatusText, media: null } : null,
      }, { headers: voiceSessionHeaders });
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
        className={cn(
          "group relative mb-[2px] mx-2 flex cursor-pointer items-center gap-1.5 rounded-[4px] px-2 py-1.5 transition-colors outline-none",
          isActive ? "bg-rm-bg-active text-rm-text" : "text-rm-text-muted hover:bg-rm-bg-hover hover:text-rm-text-muted",
          unread && !isActive && "text-rm-text font-semibold"
        )}
      >
        <button
          type="button"
          onClick={() => onSelect(channel.id)}
          onContextMenu={(e) => onContextMenu(e, channel)}
          aria-label={`Open ${isVoice ? "voice" : "text"} channel ${channel.name}`}
          className="absolute inset-0 z-10 rounded-[4px] outline-none"
        />
        {/* Drag handle */}
        {isDraggable && (
          <GripVertical
            className="relative z-20 h-3 w-3 shrink-0 cursor-grab opacity-0 transition-opacity active:cursor-grabbing group-hover:opacity-40 hover:!opacity-80"
            {...attributes}
            {...listeners}
          />
        )}

        {isVoice ? (
          <Volume2 className="h-4 w-4 shrink-0 opacity-60" />
        ) : (
          <Hash className="h-4 w-4 shrink-0 opacity-60" />
        )}

        <span className="flex-1 truncate text-[15px] font-medium">
          {channel.name}
        </span>

        {/* Icons column */}
        <div className="flex items-center gap-1">
          {/* Mention count badge */}
          {mentionCount > 0 && (
            <div className="flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white leading-none">
              {mentionCount > 99 ? "99+" : mentionCount}
            </div>
          )}
          {/* Voice channel uptime — visible by default, hidden on hover */}
          {uptime && (
            <span className="text-[11px] font-mono font-medium text-[#23a559] block group-hover:hidden translate-y-px">
              {uptime}
            </span>
          )}
          {/* Action buttons (mutually exclusive with uptime) */}
          <div className={cn("relative z-20 items-center gap-1", uptime ? "hidden group-hover:flex" : "flex")}>
            {canManage && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="Channel settings"
                    className="flex h-5 w-5 items-center justify-center rounded-md opacity-0 transition-opacity group-hover:opacity-60 hover:!opacity-100 hover:bg-black/10"
                    onClick={(e) => {
                      e.stopPropagation();
                      onEditChannel(channel);
                    }}
                  >
                    <Settings className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={8} className={CHANNEL_TOOLTIP_CONTENT_CLASS}>
                  Channel settings
                </TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="Invite to channel"
                  className="flex h-5 w-5 items-center justify-center rounded-md opacity-0 transition-opacity group-hover:opacity-60 hover:!opacity-100 hover:bg-black/10"
                  onClick={(e) => {
                    e.stopPropagation();
                    onInviteToChannel(channel);
                  }}
                >
                  <UserPlus className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={8} className={CHANNEL_TOOLTIP_CONTENT_CLASS}>
                Invite to channel
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Unread dot */}
        {unread && (
          <div className="absolute -left-2 h-2 w-1 rounded-r-full bg-rm-text" />
        )}
      </div>

      {shouldRenderVoiceStatus && (
        <>
          <div className="mb-1 ml-7 mr-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="group/text inline-flex max-w-full items-center gap-1.5 rounded-lg px-1 py-0.5 text-left transition-colors hover:bg-white/6"
                  onClick={(event) => {
                    event.stopPropagation();
                    setIsVoiceTextStatusOpen(true);
                  }}
                >
                  <span className={cn(
                    "truncate text-[12px] font-medium leading-4",
                    textStatus ? "text-rm-text-secondary" : "text-rm-text-muted"
                  )}>
                    {textStatus || "Set a channel status"}
                  </span>
                  <Edit2 className="h-3 w-3 shrink-0 text-rm-text-muted transition-colors group-hover/text:text-rm-text" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={8} className={CHANNEL_TOOLTIP_CONTENT_CLASS}>
                {textStatusLabel}
              </TooltipContent>
            </Tooltip>
          </div>

          <div className="mb-2 ml-7 mr-2">
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
                    className="group/vibe flex min-h-[96px] w-full flex-col items-start justify-center rounded-[18px] border border-dashed border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] px-4 py-4 text-left text-rm-text-muted transition-colors hover:border-primary/35 hover:bg-rm-bg-hover hover:text-rm-text sm:min-h-[108px]"
                    onClick={(event) => {
                      event.stopPropagation();
                      setIsVoiceMediaStatusOpen(true);
                    }}
                  >
                    <div className="mb-2 inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-white/8 text-rm-text-muted transition-colors group-hover/vibe:bg-white/10 group-hover/vibe:text-rm-text">
                      <Sparkles className="h-4 w-4" />
                    </div>
                    <span className="text-[13px] font-semibold text-rm-text">Set the vibe</span>
                    <span className="mt-1 text-[12px] leading-5 text-rm-text-muted">
                      Add a GIF, still image, or short clip for this channel.
                    </span>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={8} className={CHANNEL_TOOLTIP_CONTENT_CLASS}>
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
            <div className="mb-1 ml-7 mr-2">
              <span className="inline-block max-w-full truncate px-1 py-0.5 text-[12px] font-medium leading-4 text-rm-text-secondary">
                {textStatus}
              </span>
            </div>
          )}

          {mediaStatus && (
            <div className="mb-2 ml-7 mr-2">
              <VoiceChannelMediaDisplay
                media={mediaStatus}
                isRemoving={false}
                readOnly
                onChange={() => { /* no-op: read-only */ }}
                onRemove={() => { /* no-op: read-only */ }}
              />
            </div>
          )}
        </>
      )}

      {/* Voice Members List */}
      {isVoice && vcMembers.length > 0 && (
        <div className="mb-2 ml-7 flex flex-col gap-0.5">
          {vcMembers.map((m) => (
            <VoiceChannelMemberRow
              key={m.clerk_user_id}
              member={m}
              channelId={channel.id}
              isCurrentUser={m.clerk_user_id === currentUserId}
              isCurrentClientVoiceConnected={localVoiceConnected && localVoiceChannelId === channel.id}
              isSpeaking={!!speakingUsers[m.clerk_user_id]}
              streamThumbnailUrl={
                streamPreviewChannelId === channel.id
                  ? (streamThumbnails[m.clerk_user_id] ?? m.stream_preview_url ?? null)
                  : (m.stream_preview_url ?? null)
              }
              onContextMenu={onUserContextMenu}
              onPopoverUser={onPopoverUser}
              onWatchStream={onWatchStream}
            />
          ))}
        </div>
      )}

      {shouldRenderTextStatus ? (
        <VoiceChannelTextStatusModal
          channel={channel}
          voiceSessionId={localVoiceSessionId}
          onClose={() => setIsVoiceTextStatusOpen(false)}
          isClosing={!isVoiceTextStatusOpen}
        />
      ) : null}

      {isVoiceMediaStatusOpen ? (
        <VoiceChannelMediaStatusModal
          channel={channel}
          voiceSessionId={localVoiceSessionId}
          onClose={() => setIsVoiceMediaStatusOpen(false)}
        />
      ) : null}
    </div>
  );
}

// ── Types ────────────────────────────────────────────────────────────────

type SidebarState = {
  collapsedCategories: Set<string>;
  showCreateCategory: boolean;
  showCreateChannel: { categoryId: string | null } | null;
  showChannelSettings: Channel | null;
  inviteChannel: Channel | null;
  popoverUser: { id: string; username: string; display_name?: string | null; avatar_url?: string | null } | null;
  popoverAnchor: HTMLElement | null;
};

type SidebarAction =
  | { type: 'TOGGLE_CATEGORY'; id: string }
  | { type: 'SET_CREATE_CATEGORY'; value: boolean }
  | { type: 'SET_CREATE_CHANNEL'; value: { categoryId: string | null } | null }
  | { type: 'SET_CHANNEL_SETTINGS'; value: Channel | null }
  | { type: 'SET_INVITE_CHANNEL'; value: Channel | null }
  | { type: 'SET_POPOVER_USER'; user: { id: string; username: string; display_name?: string | null; avatar_url?: string | null } | null; anchor: HTMLElement | null };

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
  const isMiku = mounted && (resolvedTheme === "miku-light" || resolvedTheme === "miku-dark");
  const isSpiderman = mounted && (resolvedTheme === "spiderman-light" || resolvedTheme === "spiderman-dark");
  const {
    user,
    speakingUsers,
  } = useChatStore(useShallow(s => ({ user: s.user, speakingUsers: s.speakingUsers })));
  const effectiveCurrentUserId = currentUserId ?? user?.id ?? null;
  const { deleteChannel, deleteCategory, openDm, dispatch, setProfileUser, reorderChannels, markChannelRead, createChannel } = useChatActions();

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const [state, uiDispatch] = useReducer((s: SidebarState, a: SidebarAction) => {
    switch (a.type) {
      case 'TOGGLE_CATEGORY': {
        const next = new Set(s.collapsedCategories);
        if (next.has(a.id)) next.delete(a.id); else next.add(a.id);
        return { ...s, collapsedCategories: next };
      }
      case 'SET_CREATE_CATEGORY': return { ...s, showCreateCategory: a.value };
      case 'SET_CREATE_CHANNEL': return { ...s, showCreateChannel: a.value };
      case 'SET_CHANNEL_SETTINGS': return { ...s, showChannelSettings: a.value };
      case 'SET_INVITE_CHANNEL': return { ...s, inviteChannel: a.value };
      case 'SET_POPOVER_USER': return { ...s, popoverUser: a.user, popoverAnchor: a.anchor };
      default: return s;
    }
  }, {
    collapsedCategories: new Set<string>(),
    showCreateCategory: false,
    showCreateChannel: null,
    showChannelSettings: null,
    inviteChannel: null,
    popoverUser: null,
    popoverAnchor: null
  });

  const { collapsedCategories, showCreateCategory, showCreateChannel, showChannelSettings, inviteChannel, popoverUser, popoverAnchor } = state;
  const shouldRenderCreateCategory = useDelayUnmount(showCreateCategory, 200);
  const shouldRenderCreateChannel = useDelayUnmount(!!showCreateChannel, 200);
  const shouldRenderChannelSettings = useDelayUnmount(!!showChannelSettings, 200);
  const shouldRenderInviteChannel = useDelayUnmount(!!inviteChannel, 200);
  const { menu, openMenu, closeMenu } = useContextMenu();
  const voiceSettings = useVoiceSettingsStore((s) => s.getSettings(user?.id));
  const setIsMuted = useVoiceSettingsStore((s) => s.setIsMuted);
  const setIsDeafened = useVoiceSettingsStore((s) => s.setIsDeafened);
  const [voiceMemberMenu, setVoiceMemberMenu] = useState<VoiceMemberContextMenuTarget | null>(null);

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

  const handleVoiceMemberContextMenu = useCallback((e: React.MouseEvent, target: { id: string; username: string; display_name?: string | null; avatar_url?: string | null }) => {
    e.preventDefault();
    e.stopPropagation();
    setVoiceMemberMenu({
      x: e.clientX,
      y: e.clientY,
      target,
    });
  }, []);

  const toggleCategory = (catId: string) => {
    uiDispatch({ type: 'TOGGLE_CATEGORY', id: catId });
  };

  const grouped = groupChannelsByCategory(channels, categories);

  // Handle drag end — reorder channels within a category group
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !serverId) return;

    // Find the group containing the dragged channel
    const sourceGroup = grouped.find(g => g.channels.some(c => c.id === active.id));
    const targetGroup = grouped.find(g => g.channels.some(c => c.id === over.id));
    if (!sourceGroup || !targetGroup) return;

    // Only allow reordering within the same group for now
    if (sourceGroup.id !== targetGroup.id) return;

    const groupChannels = [...sourceGroup.channels];
    const oldIndex = groupChannels.findIndex(c => c.id === active.id);
    const newIndex = groupChannels.findIndex(c => c.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    // Compute the new order
    const reordered = arrayMove(groupChannels, oldIndex, newIndex);
    const targetCategoryId = sourceGroup.id?.startsWith("__") ? null : sourceGroup.id;

    // Build the new positions payload
    const channelUpdates = reordered.map((ch, i) => ({
      id: ch.id,
      position: i,
      category_id: targetCategoryId,
    }));

    // Optimistic update: replace positions locally so UI doesn't snap back
    const updatedChannels = channels.map(ch => {
      const update = channelUpdates.find(u => u.id === ch.id);
      if (update) {
        return { ...ch, position: update.position, category_id: update.category_id ?? undefined };
      }
      return ch;
    });
    dispatch({ type: "SET_CHANNELS", channels: updatedChannels });

    // Persist to DB + broadcast to all clients
    reorderChannels(serverId, channelUpdates);
  }, [grouped, serverId, channels, reorderChannels, dispatch]);

  return (
    <TooltipProvider delayDuration={0}>
      <div
        className="flex h-full flex-col bg-rm-bg-secondary select-none border-x border-rm-border rounded-tl-lg overflow-hidden"
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
            <h1 className="font-black text-[20px] tracking-wide leading-tight uppercase truncate max-w-full drop-shadow-md">
              {serverName.split(" ").map((word, i) => (
                <span key={i} className="block">{word}</span>
              ))}
            </h1>
            <div className="flex items-center gap-2 mt-1 opacity-90">
              <span className="font-black text-lg text-white/50">{isMiku ? "01" : "🕸️"}</span>
              <span className="text-[10px] font-bold tracking-widest uppercase">{isMiku ? "初音ミク" : "SPIDER-MAN"}</span>
            </div>
          </div>
          <ChevronDown className="absolute right-3 bottom-3 h-4 w-4 text-rm-text/75 dark:text-white/60 group-hover/banner:opacity-100 transition-opacity z-10" />
        </button>
      ) : (
        <button
        type="button"
        className="flex cursor-pointer items-center justify-between px-4 font-bold text-rm-text shadow-sm transition-colors hover:bg-rm-bg-hover active:bg-rm-bg-active outline-none"
        style={{ height: 'calc(48px + var(--safe-area-top, 0px))', paddingTop: 'var(--safe-area-top, 0px)' }}
        aria-label="Open server menu"
        onClick={handleServerHeaderClick}
      >
        <div className="flex items-center min-w-0">
          <h1 className="truncate text-[15px]">{serverName}</h1>
          <ChevronDown className="ml-1 h-3.5 w-3.5 opacity-90 dark:opacity-60 shrink-0 text-rm-text-primary" />
        </div>
      </button>)}

      {/* Channels List */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin py-3 px-2">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
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
      {
        shouldRenderCreateCategory && serverId && (
          <CreateCategoryModal serverId={serverId} onClose={() => uiDispatch({ type: 'SET_CREATE_CATEGORY', value: false })} isClosing={!showCreateCategory} />
        )
      }
      {
        shouldRenderCreateChannel && serverId && (
          <CreateChannelModal serverId={serverId} defaultCategoryId={showCreateChannel?.categoryId} onClose={() => uiDispatch({ type: 'SET_CREATE_CHANNEL', value: null })} isClosing={!showCreateChannel} />
        )
      }
      {
        shouldRenderChannelSettings && serverId && (
          <ChannelSettingsModal serverId={serverId} channel={showChannelSettings!} onClose={() => uiDispatch({ type: 'SET_CHANNEL_SETTINGS', value: null })} isClosing={!showChannelSettings} />
        )
      }
      {
        shouldRenderInviteChannel && serverId && (
          <ChannelInviteModal
            serverId={serverId}
            serverName={serverName}
            channel={inviteChannel!}
onClose={() => uiDispatch({ type: 'SET_INVITE_CHANNEL', value: null })}
isClosing={!inviteChannel}
          />
        )
      }
      {
        popoverUser && popoverAnchor && (
          <UserProfilePopover userId={popoverUser.id} username={popoverUser.username} displayName={popoverUser.display_name} avatarUrl={popoverUser.avatar_url} anchorEl={popoverAnchor} onClose={() => uiDispatch({ type: 'SET_POPOVER_USER', user: null, anchor: null })} />
        )
      }

      {/* Context Menu Placeholder */}
      <div id="channel-context-menu" />
      {
        menu.isOpen && (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            items={menu.items}
            onClose={closeMenu}
          />
        )
      }
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
              onOpenProfile={() => setProfileUser(voiceMemberMenu.target as unknown as User)}
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
  createChannel: (serverId: string, name: string, type?: string, categoryId?: string) => Promise<any>;
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
  const handleChannelContextMenu = useCallback((e: React.MouseEvent, channel: Channel) => {
    const channelCanManage = canManageChannels ||
      (channel.permissions != null && hasPermission(channel.permissions, PERMISSIONS.MANAGE_CHANNELS));
    const items = [
      // ── Mark As Read ───────────────────────────────────────────────
      {
        label: "Mark As Read",
        icon: <CheckCheck className="h-4 w-4" />,
        onClick: () => markChannelRead(channel.id),
        divider: true,
      },
      // ── Invite / Link ──────────────────────────────────────────────
      {
        label: "Invite to Channel",
        icon: <UserPlus className="h-4 w-4" />,
        onClick: () => uiDispatch({ type: 'SET_INVITE_CHANNEL', value: channel }),
      },
      {
        label: "Copy Link",
        icon: <Link className="h-4 w-4" />,
        onClick: () => {
          const path = `/channels/${serverId ?? ''}/${channel.id}`;
          navigator.clipboard.writeText(`${window.location.origin}${path}`);
        },
        divider: true,
      },
      // ── Notifications (placeholders — need backend) ────────────────
      {
        label: "Mute Channel",
        icon: <VolumeX className="h-4 w-4" />,
        rightIcon: <ChevronRight className="h-3.5 w-3.5" />,
        onClick: () => { /* needs backend: per-user per-channel mute */ },
        disabled: true,
      },
      {
        label: "Notification Settings",
        subtitle: "All Messages",
        icon: <Bell className="h-4 w-4" />,
        rightIcon: <ChevronRight className="h-3.5 w-3.5" />,
        onClick: () => { /* needs backend: per-user per-channel notification prefs */ },
        disabled: true,
        divider: true,
      },
      // ── Channel management ─────────────────────────────────────────
      ...(channelCanManage ? [
        {
          label: "Edit Channel",
          icon: <Settings className="h-4 w-4" />,
          onClick: () => uiDispatch({ type: 'SET_CHANNEL_SETTINGS', value: channel }),
        },
        {
          label: "Duplicate Channel",
          icon: <CopyPlus className="h-4 w-4" />,
          onClick: () => {
            if (serverId) {
              createChannel(serverId, `${channel.name}-copy`, channel.channel_type, channel.category_id);
            }
          },
        },
      ] : []),
      ...(canManageChannels ? [{
        label: "Create Text Channel",
        icon: <PlusCircle className="h-4 w-4" />,
        onClick: () => uiDispatch({ type: 'SET_CREATE_CHANNEL', value: { categoryId: channel.category_id ?? null } }),
      }] : []),
      ...(channelCanManage ? [{
        label: "Delete Channel",
        icon: <Trash2 className="h-4 w-4" />,
        onClick: () => {
          if (confirm(`Delete channel "${channel.name}"?`)) {
            deleteChannel(channel.id);
          }
        },
        variant: "danger" as const,
        divider: true,
      }] : [{ label: "", onClick: () => { }, divider: true, disabled: true }]),
      // ── Copy Channel ID ────────────────────────────────────────────
      {
        label: "Copy Channel ID",
        icon: <Copy className="h-4 w-4" />,
        rightIcon: <span className="text-[9px] font-bold bg-rm-bg-surface border border-rm-border rounded px-1 py-0.5 leading-none">ID</span>,
        onClick: () => navigator.clipboard.writeText(channel.id),
      },
    ];
    openMenu(e, items);
  }, [canManageChannels, deleteChannel, openMenu, uiDispatch, markChannelRead, createChannel, serverId]);

  const handleCategoryContextMenu = useCallback((e: React.MouseEvent, group: CategoryGroup) => {
    if (!group.id || group.id.startsWith("__")) return;
    openMenu(e, [
      ...(canManageChannels ? [{
        label: "Create Channel",
        icon: <Plus className="h-4 w-4" />,
        onClick: () => uiDispatch({ type: 'SET_CREATE_CHANNEL', value: { categoryId: group.id } }),
      }] : []),
      {
        label: "Copy ID",
        icon: <Copy className="h-4 w-4" />,
        onClick: () => navigator.clipboard.writeText(group.id!),
      },
      ...(canManageChannels ? [{
        label: "Delete Category",
        icon: <Trash2 className="h-4 w-4" />,
        onClick: () => {
          if (serverId && group.id) {
            if (confirm(`Delete category "${group.name}"?`)) {
              deleteCategory(serverId, group.id);
            }
          }
        },
        variant: "danger" as const,
      }] : []),
    ]);
  }, [canManageChannels, deleteCategory, openMenu, serverId, uiDispatch]);

  const handleSidebarContextMenu = useCallback((e: React.MouseEvent) => {
    openMenu(e, [
      ...(canManageChannels ? [
        {
          label: "Create Channel",
          onClick: () => uiDispatch({ type: 'SET_CREATE_CHANNEL', value: { categoryId: null } }),
        },
        {
          label: "Create Category",
          onClick: () => uiDispatch({ type: 'SET_CREATE_CATEGORY', value: true }),
        },
      ] : []),
      {
        label: "Invite to Server",
        divider: true,
        onClick: () => onInviteClick?.(),
      },
      {
        label: "Copy ID",
        icon: <Copy className="h-4 w-4" />,
        onClick: () => serverId && navigator.clipboard.writeText(serverId),
      },
    ]);
  }, [canManageChannels, onInviteClick, openMenu, serverId, uiDispatch]);

  const handleServerHeaderClick = useCallback((e: React.MouseEvent | React.KeyboardEvent) => {
    openMenu(e as unknown as React.MouseEvent, [
      {
        label: "Server Boost",
        icon: <Gem className="h-4 w-4" />,
        onClick: () => { },
      },
      {
        label: "Invite to Server",
        icon: <UserPlus className="h-4 w-4" />,
        divider: canManageChannels,
        variant: "default",
        onClick: () => onInviteClick?.(),
      },
      ...(canManageChannels ? [
        {
          label: "Server Settings",
          icon: <Settings className="h-4 w-4" />,
          onClick: () => onSettingsClick?.(),
        },
        {
          label: "Create Channel",
          icon: <PlusCircle className="h-4 w-4" />,
          onClick: () => uiDispatch({ type: 'SET_CREATE_CHANNEL', value: { categoryId: null } }),
        },
        {
          label: "Create Category",
          icon: <FolderPlus className="h-4 w-4" />,
          onClick: () => uiDispatch({ type: 'SET_CREATE_CATEGORY', value: true }),
        },
        {
          label: "Create Event",
          icon: <CalendarPlus className="h-4 w-4" />,
          onClick: () => { },
        },
        {
          label: "App Directory",
          icon: <LayoutGrid className="h-4 w-4" />,
          divider: true,
          onClick: () => { },
        },
      ] : []),
      {
        label: "Notification Settings",
        icon: <Bell className="h-4 w-4" />,
        onClick: () => { },
      },
      {
        label: "Privacy Settings",
        icon: <Shield className="h-4 w-4" />,
        divider: true,
        onClick: () => { },
      },
      {
        label: "Edit Per-server Profile",
        icon: <Edit2 className="h-4 w-4" />,
        onClick: () => { },
      },
      {
        label: "Hide Muted Channels",
        icon: <EyeOff className="h-4 w-4" />,
        onClick: () => { },
      },
    ]);
  }, [canManageChannels, onInviteClick, onSettingsClick, openMenu, uiDispatch]);

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
  onContextMenu: (e: React.MouseEvent, target: { id: string; username: string; display_name?: string | null; avatar_url?: string | null }) => void;
  onPopoverUser: (u: { id: string; username: string; display_name?: string | null; avatar_url?: string | null }, anchor: HTMLElement) => void;
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
  const activity = useVoiceActivityStore((state) => state.activeByUser[member.clerk_user_id]);
  const isReconnecting = isVoiceMemberReconnecting(member) || (isCurrentUser && !isCurrentClientVoiceConnected);
  const shouldShowStreamState = shouldShowVoiceMemberStreamState(member, {
    isCurrentUser,
    isCurrentClientVoiceConnected,
  });
  const [streamPreviewPosition, setStreamPreviewPosition] = useState<{ left: number; top: number } | null>(null);
  const closePreviewTimeoutRef = useRef<number | null>(null);
  // Use a targeted selector so this component only re-renders when the specific member's avatar changes
  const resolvedAvatarUrl = useChatStore(s => {
    // 1. Prefer the gateway-provided avatar (already resolved server-side)
    if (member.avatar_url) return member.avatar_url;
    // 2. Fall back to the server members list (D1 data incl. Clerk avatar from ensureUser)
    const m = s.members.find(m => m.user.id === member.clerk_user_id);
    if (m?.user.avatar_url) return m.user.avatar_url;
    // 3. Fall back to relationships list
    const r = s.relationships.find(r => r.user.id === member.clerk_user_id);
    if (r?.user.avatar_url) return r.user.avatar_url;
    return null;
  });

  const resolvedIdentity = useMemo(() => resolveVoiceIdentity({
    name: member.name,
    username: member.username ?? member.name,
    display_name: member.display_name ?? null,
    avatar_url: resolvedAvatarUrl ?? member.avatar_url ?? null,
  }), [member.name, member.username, member.display_name, member.avatar_url, resolvedAvatarUrl]);

  const userInfo = useMemo(() => ({
    id: member.clerk_user_id,
    username: resolvedIdentity.username,
    display_name: resolvedIdentity.displayName,
    avatar_url: resolvedIdentity.avatarUrl,
  }), [member.clerk_user_id, resolvedIdentity.username, resolvedIdentity.displayName, resolvedIdentity.avatarUrl]);

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

  const openStreamPreview = useCallback((anchor: HTMLElement) => {
    if (!shouldShowStreamState) return;

    clearPreviewCloseTimeout();

    const rect = anchor.getBoundingClientRect();
    const preferredLeft = rect.right + 12;
    const maxLeft = window.innerWidth - STREAM_PREVIEW_CARD_WIDTH - 12;
    const fallbackLeft = rect.left - STREAM_PREVIEW_CARD_WIDTH - 12;
    const left = preferredLeft <= maxLeft ? preferredLeft : Math.max(12, fallbackLeft);
    const centerY = rect.top + rect.height / 2;
    const minCenterY = STREAM_PREVIEW_CARD_HEIGHT / 2 + 12;
    const maxCenterY = window.innerHeight - STREAM_PREVIEW_CARD_HEIGHT / 2 - 12;
    const top = Math.min(maxCenterY, Math.max(minCenterY, centerY));

    setStreamPreviewPosition({ left, top });
  }, [clearPreviewCloseTimeout, shouldShowStreamState]);

  useEffect(() => {
    if (!shouldShowStreamState && streamPreviewPosition) {
      setStreamPreviewPosition(null);
    }
  }, [shouldShowStreamState, streamPreviewPosition]);

  useEffect(() => clearPreviewCloseTimeout, [clearPreviewCloseTimeout]);

  return (
    <>
      <button
        type="button"
        data-voice-connection-state={isReconnecting ? "reconnecting" : "connected"}
        className={cn(
          "group/vc-user flex w-full items-center gap-2 rounded px-1.5 py-1 text-left transition-colors hover:bg-rm-bg-hover outline-none",
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
        <div className={cn(
          "relative h-[24px] w-[24px] shrink-0 rounded-full transition-transform active:scale-95",
          isSpeaking ? "ring-[3px] ring-primary shadow-[0_0_20px_var(--rm-glow)] ring-offset-2 ring-offset-rm-bg-secondary z-10" : "z-0"
        )}>
          <div className="absolute inset-0 overflow-hidden rounded-full">
            {resolvedIdentity.avatarUrl ? (
              <img src={getAuthAssetUrl(resolvedIdentity.avatarUrl)} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} className="object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-primary/10 text-[10px] font-bold text-primary">
                {resolvedIdentity.name[0]?.toUpperCase()}
              </div>
            )}
          </div>
        </div>
        <span className="flex-1 truncate text-[14px] font-medium text-rm-text-muted group-hover/vc-user:text-rm-text">
          {resolvedIdentity.name}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {shouldShowStreamState && (
            <div className="flex items-center justify-center rounded-[3px] bg-[#ed4245] px-[4px] py-[2px] text-[9px] font-bold leading-none tracking-wider text-white">
              LIVE
            </div>
          )}
          {activity && (
            <Gamepad2 className="h-3.5 w-3.5 text-primary" />
          )}
          <div className="flex items-center gap-1 opacity-60">
            {member.self_video && <Shield className="h-3.5 w-3.5" />}
            {member.self_mute && <MicOff className="h-3.5 w-3.5 text-rm-danger" />}
          </div>
        </div>
      </button>

      {shouldShowStreamState && streamPreviewPosition && (
        <div
          className="fixed z-[140]"
          style={{ left: streamPreviewPosition.left, top: streamPreviewPosition.top, transform: "translateY(-50%)" }}
          onMouseEnter={clearPreviewCloseTimeout}
          onMouseLeave={scheduleStreamPreviewClose}
        >
          <VoiceStreamHoverCard
            displayName={resolvedIdentity.name}
            thumbnailUrl={streamThumbnailUrl}
            isCurrentUser={isCurrentUser}
            onWatchStream={onWatchStream ? () => {
              closeStreamPreview();
              onWatchStream(channelId, member.clerk_user_id);
            } : undefined}
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
  handleCategoryContextMenu: (e: React.MouseEvent, group: CategoryGroup) => void;
  handleChannelContextMenu: (e: React.MouseEvent, channel: Channel) => void;
  handleUserContextMenu: (e: React.MouseEvent, target: { id: string; username: string; display_name?: string | null; avatar_url?: string | null }) => void;
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
  const channelIds = group.channels.map(c => c.id);

  return (
    <div className="mb-4">
      {/* Category Header */}
      <div
        className="group flex cursor-pointer items-center py-1 pr-2 transition-colors hover:text-rm-text text-rm-text-muted"
        onContextMenu={(e) => handleCategoryContextMenu(e, group)}
      >
        <button
          type="button"
          className="flex flex-1 items-center gap-0.5 overflow-hidden outline-none"
          aria-expanded={!isCollapsed}
          aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${group.name}`}
          onClick={() => group.id && toggleCategory(group.id)}
        >
          <ChevronDown
            className={cn(
              "h-3 w-3 shrink-0 transition-transform duration-200",
              isCollapsed && "-rotate-90"
            )}
          />
          <span className="truncate text-[12px] font-bold tracking-wide uppercase leading-none pt-0.5">
            {group.name}
          </span>
        </button>
        {canManageChannels && (
          <button
            type="button"
            className="rounded-sm p-0.5 transition-colors hover:text-rm-text"
            aria-label={`Create channel in ${group.name}`}
            onClick={() => uiDispatch({ type: 'SET_CREATE_CHANNEL', value: { categoryId: group.id?.startsWith("__") ? null : group.id } })}
          >
            <Plus className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Channels */}
      <SortableContext items={channelIds} strategy={verticalListSortingStrategy}>
        {group.channels.map((channel) => {
          const isActive = activeChannelId === channel.id;
          const isVoice = channel.channel_type === "voice";
          const vcMembers = voiceChannelStates[channel.id] || [];
          const isConnectedVoice = isVoice && vcMembers.some((m) => m.clerk_user_id === currentUserId);

          if (isCollapsed && !isActive && !isConnectedVoice) {
            return null;
          }

          const unread = !isActive && isUnread(channel.id, readStates, lastMessageAt);

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
              onCreateChannel={(categoryId) => uiDispatch({ type: 'SET_CREATE_CHANNEL', value: { categoryId } })}
              onEditChannel={(ch) => uiDispatch({ type: 'SET_CHANNEL_SETTINGS', value: ch })}
              onInviteToChannel={(ch) => uiDispatch({ type: 'SET_INVITE_CHANNEL', value: ch })}
              onPopoverUser={(u, anchor) => uiDispatch({ type: 'SET_POPOVER_USER', user: u, anchor })}
              onWatchStream={onWatchStream}
            />
          );
        })}
      </SortableContext>
    </div>
  );
}
