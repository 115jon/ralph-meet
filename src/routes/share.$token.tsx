import SharedMessagePage from "@/components/chat/SharedMessagePage";
import { getDB } from "@/lib/api-helpers";
import { hydrateInstagramEmbedsForShare } from "@/lib/share-embed-refresh";
import { buildShareMetadata } from "@/lib/share-metadata";
import { ServiceError } from "@/lib/service-error";
import { getPublicWebUrl } from "@/lib/platform";
import { getPublicMessageShare, type MessageShare } from "@/services/message-share.service";
import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";

interface ShareLoaderData {
  share: MessageShare | null;
  gone: boolean;
  origin: string;
}

const loadPublicShare = createServerFn({ method: "GET" })
  .inputValidator((data: { token: string }) => data)
  .handler(async ({ data }): Promise<ShareLoaderData> => {
    const origin = getPublicWebUrl();
    const token = typeof data?.token === "string" ? data.token : "";
    try {
      const share = await hydrateInstagramEmbedsForShare(
        await getPublicMessageShare(getDB(), token, new Date(), { incrementView: false }),
      );
      return { share, gone: false, origin };
    } catch (error) {
      if (error instanceof ServiceError && (error.status === 404 || error.status === 410)) {
        return { share: null, gone: true, origin };
      }
      throw error;
    }
  });

function shareHead(data?: ShareLoaderData) {
  if (!data?.share) {
    return {
      meta: [
        { title: "Shared Message - Ralph Meet" },
        { name: "robots", content: "noindex, nofollow" },
        { name: "description", content: "This Ralph Meet message share is unavailable." },
        { property: "og:title", content: "Shared Message - Ralph Meet" },
        { property: "og:description", content: "This Ralph Meet message share is unavailable." },
        { property: "og:site_name", content: "Ralph Meet" },
      ],
    };
  }

  const metadata = buildShareMetadata(data.origin, data.share);
  const media = metadata.media;
  const isInstagramMinimal = metadata.cardMode === "instagram-minimal";
  const imageMediaUrl =
    media?.type === "image"
      ? media.url
      : data.share.snapshot.embeds.find((embed) => embed.video?.url === media?.url && embed.thumbnail?.url)?.thumbnail?.url ??
        data.share.snapshot.embeds.find((embed) => embed.thumbnail?.url)?.thumbnail?.url;
  const meta = [
    { title: metadata.title },
    { name: "robots", content: metadata.robots },
    { property: "og:type", content: isInstagramMinimal && media?.type === "video" ? "video.other" : "article" },
    { property: "og:title", content: metadata.title },
    { property: "og:url", content: metadata.shareUrl },
    { name: "twitter:card", content: media ? "summary_large_image" : "summary" },
  ];

  if (metadata.description) {
    meta.push(
      { name: "description", content: metadata.description },
      { property: "og:description", content: metadata.description },
      { name: "twitter:description", content: metadata.description },
    );
  }

  if (!isInstagramMinimal) {
    meta.push(
      { property: "og:site_name", content: metadata.providerName },
      { name: "twitter:title", content: metadata.title },
    );
  }

  if (metadata.color) {
    meta.push({ name: "theme-color", content: metadata.color });
  }

  if (imageMediaUrl) {
    meta.push(
      { property: "og:image", content: imageMediaUrl },
      { property: "og:image:secure_url", content: imageMediaUrl },
      { name: "twitter:image", content: imageMediaUrl }
    );
    if (media?.width) {
      meta.push({ property: "og:image:width", content: media.width.toString() });
    }
    if (media?.height) {
      meta.push({ property: "og:image:height", content: media.height.toString() });
    }
  }

  if (media?.type === "video") {
    meta.push(
      { property: "og:video", content: media.url },
      { property: "og:video:secure_url", content: media.url },
      { property: "og:video:url", content: media.url },
      { name: "twitter:player:stream", content: media.url },
      { name: "twitter:player:width", content: (media.width ?? 480).toString() },
      { name: "twitter:player:height", content: (media.height ?? 600).toString() }
    );
    if (media.width) {
      meta.push({ property: "og:video:width", content: media.width.toString() });
    }
    if (media.height) {
      meta.push({ property: "og:video:height", content: media.height.toString() });
    }
    if (media.contentType) {
      meta.push(
        { property: "og:video:type", content: media.contentType },
        { name: "twitter:player:stream:content_type", content: media.contentType }
      );
    }
  }

  return {
    meta,
    links: [
      {
        rel: "alternate",
        type: "application/json+oembed",
        href: metadata.oembedUrl,
        title: "Ralph Meet shared message",
      },
    ],
  };
}

export const Route = createFileRoute("/share/$token")({
  loader: ({ params }) => loadPublicShare({ data: { token: params.token } }),
  component: SharedMessageRoute,
  head: ({ loaderData }) => shareHead(loaderData),
});

function SharedMessageRoute() {
  const { token } = Route.useParams();
  const data = Route.useLoaderData();
  return <SharedMessagePage token={token} initialShare={data.share} initialGone={data.gone} />;
}
