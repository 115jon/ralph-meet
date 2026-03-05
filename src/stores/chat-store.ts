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

// ── Migration Adapters ──────────────────────────────────────────────────────
// Temporary backward-compatible hooks that map the old Context API to Zustand

export function useChatState(): ChatState {
  return useChatStore();
}

export function useOptionalChatState(): ChatState | null {
  return useChatStore();
}

export function useChatActions() {
  const store = useChatStore();

  // Memoize the returned actions object so its reference is stable across renders.
  // This prevents infinite loops in components that use these actions in useEffect dependencies.
  return useMemo(() => ({
    dispatch: store.dispatch,
    ...store.actions,
    ...store.gateway,
    setProfileUser: (user: User | null) => store.dispatch({ type: "SET_PROFILE_USER", user }),
    setSpeakingUsers: (speakingUsers: Record<string, boolean>) => store.dispatch({ type: "SET_SPEAKING_USERS", speakingUsers }),
  }), [store]);
}
