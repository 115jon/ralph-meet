import { getBotUserAgent, getPublicWebUrl } from "@/lib/platform";
import type { MessageShare } from "@/services/message-share.service";
import type { EmbedAudio, EmbedMedia } from "@/lib/types";
import { clog } from "@/lib/console-logger";
import { safeFetch, readJsonCapped } from "@/lib/safe-fetch";
import {
  InstagramOEmbedResponse,
  InstagramVideoApiResponse,
} from "@/lib/vendor-payloads/instagram";
import {
  TikTokPlayerApiResponse,
  TikwmResponse,
  type TikwmData,
  type TikTokPlayerItem,
  type TikTokUrlRef,
} from "@/lib/vendor-payloads/tiktok";

const log = clog("share-preview-proxy");

const TIKTOK_PROXY_API_BASE_URLS = [
  "https://www.tikwm.com/api/",
  "https://tikwm.com/api/",
];

const TIKTOK_PROXY_REQUEST_HEADERS = {
  "User-Agent": getBotUserAgent(),
  Accept: "application/json",
  "Accept-Language": "en-US,en;q=0.9",
  Origin: "https://www.tikwm.com",
  Referer: "https://www.tikwm.com/",
} as const;

const TIKTOK_PLAYER_REQUEST_HEADERS = {
  "User-Agent": getBotUserAgent(),
  Accept: "application/json,text/plain,*/*",
  "Accept-Language": "en-US,en;q=0.9",
} as const;

const TIKTOK_PAGE_RESOLVE_HEADERS = {
  "User-Agent": getBotUserAgent(),
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

function firstNonEmptyString(
  ...values: Array<string | undefined>
): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }

  return undefined;
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

function getTikTokPostType(data: TikwmData): "video" | "slideshow" {
  return data.images?.length || data.live_images?.length
    ? "slideshow"
    : "video";
}

function getTikTokDirectVideoUrl(
  data: TikwmData,
  postType: "video" | "slideshow",
): string | undefined {
  const candidate = firstNonEmptyString(data.hdplay, data.play, data.wmplay);
  if (
    !candidate ||
    postType === "slideshow" ||
    isLikelyTikTokAudioUrl(candidate)
  ) {
    return undefined;
  }

  return candidate;
}

function getTikTokAudio(data: TikwmData): EmbedAudio | undefined {
  const musicInfo = data.music_info;
  const url = firstNonEmptyString(musicInfo?.play, data.music);
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
  data: TikwmData,
  postType: "video" | "slideshow",
): string | undefined {
  return postType === "video"
    ? firstNonEmptyString(data.origin_cover, data.ai_dynamic_cover, data.cover)
    : firstNonEmptyString(data.cover, data.origin_cover, data.ai_dynamic_cover);
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
  data: TikwmData,
  postType: "video" | "slideshow",
  coverUrl?: string,
): EmbedMedia[] | undefined {
  if (postType === "slideshow") {
    const images = data.images ?? [];
    const liveImages = data.live_images ?? [];

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
      durationSeconds: data.duration,
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
    const response = await safeFetch(rawUrl, {
      method: "HEAD",
      redirect: "follow",
      headers: TIKTOK_PAGE_RESOLVE_HEADERS,
    });

    return response.url || rawUrl;
  } catch {
    return rawUrl;
  }
}

