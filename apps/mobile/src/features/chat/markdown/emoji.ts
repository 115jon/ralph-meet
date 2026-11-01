import emojiData from "@emoji-mart/data";
import type { EmojiMartData } from "@emoji-mart/data";

/** The web's shortcode normaliser (src/lib/emoji.ts). */
function sanitize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_+-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

let index: Map<string, string> | null = null;

/**
 * shortcode → native emoji, built once on first use from the same
 * @emoji-mart/data set the web indexes: every alias and the id, first
 * category wins, default skin.
 */
function buildIndex(): Map<string, string> {
  const data = emojiData as EmojiMartData;
  const aliasesById = new Map<string, string[]>();
  for (const [alias, id] of Object.entries(data.aliases ?? {})) {
    const list = aliasesById.get(id) ?? [];
    list.push(alias);
    aliasesById.set(id, list);
  }
  const map = new Map<string, string>();
  for (const category of data.categories) {
    for (const id of category.emojis) {
      const native = data.emojis[id]?.skins[0]?.native;
      if (!native) continue;
      for (const name of [...(aliasesById.get(id) ?? []), id]) {
        const key = sanitize(name);
        if (key && !map.has(key)) map.set(key, native);
      }
    }
  }
  return map;
}

/** The Unicode emoji `shortcode` (without colons) names, if any. */
export function resolveShortcode(shortcode: string): string | null {
  const key = sanitize(shortcode);
  if (!key) return null;
  index ??= buildIndex();
  return index.get(key) ?? null;
}
