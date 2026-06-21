import emojiMartData from "@emoji-mart/data";

export const MAX_AI_EMOJI_PROMPT_LENGTH = 300;
export const MAX_EMOJI_RECENTS = 36;
export const EMOJI_RECENTS_STORAGE_KEY = "chat:emoji:recents:v1";
export const NATIVE_EMOJI_STYLE_VERSION = "16.0.0";
export const NATIVE_EMOJI_STYLE_BASE_URL = `https://cdn.jsdelivr.net/npm/emoji-datasource-twitter@${NATIVE_EMOJI_STYLE_VERSION}/img/twitter/64`;
export const NATIVE_EMOJI_SKIN_TONE_OPTIONS = [
  { tone: 0, label: "Default" },
  { tone: 1, label: "Light" },
  { tone: 2, label: "Medium-Light" },
  { tone: 3, label: "Medium" },
  { tone: 4, label: "Medium-Dark" },
  { tone: 5, label: "Dark" },
] as const;

export type NativeEmojiSkinTone = (typeof NATIVE_EMOJI_SKIN_TONE_OPTIONS)[number]["tone"];

export type GeneratedEmojiStatus = "pending" | "ready" | "failed";

export interface GeneratedEmoji {
  id: string;
  user_id: string;
  shortcode: string;
  prompt: string;
  status: GeneratedEmojiStatus;
  image_url: string | null;
  content_type: string | null;
  size_bytes: number;
  created_at: string;
  updated_at?: string | null;
  error_message?: string | null;
  token: string;
}

export interface GeneratedEmojiListResponse {
  items: GeneratedEmoji[];
}

export interface NativeEmoji {
  id: string;
  native: string;
  unified: string;
  imageUrl: string;
  name: string;
  keywords: string[];
  shortcodes: string[];
  preferredShortcode: string;
  categoryId: string;
  categoryLabel: string;
  searchText: string;
  skins: NativeEmojiSkinVariant[];
  supportsSkinTone: boolean;
}

export interface NativeEmojiCategory {
  id: string;
  label: string;
  iconNative: string;
  iconImageUrl: string;
  iconShortcode: string;
  emojis: NativeEmoji[];
}

export interface NativeEmojiSkinVariant {
  tone: NativeEmojiSkinTone;
  native: string;
  unified: string;
  imageUrl: string;
}

export interface EmojiRecentItem {
  type: "native" | "custom";
  id: string;
  shortcode: string;
  native: string | null;
  imageUrl: string | null;
  insertText: string;
  label: string;
  prompt?: string | null;
}

type EmojiMartSkin = {
  native?: string;
  unified?: string;
};

type EmojiMartEmoji = {
  id: string;
  name?: string;
  keywords?: string[];
  emoticons?: string[];
  skins?: EmojiMartSkin[];
};

type EmojiMartCategory = {
  id: string;
  name?: string;
  emojis?: string[];
};

type EmojiMartPayload = {
  emojis: Record<string, EmojiMartEmoji>;
  categories: EmojiMartCategory[];
  aliases?: Record<string, string>;
};

const martData = emojiMartData as unknown as EmojiMartPayload;
const CUSTOM_EMOJI_TOKEN_REGEX = /^<:([a-z0-9_]+):([a-z0-9-]+)>$/i;
const NATIVE_CATEGORY_META: Record<string, { label: string; iconShortcodes: string[] }> = {
  people: {
    label: "Smileys & People",
    iconShortcodes: ["grinning", "smiley", "joy"],
  },
  nature: {
    label: "Animals & Nature",
    iconShortcodes: ["dog", "evergreen_tree", "monkey_face"],
  },
  foods: {
    label: "Food & Drink",
    iconShortcodes: ["pizza", "coffee", "hamburger"],
  },
  activity: {
    label: "Activities",
    iconShortcodes: ["soccer", "video_game", "trophy"],
  },
  places: {
    label: "Travel & Places",
    iconShortcodes: ["airplane", "earth_americas", "rocket"],
  },
  objects: {
    label: "Objects",
    iconShortcodes: ["bulb", "iphone", "gem"],
  },
  symbols: {
    label: "Symbols",
    iconShortcodes: ["heart", "sparkles", "warning"],
  },
  flags: {
    label: "Flags",
    iconShortcodes: ["checkered_flag", "triangular_flag_on_post", "white_flag"],
  },
};