function urlsOf(ref: TikTokUrlRef | undefined): ReadonlyArray<string> {
  return ref?.urls ?? [];
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

function getTikTokPlayerApiCoverUrl(
  item: TikTokPlayerItem,
): string | undefined {
  const cover = item.image_post_info?.cover;
  return firstNonEmptyString(
    ...urlsOf(item.video_info?.origin_cover),
    ...urlsOf(item.video_info?.cover),
    ...urlsOf(cover?.display_image),
    ...urlsOf(cover?.thumbnail),
    ...urlsOf(cover?.owner_watermark_image),
  );
}

function getTikTokPlayerApiDirectVideoUrl(
  item: TikTokPlayerItem,
): string | undefined {
  const profileUrls = (item.video_info?.profiles ?? []).flatMap((profile) =>
    urlsOf(profile.play_addr),
  );
  const videoUrls = [
    ...profileUrls,
    ...urlsOf(item.video_info?.url_list),
  ].filter((value, index, values) => values.indexOf(value) === index);

  return videoUrls.find(isLikelyTikTokVideoUrl);
}

function getTikTokPlayerApiAudio(
  item: TikTokPlayerItem,
): EmbedAudio | undefined {
  const title = item.music_info?.title;
  const artist = item.music_info?.author;

  if (!title && !artist) {
    return undefined;
  }

  return {
    title,
    artist,
  };
}

function getTikTokPlayerApiMedia(
  item: TikTokPlayerItem,
  postType: "video" | "slideshow",
  coverUrl?: string,
): EmbedMedia[] | undefined {
  if (postType === "slideshow") {
    const media: EmbedMedia[] = [];
    for (const image of item.image_post_info?.images ?? []) {
      const url = firstNonEmptyString(
        ...urlsOf(image.display_image),
        ...urlsOf(image.owner_watermark_image),
        ...urlsOf(image.thumbnail),
      );
      if (!url) continue;

      const dimensions =
        image.display_image ?? image.owner_watermark_image ?? image.thumbnail;
      media.push({
        type: "image",
        url,
        width: dimensions?.width,
        height: dimensions?.height,
      });
    }

    return media.length > 0 ? media : undefined;
  }

  const videoUrl = getTikTokPlayerApiDirectVideoUrl(item);
  if (!videoUrl) return undefined;

  // `meta.duration` is whole seconds (51 for a 51 s clip). Treat values too
  // large to be seconds as milliseconds in case the API ever switches.
  const meta = item.video_info?.meta;
  const rawDuration = meta?.duration;
  const durationMs =
    rawDuration === undefined
      ? undefined
      : rawDuration > 6 * 60 * 60
        ? rawDuration
        : rawDuration * 1000;
  return [
    {
      type: "video",
      url: videoUrl,
      thumbnailUrl: coverUrl,
      width: meta?.width,
      height: meta?.height,
      contentType: "video/mp4",
      durationSeconds: durationMs !== undefined ? durationMs / 1000 : undefined,
    },
  ];
}

function mapTikTokPlayerApiMetadata(
  item: TikTokPlayerItem,
): TikTokProxyMetadata | null {
  const postType: "video" | "slideshow" = item.image_post_info?.images?.length
    ? "slideshow"
    : "video";
  const id = firstNonEmptyString(
    item.id_str,
    item.id !== undefined ? String(item.id) : undefined,
  );
  const authorHandle = item.author_info?.unique_id;
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
    title: item.desc,
    authorName: firstNonEmptyString(
      item.author_info?.nickname,
      item.author_info?.unique_id,
    ),
    authorHandle,
    authorAvatarUrl: firstNonEmptyString(
      ...urlsOf(item.author_info?.avatar_url_list),
    ),
    videoUrl:
      postType === "video" ? getTikTokPlayerApiDirectVideoUrl(item) : undefined,
    media,
    audio: getTikTokPlayerApiAudio(item),
    likeCount: item.statistics_info?.digg_count,
    commentCount: item.statistics_info?.comment_count,
    viewCount: item.statistics_info?.play_count,
    shareCount: item.statistics_info?.share_count,
  };
}

interface TikTokPlayerApiLookup {
  metadata: TikTokProxyMetadata | null;
  /** TikTok's own player API confirmed the post no longer exists. */
  gone: boolean;
  /** The request failed in a way worth retrying (network, 429, 5xx). */
  transient: boolean;
}

/**
 * TikTok's player API answers a deleted, private or region-removed post with
 * `results: [{ code: "nil_core_data" }]` (or lists it in `fatal_item_ids`)
 * instead of an item. That is the only positive "gone" signal: oEmbed keeps
 * returning a generic player for dead posts and tikwm only says "parsing
 * failed".
 */
function isTikTokPlayerApiGonePayload(
  payload: TikTokPlayerApiResponse | undefined,
  itemId: string,
): boolean {
  if (!payload || payload.items?.length) return false;

  if (payload.extra?.fatal_item_ids?.includes(itemId)) return true;

  return (payload.results ?? []).some((entry) => {
    const id = entry.id_str ?? entry.id ?? "";
    return (
      (id === "" || id === itemId) &&
      entry.code !== undefined &&
      /nil_core_data|not_?found|deleted|private/i.test(entry.code)
    );
  });
}

function isTransientUpstreamStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

