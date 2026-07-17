import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "@/lib/api-client";
import { getUnreadChannelState } from "@/lib/desktop-notifications";
import { syncDesktopNotificationState } from "@/lib/desktop-native-sync";
import { parseMediaContentFilter } from "@/lib/media-content-filter";
import type { ChatAction, ChatState } from "@/lib/chat-reducer";
import type {
  Notification as AppNotification,
  Attachment,
  Category,
  Channel,
  Message,
  Relationship,
  Server,
  User,
} from "@/lib/types";
import { useMediaSafetySettingsStore } from "./useMediaSafetySettingsStore";
import { useSoundSettingsStore } from "./useSoundSettingsStore";

export interface ChatRestActions {
  sendMessage: (
    channelId: string,
    content: string,
    replyToId?: string,
    replyTo?: Message,
    attachmentIds?: string[],
    optimisticAttachments?: Attachment[],
    nsfwAttachmentIds?: string[],
  ) => Promise<void>;
  sendTyping: (channelId: string) => Promise<void>;
  addReaction: (
    channelId: string,
    messageId: string,
    emoji: string,
  ) => Promise<void>;
  removeReaction: (
    channelId: string,
    messageId: string,
    emoji: string,
  ) => Promise<void>;
  deleteMessage: (channelId: string, messageId: string) => Promise<void>;
  editMessage: (messageId: string, content: string) => Promise<void>;
  removeEmbeds: (channelId: string, messageId: string) => Promise<void>;
  createMessageShare: (
    messageId: string,
    expires?: "7d" | "30d" | "90d" | "never",
  ) => Promise<string>;
  loadMessages: (
    channelId: string,
    before?: string,
    options?: { signal?: AbortSignal },
  ) => Promise<{
    messages: Message[];
    hasMoreBefore: boolean;
    hasMoreAfter: boolean;
    stale?: boolean;
  }>;
  loadMessagesAround: (
    channelId: string,
    messageId: string,
    options?: { signal?: AbortSignal },
  ) => Promise<{
    hasMoreBefore: boolean;
    hasMoreAfter: boolean;
    stale?: boolean;
  }>;
  loadMessagesAfter: (
    channelId: string,
    after: string,
    options?: { signal?: AbortSignal },
  ) => Promise<{ hasMoreAfter: boolean; stale?: boolean }>;
  loadServers: () => Promise<void>;
  loadChannels: (
    serverId: string,
    options?: { force?: boolean },
  ) => Promise<void>;
  loadMembers: (
    serverId: string,
    options?: { force?: boolean },
  ) => Promise<void>;
  createServer: (name: string, iconUrl?: string) => Promise<Server | null>;
  createChannel: (
    serverId: string,
    name: string,
    type?: string,
    categoryId?: string,
  ) => Promise<Channel | null>;
  deleteChannel: (channelId: string) => Promise<void>;
  createCategory: (serverId: string, name: string) => Promise<Category | null>;
  deleteCategory: (serverId: string, categoryId: string) => Promise<void>;
  updateStatus: (
    status: "online" | "idle" | "dnd" | "offline",
    custom_status?: string | null,
  ) => void;
  loadProfile: () => Promise<void>;
  loadCurrentUser: (expectedUserId?: string) => Promise<void>;
  loadReadStates: () => Promise<void>;
  markChannelRead: (channelId: string, messageTimestamp?: string) => void;
  resetReadStateTracking: (userId: string | null) => void;
  markChannelUnread: (
    channelId: string,
    messageId: string,
    messageCreatedAt: string,
  ) => Promise<void>;
  pinMessage: (channelId: string, messageId: string) => Promise<void>;
  unpinMessage: (channelId: string, messageId: string) => Promise<void>;
  loadPins: (channelId: string, force?: boolean) => Promise<void>;
  refreshMessageEmbeds: (
    channelId: string,
    messageIds: string[],
  ) => Promise<void>;
  loadDmChannels: () => Promise<void>;
  loadRelationships: () => Promise<void>;
  openDm: (targetUserId: string) => Promise<string | null>;
  loadNotifications: () => Promise<void>;
  bootstrapChat: (options?: {
    includeNotifications?: boolean;
    expectedUserId?: string;
    deferNonCritical?: boolean;
  }) => Promise<void>;
  markNotificationsRead: (ids?: string[]) => Promise<void>;
  clearNotifications: () => Promise<void>;
  reorderChannels: (
    serverId: string,
    channels?: Array<{
      id: string;
      position: number;
      category_id: string | null;
    }>,
    categories?: Array<{ id: string; rank: number }>,
  ) => Promise<void>;
}

type MessagePage = {
  messages: Message[];
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
  stale?: boolean;
};