export function buildNativeEmojiAssetUrl(unified: string): string {
  return `${NATIVE_EMOJI_STYLE_BASE_URL}/${unified.toLowerCase()}.png`;
}

function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/[_-]+/g, " ").trim();
}

function buildAliasMap() {
  const aliasesById = new Map<string, string[]>();

  for (const [alias, canonicalId] of Object.entries(martData.aliases ?? {})) {
    const list = aliasesById.get(canonicalId) ?? [];
    list.push(alias);
    aliasesById.set(canonicalId, list);
  }

  for (const list of aliasesById.values()) {
    list.sort((left, right) => scoreAlias(left) - scoreAlias(right) || left.length - right.length || left.localeCompare(right));
  }

  return aliasesById;
}

function scoreAlias(alias: string): number {
  let score = 0;
  if (alias.includes("+")) score += 4;
  if (/^\d/.test(alias)) score += 3;
  if (alias.includes("_")) score += 1;
  if (alias.length > 18) score += 1;
  return score;
}

function sanitizeShortcodeCandidate(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_+-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeNativeEmojiSkinTone(tone: number | null | undefined): NativeEmojiSkinTone {
  if (tone == null || Number.isNaN(tone)) return 0;
  if (tone <= 0) return 0;
  if (tone >= 5) return 5;
  return Math.round(tone) as NativeEmojiSkinTone;
}

function applyNativeEmojiSkinToneInternal(emoji: NativeEmoji, tone: NativeEmojiSkinTone): NativeEmoji {
  const skin = emoji.skins[Math.min(tone, emoji.skins.length - 1)] ?? emoji.skins[0];
  if (!skin) return emoji;

  return {
    ...emoji,
    native: skin.native,
    unified: skin.unified,
    imageUrl: skin.imageUrl,
  };
}

const aliasesById = buildAliasMap();
const nativeEmojis: NativeEmoji[] = [];
const nativeEmojiById = new Map<string, NativeEmoji>();
const nativeEmojiByValue = new Map<string, NativeEmoji>();
const nativeEmojiByShortcode = new Map<string, NativeEmoji>();
const nativeEmojiCategories: NativeEmojiCategory[] = [];

for (const category of martData.categories ?? []) {
  const categoryItems: NativeEmoji[] = [];

  for (const emojiId of category.emojis ?? []) {
    const source = martData.emojis[emojiId];
    if (!source) continue;

    const skins = (source.skins ?? [])
      .map((skin, index) => {
        if (!skin.native || !skin.unified) return null;

        return {
          tone: Math.min(index, 5) as NativeEmojiSkinTone,
          native: skin.native,
          unified: skin.unified,
          imageUrl: buildNativeEmojiAssetUrl(skin.unified),
        } satisfies NativeEmojiSkinVariant;
      })
      .filter((skin): skin is NativeEmojiSkinVariant => Boolean(skin));
    const defaultSkin = skins[0];
    if (!defaultSkin) continue;

    const aliasCandidates = aliasesById.get(source.id) ?? [];
    const sanitizedAliases = aliasCandidates
      .map(sanitizeShortcodeCandidate)
      .filter(Boolean);
    const sanitizedId = sanitizeShortcodeCandidate(source.id);
    const shortcodes = Array.from(new Set([...sanitizedAliases, sanitizedId].filter(Boolean)));
    if (shortcodes.length === 0) continue;

    const emoji: NativeEmoji = {
      id: source.id,
      native: defaultSkin.native,
      unified: defaultSkin.unified,
      imageUrl: defaultSkin.imageUrl,
      name: source.name ?? source.id,
      keywords: Array.from(new Set([...(source.keywords ?? []), ...(source.emoticons ?? [])].map((entry) => String(entry).trim()).filter(Boolean))),
      shortcodes,
      preferredShortcode: shortcodes[0],
      categoryId: category.id,
      categoryLabel: category.name ?? category.id,
      searchText: normalizeSearchText([
        source.id,
        source.name ?? "",
        ...shortcodes,
        ...(source.keywords ?? []),
        ...(source.emoticons ?? []),
      ].join(" ")),
      skins,
      supportsSkinTone: skins.length > 1,
    };

    nativeEmojis.push(emoji);
    categoryItems.push(emoji);

    if (!nativeEmojiById.has(emoji.id)) {
      nativeEmojiById.set(emoji.id, emoji);
    }

    for (const skin of skins) {
      if (!nativeEmojiByValue.has(skin.native)) {
        nativeEmojiByValue.set(skin.native, {
          ...emoji,
          native: skin.native,
          unified: skin.unified,
          imageUrl: skin.imageUrl,
        });
      }
    }

    for (const shortcode of emoji.shortcodes) {
      if (!nativeEmojiByShortcode.has(shortcode)) {
        nativeEmojiByShortcode.set(shortcode, emoji);
      }
    }
  }

  if (categoryItems.length > 0) {
    const meta = NATIVE_CATEGORY_META[category.id];
    const iconEmoji = meta?.iconShortcodes
      .map((shortcode) => {
        const normalized = sanitizeShortcodeCandidate(shortcode);
        return categoryItems.find((emoji) => emoji.shortcodes.includes(normalized) || emoji.preferredShortcode === normalized) ?? null;
      })
      .find((emoji): emoji is NativeEmoji => Boolean(emoji))
      ?? categoryItems[0];

    nativeEmojiCategories.push({
      id: category.id,
      label: meta?.label ?? category.name ?? category.id,
      iconNative: iconEmoji.native,
      iconImageUrl: iconEmoji.imageUrl,
      iconShortcode: iconEmoji.preferredShortcode,
      emojis: categoryItems,
    });
  }
}

const nativeEmojiPattern = Array.from(new Set(nativeEmojiByValue.keys()))
  .sort((left, right) => right.length - left.length || left.localeCompare(right))
  .map(escapeRegex)
  .join("|");
const nativeEmojiRegex = nativeEmojiPattern ? new RegExp(nativeEmojiPattern, "g") : null;

export function applyNativeEmojiSkinTone(emoji: NativeEmoji, tone: number | null | undefined = 0): NativeEmoji {
  return applyNativeEmojiSkinToneInternal(emoji, normalizeNativeEmojiSkinTone(tone));
}

export function getNativeEmojiCategories(tone: number | null | undefined = 0): NativeEmojiCategory[] {
  return nativeEmojiCategories.map((category) => ({
    ...category,
    emojis: category.emojis.map((emoji) => applyNativeEmojiSkinTone(emoji, tone)),
  }));
}

export function getNativeEmojiById(id: string, tone: number | null | undefined = 0): NativeEmoji | null {
  const emoji = nativeEmojiById.get(id);
  return emoji ? applyNativeEmojiSkinTone(emoji, tone) : null;
}

export function resolveNativeEmojiValue(value: string): NativeEmoji | null {
  return nativeEmojiByValue.get(value) ?? null;
}

export function resolveNativeEmojiShortcode(shortcode: string, tone: number | null | undefined = 0): NativeEmoji | null {
  const normalized = sanitizeShortcodeCandidate(shortcode);
  if (!normalized) return null;
  const emoji = nativeEmojiByShortcode.get(normalized);
  return emoji ? applyNativeEmojiSkinTone(emoji, tone) : null;
}

export type NativeEmojiTextSegment =
  | { type: "text"; value: string }
  | { type: "emoji"; value: string; emoji: NativeEmoji };

export function splitTextByNativeEmoji(text: string): NativeEmojiTextSegment[] {
  if (!text) return [];
  if (!nativeEmojiRegex) return [{ type: "text", value: text }];

  nativeEmojiRegex.lastIndex = 0;

  const segments: NativeEmojiTextSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = nativeEmojiRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: "text", value: text.slice(lastIndex, match.index) });
    }

    const emoji = nativeEmojiByValue.get(match[0]);
    if (emoji) {
      segments.push({ type: "emoji", value: match[0], emoji });
    } else {
      segments.push({ type: "text", value: match[0] });
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ type: "text", value: text.slice(lastIndex) });
  }

  return segments.length > 0 ? segments : [{ type: "text", value: text }];
}

