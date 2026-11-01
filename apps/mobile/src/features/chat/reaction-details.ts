import { createContext, use } from "react";

import type { ChatMessage } from "./store";

/**
 * Long-press on a reaction chip asks for who reacted with it. ChatView
 * answers with the who-reacted sheet; rows read it from here, like
 * MessageLongPress, so the list does not thread another prop through.
 */
export const ReactionDetails = createContext<
  ((message: ChatMessage, emoji: string) => void) | undefined
>(undefined);

export function useReactionDetails() {
  return use(ReactionDetails);
}
