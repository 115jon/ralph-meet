import { useSyncExternalStore } from "react";

import { isEmojiDataReady, subscribeEmojiData } from "@/lib/emoji";

/**
 * True once the native emoji set is indexed.
 *
 * Always true on the web (the data is bundled, SSR included). On desktop the
 * set loads in its own chunk, so anything that resolves emoji during render
 * (inline text, tokens, labels) calls this to re-render once the index lands.
 * The return value doubles as a memo dependency for derived emoji data.
 */
export function useEmojiDataReady(): boolean {
  return useSyncExternalStore(
    subscribeEmojiData,
    isEmojiDataReady,
    serverSnapshot,
  );
}

function serverSnapshot(): boolean {
  return true;
}
