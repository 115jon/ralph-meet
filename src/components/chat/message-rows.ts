import type { Message } from "@/lib/types";
import { localDayKey } from "./message-time";

export interface MessageRow {
  message: Message;
  showHeader: boolean;
  showSeparator: boolean;
  /** Local calendar day of this row (`YYYY-M-D`). */
  dayKey: string | null;
  /** Set when a day divider renders above this row. */
  showDayDivider: boolean;
}

export function buildMessageRows(
  messages: Message[],
  unreadSeparatorId?: string | null,
  leadingDivider = true,
): MessageRow[] {
  let prevDay: string | null = null;
  return messages.map((message, index) => {
    const dayKey = localDayKey(message.created_at);
    // A divider wherever the local day changes, and above the very first
    // message once history is exhausted (not while older pages may still
    // prepend: the divider would hop rows and shift the scroll anchor).
    const showDayDivider =
      dayKey !== null && (index === 0 ? leadingDivider : dayKey !== prevDay);
    prevDay = dayKey;
    let showHeader = true;
    if (index > 0 && !showDayDivider) {
      const prev = messages[index - 1];
      if (prev) {
        const hasSameAuthor = prev.author_id === message.author_id;
        const hasNoReply = !message.reply_to_id;
        if (hasSameAuthor && hasNoReply) {
          const prevTime = new Date(prev.created_at).getTime();
          const curTime = new Date(message.created_at).getTime();
          showHeader = curTime - prevTime > 5 * 60 * 1000;
        }
      }
    }

    const showSeparator = unreadSeparatorId === message.id;

    return {
      message,
      showHeader: showHeader || showSeparator,
      showSeparator,
      dayKey,
      showDayDivider,
    };
  });
}
