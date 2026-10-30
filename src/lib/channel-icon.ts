import type { IconName } from "@/components/ui/icon";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";

type ChannelLike = {
  name: string;
  channel_type: "text" | "voice" | "dm";
  /** The viewer's resolved permissions in this channel, when known. */
  permissions?: number;
};

const RULES_NAME = /^(?:rules|server-rules|guidelines|code-of-conduct)$/i;
const ANNOUNCEMENT_NAME = /^(?:announcements?|news|updates|changelog)$/i;

/**
 * The glyph for a channel row. Channels have no kind field yet, so
 * announcement and rules channels are recognised by their conventional
 * names, and a text channel the viewer can read but not post in is shown as
 * locked. Replace the name checks once channels carry a real kind.
 */
export function getChannelIcon(channel: ChannelLike): IconName {
  if (channel.channel_type === "voice") return "voiceChannel";
  const name = channel.name.trim();
  if (RULES_NAME.test(name)) return "rules";
  if (ANNOUNCEMENT_NAME.test(name)) return "announcement";
  if (
    channel.permissions != null &&
    !hasPermission(channel.permissions, PERMISSIONS.SEND_MESSAGES)
  ) {
    return "lockedChannel";
  }
  return "textChannel";
}
