import type { MessageShare } from "@/services/message-share.service";
import type { EmbedAudio, EmbedMedia } from "@/lib/types";

interface TikTokProxyMetadata {
  id?: string;
  canonicalUrl?: string;
  postType?: "video" | "slideshow";
  coverUrl?: string;
  title?: string;
  authorName?: string;
  authorHandle?: string;
  authorAvatarUrl?: string;
  videoUrl?: string;
  media?: EmbedMedia[];
  audio?: EmbedAudio;
  likeCount?: number;
  commentCount?: number;
  viewCount?: number;
  shareCount?: number;
  timestamp?: string;
}

interface InstagramOEmbedMetadata {
  mediaId?: string;
  title?: string;
  authorName?: string;
  authorUrl?: string;
  providerName?: string;
  providerUrl?: string;
  thumbnailUrl?: string;
  thumbnailWidth?: number;
  thumbnailHeight?: number;
}

interface InstagramVideoMetadata {
  videoUrl?: string;
  thumbnailUrl?: string;
  title?: string;
  durationSeconds?: number;
  media?: EmbedMedia[];
  authorAvatarUrl?: string;
  authorVerified?: boolean;
  likeCount?: number;
  commentCount?: number;
  viewCount?: number;
  timestamp?: string;
  audio?: EmbedAudio;
}

function canonicalizeInstagramUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.endsWith("/") ? parsed.pathname : `${parsed.pathname}/`;
    return `https://www.instagram.com${pathname}`;
  } catch {
    return url;
  }
}

function firstNonEmptyString(...values: Array<unknown>): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return undefined;
}

function readPositiveNumber(...values: Array<unknown>): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      return value;
    }

    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed >= 0) {
        return parsed;
      }
    }
  }

  return undefined;
}

function toIsoTimestamp(rawValue: unknown): string | undefined {
  const seconds = readPositiveNumber(rawValue);
  if (seconds !== undefined) {
    return new Date(seconds * 1000).toISOString();
  }

  if (typeof rawValue !== "string" || !rawValue.trim()) {
    return undefined;
  }

  const fallbackDate = new Date(rawValue);
  return Number.isNaN(fallbackDate.getTime()) ? undefined : fallbackDate.toISOString();
}

function isLikelyTikTokAudioUrl(url: string | undefined): boolean {
  if (!url) return false;

  try {
    const parsed = new URL(url);
    const mimeType = parsed.searchParams.get("mime_type")?.toLowerCase();
    if (mimeType?.startsWith("audio")) return true;

    const pathname = parsed.pathname.toLowerCase();
    return pathname.endsWith(".mp3") || pathname.endsWith(".m4a") || pathname.endsWith(".aac");
  } catch {
    return /mime_type=audio/i.test(url) || /\.(mp3|m4a|aac)(?:$|\?)/i.test(url);
  }
}

function buildTikTokAuthorUrl(authorHandle?: string): string | undefined {
  if (!authorHandle) return undefined;
  const normalizedHandle = authorHandle.replace(/^@/, "").trim();
  return normalizedHandle ? `https://www.tiktok.com/@${normalizedHandle}` : undefined;
}

function buildTikTokCanonicalUrl(authorHandle: string | undefined, postId: string | undefined, postType: "video" | "slideshow"): string | undefined {
  const authorUrl = buildTikTokAuthorUrl(authorHandle);
  if (!authorUrl || !postId) return undefined;
  return `${authorUrl}/${postType === "slideshow" ? "photo" : "video"}/${postId}`;
}

function getTikTokPostType(data: any): "video" | "slideshow" {
  return Array.isArray(data?.images) && data.images.length > 0 ? "slideshow" : "video";
}

function getTikTokDirectVideoUrl(data: any, postType: "video" | "slideshow"): string | undefined {
  const candidate = firstNonEmptyString(data?.hdplay, data?.play, data?.wmplay);
  if (!candidate || postType === "slideshow" || isLikelyTikTokAudioUrl(candidate)) {
    return undefined;
  }

  return candidate;
}

function getTikTokAudio(data: any): EmbedAudio | undefined {
  const musicInfo = data?.music_info;
  const url = firstNonEmptyString(musicInfo?.play, data?.music);
  const title = firstNonEmptyString(musicInfo?.title);
  const artist = firstNonEmptyString(musicInfo?.author);
  const artworkUrl = firstNonEmptyString(musicInfo?.cover);

  if (!title && !artist && !url && !artworkUrl) {
    return undefined;
  }

  return {
    title,
    artist,
    url,
    artworkUrl,
  };
}

