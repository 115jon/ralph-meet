import {
  isInstagramWeakFallbackResult,
  resolveInstagramVideoMetadata,
} from "@/lib/instagram-video-resolver";
import {
  fetchTikTokProxyMetadata,
  lookupInstagramOEmbed,
} from "@/lib/share-preview-proxy";
import { isUnavailableSocialStatus } from "@/lib/social-embed-availability";
import type { MessageShare } from "@/services/message-share.service";
import { extractAndProcessEmbedsWithStatus } from "@/services/embed-fetcher";
import type { EmbedAuthor, EmbedInfo } from "@/lib/types";

function isInstagramEmbed(embed: EmbedInfo): boolean {
  const provider = embed.provider?.name?.toLowerCase();
  if (provider === "instagram") return true;

  try {
    return new URL(embed.url).hostname.toLowerCase().includes("instagram.com");
  } catch {
    return false;
  }
}

function buildInstagramVideoEmbed(videoUrl: string) {
  return {
    url: videoUrl,
    width: 720,
    height: 1280,
    kind: "direct" as const,
    contentType: "video/mp4",
  };
}

function isTikTokEmbed(embed: EmbedInfo): boolean {
  const provider = embed.provider?.name?.toLowerCase();
  if (provider === "tiktok") return true;

  try {
    return new URL(embed.url).hostname.toLowerCase().includes("tiktok.com");
  } catch {
    return false;
  }
}

function isXEmbed(embed: EmbedInfo): boolean {
  const provider = embed.provider?.name?.toLowerCase();
  if (provider === "x" || provider === "twitter") return true;

  try {
    return /(?:^|\.)(?:x|twitter|fxtwitter|fixupx|vxtwitter|fixvx)\.com$/i.test(
      new URL(embed.url).hostname,
    );
  } catch {
    return false;
  }
}

function makeTombstone(embed: EmbedInfo, fresh?: EmbedInfo): EmbedInfo {
  return {
    ...embed,
    unavailable: true,
    media: undefined,
    video: undefined,
    thumbnail: undefined,
    audio: undefined,
    externalCard: undefined,
    referencedTweet: undefined,
    rawTitle: undefined,
    rawDescription: undefined,
    provider: fresh?.provider ?? embed.provider,
    footer: fresh?.footer ?? embed.footer,
  };
}

function mergeAuthor(
  current: EmbedAuthor | undefined,
  nextName?: string,
  nextUrl?: string,
  nextIcon?: string,
  nextVerified?: boolean,
): EmbedAuthor | undefined {
  const name = nextName ?? current?.name;
  if (!name) return current;

  const url = nextUrl ?? current?.url;
  const iconURL = nextIcon ?? current?.iconURL;
  const isVerified = nextVerified ?? current?.isVerified;
  if (
    current &&
    name === current.name &&
    url === current.url &&
    iconURL === current.iconURL &&
    isVerified === current.isVerified
  ) {
    return current;
  }

  return {
    ...current,
    name,
    url,
    iconURL,
    isVerified,
  };
}

function buildTikTokVideoEmbed(videoUrl: string) {
  return {
    url: videoUrl,
    width: 720,
    height: 1280,
    kind: "direct" as const,
    contentType: "video/mp4",
  };
}

export async function hydrateInstagramEmbedsForShare(
  share: MessageShare,
): Promise<MessageShare> {
  const refreshedEmbeds = await hydrateSocialEmbeds(share.snapshot.embeds);

  if (refreshedEmbeds === share.snapshot.embeds) return share;

  return {
    ...share,
    snapshot: {
      ...share.snapshot,
      embeds: refreshedEmbeds,
    },
  };
}

