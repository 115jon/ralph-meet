import type { MessageShare } from "@/services/message-share.service";
import type { EmbedAudio, EmbedMedia } from "@/lib/types";
import { clog } from "@/lib/console-logger";

const log = clog("share-preview-proxy");

const TIKTOK_PROXY_API_BASE_URLS = [
  "https://www.tikwm.com/api/",
  "https://tikwm.com/api/",
];

const TIKTOK_PROXY_REQUEST_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (compatible; RalphMeetBot/1.0; +https://meet.115jon.site)",
  Accept: "application/json",
  "Accept-Language": "en-US,en;q=0.9",
  Origin: "https://www.tikwm.com",
  Referer: "https://www.tikwm.com/",
} as const;

const TIKTOK_PLAYER_REQUEST_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (compatible; RalphMeetBot/1.0; +https://meet.115jon.site)",
  Accept: "application/json,text/plain,*/*",
  "Accept-Language": "en-US,en;q=0.9",
} as const;

const TIKTOK_PAGE_RESOLVE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (compatible; RalphMeetBot/1.0; +https://meet.115jon.site)",
  Accept: "text/html,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
} as const;

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
  authorName?: string;
  authorUrl?: string;
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
    const pathname = parsed.pathname.endsWith("/")
      ? parsed.pathname
      : `${parsed.pathname}/`;
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
  return Number.isNaN(fallbackDate.getTime())
    ? undefined
    : fallbackDate.toISOString();
}

function isLikelyTikTokAudioUrl(url: string | undefined): boolean {
  if (!url) return false;

  try {
    const parsed = new URL(url);
    const mimeType = parsed.searchParams.get("mime_type")?.toLowerCase();
    if (mimeType?.startsWith("audio")) return true;

    const pathname = parsed.pathname.toLowerCase();
    return (
      pathname.endsWith(".mp3") ||
      pathname.endsWith(".m4a") ||
      pathname.endsWith(".aac")
    );
  } catch {
    return /mime_type=audio/i.test(url) || /\.(mp3|m4a|aac)(?:$|\?)/i.test(url);
  }
}

function buildTikTokAuthorUrl(authorHandle?: string): string | undefined {
  if (!authorHandle) return undefined;
  const normalizedHandle = authorHandle.replace(/^@/, "").trim();
  return normalizedHandle
    ? `https://www.tiktok.com/@${normalizedHandle}`
    : undefined;
}

function buildTikTokCanonicalUrl(
  authorHandle: string | undefined,
  postId: string | undefined,
  postType: "video" | "slideshow",
): string | undefined {
  const authorUrl = buildTikTokAuthorUrl(authorHandle);
  if (!authorUrl || !postId) return undefined;
  return `${authorUrl}/${postType === "slideshow" ? "photo" : "video"}/${postId}`;
}

function getTikTokStringArray(values: unknown): string[] {
  return Array.isArray(values)
    ? values.filter(
        (value: unknown): value is string =>
          typeof value === "string" && value.trim().length > 0,
      )
    : [];
}

function getTikTokPostType(data: any): "video" | "slideshow" {
  return getTikTokStringArray(data?.images).length > 0 ||
    getTikTokStringArray(data?.live_images).length > 0
    ? "slideshow"
    : "video";
}

