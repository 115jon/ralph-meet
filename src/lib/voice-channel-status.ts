import type { GifPickerItem } from "@/lib/gif-picker";
import type { VoiceChannelStatus, VoiceChannelStatusMedia } from "@/lib/types";

export const MAX_VOICE_CHANNEL_STATUS_TEXT = 120;

const VALID_MEDIA_CONTENT_TYPES = new Set<VoiceChannelStatusMedia["preview_content_type"]>([
  "image/gif",
  "image/apng",
  "image/webp",
  "image/png",
  "image/jpeg",
  "video/mp4",
  "video/webm",
]);

export function normalizeVoiceChannelStatusText(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const collapsed = value.replace(/\s+/g, " ").trim();
  if (!collapsed) return null;

  return collapsed.slice(0, MAX_VOICE_CHANNEL_STATUS_TEXT);
}

export function sanitizeVoiceChannelStatusMedia(value: unknown): VoiceChannelStatusMedia | null {
  if (!value || typeof value !== "object") return null;

  const candidate = value as Record<string, unknown>;
  const previewUrl = typeof candidate.preview_url === "string" ? candidate.preview_url.trim() : "";
  const previewWidth = typeof candidate.preview_width === "number" ? candidate.preview_width : Number(candidate.preview_width);
  const previewHeight = typeof candidate.preview_height === "number" ? candidate.preview_height : Number(candidate.preview_height);
  const previewContentType = candidate.preview_content_type;

  if (
    !previewUrl ||
    !Number.isFinite(previewWidth) ||
    !Number.isFinite(previewHeight) ||
    !VALID_MEDIA_CONTENT_TYPES.has(previewContentType as VoiceChannelStatusMedia["preview_content_type"])
  ) {
    return null;
  }

  return {
    id: typeof candidate.id === "string" && candidate.id.trim() ? candidate.id : crypto.randomUUID(),
    provider: typeof candidate.provider === "string" && candidate.provider.trim() ? candidate.provider : "external",
    media_type:
      candidate.media_type === "gifs" || candidate.media_type === "stickers" || candidate.media_type === "clips"
        ? candidate.media_type
        : undefined,
    title: typeof candidate.title === "string" && candidate.title.trim() ? candidate.title.trim() : null,
    alt_text: typeof candidate.alt_text === "string" && candidate.alt_text.trim() ? candidate.alt_text.trim() : null,
    source_url: typeof candidate.source_url === "string" && candidate.source_url.trim() ? candidate.source_url.trim() : null,
    preview_url: previewUrl,
    preview_width: Math.max(1, Math.round(previewWidth)),
    preview_height: Math.max(1, Math.round(previewHeight)),
    preview_content_type: previewContentType as VoiceChannelStatusMedia["preview_content_type"],
  };
}

export function sanitizeVoiceChannelStatus(value: unknown): VoiceChannelStatus | null {
  if (value == null) return null;
  if (typeof value !== "object") return null;

  const candidate = value as Record<string, unknown>;
  const text = normalizeVoiceChannelStatusText(candidate.text);
  const media = sanitizeVoiceChannelStatusMedia(candidate.media);

  if (!text && !media) return null;

  return {
    text,
    media,
  };
}

export function hasVoiceChannelStatus(status: VoiceChannelStatus | null | undefined): boolean {
  return Boolean(status?.text || status?.media);
}

export function isVoiceChannelStatusVideo(media: VoiceChannelStatusMedia | null | undefined): boolean {
  return !!media?.preview_content_type?.startsWith("video/");
}

export function getVoiceRenderableGifAsset(item: GifPickerItem) {
  return item.send ?? item.preview;
}

export function voiceChannelStatusMediaFromGifItem(item: GifPickerItem): VoiceChannelStatusMedia {
  const asset = getVoiceRenderableGifAsset(item);

  return {
    id: item.id,
    provider: item.provider,
    media_type: item.mediaType,
    title: item.title || null,
    alt_text: item.altText ?? null,
    source_url: item.sourceUrl,
    preview_url: asset.url,
    preview_width: asset.width,
    preview_height: asset.height,
    preview_content_type: asset.contentType,
  };
}
