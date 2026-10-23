import type { SearchFilter } from "@/lib/message-search";
import type { RecentSearch } from "./search-suggestions";

const MAX_RECENT = 5;
const keyFor = (scopeKey: string) => `rm:search-recent:${scopeKey}`;

function isRecent(value: unknown): value is RecentSearch {
  if (!value || typeof value !== "object") return false;
  const v = value as { text?: unknown; filters?: unknown };
  return typeof v.text === "string" && Array.isArray(v.filters);
}

export function loadRecentSearches(scopeKey: string): RecentSearch[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(keyFor(scopeKey));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter(isRecent).slice(0, MAX_RECENT)
      : [];
  } catch {
    return [];
  }
}

export function recentSearchLabel(recent: RecentSearch): string {
  const chips = recent.filters.map((f: SearchFilter) => {
    switch (f.key) {
      case "from":
      case "mentions":
        return `${f.key}:${f.username}`;
      case "in":
        return `in:${f.label}`;
      case "has":
        return `has:${f.value}`;
      case "pinned":
        return `pinned:${f.value ? "yes" : "no"}`;
      default:
        return `${f.key}:${f.date}`;
    }
  });
  return [...chips, recent.text.trim()].filter(Boolean).join(" ");
}

export function saveRecentSearch(
  scopeKey: string,
  current: readonly RecentSearch[],
  next: RecentSearch,
): RecentSearch[] {
  const label = recentSearchLabel(next);
  if (!label) return [...current];
  const list = [
    next,
    ...current.filter((r) => recentSearchLabel(r) !== label),
  ].slice(0, MAX_RECENT);
  try {
    window.localStorage.setItem(keyFor(scopeKey), JSON.stringify(list));
  } catch {
    // Storage full or blocked: recents are a convenience.
  }
  return list;
}
