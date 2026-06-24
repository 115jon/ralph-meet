import type { ChatAction, ChatState } from "@/lib/chat-reducer";
import { clog } from "@/lib/console-logger";
import { getDisplayName } from "@/lib/display-name";
import {
  getUnreadChannelState,
  shouldNativeNotifyForChannelActivity,
  shouldNativeNotifyForMessage,
} from "@/lib/desktop-notifications";
import { MOBILE_ACTION_TYPE_ID, showNativeDesktopToast, syncDesktopNotificationState } from "@/lib/desktop-native-sync";
import { apiPut } from "@/lib/api-client";
import { isTauri, wsUrl } from "@/lib/platform";
import {
  areReconnectSoundsSuppressed,
  beginReconnectSoundSuppression,
  getVoiceChannelPresenceSound,
} from "@/lib/reconnect-sound-guard";
import {
  playCallConnect,
  playCallEnd,
  playNotification,
  playOutgoingRingStart,
  playOutgoingRingStop,
  playRingStart,
  playRingStop,
  playVoiceJoin,
  playVoiceLeave
} from "@/lib/sounds";
import type { Channel, Notification as AppNotification, Message, Role } from "@/lib/types";
import { HeartbeatManager } from "@/lib/voice/heartbeat-manager";
import type { ChatRestActions } from "./chat-actions";
import { useCallStore } from "./useCallStore";
import { useDesktopSettingsStore } from "./useDesktopSettingsStore";
import { isSoundEnabled } from "./useSoundSettingsStore";

const chatLog = clog("ChatGW");

export interface ChatGatewayActions {
  initGateway: (userId: string | null | undefined) => void;
  disconnectGateway: () => void;
  setClerkUserId: (userId: string | null | undefined) => void;
  subscribeChannel: (channelId: string) => void;
  unsubscribeChannel: (channelId: string) => void;
  subscribeServer: (serverId: string) => void;
  sendVoiceChannelJoin: (channelId: string, selfMute?: boolean, startedAt?: number | null) => void;
  sendVoiceChannelLeave: (channelId?: string) => void;
  sendVoiceStateUpdate: (data: {
    self_mute?: boolean;
    self_deaf?: boolean;
    self_video?: boolean;
    self_stream?: boolean;
    self_stream_audio?: boolean;
    spatial_audio_enabled?: boolean;
    spatial_audio_high_fidelity?: boolean;
    spatial_audio_state?: import("@/lib/voice/spatial-audio").SharedSpatialAudioState;
  }) => void;
  sendGateway: (msg: object) => void;
  sendCallInitiate: (targetUserId: string, channelId: string) => void;
  sendCallAccept: (callId: string) => void;
  sendCallDecline: (callId: string) => void;
  sendCallEnd: (callId: string) => void;
}

