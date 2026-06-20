import type {
  Category,
  Channel,
  Message,
  Notification,
  Relationship,
  Role,
  Server,
  User
} from "@/lib/types";
import { getDisplayName } from "@/lib/display-name";
import type { SharedSpatialAudioState } from "@/lib/voice/spatial-audio";

// ── State shape ─────────────────────────────────────────────────────────────

export interface ChatState {
  /** Connection status */
  connected: boolean;
  /** Current reconnection attempt (0 = not reconnecting) */
  reconnectAttempt: number;
  /** Current user */
  user: User | null;
  /** Servers the user belongs to */
  servers: Server[];
  /** All channels across servers */
  channels: Channel[];
  /** Cached channels per server */
  channelsByServerId: Record<string, Channel[]>;
  /** Whether channels/categories have loaded for a server */
  channelsLoadedByServerId: Record<string, boolean>;
  /** Channel categories for the active server */
  categories: Category[];
  /** Cached categories per server */
  categoriesByServerId: Record<string, Category[]>;
  /** Active server ID */
  activeServerId: string | null;
  /** Active channel ID */
  activeChannelId: string | null;
  /** Messages for the current channel */
  messages: Message[];
  /** Cached message slices per channel */
  messagesByChannelId: Record<string, Message[]>;
  /** Whether a channel has had its initial message slice loaded */
  messagesLoadedByChannelId: Record<string, boolean>;
  /** Cached backward pagination state per channel */
  messageHasMoreBeforeByChannelId: Record<string, boolean>;
  /** Cached forward pagination state per channel */
  messageHasMoreAfterByChannelId: Record<string, boolean>;
  /** Typing users per channel: channelId → Set<userId> */
  typingUsers: Record<string, Set<string>>;
  /** Members of the active server */
  members: Array<{ user: User; roles?: Role[] }>;
  /** Cached members per server */
  membersByServerId: Record<string, Array<{ user: User; roles?: Role[] }>>;
  /** Whether members have loaded for a server */
  membersLoadedByServerId: Record<string, boolean>;
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
  /** Voice channel start timestamps: channelId → epoch ms when first member joined */
  voiceChannelStartedAt: Record<string, number>;
  voiceChannelSpatialAudioStates: Record<string, SharedSpatialAudioState>;
  /** Pinned messages for the current channel */
  pinnedMessages: Message[];
  /** Cached pinned messages per channel */
  pinnedMessagesByChannelId: Record<string, Message[]>;
  /** Whether pins have been loaded for a channel */
  pinsLoadedByChannelId: Record<string, boolean>;
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
  /** User notifications (mentions, replies, DMs) */
  notifications: Notification[];
  /** Unread notification count (for badge) */
  unreadNotificationCount: number;
  /** Per-server unread mention/reply count: serverId → count */
  serverMentionCounts: Record<string, number>;
  /** Per-channel unread mention/reply count: channelId → count */
  channelMentionCounts: Record<string, number>;
  /** Scroll position per channel: channelId → messageId */
  scrollPositions: Record<string, string>;
  /** Jump anchor per channel: channelId → messageId (set when position was from a manual jump) */
  jumpAnchors: Record<string, string>;
}

export interface VoiceChannelMember {
  clerk_user_id: string;
  name: string;
  username?: string;
  display_name?: string | null;
  avatar_url?: string | null;
  connected?: boolean;
  connection_state?: "connected" | "reconnecting";
  disconnected_at?: number | null;
  reconnect_expires_at?: number | null;
  self_mute: boolean;
  self_deaf: boolean;
  self_video: boolean;
  self_stream: boolean;
  self_stream_audio?: boolean;
  spatial_audio_enabled?: boolean;
  spatial_audio_high_fidelity?: boolean;
  joined_at?: number;
}

export const initialState: ChatState = {
  connected: false,
  reconnectAttempt: 0,
  user: null,
  servers: [],
  channels: [],
  channelsByServerId: {},
  channelsLoadedByServerId: {},
  categories: [],
  categoriesByServerId: {},
  activeServerId: null,
  activeChannelId: null,
  messages: [],
  messagesByChannelId: {},
  messagesLoadedByChannelId: {},
  messageHasMoreBeforeByChannelId: {},
  messageHasMoreAfterByChannelId: {},
  typingUsers: {},
  members: [],
  membersByServerId: {},
  membersLoadedByServerId: {},
  onlineUsers: new Set(),
  readStates: {},
  lastMessageAt: {},
  dmChannels: [],
  voiceChannelStates: {},
  voiceChannelStartedAt: {},
  voiceChannelSpatialAudioStates: {},
  pinnedMessages: [],
  pinnedMessagesByChannelId: {},
  pinsLoadedByChannelId: {},
  loadingPins: false,
  pinsLoadedFor: null,
  relationships: [],
  profileUser: null,
  speakingUsers: {},
  notifications: [],
  unreadNotificationCount: 0,
  serverMentionCounts: {},
  channelMentionCounts: {},
  scrollPositions: {},
  jumpAnchors: {},
};

// ── Actions ─────────────────────────────────────────────────────────────────

