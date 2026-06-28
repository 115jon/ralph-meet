import { createFileRoute } from "@tanstack/react-router";
import { clog } from "@/lib/console-logger";
import {
  canonicalizeInstagramUrl,
  resolveInstagramVideoMetadata,
} from "@/lib/instagram-video-resolver";
export {
  canonicalizeInstagramUrl,
  extractInstagramShortcode,
  extractInstagramVideoUrlsFromDashManifest,
  normalizeInstagramMediaPk,
  parseInstagramGraphqlPayload,
} from "@/lib/instagram-video-resolver";

const log = clog("instagram-video");

const GET = async ({ request }: any) => {
  const url = new URL(request.url);
  const videoUrl = url.searchParams.get("videoUrl");

  if (!videoUrl) {
    return Response.json({ error: "Missing videoUrl parameter" }, { status: 400 });
  }

  const canonicalUrl = canonicalizeInstagramUrl(videoUrl);
  if (!canonicalUrl) {
    return Response.json({ error: "Only Instagram URLs are supported" }, { status: 400 });
  }

  try {
    const result = await resolveInstagramVideoMetadata(canonicalUrl);
    if (!result?.videoUrl) {
      return Response.json({ error: "Could not resolve video URL" }, { status: 404 });
    }

    return Response.json(result, {
      headers: {
        "Cache-Control": "public, max-age=2700",
      },
    });
  } catch (error) {
    log.error("fetch failed:", error);
    return Response.json({ error: "Failed to resolve Instagram video" }, { status: 502 });
  }
};

export const Route = createFileRoute("/api/instagram-video")({
  server: {
    handlers: { GET },
  },
});
