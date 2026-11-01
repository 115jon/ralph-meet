import type { VideoSource } from "expo-video";

import { mediaSource } from "@/lib/api";

// TikTok and Instagram sign their CDN links for minutes and TikTok checks
// the Referer, so their media goes through the server's /api/proxy-media
// (as on the web), which also re-resolves an expired link from the post.
const PROXIED_HOST = /(^|\.)(tiktokcdn(-[a-z0-9-]+)?\.com|cdninstagram\.com)$/i;

function hostOf(url: string): string | null {
  return /^https:\/\/([^/?#:]+)/i.exec(url)?.[1] ?? null;
}

/** `url` as the app should fetch it; `sourceUrl` is the post it came from. */
export function playableUrl(url: string, sourceUrl?: string): string {
  const host = hostOf(url);
  if (!host || !PROXIED_HOST.test(host)) return url;
  const params = new URLSearchParams({ url });
  if (sourceUrl) params.set("sourceUrl", sourceUrl);
  return `/api/proxy-media?${params}`;
}

/** An expo-video source: auth for the API's own files, cached on disk. */
export function videoSource(url: string): VideoSource {
  const { uri, headers } = mediaSource(url);
  return {
    uri,
    headers: headers ? { ...headers } : undefined,
    useCaching: true,
  };
}
