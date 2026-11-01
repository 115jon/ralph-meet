import { router } from "expo-router";

import { requestJump } from "@/features/chat/actions";

import { openConversation, type Conversation } from "./store";

/** Opens the conversation and, given a message, asks the chat to jump to it. */
function open(conversation: Conversation, messageId?: string | null): void {
  openConversation(conversation);
  if (messageId) requestJump(conversation.id, messageId);
}

/**
 * Opens `conversation` from a push or Activity: screens stacked over home
 * (the call, Activity, Settings) close, and home shows it on the chat page,
 * scrolled to `messageId` when given.
 */
export function goToConversation(
  conversation: Conversation,
  messageId?: string | null,
): void {
  open(conversation, messageId);
  if (router.canDismiss()) router.dismissTo("/home");
}

/**
 * The same from a link route (/channel/[id], /dm/[id]) sitting on the
 * stack: back to the home under it, or, for a cold-start link with nothing
 * under it, home in its place (so back never returns to the link).
 */
export function handOverToHome(
  conversation: Conversation,
  messageId?: string | null,
): void {
  open(conversation, messageId);
  if (router.canDismiss()) router.dismissTo("/home");
  else router.replace("/home");
}
