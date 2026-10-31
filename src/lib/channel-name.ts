// Kept free of schema imports on purpose: the channel modals bundled in the main
// chat chunk import this, and must not pull Effect Schema in with it.

/**
 * Sanitizes a channel name based on its type.
 * Text channels: lowercase, collapse whitespace into hyphens, preserve visible Unicode.
 * Voice channels: trimmed, allowed spaces and special chars.
 */
export function sanitizeChannelName(
  name: string,
  type: "text" | "voice" | "dm",
  isFinal: boolean = false,
): string {
  if (type === "text") {
    let sanitized = name
      .toLowerCase()
      .replace(/\s+/gu, "-") // Discord-style spacing for text channels
      .split("")
      .filter((character) => {
        const code = character.charCodeAt(0);
        return code > 0x1f && (code < 0x7f || code > 0x9f);
      })
      .join("") // Strip control chars but keep visible Unicode
      .replace(/-+/g, "-"); // Collapse multiple hyphens

    if (isFinal) {
      sanitized = sanitized.replace(/^-+|-+$/g, ""); // Trim hyphens from ends if final
    }
    return sanitized;
  }
  return isFinal ? name.trim() : name;
}
