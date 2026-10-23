import { defaultFilter } from "cmdk";

/**
 * Quick switcher prefixes, as in Discord: `@` people, `#` text channels,
 * `!` voice channels, `*` servers. Every item's cmdk value starts with its
 * kind tag so a prefix narrows the list to one kind.
 */
export type CommandKind = "dm" | "channel" | "voice" | "server" | "action";

const PREFIXES: Record<string, CommandKind> = {
  "@": "dm",
  "#": "channel",
  "!": "voice",
  "*": "server",
};

export function parseCommandSearch(search: string): {
  kind: CommandKind | null;
  query: string;
} {
  const trimmed = search.trimStart();
  const kind = PREFIXES[trimmed.charAt(0)] ?? null;
  return {
    kind,
    query: (kind ? trimmed.slice(1) : trimmed).trim(),
  };
}

export function commandValue(kind: CommandKind, ...parts: string[]): string {
  return [kind, ...parts.filter(Boolean)].join(" ");
}

/** The hand-off to message search always sits below the real matches. */
export const SEARCH_MESSAGES_VALUE = "action search-messages";

export function commandFilter(
  value: string,
  search: string,
  keywords?: string[],
): number {
  if (value.startsWith(SEARCH_MESSAGES_VALUE)) return 0.0001;
  const { kind, query } = parseCommandSearch(search);
  if (kind && !value.startsWith(`${kind} `)) return 0;
  if (!query) return 1;
  const text = value.slice(value.indexOf(" ") + 1);
  return defaultFilter(text, query, keywords);
}
