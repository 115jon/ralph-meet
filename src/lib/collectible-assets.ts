/**
 * Lightweight asset URLs for collectible thumbnails.
 *
 * The catalog's own URLs point at full-size originals: a decoration's
 * `passthrough=true` PNG is the whole animated APNG (often 1–5 MB, the size
 * param is ignored) and an effect frame is a 900×1760 PNG (~6 MB decoded).
 * Grids must use these static, resized variants and only load the animated
 * original for the one item being previewed.
 */

import type { CollectibleCatalogItem } from "@/lib/collectibles-catalog";

const CDN_HOST = "cdn.discordapp.com";
const MEDIA_PROXY_HOST = "media.discordapp.net";

function withParams(url: string, params: Record<string, string>) {
  try {
    const parsed = new URL(url);
    for (const [key, value] of Object.entries(params)) {
      parsed.searchParams.set(key, value);
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

/** Static first frame of an avatar decoration, sized for a grid tile. */
export function decorationStillUrl(
  item: Pick<CollectibleCatalogItem, "asset" | "staticUrl" | "previewUrl">,
  size = 160,
) {
  if (item.asset) {
    return `https://${CDN_HOST}/avatar-decoration-presets/${item.asset}.png?size=${size}&passthrough=false`;
  }
  const fallback = item.staticUrl ?? item.previewUrl;
  return fallback
    ? withParams(fallback, { passthrough: "false", size: String(size) })
    : undefined;
}

/** Animated decoration (APNG). Only load this for the item being previewed. */
export function decorationMotionUrl(
  item: Pick<CollectibleCatalogItem, "asset" | "animatedUrl" | "staticUrl">,
) {
  if (item.asset) {
    return `https://${CDN_HOST}/avatar-decoration-presets/${item.asset}.png?size=240&passthrough=true`;
  }
  return item.animatedUrl ?? item.staticUrl;
}

/**
 * Resize a cdn.discordapp.com collectibles-shop image through Discord's media
 * proxy (900×1760 PNG at ~260 KB becomes ~17 KB at 225×440).
 */
export function resizedShopImageUrl(
  url: string | undefined,
  width: number,
  height: number,
) {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    if (
      parsed.hostname !== CDN_HOST ||
      !parsed.pathname.startsWith("/media/v1/collectibles-shop/")
    ) {
      return url;
    }
    parsed.hostname = MEDIA_PROXY_HOST;
    parsed.searchParams.set("width", String(Math.round(width)));
    parsed.searchParams.set("height", String(Math.round(height)));
    return parsed.toString();
  } catch {
    return url;
  }
}

/** Still thumbnail for a profile effect (portrait, 450:880). */
export function effectStillUrl(
  item: Pick<CollectibleCatalogItem, "profileEffect" | "staticUrl">,
  width = 150,
) {
  // thumbnailPreviewSrc is the representative frame; reducedMotionSrc is
  // often a near-empty overlay that reads as blank at thumbnail size.
  const source =
    item.profileEffect?.thumbnailPreviewSrc ??
    item.profileEffect?.reducedMotionSrc ??
    item.profileEffect?.staticFrameSrc ??
    item.staticUrl;
  return resizedShopImageUrl(source, width, Math.round((width * 880) / 450));
}

export function nameplateStillUrl(
  item: Pick<CollectibleCatalogItem, "staticUrl" | "previewUrl">,
) {
  return item.staticUrl ?? item.previewUrl;
}

export function nameplateMotionUrl(
  item: Pick<CollectibleCatalogItem, "animatedUrl">,
) {
  return item.animatedUrl;
}

/** Upstream art sizes: catalog banners 2120×360, hero banners ~3330×1050. */
const CATALOG_BANNER_ASPECT = 2120 / 360;
const HERO_BANNER_ASPECT = 3330 / 1050;

export type CollectionArt = { src: string; aspect: number };

/**
 * The wide strip banner for a collection header, resized through the media
 * proxy. Falls back to the hero art (different ratio) when a collection has no
 * catalog banner.
 */
export function collectionStripArt(
  category: { bannerUrl?: string; heroBannerUrl?: string },
  width = 1060,
): CollectionArt | null {
  const hasStrip =
    category.bannerUrl && category.bannerUrl !== category.heroBannerUrl;
  if (hasStrip) {
    return {
      src: resizedShopImageUrl(
        category.bannerUrl,
        width,
        width / CATALOG_BANNER_ASPECT,
      )!,
      aspect: CATALOG_BANNER_ASPECT,
    };
  }
  return collectionHeroArt(category, width);
}

/** The large hero art for a featured collection. */
export function collectionHeroArt(
  category: { heroBannerUrl?: string; bannerUrl?: string },
  width = 1600,
): CollectionArt | null {
  if (category.heroBannerUrl) {
    return {
      src: resizedShopImageUrl(
        category.heroBannerUrl,
        width,
        width / HERO_BANNER_ASPECT,
      )!,
      aspect: HERO_BANNER_ASPECT,
    };
  }
  if (category.bannerUrl) {
    return {
      src: resizedShopImageUrl(
        category.bannerUrl,
        width,
        width / CATALOG_BANNER_ASPECT,
      )!,
      aspect: CATALOG_BANNER_ASPECT,
    };
  }
  return null;
}
