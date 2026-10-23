import type { CSSProperties } from "react";

/** Shared sizing and URL helpers for LinkEmbed (kept out of the component
 * module so it only exports components). */

/** Shown in place of a post that no longer exists (public/). */
export const SOCIAL_UNAVAILABLE_IMAGE = "/tiktok-unavailable.webp";

/**
 * `open.spotify.com/intl-de/album/x?si=1` -> `open.spotify.com/embed/album/x`.
 * The locale segment used to end up inside the embed path and 404.
 */
export function getSpotifyEmbedUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const path = parsed.pathname.replace(/^\/intl-[a-z-]+(?=\/)/i, "");
    return `${parsed.origin}/embed${path}`;
  } catch {
    return rawUrl
      .replace("open.spotify.com/", "open.spotify.com/embed/")
      .replace(/\?.*$/, "");
  }
}

/** Collections get Spotify's taller player with the track list peek. */
export function getSpotifyPlayerHeight(rawUrl: string): number {
  return /\/(album|playlist|artist|show)\//.test(rawUrl) ? 152 : 80;
}

/** Width + aspect ratio for a single X image capped at 520x420. */
export function getXSingleImageBoxStyle(
  width?: number,
  height?: number,
): CSSProperties | undefined {
  if (!width || !height || width <= 0 || height <= 0) return undefined;
  const aspectRatio = width / height;
  const boxWidth = Math.round(Math.min(width, 520, 420 * aspectRatio));
  return {
    aspectRatio: `${width} / ${height}`,
    width: `min(100%, ${boxWidth}px)`,
  };
}

export const DIRECT_MEDIA_MAX_WIDTH = 400;
export const DIRECT_MEDIA_MAX_HEIGHT = 300;

/** Box for a direct image/video: fits 400x300, never upscales. */
export function getDirectMediaBox(
  width?: number,
  height?: number,
): { width: number; aspectRatio: number } | null {
  if (!width || !height || width <= 0 || height <= 0) return null;
  const aspectRatio = width / height;
  const boxWidth = Math.min(
    width,
    DIRECT_MEDIA_MAX_WIDTH,
    DIRECT_MEDIA_MAX_HEIGHT * aspectRatio,
  );
  return { width: Math.round(boxWidth), aspectRatio };
}
