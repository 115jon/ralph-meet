import { selectIsSpeaking, useChatStore } from "@/stores/chat-store";

/**
 * Whether one user is speaking right now. Selects a boolean from the global
 * speaking set, so only the leaf that calls it re-renders when that user's
 * flag flips (never the sidebar or the grid around it). Pass null for "no
 * user" (always false).
 */
export function useIsSpeaking(userId: string | null | undefined): boolean {
  return useChatStore(selectIsSpeaking(userId));
}

/**
 * Spread onto the element that carries the speaking state (tree leaf, avatar,
 * tile). CSS does the rest: `.rm-speak` rings and `<Led follow="speaking">`
 * light under `[data-speaking]`.
 *
 *   <TreeLeaf {...useSpeakingAttr(user.id)}>…</TreeLeaf>
 */
export function useSpeakingAttr(userId: string | null | undefined): {
  "data-speaking": "" | undefined;
} {
  return { "data-speaking": useIsSpeaking(userId) ? "" : undefined };
}