function getTikTokDirectVideoUrl(
  data: any,
  postType: "video" | "slideshow",
): string | undefined {
  const candidate = firstNonEmptyString(data?.hdplay, data?.play, data?.wmplay);
  if (
    !candidate ||
    postType === "slideshow" ||
    isLikelyTikTokAudioUrl(candidate)
  ) {
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

function getTikTokCoverUrl(
  data: any,
  postType: "video" | "slideshow",
): string | undefined {
  return postType === "video"
    ? firstNonEmptyString(
        data?.origin_cover,
        data?.ai_dynamic_cover,
        data?.cover,
      )
    : firstNonEmptyString(
        data?.cover,
        data?.origin_cover,
        data?.ai_dynamic_cover,
      );
}

function isLikelyHeicImageUrl(url: string | undefined): boolean {
  if (!url) return false;

  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return pathname.endsWith(".heic");
  } catch {
    return /\.heic(?:$|\?)/i.test(url);
  }
}

function getTikTokMedia(
  data: any,
  postType: "video" | "slideshow",
  coverUrl?: string,
): EmbedMedia[] | undefined {
  if (postType === "slideshow") {
    const images = getTikTokStringArray(data?.images);
    const liveImages = getTikTokStringArray(data?.live_images);

    if (liveImages.length > 0) {
      const media: EmbedMedia[] = [];
      const totalSlides = Math.max(images.length, liveImages.length);

      for (let index = 0; index < totalSlides; index += 1) {
        const imageUrl = images[index];
        const liveImageUrl = liveImages[index];

        if (liveImageUrl) {
          media.push({
            type: "video",
            url: liveImageUrl,
            thumbnailUrl: imageUrl ?? coverUrl,
            contentType: "video/mp4",
          });
          continue;
        }

        if (imageUrl) {
          media.push({
            type: "image",
            url: imageUrl,
          });
        }
      }

      if (media.length > 0) return media;
    }

    if (images.length === 0) return undefined;

    return images.map((imageUrl: string) => ({
      type: "image",
      url: imageUrl,
    }));
  }

  const videoUrl = getTikTokDirectVideoUrl(data, postType);
  if (!videoUrl) return undefined;

  return [
    {
      type: "video",
      url: videoUrl,
      thumbnailUrl: coverUrl,
      contentType: "video/mp4",
      durationSeconds: readPositiveNumber(data?.duration),
    },
  ];
}

export function getTikTokThumbnailUrl(share: MessageShare): string | null {
  for (const embed of share.snapshot.embeds) {
    const provider = embed.provider?.name?.toLowerCase();
    let isTikTok = provider === "tiktok";
    try {
      isTikTok =
        isTikTok ||
        new URL(embed.url).hostname.toLowerCase().includes("tiktok.com");
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
      if (
        provider === "tiktok" ||
        parsed.hostname.toLowerCase().includes("tiktok.com")
      ) {
        return parsed.toString();
      }
    } catch {
      // Ignore malformed embed URLs and continue scanning.
    }
  }

  return null;
}

function hasTikTokMetadataContent(
  result: TikTokProxyMetadata | null | undefined,
): result is TikTokProxyMetadata {
  return Boolean(
    result &&
    (result.videoUrl ||
      result.media?.length ||
      result.coverUrl ||
      result.audio ||
      result.title ||
      result.authorAvatarUrl),
  );
}

function isTikTokShortLookupUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    const hostname = parsed.hostname.toLowerCase();
    return hostname === "vm.tiktok.com" || parsed.pathname.startsWith("/t/");
  } catch {
    return false;
  }
}

function extractTikTokItemId(rawUrl: string): string | undefined {
  try {
    const parsed = new URL(rawUrl);
    return (
      parsed.pathname.match(
        /(?:\/video\/|\/photo\/|\/player\/v1\/)(\d+)/,
      )?.[1] ?? undefined
    );
  } catch {
    return (
      rawUrl.match(/(?:\/video\/|\/photo\/|\/player\/v1\/)(\d+)/)?.[1] ??
      undefined
    );
  }
}

async function resolveTikTokLookupUrl(rawUrl: string): Promise<string> {
  if (!isTikTokShortLookupUrl(rawUrl)) return rawUrl;

  try {
    const response = await fetch(rawUrl, {
      method: "HEAD",
      redirect: "follow",
      headers: TIKTOK_PAGE_RESOLVE_HEADERS,
    });

    return response.url || rawUrl;
  } catch {
    return rawUrl;
  }
}

function getTikTokUrlList(candidate: unknown): string[] {
  if (Array.isArray(candidate)) {
    return candidate.filter(
      (value): value is string =>
        typeof value === "string" && value.trim().length > 0,
    );
  }

  if (
    candidate &&
    typeof candidate === "object" &&
    Array.isArray((candidate as any).url_list)
  ) {
    return (candidate as any).url_list.filter(
      (value: unknown): value is string =>
        typeof value === "string" && value.trim().length > 0,
    );
  }

  return [];
}

function isLikelyTikTokVideoUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const mimeType = parsed.searchParams.get("mime_type")?.toLowerCase();
    if (mimeType?.startsWith("video")) return true;
    if (mimeType?.startsWith("audio")) return false;
    return (
      parsed.pathname.toLowerCase().endsWith(".mp4") ||
      parsed.pathname.toLowerCase().includes("/aweme/v1/play/")
    );
  } catch {
    return (
      /mime_type=video/i.test(url) || /aweme\/v1\/play|\.mp4(?:$|\?)/i.test(url)
    );
  }
}

function getTikTokPlayerApiCoverUrl(item: any): string | undefined {
  return firstNonEmptyString(
    ...getTikTokUrlList(item?.video_info?.origin_cover),
    ...getTikTokUrlList(item?.video_info?.cover),
    ...getTikTokUrlList(item?.image_post_info?.cover?.display_image),
    ...getTikTokUrlList(item?.image_post_info?.cover?.thumbnail),
    ...getTikTokUrlList(item?.image_post_info?.cover?.owner_watermark_image),
  );
}

function getTikTokPlayerApiDirectVideoUrl(item: any): string | undefined {
  const profileUrls = Array.isArray(item?.video_info?.profiles)
    ? item.video_info.profiles.flatMap((profile: any) =>
        getTikTokUrlList(profile?.play_addr),
      )
    : [];
  const videoUrls = [
    ...profileUrls,
    ...getTikTokUrlList(item?.video_info?.url_list),
  ].filter((value, index, values) => values.indexOf(value) === index);

  return videoUrls.find(isLikelyTikTokVideoUrl);
}

function getTikTokPlayerApiAudio(item: any): EmbedAudio | undefined {
  const title = firstNonEmptyString(item?.music_info?.title);
  const artist = firstNonEmptyString(item?.music_info?.author);

  if (!title && !artist) {
    return undefined;
  }

  return {
    title,
    artist,
  };
}

function getTikTokPlayerApiMedia(
  item: any,
  postType: "video" | "slideshow",
  coverUrl?: string,
): EmbedMedia[] | undefined {
  if (postType === "slideshow") {
    const images = Array.isArray(item?.image_post_info?.images)
      ? item.image_post_info.images
      : [];
    const media = images
      .map((image: any) => {
        const url = firstNonEmptyString(
          ...getTikTokUrlList(image?.display_image),
          ...getTikTokUrlList(image?.owner_watermark_image),
          ...getTikTokUrlList(image?.thumbnail),
        );
        if (!url) return null;

        const dimensions =
          image?.display_image ??
          image?.owner_watermark_image ??
          image?.thumbnail;
        return {
          type: "image" as const,
          url,
          width: readPositiveNumber(dimensions?.width),
          height: readPositiveNumber(dimensions?.height),
        };
      })
      .filter(
        (value: EmbedMedia | null): value is EmbedMedia => value !== null,
      );

    return media.length > 0 ? media : undefined;
  }

  const videoUrl = getTikTokPlayerApiDirectVideoUrl(item);
  if (!videoUrl) return undefined;

  const durationMs = readPositiveNumber(item?.video_info?.meta?.duration);
  return [
    {
      type: "video",
      url: videoUrl,
      thumbnailUrl: coverUrl,
      width: readPositiveNumber(item?.video_info?.meta?.width),
      height: readPositiveNumber(item?.video_info?.meta?.height),
      contentType: "video/mp4",
      durationSeconds: durationMs !== undefined ? durationMs / 1000 : undefined,
    },
  ];
}

