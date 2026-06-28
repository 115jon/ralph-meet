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

      if (!needsVideo && !needsThumbnail && !needsTitle) {
        return embed;
      }

      const resolved = needsVideo || needsThumbnail || needsTitle
        ? await resolveInstagramVideoMetadata(embed.url).catch(() => null)
        : null;

      const nextVideo = hasDirectVideo
        ? embed.video
        : resolved?.videoUrl
          ? buildInstagramVideoEmbed(resolved.videoUrl)
          : embed.video;

      const nextThumbnail = embed.thumbnail?.url
        ? embed.thumbnail
        : resolved?.thumbnailUrl
          ? {
              url: resolved.thumbnailUrl,
            }
          : embed.thumbnail;

      const nextTitle = embed.rawTitle ?? resolved?.title ?? undefined;

      if (nextVideo === embed.video && nextThumbnail === embed.thumbnail && nextTitle === embed.rawTitle) {
        return embed;
      }

      return {
        ...embed,
        rawTitle: nextTitle,
        thumbnail: nextThumbnail,
        video: nextVideo,
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