export function searchNativeEmojis(query: string, limit = 120, tone: number | null | undefined = 0): NativeEmoji[] {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return [];

  const terms = normalizedQuery.split(/\s+/).filter(Boolean);
  const scored = nativeEmojis
    .map((emoji) => {
      let score = 0;

      for (const term of terms) {
        if (emoji.preferredShortcode === term) score += 120;
        else if (emoji.shortcodes.some((shortcode) => shortcode.startsWith(term))) score += 60;
        else if (emoji.shortcodes.includes(term)) score += 45;
        else if (emoji.name.toLowerCase().startsWith(term)) score += 30;
        else if (emoji.searchText.includes(term)) score += 10;
      }

      return { emoji, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.emoji.name.localeCompare(right.emoji.name));

  return scored.slice(0, limit).map((entry) => applyNativeEmojiSkinTone(entry.emoji, tone));
}

export function sanitizeGeneratedEmojiShortcode(value: string, maxLength = 32): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  return (normalized || "emoji").slice(0, maxLength).replace(/^_+|_+$/g, "") || "emoji";
}

export function buildGeneratedEmojiShortcode(prompt: string): string {
  return sanitizeGeneratedEmojiShortcode(prompt, 32);
}

export function buildCustomEmojiToken(shortcode: string, id: string): string {
  return `<:${sanitizeGeneratedEmojiShortcode(shortcode, 32)}:${id}>`;
}

export function buildGeneratedEmojiAssetPath(id: string): string {
  return `/api/emojis/assets/${id}`;
}

export function buildGeneratedEmojiStorageKey(userId: string, id: string, contentType: string): string {
  return `emoji-assets/${userId}/${id}.${fileExtensionForEmojiContentType(contentType)}`;
}

export function fileExtensionForEmojiContentType(contentType: string): string {
  switch (contentType.toLowerCase()) {
    case "image/webp":
      return "webp";
    case "image/jpeg":
      return "jpg";
    case "image/gif":
      return "gif";
    default:
      return "png";
  }
}

export function extractCustomEmojiIds(text: string): string[] {
  if (!text.includes("<:")) return [];

  const ids = new Set<string>();
  for (const match of text.matchAll(/<:([a-z0-9_]+):([a-z0-9-]+)>/gi)) {
    if (match[2]) ids.add(match[2]);
  }

  return [...ids];
}

export function parseCustomEmojiToken(value: string): { shortcode: string; id: string } | null {
  const match = CUSTOM_EMOJI_TOKEN_REGEX.exec(value.trim());
  if (!match) return null;

  return {
    shortcode: match[1],
    id: match[2],
  };
}

export function isInsideUrl(text: string, index: number): boolean {
  const before = text.slice(0, index);
  const lastSpace = Math.max(before.lastIndexOf(" "), before.lastIndexOf("\n"), before.lastIndexOf("\t"));
  const tokenStart = lastSpace + 1;
  const token = text.slice(tokenStart).split(/\s/)[0];
  return /^https?:\/\//i.test(token);
}

export function toNativeEmojiRecentItem(emoji: NativeEmoji): EmojiRecentItem {
  return {
    type: "native",
    id: emoji.id,
    shortcode: emoji.preferredShortcode,
    native: emoji.native,
    imageUrl: null,
    insertText: emoji.native,
    label: `:${emoji.preferredShortcode}:`,
  };
}

export function toCustomEmojiRecentItem(emoji: Pick<GeneratedEmoji, "id" | "shortcode" | "prompt" | "image_url" | "token">): EmojiRecentItem {
  return {
    type: "custom",
    id: emoji.id,
    shortcode: emoji.shortcode,
    native: null,
    imageUrl: emoji.image_url,
    insertText: emoji.token,
    label: `:${emoji.shortcode}:`,
    prompt: emoji.prompt,
  };
}

function isEmojiRecentItem(value: unknown): value is EmojiRecentItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<EmojiRecentItem>;
  return (
    (item.type === "native" || item.type === "custom") &&
    typeof item.id === "string" &&
    typeof item.shortcode === "string" &&
    typeof item.insertText === "string" &&
    typeof item.label === "string"
  );
}

export function loadEmojiRecents(): EmojiRecentItem[] {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(EMOJI_RECENTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isEmojiRecentItem).slice(0, MAX_EMOJI_RECENTS);
  } catch {
    return [];
  }
}

export function saveEmojiRecents(items: EmojiRecentItem[]): void {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") return;

  try {
    window.localStorage.setItem(
      EMOJI_RECENTS_STORAGE_KEY,
      JSON.stringify(items.slice(0, MAX_EMOJI_RECENTS)),
    );
  } catch {
    // Non-critical persistence.
  }
}

export function rememberRecentEmoji(item: EmojiRecentItem): EmojiRecentItem[] {
  const current = loadEmojiRecents();
  const next = [
    item,
    ...current.filter((entry) => !(entry.type === item.type && entry.id === item.id)),
  ].slice(0, MAX_EMOJI_RECENTS);

  saveEmojiRecents(next);
  return next;
}
