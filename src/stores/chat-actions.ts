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

export interface ChatRestActions {
  sendMessage: (channelId: string, content: string, replyToId?: string, replyTo?: Message, attachmentIds?: string[], optimisticAttachments?: Attachment[]) => Promise<void>;
  sendTyping: (channelId: string) => Promise<void>;
  addReaction: (channelId: string, messageId: string, emoji: string) => Promise<void>;
  removeReaction: (channelId: string, messageId: string, emoji: string) => Promise<void>;
  deleteMessage: (channelId: string, messageId: string) => Promise<void>;
  editMessage: (messageId: string, content: string) => Promise<void>;
  loadMessages: (channelId: string, before?: string) => Promise<Message[]>;
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
      await fetch(`/api/channels/${channelId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          reply_to_id: replyToId,
          nonce,
          attachment_ids: attachmentIds,
        }),
      });
    } catch {
      dispatch({ type: "DELETE_MESSAGE", id: `pending-${nonce}` });
    }
  };

  const editMessage = async (messageId: string, content: string) => {
    const channelId = get().activeChannelId;
    if (!channelId) return;
    await fetch(`/api/channels/${channelId}/messages`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message_id: messageId, content }),
    });
  };

  const deleteMessage = async (channelId: string, messageId: string) => {
    await fetch(`/api/channels/${channelId}/messages`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message_id: messageId }),
    });
  };

  const addReaction = async (channelId: string, messageId: string, emoji: string) => {
    const user = get().user;
    if (!user) return;

    dispatch({ type: "ADD_REACTION", messageId, emoji, userId: user.id });

    try {
      await fetch(`/api/channels/${channelId}/reactions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message_id: messageId, emoji }),
      });
    } catch {
      dispatch({ type: "REMOVE_REACTION", messageId, emoji, userId: user.id });
    }
  };

  const removeReaction = async (channelId: string, messageId: string, emoji: string) => {
    const user = get().user;
    if (!user) return;

    dispatch({ type: "REMOVE_REACTION", messageId, emoji, userId: user.id });

    try {
      await fetch(`/api/channels/${channelId}/reactions`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message_id: messageId, emoji }),
      });
    } catch {
      dispatch({ type: "ADD_REACTION", messageId, emoji, userId: user.id });
    }
  };

  const sendTyping = async (channelId: string) => {
    await fetch(`/api/channels/${channelId}/typing`, { method: "POST" });
  };

  const loadMessages = async (channelId: string, before?: string): Promise<Message[]> => {
    const params = new URLSearchParams({ limit: "50" });
    if (before) params.set("before", before);
    const res = await fetch(`/api/channels/${channelId}/messages?${params}`);
    if (!res.ok) return [];
    const __json_messages = await res.json();
    const messages = (__json_messages.data ?? __json_messages) as Message[];
    if (!before) {
      dispatch({ type: "SET_MESSAGES", messages });
    } else {
      dispatch({ type: "PREPEND_MESSAGES", messages });
    }
    return messages;
  };

  const loadServers = async () => {
    const res = await fetch("/api/servers");
    if (!res.ok) return;
    const __json_servers = await res.json();
    const servers = (__json_servers.data ?? __json_servers) as Server[];
    dispatch({ type: "SET_SERVERS", servers });
  };

  const loadChannels = async (serverId: string) => {
    const res = await fetch(`/api/servers/${serverId}/channels`);
    if (!res.ok) return;
    const __json_data = await res.json();
    const data = (__json_data.data ?? __json_data) as { channels: Channel[]; categories?: Category[] };
    dispatch({ type: "SET_CHANNELS_AND_CATEGORIES", channels: data.channels ?? [], categories: data.categories ?? [] });
  };

  const loadMembers = async (serverId: string) => {
    const res = await fetch(`/api/servers/${serverId}/members`);
    if (!res.ok) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const __json_members = await res.json();
    const members = (__json_members.data ?? __json_members) as Array<{ user: User; role: number }>;
    dispatch({ type: "SET_MEMBERS", members });
  };

  const createServer = async (name: string, iconUrl?: string): Promise<Server | null> => {
    const res = await fetch("/api/servers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, icon_url: iconUrl }),
    });
    if (!res.ok) return null;
    const __json_server = await res.json();
    const server = (__json_server.data ?? __json_server) as Server;
    dispatch({ type: "ADD_SERVER", server });
    return server;
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

    const res = await fetch(`/api/servers/${serverId}/channels`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, channel_type: type ?? "text", category_id: categoryId }),
    });

    if (!res.ok) {
      dispatch({ type: "REMOVE_CHANNEL", channelId: tempId });
      return null;
    }

    const __json_channel = await res.json();
    const channel = (__json_channel.data ?? __json_channel) as Channel;
    dispatch({ type: "UPDATE_CHANNEL_ID", oldId: tempId, newChannel: channel });
    return channel;
  };

  const createCategory = async (serverId: string, name: string): Promise<Category | null> => {
    const res = await fetch(`/api/servers/${serverId}/categories`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) return null;
    const __json_category = await res.json();
    const category = (__json_category.data ?? __json_category) as Category;
    dispatch({ type: "ADD_CATEGORY", category });
    return category;
  };

  const deleteChannel = async (channelId: string) => {
    await fetch(`/api/channels/${channelId}`, { method: "DELETE" });
  };

  const deleteCategory = async (serverId: string, categoryId: string) => {
    await fetch(`/api/servers/${serverId}/categories/${categoryId}`, { method: "DELETE" });
  };

  const updateStatus = (status: "online" | "idle" | "dnd" | "offline", custom_status?: string) => {
    dispatch({ type: "SET_STATUS", status, customStatus: custom_status });

    if (typeof window !== 'undefined') {
      localStorage.setItem('user-status', status);
    }

    fetch("/api/presence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, custom_status }),
    }).catch(console.error);
  };

  const loadProfile = async () => {
    const res = await fetch("/api/presence");
    if (!res.ok) return;
    const __json_data = await res.json();
    const data = (__json_data.data ?? __json_data) as { status: string; custom_status?: string };
    dispatch({ type: "SET_STATUS", status: data.status as "online" | "idle" | "dnd" | "offline", customStatus: data.custom_status });
  };

  const loadReadStates = async () => {
    const res = await fetch("/api/read-states");
    if (!res.ok) return;
    const data = (await res.json()) as {
      read_states: Array<{ channel_id: string; last_read_at: string }>;
      last_messages: Array<{ channel_id: string; last_message_at: string }>;
    };
    const readStates: Record<string, string> = {};
    for (const rs of data.read_states) {
      readStates[rs.channel_id] = rs.last_read_at;
    }
    const lastMessageAt: Record<string, string> = {};
    for (const lm of data.last_messages) {
      lastMessageAt[lm.channel_id] = lm.last_message_at;
    }
    dispatch({ type: "SET_READ_STATES", readStates, lastMessageAt });
  };

  const markChannelRead = (channelId: string) => {
    const now = new Date().toISOString();
    dispatch({ type: "UPDATE_READ_STATE", channelId, timestamp: now });
    fetch(`/api/channels/${channelId}/read-state`, { method: "PUT" }).catch(() => { });
  };

  const pinMessage = async (channelId: string, messageId: string) => {
    const fullMsg = get().messages.find(m => m.id === messageId);
    dispatch({ type: "PIN_MESSAGE", messageId, pinned: true, fullMessage: fullMsg });

    try {
      await fetch(`/api/channels/${channelId}/pins`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message_id: messageId, pinned: true }),
      });
    } catch {
      dispatch({ type: "PIN_MESSAGE", messageId, pinned: false });
    }
  };

  const unpinMessage = async (channelId: string, messageId: string) => {
    dispatch({ type: "PIN_MESSAGE", messageId, pinned: false });

    try {
      await fetch(`/api/channels/${channelId}/pins`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message_id: messageId, pinned: false }),
      });
    } catch {
      const fullMsg = get().messages.find(m => m.id === messageId);
      dispatch({ type: "PIN_MESSAGE", messageId, pinned: true, fullMessage: fullMsg });
    }
  };

  const loadPins = async (channelId: string, force?: boolean) => {
    if (!force && get().pinsLoadedFor === channelId) return;

    dispatch({ type: "SET_LOADING_PINS", loading: true });
    try {
      const res = await fetch(`/api/channels/${channelId}/pins`);
      if (res.ok) {
        const __json_data = await res.json();
    const data = (__json_data.data ?? __json_data) as Message[];
        dispatch({ type: "SET_PINNED_MESSAGES", messages: data, channelId });
      } else {
        dispatch({ type: "SET_LOADING_PINS", loading: false });
      }
    } catch {
      dispatch({ type: "SET_LOADING_PINS", loading: false });
    }
  };

  const loadDmChannels = async () => {
    const res = await fetch("/api/dms");
    if (!res.ok) return;
    const __json_data = await res.json();
    const data = (__json_data.data ?? __json_data) as Array<{ id: string; name: string; recipient: User }>;
    dispatch({ type: "SET_DM_CHANNELS", dmChannels: data });
  };

  const openDm = async (targetUserId: string): Promise<string | null> => {
    const res = await fetch("/api/dms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target_user_id: targetUserId }),
    });
    if (!res.ok) return null;
    const __json_data = await res.json();
    const data = (__json_data.data ?? __json_data) as { id: string; name: string; recipient: User };
    dispatch({ type: "ADD_DM_CHANNEL", dmChannel: data });
    return data.id;
  };

  const loadRelationships = async () => {
    const res = await fetch("/api/friends");
    if (!res.ok) return;
    const __json_data = await res.json();
    const data = (__json_data.data ?? __json_data) as Relationship[];
    dispatch({ type: "SET_RELATIONSHIPS", relationships: data });
  };

  const loadNotifications = async () => {
    const res = await fetch("/api/notifications");
    if (!res.ok) return;
    const __json_data = await res.json();
    const data = (__json_data.data ?? __json_data) as { notifications: AppNotification[]; unread_count: number };
    dispatch({ type: "SET_NOTIFICATIONS", notifications: data.notifications, unreadCount: data.unread_count });
  };

  const markNotificationsRead = async (ids?: string[]) => {
    if (ids && ids.length > 0) {
      dispatch({ type: "MARK_NOTIFICATIONS_READ", ids });
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
    } else {
      dispatch({ type: "MARK_NOTIFICATIONS_READ", all: true });
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
    }
  };

  const clearNotifications = async () => {
    dispatch({ type: "CLEAR_NOTIFICATIONS" });
    await fetch("/api/notifications", { method: "DELETE" });
  };

  const reorderChannels = async (
    serverId: string,
    channels?: Array<{ id: string; position: number; category_id: string | null }>,
    categories?: Array<{ id: string; rank: number }>,
  ) => {
    const res = await fetch(`/api/servers/${serverId}/channels/reorder`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channels, categories }),
    });
    if (res.ok) {
      await loadChannels(serverId);
    }
  };

  return {
    sendMessage,
    sendTyping,
    addReaction,
    removeReaction,
    deleteMessage,
    editMessage,
    loadMessages,
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
