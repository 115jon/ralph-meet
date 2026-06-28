import type { MediaContentFilter } from "@/lib/media-content-filter";

export interface SensitiveAttachmentLike {
  content_type?: string | null;
  is_nsfw?: boolean | null;
}

export function isVisualSensitiveAttachment(attachment: SensitiveAttachmentLike): boolean {
  const contentType = attachment.content_type ?? "";
  return !!attachment.is_nsfw && (
    contentType.startsWith("image/") ||
    contentType.startsWith("video/")
  );
}

export function shouldBlurSensitiveAttachment(
  attachment: SensitiveAttachmentLike,
  contentFilter: MediaContentFilter
): boolean {
  return contentFilter === "high" && isVisualSensitiveAttachment(attachment);
}
