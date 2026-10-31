import {
  chatReducer,
  initialState,
  type ChatAction,
  type ChatState,
} from "@/lib/chat-reducer";
import {
  orElseWith,
  readMap,
  readObject,
  readString,
} from "@/lib/persisted-guard";
import type { User } from "@/lib/types";
import { useMemo } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createChatActions, type ChatRestActions } from "./chat-actions";
import { createChatGateway, type ChatGatewayActions } from "./chat-gateway";
import { markChatStoreLoaded } from "./chat-store-loaded";
import { registerSpeakingSource } from "./speaking-source";

export type {
  ChatAction,
  ChatState,
  VoiceChannelMember,
} from "@/lib/chat-reducer";
export interface ChatStore extends ChatState {
  dispatch: (action: ChatAction) => void;
  actions: ChatRestActions;
  gateway: ChatGatewayActions;
}

/**
 * What localStorage may hold: the per-channel scroll and jump positions, as
 * message ids. Anything else (including `activeServerId` and
 * `activeChannelId`, which older versions persisted) is dropped.
 */
const readPersistedChatState = readObject<
  Pick<ChatState, "scrollPositions" | "jumpAnchors">
>({
  scrollPositions: orElseWith(readMap(readString), () => ({})),
  jumpAnchors: orElseWith(readMap(readString), () => ({})),
});

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
      name: "rm-chat-store",
      version: 2,
      partialize: (state) => ({
        scrollPositions: state.scrollPositions,
        jumpAnchors: state.jumpAnchors,
      }),
      migrate: (persisted) => readPersistedChatState(persisted) ?? {},
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...readPersistedChatState(persistedState),
      }),
    },
  ),
);

/**
 * Per-user speaking selector: a component subscribed with it re-renders only
 * when that one user's speaking flag flips (see hooks/useIsSpeaking.ts).
 */
export const selectIsSpeaking =
  (userId: string | null | undefined) =>
  (state: Pick<ChatState, "speakingUsers">): boolean =>
    !!userId && state.speakingUsers[userId] === true;

// Pages that never load this store still ask who is speaking (Avatar), and
// the theme bootstrap waits for the store: tell both it is here.
registerSpeakingSource({
  subscribe: (listener) => useChatStore.subscribe(listener),
  isSpeaking: (userId) =>
    useChatStore.getState().speakingUsers[userId] === true,
});
markChatStoreLoaded();

// ── Composed Hooks ──────────────────────────────────────────────────────────
// Provides a stable memoized actions interface combining dispatch, REST actions, and gateway

export function useChatActions() {
  const dispatch = useChatStore((state) => state.dispatch);
  const actions = useChatStore((state) => state.actions);
  const gateway = useChatStore((state) => state.gateway);

  return useMemo(
    () => ({
      dispatch,
      ...actions,
      ...gateway,
      setProfileUser: (user: User | null) =>
        dispatch({ type: "SET_PROFILE_USER", user }),
      setSpeakingUsers: (
        speakingUsers: Record<string, boolean>,
        sourceId: string,
      ) => dispatch({ type: "SET_SPEAKING_USERS", sourceId, speakingUsers }),
      clearSpeakingUsers: (sourceId: string) =>
        dispatch({ type: "CLEAR_SPEAKING_USERS", sourceId }),
    }),
    [dispatch, actions, gateway],
  );
}
