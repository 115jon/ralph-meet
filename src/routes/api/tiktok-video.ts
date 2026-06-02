import { createFileRoute } from "@tanstack/react-router";
import { cacheFetch } from "@/lib/cache";
import { fetchTikTokProxyMetadata } from "@/lib/share-preview-proxy";

// Tikwm signed URLs are valid for ~1 hour. Cache for 50 minutes to stay fresh
// while minimising tikwm hits. KV key is just the canonical TikTok video URL.
const TIKTOK_VIDEO_TTL = 50 * 60; // 50 minutes in seconds

interface TikTokVideoResult {
  videoUrl: string | null;
  coverUrl: string | null;
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

  // Strip tracking params to maximise cache hit rate — only keep the path
  const canonicalUrl = `https://www.tiktok.com${parsed.pathname}`;
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
        };
      }
    );

    if (!result.videoUrl) {
      return Response.json({ error: "Could not resolve video URL" }, { status: 404 });
    }

    return Response.json(result, {
      headers: {
        // Tell the browser/CF edge to cache for 45 min (slightly under KV TTL)
        "Cache-Control": "public, max-age=2700",
      },
    });
  } catch (e) {
    console.error("[tiktok-video] fetch failed:", e);
    return Response.json({ error: "Failed to resolve TikTok video" }, { status: 502 });
  }
};

export const Route = createFileRoute("/api/tiktok-video")({
  server: {
    handlers: { GET },
  },
});
