"use client";

import type {
  Attachment,
  Category,
  Channel,
  Message,
  Relationship,
  Role,
  Server,
  User,
} from "@/lib/types";
import { useAuth } from "@clerk/nextjs";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";

// ── State shape ─────────────────────────────────────────────────────────────

export interface ChatState {
  /** Connection status */
  connected: boolean;
  /** Current user */
  user: User | null;
  /** Servers the user belongs to */
  servers: Server[];
  /** All channels across servers */
  channels: Channel[];
  /** Channel categories for the active server */
  categories: Category[];
  /** Active server ID */
  activeServerId: string | null;
  /** Active channel ID */
  activeChannelId: string | null;
  /** Messages for the current channel */
  messages: Message[];
  /** Typing users per channel: channelId → Set<userId> */
  typingUsers: Record<string, Set<string>>;
  /** Members of the active server */
  members: Array<{ user: User; roles?: Role[] }>;
  /** Online user IDs (presence tracking) */
  onlineUsers: Set<string>;
  /** Read states: channelId → ISO timestamp of last read */
  readStates: Record<string, string>;
  /** Latest message timestamp per channel: channelId → ISO timestamp */
  lastMessageAt: Record<string, string>;
  /** DM channels */
  dmChannels: Array<{ id: string; name: string; recipient: User }>;
  /** Voice channel presence: channelId → array of connected members */
  voiceChannelStates: Record<string, VoiceChannelMember[]>;
  /** Pinned messages for the current channel */
  pinnedMessages: Message[];
  /** Loading state for pins */
  loadingPins: boolean;
  /** Which channel are the current pins for? */
  pinsLoadedFor: string | null;
  /** Relationships (friends, pending, blocked) */
  relationships: Relationship[];
  /** User currently being viewed in a profile modal */
  profileUser: User | null;
  /** Global map of which users are currently speaking in a voice channel: userId -> boolean */
  speakingUsers: Record<string, boolean>;
}

export interface VoiceChannelMember {
  clerk_user_id: string;
  name: string;
  avatar_url?: string;
  self_mute: boolean;
  self_deaf: boolean;
  self_video: boolean;
  self_stream: boolean;
  self_stream_audio?: boolean;
}

const initialState: ChatState = {
  connected: false,
  user: null,
  servers: [],
  channels: [],
  categories: [],
  activeServerId: null,
  activeChannelId: null,
  messages: [],
  typingUsers: {},
  members: [],
  onlineUsers: new Set(),
  readStates: {},
  lastMessageAt: {},
  dmChannels: [],
  voiceChannelStates: {},
  pinnedMessages: [],
  loadingPins: false,
  pinsLoadedFor: null,
  relationships: [],
  profileUser: null,
  speakingUsers: {},
};

// ── Actions ─────────────────────────────────────────────────────────────────

