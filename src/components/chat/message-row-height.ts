import { isPlayableVideo } from "@/lib/media";
import type { Message } from "@/lib/types";

// Talk Tree row metrics (talk-tree-spec §8): 16px group gap, 20px author
// line, 15/22 body, 2px row padding, 72ch measure.
const HEADER_ROW_PX = 62;
const COMPACT_ROW_PX = 26;
const LINE_PX = 22;
const CHARS_PER_LINE = 72;
const SEPARATOR_PX = 24;
const DAY_DIVIDER_PX = 32;
const REPLY_PX = 22;
const REACTION_PX = 28;
const FILE_PX = 64;
const VIDEO_PX = 220;
const EMBED_PX = 200;
const SINGLE_IMAGE_PX = 240;
const MULTI_IMAGE_HEIGHTS = [0, 240, 300, 350, 400, 420] as const;
const DEFAULT_MESSAGE_ITEM_SIZE = 62;

export function estimateMessageRowHeight(
  message: Message,
  showHeader: boolean,
  showSeparator: boolean,
  showDayDivider = false,
): number {
  const content = message.content?.trim() ?? "";
  const extraLines = Math.max(
    0,
    Math.ceil(content.length / CHARS_PER_LINE) - 1,
  );
  let height =
    (showHeader ? HEADER_ROW_PX : COMPACT_ROW_PX) + extraLines * LINE_PX;
  if (showSeparator) height += SEPARATOR_PX;
  if (showDayDivider) height += DAY_DIVIDER_PX;
  if (message.reply_to) height += REPLY_PX;

  const attachments = message.attachments ?? [];
  let imageCount = 0;
  let videoCount = 0;
  let fileCount = 0;
  for (const attachment of attachments) {
    if (attachment.content_type?.startsWith("image/")) imageCount += 1;
    else if (isPlayableVideo(attachment.content_type)) videoCount += 1;
    else fileCount += 1;
  }

  if (imageCount === 1) height += SINGLE_IMAGE_PX;
  else if (imageCount > 1) {
    height += MULTI_IMAGE_HEIGHTS[Math.min(imageCount, 5)] ?? 420;
  }
  height += videoCount * VIDEO_PX;
  height += fileCount * FILE_PX;
  height += (message.embeds?.length ?? 0) * EMBED_PX;
  if (message.reactions && message.reactions.length > 0) height += REACTION_PX;
  return height;
}

/**
 * The virtualizer's one size estimate for rows it hasn't measured yet: the
 * mean of the per-row estimates. Rows never get a min-height from it, so a
 * row that renders shorter than its estimate (an embed, a collapsed reply)
 * leaves no gap; the virtualizer measures the real height on mount.
 */
export function estimateListItemSize(
  rows: readonly {
    message: Message;
    showHeader: boolean;
    showSeparator: boolean;
    showDayDivider?: boolean;
  }[],
): number {
  if (rows.length === 0) return DEFAULT_MESSAGE_ITEM_SIZE;
  let total = 0;
  for (const row of rows) {
    total += estimateMessageRowHeight(
      row.message,
      row.showHeader,
      row.showSeparator,
      row.showDayDivider,
    );
  }
  return Math.round(total / rows.length);
}
