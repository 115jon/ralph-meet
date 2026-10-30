import type { CSSProperties } from "react";

import { useProfileTint } from "./profile-tint";
import type { GridItem } from "./types";

/**
 * Tile surface: an anodised ply-2 plate. The person's colour is mixed in at
 * 6% at most, enough to tell tiles apart, never a coloured wall.
 */
export const TILE_SURFACE =
  "bg-[color-mix(in_oklab,var(--tile-tint)_6%,var(--ply-2))]";

/** Sets --tile-tint to this person's profile colour (see profile-tint). */
export function useTileTintStyle(
  userId: string | null | undefined,
): CSSProperties {
  const tint = useProfileTint(userId);
  return { "--tile-tint": tint } as CSSProperties;
}

/**
 * 64 on every grid tile, whatever its width: the tile is a person, the
 * nameplate and ring carry state. Only a single focused tile uses 80.
 */
export const TILE_AVATAR_SIZE = "size-16";

/**
 * A row tile (the DM call strip) is always 16:9, so one narrower than the
 * grid's 200px floor (two-up on a phone) is only ~100px tall: the square gives
 * way to 40 and sits high, and the nameplate keeps clear of it. The grid's own
 * tiles change aspect with the viewport, so they never use this.
 */
export const ROW_TILE_AVATAR_SIZE = "size-16 @max-[210px]:size-10";
export const ROW_TILE_AVATAR_BOX =
  "items-center p-4 @max-[210px]:items-start @max-[210px]:p-3";

/** The focused stage's one person without media. */
export const FOCUSED_AVATAR_SIZE = "size-20";

/** The owner's name on a stream tile ("Linus", never "Linus's Stream"). */
export function streamOwnerName(item: Pick<GridItem, "name" | "isLocal">) {
  return item.name.replace(/(?:'s|') Stream$/, "");
}

/** "Jon (you)" on your own tile, the name everywhere else. */
export function tileDisplayName(item: Pick<GridItem, "name" | "isLocal">) {
  const base = streamOwnerName(item);
  return item.isLocal ? `${base} (you)` : base;
}

const ITEM_KEYS: (keyof GridItem)[] = [
  "id",
  "userId",
  "name",
  "avatar",
  "avatarDisplay",
  "stream",
  "isLocal",
  "type",
  "isStreaming",
  "isMuted",
  "isDeafened",
  "serverMute",
  "selfMute",
  "isRinging",
];

/**
 * Equal when everything but `item.isSpeaking` and `onClick` matches: the
 * speaking state arrives through useSpeakingAttr, and onClick is read from a
 * ref, so a speaking edge re-renders only the leaf that subscribes to it.
 */
export function cardPropsEqual<
  P extends { item: GridItem; onClick: () => void },
>(prev: P, next: P): boolean {
  for (const key of Object.keys(next) as (keyof P)[]) {
    if (key === "onClick" || key === "item") continue;
    if (prev[key] !== next[key]) return false;
  }
  if (prev.item === next.item) return true;
  return ITEM_KEYS.every((key) => prev.item[key] === next.item[key]);
}
