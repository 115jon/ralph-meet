import emojiData from "@emoji-mart/data";
import type { EmojiMartData } from "@emoji-mart/data";

// The Unicode set the picker draws, from the same @emoji-mart/data the
// markdown renderer (../markdown/emoji.ts) and the web index. Built once, on
// the first open, and kept.

/** 0 is the default yellow; 1 to 5 run light to dark (the web's options). */
export type SkinTone = 0 | 1 | 2 | 3 | 4 | 5;
export const SKIN_TONES: readonly SkinTone[] = [0, 1, 2, 3, 4, 5];

export function isSkinTone(value: number): value is SkinTone {
  return Number.isInteger(value) && value >= 0 && value <= 5;
}

export interface NativeEmoji {
  readonly id: string;
  readonly name: string;
  /** One glyph per skin tone, or just the one when it takes none. */
  readonly skins: readonly string[];
  /** Lowercase id, aliases, name and keywords, for search. */
  readonly terms: readonly string[];
}

export interface EmojiCategory {
  readonly id: string;
  readonly label: string;
  readonly emojis: readonly NativeEmoji[];
}

/** The web's category labels (src/lib/emoji.ts). */
const CATEGORY_LABELS: ReadonlyMap<string, string> = new Map([
  ["people", "Smileys & people"],
  ["nature", "Animals & nature"],
  ["foods", "Food & drink"],
  ["activity", "Activities"],
  ["places", "Travel & places"],
  ["objects", "Objects"],
  ["symbols", "Symbols"],
  ["flags", "Flags"],
]);

let categories: readonly EmojiCategory[] | null = null;
let byNative: Map<string, NativeEmoji> | null = null;

function build(): readonly EmojiCategory[] {
  const data = emojiData as EmojiMartData;
  const aliasesById = new Map<string, string[]>();
  for (const [alias, id] of Object.entries(data.aliases ?? {})) {
    const list = aliasesById.get(id) ?? [];
    list.push(alias);
    aliasesById.set(id, list);
  }
  const seen = new Set<string>();
  const built: EmojiCategory[] = [];
  for (const category of data.categories) {
    const emojis: NativeEmoji[] = [];
    for (const id of category.emojis) {
      const entry = data.emojis[id];
      if (!entry || seen.has(id)) continue;
      seen.add(id);
      const skins = entry.skins.map((skin) => skin.native).filter(Boolean);
      if (skins.length === 0) continue;
      emojis.push({
        id,
        name: entry.name,
        skins,
        terms: [
          id,
          ...(aliasesById.get(id) ?? []),
          entry.name,
          ...entry.keywords,
        ].map((term) => term.toLowerCase()),
      });
    }
    built.push({
      id: category.id,
      label: CATEGORY_LABELS.get(category.id) ?? category.id,
      emojis,
    });
  }
  return built;
}

export function emojiCategories(): readonly EmojiCategory[] {
  categories ??= build();
  return categories;
}

/** The glyph in `tone`, or the default when the emoji takes no tones. */
export function glyphFor(emoji: NativeEmoji, tone: SkinTone): string {
  return emoji.skins[tone] ?? emoji.skins[0] ?? "";
}

/** The emoji a glyph (in any tone) belongs to, for its name. */
export function emojiForGlyph(glyph: string): NativeEmoji | null {
  if (!byNative) {
    byNative = new Map();
    for (const category of emojiCategories())
      for (const emoji of category.emojis)
        for (const skin of emoji.skins) byNative.set(skin, emoji);
  }
  return byNative.get(glyph) ?? null;
}

/**
 * The web's ranking (searchNativeEmojis): an exact id, then an id or alias
 * that starts with a term, then the name, then any keyword. Every term must
 * match something.
 */
export function searchEmojis(query: string, limit = 120): NativeEmoji[] {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  const scored: { emoji: NativeEmoji; score: number }[] = [];
  for (const category of emojiCategories()) {
    for (const emoji of category.emojis) {
      let score = 0;
      for (const term of terms) {
        const [id = "", ...rest] = emoji.terms;
        let best = 0;
        if (id === term) best = 120;
        else if (id.startsWith(term)) best = 60;
        else if (emoji.name.toLowerCase().startsWith(term)) best = 30;
        else if (rest.some((t) => t.startsWith(term))) best = 20;
        else if (rest.some((t) => t.includes(term))) best = 10;
        if (best === 0) {
          score = 0;
          break;
        }
        score += best;
      }
      if (score > 0) scored.push({ emoji, score });
    }
  }
  return scored
    .sort(
      (a, b) => b.score - a.score || a.emoji.name.localeCompare(b.emoji.name),
    )
    .slice(0, limit)
    .map((entry) => entry.emoji);
}

// ── Custom emoji ───────────────────────────────────────────────────────────

const CUSTOM_TOKEN = /^<a?:(\w+):([\w-]+)>$/;

/** `<:name:id>`, the token messages and reactions carry for a server emoji. */
export function parseCustomToken(
  value: string,
): { readonly name: string; readonly id: string } | null {
  const match = CUSTOM_TOKEN.exec(value);
  return match?.[1] && match[2] ? { name: match[1], id: match[2] } : null;
}

/** The web's shortcode sanitiser for tokens (buildCustomEmojiToken). */
export function customToken(shortcode: string, id: string): string {
  const name =
    shortcode
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 32)
      .replace(/^_+|_+$/g, "") || "emoji";
  return `<:${name}:${id}>`;
}

/** What a screen reader says for an emoji value: its name, or `:name:`. */
export function emojiLabel(value: string): string {
  const custom = parseCustomToken(value);
  if (custom) return `:${custom.name}:`;
  return emojiForGlyph(value)?.name ?? value;
}
