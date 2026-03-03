import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "@/lib/api-client";
import type { ChatAction, ChatState } from "@/lib/chat-reducer";
import { isTauri } from "@/lib/platform";
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

export interface ChatRestActions {
  sendMessage: (channelId: string, content: string, replyToId?: string, replyTo?: Message, attachmentIds?: string[], optimisticAttachments?: Attachment[]) => Promise<void>;
  sendTyping: (channelId: string) => Promise<void>;
  addReaction: (channelId: string, messageId: string, emoji: string) => Promise<void>;
  removeReaction: (channelId: string, messageId: string, emoji: string) => Promise<void>;
  deleteMessage: (channelId: string, messageId: string) => Promise<void>;
  editMessage: (messageId: string, content: string) => Promise<void>;
  loadMessages: (channelId: string, before?: string) => Promise<Message[]>;
  loadMessagesAround: (channelId: string, messageId: string) => Promise<{ hasMoreBefore: boolean; hasMoreAfter: boolean }>;
  loadMessagesAfter: (channelId: string, after: string) => Promise<{ hasMoreAfter: boolean }>;
  loadServers: () => Promise<void>;
  loadChannels: (serverId: string) => Promise<void>;
  loadMembers: (serverId: string) => Promise<void>;
  createServer: (name: string, iconUrl?: string) => Promise<Server | null>;
  createChannel: (serverId: string, name: string, type?: string, categoryId?: string) => Promise<Channel | null>;
  deleteChannel: (channelId: string) => Promise<void>;
  createCategory: (serverId: string, name: string) => Promise<Category | null>;
  deleteCategory: (serverId: string, categoryId: string) => Promise<void>;
  updateStatus: (status: "online" | "idle" | "dnd" | "offline", custom_status?: string) => void;
  loadProfile: () => Promise<void>;
  loadCurrentUser: () => Promise<void>;
  loadReadStates: () => Promise<void>;
  markChannelRead: (channelId: string) => void;
  pinMessage: (channelId: string, messageId: string) => Promise<void>;
  unpinMessage: (channelId: string, messageId: string) => Promise<void>;
  loadPins: (channelId: string, force?: boolean) => Promise<void>;
  loadDmChannels: () => Promise<void>;
  loadRelationships: () => Promise<void>;
  openDm: (targetUserId: string) => Promise<string | null>;
  loadNotifications: () => Promise<void>;
  markNotificationsRead: (ids?: string[]) => Promise<void>;
  clearNotifications: () => Promise<void>;
  reorderChannels: (serverId: string, channels?: Array<{ id: string; position: number; category_id: string | null }>, categories?: Array<{ id: string; rank: number }>) => Promise<void>;
}

