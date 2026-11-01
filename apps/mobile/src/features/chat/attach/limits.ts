// The web composer's limits, so a phone cannot queue what the server refuses.

/**
 * Per file: DEFAULT_UPLOAD_LIMIT_BYTES in
 * src/routes/api/channels/$id/messages/upload.ts (413 above it), and the
 * web's own check in src/components/chat/useMessageInput.ts.
 */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

/**
 * Per message. The server takes any number of attachment ids, but each file
 * is one upload and RATE_LIMITS.FILE_UPLOAD (src/lib/rate-limit.ts) allows 10
 * a minute, so an eleventh would only come back 429.
 */
export const MAX_FILES = 10;

const UNITS = ["B", "KB", "MB", "GB"] as const;

/** "512 KB", "3.4 MB": the readout under a file chip. */
export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 10 ? 0 : 1;
  return `${value.toFixed(digits)} ${UNITS[unit]}`;
}

/** "0:07", "12:30", "1:02:03": a video tile's length. */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}
