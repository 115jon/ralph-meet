import {
  loadEmojiRecents,
  rememberRecentEmoji,
  resolveNativeEmojiShortcode,
  toNativeEmojiRecentItem,
  type EmojiRecentItem,
} from "@/lib/emoji";

const FALLBACK_REACTION_SHORTCODES = [
  "thumbsup",
  "heart",
  "joy",
  "tada",
  "fire",
] as const;

function dedupeRecentItems(items: EmojiRecentItem[]): EmojiRecentItem[] {
  const seen = new Set<string>();
  const next: EmojiRecentItem[] = [];

  for (const item of items) {
    const key = `${item.type}:${item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(item);
  }

  return next;
}

function getFallbackReactionItems(): EmojiRecentItem[] {
  return FALLBACK_REACTION_SHORTCODES
    .map((shortcode) => resolveNativeEmojiShortcode(shortcode))
    .filter((emoji): emoji is NonNullable<typeof emoji> => Boolean(emoji))
    .map((emoji) => toNativeEmojiRecentItem(emoji));
}

export function getQuickReactionItems(limit = 5): EmojiRecentItem[] {
  return dedupeRecentItems([
    ...loadEmojiRecents(),
    ...getFallbackReactionItems(),
  ]).slice(0, limit);
}

export function rememberRecentReaction(item: EmojiRecentItem): EmojiRecentItem[] {
  return rememberRecentEmoji(item);
}
