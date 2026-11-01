interface MentionTarget {
  readonly content?: string | null;
  readonly author_id: string;
  readonly reply_to?: { readonly author_id?: string | null } | null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const patterns = new Map<string, RegExp>();

/**
 * Whether a message pings the viewer: `@username`, `@everyone`, `@here`, or
 * a reply to one of the viewer's messages. The web's rule
 * (src/components/chat/message-author.ts `mentionsViewer`), on raw content.
 */
export function mentionsViewer(
  message: MentionTarget,
  viewer: { readonly id?: string; readonly username?: string },
): boolean {
  if (!viewer.id || message.author_id === viewer.id) return false;
  if (message.reply_to?.author_id === viewer.id) return true;
  const content = message.content;
  if (!content?.includes("@")) return false;
  const username = viewer.username?.trim();
  const key = username?.toLowerCase() ?? "";
  let pattern = patterns.get(key);
  if (!pattern) {
    const names = ["everyone", "here"];
    if (username) names.push(escapeRegExp(username));
    pattern = new RegExp(`(^|[^\\w@])@(?:${names.join("|")})(?![\\w])`, "i");
    patterns.set(key, pattern);
  }
  return pattern.test(content);
}
