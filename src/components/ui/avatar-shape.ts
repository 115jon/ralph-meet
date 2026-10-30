import { getAvatarDecoration } from "@/lib/avatar-display";

/** True when `display` carries a collectible avatar decoration (ring art). */
export function isAvatarDecorated(display: unknown): boolean {
  return Boolean(getAvatarDecoration(display));
}

/**
 * Corner and overflow classes for any box that wraps an `AvatarImage`
 * (DESIGN.md, Avatar). Pass the avatar's `avatar_display`, or a boolean.
 * Only an avatar with a picture shows ring art, so callers pass
 * `avatarUrl && avatarDisplay`: an initial fallback always stays square.
 *
 * - Undecorated: the C1 square, a 2px key corner that clips its contents.
 * - Decorated: round, because the ring art is drawn for a circle, and
 *   overflow visible, because that art is drawn at 124% of the box and a
 *   clipping wrapper would cut it off. AvatarImage crops the photo round
 *   itself, so nothing else leaks.
 *
 * `clip: false` drops the undecorated `overflow-hidden`, for boxes that
 * must not clip (a button whose HIT pseudo-element extends its target).
 *
 * A presence notch stays a square cut at the bottom-right in both shapes;
 * give it a z-index above 10 so it sits over the ring art.
 */
export function avatarShape(
  display: unknown,
  { clip = true }: { clip?: boolean } = {},
): string {
  const decorated =
    typeof display === "boolean" ? display : isAvatarDecorated(display);
  if (decorated) return "rounded-full overflow-visible";
  return clip ? "rounded-avatar overflow-hidden" : "rounded-avatar";
}