function mapTikTokPlayerApiMetadata(item: any): TikTokProxyMetadata | null {
  if (!item || typeof item !== "object") return null;

  const postType: "video" | "slideshow" =
    Array.isArray(item?.image_post_info?.images) &&
    item.image_post_info.images.length > 0
      ? "slideshow"
      : "video";
  const id = firstNonEmptyString(
    item?.id_str,
    typeof item?.id === "number" ? String(item.id) : undefined,
  );
  const authorHandle = firstNonEmptyString(item?.author_info?.unique_id);
  const coverUrl = getTikTokPlayerApiCoverUrl(item);
  const media = getTikTokPlayerApiMedia(item, postType, coverUrl);

  if (!id && !coverUrl && !media?.length) {
    return null;
  }

  return {
    id,
    canonicalUrl: buildTikTokCanonicalUrl(authorHandle, id, postType),
    postType,
    coverUrl: coverUrl ?? media?.[0]?.url,
    title: firstNonEmptyString(item?.desc),
    authorName: firstNonEmptyString(
      item?.author_info?.nickname,
      item?.author_info?.unique_id,
    ),
    authorHandle,
    authorAvatarUrl: firstNonEmptyString(
      ...getTikTokUrlList(item?.author_info?.avatar_url_list),
    ),
    videoUrl:
      postType === "video" ? getTikTokPlayerApiDirectVideoUrl(item) : undefined,
    media,
    audio: getTikTokPlayerApiAudio(item),
    likeCount: readPositiveNumber(item?.statistics_info?.digg_count),
    commentCount: readPositiveNumber(item?.statistics_info?.comment_count),
    viewCount: readPositiveNumber(item?.statistics_info?.play_count),
    shareCount: readPositiveNumber(item?.statistics_info?.share_count),
  };
}

