import type { ChatMessage } from "./store";
import { dayKey, formatDay, parseTimestamp } from "./time";

/** Follow-ups from one author within this window share the first's header. */
const GROUP_WINDOW_MS = 7 * 60_000;

export type ChatRow =
  | {
      readonly kind: "message";
      readonly key: string;
      readonly message: ChatMessage;
      readonly sentAt: Date;
      /** Same author as the message above it, so no avatar or name. */
      readonly grouped: boolean;
    }
  | { readonly kind: "day"; readonly key: string; readonly label: string };

/**
 * Rows for an inverted list from messages newest first: each message, and a
 * day divider after the oldest message of each day (so it draws above it).
 */
export function buildRows(messages: readonly ChatMessage[]): ChatRow[] {
  const rows: ChatRow[] = [];
  const dates = messages.map((message) => parseTimestamp(message.created_at));
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    const sentAt = dates[i];
    if (!message || !sentAt) continue;
    const older = messages[i + 1];
    const olderAt = dates[i + 1];
    const sameDay = olderAt !== undefined && dayKey(olderAt) === dayKey(sentAt);
    const grouped =
      !message.reply_to_id &&
      older !== undefined &&
      olderAt !== undefined &&
      sameDay &&
      older.author_id === message.author_id &&
      sentAt.getTime() - olderAt.getTime() < GROUP_WINDOW_MS;
    rows.push({ kind: "message", key: message.id, message, sentAt, grouped });
    if (!sameDay) {
      rows.push({
        kind: "day",
        key: `day-${dayKey(sentAt)}`,
        label: formatDay(sentAt),
      });
    }
  }
  return rows;
}
