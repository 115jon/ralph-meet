export const SOUNDBOARD_UPLOAD_PATH = "/api/soundboard/uploads/";

export function getSoundboardUploadUrl(soundId: string): string {
  return `${SOUNDBOARD_UPLOAD_PATH}${encodeURIComponent(soundId)}`;
}

export function normalizeSoundboardUploadUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) {
    return null;
  }

  if (!value.startsWith(SOUNDBOARD_UPLOAD_PATH) || value.startsWith("//")) {
    return null;
  }

  try {
    const url = new URL(value, "https://voice-room.invalid");
    if (!url.pathname.startsWith(SOUNDBOARD_UPLOAD_PATH)) return null;
    if (url.search || url.hash) return null;
    const id = url.pathname.slice(SOUNDBOARD_UPLOAD_PATH.length);
    if (!id || id.includes("/") || decodeURIComponent(id) !== id) return null;
    return url.pathname;
  } catch {
    return null;
  }
}
