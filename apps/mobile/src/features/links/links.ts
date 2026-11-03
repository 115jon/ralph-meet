import { router } from "expo-router";
import { Linking } from "react-native";

import { goToConversation } from "@/features/conversation/navigation";
import { config } from "@/lib/config";

import {
  inviteLink as buildInviteLink,
  messageLink as buildMessageLink,
  parseAppLink,
  type AppLink,
} from "./parse";

const ORIGINS = {
  web: config.webUrl,
  scheme: config.scheme,
};

/** What `url` points at in Ralph, or null for any other link. */
export function readAppLink(url: string): AppLink | null {
  return parseAppLink(url, ORIGINS);
}

/** Opens a parsed Ralph link: the invite screen, or the conversation at the message. */
export function openAppLink(link: AppLink): void {
  if (link.kind === "invite") {
    router.push({ pathname: "/invite/[code]", params: { code: link.code } });
    return;
  }
  goToConversation(
    { kind: link.conversation, id: link.channelId },
    link.messageId,
  );
}

/**
 * A link tapped in a message: Ralph's own invite and message links open in
 * the app (no round trip through the browser), anything else as usual.
 */
export function openLink(url: string): void {
  const link = readAppLink(url);
  if (link) {
    openAppLink(link);
    return;
  }
  Linking.openURL(url).catch(() => undefined);
}

/** The web's link to a message, as the web's own "Copy link" makes it. */
export function messageLink(
  serverId: string | null,
  channelId: string,
  messageId: string,
): string {
  return buildMessageLink(config.webUrl, serverId, channelId, messageId);
}

export function inviteLink(code: string): string {
  return buildInviteLink(config.webUrl, code);
}
