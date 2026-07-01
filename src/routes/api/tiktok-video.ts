import { createFileRoute } from "@tanstack/react-router";
import { cacheFetch } from "@/lib/cache";
import { fetchTikTokProxyMetadata } from "@/lib/share-preview-proxy";
import { clog } from "@/lib/console-logger";
import type { EmbedAudio, EmbedMedia } from "@/lib/types";

const log = clog("tiktok-video");

// Tikwm signed URLs are valid for ~1 hour. Cache for 50 minutes to stay fresh
// while minimising tikwm hits. KV key is just the canonical TikTok video URL.
const TIKTOK_VIDEO_TTL = 50 * 60; // 50 minutes in seconds

interface TikTokVideoResult {
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

function canonicalizeTikTokLookupUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    if (!parsed.hostname.toLowerCase().includes("tiktok.com")) return null;

    return `https://${parsed.hostname.toLowerCase()}${parsed.pathname}`;
  } catch {
    return null;
  }
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

  const canonicalUrl = canonicalizeTikTokLookupUrl(videoUrl);
  if (!canonicalUrl) {
    return Response.json({ error: "Only TikTok URLs are supported" }, { status: 400 });
  }
  const cacheKey = `v1:tiktok-video:${canonicalUrl}`;

  try {
    const result = await cacheFetch<TikTokVideoResult>(
      cacheKey,
      TIKTOK_VIDEO_TTL,
      async () => {
        const meta = await fetchTikTokProxyMetadata(canonicalUrl);
        return {
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
      }
    );

    if (!result.videoUrl && !result.media?.length && !result.coverUrl && !result.audio && !result.title) {
      return Response.json({ error: "Could not resolve TikTok media" }, { status: 404 });
    }

    return Response.json(result, {
      headers: {
        // Tell the browser/CF edge to cache for 45 min (slightly under KV TTL)
        "Cache-Control": "public, max-age=2700",
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
