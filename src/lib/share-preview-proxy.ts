import { getBotUserAgent, getPublicWebUrl } from "@/lib/platform";
import type { MessageShare } from "@/services/message-share.service";
import type { EmbedAudio, EmbedMedia } from "@/lib/types";
import { clog } from "@/lib/console-logger";
import { safeFetch, readJsonCapped, readTextCapped } from "@/lib/safe-fetch";
import { cacheGet, cacheSet } from "@/lib/cache";
import { singleFlight } from "@/lib/single-flight";
import { TtlMemo, upstreamGuard } from "@/lib/upstream-guard";
import {
  InstagramOEmbedResponse,
  InstagramVideoApiResponse,
} from "@/lib/vendor-payloads/instagram";
import {
  isTikTokPageGone,
  readTikTokPageVideoDetail,
  TikTokPlayerApiResponse,
  TikwmResponse,
  type TikTokPageVideoDetail,
  type TikwmData,
  type TikTokPlayerItem,
  type TikTokUrlRef,
} from "@/lib/vendor-payloads/tiktok";

const log = clog("share-preview-proxy");

const TIKTOK_PROXY_API_BASE_URLS = [
  "https://www.tikwm.com/api/",
  "https://tikwm.com/api/",
];

/** Circuit-breaker names (see `@/lib/upstream-guard`). */
const TIKTOK_UPSTREAM = {
  web: "tiktok-web",
  player: "tiktok-player-api",
  page: "tiktok-page",
  tikwm: "tikwm",
} as const;

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

function extractTikTokHandle(rawUrl: string): string | undefined {
  try {
    const handle = new URL(rawUrl).pathname.match(/^\/@([^/]+)/)?.[1];
    return handle ? decodeURIComponent(handle).trim() || undefined : undefined;
  } catch {
    return undefined;
  }
}

function getTikTokPathPostType(rawUrl: string): "video" | "slideshow" {
  return /\/photo\/\d+/.test(rawUrl) ? "slideshow" : "video";
}

/** `https://host/path` with the query and fragment dropped. */
function stripTikTokUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    return `https://${parsed.hostname.toLowerCase()}${parsed.pathname}`;
  } catch {
    return rawUrl;
  }
}

/** A short link always points at the same post: remember it for a week. */
const TIKTOK_SHORT_LINK_TTL_SECONDS = 7 * 24 * 60 * 60;
const shortLinkMemo = new TtlMemo<string>(500);

function tiktokShortLinkCacheKey(rawUrl: string): string {
  return `v1:tiktok-short:${stripTikTokUrl(rawUrl)}`;
}

