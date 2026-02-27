"use client";

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
import { useCallback } from "react";

// ── Types ───────────────────────────────────────────────────────────────────

export interface RestActions {
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
  createServer: (name: string) => Promise<Server | null>;
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
}

// ── Hook ────────────────────────────────────────────────────────────────────

/**
 * REST API actions for all chat mutations and queries.
 * Discord pattern: all writes go through REST, events arrive via WebSocket.
 */
export function useChatRestActions(
  dispatch: React.Dispatch<ChatAction>,
  stateRef: React.MutableRefObject<ChatState>,
): RestActions {

  // ── Message mutations ─────────────────────────────────────────────────

  const sendMessage = useCallback(
    async (channelId: string, content: string, replyToId?: string, replyToMsg?: Message, attachmentIds?: string[], optimisticAttachments?: Attachment[]) => {
      const nonce = crypto.randomUUID();
      const user = stateRef.current.user;

      // Optimistic: immediately show the message locally
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
      // Clear typing indicator locally - server MESSAGE_CREATE will clear it for others
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
        // Remove the optimistic message on failure
        dispatch({ type: "DELETE_MESSAGE", id: `pending-${nonce}` });
      }
    },
    []
  );

  const editMessage = useCallback(
    async (messageId: string, content: string) => {
      // We need the channelId — get it from current active channel
      const channelId = stateRef.current.activeChannelId;
      if (!channelId) return;
      await fetch(`/api/channels/${channelId}/messages`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message_id: messageId, content }),
      });
    },
    []
  );

  const deleteMessage = useCallback(
    async (channelId: string, messageId: string) => {
      await fetch(`/api/channels/${channelId}/messages`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message_id: messageId }),
      });
    },
    []
  );

  // ── Reactions ─────────────────────────────────────────────────────────

  const addReaction = useCallback(
    async (channelId: string, messageId: string, emoji: string) => {
      await fetch(`/api/channels/${channelId}/reactions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message_id: messageId, emoji }),
      });
    },
    []
  );

  const removeReaction = useCallback(
    async (channelId: string, messageId: string, emoji: string) => {
      await fetch(`/api/channels/${channelId}/reactions`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message_id: messageId, emoji }),
      });
    },
    []
  );

  // ── Typing ────────────────────────────────────────────────────────────

  const sendTyping = useCallback(
    async (channelId: string) => {
      await fetch(`/api/channels/${channelId}/typing`, {
        method: "POST",
      });
    },
    []
  );

  // ── Data loading ──────────────────────────────────────────────────────

  const loadMessages = useCallback(
    async (channelId: string, before?: string): Promise<Message[]> => {
      const params = new URLSearchParams({ limit: "50" });
      if (before) params.set("before", before);
      const res = await fetch(`/api/channels/${channelId}/messages?${params}`);
      if (!res.ok) return [];
      const messages = (await res.json()) as Message[];
      if (!before) {
        dispatch({ type: "SET_MESSAGES", messages });
      } else {
        dispatch({ type: "PREPEND_MESSAGES", messages });
      }
      return messages;
    },
    []
  );

  const loadServers = useCallback(async () => {
    const res = await fetch("/api/servers");
    if (!res.ok) return;
    const servers = (await res.json()) as Server[];
    dispatch({ type: "SET_SERVERS", servers });
  }, []);

  const loadChannels = useCallback(async (serverId: string) => {
    const res = await fetch(`/api/servers/${serverId}/channels`);
    if (!res.ok) return;
    const data = (await res.json()) as { channels: Channel[]; categories?: Category[] };
    dispatch({ type: "SET_CHANNELS_AND_CATEGORIES", channels: data.channels ?? [], categories: data.categories ?? [] });
  }, []);

  const loadMembers = useCallback(async (serverId: string) => {
    const res = await fetch(`/api/servers/${serverId}/members`);
    if (!res.ok) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const members = (await res.json()) as Array<{ user: User; role: number }>;
    dispatch({ type: "SET_MEMBERS", members });
  }, []);

  // ── Server/channel CRUD ───────────────────────────────────────────────

  const createServer = useCallback(async (name: string): Promise<Server | null> => {
    const res = await fetch("/api/servers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) return null;
    const server = (await res.json()) as Server;
    dispatch({ type: "ADD_SERVER", server });
    return server;
  }, []);

  const createChannel = useCallback(
    async (serverId: string, name: string, type?: string, categoryId?: string): Promise<Channel | null> => {
      const res = await fetch(`/api/servers/${serverId}/channels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, channel_type: type ?? "text", category_id: categoryId }),
      });
      if (!res.ok) return null;
      const channel = (await res.json()) as Channel;
      dispatch({ type: "ADD_CHANNEL", channel });
      return channel;
    },
    []
  );

  const createCategory = useCallback(async (serverId: string, name: string): Promise<Category | null> => {
    const res = await fetch(`/api/servers/${serverId}/categories`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) return null;
    const category = (await res.json()) as Category;
    dispatch({ type: "ADD_CATEGORY", category });
    return category;
  }, []);

  const deleteChannel = useCallback(async (channelId: string) => {
    await fetch(`/api/channels/${channelId}`, { method: "DELETE" });
  }, []);

  const deleteCategory = useCallback(async (serverId: string, categoryId: string) => {
    await fetch(`/api/servers/${serverId}/categories/${categoryId}`, { method: "DELETE" });
  }, []);

  // ── Status & Profile ──────────────────────────────────────────────────

  const updateStatus = useCallback(
    (status: "online" | "idle" | "dnd" | "offline", custom_status?: string) => {
      // Optimistic update
      dispatch({ type: "SET_STATUS", status, customStatus: custom_status });

      // Update DB and broadcast
      if (typeof window !== 'undefined') {
        localStorage.setItem('user-status', status);
      }

      fetch("/api/presence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, custom_status }),
      }).catch(console.error);
    },
    []
  );

  const loadProfile = useCallback(async () => {
    const res = await fetch("/api/presence");
    if (!res.ok) return;
    const data = await res.json() as { status: string; custom_status?: string };
    dispatch({ type: "SET_STATUS", status: data.status as "online" | "idle" | "dnd" | "offline", customStatus: data.custom_status });
  }, []);

  // ── Read states ───────────────────────────────────────────────────────

  const loadReadStates = useCallback(async () => {
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
  }, []);

  const markChannelRead = useCallback((channelId: string) => {
    const now = new Date().toISOString();
    dispatch({ type: "UPDATE_READ_STATE", channelId, timestamp: now });
    // Fire-and-forget REST call to persist
    fetch(`/api/channels/${channelId}/read-state`, { method: "PUT" }).catch(() => { });
  }, []);

  // ── Pins ──────────────────────────────────────────────────────────────

  const pinMessage = useCallback(async (channelId: string, messageId: string) => {
    await fetch(`/api/channels/${channelId}/pins`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message_id: messageId, pinned: true }),
    });
  }, []);

  const unpinMessage = useCallback(async (channelId: string, messageId: string) => {
    await fetch(`/api/channels/${channelId}/pins`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message_id: messageId, pinned: false }),
    });
  }, []);

  const loadPins = useCallback(async (channelId: string, force?: boolean) => {
    if (!force && stateRef.current.pinsLoadedFor === channelId) return;

    dispatch({ type: "SET_LOADING_PINS", loading: true });
    try {
      const res = await fetch(`/api/channels/${channelId}/pins`);
      if (res.ok) {
        const data = await res.json() as Message[];
        dispatch({ type: "SET_PINNED_MESSAGES", messages: data, channelId });
      } else {
        dispatch({ type: "SET_LOADING_PINS", loading: false });
      }
    } catch {
      dispatch({ type: "SET_LOADING_PINS", loading: false });
    }
  }, []);

  // ── DMs ───────────────────────────────────────────────────────────────

  const loadDmChannels = useCallback(async () => {
    const res = await fetch("/api/dms");
    if (!res.ok) return;
    const data = await res.json() as Array<{ id: string; name: string; recipient: User }>;
    dispatch({ type: "SET_DM_CHANNELS", dmChannels: data });
  }, []);

  const openDm = useCallback(async (targetUserId: string): Promise<string | null> => {
    const res = await fetch("/api/dms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target_user_id: targetUserId }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { id: string; name: string; recipient: User };
    dispatch({ type: "ADD_DM_CHANNEL", dmChannel: data });
    return data.id;
  }, []);

  // ── Relationships ─────────────────────────────────────────────────────

  const loadRelationships = useCallback(async () => {
    const res = await fetch("/api/friends");
    if (!res.ok) return;
    const data = await res.json() as Relationship[];
    dispatch({ type: "SET_RELATIONSHIPS", relationships: data });
  }, []);

  // ── Notifications ─────────────────────────────────────────────────────

  const loadNotifications = useCallback(async () => {
    const res = await fetch("/api/notifications");
    if (!res.ok) return;
    const data = await res.json() as { notifications: AppNotification[]; unread_count: number };
    dispatch({ type: "SET_NOTIFICATIONS", notifications: data.notifications, unreadCount: data.unread_count });
  }, []);

  const markNotificationsRead = useCallback(async (ids?: string[]) => {
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
  }, []);

  const clearNotifications = useCallback(async () => {
    dispatch({ type: "CLEAR_NOTIFICATIONS" });
    await fetch("/api/notifications", { method: "DELETE" });
  }, []);

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
  };
}
