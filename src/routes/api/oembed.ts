import { apiError, getDB } from "@/lib/api-helpers";
import { buildShareMetadata, buildShareOEmbed } from "@/lib/share-metadata";
import { ServiceError } from "@/lib/service-error";
import { getPublicWebUrl } from "@/lib/platform";
import { getPublicMessageShare } from "@/services/message-share.service";
import { createFileRoute } from "@tanstack/react-router";

function getShareTokenFromUrl(value: string, requestOrigin: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  const publicOrigin = getPublicWebUrl();
  const allowedOrigins = new Set([requestOrigin, publicOrigin, "https://ralph-meet.jontitor.workers.dev"]);
  if (!allowedOrigins.has(url.origin)) return null;

  const match = url.pathname.match(/^\/share\/([^/?#]+)$/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

const GET = async ({ request }: { request: Request }) => {
  const requestUrl = new URL(request.url);
  const shareUrl = requestUrl.searchParams.get("url");
  if (!shareUrl) {
    return apiError("Missing oEmbed url", 400, "MISSING_URL");
  }

  const token = getShareTokenFromUrl(shareUrl, requestUrl.origin);
  if (!token) {
    return apiError("Unsupported oEmbed url", 400, "UNSUPPORTED_URL");
  }

  try {
    const share = await getPublicMessageShare(getDB(), token, new Date(), { incrementView: false });
    const metadata = buildShareMetadata(getPublicWebUrl(), share);
    return Response.json(buildShareOEmbed(metadata), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/json+oembed; charset=utf-8",
        "X-Robots-Tag": share.allow_indexing ? "index, follow" : "noindex, nofollow",
      },
    });
  } catch (error) {
    if (error instanceof ServiceError) {
      return apiError(error.message, error.status, error.code);
    }
    throw error;
  }
};

export const Route = createFileRoute("/api/oembed")({
  server: {
    handlers: {
      GET,
    },
  },
});
