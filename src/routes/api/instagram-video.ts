import { createFileRoute } from "@tanstack/react-router";
import { cacheGet, cacheSet } from "@/lib/cache";
import { clog } from "@/lib/console-logger";
import {
  canonicalizeInstagramUrl,
  getInstagramMetadataCacheTtl,
  resolveInstagramVideoMetadata,
  type InstagramVideoResult,
} from "@/lib/instagram-video-resolver";
import { lookupInstagramOEmbed } from "@/lib/share-preview-proxy";
import { isUnavailableSocialStatus } from "@/lib/social-embed-availability";
export {
  canonicalizeInstagramUrl,
  extractInstagramShortcode,
  extractInstagramVideoUrlsFromDashManifest,
  normalizeInstagramMediaPk,
  parseInstagramGraphqlPayload,
} from "@/lib/instagram-video-resolver";

const log = clog("instagram-video");

/** Browser cache ceiling; the signed CDN URLs bound it further. */
const INSTAGRAM_BROWSER_CACHE_MAX_SECONDS = 45 * 60;
export const INSTAGRAM_GONE_TTL = 10 * 60;

function hasInstagramContent(
  result: InstagramVideoResult | null,
): result is InstagramVideoResult {
  return Boolean(
    result &&
    (result.videoUrl ||
      result.thumbnailUrl ||
      result.media?.length ||
      result.title),
  );
}

/**
 * Private, and never longer than the signed media URLs stay valid. It was
 * `public, max-age=2700` regardless of the signatures.
 */
export function instagramVideoCacheControl(
  result: InstagramVideoResult,
): string {
  const ttl = Math.min(
    INSTAGRAM_BROWSER_CACHE_MAX_SECONDS,
    getInstagramMetadataCacheTtl(result),
  );
  return ttl < 60 ? "no-store" : `private, max-age=${Math.floor(ttl)}`;
}

export function instagramGoneCacheKey(canonicalUrl: string): string {
  return `v1:instagram-video:gone:${canonicalUrl}`;
}

function goneResponse(): Response {
  return Response.json(
    { error: "This Instagram post is no longer available", unavailable: true },
    {
      status: 404,
      headers: { "Cache-Control": `private, max-age=${INSTAGRAM_GONE_TTL}` },
    },
  );
}

/**
 * Confirm a dead post through oEmbed before calling it gone, so a scrape
 * that only failed (expired session, rate limit) is not cached as a 404.
 */
async function isInstagramPostGone(canonicalUrl: string): Promise<boolean> {
  const lookup = await lookupInstagramOEmbed(canonicalUrl).catch(() => null);
  return lookup ? isUnavailableSocialStatus(lookup.status) : false;
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

  const canonicalUrl = canonicalizeInstagramUrl(videoUrl);
  if (!canonicalUrl) {
    return Response.json(
      { error: "Only Instagram URLs are supported" },
      { status: 400 },
    );
  }

  if (await cacheGet<boolean>(instagramGoneCacheKey(canonicalUrl))) {
    return goneResponse();
  }

  let result: InstagramVideoResult | null = null;
  let resolveError: unknown = null;
  try {
    result = await resolveInstagramVideoMetadata(canonicalUrl);
  } catch (error) {
    resolveError = error;
  }

  if (hasInstagramContent(result)) {
    return Response.json(result, {
      headers: { "Cache-Control": instagramVideoCacheControl(result) },
    });
  }

  if (await isInstagramPostGone(canonicalUrl)) {
    cacheSet(
      instagramGoneCacheKey(canonicalUrl),
      true,
      INSTAGRAM_GONE_TTL,
    ).catch(() => {});
    return goneResponse();
  }

  if (resolveError) log.error("fetch failed:", resolveError);
  return Response.json(
    {
      error: resolveError
        ? "Failed to resolve Instagram video"
        : "Could not resolve Instagram media",
    },
    { status: 502, headers: { "Cache-Control": "no-store" } },
  );
};

export const Route = createFileRoute("/api/instagram-video")({
  server: {
    handlers: { GET },
  },
});
