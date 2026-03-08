/**
 * Video MIME types that Chromium / CEF can natively decode.
 *
 * This is a well-known, conservative list — formats like WMV, AVI, FLV, and
 * MKV (with non-standard codecs) are intentionally excluded because Chromium
 * does NOT ship with decoders for them.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Video_codecs
 */
const PLAYABLE_VIDEO_TYPES = new Set([
  "video/mp4",
  "video/webm",
  "video/ogg",
  // MP2T (MPEG transport streams) – supported in Chromium for HLS-like playback
  "video/mp2t",
]);

/** Returns true if the given content_type is a video that CEF can play inline. */
export function isPlayableVideo(contentType: string | undefined | null): boolean {
  if (!contentType) return false;
  // Normalise: strip parameters (e.g. "video/mp4; codecs=avc1" → "video/mp4")
  const mime = contentType.split(";")[0].trim().toLowerCase();
  return PLAYABLE_VIDEO_TYPES.has(mime);
}

/** Returns true if the content_type is any video/* type (playable or not). */
export function isVideo(contentType: string | undefined | null): boolean {
  if (!contentType) return false;
  return contentType.startsWith("video/");
}