async function fetchTikTokPlayerApiMetadata(
  rawUrl: string,
): Promise<TikTokProxyMetadata | null> {
  const resolvedUrl = await resolveTikTokLookupUrl(rawUrl);
  const itemId =
    extractTikTokItemId(resolvedUrl) ?? extractTikTokItemId(rawUrl);
  if (!itemId) {
    return null;
  }

  const apiUrl = `https://www.tiktok.com/player/api/v1/items?item_ids=${encodeURIComponent(itemId)}`;

  try {
    const response = await fetch(apiUrl, {
      headers: {
        ...TIKTOK_PLAYER_REQUEST_HEADERS,
        Referer: `https://www.tiktok.com/player/v1/${itemId}?description=1&music_info=1`,
      },
    });

    const contentType =
      response.headers.get("Content-Type")?.toLowerCase() ?? "";
    if (!response.ok || !contentType.includes("json")) {
      log.warn("TikTok player api request failed", {
        apiUrl,
        status: response.status,
        contentType,
        sourceUrl: rawUrl,
      });
      return null;
    }

    const payload = (await response.json()) as any;
    const item = Array.isArray(payload?.items) ? payload.items[0] : null;
    return mapTikTokPlayerApiMetadata(item);
  } catch (error) {
    log.warn("TikTok player api request threw", {
      sourceUrl: rawUrl,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function getPreferredTikTokMedia(
  primary?: EmbedMedia[],
  secondary?: EmbedMedia[],
): EmbedMedia[] | undefined {
  if (!primary?.length) return secondary;
  if (!secondary?.length) return primary;

  const primaryHasVideo = primary.some((item) => item.type === "video");
  const secondaryHasVideo = secondary.some((item) => item.type === "video");

  if (!primaryHasVideo && secondaryHasVideo) {
    return secondary;
  }

  return primary;
}

function mergeTikTokAudio(
  primary?: EmbedAudio,
  secondary?: EmbedAudio,
): EmbedAudio | undefined {
  if (!primary) return secondary;
  if (!secondary) return primary;

  return {
    title: primary.title ?? secondary.title,
    artist: primary.artist ?? secondary.artist,
    url: primary.url ?? secondary.url,
    artworkUrl: primary.artworkUrl ?? secondary.artworkUrl,
  };
}

function mergeTikTokMetadata(
  primary: TikTokProxyMetadata,
  secondary: TikTokProxyMetadata,
): TikTokProxyMetadata {
  return {
    id: primary.id ?? secondary.id,
    canonicalUrl: primary.canonicalUrl ?? secondary.canonicalUrl,
    postType: primary.postType ?? secondary.postType,
    coverUrl: primary.coverUrl ?? secondary.coverUrl,
    title: primary.title ?? secondary.title,
    authorName: primary.authorName ?? secondary.authorName,
    authorHandle: primary.authorHandle ?? secondary.authorHandle,
    authorAvatarUrl: primary.authorAvatarUrl ?? secondary.authorAvatarUrl,
    videoUrl: primary.videoUrl ?? secondary.videoUrl,
    media: getPreferredTikTokMedia(primary.media, secondary.media),
    audio: mergeTikTokAudio(primary.audio, secondary.audio),
    likeCount: primary.likeCount ?? secondary.likeCount,
    commentCount: primary.commentCount ?? secondary.commentCount,
    viewCount: primary.viewCount ?? secondary.viewCount,
    shareCount: primary.shareCount ?? secondary.shareCount,
    timestamp: primary.timestamp ?? secondary.timestamp,
  };
}

async function fetchTikTokTikwmMetadata(
  url: string,
): Promise<TikTokProxyMetadata | null> {
  let data: any = null;

  for (const baseUrl of TIKTOK_PROXY_API_BASE_URLS) {
    const apiUrl = `${baseUrl}?url=${encodeURIComponent(url)}`;

    try {
      const response = await fetch(apiUrl, {
        headers: TIKTOK_PROXY_REQUEST_HEADERS,
      });

      const contentType =
        response.headers.get("Content-Type")?.toLowerCase() ?? "";
      if (!response.ok || !contentType.includes("json")) {
        log.warn("TikTok proxy metadata request failed", {
          apiUrl: baseUrl,
          status: response.status,
          contentType,
          sourceUrl: url,
        });
        continue;
      }

      const payload = (await response.json()) as any;
      if (payload?.code !== 0 || !payload.data) {
        log.warn("TikTok proxy metadata payload missing data", {
          apiUrl: baseUrl,
          code: payload?.code ?? null,
          sourceUrl: url,
        });
        continue;
      }

      data = payload.data;
      break;
    } catch (error) {
      log.warn("TikTok proxy metadata request threw", {
        apiUrl: baseUrl,
        sourceUrl: url,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (!data) return null;

  const postType = getTikTokPostType(data);
  const media = getTikTokMedia(
    data,
    postType,
    getTikTokCoverUrl(data, postType),
  );
  const rawCoverUrl = getTikTokCoverUrl(data, postType);
  const firstMedia = media?.[0];
  const firstMediaThumbnailUrl =
    firstMedia?.type === "video" ? firstMedia.thumbnailUrl : firstMedia?.url;
  const coverUrl =
    postType === "slideshow" && isLikelyHeicImageUrl(rawCoverUrl)
      ? (firstMediaThumbnailUrl ?? rawCoverUrl)
      : (rawCoverUrl ?? firstMediaThumbnailUrl);
  const title = firstNonEmptyString(
    data.title,
    Array.isArray(data.content_desc)
      ? data.content_desc
          .filter(
            (value: unknown): value is string =>
              typeof value === "string" && value.trim().length > 0,
          )
          .join("\n")
      : undefined,
  );
  const authorHandle = firstNonEmptyString(data.author?.unique_id);
  const postId = firstNonEmptyString(data.id);

  return {
    id: postId,
    canonicalUrl: buildTikTokCanonicalUrl(authorHandle, postId, postType),
    postType,
    coverUrl: coverUrl ?? media?.[0]?.url,
    title,
    authorName: firstNonEmptyString(
      data.author?.nickname,
      data.author?.unique_id,
    ),
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

export async function fetchTikTokProxyMetadata(
  url: string,
): Promise<TikTokProxyMetadata | null> {
  const playerMetadata = await fetchTikTokPlayerApiMetadata(url);
  const shouldSupplementWithTikwm =
    !hasTikTokMetadataContent(playerMetadata) ||
    playerMetadata.postType === "slideshow";

  if (!shouldSupplementWithTikwm) {
    return playerMetadata;
  }

  const tikwmMetadata = await fetchTikTokTikwmMetadata(url);
  if (
    hasTikTokMetadataContent(playerMetadata) &&
    hasTikTokMetadataContent(tikwmMetadata)
  ) {
    return mergeTikTokMetadata(playerMetadata, tikwmMetadata);
  }

  return tikwmMetadata ?? playerMetadata;
}

export async function fetchInstagramOEmbedMetadata(
  url: string,
): Promise<InstagramOEmbedMetadata | null> {
  const canonicalUrl = canonicalizeInstagramUrl(url);
  const apiUrl = `https://www.instagram.com/api/v1/oembed/?url=${encodeURIComponent(canonicalUrl)}&omitscript=true`;
  const response = await fetch(apiUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; RalphMeetBot/1.0; +https://meet.115jon.site)",
      Accept: "application/json",
    },
  });

  if (!response.ok || !response.headers.get("Content-Type")?.includes("json")) {
    return null;
  }

  const payload = (await response.json()) as any;
  if (!payload || typeof payload !== "object") return null;

  return {
    mediaId:
      typeof payload.media_id === "string" ? payload.media_id : undefined,
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

export async function fetchInstagramVideoMetadata(
  url: string,
): Promise<InstagramVideoMetadata | null> {
  const canonicalUrl = canonicalizeInstagramUrl(url);
  const response = await fetch(
    `https://meet.115jon.site/api/instagram-video?videoUrl=${encodeURIComponent(canonicalUrl)}`,
    {
      headers: {
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (compatible; RalphMeetBot/1.0; +https://meet.115jon.site)",
      },
    },
  );

  if (!response.ok || !response.headers.get("Content-Type")?.includes("json")) {
    return null;
  }

  const payload = (await response.json()) as any;
  if (!payload || typeof payload !== "object") return null;

  return {
    videoUrl:
      typeof payload.videoUrl === "string" ? payload.videoUrl : undefined,
    thumbnailUrl:
      typeof payload.thumbnailUrl === "string"
        ? payload.thumbnailUrl
        : undefined,
    title: typeof payload.title === "string" ? payload.title : undefined,
    durationSeconds:
      typeof payload.durationSeconds === "number"
        ? payload.durationSeconds
        : undefined,
    media: Array.isArray(payload.media)
      ? payload.media
          .filter(
            (item: any) =>
              item &&
              (item.type === "image" || item.type === "video") &&
              typeof item.url === "string",
          )
          .map((item: any) => ({
            type: item.type,
            url: item.url,
            width: typeof item.width === "number" ? item.width : undefined,
            height: typeof item.height === "number" ? item.height : undefined,
            thumbnailUrl:
              typeof item.thumbnailUrl === "string"
                ? item.thumbnailUrl
                : undefined,
            contentType:
              typeof item.contentType === "string"
                ? item.contentType
                : undefined,
            altText:
              typeof item.altText === "string" ? item.altText : undefined,
            durationSeconds:
              typeof item.durationSeconds === "number"
                ? item.durationSeconds
                : undefined,
          }))
      : undefined,
    authorName:
      typeof payload.authorName === "string" ? payload.authorName : undefined,
    authorUrl:
      typeof payload.authorUrl === "string" ? payload.authorUrl : undefined,
    authorAvatarUrl:
      typeof payload.authorAvatarUrl === "string"
        ? payload.authorAvatarUrl
        : undefined,
    authorVerified:
      typeof payload.authorVerified === "boolean"
        ? payload.authorVerified
        : undefined,
    likeCount:
      typeof payload.likeCount === "number" ? payload.likeCount : undefined,
    commentCount:
      typeof payload.commentCount === "number"
        ? payload.commentCount
        : undefined,
    viewCount:
      typeof payload.viewCount === "number" ? payload.viewCount : undefined,
    timestamp:
      typeof payload.timestamp === "string" ? payload.timestamp : undefined,
    audio:
      payload.audio && typeof payload.audio === "object"
        ? {
            title:
              typeof payload.audio.title === "string"
                ? payload.audio.title
                : undefined,
            artist:
              typeof payload.audio.artist === "string"
                ? payload.audio.artist
                : undefined,
            url:
              typeof payload.audio.url === "string"
                ? payload.audio.url
                : undefined,
            artworkUrl:
              typeof payload.audio.artworkUrl === "string"
                ? payload.audio.artworkUrl
                : undefined,
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
      "User-Agent":
        "Mozilla/5.0 (compatible; RalphMeetBot/1.0; +https://meet.115jon.site)",
      Accept:
        "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      Referer: "https://www.tiktok.com/",
    },
  });

  const contentType =
    upstream.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() ??
    "";
  if (
    !upstream.ok ||
    !contentType.startsWith("image/") ||
    contentType === "image/svg+xml"
  ) {
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
