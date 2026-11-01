import type { CallRecord } from "@ralph/protocol";

import type { ChatMessage } from "./store";
import { dayKey, formatDay, parseTimestamp } from "./time";

/** Follow-ups from one author within this window share the first's header. */
const GROUP_WINDOW_MS = 7 * 60_000;

export const UNREAD_KEY = "new-messages";

export type ChatRow =
  | {
      readonly kind: "message";
      readonly key: string;
      readonly message: ChatMessage;
      readonly sentAt: Date;
      /** Same author as the message above it, so no avatar or name. */
      readonly grouped: boolean;
    }
  | {
      /** A DM call record: a system row, never grouped with messages. */
      readonly kind: "call";
      readonly key: string;
      readonly message: ChatMessage;
      readonly call: CallRecord;
      readonly sentAt: Date;
    }
  | { readonly kind: "day"; readonly key: string; readonly label: string }
  | { readonly kind: "unread"; readonly key: string };

export interface UnreadMark {
  /** When the user last read the conversation, as the server stores it. */
  readonly readAt: string | undefined;
  /** Their own messages never count as new. */
  readonly myId: string | undefined;
}

/**
 * The index (newest first) of the oldest message after `readAt`, when
 * someone else wrote at least one of the messages from there on.
 */
function firstUnreadIndex(
  messages: readonly ChatMessage[],
  dates: readonly Date[],
  { readAt, myId }: UnreadMark,
): number {
  if (!readAt) return -1;
  const since = parseTimestamp(readAt).getTime();
  if (Number.isNaN(since)) return -1;
  let oldest = -1;
  let fromOthers = false;
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    const at = dates[i];
    if (!message || !at || at.getTime() <= since) break;
    if (message.send) continue;
    oldest = i;
    if (message.author_id !== myId) fromOthers = true;
  }
  return fromOthers ? oldest : -1;
}

/**
 * Rows for an inverted list from messages newest first: each message, a
 * day divider after the oldest message of each day (so it draws above it),
 * and the "new messages" line above the first message after `unread.readAt`.
 */
export function buildRows(
  messages: readonly ChatMessage[],
  unread?: UnreadMark,
): ChatRow[] {
  const rows: ChatRow[] = [];
  const dates = messages.map((message) => parseTimestamp(message.created_at));
  const firstUnread = unread ? firstUnreadIndex(messages, dates, unread) : -1;
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    const sentAt = dates[i];
    if (!message || !sentAt) continue;
    const older = messages[i + 1];
    const olderAt = dates[i + 1];
    const sameDay = olderAt !== undefined && dayKey(olderAt) === dayKey(sentAt);
    const grouped =
      i !== firstUnread &&
      !message.reply_to_id &&
      older !== undefined &&
      olderAt !== undefined &&
      sameDay &&
      older.author_id === message.author_id &&
      !older.call &&
      sentAt.getTime() - olderAt.getTime() < GROUP_WINDOW_MS;
    if (message.call) {
      rows.push({
        kind: "call",
        key: message.id,
        message,
        call: message.call,
        sentAt,
      });
    } else {
      rows.push({ kind: "message", key: message.id, message, sentAt, grouped });
    }
    if (i === firstUnread) rows.push({ kind: "unread", key: UNREAD_KEY });
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