type ChatAction =
  | { type: "SET_CONNECTED"; connected: boolean }
  | { type: "SET_USER"; user: User }
  | { type: "SET_STATUS"; status: "online" | "idle" | "dnd" | "offline"; customStatus?: string }
  | { type: "SET_SERVERS"; servers: Server[] }
  | { type: "ADD_SERVER"; server: Server }
  | { type: "SET_CHANNELS"; channels: Channel[] }
  | { type: "SET_CATEGORIES"; categories: Category[] }
  | { type: "SET_CHANNELS_AND_CATEGORIES"; channels: Channel[]; categories: Category[] }
  | { type: "ADD_CHANNEL"; channel: Channel }
  | { type: "SET_ACTIVE_SERVER"; serverId: string | null }
  | { type: "SET_ACTIVE_CHANNEL"; channelId: string | null }
  | { type: "SET_MESSAGES"; messages: Message[] }
  | { type: "APPEND_MESSAGE"; message: Message }
  | { type: "UPDATE_MESSAGE"; id: string; content: string; updated_at: string }
  | { type: "DELETE_MESSAGE"; id: string }
  | { type: "PREPEND_MESSAGES"; messages: Message[] }
  | { type: "SET_TYPING"; channelId: string; userId: string }
  | { type: "CLEAR_TYPING"; channelId: string; userId: string }
  | { type: "SET_MEMBERS"; members: Array<{ user: User; roles?: Role[] }> }
  | { type: "ADD_MEMBER"; member: { user: User; roles?: Role[] } }
  | { type: "REMOVE_MEMBER"; userId: string }
  | { type: "UPDATE_MEMBER_ROLES"; userId: string; roles?: Role[] }
  | { type: "ADD_REACTION"; messageId: string; emoji: string; userId: string }
  | { type: "REMOVE_REACTION"; messageId: string; emoji: string; userId: string }
  | { type: "SET_ONLINE_USERS"; userIds: string[] }
  | { type: "USER_ONLINE"; userId: string }
  | { type: "USER_OFFLINE"; userId: string }
  | { type: "UPDATE_USER_STATUS"; userId: string; status: "online" | "idle" | "dnd" | "offline"; customStatus?: string }
  | { type: "UPDATE_SERVER"; serverId: string; updates: Partial<Server> }
  | { type: "REMOVE_SERVER"; serverId: string }
  | { type: "SET_READ_STATES"; readStates: Record<string, string>; lastMessageAt: Record<string, string> }
  | { type: "UPDATE_READ_STATE"; channelId: string; timestamp: string }
  | { type: "UPDATE_LAST_MESSAGE"; channelId: string; timestamp: string }
  | { type: "PIN_MESSAGE"; messageId: string; pinned: boolean; fullMessage?: Message }
  | { type: "SET_DM_CHANNELS"; dmChannels: Array<{ id: string; name: string; recipient: User }> }
  | { type: "ADD_DM_CHANNEL"; dmChannel: { id: string; name: string; recipient: User } }
  | { type: "SET_VOICE_CHANNEL_STATES"; states: Record<string, VoiceChannelMember[]> }
  | { type: "UPDATE_VOICE_CHANNEL_STATE"; channelId: string; members: VoiceChannelMember[] }
  | { type: "SET_PINNED_MESSAGES"; messages: Message[]; channelId: string }
  | { type: "SET_LOADING_PINS"; loading: boolean }
  | { type: "ADD_CATEGORY"; category: Category }
  | { type: "SWITCH_SERVER"; serverId: string; channelId: string | null }
  | { type: "SET_RELATIONSHIPS"; relationships: Relationship[] }
  | { type: "ADD_RELATIONSHIP"; relationship: Relationship }
  | { type: "REMOVE_RELATIONSHIP"; userId: string }
  | { type: "SET_PROFILE_USER"; user: User | null }
  | { type: "SET_SPEAKING_USERS"; speakingUsers: Record<string, boolean> };

