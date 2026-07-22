import {
  parseCustomEmojiToken,
  resolveNativeEmojiShortcode,
  resolveNativeEmojiValue,
} from "@/lib/emoji";

export function formatReactionUserNames(
  names: string[],
  totalCount: number,
): string {
  const visibleNames = names
    .map((name) => name.trim())
    .filter(Boolean)
    .slice(0, 3);
  if (visibleNames.length === 0) return "Someone";

  const remainingCount = Math.max(0, totalCount - visibleNames.length);
  if (remainingCount === 0) return visibleNames.join(", ");

  const suffix =
    remainingCount === 1 ? "+1 person more" : `+${remainingCount} people more`;
  return `${visibleNames.join(", ")} ${suffix}`;
}

export function getReactionEmojiLabel(value: string): string {
  const customEmoji = parseCustomEmojiToken(value);
  if (customEmoji) return `:${customEmoji.shortcode}:`;

  const nativeEmoji =
    value.startsWith(":") && value.endsWith(":")
      ? resolveNativeEmojiShortcode(value.slice(1, -1))
      : resolveNativeEmojiValue(value);

  return nativeEmoji ? `:${nativeEmoji.preferredShortcode}:` : value;
}
