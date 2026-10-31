import type { Category, Channel } from "./schema";

export type ChannelKind = "text" | "voice";

export interface Branch {
  /** Category id, or "" for channels outside any category. */
  readonly id: string;
  /** Null for the uncategorised branch, which prints no label. */
  readonly label: string | null;
  readonly channels: readonly Channel[];
}

export function channelKind(channel: Channel): ChannelKind | null {
  return channel.channel_type === "text" || channel.channel_type === "voice"
    ? channel.channel_type
    : null;
}

/**
 * The tree as the web sidebar draws it: uncategorised channels first, then
 * categories by rank, channels by position. Empty categories and channel
 * types the app cannot open are left out.
 */
export function buildBranches(
  categories: readonly Category[],
  channels: readonly Channel[],
): Branch[] {
  const byCategory = new Map<string, Channel[]>();
  const loose: Channel[] = [];
  const known = new Set(categories.map((category) => category.id));

  const visible = channels
    .filter((channel) => channelKind(channel) !== null)
    .sort((a, b) => a.position - b.position);
  for (const channel of visible) {
    const categoryId = channel.category_id;
    if (categoryId && known.has(categoryId)) {
      const list = byCategory.get(categoryId) ?? [];
      list.push(channel);
      byCategory.set(categoryId, list);
    } else {
      loose.push(channel);
    }
  }

  const branches: Branch[] = [];
  if (loose.length > 0) branches.push({ id: "", label: null, channels: loose });
  for (const category of [...categories].sort((a, b) => a.rank - b.rank)) {
    const list = byCategory.get(category.id);
    if (list) {
      branches.push({ id: category.id, label: category.name, channels: list });
    }
  }
  return branches;
}
