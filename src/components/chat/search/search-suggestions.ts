/**
 * Builds the autocomplete list for the search field from what the caret is
 * typing (see getAutocompleteContext). Pure, so it is unit tested.
 */

import type { IconName } from "@/components/ui/icon";
import {
  formatLocalDate,
  memberLabel,
  resolveDateValue,
  SEARCH_HAS_VALUES,
  type AutocompleteContext,
  type SearchFilter,
  type SearchFilterKey,
  type SearchHasValue,
} from "@/lib/message-search";

export interface SuggestionMember {
  id: string;
  username: string;
  display_name?: string | null;
  avatar_url?: string | null;
  avatar_display?: unknown;
  roleColor?: string | null;
}

export interface SuggestionChannel {
  id: string;
  name: string;
  channel_type: "text" | "voice" | "dm";
}

export interface RecentSearch {
  text: string;
  filters: SearchFilter[];
}

export type SearchSuggestion =
  | { id: string; kind: "key"; key: SearchFilterKey; hint: string }
  | {
      id: string;
      kind: "user";
      key: "from" | "mentions";
      member: SuggestionMember;
    }
  | { id: string; kind: "channel"; channel: SuggestionChannel }
  | { id: string; kind: "has"; value: SearchHasValue }
  | {
      id: string;
      kind: "date";
      key: "before" | "after" | "during";
      date: string;
      label: string;
    }
  | { id: string; kind: "pinned"; value: boolean }
  | { id: string; kind: "recent"; recent: RecentSearch };

export interface SuggestionGroup {
  id: string;
  heading: string;
  items: SearchSuggestion[];
}

export const FILTER_KEY_META: Record<
  SearchFilterKey,
  { hint: string; icon: IconName; label: string }
> = {
  from: { hint: "user", icon: "account", label: "From a person" },
  mentions: { hint: "user", icon: "mention", label: "Mentions a person" },
  in: { hint: "channel", icon: "textChannel", label: "In a channel" },
  has: {
    hint: "link, embed, file, image, video or sound",
    icon: "paperclip",
    label: "Has an attachment or link",
  },
  before: { hint: "date", icon: "calendar", label: "Before a date" },
  after: { hint: "date", icon: "calendar", label: "After a date" },
  during: { hint: "date", icon: "calendar", label: "On a date" },
  pinned: { hint: "yes or no", icon: "pin", label: "Pinned or not" },
};

export const HAS_META: Record<
  SearchHasValue,
  { icon: IconName; hint: string }
> = {
  link: { icon: "link", hint: "Messages with a link" },
  embed: { icon: "window", hint: "Link previews" },
  file: { icon: "paperclip", hint: "Any attachment" },
  image: { icon: "image", hint: "Images and GIFs" },
  video: { icon: "fileVideo", hint: "Video files" },
  sound: { icon: "fileAudio", hint: "Audio files" },
};

const MAX_ITEMS = 8;

