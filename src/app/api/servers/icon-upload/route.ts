import { apiError, apiSuccess, genId, getBucket, requireAuth } from "@/lib/api-helpers";
import { logger } from "@/lib/logger";
import { checkRateLimitDO, RATE_LIMITS } from "@/lib/rate-limit";


/** Allowed image types with their canonical extensions */
const ALLOWED_IMAGE_TYPES: ReadonlyMap<string, string> = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/gif", "gif"],
  ["image/webp", "webp"],
  ["image/avif", "avif"],
]);

const MAX_ICON_SIZE = 8 * 1024 * 1024; // 8MB

/**
 * Detect actual image type from the first bytes (magic bytes).
 * Returns the MIME type if it matches a known image format, or null if unknown.
 */
function detectImageType(bytes: Uint8Array): string | null {
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

// POST /api/servers/icon-upload — upload a server icon to R2
export async function POST(request: Request) {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  // Rate limit: reuse file upload limits (global DO limit)
  const rl = await checkRateLimitDO(userId, "icon-upload", RATE_LIMITS.FILE_UPLOAD);
  if (rl) return rl;

  const formData = await request.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return apiError("No file provided", 400);
  }

  // Size limit
  if (file.size > MAX_ICON_SIZE) {
    return apiError("Icon too large (max 8MB)", 413);
  }

  // ── Magic byte validation ───────────────────────────────────────
  const buffer = await file.arrayBuffer();
  const headerBytes = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 16));
  const detectedType = detectImageType(headerBytes);

  if (!detectedType || !ALLOWED_IMAGE_TYPES.has(detectedType)) {
    logger.security("icon_upload_invalid_magic_bytes", {
      userId,
      filename: file.name,
      declared_type: file.type,
      detected_type: detectedType,
    });
    return apiError("Invalid image file. Only PNG, JPEG, GIF, WebP, and AVIF are allowed.", 415);
  }

  // Derive extension from the detected type, not from the user-supplied filename
  const ext = ALLOWED_IMAGE_TYPES.get(detectedType)!;
  const iconId = genId();
  const key = `server-icons/${iconId}.${ext}`;

  const bucket = getBucket();
  await bucket.put(key, buffer, {
    httpMetadata: { contentType: detectedType },
  });

  return apiSuccess(
    {
      url: `/api/server-icons/${iconId}.${ext}`,
      key,
    },
    201
  );
}
