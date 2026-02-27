import type {
  Category,
  Channel,
  Message,
  Relationship,
  Role,
  Server,
  User
} from "@/lib/types";

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

export const initialState: ChatState = {
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

export type ChatAction =
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

// ── Reducer ─────────────────────────────────────────────────────────────────

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
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
    case "REMOVE_SERVER": {
      const isActive = state.activeServerId === action.serverId;
      return {
        ...state,
        servers: state.servers.filter((s) => s.id !== action.serverId),
        // If the removed server was active, clear all server-scoped state
        activeServerId: isActive ? "@me" : state.activeServerId,
        activeChannelId: isActive ? null : state.activeChannelId,
        channels: isActive ? [] : state.channels,
        messages: isActive ? [] : state.messages,
        members: isActive ? [] : state.members,
        pinnedMessages: isActive ? [] : state.pinnedMessages,
        pinsLoadedFor: isActive ? null : state.pinsLoadedFor,
        voiceChannelStates: isActive ? {} : state.voiceChannelStates,
      };
    }
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