export type ChatAction =
  | { type: "SET_CONNECTED"; connected: boolean }
  | { type: "SET_RECONNECT_ATTEMPT"; attempt: number }
  | { type: "SET_USER"; user: User }
  | { type: "SET_STATUS"; status: "online" | "idle" | "dnd" | "offline"; customStatus?: string }
  | { type: "SET_SERVERS"; servers: Server[] }
  | { type: "ADD_SERVER"; server: Server }
  | { type: "SET_CHANNELS"; channels: Channel[]; serverId?: string }
  | { type: "SET_CATEGORIES"; categories: Category[]; serverId?: string }
  | { type: "SET_CHANNELS_AND_CATEGORIES"; channels: Channel[]; categories: Category[]; serverId?: string }
  | { type: "ADD_CHANNEL"; channel: Channel }
  | { type: "UPSERT_CHANNEL"; channel: Channel }
  | { type: "ADD_CHANNEL_OPTIMISTIC"; channel: Channel }
  | { type: "UPDATE_CHANNEL_ID"; oldId: string; newChannel: Channel }
  | { type: "REMOVE_CHANNEL"; channelId: string }
  | { type: "SET_ACTIVE_SERVER"; serverId: string | null }
  | { type: "SET_ACTIVE_CHANNEL"; channelId: string | null }
  | { type: "SET_MESSAGES"; messages: Message[]; channelId?: string; hasMoreBefore?: boolean; hasMoreAfter?: boolean }
  | { type: "REPLACE_MESSAGES"; messages: Message[]; channelId?: string; hasMoreBefore?: boolean; hasMoreAfter?: boolean }
  | { type: "APPEND_MESSAGE"; message: Message }
  | { type: "APPEND_MESSAGES_AFTER"; messages: Message[]; channelId?: string; hasMoreAfter?: boolean }
  | { type: "UPDATE_MESSAGE"; id: string; content?: string; updated_at?: string; embeds?: import("@/lib/types").EmbedInfo[] }
  | { type: "DELETE_MESSAGE"; id: string }
  | { type: "PREPEND_MESSAGES"; messages: Message[]; channelId?: string; hasMoreBefore?: boolean }
  | { type: "SET_TYPING"; channelId: string; userId: string }
  | { type: "CLEAR_TYPING"; channelId: string; userId: string }
  | { type: "SET_MEMBERS"; members: Array<{ user: User; roles?: Role[] }>; serverId?: string }
  | { type: "ADD_MEMBER"; member: { user: User; roles?: Role[] }; serverId?: string }
  | { type: "REMOVE_MEMBER"; userId: string; serverId?: string }
  | { type: "UPDATE_MEMBER_ROLES"; userId: string; roles?: Role[]; serverId?: string }
  | {
    type: "UPDATE_MEMBER_PROFILE";
    userId: string;
    username?: string;
    display_name?: string | null;
    avatar_url?: string | null;
    banner_url?: string | null;
    banner_content_type?: string | null;
    nameplate_url?: string | null;
    nameplate_content_type?: string | null;
    updated_at?: string;
  }
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
  | { type: "SET_VOICE_CHANNEL_STATES"; states: Record<string, VoiceChannelMember[]>; startedAt: Record<string, number>; spatialStates?: Record<string, SharedSpatialAudioState> }
  | { type: "UPDATE_VOICE_CHANNEL_STATE"; channelId: string; members: VoiceChannelMember[]; startedAt: number | null; spatialAudioState?: SharedSpatialAudioState }
  | { type: "SET_PINNED_MESSAGES"; messages: Message[]; channelId: string }
  | { type: "SET_LOADING_PINS"; loading: boolean }
  | { type: "ADD_CATEGORY"; category: Category }
  | { type: "SWITCH_SERVER"; serverId: string; channelId: string | null }
  | { type: "SET_RELATIONSHIPS"; relationships: Relationship[] }
  | { type: "ADD_RELATIONSHIP"; relationship: Relationship }
  | { type: "REMOVE_RELATIONSHIP"; userId: string }
  | { type: "SET_PROFILE_USER"; user: User | null }
  | { type: "SET_SPEAKING_USERS"; speakingUsers: Record<string, boolean> }
  | { type: "SET_NOTIFICATIONS"; notifications: Notification[]; unreadCount: number }
  | { type: "ADD_NOTIFICATION"; notification: Notification }
  | { type: "MARK_NOTIFICATIONS_READ"; ids?: string[]; all?: boolean }
  | { type: "CLEAR_NOTIFICATIONS" }
  | { type: "SET_SCROLL_POSITION"; channelId: string; messageId: string }
  | { type: "SET_JUMP_ANCHOR"; channelId: string; messageId: string }
  | { type: "CLEAR_JUMP_ANCHOR"; channelId: string };

// ── Reducer ─────────────────────────────────────────────────────────────────

/**
 * Compute per-server and per-channel unread mention/reply counts from
 * the notifications array. Only counts unread mention and reply types.
 */
function computeMentionCounts(notifications: Notification[]): {
  serverMentionCounts: Record<string, number>;
  channelMentionCounts: Record<string, number>;
} {
  const serverMentionCounts: Record<string, number> = {};
  const channelMentionCounts: Record<string, number> = {};

  for (const n of notifications) {
    if (n.is_read) continue;
    // Count mentions and replies (not plain DMs — those use the read-state unread dot)
    if (n.type !== 'mention' && n.type !== 'reply') continue;

    if (n.server_id) {
      serverMentionCounts[n.server_id] = (serverMentionCounts[n.server_id] ?? 0) + 1;
    }
    channelMentionCounts[n.channel_id] = (channelMentionCounts[n.channel_id] ?? 0) + 1;
  }

  return { serverMentionCounts, channelMentionCounts };
}

/**
 * Enrich voice channel members with avatar URLs from the members/relationships
 * stores when the gateway-provided avatar_url is missing. This ensures voice
 * channel UI always shows the best available avatar.
 */
function findKnownUser(state: ChatState, userId: string): User | undefined {
  if (state.user?.id === userId) return state.user;

  const activeMember = state.members.find(sm => sm.user.id === userId);
  if (activeMember) return activeMember.user;

  for (const members of Object.values(state.membersByServerId)) {
    const cachedMember = members.find(sm => sm.user.id === userId);
    if (cachedMember) return cachedMember.user;
  }

  const relationship = state.relationships.find(r => r.user.id === userId);
  if (relationship) return relationship.user;

  const dm = state.dmChannels.find(channel => channel.recipient?.id === userId);
  return dm?.recipient;
}

function enrichVoiceMembers(members: VoiceChannelMember[], state: ChatState): VoiceChannelMember[] {
  return members.map(m => {
    const knownUser = findKnownUser(state, m.clerk_user_id);
    const displayName = getDisplayName(knownUser, getDisplayName(m, m.name));

    return {
      ...m,
      name: displayName,
      username: knownUser?.username ?? m.username ?? m.name,
      display_name: knownUser?.display_name ?? m.display_name ?? null,
      avatar_url: m.avatar_url || knownUser?.avatar_url || null,
    };
  });
}

function enrichVoiceChannelStates(
  states: Record<string, VoiceChannelMember[]>,
  state: ChatState
): Record<string, VoiceChannelMember[]> {
  const enriched: Record<string, VoiceChannelMember[]> = {};
  for (const [channelId, members] of Object.entries(states)) {
    enriched[channelId] = enrichVoiceMembers(members, state);
  }
  return enriched;
}

