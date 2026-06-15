export const CAMERA_BACKGROUND_UPLOAD_LIMIT_BYTES = 25 * 1024 * 1024;
export const CAMERA_BACKGROUND_UPLOAD_LIMIT_MB = 25;

const SUPPORTED_BACKGROUND_MIME_TYPES = new Set([
  "image/gif",
  "image/webp",
  "image/png",
  "image/jpeg",
  "image/avif",
]);

const SUPPORTED_BACKGROUND_EXTENSIONS = new Set(["gif", "webp", "png", "jpg", "jpeg", "avif"]);

export const CAMERA_BACKGROUND_ACCEPT = [...SUPPORTED_BACKGROUND_MIME_TYPES].join(",");

export function isSupportedCameraBackgroundMimeType(type: string | undefined | null): boolean {
  return SUPPORTED_BACKGROUND_MIME_TYPES.has((type ?? "").toLowerCase().split(";")[0].trim());
}

function getFileExtension(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

export function getCameraBackgroundValidationError(file: Pick<File, "name" | "size" | "type">): string | null {
  if (file.size > CAMERA_BACKGROUND_UPLOAD_LIMIT_BYTES) {
    return `Images must be ${CAMERA_BACKGROUND_UPLOAD_LIMIT_MB} MB or smaller.`;
  }

  const normalizedType = file.type.toLowerCase().split(";")[0].trim();
  if (isSupportedCameraBackgroundMimeType(normalizedType)) return null;

  const canTrustExtension = normalizedType === "" || normalizedType === "application/octet-stream";
  if (canTrustExtension && SUPPORTED_BACKGROUND_EXTENSIONS.has(getFileExtension(file.name))) return null;

  return "Choose a GIF, WebP, PNG, JPEG, or AVIF image.";
}
