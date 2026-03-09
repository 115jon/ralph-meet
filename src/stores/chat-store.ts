import { chatReducer, initialState, type ChatAction, type ChatState } from "@/lib/chat-reducer";
import type { User } from "@/lib/types";
import { useMemo } from 'react';
import { create } from 'zustand';
import { createChatActions, type ChatRestActions } from "./chat-actions";
import { createChatGateway, type ChatGatewayActions } from "./chat-gateway";

export type { ChatAction, ChatState, VoiceChannelMember } from "@/lib/chat-reducer";
export interface ChatStore extends ChatState {
  dispatch: (action: ChatAction) => void;
  actions: ChatRestActions;
  gateway: ChatGatewayActions;
}

export const useChatStore = create<ChatStore>()((set, get) => {
  const dispatch = (action: ChatAction) => {
    set((state) => chatReducer(state, action));
  };

  const actions = createChatActions(get, dispatch);
  const gateway = createChatGateway(get, dispatch, actions);

  return {
    ...initialState,
    dispatch,
    actions,
    gateway,
  };
});

// ── Composed Hooks ──────────────────────────────────────────────────────────
// Provides a stable memoized actions interface combining dispatch, REST actions, and gateway

export function useChatActions() {
  const dispatch = useChatStore(state => state.dispatch);
  const actions = useChatStore(state => state.actions);
  const gateway = useChatStore(state => state.gateway);

  return useMemo(() => ({
    dispatch,
    ...actions,
    ...gateway,
    setProfileUser: (user: User | null) => dispatch({ type: "SET_PROFILE_USER", user }),
    setSpeakingUsers: (speakingUsers: Record<string, boolean>) => dispatch({ type: "SET_SPEAKING_USERS", speakingUsers }),
  }), [dispatch, actions, gateway]);
}