export async function hydrateSocialEmbeds(
  embeds: EmbedInfo[],
): Promise<EmbedInfo[]> {
  const refreshedEmbeds = await Promise.all(
    embeds.map(async (embed) => {
      if (isInstagramEmbed(embed)) {
        const resolved = await resolveInstagramVideoMetadata(embed.url).catch(
          () => null,
        );
        const hasResolvedContent = Boolean(
          resolved?.videoUrl ||
          resolved?.thumbnailUrl ||
          resolved?.media?.length ||
          resolved?.title,
        );
        if (!hasResolvedContent) {
          const lookup = await lookupInstagramOEmbed(embed.url).catch(() => ({
            status: 0,
            metadata: null,
          }));
          if (isUnavailableSocialStatus(lookup.status)) {
            return makeTombstone(embed);
          }
          return embed;
        }

        const storedHasDirectMedia =
          (embed.media?.length ?? 0) > 1 ||
          Boolean(embed.media?.some((entry) => entry.type === "video")) ||
          Boolean(embed.video?.url && embed.video.kind !== "player");
        if (storedHasDirectMedia && isInstagramWeakFallbackResult(resolved)) {
          return embed;
        }

        const resolvedMedia = resolved?.media?.length
          ? resolved.media
          : embed.media;
        const firstVideo = resolvedMedia?.find(
          (entry) => entry.type === "video",
        );
        const firstMedia = resolvedMedia?.[0];

        const nextVideo = resolved?.videoUrl
          ? {
              ...buildInstagramVideoEmbed(resolved.videoUrl),
              width: firstVideo?.width ?? embed.video?.width ?? 720,
              height: firstVideo?.height ?? embed.video?.height ?? 1280,
              durationSeconds:
                resolved.durationSeconds ?? embed.video?.durationSeconds,
            }
          : embed.video;

        const nextThumbnailWidth =
          (firstMedia?.type === "image" ? firstMedia.width : undefined) ??
          embed.thumbnail?.width;
        const nextThumbnailHeight =
          (firstMedia?.type === "image" ? firstMedia.height : undefined) ??
          embed.thumbnail?.height;
        const nextThumbnail = resolved?.thumbnailUrl
          ? {
              url: resolved.thumbnailUrl,
              ...(nextThumbnailWidth !== undefined
                ? { width: nextThumbnailWidth }
                : {}),
              ...(nextThumbnailHeight !== undefined
                ? { height: nextThumbnailHeight }
                : {}),
            }
          : embed.thumbnail;

        const nextTitle = resolved?.title ?? embed.rawTitle ?? undefined;
        const nextAuthor = mergeAuthor(
          embed.author,
          resolved?.authorName ?? undefined,
          resolved?.authorUrl ?? undefined,
          resolved?.authorAvatarUrl ?? undefined,
          resolved?.authorVerified ?? undefined,
        );
        const nextMetricsComments =
          resolved?.commentCount ?? embed.metrics?.comments ?? undefined;
        const nextMetricsLikes =
          resolved?.likeCount ?? embed.metrics?.likes ?? undefined;
        const nextMetricsViews =
          resolved?.viewCount ?? embed.metrics?.views ?? undefined;
        const nextMetrics =
          nextMetricsComments !== undefined ||
          nextMetricsLikes !== undefined ||
          nextMetricsViews !== undefined ||
          embed.metrics
            ? nextMetricsComments === embed.metrics?.comments &&
              nextMetricsLikes === embed.metrics?.likes &&
              nextMetricsViews === embed.metrics?.views
              ? embed.metrics
              : {
                  ...embed.metrics,
                  comments: nextMetricsComments,
                  likes: nextMetricsLikes,
                  views: nextMetricsViews,
                }
            : embed.metrics;
        const nextTimestamp =
          resolved?.timestamp ?? embed.timestamp ?? undefined;
        const nextAudio = resolved?.audio ?? embed.audio ?? undefined;

        if (
          nextVideo === embed.video &&
          nextThumbnail === embed.thumbnail &&
          nextTitle === embed.rawTitle &&
          resolvedMedia === embed.media &&
          nextAuthor === embed.author &&
          nextMetrics === embed.metrics &&
          nextTimestamp === embed.timestamp &&
          nextAudio === embed.audio &&
          !embed.unavailable
        ) {
          return embed;
        }

        return {
          ...embed,
          unavailable: undefined,
          rawTitle: nextTitle,
          thumbnail: nextThumbnail,
          media: resolvedMedia,
          video: nextVideo,
          author: nextAuthor,
          metrics: nextMetrics,
          timestamp: nextTimestamp,
          audio: nextAudio,
        };
      }

      if (isTikTokEmbed(embed)) {
        const resolved = await fetchTikTokProxyMetadata(embed.url).catch(
          () => null,
        );
        if (
          !resolved ||
          (!resolved.videoUrl &&
            !resolved.coverUrl &&
            !resolved.media?.length &&
            !resolved.title)
        ) {
          const result = await extractAndProcessEmbedsWithStatus(embed.url);
          if (result.embeds[0]?.unavailable) {
            return makeTombstone(embed, result.embeds[0]);
          }
          return embed;
        }

        const resolvedMedia = resolved.media?.length
          ? resolved.media
          : embed.media;
        const firstVideo = resolvedMedia?.find(
          (entry) => entry.type === "video",
        );
        const firstMedia = resolvedMedia?.[0];
        const slideshowThumbnailUrl = firstVideo?.thumbnailUrl;
        const nextCoverUrl =
          resolved.postType === "slideshow"
            ? (slideshowThumbnailUrl ?? resolved.coverUrl)
            : resolved.coverUrl;
        const nextVideo = resolved.videoUrl
          ? {
              ...buildTikTokVideoEmbed(resolved.videoUrl),
              width: firstVideo?.width ?? 720,
              height: firstVideo?.height ?? 1280,
              durationSeconds:
                firstVideo?.durationSeconds ?? embed.video?.durationSeconds,
            }
          : embed.video;
        const nextThumbnail = nextCoverUrl
          ? {
              url: nextCoverUrl,
              width:
                firstMedia?.type === "image"
                  ? firstMedia.width
                  : (firstVideo?.width ?? embed.thumbnail?.width ?? 720),
              height:
                firstMedia?.type === "image"
                  ? firstMedia.height
                  : (firstVideo?.height ?? embed.thumbnail?.height ?? 1280),
            }
          : embed.thumbnail;
        const nextAuthor = mergeAuthor(
          embed.author,
          resolved.authorName,
          resolved.authorHandle
            ? `https://www.tiktok.com/@${resolved.authorHandle}`
            : undefined,
          resolved.authorAvatarUrl,
        );
        const nextMetricsComments =
          resolved.commentCount ?? embed.metrics?.comments ?? undefined;
        const nextMetricsLikes =
          resolved.likeCount ?? embed.metrics?.likes ?? undefined;
        const nextMetricsViews =
          resolved.viewCount ?? embed.metrics?.views ?? undefined;
        const nextMetrics =
          nextMetricsComments !== undefined ||
          nextMetricsLikes !== undefined ||
          nextMetricsViews !== undefined ||
          embed.metrics
            ? nextMetricsComments === embed.metrics?.comments &&
              nextMetricsLikes === embed.metrics?.likes &&
              nextMetricsViews === embed.metrics?.views
              ? embed.metrics
              : {
                  ...embed.metrics,
                  comments: nextMetricsComments,
                  likes: nextMetricsLikes,
                  views: nextMetricsViews,
                }
            : embed.metrics;
        const nextTimestamp =
          resolved.timestamp ?? embed.timestamp ?? undefined;
        const nextAudio = resolved.audio ?? embed.audio ?? undefined;
        const nextTitle = resolved.title ?? embed.rawTitle ?? undefined;
        const nextDescription =
          resolved.title ?? embed.rawDescription ?? undefined;

        if (
          nextVideo === embed.video &&
          nextThumbnail === embed.thumbnail &&
          nextTitle === embed.rawTitle &&
          nextDescription === embed.rawDescription &&
          resolvedMedia === embed.media &&
          nextAuthor === embed.author &&
          nextMetrics === embed.metrics &&
          nextTimestamp === embed.timestamp &&
          nextAudio === embed.audio &&
          !embed.unavailable
        ) {
          return embed;
        }

        return {
          ...embed,
          unavailable: undefined,
          rawTitle: nextTitle,
          rawDescription: nextDescription,
          thumbnail: nextThumbnail,
          media: resolvedMedia,
          video: nextVideo,
          author: nextAuthor,
          metrics: nextMetrics,
          timestamp: nextTimestamp,
          audio: nextAudio,
        };
      }

      if (!isXEmbed(embed)) return embed;

      const result = await extractAndProcessEmbedsWithStatus(embed.url);
      const fresh = result.embeds[0];
      if (fresh?.unavailable) {
        return makeTombstone(embed, fresh);
      }
      if (!fresh || result.hadFailures) return embed;

      return {
        ...fresh,
        id: embed.id,
        url: embed.url,
        unavailable: undefined,
      };
    }),
  );

  const changed = refreshedEmbeds.some(
    (embed, index) => embed !== embeds[index],
  );
  return changed ? refreshedEmbeds : embeds;
}
