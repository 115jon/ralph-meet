import type { Attachment, Embed, Message } from "../schema";
import { playableUrl } from "./sources";

// Sorts a message's attachments and link previews into what the row draws.
// Shapes follow the web's EmbedInfo (src/lib/types.ts) and the server's
// embed fetcher; every field is optional, so an old row still draws.

interface MediaBase {
  readonly key: string;
  readonly label: string;
  readonly width?: number;
  readonly height?: number;
}

/** A picture; GIFs and animated WebP play only while on screen. */
export interface ImageMedia extends MediaBase {
  readonly kind: "image";
  readonly url: string;
  readonly animated: boolean;
}

/**
 * A playable file. A "loop" is a GIF sent as video (KLIPY, Tenor, X): it
 * plays silently on repeat while on screen. A "video" waits for a tap and
 * plays with sound.
 */
export interface VideoMedia extends MediaBase {
  readonly kind: "loop" | "video";
  readonly url: string;
  readonly poster?: string;
  readonly durationSeconds?: number;
  /** The post it came from, opened instead if the file will not play. */
  readonly post?: string;
}

/** A video only its own site can play (YouTube, TikTok's player): opens the link. */
export interface LinkOutMedia extends MediaBase {
  readonly kind: "link";
  readonly url: string;
  readonly poster: string;
}

export type Media = ImageMedia | VideoMedia | LinkOutMedia;

export interface LinkCard {
  readonly key: string;
  readonly embed: Embed;
  readonly media: Media | null;
}

export interface MessageMedia {
  /** Drawn bare under the text: attachments and links that are the media itself. */
  readonly bare: readonly Media[];
  /** Other attachments, as file rows. */
  readonly files: readonly Attachment[];
  /** Link previews, each with its own optional picture or video. */
  readonly cards: readonly LinkCard[];
}

const ANIMATED_IMAGE_TYPES = new Set(["image/gif", "image/webp", "image/apng"]);
// What Android's ExoPlayer decodes; anything else stays a file row.
const PLAYABLE_VIDEO_TYPES = new Set([
  "video/mp4",
  "video/webm",
  "video/3gpp",
  "video/x-matroska",
]);
// GIF services, whose videos are GIFs; X keeps GIFs under /tweet_video/.
const GIF_HOST =
  /^(static\d*\.klipy\.com|(media\d*\.)?tenor\.com|(media\d*|i)\.giphy\.com)$/i;

function mimeOf(type: string | null | undefined): string {
  return (type ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

function isPlayableVideo(type: string | null | undefined): boolean {
  return PLAYABLE_VIDEO_TYPES.has(mimeOf(type));
}

function isGifUrl(url: string): boolean {
  return /\.gif(?:$|[?#])/i.test(url);
}

function isGifSource(url: string): boolean {
  const match = /^https?:\/\/([^/?#:]+)(\/[^?#]*)?/i.exec(url);
  const host = match?.[1] ?? "";
  const path = match?.[2] ?? "";
  return (
    GIF_HOST.test(host) ||
    /\/gifs\/(klipy|tenor)\//i.test(url) ||
    (host === "video.twimg.com" && path.startsWith("/tweet_video/"))
  );
}

interface Sized {
  readonly width?: number;
  readonly height?: number;
}

/** The first candidate with a real size; previews often send 0 for unknown. */
function sizeOf(...candidates: (Sized | undefined)[]): Sized {
  const sized = candidates.find(
    (item) => item?.width && item.height && item.width > 0 && item.height > 0,
  );
  return sized ? { width: sized.width, height: sized.height } : {};
}

function attachmentMedia(attachment: Attachment): Media | null {
  const type = mimeOf(attachment.content_type);
  const url = attachment.url;
  if (!url) return null;
  if (type.startsWith("image/")) {
    return {
      kind: "image",
      key: attachment.id,
      url,
      animated: ANIMATED_IMAGE_TYPES.has(type),
      label: attachment.filename,
    };
  }
  if (isPlayableVideo(type)) {
    return {
      kind: attachment.isGif || isGifSource(url) ? "loop" : "video",
      key: attachment.id,
      url: playableUrl(url),
      poster: attachment.thumbnailUrl ?? undefined,
      label: attachment.filename,
    };
  }
  return null;
}

function embedLabel(embed: Embed): string {
  return (
    embed.rawTitle?.trim() ||
    embed.author?.name?.trim() ||
    embed.provider?.name?.trim() ||
    "Media"
  );
}

/** An embed's video: a playable file, else a poster that opens the link. */
function embedVideo(embed: Embed, key: string): Media | null {
  const post = embed.url;
  const label = embedLabel(embed);
  const clip = embed.media?.find((item) => item.type === "video");
  const stillUrl = embed.thumbnail?.url ?? clip?.thumbnailUrl;
  const poster = stillUrl ? playableUrl(stillUrl, post) : undefined;
  const file =
    embed.video?.kind === "direct"
      ? embed.video
      : clip && (clip.isGif || isPlayableVideo(clip.contentType))
        ? clip
        : undefined;
  if (file) {
    return {
      kind: clip?.isGif || isGifSource(file.url) ? "loop" : "video",
      key,
      label,
      url: playableUrl(file.url, post),
      poster,
      durationSeconds: file.durationSeconds,
      post,
      ...sizeOf(file, embed.video, clip, embed.thumbnail),
    };
  }
  // An OpenGraph "video" page or an iframe player. A GIF still is better
  // shown animated, as a picture.
  const playable = embed.video !== undefined || embed.type === "video";
  if (playable && post && poster && stillUrl && !isGifUrl(stillUrl)) {
    return {
      kind: "link",
      key,
      label,
      url: post,
      poster,
      ...sizeOf(embed.thumbnail, embed.video),
    };
  }
  return null;
}

/** The picture an embed shows: its first image, else its thumbnail. */
function embedImage(embed: Embed, key: string): ImageMedia | null {
  const post = embed.url;
  const label = embedLabel(embed);
  const picture = embed.media?.find((item) => item.type === "image");
  if (picture) {
    return {
      kind: "image",
      key,
      url: playableUrl(picture.url, post),
      animated: picture.isGif ?? isGifUrl(picture.url),
      label,
      ...sizeOf(picture),
    };
  }
  const url = embed.thumbnail?.url ?? embed.media?.[0]?.thumbnailUrl;
  if (url) {
    return {
      kind: "image",
      key,
      url: playableUrl(url, post),
      animated: isGifUrl(url),
      label,
      ...sizeOf(embed.thumbnail, embed.media?.[0]),
    };
  }
  if (embed.direct && embed.type === "image" && post) {
    return { kind: "image", key, url: post, animated: isGifUrl(post), label };
  }
  return null;
}

function hasCardText(embed: Embed): boolean {
  return !!(
    embed.rawTitle?.trim() ||
    embed.rawDescription?.trim() ||
    embed.author?.name?.trim()
  );
}

export function messageMedia(message: Message): MessageMedia {
  const bare: Media[] = [];
  const files: Attachment[] = [];
  const cards: LinkCard[] = [];

  for (const attachment of message.attachments ?? []) {
    const media = attachmentMedia(attachment);
    if (media) bare.push(media);
    else files.push(attachment);
  }

  message.embeds?.forEach((embed, index) => {
    const key = `${message.id}-embed-${index}`;
    const media = embedVideo(embed, key) ?? embedImage(embed, key);
    if (embed.direct && media) bare.push(media);
    else if (media || hasCardText(embed)) cards.push({ key, embed, media });
  });

  return { bare, files, cards };
}
