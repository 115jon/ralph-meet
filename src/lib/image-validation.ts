/** Allowed image types with their canonical extensions */
export const ALLOWED_IMAGE_TYPES: ReadonlyMap<string, string> = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/gif", "gif"],
  ["image/webp", "webp"],
  ["image/avif", "avif"],
]);

/**
 * Detect actual image type from the first bytes (magic bytes).
 * Returns the MIME type if it matches a known image format, or null if unknown.
 */
export function detectImageType(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return "image/png";
  }

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }

  // GIF: 47 49 46 38 (GIF8)
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return "image/gif";
  }

  // WebP: RIFF....WEBP
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return "image/webp";
  }

  // AVIF: ....ftyp (bytes 4-7 = 'ftyp', then check for avif/avis/mif1)
  if (bytes.length >= 12 &&
    bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
    if (brand === "avif" || brand === "avis" || brand === "mif1") {
      return "image/avif";
    }
  }

  return null;
}

/** Maximum image file size (8MB) */
export const MAX_IMAGE_SIZE = 8 * 1024 * 1024;

/**
 * Validate image buffer: checks magic bytes against allowed types.
 * Returns `{ ok: true, mimeType, ext }` or `{ ok: false, error }`.
 */
export function validateImageBuffer(buffer: ArrayBuffer):
  | { ok: true; mimeType: string; ext: string }
  | { ok: false; error: string } {
  const headerBytes = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 16));
  const detectedType = detectImageType(headerBytes);

  if (!detectedType || !ALLOWED_IMAGE_TYPES.has(detectedType)) {
    return { ok: false, error: "Invalid image file. Only PNG, JPEG, GIF, WebP, and AVIF are allowed." };
  }

  return { ok: true, mimeType: detectedType, ext: ALLOWED_IMAGE_TYPES.get(detectedType)! };
}
