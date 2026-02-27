"use client";

import { useChatRestActions } from "@/lib/chat-actions";
import { useGateway } from "@/lib/chat-gateway";
import {
  chatReducer,
  initialState,
  type ChatAction,
  type ChatState,
  type VoiceChannelMember,
} from "@/lib/chat-reducer";
import type {
  Attachment,
  Category,
  Channel,
  Message,
  Server,
  User
} from "@/lib/types";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";

// ── Re-exports (backward compatibility — no consumer import changes) ────────

export type { ChatAction, ChatState, VoiceChannelMember };

// ── Contexts ────────────────────────────────────────────────────────────────

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
  loadNotifications: () => Promise<void>;
  markNotificationsRead: (ids?: string[]) => Promise<void>;
  clearNotifications: () => Promise<void>;
}

const ChatActionsContext = createContext<ChatActions | null>(null);

// ── Provider ────────────────────────────────────────────────────────────────

export function ChatProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(chatReducer, initialState);
  const stateRef = useRef(state);
  stateRef.current = state;

  // REST actions (must be created first since gateway needs loadChannels & loadDmChannels)
  const rest = useChatRestActions(dispatch, stateRef);

  // Gateway (WebSocket lifecycle, dispatch routing, channel subscribe/unsubscribe, voice ops)
  const gateway = useGateway(dispatch, stateRef, rest.loadChannels, rest.loadDmChannels);

  // Simple dispatch wrappers
  const setProfileUser = useCallback((user: User | null) => {
    dispatch({ type: "SET_PROFILE_USER", user });
  }, []);

  const setSpeakingUsers = useCallback((speakingUsers: Record<string, boolean>) => {
    dispatch({ type: "SET_SPEAKING_USERS", speakingUsers });
  }, []);

  const actions: ChatActions = useMemo(() => ({
    dispatch,
    // REST actions
    sendMessage: rest.sendMessage,
    sendTyping: rest.sendTyping,
    addReaction: rest.addReaction,
    removeReaction: rest.removeReaction,
    deleteMessage: rest.deleteMessage,
    editMessage: rest.editMessage,
    loadMessages: rest.loadMessages,
    loadServers: rest.loadServers,
    loadChannels: rest.loadChannels,
    loadMembers: rest.loadMembers,
    createServer: rest.createServer,
    createChannel: rest.createChannel,
    deleteChannel: rest.deleteChannel,
    createCategory: rest.createCategory,
    deleteCategory: rest.deleteCategory,
    updateStatus: rest.updateStatus,
    loadProfile: rest.loadProfile,
    loadReadStates: rest.loadReadStates,
    markChannelRead: rest.markChannelRead,
    pinMessage: rest.pinMessage,
    unpinMessage: rest.unpinMessage,
    loadPins: rest.loadPins,
    loadDmChannels: rest.loadDmChannels,
    loadRelationships: rest.loadRelationships,
    openDm: rest.openDm,
    loadNotifications: rest.loadNotifications,
    markNotificationsRead: rest.markNotificationsRead,
    clearNotifications: rest.clearNotifications,
    // Gateway actions
    subscribeChannel: gateway.subscribeChannel,
    unsubscribeChannel: gateway.unsubscribeChannel,
    sendVoiceChannelJoin: gateway.sendVoiceChannelJoin,
    sendVoiceChannelLeave: gateway.sendVoiceChannelLeave,
    sendVoiceStateUpdate: gateway.sendVoiceStateUpdate,
    // Local dispatch wrappers
    setProfileUser,
    setSpeakingUsers,
  }), [
    rest.sendMessage,
    rest.sendTyping,
    rest.addReaction,
    rest.removeReaction,
    rest.deleteMessage,
    rest.editMessage,
    rest.loadMessages,
    rest.loadServers,
    rest.loadChannels,
    rest.loadMembers,
    rest.createServer,
    rest.createChannel,
    rest.deleteChannel,
    rest.createCategory,
    rest.deleteCategory,
    rest.updateStatus,
    rest.loadProfile,
    rest.loadReadStates,
    rest.markChannelRead,
    rest.pinMessage,
    rest.unpinMessage,
    rest.loadPins,
    rest.loadDmChannels,
    rest.loadRelationships,
    rest.openDm,
    rest.loadNotifications,
    rest.markNotificationsRead,
    rest.clearNotifications,
    gateway.subscribeChannel,
    gateway.unsubscribeChannel,
    gateway.sendVoiceChannelJoin,
    gateway.sendVoiceChannelLeave,
    gateway.sendVoiceStateUpdate,
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
