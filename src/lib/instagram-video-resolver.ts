import { env } from "cloudflare:workers";

import { cacheGet, cacheSet } from "@/lib/cache";
import { fetchInstagramOEmbedMetadata } from "@/lib/share-preview-proxy";
import type { EmbedAudio, EmbedMedia } from "@/lib/types";

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
    timestamp: toIsoTimestamp(metricMatch?.[3] ?? null),
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

function getInstagramMetadataCacheTtl(result: InstagramVideoResult): number {
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

function toIsoTimestamp(rawValue: unknown): string | null {
  if (
    typeof rawValue === "number" &&
    Number.isFinite(rawValue) &&
    rawValue > 0
  ) {
    return new Date(rawValue * 1000).toISOString();
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
  candidates: any[],
): { url: string; width?: number; height?: number } | null {
  const validCandidates = candidates
    .filter(
      (candidate) =>
        typeof candidate?.url === "string" && candidate.url.trim().length > 0,
    )
    .sort(
      (a, b) =>
        Number(b?.width || 0) * Number(b?.height || 0) -
        Number(a?.width || 0) * Number(a?.height || 0),
    );

  if (validCandidates.length === 0) return null;

  const best = validCandidates[0];
  return {
    url: best.url,
    width: typeof best.width === "number" ? best.width : undefined,
    height: typeof best.height === "number" ? best.height : undefined,
  };
}

function getBestInstagramVideoUrl(
  item: any,
): { url: string; width?: number; height?: number } | null {
  const videoVersions = Array.isArray(item?.video_versions)
    ? item.video_versions
    : [];
  const bestVideo = videoVersions
    .filter((version: any) => typeof version?.url === "string" && version.url)
    .sort(
      (a: any, b: any) =>
        Number(a?.width || 0) * Number(a?.height || 0) -
        Number(b?.width || 0) * Number(b?.height || 0),
    )
    .at(-1);

  if (typeof bestVideo?.url === "string" && bestVideo.url) {
    return {
      url: bestVideo.url,
      width: typeof bestVideo.width === "number" ? bestVideo.width : undefined,
      height:
        typeof bestVideo.height === "number" ? bestVideo.height : undefined,
    };
  }

  const dashManifest =
    typeof item?.video_dash_manifest === "string"
      ? item.video_dash_manifest
      : "";
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

function getInstagramAudio(item: any): EmbedAudio | null {
  const asset =
    item?.clips_metadata?.music_info?.music_asset_info ??
    item?.music_metadata?.music_info?.music_asset_info ??
    item?.music_metadata?.music_asset;

  if (!asset || typeof asset !== "object") return null;

  const title =
    typeof asset.title === "string"
      ? asset.title
      : typeof asset.track_title === "string"
        ? asset.track_title
        : undefined;
  const artist =
    typeof asset.display_artist === "string"
      ? asset.display_artist
      : typeof asset.artist_name === "string"
        ? asset.artist_name
        : undefined;
  const url =
    typeof asset.progressive_download_url === "string"
      ? asset.progressive_download_url
      : typeof asset.url === "string"
        ? asset.url
        : undefined;
  const artworkUrl =
    typeof asset.cover_artwork_uri === "string"
      ? asset.cover_artwork_uri
      : typeof asset.cover_artwork_thumbnail_uri === "string"
        ? asset.cover_artwork_thumbnail_uri
        : undefined;

  if (!title && !artist && !url && !artworkUrl) return null;

  return {
    title,
    artist,
    url,
    artworkUrl,
  };
}

function getInstagramAuthorMetadata(item: any): {
  authorName: string | null;
  authorUrl: string | null;
  authorAvatarUrl: string | null;
  authorVerified: boolean | null;
} {
  const username =
    typeof item?.user?.username === "string" && item.user.username.trim()
      ? item.user.username.trim()
      : null;
  const authorName =
    username ??
    (typeof item?.user?.full_name === "string" && item.user.full_name.trim()
      ? item.user.full_name.trim()
      : null);

  return {
    authorName,
    authorUrl: username ? `https://www.instagram.com/${username}` : null,
    authorAvatarUrl:
      typeof item?.user?.profile_pic_url === "string"
        ? item.user.profile_pic_url
        : null,
    authorVerified:
      typeof item?.user?.is_verified === "boolean"
        ? item.user.is_verified
        : null,
  };
}

function mapInstagramMediaItem(item: any): EmbedMedia | null {
  const imageCandidate = getLargestImageCandidate(
    item?.image_versions2?.candidates ?? [],
  );
  const video = getBestInstagramVideoUrl(item);
  const altText =
    typeof item?.accessibility_caption === "string"
      ? item.accessibility_caption
      : undefined;
  const durationSeconds =
    typeof item?.video_duration === "number" ? item.video_duration : undefined;

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

function collectInstagramMedia(item: any): EmbedMedia[] {
  const sourceItems =
    Array.isArray(item?.carousel_media) && item.carousel_media.length > 0
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

function isInstagramWeakFallbackResult(
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
  payload: any,
): InstagramVideoResult {
  const media = payload?.data?.xdt_shortcode_media;
  if (!media || typeof media !== "object") {
    return {
      videoUrl: null,
      thumbnailUrl: null,
      title: null,
      durationSeconds: null,
    };
  }

  const captionEdge = Array.isArray(media.edge_media_to_caption?.edges)
    ? media.edge_media_to_caption.edges[0]
    : null;
  const caption =
    typeof captionEdge?.node?.text === "string" ? captionEdge.node.text : null;
  const mediaList =
    typeof media.display_url === "string" && media.display_url.trim()
      ? [
          {
            type:
              typeof media.video_url === "string" && media.video_url.trim()
                ? ("video" as const)
                : ("image" as const),
            url:
              typeof media.video_url === "string" && media.video_url.trim()
                ? media.video_url
                : media.display_url,
            thumbnailUrl:
              typeof media.video_url === "string" && media.video_url.trim()
                ? media.display_url
                : undefined,
            contentType:
              typeof media.video_url === "string" && media.video_url.trim()
                ? "video/mp4"
                : undefined,
            durationSeconds:
              typeof media.video_duration === "number"
                ? media.video_duration
                : undefined,
          },
        ]
      : undefined;

  return {
    videoUrl:
      typeof media.video_url === "string" && media.video_url.trim()
        ? media.video_url
        : null,
    thumbnailUrl:
      typeof media.display_url === "string" && media.display_url.trim()
        ? media.display_url
        : null,
    title: caption,
    durationSeconds:
      typeof media.video_duration === "number" ? media.video_duration : null,
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
): Promise<any> {
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
      const response = await fetch(candidateUrl, {
        headers: buildInstagramIPhoneHeaders(canonicalUrl, secrets),
        redirect: "manual",
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        lastError = new Error(
          `Instagram media info failed with ${response.status}: ${text.slice(0, 200)}`,
        );
        continue;
      }

      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("json")) {
        const text = await response.text().catch(() => "");
        lastError = new Error(
          `Instagram media info returned non-JSON content: ${text.slice(0, 200)}`,
        );
        continue;
      }

      return (await response.json()) as any;
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
  item: any,
  oembed?: {
    title?: string | null;
    thumbnailUrl?: string | null;
  },
): InstagramVideoResult {
  const media = collectInstagramMedia(item);
  const primaryVideo = media.find((entry) => entry.type === "video");
  const primaryImage = media.find((entry) => entry.type === "image");
  const fallbackImage = getLargestImageCandidate(
    item?.image_versions2?.candidates ?? [],
  );
  const author = getInstagramAuthorMetadata(item);
  const caption =
    typeof item?.caption?.text === "string" && item.caption.text.trim()
      ? item.caption.text
      : (oembed?.title ?? null);
  const durationSeconds =
    typeof item?.video_duration === "number"
      ? item.video_duration
      : (primaryVideo?.durationSeconds ?? null);

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
    likeCount: typeof item?.like_count === "number" ? item.like_count : null,
    commentCount:
      typeof item?.comment_count === "number" ? item.comment_count : null,
    viewCount:
      typeof item?.view_count === "number"
        ? item.view_count
        : typeof item?.play_count === "number"
          ? item.play_count
          : null,
    timestamp: toIsoTimestamp(item?.taken_at),
    audio: getInstagramAudio(item),
  };
}

async function fetchInstagramPublicPageSharedEntityId(
  canonicalUrl: string,
): Promise<string | null> {
  const response = await fetch(canonicalUrl, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.8",
      "User-Agent":
        "Mozilla/5.0 (compatible; RalphMeetBot/1.0; +https://meet.115jon.site)",
    },
  });

  if (!response.ok || !response.headers.get("content-type")?.includes("html")) {
    return null;
  }

  return extractInstagramSharedEntityId(await response.text());
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
    const item = Array.isArray(payload?.items) ? payload.items[0] : null;
    if (!item || typeof item !== "object") return null;

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
  const response = await fetch(canonicalUrl, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.8",
      "User-Agent":
        "Mozilla/5.0 (compatible; RalphMeetBot/1.0; +https://meet.115jon.site)",
    },
  });

  if (!response.ok || !response.headers.get("content-type")?.includes("html")) {
    return null;
  }

  const html = await response.text();
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

  let iPhonePayload: any;
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

  const item = Array.isArray(iPhonePayload?.items)
    ? iPhonePayload.items[0]
    : null;
  if (!item || typeof item !== "object") {
    const sharedEntityFallback = await fallbackToSharedEntityMedia();
    if (sharedEntityFallback) {
      return sharedEntityFallback;
    }

    const publicFallback = await fallbackToPublicPage();
    if (publicFallback) {
      return publicFallback;
    }
  }
  const result = buildInstagramResultFromMediaItem(item, {
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

export async function resolveInstagramVideoMetadata(
  rawUrl: string,
  options?: {
    bypassCache?: boolean;
  },
): Promise<InstagramVideoResult | null> {
  const canonicalUrl = canonicalizeInstagramUrl(rawUrl);
  if (!canonicalUrl) return null;

  const cacheKey = `instagram-video:${canonicalUrl}`;
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
  }

  const result = await fetchInstagramMedia(canonicalUrl);
  if (hasResolvedInstagramMetadata(result)) {
    const ttlSeconds =
      hasSessionSecrets && isInstagramWeakFallbackResult(result)
        ? INSTAGRAM_WEAK_FALLBACK_TTL
        : getInstagramMetadataCacheTtl(result);
    void cacheSet(cacheKey, result, ttlSeconds);
  }

  return result;
}
