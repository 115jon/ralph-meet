import { buildCustomEmojiToken } from "@/lib/emoji";

const CUSTOM_EMOJI_PLACEHOLDER_START = 0xe000;
const CUSTOM_EMOJI_PLACEHOLDER_END = 0xf8ff;

export interface ComposerCustomEmoji {
  id: string;
  shortcode: string;
}

export type ComposerCustomEmojiMap = Record<string, ComposerCustomEmoji>;

export function replaceTextRange(
  value: string,
  replacement: string,
  start: number,
  end: number,
): { value: string; cursor: number } {
  const safeStart = Math.max(0, Math.min(start, value.length));
  const safeEnd = Math.max(safeStart, Math.min(end, value.length));
  const nextValue = `${value.slice(0, safeStart)}${replacement}${value.slice(safeEnd)}`;

  return {
    value: nextValue,
    cursor: safeStart + replacement.length,
  };
}

export function isComposerCustomEmojiPlaceholder(char: string): boolean {
  if (!char) return false;

  const codePoint = char.charCodeAt(0);
  return codePoint >= CUSTOM_EMOJI_PLACEHOLDER_START && codePoint <= CUSTOM_EMOJI_PLACEHOLDER_END;
}

export function allocateComposerCustomEmojiPlaceholder(
  value: string,
  composerCustomEmojiMap: ComposerCustomEmojiMap,
): string {
  const reservedPlaceholders = new Set([
    ...Object.keys(composerCustomEmojiMap),
    ...Array.from(value).filter((char) => isComposerCustomEmojiPlaceholder(char)),
  ]);

  for (let codePoint = CUSTOM_EMOJI_PLACEHOLDER_START; codePoint <= CUSTOM_EMOJI_PLACEHOLDER_END; codePoint += 1) {
    const placeholder = String.fromCharCode(codePoint);
    if (!reservedPlaceholders.has(placeholder)) {
      return placeholder;
    }
  }

  throw new Error("Composer emoji placeholder pool exhausted");
}

export function pruneComposerCustomEmojiMap(
  value: string,
  composerCustomEmojiMap: ComposerCustomEmojiMap,
): ComposerCustomEmojiMap {
  return Object.fromEntries(
    Object.entries(composerCustomEmojiMap).filter(([placeholder]) => value.includes(placeholder)),
  );
}

export function expandComposerCustomEmojiPlaceholders(
  value: string,
  composerCustomEmojiMap: ComposerCustomEmojiMap,
): string {
  if (!value) return value;

  let expandedValue = "";

  for (const char of value) {
    const customEmoji = composerCustomEmojiMap[char];
    if (customEmoji) {
      expandedValue += buildCustomEmojiToken(customEmoji.shortcode, customEmoji.id);
    } else {
      expandedValue += char;
    }
  }

  return expandedValue;
}
