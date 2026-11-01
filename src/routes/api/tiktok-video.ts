import { createFileRoute } from "@tanstack/react-router";
import { cacheGet, cacheSet } from "@/lib/cache";
import { fetchTikTokProxyLookup } from "@/lib/share-preview-proxy";
import { clog } from "@/lib/console-logger";
import type { EmbedAudio, EmbedMedia } from "@/lib/types";

const log = clog("tiktok-video");

// TikTok signed media URLs carry an `x-expires` epoch (about an hour out).
// KV keeps a result for up to 50 minutes, but a cached result is only served
// while every signature in it has more than the safety window left, and the
// browser may cache it only until that point too. Before, a 49-minute-old KV
// hit went out with `public, max-age=2700`, so a browser could keep replaying
// media URLs for over an hour after they had expired.
const TIKTOK_VIDEO_TTL = 50 * 60;
const TIKTOK_VIDEO_CACHE_CONTROL = "private, max-age=2700";
const TIKTOK_SIGNATURE_SAFETY_SECONDS = 5 * 60;
const TIKTOK_BROWSER_CACHE_MAX_SECONDS = 45 * 60;
/**
 * A post TikTok's own page reports deleted or private. That verdict is
 * reliable, so KV keeps it for hours; browsers re-ask after 10 minutes.
 */
export const TIKTOK_GONE_TTL = 6 * 60 * 60;
const TIKTOK_GONE_CACHE_CONTROL = "private, max-age=600";
/** Nothing usable although the sources answered: try again in a while. */
const TIKTOK_EMPTY_RETRY_AFTER = 300;
/** An upstream was down or backing off. */
const TIKTOK_TRANSIENT_RETRY_AFTER = 60;

export interface TikTokVideoResult {
  videoUrl: string | null;
  coverUrl: string | null;
  canonicalUrl?: string | null;
  postType?: "video" | "slideshow" | null;
  title?: string | null;
  authorName?: string | null;
  authorHandle?: string | null;
  authorAvatarUrl?: string | null;
  media?: EmbedMedia[];
  audio?: EmbedAudio | null;
  likeCount?: number | null;
  commentCount?: number | null;
  viewCount?: number | null;
  shareCount?: number | null;
  timestamp?: string | null;
  /** Alive, but TikTok hides it from logged-out viewers; its player cannot play it. */
  restricted?: boolean;
}

export function canonicalizeTikTokLookupUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    if (!parsed.hostname.toLowerCase().includes("tiktok.com")) return null;

    return `https://${parsed.hostname.toLowerCase()}${parsed.pathname}`;
  } catch {
    return null;
  }
}

export function isTikTokShortLookupUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    const hostname = parsed.hostname.toLowerCase();
    return hostname === "vm.tiktok.com" || parsed.pathname.startsWith("/t/");
  } catch {
    return false;
  }
}

export function hasTikTokVideoResultContent(
  result?: TikTokVideoResult | null,
): result is TikTokVideoResult {
  return !!(
    result &&
    (result.videoUrl ||
      result.media?.length ||
      result.coverUrl ||
      result.audio ||
      result.title ||
      result.restricted)
  );
}

function readTikTokSignatureExpiry(
  rawUrl: string | null | undefined,
): number | null {
  if (!rawUrl) return null;

  try {
    const rawValue = new URL(rawUrl).searchParams.get("x-expires");
    if (!rawValue) return null;
    const parsedValue = Number(rawValue);
    return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : null;
  } catch {
    return null;
  }
}

/** Earliest `x-expires` across every signed URL in the result. */
export function earliestTikTokSignatureExpiry(
  result: TikTokVideoResult,
): number | null {
  const urls = [
    result.videoUrl,
    result.coverUrl,
    result.authorAvatarUrl,
    result.audio?.url,
    result.audio?.artworkUrl,
    ...(result.media ?? []).flatMap((item) => [item.url, item.thumbnailUrl]),
  ];
  const expiries = urls
    .map((url) => readTikTokSignatureExpiry(url))
    .filter((value): value is number => value !== null);
  if (expiries.length === 0) return null;
  return Math.min(...expiries);
}

export function isTikTokVideoResultFresh(
  result: TikTokVideoResult,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  const expiry = earliestTikTokSignatureExpiry(result);
  if (expiry === null) return true;
  return expiry - nowSeconds > TIKTOK_SIGNATURE_SAFETY_SECONDS;
}

export function tiktokVideoCacheControl(
  result: TikTokVideoResult,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  const expiry = earliestTikTokSignatureExpiry(result);
  if (expiry === null) return TIKTOK_VIDEO_CACHE_CONTROL;

  const ttl = expiry - nowSeconds - TIKTOK_SIGNATURE_SAFETY_SECONDS;
  if (ttl < 30) return "no-store";
  return `private, max-age=${Math.min(
    TIKTOK_BROWSER_CACHE_MAX_SECONDS,
    Math.floor(ttl),
  )}`;
}

/** KV lifetime: never past the point the signatures stop being fresh. */
export function tiktokVideoKvTtl(
  result: TikTokVideoResult,
  nowSeconds = Math.floor(Date.now() / 1000),
): number {
  const expiry = earliestTikTokSignatureExpiry(result);
  if (expiry === null) return TIKTOK_VIDEO_TTL;
  return Math.max(
    60,
    Math.min(
      TIKTOK_VIDEO_TTL,
      expiry - nowSeconds - TIKTOK_SIGNATURE_SAFETY_SECONDS,
    ),
  );
}

