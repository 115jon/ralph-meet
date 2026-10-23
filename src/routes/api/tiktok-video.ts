import { getBotUserAgent } from "@/lib/platform";
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
/** A post TikTok confirmed gone: remember it so every view is not a lookup. */
export const TIKTOK_GONE_TTL = 10 * 60;
const TIKTOK_GONE_CACHE_CONTROL = `private, max-age=${TIKTOK_GONE_TTL}`;

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

export function buildTikTokMetadataLookupUrls(
  initialLookupUrl: string,
  resolvedLookupUrl?: string | null,
): string[] {
  const urls = [initialLookupUrl];

  if (resolvedLookupUrl && resolvedLookupUrl !== initialLookupUrl) {
    urls.push(resolvedLookupUrl);
  }

  return urls;
}

async function resolveTikTokLookupUrl(rawUrl: string): Promise<string> {
  if (!isTikTokShortLookupUrl(rawUrl)) return rawUrl;

  try {
    const response = await fetch(rawUrl, {
      method: "HEAD",
      redirect: "follow",
      headers: {
        Accept: "text/html,*/*;q=0.8",
        "User-Agent": getBotUserAgent(),
      },
    });

    const resolved = canonicalizeTikTokLookupUrl(response.url);
    return resolved ?? rawUrl;
  } catch {
    return rawUrl;
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
      result.title)
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

export function tiktokVideoCacheKey(lookupUrl: string): string {
  return `v1:tiktok-video:${lookupUrl}`;
}

export function tiktokGoneCacheKey(lookupUrl: string): string {
  return `v1:tiktok-video:gone:${lookupUrl}`;
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
    // Hits for the URL as given skip the short-link HEAD round trip.
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

    const resolvedLookupUrl = canonicalizeTikTokLookupUrl(
      await resolveTikTokLookupUrl(initialLookupUrl),
    );
    if (!resolvedLookupUrl) {
      return Response.json(
        { error: "Only TikTok URLs are supported" },
        { status: 400 },
      );
    }
    const lookupUrls = buildTikTokMetadataLookupUrls(
      initialLookupUrl,
      resolvedLookupUrl,
    );

    if (resolvedLookupUrl !== initialLookupUrl) {
      const cached = await cacheGet<TikTokVideoResult>(
        tiktokVideoCacheKey(resolvedLookupUrl),
      );
      if (
        hasTikTokVideoResultContent(cached) &&
        isTikTokVideoResultFresh(cached)
      ) {
        return Response.json(cached, {
          headers: { "Cache-Control": tiktokVideoCacheControl(cached) },
        });
      }
    }

    let meta = null;
    let unavailable = false;
    let transient = false;
    for (const lookupUrl of lookupUrls) {
      const lookup = await fetchTikTokProxyLookup(lookupUrl);
      if (lookup.metadata) {
        meta = lookup.metadata;
        break;
      }
      unavailable ||= lookup.unavailable;
      transient ||= lookup.transient;
    }

    if (!meta && unavailable) {
      for (const lookupUrl of lookupUrls) {
        cacheSet(tiktokGoneCacheKey(lookupUrl), true, TIKTOK_GONE_TTL).catch(
          () => {},
        );
      }
      return goneResponse();
    }

    const result: TikTokVideoResult = {
      videoUrl: meta?.videoUrl ?? null,
      coverUrl: meta?.coverUrl ?? null,
      canonicalUrl: meta?.canonicalUrl ?? null,
      postType: meta?.postType ?? null,
      title: meta?.title ?? null,
      authorName: meta?.authorName ?? null,
      authorHandle: meta?.authorHandle ?? null,
      authorAvatarUrl: meta?.authorAvatarUrl ?? null,
      media: meta?.media,
      audio: meta?.audio ?? null,
      likeCount: meta?.likeCount ?? null,
      commentCount: meta?.commentCount ?? null,
      viewCount: meta?.viewCount ?? null,
      shareCount: meta?.shareCount ?? null,
      timestamp: meta?.timestamp ?? null,
    };

    if (!hasTikTokVideoResultContent(result)) {
      // Not confirmed gone: an upstream was down or returned nothing. The
      // client keeps the stored embed (or the player iframe) and may retry.
      return Response.json(
        { error: "Could not resolve TikTok media" },
        {
          status: transient ? 503 : 502,
          headers: {
            "Cache-Control": "no-store",
            ...(transient ? { "Retry-After": "60" } : {}),
          },
        },
      );
    }

    const cacheLookupUrls = new Set<string>(lookupUrls);
    if (meta?.canonicalUrl) {
      cacheLookupUrls.add(meta.canonicalUrl);
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
