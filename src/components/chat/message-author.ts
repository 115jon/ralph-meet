import type { ChatMember } from "@/lib/chat-reducer";
import type { Message } from "@/lib/types";

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * Highest-positioned role colour per user, cached per members array so a row
 * selector costs one Map lookup instead of a walk over every member's roles.
 */
const roleColorCache = new WeakMap<ChatMember[], Map<string, string | null>>();

function buildRoleColorMap(members: ChatMember[]): Map<string, string | null> {
  const map = new Map<string, string | null>();
  for (const member of members) {
    let best: { color: string; position: number } | null = null;
    for (const role of member.roles ?? []) {
      const color = role.color?.trim();
      if (!color || !HEX_COLOR.test(color) || /^#0{3}(?:0{3})?$/.test(color)) {
        continue;
      }
      if (!best || role.position > best.position) {
        best = { color, position: role.position };
      }
    }
    map.set(member.user.id, best?.color ?? null);
  }
  return map;
}

export function topRoleColor(
  members: ChatMember[] | undefined,
  userId: string | undefined,
): string | null {
  if (!members || !userId || members.length === 0) return null;
  let map = roleColorCache.get(members);
  if (!map) {
    map = buildRoleColorMap(members);
    roleColorCache.set(members, map);
  }
  return map.get(userId) ?? null;
}

/**
 * Role colour as ink: the role hue mixed toward `--ink-1`, so a yellow or
 * navy role stays readable on the black canvas and on the light one. The
 * colour is server data (validated hex), not a theme literal.
 */
export function roleInk(color: string | null): string | undefined {
  if (!color) return undefined;
  return `color-mix(in oklab, ${color} 72%, var(--ink-1))`;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const mentionPatternCache = new Map<string, RegExp>();

/**
 * Whether a message mentions the viewer: `@username`, `@everyone` or
 * `@here`, or a reply to one of the viewer's own messages (Discord pings
 * replies by default).
 */
export function mentionsViewer(
  message: Pick<Message, "content" | "reply_to" | "author_id">,
  viewer: { id?: string | null; username?: string | null } | null | undefined,
): boolean {
  if (!viewer?.id || message.author_id === viewer.id) return false;
  if (message.reply_to?.author_id === viewer.id) return true;
  const content = message.content;
  if (!content || !content.includes("@")) return false;
  const username = viewer.username?.trim();
  const key = username?.toLowerCase() ?? "";
  let pattern = mentionPatternCache.get(key);
  if (!pattern) {
    const names = ["everyone", "here"];
    if (username) names.push(escapeRegExp(username));
    pattern = new RegExp(`(^|[^\\w@])@(?:${names.join("|")})(?![\\w])`, "i");
    mentionPatternCache.set(key, pattern);
  }
  return pattern.test(content);
}
