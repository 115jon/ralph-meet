import { getDB } from "@/lib/api-helpers";
import { createTikTokSharePreviewPng } from "@/lib/share-preview-image";
import { fetchInstagramOEmbedMetadata, fetchTikTokProxyMetadata, getTikTokShareUrl, getTikTokThumbnailUrl, proxyImage } from "@/lib/share-preview-proxy";
import { ServiceError } from "@/lib/service-error";
import { getPublicMessageShare } from "@/services/message-share.service";
import { createFileRoute } from "@tanstack/react-router";

function getInstagramShareUrl(share: any): string | null {
  for (const embed of share.snapshot.embeds) {
    const provider = embed.provider?.name?.toLowerCase();
    try {
      const parsed = new URL(embed.url);
      if (provider === "instagram" || parsed.hostname.toLowerCase().includes("instagram.com")) {
        return parsed.toString();
      }
    } catch {
      // Ignore malformed embed URLs and continue scanning.
    }
  }

  return null;
}

function getInstagramThumbnailUrl(share: any): string | null {
  for (const embed of share.snapshot.embeds) {
    const provider = embed.provider?.name?.toLowerCase();
    let isInstagram = provider === "instagram";
    try {
      isInstagram = isInstagram || new URL(embed.url).hostname.toLowerCase().includes("instagram.com");
    } catch {
      // Ignore malformed embed URLs and continue scanning.
    }

    if (isInstagram) return embed.thumbnail?.url ?? null;
  }

  return null;
}

const GET = async ({ params }: any) => {
  try {
    const share = await getPublicMessageShare(getDB(), params.token, new Date(), { incrementView: false });
    const thumbnailUrl = getTikTokThumbnailUrl(share) ?? getInstagramThumbnailUrl(share);
    const tiktokUrl = getTikTokShareUrl(share);
    const instagramUrl = getInstagramShareUrl(share);
    if (thumbnailUrl === null && tiktokUrl === null && instagramUrl === null) {
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

    if (instagramUrl) {
      const refreshed = await fetchInstagramOEmbedMetadata(instagramUrl);
      if (refreshed?.thumbnailUrl) {
        proxied = await proxyImage(refreshed.thumbnailUrl);
        if (proxied) return proxied;
      }
    }

    const png = createTikTokSharePreviewPng();
    const body = new ArrayBuffer(png.byteLength);
    new Uint8Array(body).set(png);
    return new Response(body, {
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
