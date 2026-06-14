import { getGifAttachmentProvider } from "@/lib/gif-picker";

/**
 * Video MIME types that Chromium / CEF can natively decode.
 *
 * This is a container-level allowlist. Codec support is runtime-dependent,
 * especially for HEVC/H.265, so playback failures are handled by the video UI.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Video_codecs
 */
const PLAYABLE_VIDEO_TYPES = new Set([
  "video/mp4",
  "video/webm",
  "video/ogg",
  "video/mp2t",
]);

const ANIMATED_IMAGE_TYPES = new Set([
  "image/gif",
  "image/apng",
]);

/** Returns true if the given content_type is a video that CEF can play inline. */
export function isPlayableVideo(contentType: string | undefined | null): boolean {
  if (!contentType) return false;
  const normalized = contentType.toLowerCase();
  const mime = normalized.split(";")[0].trim();
  return PLAYABLE_VIDEO_TYPES.has(mime);
}

/** Returns true if the content_type is any video/* type, playable or not. */
export function isVideo(contentType: string | undefined | null): boolean {
  if (!contentType) return false;
  return contentType.toLowerCase().startsWith("video/");
}

function normalizeMimeType(contentType: string | undefined | null): string {
  if (!contentType) return "";
  return contentType.toLowerCase().split(";")[0].trim();
}

export function isAnimatedImage(contentType: string | undefined | null): boolean {
  return ANIMATED_IMAGE_TYPES.has(normalizeMimeType(contentType));
}

export function isAnimatedMedia(
  contentType: string | undefined | null,
  isGif?: boolean | null,
  sourceUrlOrFileKey?: string | null,
): boolean {
  if (isGif === true) return true;
  if (sourceUrlOrFileKey && getGifAttachmentProvider(sourceUrlOrFileKey)) return true;
  if (normalizeMimeType(contentType) === "video/mp4" && sourceUrlOrFileKey?.includes("/api/proxy-media?")) return true;
  return isAnimatedImage(contentType);
}
