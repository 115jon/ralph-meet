import { chatReducer, initialState, type ChatAction, type ChatState } from "@/lib/chat-reducer";
import type { User } from "@/lib/types";
import { useMemo } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createChatActions, type ChatRestActions } from "./chat-actions";
import { createChatGateway, type ChatGatewayActions } from "./chat-gateway";

export type { ChatAction, ChatState, VoiceChannelMember } from "@/lib/chat-reducer";
export interface ChatStore extends ChatState {
  dispatch: (action: ChatAction) => void;
  actions: ChatRestActions;
  gateway: ChatGatewayActions;
}

export const useChatStore = create<ChatStore>()(
  persist(
    (set, get) => {
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
    },
    {
      name: 'rm-chat-store',
      version: 2,
      partialize: (state) => ({
        scrollPositions: state.scrollPositions,
        jumpAnchors: state.jumpAnchors,
      }),
      migrate: (persisted: unknown) => {
        if (!persisted || typeof persisted !== "object") return persisted;

        const state = { ...(persisted as Partial<ChatState>) };
        delete state.activeServerId;
        delete state.activeChannelId;
        return state;
      },
    }
  )
);

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