function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "SET_CONNECTED":
      return { ...state, connected: action.connected };
    case "SET_USER":
      return { ...state, user: action.user };
    case "SET_STATUS":
      return { ...state, user: state.user ? { ...state.user, status: action.status, custom_status: action.customStatus ?? state.user.custom_status } : state.user };
    case "SET_SERVERS":
      return { ...state, servers: action.servers };
    case "ADD_SERVER":
      return { ...state, servers: [...state.servers, action.server] };
    case "SET_CHANNELS":
      return { ...state, channels: action.channels };
    case "SET_CATEGORIES":
      return { ...state, categories: action.categories };
    case "SET_CHANNELS_AND_CATEGORIES":
      return { ...state, channels: action.channels, categories: action.categories };
    case "ADD_CHANNEL":
      return { ...state, channels: [...state.channels, action.channel] };
    case "ADD_CATEGORY":
      return { ...state, categories: [...state.categories, action.category] };
    case "SET_ACTIVE_SERVER":
      if (state.activeServerId === action.serverId) return state;
      return { ...state, activeServerId: action.serverId, messages: [] };
    case "SET_ACTIVE_CHANNEL":
      if (state.activeChannelId === action.channelId) return state;
      return { ...state, activeChannelId: action.channelId, messages: [], pinnedMessages: [], pinsLoadedFor: null };
    case "SWITCH_SERVER":
      if (state.activeServerId === action.serverId && state.activeChannelId === action.channelId) return state;
      return { ...state, activeServerId: action.serverId, activeChannelId: action.channelId, messages: [], pinnedMessages: [], pinsLoadedFor: null };
    case "SET_MESSAGES":
      return { ...state, messages: action.messages };
    case "APPEND_MESSAGE": {
      const incoming = action.message;
      // Deduplicate by ID (late echo)
      if (state.messages.some((m) => m.id === incoming.id)) return state;
      // Deduplicate by nonce — replace optimistic (pending) with server-confirmed
      if (incoming.nonce) {
        const pendingIdx = state.messages.findIndex(
          (m) => m.nonce === incoming.nonce && m.pending
        );
        if (pendingIdx !== -1) {
          const updated = [...state.messages];
          updated[pendingIdx] = { ...incoming, pending: false };
          return { ...state, messages: updated };
        }
      }
      // Only append if the message belongs to the active channel
      if (incoming.channel_id !== state.activeChannelId) return state;
      return { ...state, messages: [...state.messages, incoming] };
    }
    case "UPDATE_MESSAGE":
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.id === action.id
            ? { ...m, content: action.content, updated_at: action.updated_at }
            : m
        ),
      };
    case "DELETE_MESSAGE":
      return {
        ...state,
        messages: state.messages.filter((m) => m.id !== action.id),
        pinnedMessages: state.pinnedMessages.filter((m) => m.id !== action.id),
      };
    case "PREPEND_MESSAGES":
      return { ...state, messages: [...action.messages, ...state.messages] };
    case "SET_TYPING": {
      const current = state.typingUsers[action.channelId] ?? new Set<string>();
      const updated = new Set(current);
      updated.add(action.userId);
      return { ...state, typingUsers: { ...state.typingUsers, [action.channelId]: updated } };
    }
    case "CLEAR_TYPING": {
      const current = state.typingUsers[action.channelId];
      if (!current) return state;
      const updated = new Set(current);
      updated.delete(action.userId);
      return { ...state, typingUsers: { ...state.typingUsers, [action.channelId]: updated } };
    }
    case "SET_MEMBERS":
      return { ...state, members: action.members };
    case "ADD_MEMBER":
      // Don't add duplicates
      if (state.members.some((m) => m.user.id === action.member.user.id)) return state;
      return { ...state, members: [...state.members, action.member] };
    case "REMOVE_MEMBER":
      return {
        ...state,
        members: state.members.filter((m) => m.user.id !== action.userId),
      };
    case "UPDATE_MEMBER_ROLES": {
      const idx = state.members.findIndex((m) => m.user.id === action.userId);
      if (idx === -1) return state;
      const newMembers = [...state.members];
      newMembers[idx] = { ...newMembers[idx], roles: action.roles };
      return { ...state, members: newMembers };
    }
    case "ADD_REACTION":
      return {
        ...state,
        messages: state.messages.map((m) => {
          if (m.id !== action.messageId) return m;
          const reactions = [...(m.reactions ?? [])];
          const existing = reactions.find((r) => r.emoji === action.emoji);
          if (existing) {
            existing.count += 1;
            existing.users = [...(existing.users ?? []), action.userId];
          } else {
            reactions.push({ emoji: action.emoji, count: 1, me: false, users: [action.userId] });
          }
          return { ...m, reactions };
        }),
      };
    case "REMOVE_REACTION":
      return {
        ...state,
        messages: state.messages.map((m) => {
          if (m.id !== action.messageId) return m;
          const reactions = (m.reactions ?? [])
            .map((r) => {
              if (r.emoji !== action.emoji) return r;
              return {
                ...r,
                count: r.count - 1,
                users: (r.users ?? []).filter((u) => u !== action.userId),
              };
            })
            .filter((r) => r.count > 0);
          return { ...m, reactions };
        }),
      };
    case "SET_ONLINE_USERS":
      return { ...state, onlineUsers: new Set(action.userIds) };
    case "USER_ONLINE": {
      const updated = new Set(state.onlineUsers);
      updated.add(action.userId);
      return { ...state, onlineUsers: updated };
    }
    case "USER_OFFLINE": {
      const updated = new Set(state.onlineUsers);
      updated.delete(action.userId);
      return { ...state, onlineUsers: updated };
    }
    case "UPDATE_USER_STATUS": {
      const isMe = state.user?.id === action.userId;
      const updatedMembers = state.members.map((m) =>
        m.user.id === action.userId ? { ...m, user: { ...m.user, status: action.status, custom_status: action.customStatus ?? m.user.custom_status } } : m
      );
      const updatedUser = isMe && state.user ? { ...state.user, status: action.status, custom_status: action.customStatus ?? state.user.custom_status } : state.user;
      return {
        ...state,
        members: updatedMembers,
        user: updatedUser,
      };
    }
    case "UPDATE_SERVER":
      return {
        ...state,
        servers: state.servers.map((s) =>
          s.id === action.serverId ? { ...s, ...action.updates } : s
        ),
      };
    case "REMOVE_SERVER":
      return {
        ...state,
        servers: state.servers.filter((s) => s.id !== action.serverId),
        activeServerId: state.activeServerId === action.serverId ? null : state.activeServerId,
      };
    case "SET_READ_STATES":
      return {
        ...state,
        readStates: action.readStates,
        lastMessageAt: action.lastMessageAt,
      };
    case "UPDATE_READ_STATE":
      return {
        ...state,
        readStates: { ...state.readStates, [action.channelId]: action.timestamp },
      };
    case "UPDATE_LAST_MESSAGE":
      return {
        ...state,
        lastMessageAt: { ...state.lastMessageAt, [action.channelId]: action.timestamp },
      };
    case "PIN_MESSAGE": {
      const isPinned = action.pinned;
      // Update the main messages list
      const updatedMessages = state.messages.map((m) =>
        m.id === action.messageId ? { ...m, is_pinned: isPinned } : m
      );

      // Update the pinned messages list
      let updatedPinned = [...state.pinnedMessages];
      if (isPinned) {
        // If it's not already in the list, we try to find it
        if (!updatedPinned.some(m => m.id === action.messageId)) {
          // Priority: 1. Full message from action, 2. Message from current list
          const fullMsg = action.fullMessage || state.messages.find(m => m.id === action.messageId);
          if (fullMsg) {
            updatedPinned.push({ ...fullMsg, is_pinned: true });
            // Sort by creation date
            updatedPinned.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
          }
        }
      } else {
        updatedPinned = updatedPinned.filter(m => m.id !== action.messageId);
      }

      return {
        ...state,
        messages: updatedMessages,
        pinnedMessages: updatedPinned,
      };
    }
    case "SET_PINNED_MESSAGES":
      return { ...state, pinnedMessages: action.messages, pinsLoadedFor: action.channelId, loadingPins: false };
    case "SET_LOADING_PINS":
      return { ...state, loadingPins: action.loading };
    case "SET_DM_CHANNELS":
      return { ...state, dmChannels: action.dmChannels };
    case "ADD_DM_CHANNEL":
      // Add if not already present
      if (state.dmChannels.some((d) => d.id === action.dmChannel.id)) return state;
      return { ...state, dmChannels: [action.dmChannel, ...state.dmChannels] };
    case "SET_VOICE_CHANNEL_STATES":
      return { ...state, voiceChannelStates: action.states };
    case "UPDATE_VOICE_CHANNEL_STATE": {
      const next = { ...state.voiceChannelStates };
      if (action.members.length === 0) {
        delete next[action.channelId];
      } else {
        next[action.channelId] = action.members;
      }
      return { ...state, voiceChannelStates: next };
    }
    case "SET_RELATIONSHIPS":
      return { ...state, relationships: action.relationships };
    case "ADD_RELATIONSHIP":
      // Replace if present, else add
      return {
        ...state,
        relationships: [
          action.relationship,
          ...state.relationships.filter((r) => r.user.id !== action.relationship.user.id),
        ],
      };
    case "REMOVE_RELATIONSHIP":
      return {
        ...state,
        relationships: state.relationships.filter((r) => r.user.id !== action.userId),
      };
    case "SET_PROFILE_USER":
      return { ...state, profileUser: action.user };
    case "SET_SPEAKING_USERS":
      // Optional optimization: skip update if objects are deeply equal, but for now simple swap
      return { ...state, speakingUsers: action.speakingUsers };
    default:
      return state;
  }
}

