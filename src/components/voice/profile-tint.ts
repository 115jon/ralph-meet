import { findCachedMember } from "@/hooks/useUserResolution";
import { useChatStore } from "@/stores/chat-store";

/**
 * The colour a person's tile is tinted with (talk-tree-spec §8 Voice): their
 * profile accent (or banner) colour, mixed 6% into ply-2 by the tile. People
 * without one get a quiet hue derived from their id, so a five-person call is
 * five different tiles rather than five grey discs. User data, not a theme
 * hue: the tile never uses it at more than 6%.
 *
 * Selects a string, so a tile re-renders only when that person's colour
 * changes.
 */
export function useProfileTint(userId: string | null | undefined): string {
  const color = useChatStore((s) => {
    if (!userId) return null;
    const user =
      (s.user?.id === userId ? s.user : undefined) ??
      findCachedMember(s.members, s.membersByServerId, userId)?.user ??
      s.relationships.find((r) => r.user.id === userId)?.user ??
      s.dmChannels.find((dm) => dm.recipient?.id === userId)?.recipient;
    return user?.profile_accent_color || user?.profile_banner_color || null;
  });
  return color ?? fallbackTint(userId ?? "");
}

/** A stable mid-tone hue per id (FNV-1a), fixed lightness and chroma. */
export function fallbackTint(id: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  const hue = (hash >>> 0) % 360;
  return `oklch(0.68 0.14 ${hue})`;
}
