import { getBotUserAgent } from "@/lib/platform";
import { env } from "cloudflare:workers";

import { cacheGet, cacheSet } from "@/lib/cache";
import { fetchInstagramOEmbedMetadata } from "@/lib/share-preview-proxy";
import { singleFlight } from "@/lib/single-flight";
import type { EmbedAudio, EmbedMedia } from "@/lib/types";
import { safeFetch, readTextCapped, readJsonCapped } from "@/lib/safe-fetch";
import { safeParse } from "@/lib/schema";
import {
  InstagramGraphqlResponse,
  InstagramMediaInfoResponse,
  type InstagramImageCandidate,
  type InstagramMediaItem,
  type InstagramMediaNode,
} from "@/lib/vendor-payloads/instagram";

const INSTAGRAM_VIDEO_TTL = 50 * 60;
const INSTAGRAM_VIDEO_CACHE_SAFETY_WINDOW = 5 * 60;
const INSTAGRAM_WEAK_FALLBACK_TTL = 5 * 60;

export interface InstagramVideoResult {
  videoUrl: string | null;
  thumbnailUrl: string | null;
  title: string | null;
  durationSeconds: number | null;
  media?: EmbedMedia[];
  authorName?: string | null;
  authorUrl?: string | null;
  authorAvatarUrl?: string | null;
  authorVerified?: boolean | null;
  likeCount?: number | null;
  commentCount?: number | null;
  viewCount?: number | null;
  timestamp?: string | null;
  audio?: EmbedAudio | null;
}

function decodeInstagramXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => {
      const codePoint = Number.parseInt(hex, 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : _;
    })
    .replace(/&#(\d+);/g, (_, decimal: string) => {
      const codePoint = Number.parseInt(decimal, 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : _;
    });
}

export function extractInstagramVideoUrlsFromDashManifest(
  manifest: string,
): string[] {
  const urls: string[] = [];
  for (const match of manifest.matchAll(
    /<BaseURL>(https?:\/\/[^<]+)<\/BaseURL>/g,
  )) {
    const rawUrl = match[1];
    if (!rawUrl) continue;
    urls.push(decodeInstagramXmlEntities(rawUrl));
  }
  return urls;
}

interface InstagramSessionSecrets {
  sessionId: string;
  csrfToken: string;
  dsUserId?: string;
  mid?: string;
  igDid?: string;
  rur?: string;
}

function normalizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, "").trim();
}

