import type { ChatAction, ChatState } from "@/lib/chat-reducer";
import { apiUrl, isTauri, wsUrl } from "@/lib/platform";
import type { Notification as AppNotification, Message, Role } from "@/lib/types";
import type { ChatRestActions } from "./chat-actions";

export interface ChatGatewayActions {
  initGateway: (userId: string | null | undefined) => void;
  disconnectGateway: () => void;
  setClerkUserId: (userId: string | null | undefined) => void;
  subscribeChannel: (channelId: string) => void;
  unsubscribeChannel: (channelId: string) => void;
  sendVoiceChannelJoin: (channelId: string, selfMute?: boolean) => void;
  sendVoiceChannelLeave: () => void;
  sendVoiceStateUpdate: (data: {
    self_mute?: boolean;
    self_deaf?: boolean;
    self_video?: boolean;
    self_stream?: boolean;
    self_stream_audio?: boolean;
  }) => void;
  sendGateway: (msg: object) => void;
}

export function createChatGateway(
  get: () => ChatState,
  dispatch: (action: ChatAction) => void,
  actions: ChatRestActions
): ChatGatewayActions {
  let ws: WebSocket | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let seq = 0;
  const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let identified = false;
  let gatewayReady = false;
  let pendingQueue: object[] = [];
  let clerkUserId: string | null | undefined = null;

  const sendGateway = (msg: object) => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  };

  const handleDispatch = (d: { event: string; data: any }) => {
    console.log(`[ChatGW] Event: ${d.event}`, d.data);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("chat-gateway-event", { detail: d }));
    }
    switch (d.event) {
      case "MESSAGE_CREATE": {
        const msg = d.data as Message;
        dispatch({ type: "APPEND_MESSAGE", message: msg });
        dispatch({ type: "CLEAR_TYPING", channelId: msg.channel_id, userId: msg.author_id });
        dispatch({ type: "UPDATE_LAST_MESSAGE", channelId: msg.channel_id, timestamp: msg.created_at });

        const state = get();
        const isKnown = state.channels.some(c => c.id === msg.channel_id) ||
          state.dmChannels.some(d => d.id === msg.channel_id);
        if (!isKnown) {
          actions.loadDmChannels();
        }

        if (msg.channel_id === state.activeChannelId) {
          dispatch({ type: "UPDATE_READ_STATE", channelId: msg.channel_id, timestamp: msg.created_at });
          fetch(apiUrl(`/api/channels/${msg.channel_id}/read-state`), { method: "PUT" }).catch(() => { });
        }
        break;
      }
      case "MESSAGE_UPDATE":
        dispatch({
          type: "UPDATE_MESSAGE",
          id: d.data.id,
          content: d.data.content,
          updated_at: d.data.updated_at,
        });
        break;
      case "MESSAGE_DELETE":
        dispatch({ type: "DELETE_MESSAGE", id: d.data.id });
        break;
      case "TYPING_START": {
        const { channel_id, user_id: uid } = d.data;
        if (!uid) break;

        dispatch({ type: "SET_TYPING", channelId: channel_id, userId: uid });
        const timerKey = `${channel_id}:${uid}`;
        const existing = typingTimers.get(timerKey);
        if (existing) clearTimeout(existing);
        typingTimers.set(
          timerKey,
          setTimeout(() => {
            dispatch({ type: "CLEAR_TYPING", channelId: channel_id, userId: uid });
            typingTimers.delete(timerKey);
          }, 8000)
        );
        break;
      }
      case "REACTION_ADD":
        dispatch({
          type: "ADD_REACTION",
          messageId: d.data.message_id,
          emoji: d.data.emoji,
          userId: d.data.user_id,
        });
        break;
      case "REACTION_REMOVE":
        dispatch({
          type: "REMOVE_REACTION",
          messageId: d.data.message_id,
          emoji: d.data.emoji,
          userId: d.data.user_id,
        });
        break;
      case "PRESENCE_UPDATE":
        dispatch({ type: "UPDATE_USER_STATUS", userId: d.data.user_id, status: d.data.status, customStatus: d.data.custom_status });
        if (d.data.status === "offline") {
          dispatch({ type: "USER_OFFLINE", userId: d.data.user_id });
        } else {
          dispatch({ type: "USER_ONLINE", userId: d.data.user_id });
        }
        break;
      case "PRESENCE_LIST":
        dispatch({ type: "SET_ONLINE_USERS", userIds: d.data.user_ids ?? [] });
        break;
      case "GUILD_MEMBER_ADD":
        dispatch({
          type: "ADD_MEMBER",
          member: { user: d.data.user, roles: d.data.roles ?? [] },
        });
        dispatch({ type: "USER_ONLINE", userId: d.data.user.id });
        break;
      case "GUILD_MEMBER_REMOVE": {
        const removedUserId = d.data.user_id;
        const removedServerId = d.data.server_id;
        const state = get();

        if (removedUserId === state.user?.id) {
          const activeChannel = state.activeChannelId;
          if (activeChannel) {
            sendGateway({ op: 28, d: { channel_id: activeChannel } });
          }
          sendGateway({ op: 34, d: {} });
          window.dispatchEvent(new CustomEvent("force-voice-disconnect"));
          dispatch({ type: "REMOVE_SERVER", serverId: removedServerId });
        } else {
          dispatch({ type: "REMOVE_MEMBER", userId: removedUserId });
          dispatch({ type: "USER_OFFLINE", userId: removedUserId });
        }
        break;
      }
      case "GUILD_MEMBER_UPDATE": {
        const p = d.data as { server_id: string; user_id: string; roles?: Role[] };
        if (get().activeServerId !== p.server_id) return;
        dispatch({
          type: "UPDATE_MEMBER_ROLES",
          userId: p.user_id,
          roles: p.roles,
        });
        break;
      }
      case "USER_PROFILE_UPDATE": {
        const p = d.data as { user_id: string; username?: string; avatar_url?: string };
        dispatch({
          type: "UPDATE_MEMBER_PROFILE",
          userId: p.user_id,
          username: p.username,
          avatar_url: p.avatar_url,
        });
        break;
      }
      case "GUILD_UPDATE":
        dispatch({
          type: "UPDATE_SERVER",
          serverId: d.data.id,
          updates: d.data,
        });
        break;
      case "GUILD_DELETE":
        dispatch({ type: "REMOVE_SERVER", serverId: d.data.id });
        break;
      case "CHANNEL_UPDATE": {
        const { server_id } = d.data;
        if (get().activeServerId === server_id) {
          actions.loadChannels(server_id);
        }
        break;
      }
      case "CHANNEL_DELETE": {
        const { id, server_id } = d.data;
        const state = get();
        if (state.activeServerId === server_id) {
          actions.loadChannels(server_id);
          if (state.activeChannelId === id) {
            dispatch({ type: "SET_ACTIVE_CHANNEL", channelId: null });
          }
        }
        break;
      }
      case "RELATIONSHIP_ADD":
        dispatch({ type: "ADD_RELATIONSHIP", relationship: d.data });
        break;
      case "RELATIONSHIP_REMOVE":
        dispatch({ type: "REMOVE_RELATIONSHIP", userId: d.data.user_id });
        break;
      case "DM_CHANNEL_CREATE":
        dispatch({ type: "ADD_DM_CHANNEL", dmChannel: d.data });
        break;
      case "MESSAGE_PIN":
        dispatch({ type: "PIN_MESSAGE", messageId: d.data.id, pinned: true, fullMessage: d.data });
        break;
      case "MESSAGE_UNPIN":
        dispatch({ type: "PIN_MESSAGE", messageId: d.data.id, pinned: false });
        break;
      case "VOICE_CHANNEL_STATES":
        dispatch({ type: "SET_VOICE_CHANNEL_STATES", states: d.data.voice_states ?? {} });
        break;
      case "VOICE_CHANNEL_STATE_UPDATE":
        dispatch({
          type: "UPDATE_VOICE_CHANNEL_STATE",
          channelId: d.data.channel_id,
          members: d.data.members ?? [],
        });
        break;
      case "NOTIFICATION_CREATE": {
        const notif = d.data as AppNotification;
        dispatch({ type: "ADD_NOTIFICATION", notification: notif });

        // Update system tray badge with new unread count
        if (isTauri() && window.__TAURI_INTERNALS__) {
          const newCount = get().unreadNotificationCount;
          (window.__TAURI_INTERNALS__ as any).invoke(
            "plugin:event|emit",
            { event: "update-tray-badge", payload: String(newCount) }
          ).catch(() => { /* tray update unavailable */ });
        }

        // Fire a native OS toast on desktop when the window isn't focused.
        // We invoke the Tauri notification plugin directly via IPC to avoid
        // build-time issues with the npm package living in desktop/node_modules.
        if (isTauri() && !document.hasFocus() && window.__TAURI_INTERNALS__) {
          (window.__TAURI_INTERNALS__ as any).invoke("plugin:notification|notify", {
            title: notif.from_user?.username ?? "Ralph Meet",
            body: notif.content?.slice(0, 200) ?? "New notification",
          }).catch(() => { /* notification plugin unavailable */ });
        }
        break;
      }
    }
  };

  const handleGatewayMessage = (msg: { op: number; d: any }) => {
    switch (msg.op) {
      case 8: {
        const interval = msg.d?.heartbeat_interval ?? 45000;
        if (clerkUserId) {
          sendGateway({ op: 0, d: { name: "ChatClient", clerk_user_id: clerkUserId } });
          identified = true;
        }
        heartbeat = setInterval(() => {
          seq++;
          sendGateway({ op: 3, d: { seq_ack: seq } });
        }, interval);
        break;
      }
      case 2: {
        gatewayReady = true;
        const currentStatus = get().user?.status;
        if (currentStatus && currentStatus !== "online") {
          sendGateway({ op: 26, d: { status: currentStatus } });
        }
        for (const queued of pendingQueue) {
          sendGateway(queued);
        }
        pendingQueue = [];
        break;
      }
      case 6: {
        seq = msg.d?.seq ?? seq;
        break;
      }
      case 19: {
        handleDispatch(msg.d);
        break;
      }
    }
  };

  let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempt = 0;
  let intentionalDisconnect = false;

  const BACKOFF_BASE = 1000;       // 1 second
  const BACKOFF_MAX = 30_000;      // 30 seconds cap
  const BACKOFF_JITTER = 500;      // random jitter up to 500ms

  const getBackoffDelay = (attempt: number) => {
    const delay = Math.min(BACKOFF_BASE * Math.pow(2, attempt), BACKOFF_MAX);
    return delay + Math.random() * BACKOFF_JITTER;
  };

  const scheduleReconnect = () => {
    if (intentionalDisconnect) return;
    if (reconnectTimeout) return; // Already scheduled

    reconnectAttempt++;
    dispatch({ type: "SET_RECONNECT_ATTEMPT", attempt: reconnectAttempt });

    const delay = getBackoffDelay(reconnectAttempt - 1);
    console.log(`[ChatGW] Reconnecting in ${Math.round(delay)}ms (attempt ${reconnectAttempt})`);

    reconnectTimeout = setTimeout(() => {
      reconnectTimeout = null;
      if (!intentionalDisconnect && clerkUserId) {
        initGateway(clerkUserId);
      }
    }, delay);
  };

  const disconnectGateway = () => {
    intentionalDisconnect = true;
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }
    if (ws) {
      ws.close();
      ws = null;
    }
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
    gatewayReady = false;
    identified = false;
    reconnectAttempt = 0;
    dispatch({ type: "SET_RECONNECT_ATTEMPT", attempt: 0 });
  };

  const initGateway = (userId: string | null | undefined) => {
    if (ws) return; // Already connected or connecting

    intentionalDisconnect = false;
    clerkUserId = userId;
    const url = wsUrl("/api/gateway");

    ws = new WebSocket(url);

    ws.onopen = () => {
      console.log("[ChatGW] Connected");
      reconnectAttempt = 0;
      dispatch({ type: "SET_CONNECTED", connected: true });
      dispatch({ type: "SET_RECONNECT_ATTEMPT", attempt: 0 });
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleGatewayMessage(msg);
      } catch {
        console.warn("[ChatGW] Invalid message:", event.data);
      }
    };

    ws.onclose = () => {
      console.log("[ChatGW] Disconnected");
      dispatch({ type: "SET_CONNECTED", connected: false });

      // Clean up internals
      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = null;
      }
      ws = null;
      gatewayReady = false;
      identified = false;

      // Auto-reconnect unless intentionally disconnected
      scheduleReconnect();
    };
  };

  const setClerkUserId = (userId: string | null | undefined) => {
    clerkUserId = userId;
    if (userId && !identified && ws?.readyState === WebSocket.OPEN) {
      sendGateway({ op: 0, d: { name: "ChatClient", clerk_user_id: userId } });
      identified = true;
    }
  };

  const sendWhenReady = (msg: object) => {
    if (gatewayReady) {
      sendGateway(msg);
    } else {
      pendingQueue.push(msg);
    }
  };

  return {
    initGateway,
    disconnectGateway,
    setClerkUserId,
    subscribeChannel: (channelId: string) => sendWhenReady({ op: 27, d: { channel_id: channelId } }),
    unsubscribeChannel: (channelId: string) => sendWhenReady({ op: 28, d: { channel_id: channelId } }),
    sendVoiceChannelJoin: (channelId: string, selfMute?: boolean) => sendWhenReady({ op: 33, d: { channel_id: channelId, self_mute: selfMute ?? true } }),
    sendVoiceChannelLeave: () => sendWhenReady({ op: 34, d: {} }),
    sendVoiceStateUpdate: (data) => sendWhenReady({ op: 15, d: data }),
    sendGateway,
  };
}
