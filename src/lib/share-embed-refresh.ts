import { resolveInstagramVideoMetadata } from "@/lib/instagram-video-resolver";
import { fetchTikTokProxyMetadata } from "@/lib/share-preview-proxy";
import type { MessageShare } from "@/services/message-share.service";
import type { EmbedInfo } from "@/lib/types";

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

function buildTikTokVideoEmbed(videoUrl: string) {
  return {
    url: videoUrl,
    width: 720,
    height: 1280,
    kind: "direct" as const,
    contentType: "video/mp4",
  };
}

export async function hydrateInstagramEmbedsForShare(share: MessageShare): Promise<MessageShare> {
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

export async function hydrateSocialEmbeds(embeds: EmbedInfo[]): Promise<EmbedInfo[]> {
  const refreshedEmbeds = await Promise.all(
    embeds.map(async (embed) => {
      if (isInstagramEmbed(embed)) {
        const hasDirectVideo = !!embed.video?.url && embed.video.kind !== "player";
        const needsVideo = !hasDirectVideo;
        const needsThumbnail = !embed.thumbnail?.url;
        const needsTitle = !embed.rawTitle;
        const needsMedia = !embed.media?.length;
        const needsAuthorAvatar = !embed.author?.iconURL;
        const needsAuthorVerification = embed.author?.isVerified === undefined;
        const needsMetrics = !embed.metrics || (
          embed.metrics.likes === undefined
          && embed.metrics.comments === undefined
          && embed.metrics.views === undefined
        );
        const needsTimestamp = !embed.timestamp;
        const needsAudio = !embed.audio;

        if (
          !needsVideo
          && !needsThumbnail
          && !needsTitle
          && !needsMedia
          && !needsAuthorAvatar
          && !needsAuthorVerification
          && !needsMetrics
          && !needsTimestamp
          && !needsAudio
        ) {
          return embed;
        }

        const resolved = await resolveInstagramVideoMetadata(embed.url).catch(() => null);
        const resolvedMedia = resolved?.media?.length ? resolved.media : embed.media;
        const firstVideo = resolvedMedia?.find((entry) => entry.type === "video");
        const firstMedia = resolvedMedia?.[0];

        const nextVideo = hasDirectVideo
          ? embed.video
          : resolved?.videoUrl
            ? {
                ...buildInstagramVideoEmbed(resolved.videoUrl),
                width: firstVideo?.width ?? 720,
                height: firstVideo?.height ?? 1280,
                durationSeconds: resolved.durationSeconds ?? undefined,
              }
            : embed.video;

        const nextThumbnail = embed.thumbnail?.url
          ? embed.thumbnail
          : resolved?.thumbnailUrl
            ? {
                url: resolved.thumbnailUrl,
                width: firstMedia?.type === "image" ? firstMedia.width : embed.thumbnail?.width,
                height: firstMedia?.type === "image" ? firstMedia.height : embed.thumbnail?.height,
              }
            : embed.thumbnail;

        const nextTitle = embed.rawTitle ?? resolved?.title ?? undefined;
        const nextAuthorIcon = embed.author?.iconURL ?? resolved?.authorAvatarUrl ?? undefined;
        const nextAuthorVerified = embed.author?.isVerified ?? resolved?.authorVerified ?? undefined;
        const nextAuthor = embed.author
          ? (
              nextAuthorIcon !== embed.author.iconURL || nextAuthorVerified !== embed.author.isVerified
                ? {
                    ...embed.author,
                    iconURL: nextAuthorIcon,
                    isVerified: nextAuthorVerified,
                  }
                : embed.author
            )
          : embed.author;
        const nextMetricsComments = embed.metrics?.comments ?? resolved?.commentCount ?? undefined;
        const nextMetricsLikes = embed.metrics?.likes ?? resolved?.likeCount ?? undefined;
        const nextMetricsViews = embed.metrics?.views ?? resolved?.viewCount ?? undefined;
        const nextMetrics = (
          nextMetricsComments !== undefined
          || nextMetricsLikes !== undefined
          || nextMetricsViews !== undefined
          || embed.metrics
        )
          ? (
              nextMetricsComments === embed.metrics?.comments
              && nextMetricsLikes === embed.metrics?.likes
              && nextMetricsViews === embed.metrics?.views
                ? embed.metrics
                : {
                    ...embed.metrics,
                    comments: nextMetricsComments,
                    likes: nextMetricsLikes,
                    views: nextMetricsViews,
                  }
            )
          : embed.metrics;
        const nextTimestamp = embed.timestamp ?? resolved?.timestamp ?? undefined;
        const nextAudio = embed.audio ?? resolved?.audio ?? undefined;

        if (
          nextVideo === embed.video
          && nextThumbnail === embed.thumbnail
          && nextTitle === embed.rawTitle
          && resolvedMedia === embed.media
          && nextAuthor === embed.author
          && nextMetrics === embed.metrics
          && nextTimestamp === embed.timestamp
          && nextAudio === embed.audio
        ) {
          return embed;
        }

        return {
          ...embed,
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

      if (!isTikTokEmbed(embed)) return embed;

      const hasDirectVideo = !!embed.video?.url && embed.video.kind !== "player";
      const needsVideo = !hasDirectVideo;
      const needsThumbnail = !embed.thumbnail?.url;
      const needsTitle = !embed.rawTitle;
      const needsDescription = !embed.rawDescription;
      const needsMedia = !embed.media?.length;
      const needsAuthorName = !embed.author?.name;
      const needsAuthorUrl = !embed.author?.url;
      const needsAuthorAvatar = !embed.author?.iconURL;
      const needsMetrics = !embed.metrics || (
        embed.metrics.likes === undefined
        && embed.metrics.comments === undefined
        && embed.metrics.views === undefined
      );
      const needsTimestamp = !embed.timestamp;
      const needsAudio = !embed.audio;

      if (
        !needsVideo
        && !needsThumbnail
        && !needsTitle
        && !needsDescription
        && !needsMedia
        && !needsAuthorName
        && !needsAuthorUrl
        && !needsAuthorAvatar
        && !needsMetrics
        && !needsTimestamp
        && !needsAudio
      ) {
        return embed;
      }

      const resolved = await fetchTikTokProxyMetadata(embed.url).catch(() => null);
      if (!resolved) return embed;

      const resolvedMedia = resolved.media?.length ? resolved.media : embed.media;
      const firstVideo = resolvedMedia?.find((entry) => entry.type === "video");
      const firstMedia = resolvedMedia?.[0];
      const slideshowThumbnailUrl = firstVideo?.thumbnailUrl;
      const nextVideo = hasDirectVideo
        ? embed.video
        : resolved.videoUrl
          ? {
              ...buildTikTokVideoEmbed(resolved.videoUrl),
              width: firstVideo?.width ?? 720,
              height: firstVideo?.height ?? 1280,
              durationSeconds: embed.video?.durationSeconds ?? firstVideo?.durationSeconds,
            }
          : embed.video;
      const nextThumbnail = embed.thumbnail?.url
        ? embed.thumbnail
        : (resolved.postType === "slideshow"
          ? slideshowThumbnailUrl ?? resolved.coverUrl
          : resolved.coverUrl)
          ? {
              url: (resolved.postType === "slideshow"
                ? slideshowThumbnailUrl ?? resolved.coverUrl
                : resolved.coverUrl)!,
              width: embed.thumbnail?.width ?? (firstMedia?.type === "image" ? firstMedia.width : firstVideo?.width) ?? 720,
              height: embed.thumbnail?.height ?? (firstMedia?.type === "image" ? firstMedia.height : firstVideo?.height) ?? 1280,
            }
          : embed.thumbnail;
      const nextAuthorName = embed.author?.name ?? resolved.authorName ?? undefined;
      const nextAuthorUrl = embed.author?.url ?? (resolved.authorHandle ? `https://www.tiktok.com/@${resolved.authorHandle}` : undefined);
      const nextAuthorIcon = embed.author?.iconURL ?? resolved.authorAvatarUrl ?? undefined;
      const nextAuthor = nextAuthorName
        ? {
            ...embed.author,
            name: nextAuthorName,
            url: nextAuthorUrl,
            iconURL: nextAuthorIcon,
          }
        : embed.author;
      const nextMetricsComments = embed.metrics?.comments ?? resolved.commentCount ?? undefined;
      const nextMetricsLikes = embed.metrics?.likes ?? resolved.likeCount ?? undefined;
      const nextMetricsViews = embed.metrics?.views ?? resolved.viewCount ?? undefined;
      const nextMetrics = (
        nextMetricsComments !== undefined
        || nextMetricsLikes !== undefined
        || nextMetricsViews !== undefined
        || embed.metrics
      )
        ? (
            nextMetricsComments === embed.metrics?.comments
            && nextMetricsLikes === embed.metrics?.likes
            && nextMetricsViews === embed.metrics?.views
              ? embed.metrics
              : {
                  ...embed.metrics,
                  comments: nextMetricsComments,
                  likes: nextMetricsLikes,
                  views: nextMetricsViews,
                }
          )
        : embed.metrics;
      const nextTimestamp = embed.timestamp ?? resolved.timestamp ?? undefined;
      const nextAudio = embed.audio ?? resolved.audio ?? undefined;
      const nextTitle = embed.rawTitle ?? resolved.title ?? undefined;
      const nextDescription = embed.rawDescription ?? resolved.title ?? undefined;

      if (
        nextVideo === embed.video
        && nextThumbnail === embed.thumbnail
        && nextTitle === embed.rawTitle
        && nextDescription === embed.rawDescription
        && resolvedMedia === embed.media
        && nextAuthor === embed.author
        && nextMetrics === embed.metrics
        && nextTimestamp === embed.timestamp
        && nextAudio === embed.audio
      ) {
        return embed;
      }

      return {
        ...embed,
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
    }),
  );

  const changed = refreshedEmbeds.some((embed, index) => embed !== embeds[index]);
  return changed ? refreshedEmbeds : embeds;
}
