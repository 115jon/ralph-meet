import { readIsSpeaking, subscribeSpeaking } from "@/stores/speaking-source";
import { useSyncExternalStore } from "react";

/**
 * Whether one user is speaking right now. Reads a boolean from the global
 * speaking set, so only the leaf that calls it re-renders when that user's
 * flag flips (never the sidebar or the grid around it). Pass null for "no
 * user" (always false). It asks speaking-source, not the chat store, so a page
 * that only draws avatars does not load the store.
 */
export function useIsSpeaking(userId: string | null | undefined): boolean {
  return useSyncExternalStore(
    subscribeSpeaking,
    () => readIsSpeaking(userId),
    () => false,
  );
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
