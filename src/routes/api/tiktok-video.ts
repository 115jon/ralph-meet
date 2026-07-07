import { createFileRoute } from "@tanstack/react-router";
import { cacheGet, cacheSet } from "@/lib/cache";
import { fetchTikTokProxyMetadata } from "@/lib/share-preview-proxy";
import { clog } from "@/lib/console-logger";
import type { EmbedAudio, EmbedMedia } from "@/lib/types";

const log = clog("tiktok-video");

// Tikwm signed URLs are valid for ~1 hour. Cache for 50 minutes to stay fresh
// while minimising tikwm hits. KV key is just the canonical TikTok video URL.
const TIKTOK_VIDEO_TTL = 50 * 60; // 50 minutes in seconds
const TIKTOK_VIDEO_CACHE_CONTROL = "public, max-age=2700";

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

async function resolveTikTokLookupUrl(rawUrl: string): Promise<string> {
  if (!isTikTokShortLookupUrl(rawUrl)) return rawUrl;

  try {
    const response = await fetch(rawUrl, {
      method: "HEAD",
      redirect: "follow",
      headers: {
        "Accept": "text/html,*/*;q=0.8",
        "User-Agent": "Mozilla/5.0 (compatible; RalphMeetBot/1.0; +https://meet.115jon.site)",
      },
    });

    const resolved = canonicalizeTikTokLookupUrl(response.url);
    return resolved ?? rawUrl;
  } catch {
    return rawUrl;
  }
}

export function hasTikTokVideoResultContent(result?: TikTokVideoResult | null): result is TikTokVideoResult {
  return !!(result && (
    result.videoUrl
    || result.media?.length
    || result.coverUrl
    || result.audio
    || result.title
  ));
}

const GET = async ({ request }: any) => {
  const url = new URL(request.url);
  const videoUrl = url.searchParams.get("videoUrl");

  if (!videoUrl) {
    return Response.json({ error: "Missing videoUrl parameter" }, { status: 400 });
  }

  // Validate it's actually a TikTok URL
  let parsed: URL;
  try {
    parsed = new URL(videoUrl);
  } catch {
    return Response.json({ error: "Invalid videoUrl" }, { status: 400 });
  }

  if (!parsed.hostname.toLowerCase().includes("tiktok.com")) {
    return Response.json({ error: "Only TikTok URLs are supported" }, { status: 400 });
  }

  const initialLookupUrl = canonicalizeTikTokLookupUrl(videoUrl);
  if (!initialLookupUrl) {
    return Response.json({ error: "Only TikTok URLs are supported" }, { status: 400 });
  }
  const canonicalUrl = canonicalizeTikTokLookupUrl(await resolveTikTokLookupUrl(initialLookupUrl));
  if (!canonicalUrl) {
    return Response.json({ error: "Only TikTok URLs are supported" }, { status: 400 });
  }
  const cacheKey = `v1:tiktok-video:${canonicalUrl}`;

  try {
    const cached = await cacheGet<TikTokVideoResult>(cacheKey);
    if (hasTikTokVideoResultContent(cached)) {
      return Response.json(cached, {
        headers: {
          "Cache-Control": TIKTOK_VIDEO_CACHE_CONTROL,
        },
      });
    }

    const meta = await fetchTikTokProxyMetadata(canonicalUrl);
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
      return Response.json({ error: "Could not resolve TikTok media" }, { status: 404 });
    }

    cacheSet(cacheKey, result, TIKTOK_VIDEO_TTL).catch(() => { });

    return Response.json(result, {
      headers: {
        // Tell the browser/CF edge to cache for 45 min (slightly under KV TTL)
        "Cache-Control": TIKTOK_VIDEO_CACHE_CONTROL,
      },
    });
  } catch (e) {
    log.error("fetch failed:", e);
    return Response.json({ error: "Failed to resolve TikTok video" }, { status: 502 });
  }
};

export const Route = createFileRoute("/api/tiktok-video")({
  server: {
    handlers: { GET },
  },
});