// ── Contexts ───────────────────────────────────────────────────────────────

const ChatStateContext = createContext<ChatState | null>(null);

/** Actions that never change and don't trigger re-renders when state updates */
export interface ChatActions {
  dispatch: React.Dispatch<ChatAction>;
  sendMessage: (channelId: string, content: string, replyToId?: string, replyTo?: Message, attachmentIds?: string[], optimisticAttachments?: Attachment[]) => Promise<void>;
  sendTyping: (channelId: string) => Promise<void>;
  subscribeChannel: (channelId: string) => void;
  unsubscribeChannel: (channelId: string) => void;
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
  sendVoiceChannelJoin: (channelId: string, selfMute?: boolean) => void;
  sendVoiceChannelLeave: () => void;
  sendVoiceStateUpdate: (data: { self_mute?: boolean; self_deaf?: boolean; self_video?: boolean; self_stream?: boolean; self_stream_audio?: boolean }) => void;
  setProfileUser: (user: User | null) => void;
  setSpeakingUsers: (speakingUsers: Record<string, boolean>) => void;
}

const ChatActionsContext = createContext<ChatActions | null>(null);

// ── Provider ────────────────────────────────────────────────────────────────

export function ChatProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(chatReducer, initialState);
  const { userId: clerkUserId } = useAuth();
  const wsRef = useRef<WebSocket | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const seqRef = useRef(0);
  const typingTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const stateRef = useRef(state);
  const identifiedRef = useRef(false);
  const gatewayReadyRef = useRef(false);
  const pendingQueue = useRef<object[]>([]);
  const clerkUserIdRef = useRef(clerkUserId);
  stateRef.current = state;
  clerkUserIdRef.current = clerkUserId;

  // ── Gateway connection ────────────────────────────────────────────────

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
  }, [clerkUserId, state.connected]);

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
      case "GUILD_MEMBER_REMOVE":
        dispatch({ type: "REMOVE_MEMBER", userId: d.data.user_id });
        dispatch({ type: "USER_OFFLINE", userId: d.data.user_id });
        break;
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

  // ── Gateway-only actions (presence, not mutations) ──────────────────────

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

  // ── REST mutations (Discord-style: all writes go through REST) ────────

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

  const sendTyping = useCallback(
    async (channelId: string) => {
      await fetch(`/api/channels/${channelId}/typing`, {
        method: "POST",
      });
    },
    []
  );

  const stopTyping = useCallback(
    async (channelId: string) => {
      await fetch(`/api/channels/${channelId}/typing`, {
        method: "DELETE",
      });
    },
    []
  );

  // ── REST actions ──────────────────────────────────────────────────────

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
    dispatch({ type: "SET_STATUS", status: data.status as any, customStatus: data.custom_status });
  }, []);

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

  const loadDmChannels = useCallback(async () => {
    const res = await fetch("/api/dms");
    if (!res.ok) return;
    const data = await res.json() as Array<{ id: string; name: string; recipient: User }>;
    dispatch({ type: "SET_DM_CHANNELS", dmChannels: data });
  }, []);

  const loadRelationships = useCallback(async () => {
    const res = await fetch("/api/friends");
    if (!res.ok) return;
    const data = await res.json() as Relationship[];
    dispatch({ type: "SET_RELATIONSHIPS", relationships: data });
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

  const setProfileUser = useCallback((user: User | null) => {
    dispatch({ type: "SET_PROFILE_USER", user });
  }, []);

  const setSpeakingUsers = useCallback((speakingUsers: Record<string, boolean>) => {
    dispatch({ type: "SET_SPEAKING_USERS", speakingUsers });
  }, []);

  const actions: ChatActions = useMemo(() => ({
    dispatch,
    sendMessage,
    sendTyping,
    subscribeChannel,
    unsubscribeChannel,
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
    sendVoiceChannelJoin,
    sendVoiceChannelLeave,
    sendVoiceStateUpdate,
    setProfileUser,
    setSpeakingUsers,
  }), [
    dispatch,
    sendMessage,
    sendTyping,
    subscribeChannel,
    unsubscribeChannel,
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
    sendVoiceChannelJoin,
    sendVoiceChannelLeave,
    sendVoiceStateUpdate,
    setProfileUser,
    setSpeakingUsers,
  ]);

  return (
    <ChatStateContext.Provider value={state}>
      <ChatActionsContext.Provider value={actions}>
        {children}
      </ChatActionsContext.Provider>
    </ChatStateContext.Provider>
  );
}

// ── Hooks ───────────────────────────────────────────────────────────────────

export function useChatState(): ChatState {
  const ctx = useContext(ChatStateContext);
  if (!ctx) throw new Error("useChatState must be used within ChatProvider");
  return ctx;
}

/** Like useChatState, but returns null outside ChatProvider instead of throwing */
export function useOptionalChatState(): ChatState | null {
  return useContext(ChatStateContext);
}


export function useChatActions(): ChatActions {
  const ctx = useContext(ChatActionsContext);
  if (!ctx) throw new Error("useChatActions must be used within ChatProvider");
  return ctx;
}