function firstNonEmptyString(
  ...values: Array<string | null | undefined>
): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function escapeRegexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readInstagramMetaContent(html: string, key: string): string | null {
  const escapedKey = escapeRegexLiteral(key);
  const patterns = [
    new RegExp(
      `<meta[^>]+property=["']${escapedKey}["'][^>]+content=["']([^"']+)["']`,
      "i",
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${escapedKey}["']`,
      "i",
    ),
    new RegExp(
      `<meta[^>]+name=["']${escapedKey}["'][^>]+content=["']([^"']+)["']`,
      "i",
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${escapedKey}["']`,
      "i",
    ),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return decodeInstagramXmlEntities(match[1]);
    }
  }

  return null;
}

function extractInstagramCaptionFromMetaText(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string" || !value.trim()) return null;

  const decoded = decodeInstagramXmlEntities(value).trim();
  const captionSource = decoded.includes(":")
    ? decoded.slice(decoded.lastIndexOf(":") + 1)
    : decoded;
  const normalized = captionSource
    .trim()
    .replace(/^["'“”]+/, "")
    .replace(/["'“”]+\.?\s*$/, "")
    .trim();

  return normalized || null;
}

function parseInstagramMetricCount(
  value: string | null | undefined,
): number | null {
  if (typeof value !== "string" || !value.trim()) return null;

  const normalized = value.replace(/,/g, "").trim();
  const compactMatch = normalized.match(/^(\d+(?:\.\d+)?)\s*([kmb])$/i);
  if (compactMatch) {
    const amount = Number(compactMatch[1]);
    const suffix = compactMatch[2]?.toLowerCase();
    if (!Number.isFinite(amount) || !suffix) return null;

    const multiplier =
      suffix === "k" ? 1_000 : suffix === "m" ? 1_000_000 : 1_000_000_000;
    return Math.round(amount * multiplier);
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function extractInstagramMetricsFromDescription(
  description: string | null | undefined,
): {
  likeCount: number | null;
  commentCount: number | null;
  timestamp: string | null;
} {
  if (typeof description !== "string" || !description.trim()) {
    return {
      likeCount: null,
      commentCount: null,
      timestamp: null,
    };
  }

  const decoded = decodeInstagramXmlEntities(description).trim();
  const metricMatch = decoded.match(
    /^([\d.,kmb]+)\s+likes?,\s+([\d.,kmb]+)\s+comments?\s+-\s+.+?\s+on\s+([^:]+):/i,
  );

  return {
    likeCount: parseInstagramMetricCount(metricMatch?.[1] ?? null),
    commentCount: parseInstagramMetricCount(metricMatch?.[2] ?? null),
    timestamp: toIsoTimestamp(metricMatch?.[3]),
  };
}

function extractInstagramSharedEntityId(html: string): string | null {
  return (
    html.match(
      /(?:\\"|")shared_entity_id(?:\\"|"):(?:\\"|")(\d+)(?:\\"|")/,
    )?.[1] ?? null
  );
}

function readInstagramUrlExpiryEpochSeconds(
  rawUrl: string | null | undefined,
): number | null {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) return null;

  try {
    const parsed = new URL(rawUrl);
    const xExpires = parsed.searchParams.get("x-expires");
    if (xExpires) {
      const epoch = Number(xExpires);
      if (Number.isFinite(epoch) && epoch > 0) {
        return epoch;
      }
    }

    const oe = parsed.searchParams.get("oe");
    if (oe && /^[0-9a-f]+$/i.test(oe)) {
      const epoch = Number.parseInt(oe, 16);
      if (Number.isFinite(epoch) && epoch > 0) {
        return epoch;
      }
    }
  } catch {
    return null;
  }

  return null;
}

/**
 * Seconds a resolved result stays usable: bounded by the earliest signed CDN
 * URL in it (`oe` / `x-expires`) minus a safety window. Also drives the
 * route's browser `Cache-Control`.
 */
export function getInstagramMetadataCacheTtl(
  result: InstagramVideoResult,
): number {
  const expiries = [
    result.videoUrl,
    result.thumbnailUrl,
    result.authorAvatarUrl,
    result.audio?.url ?? null,
    result.audio?.artworkUrl ?? null,
    ...(result.media ?? []).flatMap((item) => [
      item.url,
      item.thumbnailUrl ?? null,
    ]),
  ].flatMap((candidate) => {
    const expiry = readInstagramUrlExpiryEpochSeconds(candidate);
    return expiry === null ? [] : [expiry];
  });

  if (expiries.length === 0) {
    return INSTAGRAM_VIDEO_TTL;
  }

  const earliestExpiry = Math.min(...expiries);
  const secondsUntilRefresh =
    earliestExpiry -
    Math.floor(Date.now() / 1000) -
    INSTAGRAM_VIDEO_CACHE_SAFETY_WINDOW;
  return Math.max(60, Math.min(INSTAGRAM_VIDEO_TTL, secondsUntilRefresh));
}

export function canonicalizeInstagramUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    const hostname = parsed.hostname.toLowerCase();
    if (!hostname.includes("instagram.com")) return null;

    const pathname = parsed.pathname.endsWith("/")
      ? parsed.pathname
      : `${parsed.pathname}/`;
    return `https://www.instagram.com${pathname}`;
  } catch {
    return null;
  }
}

export function extractInstagramShortcode(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    const match = parsed.pathname.match(
      /^\/(?:reel|reels|p|tv)\/([^/?#]+)\/?/i,
    );
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

export function normalizeInstagramMediaPk(
  mediaId: string | null | undefined,
): string | null {
  if (typeof mediaId !== "string") return null;
  const trimmed = mediaId.trim();
  if (!trimmed) return null;
  const [pk] = trimmed.split("_");
  return /^\d+$/.test(pk) ? pk : null;
}

function getInstagramSessionSecrets(): InstagramSessionSecrets | null {
  const sessionId =
    typeof env.INSTAGRAM_SESSIONID === "string"
      ? normalizeHeaderValue(env.INSTAGRAM_SESSIONID)
      : "";
  const csrfToken =
    typeof env.INSTAGRAM_CSRFTOKEN === "string"
      ? normalizeHeaderValue(env.INSTAGRAM_CSRFTOKEN)
      : "";

  if (!sessionId || !csrfToken) return null;

  const dsUserId =
    typeof env.INSTAGRAM_DS_USER_ID === "string"
      ? normalizeHeaderValue(env.INSTAGRAM_DS_USER_ID)
      : undefined;
  const mid =
    typeof env.INSTAGRAM_MID === "string"
      ? normalizeHeaderValue(env.INSTAGRAM_MID)
      : undefined;
  const igDid =
    typeof env.INSTAGRAM_IG_DID === "string"
      ? normalizeHeaderValue(env.INSTAGRAM_IG_DID)
      : undefined;
  const rur =
    typeof env.INSTAGRAM_RUR === "string"
      ? normalizeHeaderValue(env.INSTAGRAM_RUR)
      : undefined;

  return {
    sessionId,
    csrfToken,
    dsUserId,
    mid,
    igDid,
    rur,
  };
}

function buildInstagramCookieHeader(secrets: InstagramSessionSecrets): string {
  const entries = [
    ["sessionid", secrets.sessionId],
    ["csrftoken", secrets.csrfToken],
    ["ds_user_id", secrets.dsUserId],
    ["mid", secrets.mid],
    ["ig_did", secrets.igDid],
    ["rur", secrets.rur],
  ].filter(
    (entry): entry is [string, string] =>
      typeof entry[1] === "string" && entry[1].length > 0,
  );

  return entries.map(([key, value]) => `${key}=${value}`).join("; ");
}

function toIsoTimestamp(rawValue: number | string | undefined): string | null {
  if (typeof rawValue === "number") {
    return Number.isFinite(rawValue) && rawValue > 0
      ? new Date(rawValue * 1000).toISOString()
      : null;
  }

  if (typeof rawValue === "string" && rawValue.trim()) {
    const parsed = Number(rawValue);
    if (Number.isFinite(parsed) && parsed > 0) {
      return new Date(parsed * 1000).toISOString();
    }

    const fallbackDate = new Date(rawValue);
    return Number.isNaN(fallbackDate.getTime())
      ? null
      : fallbackDate.toISOString();
  }

  return null;
}

function getLargestImageCandidate(
  candidates: ReadonlyArray<InstagramImageCandidate>,
): { url: string; width?: number; height?: number } | null {
  const validCandidates = candidates
    .filter((candidate) => candidate.url.trim().length > 0)
    .sort(
      (a, b) =>
        (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0),
    );

  if (validCandidates.length === 0) return null;

  const best = validCandidates[0];
  return {
    url: best.url,
    width: best.width,
    height: best.height,
  };
}

function getBestInstagramVideoUrl(
  item: InstagramMediaNode,
): { url: string; width?: number; height?: number } | null {
  const bestVideo = (item.video_versions ?? [])
    .filter((version) => version.url)
    .sort(
      (a, b) =>
        (a.width ?? 0) * (a.height ?? 0) - (b.width ?? 0) * (b.height ?? 0),
    )
    .at(-1);

  if (bestVideo) {
    return {
      url: bestVideo.url,
      width: bestVideo.width,
      height: bestVideo.height,
    };
  }

  const dashManifest = item.video_dash_manifest ?? "";
  const dashUrls = extractInstagramVideoUrlsFromDashManifest(
    dashManifest,
  ).filter(
    (candidate) =>
      /\/o1\/v\/t16\//.test(candidate) ||
      /mime_type=video/.test(candidate) ||
      /\.(mp4)($|\?)/i.test(candidate),
  );
  const dashVideoUrl =
    dashUrls.find((candidate) => !/\/audio\//.test(candidate)) ??
    dashUrls[0] ??
    null;

  if (!dashVideoUrl) return null;

  return { url: dashVideoUrl };
}

function getInstagramAudio(item: InstagramMediaItem): EmbedAudio | null {
  const asset =
    item.clips_metadata?.music_info?.music_asset_info ??
    item.music_metadata?.music_info?.music_asset_info ??
    item.music_metadata?.music_asset;

  if (!asset) return null;

  const title = asset.title ?? asset.track_title;
  const artist = asset.display_artist ?? asset.artist_name;
  const url = asset.progressive_download_url ?? asset.url;
  const artworkUrl =
    asset.cover_artwork_uri ?? asset.cover_artwork_thumbnail_uri;

  if (!title && !artist && !url && !artworkUrl) return null;

  return {
    title,
    artist,
    url,
    artworkUrl,
  };
}

function getInstagramAuthorMetadata(item: InstagramMediaItem): {
  authorName: string | null;
  authorUrl: string | null;
  authorAvatarUrl: string | null;
  authorVerified: boolean | null;
} {
  const username = item.user?.username?.trim() || null;
  const authorName = username ?? (item.user?.full_name?.trim() || null);

  return {
    authorName,
    authorUrl: username ? `https://www.instagram.com/${username}` : null,
    authorAvatarUrl: item.user?.profile_pic_url ?? null,
    authorVerified: item.user?.is_verified ?? null,
  };
}

function mapInstagramMediaItem(item: InstagramMediaNode): EmbedMedia | null {
  const imageCandidate = getLargestImageCandidate(
    item.image_versions2?.candidates ?? [],
  );
  const video = getBestInstagramVideoUrl(item);
  const altText = item.accessibility_caption;
  const durationSeconds = item.video_duration;

  if (video?.url) {
    return {
      type: "video",
      url: video.url,
      width: video.width ?? imageCandidate?.width,
      height: video.height ?? imageCandidate?.height,
      thumbnailUrl: imageCandidate?.url,
      contentType: "video/mp4",
      altText,
      durationSeconds,
    };
  }

  if (!imageCandidate?.url) return null;

  return {
    type: "image",
    url: imageCandidate.url,
    width: imageCandidate.width,
    height: imageCandidate.height,
    altText,
  };
}

function collectInstagramMedia(item: InstagramMediaItem): EmbedMedia[] {
  const sourceItems: ReadonlyArray<InstagramMediaNode> = item.carousel_media
    ?.length
    ? item.carousel_media
    : [item];

  const media: EmbedMedia[] = [];
  const seen = new Set<string>();

  for (const sourceItem of sourceItems) {
    const mapped = mapInstagramMediaItem(sourceItem);
    if (!mapped) continue;

    const key = `${mapped.type}:${mapped.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    media.push(mapped);
  }

  return media;
}

function hasResolvedInstagramMetadata(
  result: InstagramVideoResult | null | undefined,
): result is InstagramVideoResult {
  if (!result) return false;

  return Boolean(
    result.videoUrl ||
    result.thumbnailUrl ||
    result.title ||
    result.media?.length ||
    result.authorAvatarUrl ||
    result.authorVerified !== undefined ||
    result.likeCount !== undefined ||
    result.commentCount !== undefined ||
    result.viewCount !== undefined ||
    result.timestamp ||
    result.audio,
  );
}

export function isInstagramWeakFallbackResult(
  result: InstagramVideoResult | null | undefined,
): boolean {
  if (!hasResolvedInstagramMetadata(result)) {
    return false;
  }

  const media = result.media ?? [];
  const hasVideoMedia =
    Boolean(result.videoUrl) || media.some((entry) => entry.type === "video");
  const hasMultipleMediaItems = media.length > 1;
  const hasSessionDerivedMetadata = Boolean(
    result.authorAvatarUrl ||
    (result.authorVerified !== null && result.authorVerified !== undefined) ||
    result.audio ||
    (result.viewCount !== null && result.viewCount !== undefined),
  );

  return !hasVideoMedia && !hasMultipleMediaItems && !hasSessionDerivedMetadata;
}

function isInstagramLegacyAuthorCacheResult(
  result: InstagramVideoResult | null | undefined,
): boolean {
  if (!hasResolvedInstagramMetadata(result)) {
    return false;
  }

  const hasAuthorPresentationMetadata =
    Boolean(result.authorAvatarUrl) ||
    (result.authorVerified !== null && result.authorVerified !== undefined);

  return hasAuthorPresentationMetadata && !result.authorName;
}

export function parseInstagramGraphqlPayload(
  payload: unknown,
): InstagramVideoResult {
  const decoded = safeParse(InstagramGraphqlResponse, payload);
  const media = decoded.success
    ? decoded.data.data?.xdt_shortcode_media
    : undefined;
  if (!media) {
    return {
      videoUrl: null,
      thumbnailUrl: null,
      title: null,
      durationSeconds: null,
    };
  }

  const caption = media.edge_media_to_caption?.edges?.[0]?.node?.text ?? null;
  const videoUrl = media.video_url?.trim() ? media.video_url : null;
  const thumbnailUrl = media.display_url?.trim() ? media.display_url : null;
  const mediaList = thumbnailUrl
    ? [
        {
          type: videoUrl ? ("video" as const) : ("image" as const),
          url: videoUrl ?? thumbnailUrl,
          thumbnailUrl: videoUrl ? thumbnailUrl : undefined,
          contentType: videoUrl ? "video/mp4" : undefined,
          durationSeconds: media.video_duration,
        },
      ]
    : undefined;

  return {
    videoUrl,
    thumbnailUrl,
    title: caption,
    durationSeconds: media.video_duration ?? null,
    media: mediaList,
  };
}

function buildInstagramIPhoneHeaders(
  canonicalUrl: string,
  secrets: InstagramSessionSecrets,
): HeadersInit {
  return {
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.8",
    Cookie: buildInstagramCookieHeader(secrets),
    Referer: canonicalUrl,
    "User-Agent":
      "Instagram 361.0.0.35.82 (iPad13,8; iOS 18_0; en_US; en-US; scale=2.00; 2048x2732; 674117118) AppleWebKit/420+",
    "X-CSRFToken": secrets.csrfToken,
    "X-IG-App-ID": "124024574287414",
    "ig-intended-user-id": secrets.dsUserId || "0",
    "x-ig-device-id": secrets.igDid || "",
    "x-ig-family-device-id": secrets.igDid || "",
    "x-mid": secrets.mid || "",
    "x-ig-www-claim": "0",
  };
}

async function fetchInstagramMediaInfoPayload(
  canonicalUrl: string,
  secrets: InstagramSessionSecrets,
  options: {
    mediaPk?: string | null;
    shortcode?: string | null;
  },
): Promise<InstagramMediaInfoResponse | undefined> {
  const candidateUrls = [
    options.mediaPk
      ? `https://i.instagram.com/api/v1/media/${encodeURIComponent(options.mediaPk)}/info/`
      : null,
    options.shortcode
      ? `https://i.instagram.com/api/v1/media/shortcode/${encodeURIComponent(options.shortcode)}/info/`
      : null,
    options.shortcode
      ? `https://www.instagram.com/api/v1/media/shortcode/${encodeURIComponent(options.shortcode)}/info/`
      : null,
  ].filter((value): value is string => typeof value === "string");

  let lastError: Error | null = null;

  for (const candidateUrl of candidateUrls) {
    try {
      const response = await safeFetch(candidateUrl, {
        headers: buildInstagramIPhoneHeaders(canonicalUrl, secrets),
        redirect: "manual",
      });

      if (!response.ok) {
        const text = await readTextCapped(response).catch(() => "");
        lastError = new Error(
          `Instagram media info failed with ${response.status}: ${text.slice(0, 200)}`,
        );
        continue;
      }

      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("json")) {
        const text = await readTextCapped(response).catch(() => "");
        lastError = new Error(
          `Instagram media info returned non-JSON content: ${text.slice(0, 200)}`,
        );
        continue;
      }

      return await readJsonCapped(response, InstagramMediaInfoResponse);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  if (lastError) {
    throw lastError;
  }

  throw new Error("Instagram media info could not be resolved");
}

function buildInstagramResultFromMediaItem(
  item: InstagramMediaItem,
  oembed?: {
    title?: string | null;
    thumbnailUrl?: string | null;
  },
): InstagramVideoResult {
  const media = collectInstagramMedia(item);
  const primaryVideo = media.find((entry) => entry.type === "video");
  const primaryImage = media.find((entry) => entry.type === "image");
  const fallbackImage = getLargestImageCandidate(
    item.image_versions2?.candidates ?? [],
  );
  const author = getInstagramAuthorMetadata(item);
  const caption = item.caption?.text?.trim()
    ? item.caption.text
    : (oembed?.title ?? null);
  const durationSeconds =
    item.video_duration ?? primaryVideo?.durationSeconds ?? null;

  return {
    videoUrl: primaryVideo?.url ?? null,
    thumbnailUrl:
      primaryVideo?.thumbnailUrl ??
      primaryImage?.url ??
      fallbackImage?.url ??
      oembed?.thumbnailUrl ??
      null,
    title: caption,
    durationSeconds,
    media: media.length > 0 ? media : undefined,
    authorName: author.authorName,
    authorUrl: author.authorUrl,
    authorAvatarUrl: author.authorAvatarUrl,
    authorVerified: author.authorVerified,
    likeCount: item.like_count ?? null,
    commentCount: item.comment_count ?? null,
    viewCount: item.view_count ?? item.play_count ?? null,
    timestamp: toIsoTimestamp(item.taken_at),
    audio: getInstagramAudio(item),
  };
}

async function fetchInstagramPublicPageSharedEntityId(
  canonicalUrl: string,
): Promise<string | null> {
  const response = await safeFetch(canonicalUrl, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.8",
      "User-Agent": getBotUserAgent(),
    },
  });

  if (!response.ok || !response.headers.get("content-type")?.includes("html")) {
    return null;
  }

  return extractInstagramSharedEntityId(await readTextCapped(response));
}

async function fetchInstagramSharedEntityMetadata(
  canonicalUrl: string,
  secrets: InstagramSessionSecrets,
  oembed?: {
    title?: string | null;
    thumbnailUrl?: string | null;
  },
): Promise<InstagramVideoResult | null> {
  const sharedEntityId =
    await fetchInstagramPublicPageSharedEntityId(canonicalUrl);
  if (!sharedEntityId) return null;

  try {
    const payload = await fetchInstagramMediaInfoPayload(
      canonicalUrl,
      secrets,
      {
        mediaPk: sharedEntityId,
        shortcode: null,
      },
    );
    const item = payload?.items?.[0];
    if (!item) return null;

    return buildInstagramResultFromMediaItem(item, oembed);
  } catch {
    return null;
  }
}

async function fetchInstagramPublicPageMetadata(
  canonicalUrl: string,
  fallback?: {
    thumbnailUrl?: string | null;
    title?: string | null;
  },
): Promise<InstagramVideoResult | null> {
  const response = await safeFetch(canonicalUrl, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.8",
      "User-Agent": getBotUserAgent(),
    },
  });

  if (!response.ok || !response.headers.get("content-type")?.includes("html")) {
    return null;
  }

  const html = await readTextCapped(response);
  const ogTitle = readInstagramMetaContent(html, "og:title");
  const ogDescription = firstNonEmptyString(
    readInstagramMetaContent(html, "og:description"),
    readInstagramMetaContent(html, "description"),
    readInstagramMetaContent(html, "twitter:description"),
  );
  const ogImageUrl = firstNonEmptyString(
    readInstagramMetaContent(html, "og:image"),
    fallback?.thumbnailUrl ?? null,
  );
  const ogVideoUrl = firstNonEmptyString(
    readInstagramMetaContent(html, "og:video:secure_url"),
    readInstagramMetaContent(html, "og:video:url"),
    readInstagramMetaContent(html, "og:video"),
  );
  const title = firstNonEmptyString(
    extractInstagramCaptionFromMetaText(ogTitle),
    extractInstagramCaptionFromMetaText(ogDescription),
    fallback?.title ?? null,
  );
  const { likeCount, commentCount, timestamp } =
    extractInstagramMetricsFromDescription(ogDescription);

  const media: EmbedMedia[] = [];
  if (ogVideoUrl) {
    media.push({
      type: "video",
      url: ogVideoUrl,
      thumbnailUrl: ogImageUrl ?? undefined,
      contentType: /\.(mp4)($|\?)/i.test(ogVideoUrl) ? "video/mp4" : undefined,
      altText: title ?? undefined,
    });
  } else if (ogImageUrl) {
    media.push({
      type: "image",
      url: ogImageUrl,
      altText: title ?? undefined,
    });
  }

  if (
    !ogVideoUrl &&
    !ogImageUrl &&
    !title &&
    likeCount === null &&
    commentCount === null &&
    !timestamp
  ) {
    return null;
  }

  return {
    videoUrl: ogVideoUrl ?? null,
    thumbnailUrl: ogImageUrl ?? null,
    title,
    durationSeconds: null,
    media: media.length > 0 ? media : undefined,
    authorAvatarUrl: null,
    authorVerified: null,
    likeCount,
    commentCount,
    viewCount: null,
    timestamp,
    audio: null,
  };
}

async function fetchInstagramMedia(
  canonicalUrl: string,
): Promise<InstagramVideoResult> {
  const secrets = getInstagramSessionSecrets();
  if (!secrets) {
    throw new Error("Instagram session secrets are not configured");
  }

  const oembed = await fetchInstagramOEmbedMetadata(canonicalUrl);
  const mediaPk = normalizeInstagramMediaPk(oembed?.mediaId);
  const shortcode = extractInstagramShortcode(canonicalUrl);
  const fallbackToPublicPage = () =>
    fetchInstagramPublicPageMetadata(canonicalUrl, {
      thumbnailUrl: oembed?.thumbnailUrl ?? null,
      title: oembed?.title ?? null,
    });
  const fallbackToSharedEntityMedia = () =>
    fetchInstagramSharedEntityMetadata(canonicalUrl, secrets, {
      thumbnailUrl: oembed?.thumbnailUrl ?? null,
      title: oembed?.title ?? null,
    });

  if (!mediaPk && !shortcode) {
    const sharedEntityFallback = await fallbackToSharedEntityMedia();
    if (sharedEntityFallback) {
      return sharedEntityFallback;
    }

    const publicFallback = await fallbackToPublicPage();
    if (publicFallback) {
      return publicFallback;
    }

    throw new Error("Instagram oEmbed did not return a media id");
  }

  let iPhonePayload: InstagramMediaInfoResponse | undefined;
  try {
    iPhonePayload = await fetchInstagramMediaInfoPayload(
      canonicalUrl,
      secrets,
      {
        mediaPk,
        shortcode,
      },
    );
  } catch (error) {
    const sharedEntityFallback = await fallbackToSharedEntityMedia();
    if (sharedEntityFallback) {
      return sharedEntityFallback;
    }

    const publicFallback = await fallbackToPublicPage();
    if (publicFallback) {
      return publicFallback;
    }

    throw error;
  }

  const item = iPhonePayload?.items?.[0];
  if (!item) {
    const sharedEntityFallback = await fallbackToSharedEntityMedia();
    if (sharedEntityFallback) {
      return sharedEntityFallback;
    }

    const publicFallback = await fallbackToPublicPage();
    if (publicFallback) {
      return publicFallback;
    }
  }
  const result = buildInstagramResultFromMediaItem(item ?? {}, {
    thumbnailUrl: oembed?.thumbnailUrl ?? null,
    title: oembed?.title ?? null,
  });

  if (hasResolvedInstagramMetadata(result)) {
    return result;
  }

  return (
    (await fallbackToSharedEntityMedia()) ??
    (await fallbackToPublicPage()) ??
    result
  );
}

const instagramMetadataFlights = new Map<
  string,
  Promise<InstagramVideoResult | null>
>();

export async function resolveInstagramVideoMetadata(
  rawUrl: string,
  options?: {
    bypassCache?: boolean;
  },
): Promise<InstagramVideoResult | null> {
  const canonicalUrl = canonicalizeInstagramUrl(rawUrl);
  if (!canonicalUrl) return null;

  const cacheKey = `instagram-video:${canonicalUrl}`;
  // A thumbnail-only ("weak") result found while session secrets are set is
  // kept apart with a short TTL: long enough that every view inside the
  // window is a cache hit, short enough that a full result is retried soon.
  // Before, it was written under the main key and then rejected on read, so
  // each view re-ran the whole scrape (~3 s in production).
  const weakCacheKey = `instagram-video:weak:${canonicalUrl}`;
  const load = async () => {
    const hasSessionSecrets = Boolean(getInstagramSessionSecrets());
    if (!options?.bypassCache) {
      const cached = await cacheGet<InstagramVideoResult>(cacheKey);
      if (
        hasResolvedInstagramMetadata(cached) &&
        (!hasSessionSecrets ||
          (!isInstagramWeakFallbackResult(cached) &&
            !isInstagramLegacyAuthorCacheResult(cached)))
      ) {
        return cached;
      }
      if (hasSessionSecrets) {
        const weak = await cacheGet<InstagramVideoResult>(weakCacheKey);
        if (hasResolvedInstagramMetadata(weak)) return weak;
      }
    }

    const result = await fetchInstagramMedia(canonicalUrl);
    if (hasResolvedInstagramMetadata(result)) {
      if (hasSessionSecrets && isInstagramWeakFallbackResult(result)) {
        void cacheSet(
          weakCacheKey,
          result,
          Math.min(
            INSTAGRAM_WEAK_FALLBACK_TTL,
            getInstagramMetadataCacheTtl(result),
          ),
        );
      } else {
        void cacheSet(cacheKey, result, getInstagramMetadataCacheTtl(result));
      }
    }

    return result;
  };

  if (options?.bypassCache) return load();
  return singleFlight(instagramMetadataFlights, cacheKey, load);
}