async function resolveTikTokLookupUrl(rawUrl: string): Promise<string> {
  if (!isTikTokShortLookupUrl(rawUrl)) return rawUrl;

  const key = tiktokShortLinkCacheKey(rawUrl);
  const memoized = shortLinkMemo.get(key);
  if (memoized) return memoized;
  const cached = await cacheGet<string>(key);
  if (typeof cached === "string" && extractTikTokItemId(cached)) {
    shortLinkMemo.set(key, cached, TIKTOK_SHORT_LINK_TTL_SECONDS * 1000);
    return cached;
  }

  try {
    const response = await upstreamGuard.fetch(
      TIKTOK_UPSTREAM.web,
      rawUrl,
      {
        method: "HEAD",
        redirect: "follow",
        headers: TIKTOK_PAGE_RESOLVE_HEADERS,
      },
      { tripOn: [403] },
    );
    const resolved = response.url ? stripTikTokUrl(response.url) : null;
    if (resolved && extractTikTokItemId(resolved)) {
      shortLinkMemo.set(key, resolved, TIKTOK_SHORT_LINK_TTL_SECONDS * 1000);
      void cacheSet(key, resolved, TIKTOK_SHORT_LINK_TTL_SECONDS);
      return resolved;
    }
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

/** What one TikTok source said about a post. */
interface TikTokSourceResult {
  metadata: TikTokProxyMetadata | null;
  /** The source positively reported the post deleted or private. */
  gone?: boolean;
  /** The post exists but TikTok hides it from logged-out viewers. */
  restricted?: boolean;
  /** The request failed in a way worth retrying (network, 429, 5xx, backoff). */
  transient: boolean;
}

/**
 * TikTok's player API answers `results: [{ code: "nil_core_data" }]` (or
 * lists the id in `fatal_item_ids`) when it will not serve an item. That
 * covers deleted posts, but also posts that are alive and age- or
 * sensitivity-gated ("content classified"), so it is NOT a gone signal on
 * its own: the web page decides (see `fetchTikTokPageSource`).
 */
function isTikTokPlayerApiNilPayload(
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

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function fetchTikTokPlayerApiSource(
  itemId: string,
  sourceUrl: string,
): Promise<TikTokSourceResult & { nil?: boolean }> {
  const apiUrl = `https://www.tiktok.com/player/api/v1/items?item_ids=${encodeURIComponent(itemId)}`;

  try {
    // The endpoint answers a missing item with 200 + nil_core_data, so a 403
    // or 404 means it refused this caller (it does from some egress ranges):
    // back off instead of asking again on every view.
    const response = await upstreamGuard.fetch(
      TIKTOK_UPSTREAM.player,
      apiUrl,
      {
        headers: {
          ...TIKTOK_PLAYER_REQUEST_HEADERS,
          Referer: `https://www.tiktok.com/player/v1/${itemId}?description=1&music_info=1`,
        },
      },
      { tripOn: [403, 404] },
    );

    const contentType =
      response.headers.get("Content-Type")?.toLowerCase() ?? "";
    if (!response.ok || !contentType.includes("json")) {
      log.warn("TikTok player api request failed", {
        apiUrl,
        status: response.status,
        contentType,
        sourceUrl,
      });
      return {
        metadata: null,
        transient: isTransientUpstreamStatus(response.status),
      };
    }

    const payload = await readJsonCapped(response, TikTokPlayerApiResponse);
    const item = payload?.items?.[0];
    return {
      metadata: item ? mapTikTokPlayerApiMetadata(item) : null,
      nil: !item && isTikTokPlayerApiNilPayload(payload, itemId),
      transient: false,
    };
  } catch (error) {
    log.warn("TikTok player api request threw", {
      sourceUrl,
      error: describeError(error),
    });
    return { metadata: null, transient: true };
  }
}

// ── Web page source ─────────────────────────────────────────────────────────

/** The page is ~400 KB; anything far past that is not a post page. */
const TIKTOK_PAGE_MAX_BYTES = 3 * 1024 * 1024;

/** `"ugnewwave's short video with ♬ nothing left"` -> `"nothing left"`. */
function readTikTokShareMetaSound(
  desc: string | undefined,
): string | undefined {
  const sound = desc?.match(/♬\s*(.+)$/)?.[1]?.trim();
  return sound || undefined;
}

/** `"ugnewwave on TikTok"` -> `"ugnewwave"`. */
function readTikTokShareMetaAuthor(
  title: string | undefined,
): string | undefined {
  const name = title?.match(/^(.+?)\s+on TikTok$/i)?.[1]?.trim();
  return name || undefined;
}

function mapTikTokPageDetail(
  detail: TikTokPageVideoDetail,
  itemId: string,
): TikTokProxyMetadata | null {
  const item = detail.itemInfo?.itemStruct;
  const shareSound = readTikTokShareMetaSound(detail.shareMeta?.desc);
  const shareAuthor = readTikTokShareMetaAuthor(detail.shareMeta?.title);
  const images = item?.imagePost?.images ?? [];
  const postType: "video" | "slideshow" =
    images.length > 0 ? "slideshow" : "video";
  const authorHandle = item?.author?.uniqueId;
  const coverUrl = firstNonEmptyString(
    item?.video?.originCover,
    item?.video?.cover,
    item?.video?.dynamicCover,
  );
  const media: EmbedMedia[] = [];
  for (const image of images) {
    const url = image.imageURL?.urlList?.[0];
    if (!url) continue;
    media.push({
      type: "image",
      url,
      width: image.imageWidth,
      height: image.imageHeight,
    });
  }
  const musicTitle = firstNonEmptyString(item?.music?.title, shareSound);
  const audio: EmbedAudio | undefined = musicTitle
    ? {
        title: musicTitle,
        artist: item?.music?.authorName,
        artworkUrl: firstNonEmptyString(
          item?.music?.coverMedium,
          item?.music?.coverLarge,
        ),
      }
    : undefined;
  const metadata: TikTokProxyMetadata = {
    id: item?.id ?? itemId,
    canonicalUrl: buildTikTokCanonicalUrl(
      authorHandle,
      item?.id ?? itemId,
      postType,
    ),
    postType,
    coverUrl: coverUrl ?? media[0]?.url,
    title: item?.desc,
    authorName: firstNonEmptyString(item?.author?.nickname, authorHandle),
    authorHandle: authorHandle ?? shareAuthor,
    authorAvatarUrl: firstNonEmptyString(
      item?.author?.avatarMedium,
      item?.author?.avatarLarger,
      item?.author?.avatarThumb,
    ),
    // The page's playAddr only plays with the visitor's cookies, so the page
    // never supplies the direct video; tikwm or the player API do.
    media: media.length > 0 ? media : undefined,
    audio,
    likeCount: item?.stats?.diggCount,
    commentCount: item?.stats?.commentCount,
    viewCount: item?.stats?.playCount,
    shareCount: item?.stats?.shareCount,
    timestamp: item?.createTime,
  };
  const hasAuthor = Boolean(metadata.authorHandle);
  return hasTikTokMetadataContent(metadata) || hasAuthor ? metadata : null;
}

async function fetchTikTokPageSource(
  pageUrl: string,
  itemId: string,
): Promise<TikTokSourceResult> {
  try {
    const response = await upstreamGuard.fetch(
      TIKTOK_UPSTREAM.page,
      pageUrl,
      { headers: TIKTOK_PAGE_RESOLVE_HEADERS, redirect: "follow" },
      { tripOn: [403] },
    );
    if (!response.ok) {
      log.warn("TikTok page request failed", {
        status: response.status,
        sourceUrl: pageUrl,
      });
      return {
        metadata: null,
        transient: isTransientUpstreamStatus(response.status),
      };
    }

    const detail = readTikTokPageVideoDetail(
      await readTextCapped(response, TIKTOK_PAGE_MAX_BYTES),
    );
    if (!detail) {
      // A captcha or bot wall: no answer either way.
      log.warn("TikTok page had no video detail", { sourceUrl: pageUrl });
      return { metadata: null, transient: false };
    }
    if (isTikTokPageGone(detail)) {
      return { metadata: null, gone: true, transient: false };
    }

    const item = detail.itemInfo?.itemStruct;
    return {
      metadata: mapTikTokPageDetail(detail, itemId),
      restricted:
        item?.isContentClassified === true ||
        (detail.statusCode === 0 && !!item && !item.author),
      transient: false,
    };
  } catch (error) {
    log.warn("TikTok page request threw", {
      sourceUrl: pageUrl,
      error: describeError(error),
    });
    return { metadata: null, transient: true };
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

async function fetchTikTokTikwmSource(
  url: string,
): Promise<{ metadata: TikTokProxyMetadata | null; transient: boolean }> {
  let data: TikwmData | null = null;
  let transient = false;

  for (const baseUrl of TIKTOK_PROXY_API_BASE_URLS) {
    const apiUrl = `${baseUrl}?url=${encodeURIComponent(url)}`;
    // Both hosts are one service with one rate limit; each has its own
    // circuit only because one can be unreachable while the other is not.
    const provider = `${TIKTOK_UPSTREAM.tikwm}:${new URL(baseUrl).hostname}`;

    try {
      // tikwm answers an unknown post with 200 + a non-zero code, so 403/404
      // means it refused this caller.
      const response = await upstreamGuard.fetch(
        provider,
        apiUrl,
        { headers: TIKTOK_PROXY_REQUEST_HEADERS },
        { tripOn: [403, 404] },
      );

      const contentType =
        response.headers.get("Content-Type")?.toLowerCase() ?? "";
      if (!response.ok || !contentType.includes("json")) {
        log.warn("TikTok proxy metadata request failed", {
          apiUrl: baseUrl,
          status: response.status,
          contentType,
          sourceUrl: url,
        });
        transient ||= isTransientUpstreamStatus(response.status);
        continue;
      }

      const payload = await readJsonCapped(response, TikwmResponse);
      if (payload?.code !== 0 || !payload.data) {
        log.warn("TikTok proxy metadata payload missing data", {
          apiUrl: baseUrl,
          code: payload?.code ?? null,
          sourceUrl: url,
        });
        // "Free Api Limit: 1 request/second": the other host shares it.
        if (payload?.msg && /limit/i.test(payload.msg)) {
          upstreamGuard.trip(provider, 2);
          transient = true;
          break;
        }
        continue;
      }

      data = payload.data;
      break;
    } catch (error) {
      log.warn("TikTok proxy metadata request threw", {
        apiUrl: baseUrl,
        sourceUrl: url,
        error: describeError(error),
      });
      transient = true;
    }
  }

  if (!data) return { metadata: null, transient };
  return { metadata: mapTikwmMetadata(data), transient: false };
}

function mapTikwmMetadata(data: TikwmData): TikTokProxyMetadata {
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
  /**
   * What the URL alone says about the post (id, handle, canonical URL), so a
   * card can name the author even when every metadata source failed.
   */
  baseline?: TikTokProxyMetadata;
  /** Confirmed deleted/private: safe to tombstone and negative-cache. */
  unavailable: boolean;
  /**
   * The post exists but TikTok hides it from logged-out viewers (age or
   * sensitivity gate). Its official player shows "Video currently
   * unavailable", so only a direct video can play it inline.
   */
  restricted?: boolean;
  /** No metadata because an upstream was down or backing off; retry later. */
  transient: boolean;
}

function hasTikTokDirectMedia(
  metadata: TikTokProxyMetadata | null | undefined,
): boolean {
  if (!metadata) return false;
  if (metadata.postType === "slideshow") {
    return Boolean(metadata.media?.some((entry) => entry.type === "image"));
  }
  return Boolean(
    metadata.videoUrl ||
    metadata.media?.some((entry) => entry.type === "video"),
  );
}

function mergeOptionalTikTokMetadata(
  primary: TikTokProxyMetadata | null,
  secondary: TikTokProxyMetadata | null,
): TikTokProxyMetadata | null {
  if (!primary) return secondary;
  if (!secondary) return primary;
  return mergeTikTokMetadata(primary, secondary);
}

/**
 * The provider chain. Each step runs only while the post still lacks
 * something a card needs, so a public video costs one request:
 *
 *   1. TikTok's player API: author, caption, cover, stats and a direct video.
 *   2. The post's web page (`__UNIVERSAL_DATA_FOR_REHYDRATION__`), only when
 *      the player API gave no item. It is the one source that tells a deleted
 *      post (status 10204) from an age-gated one (an item stripped to its id).
 *   3. tikwm, for a direct video (or slideshow images and audio) nothing
 *      above supplied.
 *
 * "Gone" needs a positive answer from the page. A failed scraper, a
 * `nil_core_data` from the player API, or an oEmbed that answers for any id
 * never mark a post unavailable.
 */
async function runTikTokLookupChain(url: string): Promise<TikTokProxyLookup> {
  const resolvedUrl = await resolveTikTokLookupUrl(url);
  const itemId =
    extractTikTokItemId(resolvedUrl) ?? extractTikTokItemId(url) ?? undefined;
  const handle = extractTikTokHandle(resolvedUrl) ?? extractTikTokHandle(url);
  const pathPostType = getTikTokPathPostType(resolvedUrl);
  const canonicalUrl = buildTikTokCanonicalUrl(handle, itemId, pathPostType);
  const baseline: TikTokProxyMetadata | undefined =
    itemId || handle
      ? {
          id: itemId,
          canonicalUrl,
          postType: pathPostType,
          authorName: handle,
          authorHandle: handle,
        }
      : undefined;

  let metadata: TikTokProxyMetadata | null = null;
  let restricted = false;
  let transient = false;

  if (itemId) {
    const player = await fetchTikTokPlayerApiSource(itemId, url);
    metadata = player.metadata;
    transient ||= player.transient;

    if (!metadata && canonicalUrl) {
      const page = await fetchTikTokPageSource(canonicalUrl, itemId);
      if (page.gone) {
        return {
          metadata: null,
          baseline,
          unavailable: true,
          transient: false,
        };
      }
      metadata = page.metadata;
      restricted = page.restricted === true;
      transient ||= page.transient;
    }
  }

  if (!hasTikTokDirectMedia(metadata) || metadata?.postType === "slideshow") {
    const tikwm = await fetchTikTokTikwmSource(
      canonicalUrl ?? stripTikTokUrl(resolvedUrl),
    );
    // tikwm fills what the player API lacks for slideshows (live photos,
    // audio) and is the only direct video for a gated post.
    metadata = mergeOptionalTikTokMetadata(metadata, tikwm.metadata);
    transient ||= tikwm.transient;
  }

  const hasContent = hasTikTokMetadataContent(metadata);
  return {
    metadata: hasContent
      ? mergeOptionalTikTokMetadata(metadata, baseline ?? null)
      : null,
    baseline: metadata?.authorHandle
      ? {
          ...baseline,
          authorHandle: metadata.authorHandle,
          authorName: metadata.authorName ?? metadata.authorHandle,
        }
      : baseline,
    unavailable: false,
    restricted: restricted || undefined,
    transient: !hasContent && transient,
  };
}

// ── Lookup cache ────────────────────────────────────────────────────────────
//
// Every consumer (message embeds, /api/tiktok-video, share refresh) asks for
// the same URL in bursts: a message posted to a busy channel, a list of
// cards mounting at once. Identical concurrent lookups share one chain run,
// and answers are remembered in the isolate:
//   - resolved: until the earliest media signature is 5 minutes from expiry
//     (capped at 20 minutes);
//   - gone: 30 minutes (consumers keep it longer in KV);
//   - nothing usable, sources answered: 5 minutes;
//   - nothing usable, an upstream was down or backing off: 1 minute.
// KV persistence stays with the consumers, which already key and expire it.

const TIKTOK_LOOKUP_MEMO_MAX_MS = 20 * 60_000;
const TIKTOK_LOOKUP_GONE_MS = 30 * 60_000;
const TIKTOK_LOOKUP_EMPTY_MS = 5 * 60_000;
const TIKTOK_LOOKUP_TRANSIENT_MS = 60_000;
const TIKTOK_SIGNATURE_SAFETY_MS = 5 * 60_000;

const lookupMemo = new TtlMemo<TikTokProxyLookup>(500);
const lookupFlights = new Map<string, Promise<TikTokProxyLookup>>();

function earliestSignedExpiryMs(metadata: TikTokProxyMetadata): number | null {
  let earliest: number | null = null;
  const text = JSON.stringify(metadata);
  for (const match of text.matchAll(/[?&]x-expires=(\d{9,11})/g)) {
    const ms = Number(match[1]) * 1000;
    if (earliest === null || ms < earliest) earliest = ms;
  }
  return earliest;
}

export function tiktokLookupMemoMs(
  lookup: TikTokProxyLookup,
  now = Date.now(),
): number {
  if (lookup.unavailable) return TIKTOK_LOOKUP_GONE_MS;
  if (!lookup.metadata) {
    return lookup.transient
      ? TIKTOK_LOOKUP_TRANSIENT_MS
      : TIKTOK_LOOKUP_EMPTY_MS;
  }
  const expiry = earliestSignedExpiryMs(lookup.metadata);
  if (expiry === null) return TIKTOK_LOOKUP_MEMO_MAX_MS;
  return Math.max(
    0,
    Math.min(
      TIKTOK_LOOKUP_MEMO_MAX_MS,
      expiry - TIKTOK_SIGNATURE_SAFETY_MS - now,
    ),
  );
}

export async function fetchTikTokProxyLookup(
  url: string,
  options?: { bypassCache?: boolean },
): Promise<TikTokProxyLookup> {
  const key = stripTikTokUrl(url);
  if (!options?.bypassCache) {
    const memoized = lookupMemo.get(key);
    if (memoized) return memoized;
  }

  return singleFlight(lookupFlights, key, async () => {
    const lookup = await runTikTokLookupChain(url);
    lookupMemo.set(key, lookup, tiktokLookupMemoMs(lookup));
    return lookup;
  });
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
