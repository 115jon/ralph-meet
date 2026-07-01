import type { EmbedInfo } from "@/lib/types";
import { resolveInstagramVideoMetadata } from "@/lib/instagram-video-resolver";
import type { MessageShare } from "@/services/message-share.service";

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

export async function hydrateInstagramEmbedsForShare(share: MessageShare): Promise<MessageShare> {
  const refreshedEmbeds = await Promise.all(
    share.snapshot.embeds.map(async (embed) => {
      if (!isInstagramEmbed(embed)) return embed;

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

      const resolved = (
        needsVideo
        || needsThumbnail
        || needsTitle
        || needsMedia
        || needsAuthorAvatar
        || needsAuthorVerification
        || needsMetrics
        || needsTimestamp
        || needsAudio
      )
        ? await resolveInstagramVideoMetadata(embed.url).catch(() => null)
        : null;

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
    }),
  );

  const changed = refreshedEmbeds.some((embed, index) => embed !== share.snapshot.embeds[index]);
  if (!changed) return share;

  return {
    ...share,
    snapshot: {
      ...share.snapshot,
      embeds: refreshedEmbeds,
    },
  };
}