function normalizeMessagePage(
  data: Message[] | Partial<MessagePage> | null | undefined,
  limit = 50,
): MessagePage {
  if (Array.isArray(data)) {
    return {
      messages: data,
      hasMoreBefore: data.length >= limit,
      hasMoreAfter: false,
    };
  }

  const messages = Array.isArray(data?.messages) ? data.messages : [];
  return {
    messages,
    hasMoreBefore:
      typeof data?.hasMoreBefore === "boolean"
        ? data.hasMoreBefore
        : messages.length >= limit,
    hasMoreAfter:
      typeof data?.hasMoreAfter === "boolean" ? data.hasMoreAfter : false,
  };
}

function compareTimestamps(left: string, right: string): number {
  const leftMs = Date.parse(normalizeTimestamp(left));
  const rightMs = Date.parse(normalizeTimestamp(right));
  if (!Number.isNaN(leftMs) && !Number.isNaN(rightMs)) {
    return leftMs - rightMs;
  }
  return left.localeCompare(right);
}

function normalizeTimestamp(value: string): string {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(trimmed)) {
    return `${trimmed.replace(" ", "T")}Z`;
  }
  return trimmed;
}

export function createChatActions(
  get: () => ChatState,
  dispatch: (action: ChatAction) => void,
): ChatRestActions {
  let inFlightBootstrap: {
    userId: string | null;
    promise: Promise<void>;
  } | null = null;
  const lastMarkedReadAtByChannel = new Map<string, string>();
  const readStateWrites = new Map<string, Promise<void>>();
  const readStateMutations = new Map<string, Promise<void>>();
  const pendingReadRequests = new Set<string>();
  const pendingReadMessageAt = new Map<string, string>();
  const unreadBarriers = new Set<string>();
  let readStateOwnerId: string | null = null;
  let readStateGeneration = 0;
  const messageRequestGenerations = new Map<string, number>();

  const resetReadStateTracking = (userId: string | null) => {
    if (readStateOwnerId === userId) return;
    readStateOwnerId = userId;
    readStateGeneration++;
    lastMarkedReadAtByChannel.clear();
    readStateWrites.clear();
    readStateMutations.clear();
    pendingReadRequests.clear();
    pendingReadMessageAt.clear();
    unreadBarriers.clear();
  };

  const syncDesktopNotifications = async () => {
    const state = get();
    const { unreadDmChannelIds, unreadServerChannelIds } =
      getUnreadChannelState({
        lastMessageAt: state.lastMessageAt,
        readStates: state.readStates,
        dmChannelIds: state.dmChannels.map((dm) => dm.id),
      });

    await syncDesktopNotificationState({
      notifications: state.notifications,
      unreadDmChannelIds,
      unreadServerChannelIds,
    });
  };

  const sendMessage = async (
    channelId: string,
    content: string,
    replyToId?: string,
    replyToMsg?: Message,
    attachmentIds?: string[],
    optimisticAttachments?: Attachment[],
    nsfwAttachmentIds?: string[],
  ) => {
    const nonce = crypto.randomUUID();
    const user = get().user;

    const optimisticMsg: Message = {
      id: `pending-${nonce}`,
      channel_id: channelId,
      author_id: user?.id ?? "",
      author: user
        ? {
            id: user.id,
            username: user.username,
            display_name: user.display_name,
            avatar_url: user.avatar_url,
          }
        : undefined,
      content,
      reply_to_id: replyToId,
      reply_to: replyToMsg
        ? ({
            id: replyToMsg.id,
            content: replyToMsg.content.slice(0, 200),
            author_id: replyToMsg.author_id,
            author: replyToMsg.author,
          } as Message)
        : undefined,
      is_pinned: false,
      created_at: new Date().toISOString(),
      attachments: optimisticAttachments ?? [],
      reactions: [],
      nonce,
      pending: true,
    };
    dispatch({ type: "APPEND_MESSAGE", message: optimisticMsg });
    dispatch({ type: "CLEAR_TYPING", channelId, userId: user?.id ?? "" });

    try {
      await apiPost(`/api/channels/${channelId}/messages`, {
        content,
        reply_to_id: replyToId,
        nonce,
        attachment_ids: attachmentIds,
        nsfw_attachment_ids: nsfwAttachmentIds,
      });
    } catch {
      dispatch({ type: "DELETE_MESSAGE", id: `pending-${nonce}` });
    }
  };

  const editMessage = async (messageId: string, content: string) => {
    const channelId = get().activeChannelId;
    if (!channelId) return;
    await apiPatch(`/api/channels/${channelId}/messages`, {
      message_id: messageId,
      content,
    });
  };

  const deleteMessage = async (channelId: string, messageId: string) => {
    await apiDelete(`/api/channels/${channelId}/messages`, {
      message_id: messageId,
    });
  };

  const removeEmbeds = async (channelId: string, messageId: string) => {
    // Optimistically clear embeds locally
    dispatch({ type: "UPDATE_MESSAGE", id: messageId, embeds: [] });
    try {
      await apiPatch(`/api/channels/${channelId}/messages`, {
        message_id: messageId,
        embeds: [],
      });
    } catch {
      // If error, the MESSAGE_UPDATE broadcast won't come, but we already cleared locally
    }
  };

  const addReaction = async (
    channelId: string,
    messageId: string,
    emoji: string,
  ) => {
    const user = get().user;
    if (!user) return;

    dispatch({ type: "ADD_REACTION", messageId, emoji, userId: user.id });

    try {
      await apiPut(`/api/channels/${channelId}/reactions`, {
        message_id: messageId,
        emoji,
      });
    } catch {
      dispatch({ type: "REMOVE_REACTION", messageId, emoji, userId: user.id });
    }
  };

  const removeReaction = async (
    channelId: string,
    messageId: string,
    emoji: string,
  ) => {
    const user = get().user;
    if (!user) return;

    dispatch({ type: "REMOVE_REACTION", messageId, emoji, userId: user.id });

    try {
      await apiDelete(`/api/channels/${channelId}/reactions`, {
        message_id: messageId,
        emoji,
      });
    } catch {
      dispatch({ type: "ADD_REACTION", messageId, emoji, userId: user.id });
    }
  };

  const sendTyping = async (channelId: string) => {
    apiPost(`/api/channels/${channelId}/typing`, {}).catch(() => {
      // Typing indicators are best-effort — never surface errors
    });
  };

  const loadMessages = async (
    channelId: string,
    before?: string,
    options?: { signal?: AbortSignal },
  ): Promise<MessagePage> => {
    const requestGeneration =
      (messageRequestGenerations.get(channelId) ?? 0) + 1;
    messageRequestGenerations.set(channelId, requestGeneration);
    const messagesAtRequestStart = get().messagesByChannelId[channelId] ?? [];
    const params = new URLSearchParams({ limit: "50" });
    if (before) params.set("before", before);
    try {
      const data = await apiGet<MessagePage | Message[]>(
        `/api/channels/${channelId}/messages?${params}`,
        options,
      );
      const normalized = normalizeMessagePage(data);
      const messages = normalized.messages;
      if (
        get().activeChannelId !== channelId ||
        messageRequestGenerations.get(channelId) !== requestGeneration
      ) {
        return { ...normalized, stale: true };
      }
      if (!before) {
        dispatch({
          type: "SET_MESSAGES",
          messages,
          channelId,
          hasMoreBefore: normalized.hasMoreBefore,
          hasMoreAfter: normalized.hasMoreAfter,
          preserveMessagesFrom: messagesAtRequestStart,
        });
      } else {
        dispatch({
          type: "PREPEND_MESSAGES",
          messages,
          channelId,
          hasMoreBefore: normalized.hasMoreBefore,
        });
      }
      return normalized;
    } catch {
      return { messages: [], hasMoreBefore: false, hasMoreAfter: false };
    }
  };

  const loadMessagesAround = async (
    channelId: string,
    messageId: string,
    options?: { signal?: AbortSignal },
  ): Promise<{
    hasMoreBefore: boolean;
    hasMoreAfter: boolean;
    stale?: boolean;
  }> => {
    const requestGeneration =
      (messageRequestGenerations.get(channelId) ?? 0) + 1;
    messageRequestGenerations.set(channelId, requestGeneration);
    try {
      const data = await apiGet<MessagePage | Message[]>(
        `/api/channels/${channelId}/messages?around=${encodeURIComponent(messageId)}`,
        options,
      );
      const normalized = normalizeMessagePage(data);
      if (
        get().activeChannelId === channelId &&
        messageRequestGenerations.get(channelId) === requestGeneration
      ) {
        dispatch({
          type: "REPLACE_MESSAGES",
          messages: normalized.messages,
          channelId,
          hasMoreBefore: normalized.hasMoreBefore,
          hasMoreAfter: normalized.hasMoreAfter,
        });
      } else {
        return {
          hasMoreBefore: normalized.hasMoreBefore,
          hasMoreAfter: normalized.hasMoreAfter,
          stale: true,
        };
      }
      return {
        hasMoreBefore: normalized.hasMoreBefore,
        hasMoreAfter: normalized.hasMoreAfter,
      };
    } catch {
      return { hasMoreBefore: false, hasMoreAfter: false };
    }
  };

  const loadMessagesAfter = async (
    channelId: string,
    after: string,
    options?: { signal?: AbortSignal },
  ): Promise<{ hasMoreAfter: boolean; stale?: boolean }> => {
    const requestGeneration =
      (messageRequestGenerations.get(channelId) ?? 0) + 1;
    messageRequestGenerations.set(channelId, requestGeneration);
    try {
      const data = await apiGet<MessagePage | Message[]>(
        `/api/channels/${channelId}/messages?after=${encodeURIComponent(after)}&limit=50`,
        options,
      );
      const normalized = normalizeMessagePage(data);
      if (
        get().activeChannelId === channelId &&
        messageRequestGenerations.get(channelId) === requestGeneration
      ) {
        dispatch({
          type: "APPEND_MESSAGES_AFTER",
          messages: normalized.messages,
          channelId,
          hasMoreAfter: normalized.hasMoreAfter,
        });
      } else {
        return { hasMoreAfter: normalized.hasMoreAfter, stale: true };
      }
      return { hasMoreAfter: normalized.hasMoreAfter };
    } catch {
      return { hasMoreAfter: false };
    }
  };

  const loadServers = async (generation = readStateGeneration) => {
    try {
      const servers = await apiGet<Server[]>("/api/servers");
      // Guard: only dispatch if we got a valid array (API errors can return objects)
      if (generation === readStateGeneration && Array.isArray(servers)) {
        dispatch({ type: "SET_SERVERS", servers });
      }
    } catch {
      /* ignore */
    }
  };

  const loadChannels = async (
    serverId: string,
    options?: { force?: boolean },
  ) => {
    if (!options?.force && get().channelsLoadedByServerId[serverId]) return;

    try {
      const data = await apiGet<{
        channels: Channel[];
        categories?: Category[];
      }>(`/api/servers/${serverId}/channels`);
      dispatch({
        type: "SET_CHANNELS_AND_CATEGORIES",
        serverId,
        channels: data.channels ?? [],
        categories: data.categories ?? [],
      });
    } catch {
      /* ignore */
    }
  };

  const loadMembers = async (
    serverId: string,
    options?: { force?: boolean },
  ) => {
    if (!options?.force && get().membersLoadedByServerId[serverId]) return;

    try {
      const members = await apiGet<Array<{ user: User; role: number }>>(
        `/api/servers/${serverId}/members`,
      );
      dispatch({ type: "SET_MEMBERS", serverId, members });
    } catch {
      /* ignore */
    }
  };

  const createServer = async (
    name: string,
    iconUrl?: string,
  ): Promise<Server | null> => {
    try {
      const server = await apiPost<Server>("/api/servers", {
        name,
        icon_url: iconUrl,
      });
      dispatch({ type: "ADD_SERVER", server });
      return server;
    } catch {
      return null;
    }
  };

  const createChannel = async (
    serverId: string,
    name: string,
    type?: string,
    categoryId?: string,
  ): Promise<Channel | null> => {
    const tempId = `temp-${crypto.randomUUID()}`;
    const tempChannel: Channel = {
      id: tempId,
      server_id: serverId,
      name,
      channel_type: (type ?? "text") as "text" | "voice" | "dm",
      category_id: categoryId ?? undefined,
      position: 999,
      created_at: new Date().toISOString(),
    };
    dispatch({ type: "ADD_CHANNEL_OPTIMISTIC", channel: tempChannel });

    try {
      const channel = await apiPost<Channel>(
        `/api/servers/${serverId}/channels`,
        {
          name,
          channel_type: type ?? "text",
          category_id: categoryId,
        },
      );
      dispatch({
        type: "UPDATE_CHANNEL_ID",
        oldId: tempId,
        newChannel: channel,
      });
      return channel;
    } catch {
      dispatch({ type: "REMOVE_CHANNEL", channelId: tempId });
      return null;
    }
  };

  const createCategory = async (
    serverId: string,
    name: string,
  ): Promise<Category | null> => {
    try {
      const category = await apiPost<Category>(
        `/api/servers/${serverId}/categories`,
        { name },
      );
      dispatch({ type: "ADD_CATEGORY", category });
      return category;
    } catch {
      return null;
    }
  };

  const deleteChannel = async (channelId: string) => {
    await apiDelete(`/api/channels/${channelId}`);
  };

  const deleteCategory = async (serverId: string, categoryId: string) => {
    await apiDelete(`/api/servers/${serverId}/categories/${categoryId}`);
  };

  const updateStatus = (
    status: "online" | "idle" | "dnd" | "offline",
    custom_status?: string | null,
  ) => {
    dispatch({ type: "SET_STATUS", status, customStatus: custom_status });

    if (typeof window !== "undefined") {
      localStorage.setItem("user-status", status);
    }

    apiPost("/api/presence", { status, custom_status }).catch(console.error);
  };

  const loadProfile = async (generation = readStateGeneration) => {
    try {
      const data = await apiGet<{ status: string; custom_status?: string }>(
        "/api/presence",
      );
      if (generation !== readStateGeneration) return;
      dispatch({
        type: "SET_STATUS",
        status: data.status as "online" | "idle" | "dnd" | "offline",
        customStatus: data.custom_status,
      });
    } catch {
      /* ignore */
    }
  };

  const loadCurrentUser = async (expectedUserId?: string) => {
    const loadGeneration = readStateGeneration;
    const userIdAtStart = expectedUserId ?? get().user?.id ?? null;
    try {
      const profile = await apiGet<{
        id: string;
        username: string;
        display_name: string | null;
        avatar_url: string | null;
        avatar_display?:
          | import("@/lib/avatar-display").AvatarDisplay
          | string
          | null;
        banner_url: string | null;
        banner_content_type: string | null;
        nameplate_url: string | null;
        nameplate_content_type: string | null;
        profile_accent_color: string | null;
        profile_background_color: string | null;
        profile_banner_color: string | null;
        display_name_style?:
          | import("@/lib/profile-customization").DisplayNameStyle
          | string
          | null;
        theme_preference: string | null;
        theme_sync_enabled: number;
        media_content_filter: string;
        updated_at?: string | null;
        created_at?: string | null;
        bio?: string | null;
        pronouns?: string | null;
        status?: string;
        custom_status?: string;
        sound_settings?: {
          voiceJoinSoundboard?: unknown;
          voiceLeaveSoundboard?: unknown;
          soundboardVolume?: unknown;
        };
      }>("/api/users/me");
      if (
        loadGeneration !== readStateGeneration ||
        (userIdAtStart !== null && profile.id !== userIdAtStart)
      ) {
        return;
      }
      const current = get().user;
      resetReadStateTracking(profile.id);
      useSoundSettingsStore
        .getState()
        .hydrateFromBackend(profile.sound_settings, profile.id);
      // SET_USER fully replaces state.user — merge D1 profile with existing state
      dispatch({
        type: "SET_USER",
        user: {
          id: profile.id,
          username: profile.username || current?.username || "Guest",
          display_name:
            (profile.display_name || current?.display_name) ?? undefined,
          avatar_url: (profile.avatar_url || current?.avatar_url) ?? undefined,
          avatar_display: profile.avatar_display ?? current?.avatar_display,
          banner_url: profile.banner_url ?? undefined,
          banner_content_type: profile.banner_content_type ?? undefined,
          nameplate_url: profile.nameplate_url ?? undefined,
          nameplate_content_type: profile.nameplate_content_type ?? undefined,
          profile_accent_color: profile.profile_accent_color ?? undefined,
          profile_background_color:
            profile.profile_background_color ?? undefined,
          profile_banner_color: profile.profile_banner_color ?? undefined,
          display_name_style: profile.display_name_style ?? undefined,
          theme_preference: profile.theme_preference ?? undefined,
          theme_sync_enabled: profile.theme_sync_enabled === 1,
          media_content_filter: parseMediaContentFilter(
            profile.media_content_filter,
          ),
          updated_at: profile.updated_at ?? current?.updated_at,
          created_at: profile.created_at ?? current?.created_at,
          bio: profile.bio ?? current?.bio,
          pronouns: profile.pronouns ?? current?.pronouns,
          presence_platforms: current?.presence_platforms,
          status: (profile.status as any) ?? current?.status ?? "online",
          custom_status: profile.custom_status ?? current?.custom_status,
        },
      });
      // Also update member caches and voice states when display-only fields change.
      dispatch({
        type: "UPDATE_MEMBER_PROFILE",
        userId: profile.id,
        avatar_url: profile.avatar_url,
        avatar_display: profile.avatar_display,
        banner_url: profile.banner_url,
        banner_content_type: profile.banner_content_type,
        nameplate_url: profile.nameplate_url,
        nameplate_content_type: profile.nameplate_content_type,
        profile_accent_color: profile.profile_accent_color,
        profile_background_color: profile.profile_background_color,
        profile_banner_color: profile.profile_banner_color,
        display_name_style: profile.display_name_style,
        theme_preference: profile.theme_preference,
        theme_sync_enabled: profile.theme_sync_enabled === 1,
        media_content_filter: parseMediaContentFilter(
          profile.media_content_filter,
        ),
        created_at: profile.created_at,
        username: profile.username,
        display_name: profile.display_name,
        bio: profile.bio ?? undefined,
        pronouns: profile.pronouns ?? undefined,
        updated_at: profile.updated_at ?? undefined,
      });
      useMediaSafetySettingsStore.getState().setCurrentUser(profile.id);
      useMediaSafetySettingsStore.getState().hydrateSettings(
        {
          contentFilter: parseMediaContentFilter(profile.media_content_filter),
        },
        profile.id,
      );
    } catch {
      /* ignore */
    }
  };

  const loadReadStates = async () => {
    const loadGeneration = readStateGeneration;
    const readStatesAtStart = { ...get().readStates };
    const lastMessagesAtStart = { ...get().lastMessageAt };
    const mutationsAtStart = new Set(readStateMutations.keys());
    try {
      const data = await apiGet<{
        read_states: Array<{ channel_id: string; last_read_at: string }>;
        last_messages: Array<{ channel_id: string; last_message_at: string }>;
      }>("/api/read-states");
      const readStates: Record<string, string> = {};
      for (const rs of data.read_states) {
        readStates[rs.channel_id] = normalizeTimestamp(rs.last_read_at);
      }
      const lastMessageAt: Record<string, string> = {};
      for (const lm of data.last_messages) {
        lastMessageAt[lm.channel_id] = normalizeTimestamp(lm.last_message_at);
      }
      if (loadGeneration !== readStateGeneration) return;
      const currentState = get();
      const mergedReadStates = { ...readStates };
      const mergedLastMessageAt = { ...lastMessageAt };
      let changedDuringLoad = false;

      for (const [channelId, timestamp] of Object.entries(
        currentState.readStates,
      )) {
        if (
          mutationsAtStart.has(channelId) ||
          readStatesAtStart[channelId] !== timestamp
        ) {
          mergedReadStates[channelId] = timestamp;
          changedDuringLoad = true;
        }
      }
      for (const [channelId, timestamp] of Object.entries(
        currentState.lastMessageAt,
      )) {
        if (lastMessagesAtStart[channelId] !== timestamp) {
          mergedLastMessageAt[channelId] = timestamp;
          changedDuringLoad = true;
        }
      }

      dispatch({
        type: "SET_READ_STATES",
        readStates: mergedReadStates,
        lastMessageAt: mergedLastMessageAt,
      });
      if (!changedDuringLoad) {
        lastMarkedReadAtByChannel.clear();
        pendingReadRequests.clear();
        pendingReadMessageAt.clear();
      }
      await syncDesktopNotifications();
    } catch {
      /* ignore */
    }
  };

  const markChannelRead = (channelId: string, messageTimestamp?: string) => {
    const state = get();
    const currentReadAt = state.readStates[channelId];
    const lastMessageAt = messageTimestamp ?? state.lastMessageAt[channelId];
    let previousMarkedAt = lastMarkedReadAtByChannel.get(channelId);

    if (
      currentReadAt &&
      previousMarkedAt &&
      compareTimestamps(currentReadAt, previousMarkedAt) < 0
    ) {
      lastMarkedReadAtByChannel.delete(channelId);
      previousMarkedAt = undefined;
    }

    if (
      currentReadAt &&
      lastMessageAt &&
      compareTimestamps(currentReadAt, lastMessageAt) >= 0 &&
      (!messageTimestamp ||
        !previousMarkedAt ||
        compareTimestamps(lastMessageAt, previousMarkedAt) <= 0)
    ) {
      lastMarkedReadAtByChannel.set(channelId, currentReadAt);
      return;
    }

    if (
      previousMarkedAt &&
      (!lastMessageAt ||
        compareTimestamps(lastMessageAt, previousMarkedAt) <= 0)
    ) {
      return;
    }

    if (readStateMutations.has(channelId)) {
      pendingReadRequests.add(channelId);
      if (messageTimestamp) {
        const pendingTimestamp = pendingReadMessageAt.get(channelId);
        if (
          !pendingTimestamp ||
          compareTimestamps(messageTimestamp, pendingTimestamp) > 0
        ) {
          pendingReadMessageAt.set(channelId, messageTimestamp);
        }
      }
      return;
    }

    const optimisticTimestamp = lastMessageAt ?? new Date().toISOString();
    const previousReadAt = currentReadAt;
    const writeGeneration = readStateGeneration;
    lastMarkedReadAtByChannel.set(channelId, optimisticTimestamp);
    dispatch({
      type: "UPDATE_READ_STATE",
      channelId,
      timestamp: optimisticTimestamp,
    });
    void syncDesktopNotifications();

    const writePromise = apiPut(`/api/channels/${channelId}/read-state`, {})
      .then(() => undefined)
      .catch(() => {
        if (writeGeneration !== readStateGeneration) return;
        if (lastMarkedReadAtByChannel.get(channelId) === optimisticTimestamp) {
          lastMarkedReadAtByChannel.delete(channelId);
          if (get().readStates[channelId] === optimisticTimestamp) {
            dispatch({
              type: "UPDATE_READ_STATE",
              channelId,
              timestamp: previousReadAt ?? new Date(0).toISOString(),
            });
          }
        }
      })
      .finally(() => {
        if (writeGeneration !== readStateGeneration) return;
        if (readStateWrites.get(channelId) === writePromise) {
          readStateWrites.delete(channelId);
        }
        if (readStateMutations.get(channelId) === writePromise) {
          readStateMutations.delete(channelId);
        }
        if (
          !unreadBarriers.has(channelId) &&
          pendingReadRequests.delete(channelId)
        ) {
          const pendingTimestamp = pendingReadMessageAt.get(channelId);
          pendingReadMessageAt.delete(channelId);
          markChannelRead(channelId, pendingTimestamp);
        }
      });
    readStateWrites.set(channelId, writePromise);
    readStateMutations.set(channelId, writePromise);
  };

  const markChannelUnread = async (
    channelId: string,
    messageId: string,
    messageCreatedAt: string,
  ) => {
    pendingReadRequests.delete(channelId);
    pendingReadMessageAt.delete(channelId);
    unreadBarriers.add(channelId);
    const unreadGeneration = readStateGeneration;
    const inFlightReadStateMutation = readStateMutations.get(channelId);
    if (inFlightReadStateMutation) await inFlightReadStateMutation;
    if (unreadGeneration !== readStateGeneration) return;
    const queuedReadStateMutation = readStateMutations.get(channelId);
    if (queuedReadStateMutation) await queuedReadStateMutation;
    if (unreadGeneration !== readStateGeneration) return;
    lastMarkedReadAtByChannel.delete(channelId);
    const previous = get().readStates[channelId];
    const createdAt = Date.parse(normalizeTimestamp(messageCreatedAt));
    const optimisticTimestamp = Number.isNaN(createdAt)
      ? new Date(0).toISOString()
      : new Date(Math.max(0, createdAt - 1)).toISOString();

    dispatch({
      type: "UPDATE_READ_STATE",
      channelId,
      timestamp: optimisticTimestamp,
    });
    void syncDesktopNotifications();

    const patchGeneration = readStateGeneration;
    const patchPromise = apiPatch<{
      channel_id: string;
      last_read_at: string;
    }>(`/api/channels/${channelId}/read-state`, { message_id: messageId })
      .then(async (result) => {
        if (patchGeneration !== readStateGeneration) return;
        if (get().readStates[channelId] !== optimisticTimestamp) return;
        dispatch({
          type: "UPDATE_READ_STATE",
          channelId,
          timestamp: result.last_read_at,
        });
        await syncDesktopNotifications();
      })
      .catch(() => {
        if (patchGeneration !== readStateGeneration) return;
        if (get().readStates[channelId] !== optimisticTimestamp) return;
        if (previous) {
          dispatch({
            type: "UPDATE_READ_STATE",
            channelId,
            timestamp: previous,
          });
        }
        void syncDesktopNotifications();
      })
      .finally(() => {
        if (patchGeneration !== readStateGeneration) return;
        if (readStateMutations.get(channelId) === patchPromise) {
          readStateMutations.delete(channelId);
        }
        unreadBarriers.delete(channelId);
        if (pendingReadRequests.delete(channelId)) {
          const pendingTimestamp = pendingReadMessageAt.get(channelId);
          pendingReadMessageAt.delete(channelId);
          markChannelRead(channelId, pendingTimestamp);
        }
      });
    readStateMutations.set(channelId, patchPromise);
    await patchPromise;
  };

  const pinMessage = async (channelId: string, messageId: string) => {
    const fullMsg = get().messages.find((m) => m.id === messageId);
    dispatch({
      type: "PIN_MESSAGE",
      messageId,
      pinned: true,
      fullMessage: fullMsg,
    });

    try {
      await apiPut(`/api/channels/${channelId}/pins`, {
        message_id: messageId,
        pinned: true,
      });
    } catch {
      dispatch({ type: "PIN_MESSAGE", messageId, pinned: false });
    }
  };

  const unpinMessage = async (channelId: string, messageId: string) => {
    dispatch({ type: "PIN_MESSAGE", messageId, pinned: false });

    try {
      await apiPut(`/api/channels/${channelId}/pins`, {
        message_id: messageId,
        pinned: false,
      });
    } catch {
      const fullMsg = get().messages.find((m) => m.id === messageId);
      dispatch({
        type: "PIN_MESSAGE",
        messageId,
        pinned: true,
        fullMessage: fullMsg,
      });
    }
  };

  const loadPins = async (channelId: string, force?: boolean) => {
    if (!force && get().pinsLoadedFor === channelId) return;

    dispatch({ type: "SET_LOADING_PINS", loading: true });
    try {
      const messages = await apiGet<Message[]>(
        `/api/channels/${channelId}/pins`,
      );
      dispatch({ type: "SET_PINNED_MESSAGES", messages, channelId });
    } catch {
      dispatch({ type: "SET_LOADING_PINS", loading: false });
    }
  };

  const refreshMessageEmbeds = async (
    channelId: string,
    messageIds: string[],
  ) => {
    const ids = [...new Set(messageIds)].slice(0, 50);
    if (ids.length === 0) return;
    await apiPatch(`/api/channels/${channelId}/messages`, {
      refresh_embeds: true,
      message_ids: ids,
    }).catch(() => undefined);
  };

  const loadDmChannels = async (generation = readStateGeneration) => {
    try {
      const data =
        await apiGet<Array<{ id: string; name: string; recipient: User }>>(
          "/api/dms",
        );
      if (generation === readStateGeneration && Array.isArray(data)) {
        dispatch({ type: "SET_DM_CHANNELS", dmChannels: data });
        await syncDesktopNotifications();
      }
    } catch {
      /* ignore */
    }
  };

  const openDm = async (targetUserId: string): Promise<string | null> => {
    try {
      const data = await apiPost<{ id: string; name: string; recipient: User }>(
        "/api/dms",
        { target_user_id: targetUserId },
      );
      dispatch({ type: "ADD_DM_CHANNEL", dmChannel: data });
      return data.id;
    } catch {
      return null;
    }
  };

  const loadRelationships = async (generation = readStateGeneration) => {
    try {
      const relationships = await apiGet<Relationship[]>("/api/friends");
      if (generation === readStateGeneration && Array.isArray(relationships)) {
        dispatch({ type: "SET_RELATIONSHIPS", relationships });
      }
    } catch {
      /* ignore */
    }
  };

  const loadNotifications = async (generation = readStateGeneration) => {
    try {
      const data = await apiGet<{
        notifications: AppNotification[];
        unread_count: number;
      }>("/api/notifications");
      if (generation !== readStateGeneration) return;
      dispatch({
        type: "SET_NOTIFICATIONS",
        notifications: data.notifications,
        unreadCount: data.unread_count,
      });
      await syncDesktopNotifications();
    } catch {
      /* ignore */
    }
  };

  const createMessageShare = async (
    messageId: string,
    expires: "7d" | "30d" | "90d" | "never" = "30d",
  ) => {
    const data = await apiPost<{ share_url: string }>(
      `/api/messages/${messageId}/share`,
      { expires },
    );
    return data.share_url;
  };

  const bootstrapChat = async (options?: {
    includeNotifications?: boolean;
    expectedUserId?: string;
    deferNonCritical?: boolean;
  }): Promise<void> => {
    const expectedUserId = options?.expectedUserId ?? get().user?.id ?? null;
    resetReadStateTracking(expectedUserId);
    const existingBootstrap = inFlightBootstrap;
    if (existingBootstrap) {
      if (existingBootstrap.userId === expectedUserId) {
        return existingBootstrap.promise;
      }

      const startNextBootstrap = (): Promise<void> => {
        if (inFlightBootstrap?.promise === existingBootstrap.promise) {
          inFlightBootstrap = null;
        }
        return bootstrapChat(options);
      };

      return existingBootstrap.promise.then(
        startNextBootstrap,
        startNextBootstrap,
      );
    }

    const includeNotifications = options?.includeNotifications ?? true;
    const deferNonCritical = options?.deferNonCritical ?? false;
    const bootstrapGeneration = readStateGeneration;
    const runNonCritical = () => [
      loadProfile(bootstrapGeneration),
      loadDmChannels(bootstrapGeneration),
      loadRelationships(bootstrapGeneration),
      includeNotifications
        ? loadNotifications(bootstrapGeneration)
        : Promise.resolve(),
    ];
    const bootstrapPromise = (async () => {
      await loadCurrentUser(options?.expectedUserId);
      if (deferNonCritical) {
        await Promise.all([loadServers(bootstrapGeneration), loadReadStates()]);
        setTimeout(() => {
          void Promise.allSettled(runNonCritical());
        }, 0);
      } else {
        await Promise.all([
          loadServers(bootstrapGeneration),
          loadReadStates(),
          ...runNonCritical(),
        ]);
      }
    })();
    inFlightBootstrap = { userId: expectedUserId, promise: bootstrapPromise };
    bootstrapPromise.then(
      () => {
        if (inFlightBootstrap?.promise === bootstrapPromise) {
          inFlightBootstrap = null;
        }
      },
      () => {
        if (inFlightBootstrap?.promise === bootstrapPromise) {
          inFlightBootstrap = null;
        }
      },
    );

    return bootstrapPromise;
  };

  const markNotificationsRead = async (ids?: string[]) => {
    if (ids && ids.length > 0) {
      dispatch({ type: "MARK_NOTIFICATIONS_READ", ids });
      await apiPatch("/api/notifications", { ids });
    } else {
      dispatch({ type: "MARK_NOTIFICATIONS_READ", all: true });
      await apiPatch("/api/notifications", { all: true });
    }
    await syncDesktopNotifications();
  };

  const clearNotifications = async () => {
    dispatch({ type: "CLEAR_NOTIFICATIONS" });
    await apiDelete("/api/notifications");
    await syncDesktopNotifications();
  };

  const reorderChannels = async (
    serverId: string,
    channels?: Array<{
      id: string;
      position: number;
      category_id: string | null;
    }>,
    categories?: Array<{ id: string; rank: number }>,
  ) => {
    try {
      await apiPatch(`/api/servers/${serverId}/channels/reorder`, {
        channels,
        categories,
      });
      await loadChannels(serverId);
    } catch {
      /* ignore */
    }
  };

  return {
    sendMessage,
    sendTyping,
    addReaction,
    removeReaction,
    deleteMessage,
    editMessage,
    removeEmbeds,
    createMessageShare,
    loadMessages,
    loadMessagesAround,
    loadMessagesAfter,
    loadServers,
    loadChannels,
    loadMembers,
    createServer,
    createChannel,
    deleteChannel,
    createCategory,
    deleteCategory,
    updateStatus,
    loadProfile,
    loadCurrentUser,
    loadReadStates,
    markChannelRead,
    resetReadStateTracking,
    markChannelUnread,
    pinMessage,
    unpinMessage,
    loadPins,
    refreshMessageEmbeds,
    loadDmChannels,
    loadRelationships,
    openDm,
    loadNotifications,
    bootstrapChat,
    markNotificationsRead,
    clearNotifications,
    reorderChannels,
  };
}
