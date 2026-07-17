import { getListenTogetherInputMode } from "@/lib/listen-together";

export const LISTEN_TOGETHER_PANE_RATIO_KEY =
  "listen-together:workspace-pane-ratio:v1";
export const LISTEN_TOGETHER_QUERY_HISTORY_KEY =
  "listen-together:query-history:v1";
export const LISTEN_TOGETHER_QUERY_HISTORY_LIMIT = 10;
export const LISTEN_TOGETHER_DEFAULT_PANE_RATIO = 0.38;
export const LISTEN_TOGETHER_MIN_PANE_RATIO = 0.28;
export const LISTEN_TOGETHER_MAX_PANE_RATIO = 0.52;

export function clampListenTogetherPaneRatio(value: number): number {
  if (!Number.isFinite(value)) return LISTEN_TOGETHER_MIN_PANE_RATIO;
  return Math.min(
    LISTEN_TOGETHER_MAX_PANE_RATIO,
    Math.max(LISTEN_TOGETHER_MIN_PANE_RATIO, value),
  );
}

export function addListenTogetherQueryHistory(
  history: string[],
  input: string,
): string[] {
  const query = input.trim();
  if (!query || getListenTogetherInputMode(query) !== "search") {
    return history.slice(0, LISTEN_TOGETHER_QUERY_HISTORY_LIMIT);
  }

  const withoutDuplicate = history.filter(
    (item) => item.trim().toLocaleLowerCase() !== query.toLocaleLowerCase(),
  );
  return [query, ...withoutDuplicate].slice(
    0,
    LISTEN_TOGETHER_QUERY_HISTORY_LIMIT,
  );
}

export function readListenTogetherQueryHistory(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(LISTEN_TOGETHER_QUERY_HISTORY_KEY) ?? "[]",
    );
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, LISTEN_TOGETHER_QUERY_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

export function writeListenTogetherQueryHistory(history: string[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      LISTEN_TOGETHER_QUERY_HISTORY_KEY,
      JSON.stringify(history.slice(0, LISTEN_TOGETHER_QUERY_HISTORY_LIMIT)),
    );
  } catch {
    // Storage can be unavailable in private or restricted browsing contexts.
  }
}

export function readListenTogetherPaneRatio(): number {
  if (typeof window === "undefined") return LISTEN_TOGETHER_DEFAULT_PANE_RATIO;
  try {
    const storedValue = window.localStorage.getItem(
      LISTEN_TOGETHER_PANE_RATIO_KEY,
    );
    if (storedValue === null) return LISTEN_TOGETHER_DEFAULT_PANE_RATIO;
    const value = Number(storedValue);
    return Number.isFinite(value)
      ? clampListenTogetherPaneRatio(value)
      : LISTEN_TOGETHER_DEFAULT_PANE_RATIO;
  } catch {
    return LISTEN_TOGETHER_DEFAULT_PANE_RATIO;
  }
}

export function writeListenTogetherPaneRatio(value: number) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      LISTEN_TOGETHER_PANE_RATIO_KEY,
      String(clampListenTogetherPaneRatio(value)),
    );
  } catch {
    // Storage can be unavailable in private or restricted browsing contexts.
  }
}
