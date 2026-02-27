"use client";

import type { ChatAction, ChatState } from "@/lib/chat-reducer";
import type { Message, Role } from "@/lib/types";
import { useAuth } from "@clerk/nextjs";
import { useCallback, useEffect, useRef } from "react";

// ── Types ───────────────────────────────────────────────────────────────────

export interface GatewayActions {
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

// ── Hook ────────────────────────────────────────────────────────────────────

/**
 * Manages the chat WebSocket gateway: connection lifecycle, heartbeat,
 * identify, dispatch routing, and channel subscribe/unsubscribe ops.
 */
export function useGateway(
  dispatch: React.Dispatch<ChatAction>,
  stateRef: React.MutableRefObject<ChatState>,
  loadChannels: (serverId: string) => Promise<void>,
  loadDmChannels: () => Promise<void>,
): GatewayActions {
  const { userId: clerkUserId } = useAuth();
  const wsRef = useRef<WebSocket | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const seqRef = useRef(0);
  const typingTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const identifiedRef = useRef(false);
  const gatewayReadyRef = useRef(false);
  const pendingQueue = useRef<object[]>([]);
  const clerkUserIdRef = useRef(clerkUserId);
  clerkUserIdRef.current = clerkUserId;

  // ── Gateway connection ──────────────────────────────────────────────────

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}/api/gateway`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("[ChatGW] Connected");
      dispatch({ type: "SET_CONNECTED", connected: true });
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
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      gatewayReadyRef.current = false;
      identifiedRef.current = false;
    };

    return () => {
      ws.close();
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Deferred identify: if WS connected before clerkUserId was available,
  // or if clerkUserId arrived before WS was open. Re-check on both changes.
  useEffect(() => {
    if (
      clerkUserId &&
      !identifiedRef.current &&
      wsRef.current?.readyState === WebSocket.OPEN
    ) {
      wsRef.current.send(
        JSON.stringify({ op: 0, d: { name: "ChatClient", clerk_user_id: clerkUserId } })
      );
      identifiedRef.current = true;
    }
  }, [clerkUserId]);

  const sendGateway = useCallback((msg: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleGatewayMessage = useCallback((msg: { op: number; d: any }) => {
    switch (msg.op) {
      case 8: { // Hello
        const interval = msg.d?.heartbeat_interval ?? 45000;
        // Identify with clerk_user_id if available, otherwise defer
        if (clerkUserIdRef.current) {
          sendGateway({ op: 0, d: { name: "ChatClient", clerk_user_id: clerkUserIdRef.current } });
          identifiedRef.current = true;
        }
        // Start heartbeat
        heartbeatRef.current = setInterval(() => {
          seqRef.current++;
          sendGateway({ op: 3, d: { seq_ack: seqRef.current } });
        }, interval);
        break;
      }
      case 2: { // Ready — server acknowledged our Identify
        gatewayReadyRef.current = true;

        // Sync status if one was restored/set already
        const currentStatus = stateRef.current.user?.status;
        if (currentStatus && currentStatus !== "online") {
          sendGateway({ op: 26, d: { status: currentStatus } });
        }

        // Flush any queued messages
        for (const queued of pendingQueue.current) {
          sendGateway(queued);
        }
        pendingQueue.current = [];
        break;
      }
      case 6: { // HeartbeatACK
        seqRef.current = msg.d?.seq ?? seqRef.current;
        break;
      }
      case 19: { // Dispatch
        handleDispatch(msg.d);
        break;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleDispatch = useCallback((d: { event: string; data: any }) => {
    console.log(`[ChatGW] Event: ${d.event}`, d.data);
    switch (d.event) {
      case "MESSAGE_CREATE": {
        const msg = d.data as Message;
        dispatch({ type: "APPEND_MESSAGE", message: msg });
        // Clear typing indicator for the author when their message arrives
        dispatch({ type: "CLEAR_TYPING", channelId: msg.channel_id, userId: msg.author_id });
        // Track latest message timestamp for unread badges
        dispatch({ type: "UPDATE_LAST_MESSAGE", channelId: msg.channel_id, timestamp: msg.created_at });
        // If this is an unknown channel (not in server channels or DM channels), refresh DM list
        const isKnown = stateRef.current.channels.some(c => c.id === msg.channel_id) ||
          stateRef.current.dmChannels.some(d => d.id === msg.channel_id);
        if (!isKnown) {
          loadDmChannels();
        }

        // If this is the active channel, auto-mark as read
        if (msg.channel_id === stateRef.current.activeChannelId) {
          dispatch({ type: "UPDATE_READ_STATE", channelId: msg.channel_id, timestamp: msg.created_at });
          // Fire-and-forget REST call to persist read state
          fetch(`/api/channels/${msg.channel_id}/read-state`, { method: "PUT" }).catch(() => { });
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
        // Auto-clear after 8s
        const timerKey = `${channel_id}:${uid}`;
        const existing = typingTimers.current.get(timerKey);
        if (existing) clearTimeout(existing);
        typingTimers.current.set(
          timerKey,
          setTimeout(() => {
            dispatch({ type: "CLEAR_TYPING", channelId: channel_id, userId: uid });
            typingTimers.current.delete(timerKey);
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
        // Also mark them online
        dispatch({ type: "USER_ONLINE", userId: d.data.user.id });
        break;
      case "GUILD_MEMBER_REMOVE": {
        const removedUserId = d.data.user_id;
        const removedServerId = d.data.server_id;

        if (removedUserId === stateRef.current.user?.id) {
          // Current user was banned/kicked — full cleanup:
          // 1. Unsubscribe from the active channel so gateway stops sending events
          const activeChannel = stateRef.current.activeChannelId;
          if (activeChannel) {
            sendGateway({ op: 28, d: { channel_id: activeChannel } }); // ChannelUnsubscribe
          }
          // 2. Leave voice channel if connected
          sendGateway({ op: 34, d: {} });
          // 3. Fire event so useVoiceChannel hook can disconnect the SFU
          window.dispatchEvent(new CustomEvent("force-voice-disconnect"));
          // 4. Remove the server from sidebar + clear all server-scoped state
          dispatch({ type: "REMOVE_SERVER", serverId: removedServerId });
        } else {
          // Another member was removed — just update the member list
          dispatch({ type: "REMOVE_MEMBER", userId: removedUserId });
          dispatch({ type: "USER_OFFLINE", userId: removedUserId });
        }
        break;
      }
      case "GUILD_MEMBER_UPDATE": {
        const p = d.data as { server_id: string; user_id: string; roles?: Role[] };
        if (stateRef.current.activeServerId !== p.server_id) return;
        dispatch({
          type: "UPDATE_MEMBER_ROLES",
          userId: p.user_id,
          roles: p.roles,
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
        if (stateRef.current.activeServerId === server_id) {
          loadChannels(server_id);
        }
        break;
      }
      case "CHANNEL_DELETE": {
        const { id, server_id } = d.data;
        if (stateRef.current.activeServerId === server_id) {
          loadChannels(server_id);
          // If the deleted channel was our active channel, we might want to navigate away
          if (stateRef.current.activeChannelId === id) {
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
        // Bulk voice state received on channel subscribe — all current VC members
        dispatch({ type: "SET_VOICE_CHANNEL_STATES", states: d.data.voice_states ?? {} });
        break;
      case "VOICE_CHANNEL_STATE_UPDATE":
        // Real-time update for a single voice channel
        dispatch({
          type: "UPDATE_VOICE_CHANNEL_STATE",
          channelId: d.data.channel_id,
          members: d.data.members ?? [],
        });
        break;
    }
  }, []);

  // ── Gateway-only actions ────────────────────────────────────────────────

  const sendWhenReady = useCallback((msg: object) => {
    if (gatewayReadyRef.current) {
      sendGateway(msg);
    } else {
      pendingQueue.current.push(msg);
    }
  }, [sendGateway]);

  const subscribeChannel = useCallback(
    (channelId: string) => {
      sendWhenReady({ op: 27, d: { channel_id: channelId } }); // ChannelSubscribe
    },
    [sendWhenReady]
  );

  const unsubscribeChannel = useCallback(
    (channelId: string) => {
      sendWhenReady({ op: 28, d: { channel_id: channelId } }); // ChannelUnsubscribe
    },
    [sendWhenReady]
  );

  const sendVoiceChannelJoin = useCallback(
    (channelId: string, selfMute?: boolean) => {
      sendWhenReady({ op: 33, d: { channel_id: channelId, self_mute: selfMute ?? true } });
    },
    [sendWhenReady]
  );

  const sendVoiceChannelLeave = useCallback(() => {
    sendWhenReady({ op: 34, d: {} });
  }, [sendWhenReady]);

  const sendVoiceStateUpdate = useCallback(
    (data: { self_mute?: boolean; self_deaf?: boolean; self_video?: boolean; self_stream?: boolean; self_stream_audio?: boolean }) => {
      sendWhenReady({ op: 15, d: data });
    },
    [sendWhenReady]
  );

  return {
    subscribeChannel,
    unsubscribeChannel,
    sendVoiceChannelJoin,
    sendVoiceChannelLeave,
    sendVoiceStateUpdate,
    sendGateway,
  };
}
