import { createContext, use } from "react";

/**
 * Long-press on anything inside a message row (a picture, a GIF, a video, a
 * link card, a link in the text) opens that message's actions, as on the
 * row itself. Those inner pressables take the touch, so they forward it.
 */
export const MessageLongPress = createContext<(() => void) | undefined>(
  undefined,
);

export function useMessageLongPress(): (() => void) | undefined {
  return use(MessageLongPress);
}

/** What the row waits before a press counts as long. */
export const LONG_PRESS_MS = 350;
