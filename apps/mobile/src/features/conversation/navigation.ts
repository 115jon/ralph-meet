import { router } from "expo-router";

import { openConversation, type Conversation } from "./store";

/**
 * Opens `conversation` from a push or Activity: screens stacked over home
 * (the call, Activity, Settings) close, and home shows it on the chat page.
 */
export function goToConversation(conversation: Conversation): void {
  openConversation(conversation);
  if (router.canDismiss()) router.dismissTo("/home");
}

/**
 * The same from a link route (/channel/[id], /dm/[id]) sitting on the
 * stack: back to the home under it, or, for a cold-start link with nothing
 * under it, home in its place (so back never returns to the link).
 */
export function handOverToHome(conversation: Conversation): void {
  openConversation(conversation);
  if (router.canDismiss()) router.dismissTo("/home");
  else router.replace("/home");
}