function replaceMessageById(messages: Message[], id: string, update: (message: Message) => Message): Message[] {
  let changed = false;
  const next = messages.map((message) => {
    if (message.id !== id) return message;
    changed = true;
    return update(message);
  });
  return changed ? next : messages;
}

function mapMessageCaches(
  caches: Record<string, Message[]>,
  mapper: (messages: Message[]) => Message[]
): Record<string, Message[]> {
  let changed = false;
  const next: Record<string, Message[]> = {};
  for (const [channelId, messages] of Object.entries(caches)) {
    const mapped = mapper(messages);
    next[channelId] = mapped;
    if (mapped !== messages) changed = true;
  }
  return changed ? next : caches;
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "SET_CONNECTED":
      return { ...state, connected: action.connected, reconnectAttempt: action.connected ? 0 : state.reconnectAttempt };
    case "SET_RECONNECT_ATTEMPT":
      return { ...state, reconnectAttempt: action.attempt };
    case "SET_USER": {
      const nextState = { ...state, user: action.user };
      return {
        ...nextState,
        voiceChannelStates: enrichVoiceChannelStates(nextState.voiceChannelStates, nextState),
      };
    }
    case "SET_STATUS":
      return { ...state, user: state.user ? { ...state.user, status: action.status, custom_status: action.customStatus ?? state.user.custom_status } : state.user };
    case "SET_SERVERS":
      return { ...state, servers: action.servers };
    case "ADD_SERVER":
      return { ...state, servers: [...state.servers, action.server] };
    case "SET_CHANNELS": {
      const serverId = action.serverId ?? state.activeServerId ?? undefined;
      return {
        ...state,
        channels: !serverId || state.activeServerId === serverId ? action.channels : state.channels,
        channelsByServerId: serverId ? { ...state.channelsByServerId, [serverId]: action.channels } : state.channelsByServerId,
        channelsLoadedByServerId: serverId ? { ...state.channelsLoadedByServerId, [serverId]: true } : state.channelsLoadedByServerId,
      };
    }
    case "SET_CATEGORIES": {
      const serverId = action.serverId ?? state.activeServerId ?? undefined;
      return {
        ...state,
        categories: !serverId || state.activeServerId === serverId ? action.categories : state.categories,
        categoriesByServerId: serverId ? { ...state.categoriesByServerId, [serverId]: action.categories } : state.categoriesByServerId,
      };
    }
    case "SET_CHANNELS_AND_CATEGORIES": {
      const serverId = action.serverId ?? state.activeServerId ?? undefined;
      const isActive = !serverId || state.activeServerId === serverId;
      return {
        ...state,
        channels: isActive ? action.channels : state.channels,
        categories: isActive ? action.categories : state.categories,
        channelsByServerId: serverId ? { ...state.channelsByServerId, [serverId]: action.channels } : state.channelsByServerId,
        categoriesByServerId: serverId ? { ...state.categoriesByServerId, [serverId]: action.categories } : state.categoriesByServerId,
        channelsLoadedByServerId: serverId ? { ...state.channelsLoadedByServerId, [serverId]: true } : state.channelsLoadedByServerId,
      };
    }
    case "ADD_CHANNEL": {
      // Deduplicate in case WebSocket beats the REST response
      const serverId = action.channel.server_id ?? state.activeServerId;
      const cachedChannels = serverId ? state.channelsByServerId[serverId] ?? state.channels : state.channels;
      if (cachedChannels.some((c) => c.id === action.channel.id)) return state;
      const nextChannels = [...cachedChannels, action.channel];
      return {
        ...state,
        channels: serverId === state.activeServerId || !serverId ? nextChannels : state.channels,
        channelsByServerId: serverId ? { ...state.channelsByServerId, [serverId]: nextChannels } : state.channelsByServerId,
      };
    }
    case "UPSERT_CHANNEL": {
      const serverId = action.channel.server_id ?? state.activeServerId;
      const cachedChannels = serverId ? state.channelsByServerId[serverId] ?? [] : state.channels;
      const existingIndex = cachedChannels.findIndex((c) => c.id === action.channel.id);
      const nextChannels = existingIndex === -1
        ? [...cachedChannels, action.channel]
        : cachedChannels.map((c) => c.id === action.channel.id ? action.channel : c);
      return {
        ...state,
        channels: serverId === state.activeServerId || !serverId ? nextChannels : state.channels,
        channelsByServerId: serverId ? { ...state.channelsByServerId, [serverId]: nextChannels } : state.channelsByServerId,
      };
    }
    case "ADD_CHANNEL_OPTIMISTIC": {
      const serverId = action.channel.server_id ?? state.activeServerId;
      const cachedChannels = serverId ? state.channelsByServerId[serverId] ?? state.channels : state.channels;
      const nextChannels = [...cachedChannels, action.channel];
      return {
        ...state,
        channels: serverId === state.activeServerId || !serverId ? nextChannels : state.channels,
        channelsByServerId: serverId ? { ...state.channelsByServerId, [serverId]: nextChannels } : state.channelsByServerId,
      };
    }
    case "UPDATE_CHANNEL_ID": {
      const serverId = action.newChannel.server_id ?? state.activeServerId;
      const cachedChannels = serverId ? state.channelsByServerId[serverId] ?? state.channels : state.channels;
      const updatedChannels = cachedChannels.map(c => c.id === action.oldId ? action.newChannel : c);
      // If the active channel was the temp one, point it to the new Real ID
      const newActiveChannelId = state.activeChannelId === action.oldId ? action.newChannel.id : state.activeChannelId;
      return {
        ...state,
        channels: serverId === state.activeServerId || !serverId ? updatedChannels : state.channels,
        channelsByServerId: serverId ? { ...state.channelsByServerId, [serverId]: updatedChannels } : state.channelsByServerId,
        activeChannelId: newActiveChannelId,
      };
    }
    case "REMOVE_CHANNEL": {
      const removedChannel = state.channels.find(c => c.id === action.channelId)
        ?? Object.values(state.channelsByServerId).flat().find(c => c.id === action.channelId);
      const serverId = removedChannel?.server_id ?? state.activeServerId;
      const channelsByServerId = serverId
        ? { ...state.channelsByServerId, [serverId]: (state.channelsByServerId[serverId] ?? state.channels).filter(c => c.id !== action.channelId) }
        : state.channelsByServerId;
      return {
        ...state,
        channels: state.channels.filter(c => c.id !== action.channelId),
        channelsByServerId,
      };
    }
    case "ADD_CATEGORY": {
      const serverId = action.category.server_id ?? state.activeServerId;
      const cachedCategories = serverId ? state.categoriesByServerId[serverId] ?? state.categories : state.categories;
      const nextCategories = [...cachedCategories, action.category];
      return {
        ...state,
        categories: serverId === state.activeServerId || !serverId ? nextCategories : state.categories,
        categoriesByServerId: serverId ? { ...state.categoriesByServerId, [serverId]: nextCategories } : state.categoriesByServerId,
      };
    }
    case "SET_ACTIVE_SERVER":
      if (state.activeServerId === action.serverId) return state;
      return { ...state, activeServerId: action.serverId, messages: [] };
    case "SET_ACTIVE_CHANNEL":
      if (state.activeChannelId === action.channelId) return state;
      return {
        ...state,
        activeChannelId: action.channelId,
        messages: action.channelId ? state.messagesByChannelId[action.channelId] ?? [] : [],
        pinnedMessages: action.channelId ? state.pinnedMessagesByChannelId[action.channelId] ?? [] : [],
        pinsLoadedFor: action.channelId && state.pinsLoadedByChannelId[action.channelId] ? action.channelId : null,
      };
    case "SWITCH_SERVER":
      if (state.activeServerId === action.serverId && state.activeChannelId === action.channelId) return state;
      return {
        ...state,
        activeServerId: action.serverId,
        activeChannelId: action.channelId,
        channels: action.serverId === "@me" ? state.channels : state.channelsByServerId[action.serverId] ?? [],
        categories: action.serverId === "@me" ? state.categories : state.categoriesByServerId[action.serverId] ?? [],
        members: action.serverId === "@me" ? state.members : state.membersByServerId[action.serverId] ?? [],
        messages: action.channelId ? state.messagesByChannelId[action.channelId] ?? [] : [],
        pinnedMessages: action.channelId ? state.pinnedMessagesByChannelId[action.channelId] ?? [] : [],
        pinsLoadedFor: action.channelId && state.pinsLoadedByChannelId[action.channelId] ? action.channelId : null,
      };
    case "SET_MESSAGES": {
      const channelId = action.channelId ?? state.activeChannelId;
      if (!channelId) return { ...state, messages: action.messages };
      const isActive = state.activeChannelId === channelId;
      return {
        ...state,
        messages: isActive ? action.messages : state.messages,
        messagesByChannelId: { ...state.messagesByChannelId, [channelId]: action.messages },
        messagesLoadedByChannelId: { ...state.messagesLoadedByChannelId, [channelId]: true },
        messageHasMoreBeforeByChannelId: action.hasMoreBefore === undefined
          ? state.messageHasMoreBeforeByChannelId
          : { ...state.messageHasMoreBeforeByChannelId, [channelId]: action.hasMoreBefore },
        messageHasMoreAfterByChannelId: action.hasMoreAfter === undefined
          ? state.messageHasMoreAfterByChannelId
          : { ...state.messageHasMoreAfterByChannelId, [channelId]: action.hasMoreAfter },
      };
    }
    case "REPLACE_MESSAGES": {
      // Replace the loaded slice (anchor fetch / context window).
      // Unlike SET_MESSAGES this preserves any pending optimistic messages.
      const channelId = action.channelId ?? state.activeChannelId;
      const previousMessages = channelId ? state.messagesByChannelId[channelId] ?? [] : state.messages;
      const nextMessages = [
        ...action.messages,
        ...previousMessages.filter((m) => m.pending),
      ];
      return {
        ...state,
        messages: channelId === state.activeChannelId ? nextMessages : state.messages,
        messagesByChannelId: channelId
          ? { ...state.messagesByChannelId, [channelId]: nextMessages }
          : state.messagesByChannelId,
        messagesLoadedByChannelId: channelId
          ? { ...state.messagesLoadedByChannelId, [channelId]: true }
          : state.messagesLoadedByChannelId,
        messageHasMoreBeforeByChannelId: channelId && action.hasMoreBefore !== undefined
          ? { ...state.messageHasMoreBeforeByChannelId, [channelId]: action.hasMoreBefore }
          : state.messageHasMoreBeforeByChannelId,
        messageHasMoreAfterByChannelId: channelId && action.hasMoreAfter !== undefined
          ? { ...state.messageHasMoreAfterByChannelId, [channelId]: action.hasMoreAfter }
          : state.messageHasMoreAfterByChannelId,
      };
    }
    case "APPEND_MESSAGES_AFTER": {
      // Append a forward page of messages to the bottom, deduplicating by ID.
      const channelId = action.channelId ?? state.activeChannelId;
      const currentMessages = channelId ? state.messagesByChannelId[channelId] ?? [] : state.messages;
      const existingIds = new Set(currentMessages.map((m) => m.id));
      const newMsgs = action.messages.filter((m) => !existingIds.has(m.id));
      const nextMessages = [...currentMessages, ...newMsgs];
      return {
        ...state,
        messages: channelId === state.activeChannelId ? nextMessages : state.messages,
        messagesByChannelId: channelId ? { ...state.messagesByChannelId, [channelId]: nextMessages } : state.messagesByChannelId,
        messageHasMoreAfterByChannelId: channelId && action.hasMoreAfter !== undefined
          ? { ...state.messageHasMoreAfterByChannelId, [channelId]: action.hasMoreAfter }
          : state.messageHasMoreAfterByChannelId,
      };
    }
    case "APPEND_MESSAGE": {
      const incoming = action.message;
      const currentMessages = state.messagesByChannelId[incoming.channel_id] ?? [];
      // Deduplicate by ID (late echo)
      if (currentMessages.some((m) => m.id === incoming.id)) return state;
      // Deduplicate by nonce — replace optimistic (pending) with server-confirmed
      if (incoming.nonce) {
        const pendingIdx = currentMessages.findIndex(
          (m) => m.nonce === incoming.nonce && m.pending
        );
        if (pendingIdx !== -1) {
          const updated = [...currentMessages];
          updated[pendingIdx] = { ...incoming, pending: false };
          // NOTE: Do NOT increment reply_count here — the initial optimistic
          // append (below) already incremented it on the parent message.
          return {
            ...state,
            messages: incoming.channel_id === state.activeChannelId ? updated : state.messages,
            messagesByChannelId: { ...state.messagesByChannelId, [incoming.channel_id]: updated },
          };
        }
      }
      // Increment reply_count on the parent message if this is a reply
      const messages = [...currentMessages];
      if (incoming.reply_to_id) {
        const parentIdx = messages.findIndex((m) => m.id === incoming.reply_to_id);
        if (parentIdx !== -1) {
          messages[parentIdx] = { ...messages[parentIdx], reply_count: (messages[parentIdx].reply_count ?? 0) + 1 };
        }
      }
      messages.push(incoming);
      return {
        ...state,
        messages: incoming.channel_id === state.activeChannelId ? messages : state.messages,
        messagesByChannelId: { ...state.messagesByChannelId, [incoming.channel_id]: messages },
      };
    }
    case "UPDATE_MESSAGE": {
      const updateMessage = (m: Message) => ({
        ...m,
        ...(action.content !== undefined ? { content: action.content } : {}),
        ...(action.updated_at !== undefined ? { updated_at: action.updated_at } : {}),
        ...(action.embeds !== undefined ? { embeds: action.embeds } : {}),
      });
      const nextMessageCaches = mapMessageCaches(state.messagesByChannelId, (messages) =>
        replaceMessageById(messages, action.id, updateMessage)
      );
      const nextPinnedCaches = mapMessageCaches(state.pinnedMessagesByChannelId, (messages) =>
        replaceMessageById(messages, action.id, updateMessage)
      );
      return {
        ...state,
        messages: replaceMessageById(state.messages, action.id, updateMessage),
        pinnedMessages: replaceMessageById(state.pinnedMessages, action.id, updateMessage),
        messagesByChannelId: nextMessageCaches,
        pinnedMessagesByChannelId: nextPinnedCaches,
      };
    }
    case "DELETE_MESSAGE": {
      let deletedChannelId: string | null = null;
      const nextMessageCaches = mapMessageCaches(state.messagesByChannelId, (messages) => {
        const msgToDelete = messages.find((m) => m.id === action.id);
        if (!msgToDelete) return messages;
        deletedChannelId = msgToDelete.channel_id;
        const nextMessages = messages.filter((m) => m.id !== action.id);

        // Decrement reply_count on the parent if this was a reply
        if (msgToDelete.reply_to_id) {
          const parentIdx = nextMessages.findIndex(m => m.id === msgToDelete.reply_to_id);
          if (parentIdx !== -1) {
            nextMessages[parentIdx] = {
              ...nextMessages[parentIdx],
              reply_count: Math.max(0, (nextMessages[parentIdx].reply_count ?? 1) - 1)
            };
          }
        }

        return nextMessages;
      });
      const nextPinnedCaches = mapMessageCaches(state.pinnedMessagesByChannelId, (messages) =>
        messages.some((m) => m.id === action.id) ? messages.filter((m) => m.id !== action.id) : messages
      );

      return {
        ...state,
        messages: deletedChannelId && deletedChannelId === state.activeChannelId
          ? nextMessageCaches[deletedChannelId] ?? []
          : state.messages.filter((m) => m.id !== action.id),
        pinnedMessages: state.pinnedMessages.filter((m) => m.id !== action.id),
        messagesByChannelId: nextMessageCaches,
        pinnedMessagesByChannelId: nextPinnedCaches,
      };
    }
    case "PREPEND_MESSAGES": {
      const channelId = action.channelId ?? state.activeChannelId;
      const currentMessages = channelId ? state.messagesByChannelId[channelId] ?? [] : state.messages;
      const existingIds = new Set(currentMessages.map((m) => m.id));
      const newMessages = action.messages.filter((m) => !existingIds.has(m.id));
      const nextMessages = [...newMessages, ...currentMessages];
      return {
        ...state,
        messages: channelId === state.activeChannelId ? nextMessages : state.messages,
        messagesByChannelId: channelId ? { ...state.messagesByChannelId, [channelId]: nextMessages } : state.messagesByChannelId,
        messageHasMoreBeforeByChannelId: channelId && action.hasMoreBefore !== undefined
          ? { ...state.messageHasMoreBeforeByChannelId, [channelId]: action.hasMoreBefore }
          : state.messageHasMoreBeforeByChannelId,
      };
    }
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
    case "SET_MEMBERS": {
      const serverId = action.serverId ?? state.activeServerId ?? undefined;
      const nextState = {
        ...state,
        members: !serverId || state.activeServerId === serverId ? action.members : state.members,
        membersByServerId: serverId ? { ...state.membersByServerId, [serverId]: action.members } : state.membersByServerId,
        membersLoadedByServerId: serverId ? { ...state.membersLoadedByServerId, [serverId]: true } : state.membersLoadedByServerId,
      };
      return {
        ...nextState,
        voiceChannelStates: enrichVoiceChannelStates(nextState.voiceChannelStates, nextState),
      };
    }
    case "ADD_MEMBER": {
      const serverId = action.serverId ?? state.activeServerId ?? undefined;
      const isActive = !serverId || state.activeServerId === serverId;
      const currentMembers = serverId ? state.membersByServerId[serverId] ?? (isActive ? state.members : []) : state.members;
      // Don't add duplicates
      if (currentMembers.some((m) => m.user.id === action.member.user.id)) return state;
      const nextMembers = [...currentMembers, action.member];
      return {
        ...state,
        members: isActive ? nextMembers : state.members,
        membersByServerId: serverId ? { ...state.membersByServerId, [serverId]: nextMembers } : state.membersByServerId,
      };
    }
    case "REMOVE_MEMBER": {
      const serverId = action.serverId ?? state.activeServerId ?? undefined;
      const isActive = !serverId || state.activeServerId === serverId;
      const currentMembers = serverId ? state.membersByServerId[serverId] ?? (isActive ? state.members : []) : state.members;
      const nextMembers = currentMembers.filter((m) => m.user.id !== action.userId);
      return {
        ...state,
        members: isActive ? nextMembers : state.members,
        membersByServerId: serverId ? { ...state.membersByServerId, [serverId]: nextMembers } : state.membersByServerId,
      };
    }
    case "UPDATE_MEMBER_ROLES": {
      const serverId = action.serverId ?? state.activeServerId ?? undefined;
      const isActive = !serverId || state.activeServerId === serverId;
      const currentMembers = serverId ? state.membersByServerId[serverId] ?? (isActive ? state.members : []) : state.members;
      const idx = currentMembers.findIndex((m) => m.user.id === action.userId);
      if (idx === -1) return state;
      const newMembers = [...currentMembers];
      newMembers[idx] = { ...newMembers[idx], roles: action.roles };
      return {
        ...state,
        members: isActive ? newMembers : state.members,
        membersByServerId: serverId ? { ...state.membersByServerId, [serverId]: newMembers } : state.membersByServerId,
      };
    }
    case "UPDATE_MEMBER_PROFILE": {
      // 1. Update local user if it matches
        let newUser = state.user;
        if (newUser && newUser.id === action.userId) {
          newUser = { ...newUser };
          if (action.username !== undefined) newUser.username = action.username;
          if (action.display_name !== undefined) newUser.display_name = action.display_name;
          if (action.avatar_url !== undefined) newUser.avatar_url = action.avatar_url;
          if (action.banner_url !== undefined) newUser.banner_url = action.banner_url;
          if (action.banner_content_type !== undefined) newUser.banner_content_type = action.banner_content_type;
          if (action.nameplate_url !== undefined) newUser.nameplate_url = action.nameplate_url;
          if (action.nameplate_content_type !== undefined) newUser.nameplate_content_type = action.nameplate_content_type;
          if (action.updated_at !== undefined) newUser.updated_at = action.updated_at;
        }

      // 2. Update member list
      const idx = state.members.findIndex((m) => m.user.id === action.userId);
      let newMembers = state.members;
        if (idx !== -1) {
          newMembers = [...state.members];
          const updatedUser = { ...newMembers[idx].user };
          if (action.username !== undefined) updatedUser.username = action.username;
          if (action.display_name !== undefined) updatedUser.display_name = action.display_name;
          if (action.avatar_url !== undefined) updatedUser.avatar_url = action.avatar_url;
          if (action.banner_url !== undefined) updatedUser.banner_url = action.banner_url;
          if (action.banner_content_type !== undefined) updatedUser.banner_content_type = action.banner_content_type;
          if (action.nameplate_url !== undefined) updatedUser.nameplate_url = action.nameplate_url;
          if (action.nameplate_content_type !== undefined) updatedUser.nameplate_content_type = action.nameplate_content_type;
          if (action.updated_at !== undefined) updatedUser.updated_at = action.updated_at;
          newMembers[idx] = { ...newMembers[idx], user: updatedUser };
        }

      // 2b. Update cached per-server member lists
      let membersByServerChanged = false;
      const nextMembersByServerId = Object.fromEntries(
        Object.entries(state.membersByServerId).map(([serverId, members]) => {
          let changed = false;
          const nextMembersForServer = members.map((member) => {
            if (member.user.id !== action.userId) return member;

            changed = true;
            const updatedUser = { ...member.user };
            if (action.username !== undefined) updatedUser.username = action.username;
            if (action.display_name !== undefined) updatedUser.display_name = action.display_name;
            if (action.avatar_url !== undefined) updatedUser.avatar_url = action.avatar_url;
            if (action.banner_url !== undefined) updatedUser.banner_url = action.banner_url;
            if (action.banner_content_type !== undefined) updatedUser.banner_content_type = action.banner_content_type;
            if (action.nameplate_url !== undefined) updatedUser.nameplate_url = action.nameplate_url;
            if (action.nameplate_content_type !== undefined) updatedUser.nameplate_content_type = action.nameplate_content_type;
            if (action.updated_at !== undefined) updatedUser.updated_at = action.updated_at;
            return { ...member, user: updatedUser };
          });

          if (changed) membersByServerChanged = true;
          return [serverId, changed ? nextMembersForServer : members];
        })
      );

      // 3. Update voice channel states
      const newVoiceStates = { ...state.voiceChannelStates };
      let voiceChanged = false;
      for (const channelId of Object.keys(newVoiceStates)) {
        const members = newVoiceStates[channelId];
        const vcIdx = members.findIndex((m) => m.clerk_user_id === action.userId);
        if (vcIdx !== -1) {
          const updated = { ...members[vcIdx] };
          if (action.username !== undefined) updated.username = action.username;
          if (action.display_name !== undefined) updated.display_name = action.display_name;
          if (action.display_name !== undefined || action.username !== undefined) {
            updated.name = getDisplayName({
              display_name: updated.display_name,
              username: updated.username,
              name: updated.name,
            }, updated.name);
          }
          if (action.avatar_url !== undefined) updated.avatar_url = action.avatar_url;
          newVoiceStates[channelId] = [...members];
          newVoiceStates[channelId][vcIdx] = updated;
          voiceChanged = true;
        }
      }

      // 4. Update DM channel recipients
      let newDmChannels = state.dmChannels;
      const dmIdx = state.dmChannels.findIndex((dm) => dm.recipient?.id === action.userId);
        if (dmIdx !== -1) {
          newDmChannels = [...state.dmChannels];
          const updatedRecipient = { ...newDmChannels[dmIdx].recipient };
          if (action.username !== undefined) updatedRecipient.username = action.username;
          if (action.display_name !== undefined) updatedRecipient.display_name = action.display_name;
          if (action.avatar_url !== undefined) updatedRecipient.avatar_url = action.avatar_url;
          if (action.banner_url !== undefined) updatedRecipient.banner_url = action.banner_url;
          if (action.banner_content_type !== undefined) updatedRecipient.banner_content_type = action.banner_content_type;
          if (action.nameplate_url !== undefined) updatedRecipient.nameplate_url = action.nameplate_url;
          if (action.nameplate_content_type !== undefined) updatedRecipient.nameplate_content_type = action.nameplate_content_type;
          if (action.updated_at !== undefined) updatedRecipient.updated_at = action.updated_at;
          newDmChannels[dmIdx] = { ...newDmChannels[dmIdx], recipient: updatedRecipient };
        }

      // 5. Update relationships
      let newRelationships = state.relationships;
      const relIdx = state.relationships.findIndex((r) => r.user?.id === action.userId);
        if (relIdx !== -1) {
          newRelationships = [...state.relationships];
          const updatedRelUser = { ...newRelationships[relIdx].user } as User;
          if (action.username !== undefined) updatedRelUser.username = action.username;
          if (action.display_name !== undefined) updatedRelUser.display_name = action.display_name;
          if (action.avatar_url !== undefined) updatedRelUser.avatar_url = action.avatar_url;
          if (action.banner_url !== undefined) updatedRelUser.banner_url = action.banner_url;
          if (action.banner_content_type !== undefined) updatedRelUser.banner_content_type = action.banner_content_type;
          if (action.nameplate_url !== undefined) updatedRelUser.nameplate_url = action.nameplate_url;
          if (action.nameplate_content_type !== undefined) updatedRelUser.nameplate_content_type = action.nameplate_content_type;
          if (action.updated_at !== undefined) updatedRelUser.updated_at = action.updated_at;
          newRelationships[relIdx] = { ...newRelationships[relIdx], user: updatedRelUser };
        }

      // 6. Update message authors in current view
      let newMessages = state.messages;
      const hasAuthorMatch = state.messages.some((m) => m.author_id === action.userId);
      if (hasAuthorMatch) {
        newMessages = state.messages.map((m) => {
          if (m.author_id !== action.userId || !m.author) return m;
          const updatedAuthor = { ...m.author };
          if (action.username !== undefined) updatedAuthor.username = action.username;
          if (action.display_name !== undefined) updatedAuthor.display_name = action.display_name;
          if (action.avatar_url !== undefined) updatedAuthor.avatar_url = action.avatar_url;
          if (action.banner_url !== undefined) updatedAuthor.banner_url = action.banner_url;
          if (action.banner_content_type !== undefined) updatedAuthor.banner_content_type = action.banner_content_type;
          if (action.nameplate_url !== undefined) updatedAuthor.nameplate_url = action.nameplate_url;
          if (action.nameplate_content_type !== undefined) updatedAuthor.nameplate_content_type = action.nameplate_content_type;
          return { ...m, author: updatedAuthor };
        });
      }

      const updateMessageAuthor = (messages: Message[]) =>
        messages.map((m) => {
          if (m.author_id !== action.userId || !m.author) return m;
          const updatedAuthor = { ...m.author };
          if (action.username !== undefined) updatedAuthor.username = action.username;
          if (action.display_name !== undefined) updatedAuthor.display_name = action.display_name;
          if (action.avatar_url !== undefined) updatedAuthor.avatar_url = action.avatar_url;
          if (action.banner_url !== undefined) updatedAuthor.banner_url = action.banner_url;
          if (action.banner_content_type !== undefined) updatedAuthor.banner_content_type = action.banner_content_type;
          if (action.nameplate_url !== undefined) updatedAuthor.nameplate_url = action.nameplate_url;
          if (action.nameplate_content_type !== undefined) updatedAuthor.nameplate_content_type = action.nameplate_content_type;
          return { ...m, author: updatedAuthor };
        });

      const nextMessageCaches = mapMessageCaches(state.messagesByChannelId, updateMessageAuthor);
      const nextPinnedCaches = mapMessageCaches(state.pinnedMessagesByChannelId, updateMessageAuthor);

      const nextPinnedMessages = state.activeChannelId
        ? nextPinnedCaches[state.activeChannelId] ?? state.pinnedMessages
        : state.pinnedMessages;

      return {
        ...state,
        user: newUser,
        members: newMembers,
        membersByServerId: membersByServerChanged ? nextMembersByServerId : state.membersByServerId,
        voiceChannelStates: voiceChanged ? newVoiceStates : state.voiceChannelStates,
        dmChannels: newDmChannels,
        relationships: newRelationships,
        messages: newMessages,
        messagesByChannelId: nextMessageCaches,
        pinnedMessagesByChannelId: nextPinnedCaches,
        pinnedMessages: nextPinnedMessages,
      };
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
        voiceChannelStartedAt: isActive ? {} : state.voiceChannelStartedAt,
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
      const targetChannelId = action.fullMessage?.channel_id
        ?? state.messages.find((m) => m.id === action.messageId)?.channel_id
        ?? Object.entries(state.messagesByChannelId).find(([, messages]) => messages.some((m) => m.id === action.messageId))?.[0]
        ?? state.activeChannelId;
      const updatePinnedFlag = (messages: Message[]) =>
        replaceMessageById(messages, action.messageId, (message) => ({ ...message, is_pinned: isPinned }));
      const nextMessageCaches = mapMessageCaches(state.messagesByChannelId, updatePinnedFlag);
      // Update the main messages list
      const updatedMessages = updatePinnedFlag(state.messages);

      // Update the pinned messages list
      const existingPinned = targetChannelId
        ? state.pinnedMessagesByChannelId[targetChannelId] ?? []
        : state.pinnedMessages;
      let updatedPinned = [...existingPinned];
      if (isPinned) {
        // If it's not already in the list, we try to find it
        if (!updatedPinned.some(m => m.id === action.messageId)) {
          // Priority: 1. Full message from action, 2. Message from current list
          const fullMsg = action.fullMessage
            || state.messages.find(m => m.id === action.messageId)
            || (targetChannelId ? state.messagesByChannelId[targetChannelId]?.find(m => m.id === action.messageId) : undefined);
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
        pinnedMessages: targetChannelId === state.activeChannelId || !state.activeChannelId ? updatedPinned : state.pinnedMessages,
        messagesByChannelId: nextMessageCaches,
        pinnedMessagesByChannelId: targetChannelId
          ? { ...state.pinnedMessagesByChannelId, [targetChannelId]: updatedPinned }
          : state.pinnedMessagesByChannelId,
      };
    }
    case "SET_PINNED_MESSAGES":
      return {
        ...state,
        pinnedMessages: state.activeChannelId === action.channelId ? action.messages : state.pinnedMessages,
        pinnedMessagesByChannelId: { ...state.pinnedMessagesByChannelId, [action.channelId]: action.messages },
        pinsLoadedByChannelId: { ...state.pinsLoadedByChannelId, [action.channelId]: true },
        pinsLoadedFor: state.activeChannelId === action.channelId ? action.channelId : state.pinsLoadedFor,
        loadingPins: false,
      };
    case "SET_LOADING_PINS":
      return { ...state, loadingPins: action.loading };
    case "SET_DM_CHANNELS":
      return {
        ...state,
        dmChannels: action.dmChannels,
        voiceChannelStates: enrichVoiceChannelStates(state.voiceChannelStates, { ...state, dmChannels: action.dmChannels }),
      };
    case "ADD_DM_CHANNEL":
      // Add if not already present
      if (state.dmChannels.some((d) => d.id === action.dmChannel.id)) return state;
      return {
        ...state,
        dmChannels: [action.dmChannel, ...state.dmChannels],
        voiceChannelStates: enrichVoiceChannelStates(state.voiceChannelStates, { ...state, dmChannels: [action.dmChannel, ...state.dmChannels] }),
      };
    case "SET_VOICE_CHANNEL_STATES": {
      // Enrich voice members with avatars from the members/relationships stores
      const enriched: Record<string, VoiceChannelMember[]> = {};
      const nextStartedAt: Record<string, number> = {};
      for (const [channelId, members] of Object.entries(action.states)) {
        enriched[channelId] = enrichVoiceMembers(members, state);
        const incoming = action.startedAt[channelId];
        const previous = state.voiceChannelStartedAt[channelId];
        const memberJoinedAt = members
          .map((m) => m.joined_at)
          .filter((ts): ts is number => typeof ts === "number" && ts > 0)
          .sort((a, b) => a - b)[0];
        const candidates = [incoming, previous, memberJoinedAt].filter((ts): ts is number => typeof ts === "number" && ts > 0);
        if (candidates.length > 0) {
          nextStartedAt[channelId] = Math.min(...candidates);
        }
      }
      return {
        ...state,
        voiceChannelStates: enriched,
        voiceChannelStartedAt: nextStartedAt,
        voiceChannelSpatialAudioStates: action.spatialStates ?? state.voiceChannelSpatialAudioStates,
      };
    }
    case "UPDATE_VOICE_CHANNEL_STATE": {
      const next = { ...state.voiceChannelStates };
      const nextStartedAt = { ...state.voiceChannelStartedAt };
      if (action.members.length === 0) {
        delete next[action.channelId];
        delete nextStartedAt[action.channelId];
      } else {
        next[action.channelId] = enrichVoiceMembers(action.members, state);
        const memberJoinedAt = action.members
          .map((m) => m.joined_at)
          .filter((ts): ts is number => typeof ts === "number" && ts > 0)
          .sort((a, b) => a - b)[0];
        const previous = nextStartedAt[action.channelId];
        const candidates = [action.startedAt, previous, memberJoinedAt].filter((ts): ts is number => typeof ts === "number" && ts > 0);
        if (candidates.length > 0) {
          nextStartedAt[action.channelId] = Math.min(...candidates);
        }
      }
      return {
        ...state,
        voiceChannelStates: next,
        voiceChannelStartedAt: nextStartedAt,
        voiceChannelSpatialAudioStates: action.spatialAudioState
          ? { ...state.voiceChannelSpatialAudioStates, [action.channelId]: action.spatialAudioState }
          : state.voiceChannelSpatialAudioStates,
      };
    }
    case "SET_RELATIONSHIPS":
      return {
        ...state,
        relationships: action.relationships,
        voiceChannelStates: enrichVoiceChannelStates(state.voiceChannelStates, { ...state, relationships: action.relationships }),
      };
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
    case "SET_SPEAKING_USERS": {
      const prev = state.speakingUsers;
      const next = action.speakingUsers;
      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(next);
      if (prevKeys.length === nextKeys.length && prevKeys.every(k => prev[k] === next[k])) {
        return state;
      }
      return { ...state, speakingUsers: next };
    }
    case "SET_NOTIFICATIONS": {
      const counts = computeMentionCounts(action.notifications);
      return { ...state, notifications: action.notifications, unreadNotificationCount: action.unreadCount, ...counts };
    }
    case "ADD_NOTIFICATION": {
      const nextNotifs = [action.notification, ...state.notifications];
      const counts = computeMentionCounts(nextNotifs);
      return {
        ...state,
        notifications: nextNotifs,
        unreadNotificationCount: state.unreadNotificationCount + 1,
        ...counts,
      };
    }
    case "MARK_NOTIFICATIONS_READ": {
      let nextNotifs: Notification[];
      let newUnread: number;
      if (action.all) {
        nextNotifs = state.notifications.map((n) => ({ ...n, is_read: true }));
        newUnread = 0;
      } else {
        const readSet = new Set(action.ids);
        newUnread = state.unreadNotificationCount;
        nextNotifs = state.notifications.map((n) => {
          if (readSet.has(n.id) && !n.is_read) {
            newUnread--;
            return { ...n, is_read: true };
          }
          return n;
        });
      }
      const counts = computeMentionCounts(nextNotifs);
      return { ...state, notifications: nextNotifs, unreadNotificationCount: Math.max(0, newUnread), ...counts };
    }
    case "CLEAR_NOTIFICATIONS": {
      return {
        ...state,
        notifications: [],
        unreadNotificationCount: 0,
        serverMentionCounts: {},
        channelMentionCounts: {}
      };
    }

    case "SET_SCROLL_POSITION": {
      return {
        ...state,
        scrollPositions: {
          ...state.scrollPositions,
          [action.channelId]: action.messageId
        }
      };
    }

    case "SET_JUMP_ANCHOR": {
      return {
        ...state,
        jumpAnchors: {
          ...state.jumpAnchors,
          [action.channelId]: action.messageId
        }
      };
    }

    case "CLEAR_JUMP_ANCHOR": {
      const { [action.channelId]: _, ...rest } = state.jumpAnchors;
      return {
        ...state,
        jumpAnchors: rest
      };
    }

    default:
      return state;
  }
}
