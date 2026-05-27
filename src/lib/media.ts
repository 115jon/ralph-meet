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
