// The recents list, pure so it can be tested away from the device store.

/** The web keeps 36. */
export const MAX_RECENTS = 36;
/** The quick row's fallback, from the mockup. */
export const DEFAULT_REACTIONS: readonly string[] = [
  "🔥",
  "😂",
  "💀",
  "👍",
  "🫡",
];
const QUICK_COUNT = 5;

/** Newest first, one copy each. */
export function withRecent(
  recents: readonly string[],
  value: string,
): readonly string[] {
  return [value, ...recents.filter((entry) => entry !== value)].slice(
    0,
    MAX_RECENTS,
  );
}

/** The five most recent, topped up from the defaults. */
export function quickReactions(recents: readonly string[]): readonly string[] {
  return [...new Set([...recents, ...DEFAULT_REACTIONS])].slice(0, QUICK_COUNT);
}