function getTikTokCoverUrl(data: any, postType: "video" | "slideshow"): string | undefined {
  return postType === "video"
    ? firstNonEmptyString(data?.origin_cover, data?.ai_dynamic_cover, data?.cover)
    : firstNonEmptyString(data?.cover, data?.origin_cover, data?.ai_dynamic_cover);
}

function getTikTokMedia(data: any, postType: "video" | "slideshow", coverUrl?: string): EmbedMedia[] | undefined {
  if (postType === "slideshow") {
    const images = Array.isArray(data?.images)
      ? data.images.filter((value: unknown): value is string => typeof value === "string" && value.trim().length > 0)
      : [];

    if (images.length === 0) return undefined;

    return images.map((imageUrl: string) => ({
      type: "image",
      url: imageUrl,
    }));
  }

  const videoUrl = getTikTokDirectVideoUrl(data, postType);
  if (!videoUrl) return undefined;

  return [{
    type: "video",
    url: videoUrl,
    thumbnailUrl: coverUrl,
    contentType: "video/mp4",
    durationSeconds: readPositiveNumber(data?.duration),
  }];
}

export function getTikTokThumbnailUrl(share: MessageShare): string | null {
  for (const embed of share.snapshot.embeds) {
    const provider = embed.provider?.name?.toLowerCase();
    let isTikTok = provider === "tiktok";
    try {
      isTikTok = isTikTok || new URL(embed.url).hostname.toLowerCase().includes("tiktok.com");
    } catch {
      // Ignore malformed embed URLs and continue scanning.
    }

    if (isTikTok) return embed.thumbnail?.url ?? null;
  }

  return null;
}

export function getTikTokShareUrl(share: MessageShare): string | null {
  for (const embed of share.snapshot.embeds) {
    const provider = embed.provider?.name?.toLowerCase();
    try {
      const parsed = new URL(embed.url);
      if (provider === "tiktok" || parsed.hostname.toLowerCase().includes("tiktok.com")) {
        return parsed.toString();
      }
    } catch {
      // Ignore malformed embed URLs and continue scanning.
    }
  }

  return null;
}

export async function fetchTikTokProxyMetadata(url: string): Promise<TikTokProxyMetadata | null> {
  const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`;
  const response = await fetch(apiUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; RalphMeetBot/1.0; +https://meet.115jon.site)",
      "Accept": "application/json",
    },
  });

  if (!response.ok || !response.headers.get("Content-Type")?.includes("json")) {
    return null;
  }

  const payload = await response.json() as any;
  if (payload?.code !== 0 || !payload.data) return null;

  const data = payload.data;
  const postType = getTikTokPostType(data);
  const coverUrl = getTikTokCoverUrl(data, postType);
  const title = firstNonEmptyString(
    data.title,
    Array.isArray(data.content_desc)
      ? data.content_desc.filter((value: unknown): value is string => typeof value === "string" && value.trim().length > 0).join("\n")
      : undefined,
  );
  const authorHandle = firstNonEmptyString(data.author?.unique_id);
  const media = getTikTokMedia(data, postType, coverUrl);
  const postId = firstNonEmptyString(data.id);

  return {
    id: postId,
    canonicalUrl: buildTikTokCanonicalUrl(authorHandle, postId, postType),
    postType,
    coverUrl: coverUrl ?? media?.[0]?.url,
    title,
    authorName: firstNonEmptyString(data.author?.nickname, data.author?.unique_id),
    authorHandle,
    authorAvatarUrl: firstNonEmptyString(data.author?.avatar),
    videoUrl: getTikTokDirectVideoUrl(data, postType),
    media,
    audio: getTikTokAudio(data),
    likeCount: readPositiveNumber(data.digg_count),
    commentCount: readPositiveNumber(data.comment_count),
    viewCount: readPositiveNumber(data.play_count),
    shareCount: readPositiveNumber(data.share_count),
    timestamp: toIsoTimestamp(data.create_time),
  };
}

export async function fetchInstagramOEmbedMetadata(url: string): Promise<InstagramOEmbedMetadata | null> {
  const canonicalUrl = canonicalizeInstagramUrl(url);
  const apiUrl = `https://www.instagram.com/api/v1/oembed/?url=${encodeURIComponent(canonicalUrl)}&omitscript=true`;
  const response = await fetch(apiUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; RalphMeetBot/1.0; +https://meet.115jon.site)",
      "Accept": "application/json",
    },
  });

  if (!response.ok || !response.headers.get("Content-Type")?.includes("json")) {
    return null;
  }

  const payload = await response.json() as any;
  if (!payload || typeof payload !== "object") return null;

  return {
    mediaId: typeof payload.media_id === "string" ? payload.media_id : undefined,
    title: payload.title,
    authorName: payload.author_name,
    authorUrl: payload.author_url,
    providerName: payload.provider_name,
    providerUrl: payload.provider_url,
    thumbnailUrl: payload.thumbnail_url,
    thumbnailWidth: payload.thumbnail_width,
    thumbnailHeight: payload.thumbnail_height,
  };
}

