import { MAX_IMAGE_SIZE, validateImageBuffer } from "@/lib/image-validation";

const ALLOWED_NAMEPLATE_VIDEO_TYPES: ReadonlyMap<string, string> = new Map([
  ["video/mp4", "mp4"],
  ["video/webm", "webm"],
  ["video/ogg", "ogv"],
]);

export const MAX_PROFILE_BANNER_SIZE = MAX_IMAGE_SIZE;
export const MAX_PROFILE_NAMEPLATE_SIZE = 25 * 1024 * 1024;

function detectNameplateVideoType(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;

  // MP4 / ISO BMFF
  if (
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  ) {
    return "video/mp4";
  }

  // WebM / Matroska EBML
  if (
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  ) {
    return "video/webm";
  }

  // Ogg container
  if (
    bytes[0] === 0x4f &&
    bytes[1] === 0x67 &&
    bytes[2] === 0x67 &&
    bytes[3] === 0x53
  ) {
    return "video/ogg";
  }

  return null;
}

export function validateProfileBannerBuffer(buffer: ArrayBuffer):
  | { ok: true; mimeType: string; ext: string }
  | { ok: false; error: string } {
  return validateImageBuffer(buffer);
}

export function validateProfileNameplateBuffer(buffer: ArrayBuffer):
  | { ok: true; mimeType: string; ext: string }
  | { ok: false; error: string } {
  const imageValidation = validateImageBuffer(buffer);
  if (imageValidation.ok) {
    return imageValidation;
  }

  const headerBytes = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 64));
  const detectedType = detectNameplateVideoType(headerBytes);

  if (!detectedType || !ALLOWED_NAMEPLATE_VIDEO_TYPES.has(detectedType)) {
    return {
      ok: false,
      error: "Invalid nameplate file. Only PNG, JPEG, GIF, WebP, AVIF, MP4, WebM, and OGG are allowed.",
    };
  }

  return {
    ok: true,
    mimeType: detectedType,
    ext: ALLOWED_NAMEPLATE_VIDEO_TYPES.get(detectedType)!,
  };
}
