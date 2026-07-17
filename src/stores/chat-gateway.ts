import type { ChatAction, ChatState } from "@/lib/chat-reducer";
import { clog } from "@/lib/console-logger";
import { getDisplayName } from "@/lib/display-name";
import {
  getUnreadChannelState,
  shouldNativeNotifyForChannelActivity,
  shouldNativeNotifyForMessage,
} from "@/lib/desktop-notifications";
import {
  MOBILE_ACTION_TYPE_ID,
  showNativeDesktopToast,
  syncDesktopNotificationState,
} from "@/lib/desktop-native-sync";
import {
  getCurrentPresencePlatform,
  isTauri as _isTauri,
  wsUrl,
} from "@/lib/platform";
import {
  normalizePresencePlatforms,
  type PresencePlatform,
} from "@/lib/presence-platform";
import { fetchSocketProtocols } from "@/lib/voice/socket-ticket-client";
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
  playVoiceLeave,
} from "@/lib/sounds";
import type {
  Channel,
  Notification as AppNotification,
  Message,
  Role,
  Server,
} from "@/lib/types";
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
  getSessionId: () => string | null;
  subscribeChannel: (channelId: string) => void;
  unsubscribeChannel: (channelId: string) => void;
  subscribeServer: (serverId: string) => void;
  sendVoiceChannelJoin: (
    channelId: string,
    selfMute?: boolean,
    startedAt?: number | null,
  ) => void;
  sendVoiceChannelLeave: (channelId?: string) => void;
  sendVoiceStateUpdate: (data: {
    self_mute?: boolean;
    self_deaf?: boolean;
    self_video?: boolean;
    self_stream?: boolean;
    self_stream_audio?: boolean;
    stream_preview_url?: string | null;
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
  actions: ChatRestActions,
): ChatGatewayActions {
  let ws: WebSocket | null = null;
  // Raw heartbeat — must match setWebSocketAutoResponse pattern exactly (no extra fields)
  const HEARTBEAT_MSG = JSON.stringify({ op: 3 });
  const hb = new HeartbeatManager("ChatGW", {
    sendBeat: () => {
      if (ws?.readyState === WebSocket.OPEN) ws.send(HEARTBEAT_MSG);
    },
    onZombie: () => ws?.close(),
  });
  const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const recentlyToastedMessageIds = new Map<string, number>();
  let identified = false;
  let gatewayReady = false;
  let pendingQueue: object[] = [];
  let clerkUserId: string | null | undefined = null;
  let gatewaySessionId: string | null = null;
  const subscribedServerIds = new Set<string>();
  let subscribedChannelId: string | null = null;

  const resetSubscriptions = () => {
    subscribedServerIds.clear();
    subscribedChannelId = null;
    pendingQueue = pendingQueue.filter((message) => {
      if (!message || typeof message !== "object") return true;
      const op = (message as { op?: unknown }).op;
      return op !== 27 && op !== 28 && op !== 35;
    });
  };

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
      window.dispatchEvent(
        new CustomEvent("chat-gateway-event", { detail: d }),
      );
    }
    switch (d.event) {
      case "MESSAGE_CREATE": {
        const msg = d.data as Message;
        dispatch({ type: "APPEND_MESSAGE", message: msg });
        dispatch({
          type: "CLEAR_TYPING",
          channelId: msg.channel_id,
          userId: msg.author_id,
        });
        dispatch({
          type: "UPDATE_LAST_MESSAGE",
          channelId: msg.channel_id,
          timestamp: msg.created_at,
        });

        const state = get();
        const isKnown =
          state.channels.some((c) => c.id === msg.channel_id) ||
          state.dmChannels.some((d) => d.id === msg.channel_id);
        if (!isKnown) {
          actions.loadDmChannels();
        }

        if (msg.channel_id === state.activeChannelId) {
          actions.markChannelRead(msg.channel_id, msg.created_at);
        }

        const isDmChannel = state.dmChannels.some(
          (dm) => dm.id === msg.channel_id,
        );
        if (
          !isDmChannel &&
          msg.author_id !== state.user?.id &&
          !messageTargetsCurrentUser(msg) &&
          shouldNativeNotifyForChannelActivity({
            channelId: msg.channel_id,
            activeChannelId: state.activeChannelId,
            focused: document.hasFocus(),
            desktopNotificationsEnabled:
              useDesktopSettingsStore.getState().desktopNotifications,
          })
        ) {
          const channel =
            state.channels.find(
              (candidate) => candidate.id === msg.channel_id,
            ) ??
            Object.values(state.channelsByServerId)
              .flat()
              .find((candidate) => candidate.id === msg.channel_id);
          const server = channel?.server_id
            ? state.servers.find(
                (candidate) => candidate.id === channel.server_id,
              )
            : null;
          const title = channel?.name
            ? `${getDisplayName(msg.author, "Someone")} in #${channel.name}`
            : `${getDisplayName(msg.author, "Someone")} sent a message`;
          const imageAttachment = msg.attachments?.find((attachment) =>
            attachment.content_type?.startsWith("image/"),
          );
          const body = msg.content?.trim()
            ? server?.name
              ? `${server.name}\n${msg.content.slice(0, 200)}`
              : msg.content.slice(0, 200)
            : imageAttachment
              ? "Sent a photo"
              : (server?.name ?? "New server message");
          void showNativeDesktopToast({
            title,
            body,
            largeBody: msg.content?.trim()
              ? msg.content.slice(0, 1000)
              : undefined,
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
            dispatch({
              type: "CLEAR_TYPING",
              channelId: channel_id,
              userId: uid,
            });
            typingTimers.delete(timerKey);
          }, 8000),
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
        dispatch({
          type: "UPDATE_USER_STATUS",
          userId: d.data.user_id,
          status: d.data.status,
          customStatus: d.data.custom_status,
          platforms: d.data.platforms
            ? normalizePresencePlatforms(d.data.platforms)
            : undefined,
        });
        if (d.data.status === "offline") {
          dispatch({ type: "USER_OFFLINE", userId: d.data.user_id });

          // Real-time call disconnect detection: if our call partner goes offline while ringing, end the call
          const callState = useCallStore.getState();
          if (
            callState.remoteUser?.id === d.data.user_id &&
            (callState.status === "ringing_outgoing" ||
              callState.status === "ringing_incoming")
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
        if (Array.isArray(d.data.users)) {
          dispatch({
            type: "SET_PRESENCE_USERS",
            users: d.data.users.map(
              (user: {
                user_id: string;
                status?: "online" | "idle" | "dnd" | "offline";
                custom_status?: string | null;
                platforms?: PresencePlatform[];
              }) => ({
                userId: user.user_id,
                status: user.status ?? "online",
                customStatus: user.custom_status,
                platforms: normalizePresencePlatforms(user.platforms),
              }),
            ),
          });
        } else {
          dispatch({
            type: "SET_ONLINE_USERS",
            userIds: d.data.user_ids ?? [],
          });
        }
        break;
      case "GUILD_MEMBER_ADD":
        if (d.data.user?.id === get().user?.id && d.data.server_id) {
          sendWhenReady({ op: 35, d: { server_id: d.data.server_id } });
          void actions.loadServers();
          void actions.loadChannels(d.data.server_id, { force: true });
          void actions.loadMembers(d.data.server_id, { force: true });
        }
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
            unsubscribeChannel(activeChannel);
          }
          sendGateway({ op: 34, d: {} });
          window.dispatchEvent(new CustomEvent("force-voice-disconnect"));
          dispatch({ type: "REMOVE_SERVER", serverId: removedServerId });
        } else {
          dispatch({
            type: "REMOVE_MEMBER",
            serverId: removedServerId,
            userId: removedUserId,
          });
          dispatch({ type: "USER_OFFLINE", userId: removedUserId });
        }
        break;
      }
      case "GUILD_MEMBER_UPDATE": {
        const p = d.data as {
          server_id: string;
          user_id: string;
          roles?: Role[];
        };
        dispatch({
          type: "UPDATE_MEMBER_ROLES",
          serverId: p.server_id,
          userId: p.user_id,
          roles: p.roles,
        });
        break;
      }
      case "USER_SERVERS_UPDATE": {
        const payload = d.data as {
          action?: "upsert" | "remove" | "refresh";
          server?: Server;
          server_id?: string;
        };
        const serverId = payload.server?.id ?? payload.server_id ?? null;

        if (payload.action === "remove" && serverId) {
          dispatch({ type: "REMOVE_SERVER", serverId });
          break;
        }

        if (payload.server) {
          dispatch({ type: "ADD_SERVER", server: payload.server });
        }

        if (serverId) {
          sendWhenReady({ op: 35, d: { server_id: serverId } });
          void actions.loadChannels(serverId, { force: true });
          void actions.loadMembers(serverId, { force: true });
        }

        void actions.loadServers();
        break;
      }
      case "USER_PROFILE_UPDATE": {
        const p = d.data as {
          user_id: string;
          username?: string;
          display_name?: string;
          avatar_url?: string;
          avatar_display?:
            | import("@/lib/avatar-display").AvatarDisplay
            | string
            | null;
          banner_url?: string;
          banner_content_type?: string;
          nameplate_url?: string;
          nameplate_content_type?: string;
          profile_accent_color?: string | null;
          profile_background_color?: string | null;
          profile_banner_color?: string | null;
          display_name_style?:
            | import("@/lib/profile-customization").DisplayNameStyle
            | string
            | null;
          theme_preference?: string | null;
          theme_sync_enabled?: boolean;
          media_content_filter?:
            | import("@/lib/media-content-filter").MediaContentFilter
            | null;
          bio?: string | null;
          pronouns?: string | null;
          updated_at?: string;
        };
        dispatch({
          type: "UPDATE_MEMBER_PROFILE",
          userId: p.user_id,
          username: p.username,
          display_name: p.display_name,
          avatar_url: p.avatar_url,
          avatar_display: p.avatar_display,
          banner_url: p.banner_url,
          banner_content_type: p.banner_content_type,
          nameplate_url: p.nameplate_url,
          nameplate_content_type: p.nameplate_content_type,
          profile_accent_color: p.profile_accent_color,
          profile_background_color: p.profile_background_color,
          profile_banner_color: p.profile_banner_color,
          display_name_style: p.display_name_style,
          theme_preference: p.theme_preference,
          theme_sync_enabled: p.theme_sync_enabled,
          media_content_filter: p.media_content_filter,
          bio: p.bio ?? undefined,
          pronouns: p.pronouns ?? undefined,
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
        const { server_id, channel } = d.data as {
          server_id?: string;
          channel?: Channel;
        };
        if (channel?.id) {
          dispatch({ type: "UPSERT_CHANNEL", channel });
        } else if (server_id) {
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
      case "READ_STATE_UPDATE":
        dispatch({
          type: "UPDATE_READ_STATE",
          channelId: d.data.channel_id,
          timestamp: d.data.last_read_at,
        });
        void syncDesktopState();
        break;
      case "NOTIFICATIONS_READ":
        dispatch({
          type: "MARK_NOTIFICATIONS_READ",
          ids: Array.isArray(d.data.ids) ? d.data.ids : undefined,
          all: !!d.data.all,
        });
        void syncDesktopState();
        break;
      case "NOTIFICATIONS_CLEAR":
        dispatch({ type: "CLEAR_NOTIFICATIONS" });
        void syncDesktopState();
        break;
      case "MESSAGE_PIN":
        dispatch({
          type: "PIN_MESSAGE",
          messageId: d.data.id,
          pinned: true,
          fullMessage: d.data,
        });
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
        if (
          isSoundEnabled("voiceJoinLeave") &&
          !areReconnectSoundsSuppressed()
        ) {
          const sound = getVoiceChannelPresenceSound(
            prevMembers,
            nextMembers,
            myId,
          );
          if (sound === "join") playVoiceJoin();
          else if (sound === "leave") playVoiceLeave();
        }

        break;
      }
      case "NOTIFICATION_CREATE": {
        const notif = d.data as AppNotification;
        dispatch({ type: "ADD_NOTIFICATION", notification: notif });

        // Play notification sound
        if (
          isSoundEnabled("notifications") &&
          !areReconnectSoundsSuppressed()
        ) {
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
            desktopNotificationsEnabled:
              useDesktopSettingsStore.getState().desktopNotifications,
          })
        ) {
          const authorName = getDisplayName(notif.from_user, "Someone");
          const title =
            notif.type === "mention"
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
        const {
          call_id,
          caller_id,
          caller_name,
          caller_username,
          caller_display_name,
          caller_avatar,
          channel_id,
        } = d.data;
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
          remoteUser: {
            id: caller_id,
            username: caller_username ?? caller_name,
            display_name: caller_display_name ?? caller_name,
            avatar_url: caller_avatar,
          },
          channelId: channel_id,
          voiceRoomId,
        });

        if (
          shouldNativeNotifyForChannelActivity({
            channelId: channel_id,
            activeChannelId: get().activeChannelId,
            focused: document.hasFocus(),
            desktopNotificationsEnabled:
              useDesktopSettingsStore.getState().desktopNotifications,
          })
        ) {
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
        const {
          call_id,
          callee_id,
          callee_name,
          callee_username,
          callee_display_name,
          callee_avatar,
          channel_id,
        } = d.data;
        const callState = useCallStore.getState();
        const currentUser = get().user;

        const sortedIds = [currentUser?.id || "", callee_id].sort();
        const voiceRoomId = `dm-call-${sortedIds[0]}-${sortedIds[1]}`;

        callState.setOutgoingCall({
          callId: call_id,
          remoteUser: {
            id: callee_id,
            username: callee_username ?? callee_name,
            display_name: callee_display_name ?? callee_name,
            avatar_url: callee_avatar,
          },
          channelId: channel_id,
          voiceRoomId,
        });
        if (isSoundEnabled("calls")) playOutgoingRingStart();

        // Navigate caller to the DM channel (replaces the old OutgoingCallModal overlay)
        const state = get();
        if (
          state.activeServerId !== "@me" ||
          state.activeChannelId !== channel_id
        ) {
          dispatch({
            type: "SWITCH_SERVER",
            serverId: "@me",
            channelId: channel_id,
          });
        }
        break;
      }
      case "CALL_RING_STOP": {
        const { call_id: _call_id, reason } = d.data;
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

          if (
            wasActive &&
            isSoundEnabled("calls") &&
            reason !== "busy" &&
            reason !== "unavailable" &&
            reason !== "invalid" &&
            reason !== "declined"
          ) {
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
          sendGateway({
            op: 0,
            d: {
              name: "ChatClient",
              clerk_user_id: clerkUserId,
              platform: getCurrentPresencePlatform(),
            },
          });
          identified = true;
        }
        hb.start(interval);
        break;
      }
      case 2: {
        gatewaySessionId =
          typeof msg.d?.participant_id === "string"
            ? msg.d.participant_id
            : gatewaySessionId;
        gatewayReady = true;
        const currentStatus = get().user?.status;
        if (currentStatus && currentStatus !== "online") {
          sendGateway({ op: 26, d: { status: currentStatus } });
        }
        for (const queued of pendingQueue) {
          sendGateway(queued);
        }
        pendingQueue = [];

        // Subscribe to all servers for message delivery (Op 35). The helper
        // avoids duplicating subscriptions already queued before READY.
        const servers = get().servers;
        for (const server of servers) {
          subscribeServer(server.id);
        }

        const activeChannel = get().activeChannelId;
        if (activeChannel) {
          subscribeChannel(activeChannel);
        }

        // On reconnect, reload all core data so the UI is repopulated
        if (hasConnectedBefore) {
          chatLog.info("Reconnected — reloading data");
          releaseReconnectSoundSuppression?.();
          const release = beginReconnectSoundSuppression();
          releaseReconnectSoundSuppression = release;

          void Promise.allSettled([
            actions.bootstrapChat({ deferNonCritical: true }),
            activeChannel
              ? actions.loadMessages(activeChannel)
              : Promise.resolve(),
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
  let connecting = false;
  let ticketRequestGeneration = 0;

  const BACKOFF_BASE = 1000; // 1 second
  const BACKOFF_MAX = 30_000; // 30 seconds cap
  const BACKOFF_JITTER = 500; // random jitter up to 500ms

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
    chatLog.info(
      `Reconnecting in ${Math.round(delay)}ms (attempt ${reconnectAttempt})`,
    );

    reconnectTimeout = setTimeout(() => {
      reconnectTimeout = null;
      if (!intentionalDisconnect && clerkUserId) {
        initGateway(clerkUserId);
      }
    }, delay);
  };

  const disconnectGateway = () => {
    intentionalDisconnect = true;
    connecting = false;
    ticketRequestGeneration++;
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
    resetSubscriptions();
    pendingQueue = [];
    hb.stop();
    gatewayReady = false;
    identified = false;
    gatewaySessionId = null;
    dispatch({ type: "SET_CONNECTED", connected: false });
    reconnectAttempt = 0;
    dispatch({ type: "SET_RECONNECT_ATTEMPT", attempt: 0 });
  };

  const initGateway = (userId: string | null | undefined) => {
    if (clerkUserId !== userId && (ws || connecting)) {
      disconnectGateway();
    }
    if (ws || connecting) return; // Already connected or connecting

    intentionalDisconnect = false;
    clerkUserId = userId;
    void openGatewaySocket();
  };

  const openGatewaySocket = async () => {
    if (ws || connecting || intentionalDisconnect) return;
    connecting = true;
    const requestGeneration = ++ticketRequestGeneration;
    const ticketUserId = clerkUserId;
    try {
      const protocols = await fetchSocketProtocols({ audience: "global" });
      if (
        intentionalDisconnect ||
        ws ||
        requestGeneration !== ticketRequestGeneration ||
        ticketUserId !== clerkUserId
      )
        return;

      const url = wsUrl("/api/gateway");
      const socket = new WebSocket(url, protocols);
      ws = socket;

      socket.onopen = () => {
        if (ws !== socket) return;
        chatLog.info("Connected");
        reconnectAttempt = 0;
        dispatch({ type: "SET_CONNECTED", connected: true });
        dispatch({ type: "SET_RECONNECT_ATTEMPT", attempt: 0 });
      };

      socket.onmessage = (event) => {
        if (ws !== socket) return;
        try {
          const msg = JSON.parse(event.data);
          handleGatewayMessage(msg);
        } catch {
          chatLog.warn("Invalid message:", event.data);
        }
      };

      socket.onclose = (event) => {
        if (ws !== socket) return;
        chatLog.info("Disconnected");
        dispatch({ type: "SET_CONNECTED", connected: false });

        hb.stop();
        ws = null;
        gatewayReady = false;
        identified = false;
        resetSubscriptions();

        if (event.code === 4008) {
          intentionalDisconnect = true;
          chatLog.warn("Realtime admission was rejected. Not reconnecting.");
          return;
        }

        // Auto-reconnect unless intentionally disconnected
        scheduleReconnect();
      };
    } catch (error) {
      chatLog.warn("Could not obtain gateway ticket", error);
      scheduleReconnect();
    } finally {
      connecting = false;
    }
  };

  const setClerkUserId = (userId: string | null | undefined) => {
    clerkUserId = userId;
    if (userId && !identified && ws?.readyState === WebSocket.OPEN) {
      chatLog.info("Sending identify after clerk user became available", {
        userId,
        gatewayReady,
        readyState: ws.readyState,
      });
      sendGateway({
        op: 0,
        d: {
          name: "ChatClient",
          clerk_user_id: userId,
          platform: getCurrentPresencePlatform(),
        },
      });
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

  const subscribeChannel = (channelId: string) => {
    if (subscribedChannelId === channelId) return;
    if (subscribedChannelId) {
      sendWhenReady({ op: 28, d: { channel_id: subscribedChannelId } });
    }
    subscribedChannelId = channelId;
    sendWhenReady({ op: 27, d: { channel_id: channelId } });
  };

  const unsubscribeChannel = (channelId: string) => {
    if (subscribedChannelId !== channelId) return;
    subscribedChannelId = null;
    sendWhenReady({ op: 28, d: { channel_id: channelId } });
  };

  const subscribeServer = (serverId: string) => {
    if (subscribedServerIds.has(serverId)) return;
    subscribedServerIds.add(serverId);
    sendWhenReady({ op: 35, d: { server_id: serverId } });
  };

  return {
    initGateway,
    disconnectGateway,
    setClerkUserId,
    getSessionId: () => gatewaySessionId,
    subscribeChannel,
    unsubscribeChannel,
    subscribeServer,
    sendVoiceChannelJoin: (
      channelId: string,
      selfMute?: boolean,
      startedAt?: number | null,
    ) =>
      sendWhenReady({
        op: 33,
        d: {
          channel_id: channelId,
          self_mute: selfMute ?? true,
          started_at: startedAt ?? undefined,
        },
      }),
    sendVoiceChannelLeave: (channelId?: string) =>
      sendWhenReady({ op: 34, d: { channel_id: channelId } }),
    sendVoiceStateUpdate: (data) => sendWhenReady({ op: 15, d: data }),
    sendGateway,
    sendCallInitiate: (targetUserId: string, channelId: string) =>
      sendWhenReady({
        op: 36,
        d: { target_user_id: targetUserId, channel_id: channelId },
      }),
    sendCallAccept: (callId: string) =>
      sendWhenReady({ op: 37, d: { call_id: callId } }),
    sendCallDecline: (callId: string) =>
      sendWhenReady({ op: 38, d: { call_id: callId } }),
    sendCallEnd: (callId: string) =>
      sendWhenReady({ op: 39, d: { call_id: callId } }),
  };
}