export function createChatGateway(
  get: () => ChatState,
  dispatch: (action: ChatAction) => void,
  actions: ChatRestActions
): ChatGatewayActions {
  let ws: WebSocket | null = null;
  let seq = 0;
  // Raw heartbeat — must match setWebSocketAutoResponse pattern exactly (no extra fields)
  const HEARTBEAT_MSG = JSON.stringify({ op: 3 });
  const hb = new HeartbeatManager("ChatGW", {
    sendBeat: () => { if (ws?.readyState === WebSocket.OPEN) ws.send(HEARTBEAT_MSG); },
    onZombie: () => ws?.close(),
  });
  const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const recentlyToastedMessageIds = new Map<string, number>();
  let identified = false;
  let gatewayReady = false;
  let pendingQueue: object[] = [];
  let clerkUserId: string | null | undefined = null;

  const sendGateway = (msg: object) => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  };

  const noteToastedMessage = (messageId: string) => {
    recentlyToastedMessageIds.set(messageId, Date.now());
    if (recentlyToastedMessageIds.size < 200) return;

    const cutoff = Date.now() - 60_000;
    for (const [id, timestamp] of recentlyToastedMessageIds) {
      if (timestamp < cutoff) {
        recentlyToastedMessageIds.delete(id);
      }
    }
  };

  const syncDesktopState = async () => {
    const state = get();
    const { unreadDmChannelIds, unreadServerChannelIds } = getUnreadChannelState({
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

  const messageTargetsCurrentUser = (message: Message) => {
    const state = get();
    const currentUser = state.user;
    if (!currentUser) return false;

    if (message.reply_to?.author_id === currentUser.id) {
      return true;
    }

    const username = currentUser.username?.trim().toLowerCase();
    if (!username) return false;

    const mentionRegex = /@(\w+)/g;
    let match: RegExpExecArray | null;
    while ((match = mentionRegex.exec(message.content ?? "")) !== null) {
      if (match[1]?.toLowerCase() === username) {
        return true;
      }
    }

    return false;
  };

  const handleDispatch = (d: { event: string; data: any }) => {
    if (import.meta.env.DEV) chatLog.info(`Event: ${d.event}`, d.data);
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
          void apiPut(`/api/channels/${msg.channel_id}/read-state`, {}).catch(() => { });
        }

        const isDmChannel = state.dmChannels.some((dm) => dm.id === msg.channel_id);
        if (
          !isDmChannel &&
          msg.author_id !== state.user?.id &&
          !messageTargetsCurrentUser(msg) &&
          shouldNativeNotifyForChannelActivity({
            channelId: msg.channel_id,
            activeChannelId: state.activeChannelId,
            focused: document.hasFocus(),
            desktopNotificationsEnabled: useDesktopSettingsStore.getState().desktopNotifications,
          })
        ) {
          const channel = state.channels.find((candidate) => candidate.id === msg.channel_id)
            ?? Object.values(state.channelsByServerId).flat().find((candidate) => candidate.id === msg.channel_id);
          const server = channel?.server_id
            ? state.servers.find((candidate) => candidate.id === channel.server_id)
            : null;
          const title = channel?.name
            ? `${getDisplayName(msg.author, "Someone")} in #${channel.name}`
            : `${getDisplayName(msg.author, "Someone")} sent a message`;
          const imageAttachment = msg.attachments?.find((attachment) => attachment.content_type?.startsWith("image/"));
          const body = msg.content?.trim()
            ? server?.name ? `${server.name}\n${msg.content.slice(0, 200)}` : msg.content.slice(0, 200)
            : imageAttachment ? "Sent a photo" : (server?.name ?? "New server message");
          void showNativeDesktopToast({
            title,
            body,
            largeBody: msg.content?.trim() ? msg.content.slice(0, 1000) : undefined,
            summary: server?.name,
            group: channel?.server_id ?? msg.channel_id,
            icon: msg.author?.avatar_url ?? undefined,
            actionTypeId: MOBILE_ACTION_TYPE_ID,
            autoCancel: true,
            extra: {
              channelId: msg.channel_id,
              messageId: msg.id,
              serverId: channel?.server_id ?? null,
              authorId: msg.author_id,
            },
          });
          noteToastedMessage(msg.id);
        }

        void syncDesktopState();
        break;
      }
      case "MESSAGE_UPDATE":
        dispatch({
          type: "UPDATE_MESSAGE",
          id: d.data.id,
          content: d.data.content,
          updated_at: d.data.updated_at,
          embeds: d.data.embeds,
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

          // Real-time call disconnect detection: if our call partner goes offline while ringing, end the call
          const callState = useCallStore.getState();
          if (
            callState.remoteUser?.id === d.data.user_id &&
            (callState.status === "ringing_outgoing" || callState.status === "ringing_incoming")
          ) {
            chatLog.info("Remote user went offline, cancelling ringing call.");
            callState.endCall("disconnected");
            playRingStop();
            playOutgoingRingStop();
            if (isSoundEnabled("calls")) playCallEnd();
          }
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
          serverId: d.data.server_id,
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
          dispatch({ type: "REMOVE_MEMBER", serverId: removedServerId, userId: removedUserId });
          dispatch({ type: "USER_OFFLINE", userId: removedUserId });
        }
        break;
      }
      case "GUILD_MEMBER_UPDATE": {
        const p = d.data as { server_id: string; user_id: string; roles?: Role[] };
        dispatch({
          type: "UPDATE_MEMBER_ROLES",
          serverId: p.server_id,
          userId: p.user_id,
          roles: p.roles,
        });
        break;
      }
      case "USER_PROFILE_UPDATE": {
        const p = d.data as {
          user_id: string;
          username?: string;
          display_name?: string;
          avatar_url?: string;
          banner_url?: string;
          banner_content_type?: string;
          nameplate_url?: string;
          nameplate_content_type?: string;
          updated_at?: string;
        };
        dispatch({
          type: "UPDATE_MEMBER_PROFILE",
          userId: p.user_id,
          username: p.username,
          display_name: p.display_name,
          avatar_url: p.avatar_url,
          banner_url: p.banner_url,
          banner_content_type: p.banner_content_type,
          nameplate_url: p.nameplate_url,
          nameplate_content_type: p.nameplate_content_type,
          updated_at: p.updated_at,
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
        const { server_id, channel } = d.data as { server_id?: string; channel?: Channel };
        if (channel?.id) {
          dispatch({ type: "UPSERT_CHANNEL", channel });
        } else if (server_id && get().activeServerId === server_id) {
          actions.loadChannels(server_id, { force: true });
        }
        break;
      }
      case "CHANNEL_DELETE": {
        const { id, server_id } = d.data;
        const state = get();
        dispatch({ type: "REMOVE_CHANNEL", channelId: id });
        if (state.activeServerId === server_id) {
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
        void syncDesktopState();
        break;
      case "MESSAGE_PIN":
        dispatch({ type: "PIN_MESSAGE", messageId: d.data.id, pinned: true, fullMessage: d.data });
        break;
      case "MESSAGE_UNPIN":
        dispatch({ type: "PIN_MESSAGE", messageId: d.data.id, pinned: false });
        break;
      case "VOICE_CHANNEL_STATES":
        dispatch({
          type: "SET_VOICE_CHANNEL_STATES",
          states: d.data.voice_states ?? {},
          startedAt: d.data.voice_started_at ?? {},
          spatialStates: d.data.spatial_audio_states ?? {},
        });
        break;
      case "VOICE_CHANNEL_STATE_UPDATE": {
        const prevMembers = get().voiceChannelStates[d.data.channel_id] ?? [];
        const nextMembers = d.data.members ?? [];
        dispatch({
          type: "UPDATE_VOICE_CHANNEL_STATE",
          channelId: d.data.channel_id,
          members: nextMembers,
          startedAt: d.data.started_at ?? null,
          spatialAudioState: d.data.spatial_audio_state,
        });

        const myId = get().user?.id ?? clerkUserId;

        // Ignore state replays while we are rebuilding after a normal gateway reconnect.
        if (isSoundEnabled("voiceJoinLeave") && !areReconnectSoundsSuppressed()) {
          const sound = getVoiceChannelPresenceSound(prevMembers, nextMembers, myId);
          if (sound === "join") playVoiceJoin();
          else if (sound === "leave") playVoiceLeave();
        }

        break;
      }
      case "NOTIFICATION_CREATE": {
        const notif = d.data as AppNotification;
        dispatch({ type: "ADD_NOTIFICATION", notification: notif });

        // Play notification sound
        if (isSoundEnabled("notifications") && !areReconnectSoundsSuppressed()) {
          playNotification();
        }

        void syncDesktopState();

        // Fire a native OS toast when desktop notifications are enabled and
        // the user is not actively looking at the same channel.
        if (
          !recentlyToastedMessageIds.has(notif.message_id) &&
          shouldNativeNotifyForMessage({
            notification: notif,
            activeChannelId: get().activeChannelId,
            focused: document.hasFocus(),
            desktopNotificationsEnabled: useDesktopSettingsStore.getState().desktopNotifications,
          })
        ) {
          const authorName = getDisplayName(notif.from_user, "Someone");
          const title = notif.type === "mention"
            ? `${authorName} mentioned you`
            : notif.type === "reply"
              ? `${authorName} replied to you`
              : `${authorName} sent you a direct message`;

          void showNativeDesktopToast({
            title,
            body: notif.content?.slice(0, 200) ?? "New notification",
            largeBody: notif.content?.slice(0, 1000),
            summary: notif.server_name ?? notif.channel_name ?? undefined,
            group: notif.server_id ?? notif.channel_id,
            icon: notif.from_user?.avatar_url ?? undefined,
            attachments: notif.type === "dm" ? undefined : undefined,
            actionTypeId: MOBILE_ACTION_TYPE_ID,
            autoCancel: true,
            extra: {
              channelId: notif.channel_id,
              messageId: notif.message_id,
              serverId: notif.server_id ?? null,
              type: notif.type,
            },
          });
          noteToastedMessage(notif.message_id);
        }
        break;
      }

      // ── Call Events ──────────────────────────────────────────────────

      case "CALL_RING": {
        // Incoming call
        const { call_id, caller_id, caller_name, caller_username, caller_display_name, caller_avatar, channel_id } = d.data;
        const callState = useCallStore.getState();
        const currentUser = get().user;

        // Automatically reject if we are already in another active call
        if (callState.status === "active" && callState.callId !== call_id) {
          sendWhenReady({ op: 38, d: { call_id } });
          return;
        }

        const sortedIds = [currentUser?.id || "", caller_id].sort();
        const voiceRoomId = `dm-call-${sortedIds[0]}-${sortedIds[1]}`;

        if (isSoundEnabled("calls")) playRingStart();
        callState.setIncomingCall({
          callId: call_id,
          remoteUser: { id: caller_id, username: caller_username ?? caller_name, display_name: caller_display_name ?? caller_name, avatar_url: caller_avatar },
          channelId: channel_id,
          voiceRoomId,
        });

        if (shouldNativeNotifyForChannelActivity({
          channelId: channel_id,
          activeChannelId: get().activeChannelId,
          focused: document.hasFocus(),
          desktopNotificationsEnabled: useDesktopSettingsStore.getState().desktopNotifications,
        })) {
          void showNativeDesktopToast({
            title: `Incoming call from ${caller_display_name ?? caller_username ?? caller_name}`,
            body: "Open Ralph Meet to answer.",
            summary: "Incoming call",
            icon: caller_avatar ?? undefined,
            actionTypeId: MOBILE_ACTION_TYPE_ID,
            autoCancel: true,
            extra: {
              channelId: channel_id,
              callerId: caller_id,
              callId: call_id,
              type: "incoming-call",
            },
          });
        }
        break;
      }
      case "CALL_RINGING": {
        // Outgoing call is officially ringing on their end
        const { call_id, callee_id, callee_name, callee_username, callee_display_name, callee_avatar, channel_id } = d.data;
        const callState = useCallStore.getState();
        const currentUser = get().user;

        const sortedIds = [currentUser?.id || "", callee_id].sort();
        const voiceRoomId = `dm-call-${sortedIds[0]}-${sortedIds[1]}`;

        callState.setOutgoingCall({
          callId: call_id,
          remoteUser: { id: callee_id, username: callee_username ?? callee_name, display_name: callee_display_name ?? callee_name, avatar_url: callee_avatar },
          channelId: channel_id,
          voiceRoomId,
        });
        if (isSoundEnabled("calls")) playOutgoingRingStart();

        // Navigate caller to the DM channel (replaces the old OutgoingCallModal overlay)
        const state = get();
        if (state.activeServerId !== "@me" || state.activeChannelId !== channel_id) {
          dispatch({ type: "SWITCH_SERVER", serverId: "@me", channelId: channel_id });
        }
        break;
      }
      case "CALL_RING_STOP": {
        const { call_id, reason } = d.data;
        const callState = useCallStore.getState();

        playRingStop();
        playOutgoingRingStop();

        // If the ringing stopped because it was accepted, we transition the Ringing state to Active!
        // This ensures the duration timer starts running and the remoteUser is preserved for the lobby UI.
        if (reason === "accepted") {
          if (isSoundEnabled("calls")) playCallConnect();
          callState.acceptCall();
        } else if (
          callState.status === "ringing_outgoing" &&
          (reason === "timeout" || reason === "declined")
        ) {
          // The callee didn't answer or declined, but the caller is already
          // connected to the SFU/voice channel. Keep them in the call room so
          // they can stay, retry, or leave manually. Transition to "active"
          // so the outgoing ringing modal closes and the call dashboard shows.
          callState.acceptCall();
        } else {
          // Otherwise, the ring was cancelled, declined (for callee), or timed out (for callee).
          const wasActive = callState.status !== "idle";

          if (wasActive && isSoundEnabled("calls") && reason !== "busy" && reason !== "unavailable" && reason !== "invalid" && reason !== "declined") {
            playCallEnd();
          }
          callState.endCall(reason);
        }
        break;
      }
    }
  };

  let hasConnectedBefore = false;
  let releaseReconnectSoundSuppression: (() => void) | null = null;

  const handleGatewayMessage = (msg: { op: number; d: any }) => {
    switch (msg.op) {
      case 8: {
        const interval = msg.d?.heartbeat_interval ?? 45000;
        if (clerkUserId) {
          sendGateway({ op: 0, d: { name: "ChatClient", clerk_user_id: clerkUserId } });
          identified = true;
        }
        hb.start(interval);
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

        // Subscribe to all servers for message delivery (Op 35)
        const servers = get().servers;
        for (const server of servers) {
          sendGateway({ op: 35, d: { server_id: server.id } });
        }

        // On reconnect, reload all core data so the UI is repopulated
        if (hasConnectedBefore) {
          chatLog.info("Reconnected — reloading data");
          releaseReconnectSoundSuppression?.();
          const release = beginReconnectSoundSuppression();
          releaseReconnectSoundSuppression = release;

          // Re-subscribe to the active channel for typing/presence
          const activeChannel = get().activeChannelId;
          if (activeChannel) {
            sendGateway({ op: 27, d: { channel_id: activeChannel } });
          }

          void Promise.allSettled([
            actions.bootstrapChat(),
            activeChannel ? actions.loadMessages(activeChannel) : Promise.resolve(),
          ]).finally(() => {
            release();
            if (releaseReconnectSoundSuppression === release) {
              releaseReconnectSoundSuppression = null;
            }
          });
        }
        hasConnectedBefore = true;
        break;
      }
      case 6: {
        // HeartbeatACK — auto-response sends {"op":6} with no `d`, guard accordingly.
        hb.onAck();
        if (msg.d?.seq != null) seq = msg.d.seq;
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
    chatLog.info(`Reconnecting in ${Math.round(delay)}ms (attempt ${reconnectAttempt})`);

    reconnectTimeout = setTimeout(() => {
      reconnectTimeout = null;
      if (!intentionalDisconnect && clerkUserId) {
        initGateway(clerkUserId);
      }
    }, delay);
  };

  const disconnectGateway = () => {
    intentionalDisconnect = true;
    releaseReconnectSoundSuppression?.();
    releaseReconnectSoundSuppression = null;
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }
    if (ws) {
      ws.close();
      ws = null;
    }
    hb.stop();
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
      chatLog.info("Connected");
      reconnectAttempt = 0;
      dispatch({ type: "SET_CONNECTED", connected: true });
      dispatch({ type: "SET_RECONNECT_ATTEMPT", attempt: 0 });
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleGatewayMessage(msg);
      } catch {
        chatLog.warn("Invalid message:", event.data);
      }
    };

    ws.onclose = () => {
      chatLog.info("Disconnected");
      dispatch({ type: "SET_CONNECTED", connected: false });

      hb.stop();
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
      chatLog.info("Sending identify after clerk user became available", {
        userId,
        gatewayReady,
        readyState: ws.readyState,
      });
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
    subscribeServer: (serverId: string) => sendWhenReady({ op: 35, d: { server_id: serverId } }),
    sendVoiceChannelJoin: (channelId: string, selfMute?: boolean, startedAt?: number | null) =>
      sendWhenReady({ op: 33, d: { channel_id: channelId, self_mute: selfMute ?? true, started_at: startedAt ?? undefined } }),
    sendVoiceChannelLeave: (channelId?: string) => sendWhenReady({ op: 34, d: { channel_id: channelId } }),
    sendVoiceStateUpdate: (data) => sendWhenReady({ op: 15, d: data }),
    sendGateway,
    sendCallInitiate: (targetUserId: string, channelId: string) =>
      sendWhenReady({ op: 36, d: { target_user_id: targetUserId, channel_id: channelId } }),
    sendCallAccept: (callId: string) =>
      sendWhenReady({ op: 37, d: { call_id: callId } }),
    sendCallDecline: (callId: string) =>
      sendWhenReady({ op: 38, d: { call_id: callId } }),
    sendCallEnd: (callId: string) =>
      sendWhenReady({ op: 39, d: { call_id: callId } }),
  };
}
