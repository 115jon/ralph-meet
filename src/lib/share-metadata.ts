import { isPlayableVideo } from "@/lib/media";
import type { Attachment, EmbedInfo } from "@/lib/types";
import type { MessageShare } from "@/services/message-share.service";

const DEFAULT_DESCRIPTION = "A shared Ralph Meet message snapshot.";
const MAX_DESCRIPTION_LENGTH = 220;
const MAX_TITLE_LENGTH = 80;
const URL_ONLY_REGEX = /^https?:\/\/\S+$/i;

export interface SharePreviewMedia {
  type: "image" | "video";
  url: string;
  contentType?: string;
  width?: number;
  height?: number;
}

interface SelectedEmbed {
  embed: EmbedInfo;
  media?: SharePreviewMedia;
}

export interface ShareMetadata {
  title: string;
  description: string;
  authorName: string;
  authorUrl?: string;
  providerName: string;
  providerUrl: string;
  shareUrl: string;
  oembedUrl: string;
  thumbnailUrl?: string;
  robots: string;
  media?: SharePreviewMedia;
  color?: string;
}

function truncate(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function stripMarkdown(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_~>#]/g, "")
    .replace(/https?:\/\/\S+/g, (url) => url.replace(/[),.;!?]+$/, ""));
}

function cleanContent(value: string): string {
  const stripped = stripMarkdown(value);
  return URL_ONLY_REGEX.test(stripped.trim()) ? "" : stripped;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function displayAuthor(share: MessageShare): string {
  return share.snapshot.author.display_name || share.snapshot.author.username || "Unknown";
}

function encodeMediaPath(fileKey: string): string {
  return fileKey
    .replace(/^attachments\//, "")
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

export function getShareMediaUrl(origin: string, token: string, attachment: Attachment): string {
  return `${origin}/api/shared-messages/${encodeURIComponent(token)}/media/${encodeMediaPath(attachment.file_key)}`;
}

function firstAttachmentMedia(origin: string, share: MessageShare): SharePreviewMedia | undefined {
  const attachment =
    share.snapshot.attachments.find((item) => item.content_type?.startsWith("image/")) ??
    share.snapshot.attachments.find((item) => isPlayableVideo(item.content_type));

  if (!attachment) return undefined;
  const contentType = attachment.content_type;
  return {
    type: contentType?.startsWith("video/") ? "video" : "image",
    url: getShareMediaUrl(origin, share.token, attachment),
    contentType,
  };
}

function mediaFromEmbed(origin: string, embed: EmbedInfo): SharePreviewMedia | undefined {
  let hostname = "";
  try {
    hostname = new URL(embed.url).hostname.toLowerCase();
  } catch {
    hostname = "";
  }

  if (embed.provider?.name?.toLowerCase() === "tiktok" || hostname.includes("tiktok.com")) {
    if (embed.video?.url) {
      const proxyUrl = `${origin}/api/proxy-media?url=${encodeURIComponent(embed.video.url)}&sourceUrl=${encodeURIComponent(embed.url)}`;
      return {
        type: "video",
        url: proxyUrl,
        contentType: embed.video.contentType || "video/mp4",
        width: embed.video.width,
        height: embed.video.height,
      };
    }
    return {
      type: "image",
      url: "",
      width: 600,
      height: 315,
    };
  }

  if (embed.video?.url && embed.video.kind !== "player") {
    return {
      type: "video",
      url: embed.video.url,
      contentType: embed.video.contentType || "video/mp4",
      width: embed.video.width,
      height: embed.video.height,
    };
  }

  if (embed.thumbnail?.url) {
    return {
      type: "image",
      url: embed.thumbnail.url,
      width: embed.thumbnail.width,
      height: embed.thumbnail.height,
    };
  }

  if (embed.type === "image" && embed.url) {
    return {
      type: "image",
      url: embed.url,
      width: embed.thumbnail?.width,
      height: embed.thumbnail?.height,
    };
  }

  return undefined;
}

function selectEmbedPreview(origin: string, embeds: EmbedInfo[]): SelectedEmbed | undefined {
  for (const embed of embeds) {
    const media = mediaFromEmbed(origin, embed);
    if (media?.type === "video") return { embed, media };
  }

  for (const embed of embeds) {
    const media = mediaFromEmbed(origin, embed);
    if (media) return { embed, media };
  }

  const embed = embeds.find((item) => item.rawTitle || item.rawDescription || item.author?.name || item.provider?.name);
  return embed ? { embed } : undefined;
}

function titleFromEmbed(embed: EmbedInfo | undefined): string | undefined {
  return embed?.rawTitle ?? embed?.author?.name ?? embed?.provider?.name;
}

function descriptionFromEmbed(embed: EmbedInfo | undefined): string | undefined {
  return embed?.rawDescription ?? embed?.rawTitle ?? embed?.author?.name;
}

export function buildShareMetadata(origin: string, share: MessageShare): ShareMetadata {
  const authorName = displayAuthor(share);
  const rawCleanedContent = cleanContent(share.snapshot.content);
  const cleanedContent = truncate(rawCleanedContent, MAX_DESCRIPTION_LENGTH);
  const selectedEmbed = selectEmbedPreview(origin, share.snapshot.embeds);
  const embedTitle = titleFromEmbed(selectedEmbed?.embed);
  const embedDescription = descriptionFromEmbed(selectedEmbed?.embed);
  const isLinkOnlyShare = !rawCleanedContent && !!selectedEmbed;
  const title = truncate(isLinkOnlyShare ? embedTitle || "Shared link" : cleanedContent || "Shared message", MAX_TITLE_LENGTH);
  const description = truncate(
    isLinkOnlyShare
      ? embedDescription || DEFAULT_DESCRIPTION
      : embedDescription
        ? `${authorName}: ${cleanedContent || embedDescription}`
        : cleanedContent || DEFAULT_DESCRIPTION,
    MAX_DESCRIPTION_LENGTH
  );
  const shareUrl = `${origin}/share/${encodeURIComponent(share.token)}`;
  const oembedUrl = `${origin}/api/oembed?url=${encodeURIComponent(shareUrl)}`;

  let embedColor = selectedEmbed?.embed?.color;
  if (!embedColor && selectedEmbed?.embed?.provider?.name) {
    const providerStr = selectedEmbed.embed.provider.name.toLowerCase();
    if (providerStr === "tiktok") embedColor = "#ff0050";
    else if (providerStr === "youtube") embedColor = "#ff0000";
    else if (providerStr === "twitter" || providerStr === "x") embedColor = "#1da1f2";
    else if (providerStr === "twitch") embedColor = "#9146ff";
    else if (providerStr === "github") embedColor = "#24292e";
    else if (providerStr === "spotify") embedColor = "#1db954";
  }

  let providerName = "Ralph Meet";
  let providerUrl = origin;
  let finalAuthorName = authorName;
  let authorUrl: string | undefined;

  if (isLinkOnlyShare && selectedEmbed?.embed) {
    if (selectedEmbed.embed.provider?.name) providerName = selectedEmbed.embed.provider.name;
    if (selectedEmbed.embed.provider?.url) providerUrl = selectedEmbed.embed.provider.url;
    if (selectedEmbed.embed.author?.name) finalAuthorName = selectedEmbed.embed.author.name;
    if (selectedEmbed.embed.author?.url) authorUrl = selectedEmbed.embed.author.url;
  }

  const metadata: ShareMetadata = {
    title,
    description,
    authorName: finalAuthorName,
    authorUrl,
    providerName,
    providerUrl,
    shareUrl,
    oembedUrl,
    robots: share.allow_indexing ? "index, follow" : "noindex, nofollow",
    media: firstAttachmentMedia(origin, share) ?? selectedEmbed?.media,
    thumbnailUrl: selectedEmbed?.embed?.thumbnail?.url,
    color: embedColor,
  };

  if (metadata.media?.url === "" && selectedEmbed?.embed) {
    metadata.media.url = `${origin}/api/shared-messages/${encodeURIComponent(share.token)}/preview-image`;
  }

  return metadata;
}

export function buildShareOEmbed(metadata: ShareMetadata) {
  const media = metadata.media;
  const html = `<blockquote><strong>${escapeHtml(metadata.authorName)}</strong>: ${escapeHtml(metadata.description)}</blockquote>`;

  return {
    version: "1.0",
    type: media?.type === "image" ? "photo" : "rich",
    provider_name: metadata.providerName,
    provider_url: metadata.providerUrl,
    title: metadata.title,
    author_name: metadata.authorName,
    author_url: metadata.authorUrl,
    url: media?.type === "image" ? media.url : metadata.shareUrl,
    html,
    width: media?.width ?? 520,
    height: media?.height ?? 320,
    thumbnail_url: metadata.thumbnailUrl ?? (media?.type === "image" ? media.url : undefined),
    thumbnail_width: media?.width,
    thumbnail_height: media?.height,
  };
}