// v2: v1 "gone" entries came from a resolver that mistook age-gated posts
// and failed scrapes for deleted ones.
export function tiktokVideoCacheKey(lookupUrl: string): string {
  return `v2:tiktok-video:${lookupUrl}`;
}

export function tiktokGoneCacheKey(lookupUrl: string): string {
  return `v2:tiktok-video:gone:${lookupUrl}`;
}

function goneResponse(): Response {
  return Response.json(
    { error: "This TikTok is no longer available", unavailable: true },
    { status: 404, headers: { "Cache-Control": TIKTOK_GONE_CACHE_CONTROL } },
  );
}

export const GET = async ({ request }: any) => {
  const url = new URL(request.url);
  const videoUrl = url.searchParams.get("videoUrl");

  if (!videoUrl) {
    return Response.json(
      { error: "Missing videoUrl parameter" },
      { status: 400 },
    );
  }

  // Validate it's actually a TikTok URL
  let parsed: URL;
  try {
    parsed = new URL(videoUrl);
  } catch {
    return Response.json({ error: "Invalid videoUrl" }, { status: 400 });
  }

  if (!parsed.hostname.toLowerCase().includes("tiktok.com")) {
    return Response.json(
      { error: "Only TikTok URLs are supported" },
      { status: 400 },
    );
  }

  const initialLookupUrl = canonicalizeTikTokLookupUrl(videoUrl);
  if (!initialLookupUrl) {
    return Response.json(
      { error: "Only TikTok URLs are supported" },
      { status: 400 },
    );
  }

  try {
    const initialCached = await cacheGet<TikTokVideoResult>(
      tiktokVideoCacheKey(initialLookupUrl),
    );
    if (
      hasTikTokVideoResultContent(initialCached) &&
      isTikTokVideoResultFresh(initialCached)
    ) {
      return Response.json(initialCached, {
        headers: { "Cache-Control": tiktokVideoCacheControl(initialCached) },
      });
    }
    if (await cacheGet<boolean>(tiktokGoneCacheKey(initialLookupUrl))) {
      return goneResponse();
    }

    // The provider chain resolves short links (cached), coalesces identical
    // concurrent lookups and backs off upstreams that refuse us.
    const lookup = await fetchTikTokProxyLookup(initialLookupUrl);
    const canonicalUrl =
      lookup.metadata?.canonicalUrl ?? lookup.baseline?.canonicalUrl ?? null;
    const cacheLookupUrls = new Set<string>([initialLookupUrl]);
    if (canonicalUrl) cacheLookupUrls.add(canonicalUrl);

    if (lookup.unavailable) {
      for (const lookupUrl of cacheLookupUrls) {
        cacheSet(tiktokGoneCacheKey(lookupUrl), true, TIKTOK_GONE_TTL).catch(
          () => {},
        );
      }
      return goneResponse();
    }

    const meta = lookup.metadata;
    const author = meta ?? lookup.baseline;
    const result: TikTokVideoResult = {
      videoUrl: meta?.videoUrl ?? null,
      coverUrl: meta?.coverUrl ?? null,
      canonicalUrl,
      postType: meta?.postType ?? lookup.baseline?.postType ?? null,
      title: meta?.title ?? null,
      authorName: author?.authorName ?? null,
      authorHandle: author?.authorHandle ?? null,
      authorAvatarUrl: meta?.authorAvatarUrl ?? null,
      media: meta?.media,
      audio: meta?.audio ?? null,
      likeCount: meta?.likeCount ?? null,
      commentCount: meta?.commentCount ?? null,
      viewCount: meta?.viewCount ?? null,
      shareCount: meta?.shareCount ?? null,
      timestamp: meta?.timestamp ?? null,
      restricted: lookup.restricted === true ? true : undefined,
    };

    if (!hasTikTokVideoResultContent(result)) {
      // Not confirmed gone: an upstream was down or returned nothing. The
      // client keeps the stored embed (or the player iframe) and honours
      // Retry-After instead of asking again on every mount.
      const retryAfter = lookup.transient
        ? TIKTOK_TRANSIENT_RETRY_AFTER
        : TIKTOK_EMPTY_RETRY_AFTER;
      return Response.json(
        {
          error: "Could not resolve TikTok media",
          retryAfter,
          transient: lookup.transient,
        },
        {
          status: lookup.transient ? 503 : 502,
          headers: {
            "Cache-Control": "no-store",
            "Retry-After": String(retryAfter),
          },
        },
      );
    }

    const kvTtl = tiktokVideoKvTtl(result);
    for (const lookupUrl of cacheLookupUrls) {
      cacheSet(tiktokVideoCacheKey(lookupUrl), result, kvTtl).catch(() => {});
    }

    return Response.json(result, {
      headers: { "Cache-Control": tiktokVideoCacheControl(result) },
    });
  } catch (e) {
    log.error("fetch failed:", e);
    return Response.json(
      { error: "Failed to resolve TikTok video" },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
};

export const Route = createFileRoute("/api/tiktok-video")({
  server: {
    handlers: { GET },
  },
});
