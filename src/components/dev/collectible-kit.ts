/**
 * Dev-only: dress fixture users in real collectibles from the catalog sample,
 * so every profile surface can be shot with a frame, decoration, effect and
 * nameplate on. Opt in from any fixture URL:
 *
 *   &kit=frame   profile frame only
 *   &kit=deco    avatar decoration + profile effect + nameplate, no frame
 *   &kit=full    all four
 *   &frame=<name slug>   which frame (default "the-entity"; e.g. star-chart,
 *                        precious-metal, prism-edge, fantasy-galaxy, ribbit)
 *
 * Users are patched in place: fixture members share the same objects, so the
 * member list, popovers and sheets all see the kit.
 */

import type { AvatarCollectibles, AvatarDisplay } from "@/lib/avatar-display";
import { collectibleItemToSelection } from "@/lib/collectible-selection";
import {
  normalizeYapperCatalog,
  type CollectibleCatalogItem,
  type CollectibleKind,
} from "@/lib/collectibles-catalog";
import sample from "@/lib/__fixtures__/yapper-catalog.sample.json";
import type { User } from "@/lib/types";

export type CollectibleKit = "frame" | "deco" | "full";

export const FIXTURE_AVATAR =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7c5cff"/><stop offset="1" stop-color="#22c3a6"/></linearGradient></defs><rect width="128" height="128" fill="url(#g)"/><circle cx="64" cy="50" r="22" fill="#fff" fill-opacity=".9"/><path d="M22 118c6-26 24-38 42-38s36 12 42 38" fill="#fff" fill-opacity=".9"/></svg>`,
  );

let items: CollectibleCatalogItem[] | null = null;

function catalogItems() {
  items ??= normalizeYapperCatalog(sample, new Date().toISOString()).items;
  return items;
}

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

function pick(kind: CollectibleKind, name?: string | null) {
  const ofKind = catalogItems().filter((item) => item.kind === kind);
  if (name) {
    const wanted = slug(name);
    const match = ofKind.find((item) => slug(item.name) === wanted);
    if (match) return match;
  }
  return ofKind[0] ?? null;
}

export function isCollectibleKit(value: unknown): value is CollectibleKit {
  return value === "frame" || value === "deco" || value === "full";
}

export function collectibleKitDisplay(
  kit: CollectibleKit,
  frameName?: string | null,
): AvatarDisplay {
  const collectibles: AvatarCollectibles = {};
  const kinds: CollectibleKind[] =
    kit === "frame"
      ? ["profile_frame"]
      : kit === "deco"
        ? ["avatar_decoration", "profile_effect", "nameplate"]
        : ["avatar_decoration", "profile_effect", "nameplate", "profile_frame"];
  for (const kind of kinds) {
    const item = pick(
      kind,
      kind === "profile_frame" ? (frameName ?? "the-entity") : null,
    );
    if (item) Object.assign(collectibles, collectibleItemToSelection(item));
  }
  return { version: 1, collectibles };
}

/** Patch each user in place with the kit and a fixture avatar. */
export function applyCollectibleKit(
  users: Array<User | null | undefined>,
  kit: CollectibleKit,
  frameName?: string | null,
) {
  const display = collectibleKitDisplay(kit, frameName);
  for (const user of users) {
    if (!user) continue;
    user.avatar_display = display;
    user.avatar_url ??= FIXTURE_AVATAR;
  }
  return display;
}
