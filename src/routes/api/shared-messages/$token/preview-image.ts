import { getDB } from "@/lib/api-helpers";
import { createTikTokSharePreviewPng } from "@/lib/share-preview-image";
import { fetchTikTokProxyMetadata, getTikTokShareUrl, getTikTokThumbnailUrl, proxyImage } from "@/lib/share-preview-proxy";
import { ServiceError } from "@/lib/service-error";
import { getPublicMessageShare } from "@/services/message-share.service";
import { createFileRoute } from "@tanstack/react-router";

const GET = async ({ params }: any) => {
  try {
    const share = await getPublicMessageShare(getDB(), params.token, new Date(), { incrementView: false });
    const thumbnailUrl = getTikTokThumbnailUrl(share);
    const tiktokUrl = getTikTokShareUrl(share);
    if (thumbnailUrl === null && tiktokUrl === null) {
      return new Response("Preview not found", { status: 404 });
    }

    let proxied = thumbnailUrl ? await proxyImage(thumbnailUrl) : null;
    if (proxied) return proxied;

    if (tiktokUrl) {
      const refreshed = await fetchTikTokProxyMetadata(tiktokUrl);
      if (refreshed?.coverUrl) {
        proxied = await proxyImage(refreshed.coverUrl);
        if (proxied) return proxied;
      }
    }

    const png = createTikTokSharePreviewPng();
    return new Response(png, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400",
        "Content-Length": png.byteLength.toString(),
        "Cross-Origin-Resource-Policy": "cross-origin",
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  } catch (error) {
    if (error instanceof ServiceError) {
      return new Response(error.message, { status: error.status });
    }
    throw error;
  }
};

export const Route = createFileRoute("/api/shared-messages/$token/preview-image")({
  server: {
    handlers: {
      GET,
    },
  },
});