async function fetchTikTokPlayerApiLookup(
  rawUrl: string,
): Promise<TikTokPlayerApiLookup> {
  const resolvedUrl = await resolveTikTokLookupUrl(rawUrl);
  const itemId =
    extractTikTokItemId(resolvedUrl) ?? extractTikTokItemId(rawUrl);
  if (!itemId) {
    return { metadata: null, gone: false, transient: false };
  }

  const apiUrl = `https://www.tiktok.com/player/api/v1/items?item_ids=${encodeURIComponent(itemId)}`;

  try {
    const response = await safeFetch(apiUrl, {
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
      return {
        metadata: null,
        gone: false,
        transient: isTransientUpstreamStatus(response.status),
      };
    }

    const payload = await readJsonCapped(response, TikTokPlayerApiResponse);
    const item = payload?.items?.[0];
    return {
      metadata: item ? mapTikTokPlayerApiMetadata(item) : null,
      gone: !item && isTikTokPlayerApiGonePayload(payload, itemId),
      transient: false,
    };
  } catch (error) {
    log.warn("TikTok player api request threw", {
      sourceUrl: rawUrl,
      error: error instanceof Error ? error.message : String(error),
    });
    return { metadata: null, gone: false, transient: true };
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
  let data: TikwmData | null = null;

  for (const baseUrl of TIKTOK_PROXY_API_BASE_URLS) {
    const apiUrl = `${baseUrl}?url=${encodeURIComponent(url)}`;

    try {
      const response = await safeFetch(apiUrl, {
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

      const payload = await readJsonCapped(response, TikwmResponse);
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
  const title = firstNonEmptyString(data.title, data.content_desc?.join("\n"));
  const authorHandle = data.author?.unique_id;
  const postId = data.id;

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
    authorAvatarUrl: data.author?.avatar,
    videoUrl: getTikTokDirectVideoUrl(data, postType),
    media,
    audio: getTikTokAudio(data),
    likeCount: data.digg_count,
    commentCount: data.comment_count,
    viewCount: data.play_count,
    shareCount: data.share_count,
    timestamp: data.create_time,
  };
}

export interface TikTokProxyLookup {
  metadata: TikTokProxyMetadata | null;
  /** Confirmed deleted/private: safe to tombstone and negative-cache. */
  unavailable: boolean;
  /** No metadata because an upstream was down; retry later. */
  transient: boolean;
}

export async function fetchTikTokProxyLookup(
  url: string,
): Promise<TikTokProxyLookup> {
  const player = await fetchTikTokPlayerApiLookup(url);
  const playerMetadata = player.metadata;
  const shouldSupplementWithTikwm =
    !hasTikTokMetadataContent(playerMetadata) ||
    playerMetadata.postType === "slideshow";

  if (!shouldSupplementWithTikwm) {
    return { metadata: playerMetadata, unavailable: false, transient: false };
  }

  // A post TikTok itself reports as gone will not come back from tikwm.
  if (player.gone) {
    return { metadata: null, unavailable: true, transient: false };
  }

  const tikwmMetadata = await fetchTikTokTikwmMetadata(url);
  if (
    hasTikTokMetadataContent(playerMetadata) &&
    hasTikTokMetadataContent(tikwmMetadata)
  ) {
    return {
      metadata: mergeTikTokMetadata(playerMetadata, tikwmMetadata),
      unavailable: false,
      transient: false,
    };
  }

  const metadata = tikwmMetadata ?? playerMetadata;
  return {
    metadata,
    unavailable: false,
    transient: !metadata && player.transient,
  };
}

export async function fetchTikTokProxyMetadata(
  url: string,
): Promise<TikTokProxyMetadata | null> {
  return (await fetchTikTokProxyLookup(url)).metadata;
}

export async function lookupInstagramOEmbed(url: string): Promise<{
  status: number;
  metadata: InstagramOEmbedMetadata | null;
}> {
  const canonicalUrl = canonicalizeInstagramUrl(url);
  const apiUrl = `https://www.instagram.com/api/v1/oembed/?url=${encodeURIComponent(canonicalUrl)}&omitscript=true`;
  const response = await safeFetch(apiUrl, {
    headers: {
      "User-Agent": getBotUserAgent(),
      Accept: "application/json",
    },
  });

  if (!response.ok || !response.headers.get("Content-Type")?.includes("json")) {
    return { status: response.status, metadata: null };
  }

  const payload = await readJsonCapped(response, InstagramOEmbedResponse);
  if (!payload) {
    return { status: response.status, metadata: null };
  }

  return {
    status: response.status,
    metadata: {
      mediaId: payload.media_id,
      title: payload.title,
      authorName: payload.author_name,
      authorUrl: payload.author_url,
      providerName: payload.provider_name,
      providerUrl: payload.provider_url,
      thumbnailUrl: payload.thumbnail_url,
      thumbnailWidth: payload.thumbnail_width,
      thumbnailHeight: payload.thumbnail_height,
    },
  };
}

export async function fetchInstagramOEmbedMetadata(
  url: string,
): Promise<InstagramOEmbedMetadata | null> {
  return (await lookupInstagramOEmbed(url)).metadata;
}

export async function fetchInstagramVideoMetadata(
  url: string,
): Promise<InstagramVideoMetadata | null> {
  const canonicalUrl = canonicalizeInstagramUrl(url);
  const response = await safeFetch(
    `${getPublicWebUrl()}/api/instagram-video?videoUrl=${encodeURIComponent(canonicalUrl)}`,
    {
      headers: {
        Accept: "application/json",
        "User-Agent": getBotUserAgent(),
      },
    },
  );

  if (!response.ok || !response.headers.get("Content-Type")?.includes("json")) {
    return null;
  }

  const payload = await readJsonCapped(response, InstagramVideoApiResponse);
  if (!payload) return null;

  return {
    videoUrl: payload.videoUrl,
    thumbnailUrl: payload.thumbnailUrl,
    title: payload.title,
    durationSeconds: payload.durationSeconds,
    media: payload.media,
    authorName: payload.authorName,
    authorUrl: payload.authorUrl,
    authorAvatarUrl: payload.authorAvatarUrl,
    authorVerified: payload.authorVerified,
    likeCount: payload.likeCount,
    commentCount: payload.commentCount,
    viewCount: payload.viewCount,
    timestamp: payload.timestamp,
    audio: payload.audio && {
      title: payload.audio.title,
      artist: payload.audio.artist,
      url: payload.audio.url,
      artworkUrl: payload.audio.artworkUrl,
    },
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

  const upstream = await safeFetch(parsed.toString(), {
    redirect: "follow",
    headers: {
      "User-Agent": getBotUserAgent(),
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
