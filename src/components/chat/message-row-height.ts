import { isPlayableVideo } from "@/lib/media";
import type { Message } from "@/lib/types";

const HEADER_ROW_PX = 64;
const COMPACT_ROW_PX = 28;
const LINE_PX = 19;
const CHARS_PER_LINE = 72;
const SEPARATOR_PX = 28;
const REPLY_PX = 32;
const REACTION_PX = 40;
const FILE_PX = 58;
const VIDEO_PX = 220;
const EMBED_PX = 200;
const SINGLE_IMAGE_PX = 240;
const MULTI_IMAGE_HEIGHTS = [0, 240, 300, 350, 400, 420] as const;
export const DEFAULT_MESSAGE_ITEM_SIZE = 64;

const heightCache = new Map<string, number>();

export function getCachedMessageRowHeight(
  messageId: string,
): number | undefined {
  return heightCache.get(messageId);
}

export function setCachedMessageRowHeight(messageId: string, height: number) {
  if (height <= 0) return;
  heightCache.set(messageId, height);
}

export function estimateMessageRowHeight(
  message: Message,
  showHeader: boolean,
  showSeparator: boolean,
): number {
  const content = message.content?.trim() ?? "";
  const extraLines = Math.max(
    0,
    Math.ceil(content.length / CHARS_PER_LINE) - 1,
  );
  let height =
    (showHeader ? HEADER_ROW_PX : COMPACT_ROW_PX) + extraLines * LINE_PX;
  if (showSeparator) height += SEPARATOR_PX;
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

export function getMessageRowMinHeight(
  message: Message,
  showHeader: boolean,
  showSeparator: boolean,
): number {
  return (
    getCachedMessageRowHeight(message.id) ??
    estimateMessageRowHeight(message, showHeader, showSeparator)
  );
}