export function createChatActions(
  get: () => ChatState,
  dispatch: (action: ChatAction) => void
): ChatRestActions {

  const sendMessage = async (channelId: string, content: string, replyToId?: string, replyToMsg?: Message, attachmentIds?: string[], optimisticAttachments?: Attachment[]) => {
    const nonce = crypto.randomUUID();
    const user = get().user;

    const optimisticMsg: Message = {
      id: `pending-${nonce}`,
      channel_id: channelId,
      author_id: user?.id ?? "",
      author: user ? {
        id: user.id,
        username: user.username,
        avatar_url: user.avatar_url,
      } : undefined,
      content,
      reply_to_id: replyToId,
      reply_to: replyToMsg ? {
        id: replyToMsg.id,
        content: replyToMsg.content.slice(0, 200),
        author_id: replyToMsg.author_id,
        author: replyToMsg.author,
      } as Message : undefined,
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
      });
    } catch {
      dispatch({ type: "DELETE_MESSAGE", id: `pending-${nonce}` });
    }
  };

  const editMessage = async (messageId: string, content: string) => {
    const channelId = get().activeChannelId;
    if (!channelId) return;
    await apiPatch(`/api/channels/${channelId}/messages`, { message_id: messageId, content });
  };

  const deleteMessage = async (channelId: string, messageId: string) => {
    await apiDelete(`/api/channels/${channelId}/messages`, { message_id: messageId });
  };

  const addReaction = async (channelId: string, messageId: string, emoji: string) => {
    const user = get().user;
    if (!user) return;

    dispatch({ type: "ADD_REACTION", messageId, emoji, userId: user.id });

    try {
      await apiPut(`/api/channels/${channelId}/reactions`, { message_id: messageId, emoji });
    } catch {
      dispatch({ type: "REMOVE_REACTION", messageId, emoji, userId: user.id });
    }
  };

  const removeReaction = async (channelId: string, messageId: string, emoji: string) => {
    const user = get().user;
    if (!user) return;

    dispatch({ type: "REMOVE_REACTION", messageId, emoji, userId: user.id });

    try {
      await apiDelete(`/api/channels/${channelId}/reactions`, { message_id: messageId, emoji });
    } catch {
      dispatch({ type: "ADD_REACTION", messageId, emoji, userId: user.id });
    }
  };

  const sendTyping = async (channelId: string) => {
    await apiPost(`/api/channels/${channelId}/typing`, {});
  };

  const loadMessages = async (channelId: string, before?: string): Promise<Message[]> => {
    const params = new URLSearchParams({ limit: "50" });
    if (before) params.set("before", before);
    try {
      const messages = await apiGet<Message[]>(`/api/channels/${channelId}/messages?${params}`);
      if (!before) {
        dispatch({ type: "SET_MESSAGES", messages });
      } else {
        dispatch({ type: "PREPEND_MESSAGES", messages });
      }
      return messages;
    } catch {
      return [];
    }
  };

  const loadMessagesAround = async (
    channelId: string,
    messageId: string
  ): Promise<{ hasMoreBefore: boolean; hasMoreAfter: boolean }> => {
    try {
      const data = await apiGet<{ messages: Message[]; hasMoreBefore: boolean; hasMoreAfter: boolean }>(
        `/api/channels/${channelId}/messages?around=${encodeURIComponent(messageId)}`
      );
      dispatch({ type: "REPLACE_MESSAGES", messages: data.messages });
      return { hasMoreBefore: data.hasMoreBefore, hasMoreAfter: data.hasMoreAfter };
    } catch {
      return { hasMoreBefore: false, hasMoreAfter: false };
    }
  };

  const loadMessagesAfter = async (
    channelId: string,
    after: string
  ): Promise<{ hasMoreAfter: boolean }> => {
    try {
      const data = await apiGet<{ messages: Message[]; hasMoreAfter: boolean }>(
        `/api/channels/${channelId}/messages?after=${encodeURIComponent(after)}&limit=50`
      );
      dispatch({ type: "APPEND_MESSAGES_AFTER", messages: data.messages });
      return { hasMoreAfter: data.hasMoreAfter };
    } catch {
      return { hasMoreAfter: false };
    }
  };

  const loadServers = async () => {
    try {
      const servers = await apiGet<Server[]>("/api/servers");
      dispatch({ type: "SET_SERVERS", servers });
    } catch { /* ignore */ }
  };

  const loadChannels = async (serverId: string) => {
    try {
      const data = await apiGet<{ channels: Channel[]; categories?: Category[] }>(`/api/servers/${serverId}/channels`);
      dispatch({ type: "SET_CHANNELS_AND_CATEGORIES", channels: data.channels ?? [], categories: data.categories ?? [] });
    } catch { /* ignore */ }
  };

  const loadMembers = async (serverId: string) => {
    try {
      const members = await apiGet<Array<{ user: User; role: number }>>(`/api/servers/${serverId}/members`);
      dispatch({ type: "SET_MEMBERS", members });
    } catch { /* ignore */ }
  };

  const createServer = async (name: string, iconUrl?: string): Promise<Server | null> => {
    try {
      const server = await apiPost<Server>("/api/servers", { name, icon_url: iconUrl });
      dispatch({ type: "ADD_SERVER", server });
      return server;
    } catch {
      return null;
    }
  };

  const createChannel = async (serverId: string, name: string, type?: string, categoryId?: string): Promise<Channel | null> => {
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
      const channel = await apiPost<Channel>(`/api/servers/${serverId}/channels`, {
        name,
        channel_type: type ?? "text",
        category_id: categoryId,
      });
      dispatch({ type: "UPDATE_CHANNEL_ID", oldId: tempId, newChannel: channel });
      return channel;
    } catch {
      dispatch({ type: "REMOVE_CHANNEL", channelId: tempId });
      return null;
    }
  };

  const createCategory = async (serverId: string, name: string): Promise<Category | null> => {
    try {
      const category = await apiPost<Category>(`/api/servers/${serverId}/categories`, { name });
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

  const updateStatus = (status: "online" | "idle" | "dnd" | "offline", custom_status?: string) => {
    dispatch({ type: "SET_STATUS", status, customStatus: custom_status });

    if (typeof window !== 'undefined') {
      localStorage.setItem('user-status', status);
    }

    apiPost("/api/presence", { status, custom_status }).catch(console.error);
  };

  const loadProfile = async () => {
    try {
      const data = await apiGet<{ status: string; custom_status?: string }>("/api/presence");
      dispatch({ type: "SET_STATUS", status: data.status as "online" | "idle" | "dnd" | "offline", customStatus: data.custom_status });
    } catch { /* ignore */ }
  };

  const loadCurrentUser = async () => {
    try {
      const profile = await apiGet<{ id: string; username: string; avatar_url: string | null; status?: string; custom_status?: string }>("/api/users/me");
      const current = get().user;
      // SET_USER fully replaces state.user — merge D1 profile with existing state
      dispatch({
        type: "SET_USER",
        user: {
          id: profile.id,
          username: profile.username || current?.username || "Guest",
          avatar_url: profile.avatar_url ?? current?.avatar_url ?? "",
          status: (profile.status as any) ?? current?.status ?? "online",
          custom_status: profile.custom_status ?? current?.custom_status,
        },
      });
      // Also update the member list and voice states for this user
      if (profile.avatar_url) {
        dispatch({
          type: "UPDATE_MEMBER_PROFILE",
          userId: profile.id,
          avatar_url: profile.avatar_url,
          username: profile.username,
        });
      }
    } catch { /* ignore */ }
  };

  const loadReadStates = async () => {
    try {
      const data = await apiGet<{
        read_states: Array<{ channel_id: string; last_read_at: string }>;
        last_messages: Array<{ channel_id: string; last_message_at: string }>;
      }>("/api/read-states");
      const readStates: Record<string, string> = {};
      for (const rs of data.read_states) {
        readStates[rs.channel_id] = rs.last_read_at;
      }
      const lastMessageAt: Record<string, string> = {};
      for (const lm of data.last_messages) {
        lastMessageAt[lm.channel_id] = lm.last_message_at;
      }
      dispatch({ type: "SET_READ_STATES", readStates, lastMessageAt });
    } catch { /* ignore */ }
  };

  const markChannelRead = (channelId: string) => {
    const now = new Date().toISOString();
    dispatch({ type: "UPDATE_READ_STATE", channelId, timestamp: now });
    apiPut(`/api/channels/${channelId}/read-state`, {}).catch(() => { });
  };

  const pinMessage = async (channelId: string, messageId: string) => {
    const fullMsg = get().messages.find(m => m.id === messageId);
    dispatch({ type: "PIN_MESSAGE", messageId, pinned: true, fullMessage: fullMsg });

    try {
      await apiPut(`/api/channels/${channelId}/pins`, { message_id: messageId, pinned: true });
    } catch {
      dispatch({ type: "PIN_MESSAGE", messageId, pinned: false });
    }
  };

  const unpinMessage = async (channelId: string, messageId: string) => {
    dispatch({ type: "PIN_MESSAGE", messageId, pinned: false });

    try {
      await apiPut(`/api/channels/${channelId}/pins`, { message_id: messageId, pinned: false });
    } catch {
      const fullMsg = get().messages.find(m => m.id === messageId);
      dispatch({ type: "PIN_MESSAGE", messageId, pinned: true, fullMessage: fullMsg });
    }
  };

  const loadPins = async (channelId: string, force?: boolean) => {
    if (!force && get().pinsLoadedFor === channelId) return;

    dispatch({ type: "SET_LOADING_PINS", loading: true });
    try {
      const messages = await apiGet<Message[]>(`/api/channels/${channelId}/pins`);
      dispatch({ type: "SET_PINNED_MESSAGES", messages, channelId });
    } catch {
      dispatch({ type: "SET_LOADING_PINS", loading: false });
    }
  };

  const loadDmChannels = async () => {
    try {
      const data = await apiGet<Array<{ id: string; name: string; recipient: User }>>("/api/dms");
      dispatch({ type: "SET_DM_CHANNELS", dmChannels: data });
    } catch { /* ignore */ }
  };

  const openDm = async (targetUserId: string): Promise<string | null> => {
    try {
      const data = await apiPost<{ id: string; name: string; recipient: User }>("/api/dms", { target_user_id: targetUserId });
      dispatch({ type: "ADD_DM_CHANNEL", dmChannel: data });
      return data.id;
    } catch {
      return null;
    }
  };

  const loadRelationships = async () => {
    try {
      const relationships = await apiGet<Relationship[]>("/api/friends");
      dispatch({ type: "SET_RELATIONSHIPS", relationships });
    } catch { /* ignore */ }
  };

  const loadNotifications = async () => {
    try {
      const data = await apiGet<{ notifications: AppNotification[]; unread_count: number }>("/api/notifications");
      dispatch({ type: "SET_NOTIFICATIONS", notifications: data.notifications, unreadCount: data.unread_count });
    } catch { /* ignore */ }
  };

  const updateTrayBadge = (count: number) => {
    if (isTauri() && typeof window !== "undefined" && window.__TAURI_INTERNALS__) {
      (window.__TAURI_INTERNALS__ as any).invoke(
        "plugin:event|emit",
        { event: "update-tray-badge", payload: String(count) }
      ).catch(() => { /* tray update unavailable */ });
    }
  };

  const markNotificationsRead = async (ids?: string[]) => {
    if (ids && ids.length > 0) {
      dispatch({ type: "MARK_NOTIFICATIONS_READ", ids });
      await apiPatch("/api/notifications", { ids });
    } else {
      dispatch({ type: "MARK_NOTIFICATIONS_READ", all: true });
      await apiPatch("/api/notifications", { all: true });
    }
    updateTrayBadge(get().unreadNotificationCount);
  };

  const clearNotifications = async () => {
    dispatch({ type: "CLEAR_NOTIFICATIONS" });
    await apiDelete("/api/notifications");
    updateTrayBadge(0);
  };

  const reorderChannels = async (
    serverId: string,
    channels?: Array<{ id: string; position: number; category_id: string | null }>,
    categories?: Array<{ id: string; rank: number }>,
  ) => {
    try {
      await apiPatch(`/api/servers/${serverId}/channels/reorder`, { channels, categories });
      await loadChannels(serverId);
    } catch { /* ignore */ }
  };

  return {
    sendMessage,
    sendTyping,
    addReaction,
    removeReaction,
    deleteMessage,
    editMessage,
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
    pinMessage,
    unpinMessage,
    loadPins,
    loadDmChannels,
    loadRelationships,
    openDm,
    loadNotifications,
    markNotificationsRead,
    clearNotifications,
    reorderChannels,
  };
}
