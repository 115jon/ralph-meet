import type { Reaction } from "@/lib/types";

export function getNextReactionEmoji(
  reactions: Reaction[],
  selectedEmoji: string | null,
): string | null {
  if (reactions.length === 0) return null;
  if (
    selectedEmoji &&
    reactions.some((reaction) => reaction.emoji === selectedEmoji)
  ) {
    return selectedEmoji;
  }
  return reactions[0]?.emoji ?? null;
}