function rankByQuery<T>(
  items: readonly T[],
  query: string,
  fields: (item: T) => Array<string | null | undefined>,
): T[] {
  const q = query
    .trim()
    .toLowerCase()
    .replace(/^[@#"]/, "");
  if (!q) return items.slice(0, MAX_ITEMS);
  const scored: Array<{ item: T; score: number; index: number }> = [];
  items.forEach((item, index) => {
    let best = Infinity;
    for (const field of fields(item)) {
      const v = field?.toLowerCase();
      if (!v) continue;
      if (v.startsWith(q)) best = Math.min(best, 0);
      else if (v.split(/[\s_.-]+/).some((w) => w.startsWith(q)))
        best = Math.min(best, 1);
      else if (v.includes(q)) best = Math.min(best, 2);
    }
    if (best !== Infinity) scored.push({ item, score: best, index });
  });
  scored.sort((a, b) => a.score - b.score || a.index - b.index);
  return scored.slice(0, MAX_ITEMS).map((s) => s.item);
}

function dateSuggestions(
  key: "before" | "after" | "during",
  query: string,
  now: Date,
): SearchSuggestion[] {
  const typed = query.trim() ? resolveDateValue(query, now) : null;
  if (typed) {
    return [
      {
        id: `date:${key}:${typed}`,
        kind: "date",
        key,
        date: typed,
        label: typed,
      },
    ];
  }
  const daysAgo = (n: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() - n);
    return formatLocalDate(d);
  };
  const presets: Array<[string, string]> = [
    ["Today", daysAgo(0)],
    ["Yesterday", daysAgo(1)],
    ["A week ago", daysAgo(7)],
    ["A month ago", daysAgo(30)],
  ];
  const q = query.trim().toLowerCase();
  return presets
    .filter(
      ([label, date]) =>
        !q || label.toLowerCase().startsWith(q) || date.startsWith(q),
    )
    .map(([label, date]) => ({
      id: `date:${key}:${date}`,
      kind: "date" as const,
      key,
      date,
      label,
    }));
}

export function buildSearchSuggestions(
  context: AutocompleteContext | null,
  sources: {
    members: readonly SuggestionMember[];
    channels: readonly SuggestionChannel[];
    now: Date;
    /** DMs have one channel, so `in:` is not offered. */
    allowChannelFilter: boolean;
    recent?: readonly RecentSearch[];
  },
): SuggestionGroup[] {
  if (!context) return [];

  if (context.kind === "key") {
    const keys = (Object.keys(FILTER_KEY_META) as SearchFilterKey[]).filter(
      (key) =>
        (sources.allowChannelFilter || key !== "in") &&
        key.startsWith(context.query),
    );
    const groups: SuggestionGroup[] = [];
    if (keys.length > 0) {
      groups.push({
        id: "keys",
        heading: "Search options",
        items: keys.map((key) => ({
          id: `key:${key}`,
          kind: "key",
          key,
          hint: FILTER_KEY_META[key].hint,
        })),
      });
    }
    if (context.query === "" && sources.recent && sources.recent.length > 0) {
      groups.push({
        id: "recent",
        heading: "Recent searches",
        items: sources.recent.map((recent, i) => ({
          id: `recent:${i}`,
          kind: "recent",
          recent,
        })),
      });
    }
    return groups;
  }

  const { key, query } = context;
  switch (key) {
    case "from":
    case "mentions": {
      const members = rankByQuery(sources.members, query, (m) => [
        m.username,
        m.display_name,
        memberLabel(m),
      ]);
      return members.length
        ? [
            {
              id: "members",
              heading: key === "from" ? "From" : "Mentions",
              items: members.map((member) => ({
                id: `user:${key}:${member.id}`,
                kind: "user",
                key,
                member,
              })),
            },
          ]
        : [];
    }
    case "in": {
      if (!sources.allowChannelFilter) return [];
      const channels = rankByQuery(sources.channels, query, (c) => [c.name]);
      return channels.length
        ? [
            {
              id: "channels",
              heading: "In channel",
              items: channels.map((channel) => ({
                id: `channel:${channel.id}`,
                kind: "channel",
                channel,
              })),
            },
          ]
        : [];
    }
    case "has": {
      const q = query.trim().toLowerCase();
      const values = SEARCH_HAS_VALUES.filter((v) => v.startsWith(q));
      return values.length
        ? [
            {
              id: "has",
              heading: "Message has",
              items: values.map((value) => ({
                id: `has:${value}`,
                kind: "has",
                value,
              })),
            },
          ]
        : [];
    }
    case "pinned": {
      const q = query.trim().toLowerCase();
      const values = ([true, false] as const).filter((v) =>
        (v ? "yes" : "no").startsWith(q),
      );
      return values.length
        ? [
            {
              id: "pinned",
              heading: "Pinned",
              items: values.map((value) => ({
                id: `pinned:${value}`,
                kind: "pinned",
                value,
              })),
            },
          ]
        : [];
    }
    default: {
      const items = dateSuggestions(key, query, sources.now);
      const heading =
        key === "before" ? "Before" : key === "after" ? "After" : "During";
      return items.length ? [{ id: "dates", heading, items }] : [];
    }
  }
}

/** The chip a value suggestion turns into, or null for keys and recents. */
export function suggestionToFilter(
  suggestion: SearchSuggestion,
): SearchFilter | null {
  switch (suggestion.kind) {
    case "user":
      return {
        key: suggestion.key,
        userId: suggestion.member.id,
        label: memberLabel(suggestion.member),
        username: suggestion.member.username,
      };
    case "channel":
      return {
        key: "in",
        channelId: suggestion.channel.id,
        label: suggestion.channel.name,
      };
    case "has":
      return { key: "has", value: suggestion.value };
    case "date":
      return { key: suggestion.key, date: suggestion.date };
    case "pinned":
      return { key: "pinned", value: suggestion.value };
    default:
      return null;
  }
}

export function flattenSuggestions(
  groups: readonly SuggestionGroup[],
): SearchSuggestion[] {
  return groups.flatMap((g) => g.items);
}