export async function fetchInstagramVideoMetadata(url: string): Promise<InstagramVideoMetadata | null> {
  const canonicalUrl = canonicalizeInstagramUrl(url);
  const response = await fetch(`https://meet.115jon.site/api/instagram-video?videoUrl=${encodeURIComponent(canonicalUrl)}`, {
    headers: {
      "Accept": "application/json",
      "User-Agent": "Mozilla/5.0 (compatible; RalphMeetBot/1.0; +https://meet.115jon.site)",
    },
  });

  if (!response.ok || !response.headers.get("Content-Type")?.includes("json")) {
    return null;
  }

  const payload = await response.json() as any;
  if (!payload || typeof payload !== "object") return null;

  return {
    videoUrl: typeof payload.videoUrl === "string" ? payload.videoUrl : undefined,
    thumbnailUrl: typeof payload.thumbnailUrl === "string" ? payload.thumbnailUrl : undefined,
    title: typeof payload.title === "string" ? payload.title : undefined,
    durationSeconds: typeof payload.durationSeconds === "number" ? payload.durationSeconds : undefined,
    media: Array.isArray(payload.media)
      ? payload.media
        .filter((item: any) => item && (item.type === "image" || item.type === "video") && typeof item.url === "string")
        .map((item: any) => ({
          type: item.type,
          url: item.url,
          width: typeof item.width === "number" ? item.width : undefined,
          height: typeof item.height === "number" ? item.height : undefined,
          thumbnailUrl: typeof item.thumbnailUrl === "string" ? item.thumbnailUrl : undefined,
          contentType: typeof item.contentType === "string" ? item.contentType : undefined,
          altText: typeof item.altText === "string" ? item.altText : undefined,
          durationSeconds: typeof item.durationSeconds === "number" ? item.durationSeconds : undefined,
        }))
      : undefined,
    authorAvatarUrl: typeof payload.authorAvatarUrl === "string" ? payload.authorAvatarUrl : undefined,
    authorVerified: typeof payload.authorVerified === "boolean" ? payload.authorVerified : undefined,
    likeCount: typeof payload.likeCount === "number" ? payload.likeCount : undefined,
    commentCount: typeof payload.commentCount === "number" ? payload.commentCount : undefined,
    viewCount: typeof payload.viewCount === "number" ? payload.viewCount : undefined,
    timestamp: typeof payload.timestamp === "string" ? payload.timestamp : undefined,
    audio: payload.audio && typeof payload.audio === "object"
      ? {
          title: typeof payload.audio.title === "string" ? payload.audio.title : undefined,
          artist: typeof payload.audio.artist === "string" ? payload.audio.artist : undefined,
          url: typeof payload.audio.url === "string" ? payload.audio.url : undefined,
          artworkUrl: typeof payload.audio.artworkUrl === "string" ? payload.audio.artworkUrl : undefined,
        }
      : undefined,
  };
}

export async function proxyImage(url: string): Promise<Response | null> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:") return null;

  const upstream = await fetch(parsed.toString(), {
    redirect: "follow",
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; RalphMeetBot/1.0; +https://meet.115jon.site)",
      "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      "Referer": "https://www.tiktok.com/",
    },
  });

  const contentType = upstream.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() ?? "";
  if (!upstream.ok || !contentType.startsWith("image/") || contentType === "image/svg+xml") {
    return null;
  }

  const headers = new Headers();
  headers.set("Content-Type", contentType);
  headers.set("Cache-Control", "public, max-age=86400");
  headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Robots-Tag", "noindex, nofollow");
  const contentLength = upstream.headers.get("Content-Length");
  if (contentLength) headers.set("Content-Length", contentLength);

  return new Response(upstream.body, { headers });
}
