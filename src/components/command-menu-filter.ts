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

// ── Recent places ─────────────────────────────────────────────────────────
// The idle switcher leads with where you were last. A small list in
// localStorage, newest first; DMs use the "@me" server id.

export type RecentTarget = { serverId: string; channelId: string };

const RECENT_KEY = "rm:quick-switcher:recent";
/** One more than the menu shows, so the current place can be dropped. */
const RECENT_KEEP = 6;
export const RECENT_SHOWN = 5;

function isTarget(value: unknown): value is RecentTarget {
  const v = value as Partial<RecentTarget> | null;
  return (
    !!v && typeof v.serverId === "string" && typeof v.channelId === "string"
  );
}

export function loadRecentTargets(): RecentTarget[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter(isTarget).slice(0, RECENT_KEEP)
      : [];
  } catch {
    return [];
  }
}

/** `target` first, without duplicates, capped. Pure. */
export function pushRecentTarget(
  list: readonly RecentTarget[],
  target: RecentTarget,
): RecentTarget[] {
  return [
    target,
    ...list.filter((t) => t.channelId !== target.channelId),
  ].slice(0, RECENT_KEEP);
}

/** Records a visit (called when the active channel changes). */
export function recordRecentTarget(target: RecentTarget): void {
  try {
    const next = pushRecentTarget(loadRecentTargets(), target);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Storage full or blocked: the switcher just has no Recent group.
  }
}
