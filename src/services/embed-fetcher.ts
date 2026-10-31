import type { EmbedInfo } from "@/lib/types";
import { safeFetch, readTextCapped, readJsonCapped } from "@/lib/safe-fetch";
import { safeParseJson } from "@/lib/schema";
import { Schema } from "effect";
import {
  OEmbedResponse,
  YouTubePbjResponse,
  YouTubePlayerResponse,
  readYouTubePbjPlayerResponse,
} from "@/lib/vendor-payloads/oembed";
import { resolveInstagramVideoMetadata } from "@/lib/instagram-video-resolver";
import {
  fetchTikTokProxyLookup,
  lookupInstagramOEmbed,
} from "@/lib/share-preview-proxy";
import {
  isTwitterUnavailablePayload,
  isUnavailableSocialStatus,
} from "@/lib/social-embed-availability";
import { cacheGet, cacheSet } from "@/lib/cache";
import { getBotUserAgent } from "@/lib/platform";
import { singleFlight } from "@/lib/single-flight";
import {
  parseHtmlMeta,
  readPositiveInt,
  resolvePreviewAssetUrl,
} from "@/lib/html-meta";
import {
  MEDIA_SNIFF_BYTES,
  readLeadingBytes,
  sniffImageDimensions,
  sniffMp4Dimensions,
} from "@/lib/media-sniff";
import { clog } from "@/lib/console-logger";

const log = clog("EmbedFetcher");
const twitterLog = clog("embed:twitter");

/** Most embeds a single message gets. */
const MAX_EMBEDS_PER_MESSAGE = 3;
const X_ICON_URL =
  "https://abs.twimg.com/responsive-web/client-web/icon-default.522d363a.png";
const X_EMBED_HOSTS = new Set([
  "x.com",
  "twitter.com",
  "mobile.x.com",
  "mobile.twitter.com",
  "fxtwitter.com",
  "d.fxtwitter.com",
  "fixupx.com",
  "d.fixupx.com",
  "vxtwitter.com",
  "d.vxtwitter.com",
  "fixvx.com",
  "d.fixvx.com",
]);

function nextEmbedId(url: string): string {
  let hash = 2166136261;
  for (let index = 0; index < url.length; index += 1) {
    hash ^= url.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `embed_${(hash >>> 0).toString(36)}`;
}

function buildUnavailableEmbed(
  url: string,
  provider: { name: string; url: string },
  options?: { color?: string; footerIcon?: string },
): EmbedInfo {
  return {
    id: nextEmbedId(url),
    url,
    type: "rich",
    unavailable: true,
    provider,
    footer: {
      text: provider.name,
      iconURL: options?.footerIcon,
    },
    color: options?.color,
    fields: [],
  };
}

// ── URL extraction ──────────────────────────────────────────────────────────

const TRAILING_PUNCTUATION = /[.,;:!?'"*_~]+$/;

function trimUnbalancedClosers(url: string): string {
  let trimmed = url;
  const pairs: Array<[string, string]> = [
    ["(", ")"],
    ["[", "]"],
    ["{", "}"],
  ];
  for (let guard = 0; guard < 8; guard += 1) {
    const before = trimmed;
    trimmed = trimmed.replace(TRAILING_PUNCTUATION, "");
    for (const [open, close] of pairs) {
      if (!trimmed.endsWith(close)) continue;
      const opens = trimmed.split(open).length - 1;
      const closes = trimmed.split(close).length - 1;
      if (closes > opens) trimmed = trimmed.slice(0, -1);
    }
    if (trimmed === before) break;
  }
  return trimmed;
}

/**
 * URLs in a message that should get embeds, in order. Mirrors how the client
 * linkifies (MarkdownRenderer): trailing punctuation and an unbalanced closing
 * bracket are not part of the URL (`(see https://a.b/c).` -> `https://a.b/c`),
 * and URLs inside inline code or code blocks are not linkified so they get no
 * embed either.
 */
export function extractEmbedUrls(
  content: string,
  limit = MAX_EMBEDS_PER_MESSAGE,
): string[] {
  const withoutCode = content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`\n]*`/g, " ");
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const match of withoutCode.matchAll(/https?:\/\/[^\s<>"'`]+/gi)) {
    const candidate = trimUnbalancedClosers(match[0]);
    let normalized: string;
    try {
      const parsed = new URL(candidate);
      if (!parsed.hostname.includes(".")) continue;
      normalized = parsed.toString();
    } catch {
      continue;
    }
    // Keep what the user typed (stored embeds key on it), dedupe on the
    // parsed form.
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    urls.push(candidate);
    if (urls.length >= limit) break;
  }
  return urls;
}

// ── Outcomes ────────────────────────────────────────────────────────────────

/**
 * Thrown by a provider fetcher when the upstream failed in a way worth
 * retrying (network error, timeout, 408/425/429, 5xx). Anything else that
 * yields no embed (404, a page without metadata, a non-HTML file type) is a
 * permanent "none" and must not hold the message's other embeds hostage.
 */
class TransientEmbedError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "TransientEmbedError";
  }
}

function isTransientStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function isTransientFetchError(error: unknown): boolean {
  if (error instanceof TransientEmbedError) return true;
  if (error instanceof TypeError) return true; // network / DNS / TLS
  if (error instanceof DOMException) {
    return error.name === "AbortError" || error.name === "TimeoutError";
  }
  return false;
}

type EmbedUrlOutcome =
  | { url: string; status: "ok"; embed: EmbedInfo; stale?: boolean }
  | { url: string; status: "none" }
  | { url: string; status: "retry"; reason: string };

export interface EmbedExtractionResult {
  embeds: EmbedInfo[];
  /** At least one URL hit a transient failure; the caller should retry. */
  hadFailures: boolean;
  outcomes: EmbedUrlOutcome[];
}

export async function extractAndProcessEmbeds(
  content: string,
): Promise<EmbedInfo[]> {
  const result = await extractAndProcessEmbedsWithStatus(content);
  return result.embeds;
}

/**
 * Resolve every embeddable URL in `content`. A transient failure for one URL
 * never drops the others: successful URLs are returned, and a URL that failed
 * transiently keeps the embed it already had (`previous`, matched by URL) so
 * a retry can fill it in later.
 */
export async function extractAndProcessEmbedsWithStatus(
  content: string,
  options?: { previous?: EmbedInfo[]; bypassCache?: boolean },
): Promise<EmbedExtractionResult> {
  const urls = extractEmbedUrls(content);
  if (urls.length === 0) {
    return { embeds: [], hadFailures: false, outcomes: [] };
  }

  const previousByUrl = new Map(
    (options?.previous ?? []).map((embed) => [embed.url, embed]),
  );
  const outcomes = await Promise.all(
    urls.map((url) =>
      resolveEmbedUrl(url, { bypassCache: options?.bypassCache }),
    ),
  );

  const embeds: EmbedInfo[] = [];
  let hadFailures = false;
  for (const outcome of outcomes) {
    if (outcome.status === "ok") {
      embeds.push(outcome.embed);
    } else if (outcome.status === "retry") {
      hadFailures = true;
      log.warn("Embed fetch failed transiently; will retry", {
        url: outcome.url,
        reason: outcome.reason,
      });
      const previous = previousByUrl.get(outcome.url);
      if (previous) embeds.push(previous);
    }
  }

  return { embeds, hadFailures, outcomes };
}

// ── URL-level cache ─────────────────────────────────────────────────────────
//
// The embed persisted on the message (D1) is the primary copy; this cache
// only stops the same URL from being re-scraped when it is posted again, when
// a message is edited, or when a retry runs. Entries outlive their freshness
// so a stale embed can stand in when the refetch fails transiently
// (stale-on-error). Transient failures are never cached; permanent "no embed"
// results are, briefly (negative cache).

const EMBED_CACHE_VERSION = "v2";
const EMBED_CACHE_STALE_GRACE_SECONDS = 3 * 24 * 60 * 60;
const EMBED_FRESH_SECONDS = 6 * 60 * 60;
/** Signed media URLs and engagement counts go stale quickly. */
const SOCIAL_EMBED_FRESH_SECONDS = 20 * 60;
const UNAVAILABLE_EMBED_FRESH_SECONDS = 6 * 60 * 60;
export const EMBED_NEGATIVE_CACHE_SECONDS = 60 * 60;

export interface EmbedCacheEntry {
  v: 2;
  status: "ok" | "none";
  embed?: EmbedInfo;
  /** Epoch ms after which the entry is stale. */
  freshUntil: number;
}

export function embedCacheKey(url: string): string {
  const key = `${EMBED_CACHE_VERSION}:embed:${url}`;
  // KV keys max out at 512 bytes.
  return key.length <= 480
    ? key
    : `${EMBED_CACHE_VERSION}:embed:h:${nextEmbedId(url)}:${url.slice(0, 300)}`;
}

function isSocialEmbedUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return (
      isXPostHostname(hostname) ||
      hostname.includes("tiktok.com") ||
      hostname.includes("instagram.com")
    );
  } catch {
    return false;
  }
}

function embedFreshSeconds(url: string, embed: EmbedInfo): number {
  if (embed.unavailable) return UNAVAILABLE_EMBED_FRESH_SECONDS;
  return isSocialEmbedUrl(url)
    ? SOCIAL_EMBED_FRESH_SECONDS
    : EMBED_FRESH_SECONDS;
}

const embedFlights = new Map<string, Promise<EmbedUrlOutcome>>();

async function resolveEmbedUrl(
  url: string,
  options?: { bypassCache?: boolean },
): Promise<EmbedUrlOutcome> {
  const key = embedCacheKey(url);
  const run = async (): Promise<EmbedUrlOutcome> => {
    const cached = options?.bypassCache
      ? null
      : await cacheGet<EmbedCacheEntry>(key);
    const now = Date.now();
    if (cached?.v === 2 && cached.freshUntil > now) {
      return cached.status === "ok" && cached.embed
        ? { url, status: "ok", embed: { ...cached.embed, url } }
        : { url, status: "none" };
    }

    const outcome = await fetchEmbedOutcome(url);

    if (outcome.status === "retry") {
      if (cached?.v === 2 && cached.status === "ok" && cached.embed) {
        return {
          url,
          status: "ok",
          embed: { ...cached.embed, url },
          stale: true,
        };
      }
      return outcome;
    }

    const freshSeconds =
      outcome.status === "ok"
        ? embedFreshSeconds(url, outcome.embed)
        : EMBED_NEGATIVE_CACHE_SECONDS;
    const entry: EmbedCacheEntry =
      outcome.status === "ok"
        ? {
            v: 2,
            status: "ok",
            embed: outcome.embed,
            freshUntil: now + freshSeconds * 1000,
          }
        : { v: 2, status: "none", freshUntil: now + freshSeconds * 1000 };
    void cacheSet(
      key,
      entry,
      outcome.status === "ok"
        ? freshSeconds + EMBED_CACHE_STALE_GRACE_SECONDS
        : freshSeconds,
    );
    return outcome;
  };
  // A forced refresh must not join a cached flight already in progress.
  return options?.bypassCache ? run() : singleFlight(embedFlights, key, run);
}

async function fetchEmbedOutcome(url: string): Promise<EmbedUrlOutcome> {
  try {
    const embed = await fetchEmbedMetadata(url);
    return embed ? { url, status: "ok", embed } : { url, status: "none" };
  } catch (error) {
    if (isTransientFetchError(error)) {
      return {
        url,
        status: "retry",
        reason: error instanceof Error ? error.message : String(error),
      };
    }
    log.error("Embed fetch failed permanently:", url, error);
    return { url, status: "none" };
  }
}

async function fetchEmbedMetadata(url: string): Promise<EmbedInfo | null> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const hostname = parsed.hostname.toLowerCase();

  if (isYouTubeHostname(hostname)) {
    return await fetchYouTubeData(url);
  }

  if (isXPostHostname(hostname)) {
    return await fetchTwitterData(url);
  }

  if (hostname.includes("instagram.com")) {
    return await fetchInstagramData(url);
  }

  if (hostname.includes("tiktok.com")) {
    return await fetchTikTokDataRefreshed(url);
  }

  if (hostname === "open.spotify.com" || hostname === "spotify.link") {
    return await fetchSpotifyData(url);
  }

  // Default: an OpenGraph page or a direct image/video file.
  return await fetchOpenGraphData(url);
}

function isYouTubeHostname(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  return (
    normalized === "youtu.be" ||
    normalized === "youtube.com" ||
    normalized.endsWith(".youtube.com")
  );
}

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, "");
}

function isXPostHostname(hostname: string): boolean {
  return X_EMBED_HOSTS.has(normalizeHostname(hostname));
}

function extractTweetStatusId(parsed: URL): string | null {
  return (
    parsed.pathname.match(
      /\/status(?:es)?\/(\d{2,20})(?:\.(?:mp4|jpe?g|png|webp))?(?:\/|$)/i,
    )?.[1] ?? null
  );
}

function normalizeTwitterStatusPath(pathname: string): string {
  return pathname.replace(/\.(?:mp4|jpe?g|png|webp)$/i, "");
}

function buildTwitterApiUrls(parsed: URL): string[] {
  const statusId = extractTweetStatusId(parsed);
  const statusPath = normalizeTwitterStatusPath(parsed.pathname);
  return [
    statusId ? `https://api.fxtwitter.com/2/status/${statusId}` : null,
    `https://api.fxtwitter.com${statusPath}`,
    `https://api.vxtwitter.com${statusPath}`,
  ].filter(
    (url, index, urls): url is string => !!url && urls.indexOf(url) === index,
  );
}

function extractTweetScreenName(parsed: URL): string {
  const screenName = normalizeTwitterStatusPath(parsed.pathname)
    .split("/")
    .filter(Boolean)[0];
  return screenName && screenName !== "i" ? screenName : "x";
}

// ── Provider Fetchers ─────────────────────────────────────────────────────────

/** The 11-character video id from any YouTube URL shape we embed. */
export function extractYouTubeVideoId(rawUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  const hostname = normalizeHostname(parsed.hostname);
  const idPattern = /^[A-Za-z0-9_-]{6,20}$/;
  if (hostname === "youtu.be") {
    const id = parsed.pathname.split("/").filter(Boolean)[0];
    return id && idPattern.test(id) ? id : null;
  }
  const fromQuery = parsed.searchParams.get("v");
  if (fromQuery && idPattern.test(fromQuery)) return fromQuery;
  const pathMatch = parsed.pathname.match(
    /^\/(?:shorts|live|embed|v|e)\/([A-Za-z0-9_-]{6,20})(?:[/?#]|$)/,
  );
  return pathMatch?.[1] ?? null;
}

async function fetchYouTubeData(url: string): Promise<EmbedInfo | null> {
  const videoId = extractYouTubeVideoId(url);
  // Channel, playlist and search pages are ordinary OpenGraph pages.
  if (!videoId) return await fetchOpenGraphData(url);

  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(
    `https://www.youtube.com/watch?v=${videoId}`,
  )}&format=json`;
  const res = await safeFetch(oembedUrl);
  if (!res.ok) {
    if (isTransientStatus(res.status)) {
      throw new TransientEmbedError("YouTube oEmbed unavailable", res.status);
    }
    // 400/404: removed or never existed.
    if (res.status === 404 || res.status === 400) {
      return buildUnavailableEmbed(
        url,
        { name: "YouTube", url: "https://www.youtube.com" },
        { color: "#FF0000" },
      );
    }
    // 401/403: private or embedding disabled. The watch page still has a
    // title and thumbnail, so fall back to a link card.
    return await fetchOpenGraphData(url);
  }

  const data = await readJsonCapped(res, OEmbedResponse);
  if (!data) return null;
  const isShort = /youtube\.com\/shorts\//i.test(url);
  const videoDimensions = await fetchYouTubeVideoDimensions(videoId, url);
  const fallbackDimensions = isShort
    ? { width: 720, height: 1280 }
    : { width: 1280, height: 720 };
  const resolvedDimensions = videoDimensions ?? fallbackDimensions;

  return {
    id: nextEmbedId(url),
    url,
    type: "video",
    rawTitle: data.title,
    author: data.author_name
      ? { name: data.author_name, url: data.author_url }
      : undefined,
    provider: {
      name: "YouTube",
      url: "https://www.youtube.com",
    },
    color: "#FF0000",
    thumbnail: data.thumbnail_url
      ? {
          url: data.thumbnail_url,
          width: data.thumbnail_width ?? 480,
          height: data.thumbnail_height ?? 360,
        }
      : undefined,
    video: {
      url: `https://www.youtube.com/embed/${videoId}`,
      width: resolvedDimensions.width,
      height: resolvedDimensions.height,
      kind: "player",
    },
    fields: [],
  };
}

async function fetchYouTubeVideoDimensions(
  videoId: string,
  sourceUrl: string,
): Promise<{ width: number; height: number } | null> {
  try {
    const innertubeDimensions = await fetchYouTubeInnertubeDimensions(videoId);
    if (innertubeDimensions) {
      return innertubeDimensions;
    }

    const watchUrl = buildYouTubeWatchUrl(videoId, sourceUrl);
    const res = await safeFetch(`${watchUrl}&pbj=1`, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; RalphMeet/1.0; +https://ralph.dev)",
        "x-youtube-client-name": "1",
        "x-youtube-client-version": "2.20260611.01.00",
      },
    });
    if (res.ok) {
      const playerResponse = extractYouTubePbjPlayerResponse(
        await readTextCapped(res),
      );
      const dimensions = extractLargestYouTubeFormatDimensions(playerResponse);
      if (dimensions) return dimensions;
    }

    const htmlRes = await safeFetch(watchUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; RalphMeet/1.0; +https://ralph.dev)",
      },
    });
    if (!htmlRes.ok) return null;

    const playerResponse = extractYouTubePlayerResponse(
      await readTextCapped(htmlRes),
    );
    return extractLargestYouTubeFormatDimensions(playerResponse);
  } catch {
    return null;
  }
}

async function fetchYouTubeInnertubeDimensions(
  videoId: string,
): Promise<{ width: number; height: number } | null> {
  const clients = [
    {
      clientName: "ANDROID",
      clientVersion: "20.10.38",
      userAgent:
        "com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip",
    },
    {
      clientName: "IOS",
      clientVersion: "20.10.4",
      userAgent:
        "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_0 like Mac OS X)",
    },
  ] as const;

  for (const client of clients) {
    try {
      const res = await safeFetch(
        "https://www.youtube.com/youtubei/v1/player?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "User-Agent": client.userAgent,
          },
          body: JSON.stringify({
            context: {
              client: {
                clientName: client.clientName,
                clientVersion: client.clientVersion,
                hl: "en",
                gl: "US",
              },
            },
            videoId,
            contentCheckOk: true,
            racyCheckOk: true,
          }),
        },
      );
      if (!res.ok) {
        continue;
      }

      const playerResponse = await readJsonCapped(res, YouTubePlayerResponse);
      const dimensions = extractLargestYouTubeFormatDimensions(playerResponse);
      if (dimensions) {
        return dimensions;
      }
    } catch {
      continue;
    }
  }

  return null;
}

function buildYouTubeWatchUrl(videoId: string, sourceUrl: string): string {
  try {
    const parsed = new URL(sourceUrl);
    const isShort =
      parsed.hostname.toLowerCase().includes("youtube.com") &&
      parsed.pathname.startsWith("/shorts/");
    return isShort
      ? `https://www.youtube.com/shorts/${videoId}`
      : `https://www.youtube.com/watch?v=${videoId}`;
  } catch {
    return `https://www.youtube.com/watch?v=${videoId}`;
  }
}

function extractYouTubePlayerResponse(
  html: string,
): YouTubePlayerResponse | null {
  const match = html.match(/var ytInitialPlayerResponse\s*=\s*(\{.+?\});/s);
  if (!match?.[1]) return null;

  const parsed = safeParseJson(YouTubePlayerResponse, match[1]);
  return parsed.success ? parsed.data : null;
}

function extractYouTubePbjPlayerResponse(
  rawBody: string,
): YouTubePlayerResponse | null {
  const sanitizedBody = rawBody.replace(/^\s*\)\]\}'\s*/, "").trim();

  const parsed = safeParseJson(YouTubePbjResponse, sanitizedBody);
  return parsed.success
    ? (readYouTubePbjPlayerResponse(parsed.data) ?? null)
    : null;
}

function extractLargestYouTubeFormatDimensions(
  playerResponse: YouTubePlayerResponse | null | undefined,
): { width: number; height: number } | null {
  if (!playerResponse) return null;

  const formats = [
    ...(playerResponse.streamingData?.formats ?? []),
    ...(playerResponse.streamingData?.adaptiveFormats ?? []),
  ];

  let bestDimensions: { width: number; height: number; pixels: number } | null =
    null;
  for (const { width, height } of formats) {
    if (width === undefined || height === undefined) continue;

    const pixels = width * height;
    if (!bestDimensions || pixels > bestDimensions.pixels) {
      bestDimensions = { width, height, pixels };
    }
  }

  if (!bestDimensions) return null;
  return { width: bestDimensions.width, height: bestDimensions.height };
}

async function fetchTwitterData(url: string): Promise<EmbedInfo | null> {
  const parsed = new URL(url);
  let fallbackTweet: any | null = null;
  let sawUnavailable = false;
  let sawTransient = false;

  // APIs that return JSON — documented FxTwitter v2 first, legacy + Vx fallbacks.
  const apis = buildTwitterApiUrls(parsed);

  for (const apiUrl of apis) {
    try {
      twitterLog.info(`Trying API: ${apiUrl}`);
      const res = await safeFetch(apiUrl, {
        headers: { "User-Agent": getBotUserAgent() },
      });
      twitterLog.info(
        `API response status: ${res.status}, content-type: ${res.headers.get("content-type")}`,
      );

      const contentType = res.headers.get("content-type") || "";
      const data = contentType.includes("json")
        ? await readJsonCapped(res, Schema.Unknown).catch(() => null)
        : null;

      if (
        isUnavailableSocialStatus(res.status) ||
        isTwitterUnavailablePayload(data)
      ) {
        sawUnavailable = true;
        twitterLog.info(
          `API ${res.status} marked tweet unavailable: ${JSON.stringify(data)?.slice(0, 200)}`,
        );
        continue;
      }

      if (!res.ok) {
        // Only 5xx/429-style failures are worth a retry; any other 4xx just
        // means this mirror cannot help.
        if (isTransientStatus(res.status)) sawTransient = true;
        const errBody =
          typeof data === "string"
            ? data
            : await readTextCapped(res).catch(() => "");
        twitterLog.info(
          `API ${res.status} body (first 200): ${String(errBody).substring(0, 200)}`,
        );
        continue;
      }

      if (!contentType.includes("json")) {
        // api.vxtwitter.com answers a missing tweet with a 200 HTML page.
        // That is "no data here", not an outage, so it must not block the
        // unavailable tombstone below.
        twitterLog.info(`API returned non-JSON content-type: ${contentType}`);
        continue;
      }

      const payload = data as any;
      // v2 returns { status }, legacy fxtwitter returns { tweet }, vxtwitter returns a bare object.
      const tweet = payload?.status || payload?.tweet || payload;

      if (tweet && !isTwitterUnavailablePayload(tweet)) {
        fallbackTweet = mergeTweetMetadata(fallbackTweet, tweet);
      } else if (
        isTwitterUnavailablePayload(payload) ||
        isTwitterUnavailablePayload(tweet)
      ) {
        sawUnavailable = true;
      }
    } catch (e) {
      sawTransient = true;
      twitterLog.error(`API ${apiUrl} failed:`, e);
    }
  }

  if (fallbackTweet) {
    return buildTwitterEmbed(
      fallbackTweet,
      url,
      extractTweetScreenName(parsed),
    );
  }

  // Fallback: scrape OG tags from vxtwitter.com
  try {
    const vxUrl = `https://vxtwitter.com${normalizeTwitterStatusPath(parsed.pathname)}`;
    twitterLog.info(`Fallback: scraping vxtwitter OG: ${vxUrl}`);
    const res = await safeFetch(vxUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)",
      },
    });

    if (res.ok) {
      const html = await readTextCapped(res);
      twitterLog.info(`OG fallback HTML length: ${html.length}`);

      const titleMatch = html.match(
        /<meta property="og:title" content="([^"]+)"/i,
      );
      const descMatch = html.match(
        /<meta property="og:description" content="([^"]+)"/i,
      );
      const imgMatch = html.match(
        /<meta property="og:image" content="([^"]+)"/i,
      );
      const videoMatch = html.match(
        /<meta property="og:video(?::url)?" content="([^"]+)"/i,
      );
      const videoTypeMatch = html.match(
        /<meta property="og:video:type" content="([^"]+)"/i,
      );

      twitterLog.info(
        `OG: title=${!!titleMatch} desc=${!!descMatch} img=${!!imgMatch} video=${!!videoMatch}`,
      );

      if (titleMatch || descMatch) {
        // vxtwitter OG titles are typically "Name (@handle)" or just "Name"
        const authorParse = titleMatch?.[1]?.match(/^(.+?)\s*\((@\w+)\)/);
        // Extract screen name from URL path as fallback
        const pathScreenName = parsed.pathname.split("/")[1];

        let authorObj: { name: string; url: string };
        if (authorParse) {
          authorObj = {
            name: `${authorParse[1].trim()} (${authorParse[2]})`,
            url: `https://twitter.com/${authorParse[2].replace("@", "")}`,
          };
        } else {
          // Use path screen name to construct a reasonable author
          authorObj = {
            name: `${pathScreenName} (@${pathScreenName})`,
            url: `https://twitter.com/${pathScreenName}`,
          };
        }

        const embed: EmbedInfo = {
          id: nextEmbedId(url),
          url,
          type: "rich",
          rawDescription: descMatch?.[1],
          author: authorObj,
          provider: {
            name: "X",
            url: "https://x.com",
          },
          footer: {
            text: "X",
            iconURL:
              "https://abs.twimg.com/responsive-web/client-web/icon-default.522d363a.png",
          },
          color: "#1D9BF0",
          fields: [],
        };

        if (imgMatch?.[1]) {
          embed.thumbnail = {
            url: imgMatch[1],
            width: 1280,
            height: 720,
          };
        }

        // If OG has a video tag, add it
        if (videoMatch?.[1] || imgMatch?.[1]) {
          // vxtwitter OG video tags point to direct mp4 or embed URLs
          const hasVideo =
            videoMatch?.[1] && videoTypeMatch?.[1]?.includes("text/html");
          if (hasVideo) {
            embed.video = {
              url: videoMatch![1],
              width: 1280,
              height: 720,
              kind: "player",
            };
          } else if (videoMatch?.[1]) {
            // Direct mp4 video from OG metadata.
            embed.video = {
              url: videoMatch[1],
              width: 1280,
              height: 720,
              kind: "direct",
              contentType: videoTypeMatch?.[1] || "video/mp4",
            };
          }
        }

        return embed;
      }
    }
  } catch (e) {
    twitterLog.error("OG fallback failed:", e);
  }

  if (sawUnavailable && !sawTransient) {
    return buildUnavailableEmbed(
      url,
      { name: "X", url: "https://x.com" },
      { color: "#1D9BF0", footerIcon: X_ICON_URL },
    );
  }

  if (sawTransient) {
    throw new TransientEmbedError("X embed mirrors are unavailable");
  }

  return null;
}

function extractTweetMedia(tweet: any): NonNullable<EmbedInfo["media"]> {
  const media: NonNullable<EmbedInfo["media"]> = [];
  const seen = new Map<string, number>();

  const add = (item: any, fallbackType?: "image" | "video") => {
    const normalizedType = normalizeTweetMediaType(item?.type) || fallbackType;
    const url =
      item?.url || item?.media_url_https || item?.media_url || item?.src;
    if (!normalizedType || !url) return;

    const rawType =
      typeof item?.type === "string" ? item.type.toLowerCase() : undefined;
    const thumbnailUrl =
      item?.thumbnail_url || item?.thumb || item?.preview_image_url;
    const contentType =
      item?.format || item?.content_type || item?.variants?.[0]?.content_type;
    const dedupeKey = getTweetMediaDedupKey(url);
    const existingIndex = seen.get(dedupeKey);
    const width = item?.width || item?.size?.width || item?.sizes?.large?.w;
    const height = item?.height || item?.size?.height || item?.sizes?.large?.h;
    const altText = item?.altText || item?.alt_text;
    const durationSeconds = getTweetMediaDurationSeconds(item);

    if (existingIndex !== undefined) {
      const existing = media[existingIndex];
      media[existingIndex] = {
        ...existing,
        width: existing.width ?? width,
        height: existing.height ?? height,
        thumbnailUrl:
          existing.thumbnailUrl ??
          (normalizedType === "video" ? thumbnailUrl : undefined),
        contentType:
          existing.contentType ??
          (normalizedType === "video" ? contentType : undefined),
        isGif:
          existing.isGif ??
          (rawType === "animated_gif" || rawType === "gif" ? true : undefined),
        altText: existing.altText ?? altText,
        durationSeconds:
          existing.durationSeconds ??
          (normalizedType === "video" ? durationSeconds : undefined),
      };
      return;
    }

    seen.set(dedupeKey, media.length);
    media.push({
      type: normalizedType,
      url,
      width,
      height,
      thumbnailUrl: normalizedType === "video" ? thumbnailUrl : undefined,
      contentType: normalizedType === "video" ? contentType : undefined,
      isGif: rawType === "animated_gif" || rawType === "gif" ? true : undefined,
      altText,
      durationSeconds: normalizedType === "video" ? durationSeconds : undefined,
    });
  };

  for (const item of tweet.media?.all || []) add(item);
  for (const item of tweet.media_extended || []) add(item);
  for (const item of tweet.media?.photos || []) add(item, "image");
  for (const item of tweet.media?.videos || []) add(item, "video");
  for (const item of tweet.mediaURLs || []) add({ url: item, type: "image" });

  return media;
}

function getTweetMediaDedupKey(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const hostname = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname;

    if (hostname === "video.twimg.com") {
      return `${hostname}${pathname}`;
    }

    if (
      hostname === "pbs.twimg.com" &&
      (pathname.startsWith("/media/") ||
        pathname.startsWith("/tweet_video_thumb/") ||
        pathname.startsWith("/ext_tw_video_thumb/") ||
        pathname.startsWith("/amplify_video_thumb/"))
    ) {
      return `${hostname}${pathname}`;
    }

    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

function getTweetMediaDurationSeconds(item: any): number | undefined {
  const rawDuration =
    item?.duration ?? item?.duration_seconds ?? item?.durationSecs;
  if (
    typeof rawDuration === "number" &&
    Number.isFinite(rawDuration) &&
    rawDuration > 0
  ) {
    return rawDuration;
  }

  if (typeof rawDuration === "string") {
    const parsed = Number(rawDuration);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  const rawMillis =
    item?.duration_millis ?? item?.durationMillis ?? item?.duration_ms;
  if (
    typeof rawMillis === "number" &&
    Number.isFinite(rawMillis) &&
    rawMillis > 0
  ) {
    return rawMillis / 1000;
  }

  if (typeof rawMillis === "string") {
    const parsed = Number(rawMillis);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed / 1000;
    }
  }

  return undefined;
}

function buildTwitterEmbed(
  tweet: any,
  url: string,
  fallbackScreenName: string,
): EmbedInfo | null {
  const externalCard = extractTweetExternalCard(tweet);
  const media = extractTweetMedia(tweet);
  const rawDescription = extractTweetText(tweet, externalCard);
  if (media.length === 0 && !rawDescription && !externalCard) {
    return null;
  }

  const firstVideo = media.find((item) => item.type === "video");
  const firstMedia = media[0];
  const author = extractTweetAuthor(tweet, fallbackScreenName);
  const timestamp = extractTweetTimestamp(tweet);
  const metrics = extractTweetMetrics(tweet);

  const embed: EmbedInfo = {
    id: nextEmbedId(url),
    url,
    type: "rich",
    rawDescription,
    author: {
      name: `${author.name} (@${author.screenName})`,
      url: `https://twitter.com/${author.screenName}`,
      iconURL: author.avatar,
    },
    provider: {
      name: "X",
      url: "https://x.com",
    },
    footer: {
      text: "X",
      iconURL: X_ICON_URL,
    },
    color: "#1D9BF0",
    timestamp,
    metrics,
    fields: [],
  };

  if (externalCard) {
    embed.externalCard = externalCard;
  }

  if (media.length > 0) {
    embed.media = media;
  }

  if (firstMedia) {
    embed.thumbnail = {
      url: firstMedia.thumbnailUrl || firstMedia.url,
      width: firstMedia.width || 1280,
      height: firstMedia.height || 720,
    };
  }

  if (firstVideo) {
    embed.video = {
      url: firstVideo.url,
      width: firstVideo.width || 1280,
      height: firstVideo.height || 720,
      kind: "direct",
      contentType: firstVideo.contentType || "video/mp4",
      durationSeconds: firstVideo.durationSeconds,
    };
  }

  const referencedTweet = extractReferencedTweet(tweet, url);
  if (referencedTweet) {
    embed.referencedTweet = referencedTweet;
  }

  return embed;
}

function mergeTweetMetadata(baseTweet: any, incomingTweet: any): any {
  if (!baseTweet) return incomingTweet;
  if (!incomingTweet) return baseTweet;

  const mergedTweet = {
    ...baseTweet,
    ...incomingTweet,
    text: baseTweet.text ?? incomingTweet.text,
    full_text: baseTweet.full_text ?? incomingTweet.full_text,
    description: baseTweet.description ?? incomingTweet.description,
    raw_text: baseTweet.raw_text ?? incomingTweet.raw_text,
    author: {
      ...(baseTweet.author || {}),
      ...(incomingTweet.author || {}),
    },
    media: mergeTweetMedia(baseTweet.media, incomingTweet.media),
    media_extended: mergeTweetMediaLists(
      baseTweet.media_extended,
      incomingTweet.media_extended,
    ),
    quote: mergeReferencedTweet(baseTweet.quote, incomingTweet.quote),
    quoted_tweet: mergeReferencedTweet(
      baseTweet.quoted_tweet,
      incomingTweet.quoted_tweet,
    ),
    quotedTweet: mergeReferencedTweet(
      baseTweet.quotedTweet,
      incomingTweet.quotedTweet,
    ),
    qrt: mergeReferencedTweet(baseTweet.qrt, incomingTweet.qrt),
    retweet: mergeReferencedTweet(baseTweet.retweet, incomingTweet.retweet),
    retweeted_tweet: mergeReferencedTweet(
      baseTweet.retweeted_tweet,
      incomingTweet.retweeted_tweet,
    ),
    retweetedTweet: mergeReferencedTweet(
      baseTweet.retweetedTweet,
      incomingTweet.retweetedTweet,
    ),
    original_tweet: mergeReferencedTweet(
      baseTweet.original_tweet,
      incomingTweet.original_tweet,
    ),
  };

  return mergedTweet;
}

function mergeReferencedTweet(baseTweet: any, incomingTweet: any): any {
  if (!baseTweet) return incomingTweet;
  if (!incomingTweet) return baseTweet;
  return mergeTweetMetadata(baseTweet, incomingTweet);
}

function mergeTweetMedia(baseMedia: any, incomingMedia: any): any {
  if (!baseMedia) return incomingMedia;
  if (!incomingMedia) return baseMedia;

  const mergedMedia = {
    ...baseMedia,
    ...incomingMedia,
  };

  for (const key of ["all", "photos", "videos"]) {
    if (baseMedia[key] || incomingMedia[key]) {
      mergedMedia[key] = mergeTweetMediaLists(
        baseMedia[key],
        incomingMedia[key],
      );
    }
  }

  return mergedMedia;
}

function mergeTweetMediaLists(
  baseList: any[] | undefined,
  incomingList: any[] | undefined,
): any[] | undefined {
  if (!baseList?.length) return incomingList;
  if (!incomingList?.length) return baseList;

  const merged = new Map<string, any>();

  const getKey = (item: any, index: number) => {
    const rawUrl = item?.url || item?.media_url_https || item?.media_url;
    return String(
      item?.id ||
        item?.id_str ||
        (rawUrl ? getTweetMediaDedupKey(rawUrl) : index),
    );
  };

  for (const [index, item] of baseList.entries()) {
    merged.set(getKey(item, index), item);
  }

  for (const [index, item] of incomingList.entries()) {
    const key = getKey(item, index);
    merged.set(key, { ...(merged.get(key) || {}), ...item });
  }

  return Array.from(merged.values());
}

function normalizeTweetMediaType(type?: string): "image" | "video" | null {
  if (!type) return null;
  const normalized = type.toLowerCase();
  if (normalized === "photo" || normalized === "image") return "image";
  if (
    normalized === "video" ||
    normalized === "animated_gif" ||
    normalized === "gif"
  )
    return "video";
  return null;
}

function extractTweetAuthor(
  tweet: any,
  fallbackScreenName = "x",
): { name: string; screenName: string; avatar?: string } {
  const screenName =
    tweet.author?.screen_name ||
    tweet.user_screen_name ||
    tweet.user?.screen_name ||
    fallbackScreenName;

  return {
    name: tweet.author?.name || tweet.user_name || tweet.user?.name || "X User",
    screenName,
    avatar:
      tweet.author?.avatar_url ||
      tweet.user_profile_image_url ||
      tweet.author?.profile_image_url ||
      tweet.user?.profile_image_url,
  };
}

function extractTweetTimestamp(tweet: any): string | undefined {
  if (tweet.created_timestamp)
    return new Date(tweet.created_timestamp * 1000).toISOString();
  if (tweet.date_epoch) return new Date(tweet.date_epoch * 1000).toISOString();
  if (tweet.created_at) {
    const parsed = new Date(tweet.created_at);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
  }

  return undefined;
}

function extractTweetMetrics(tweet: any): EmbedInfo["metrics"] | undefined {
  const replies = readTweetMetric(tweet, [
    "reply_count",
    "replyCount",
    "replies",
    "replies_count",
    "stats.replies",
    "engagement.replies",
    "public_metrics.reply_count",
  ]);
  const retweets = readTweetMetric(tweet, [
    "reposts",
    "repost_count",
    "repostCount",
    "retweet_count",
    "retweetCount",
    "retweets",
    "retweets_count",
    "stats.reposts",
    "stats.retweets",
    "engagement.reposts",
    "engagement.retweets",
    "public_metrics.repost_count",
    "public_metrics.retweet_count",
  ]);
  const likes = readTweetMetric(tweet, [
    "favorite_count",
    "favoriteCount",
    "favorites",
    "favorites_count",
    "like_count",
    "likeCount",
    "likes",
    "likes_count",
    "stats.likes",
    "engagement.likes",
    "public_metrics.like_count",
  ]);
  const impressions = readTweetMetric(tweet, [
    "impression_count",
    "impressionCount",
    "impressions",
    "impressions_count",
    "view_count",
    "viewCount",
    "views",
    "views_count",
    "stats.views",
    "stats.impressions",
    "engagement.views",
    "engagement.impressions",
    "public_metrics.impression_count",
    "public_metrics.view_count",
  ]);

  if (
    replies === undefined &&
    retweets === undefined &&
    likes === undefined &&
    impressions === undefined
  ) {
    return undefined;
  }

  return {
    replies,
    retweets,
    likes,
    impressions,
  };
}

function readTweetMetric(tweet: any, paths: string[]): number | undefined {
  for (const path of paths) {
    const value = readPathValue(tweet, path);
    const parsed = parseCountValue(value);
    if (parsed !== undefined) {
      return parsed;
    }
  }

  return undefined;
}

function readPathValue(value: any, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (!current || typeof current !== "object") {
      return undefined;
    }

    return (current as Record<string, unknown>)[segment];
  }, value);
}

function parseCountValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.round(value);
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.replace(/,/g, "").trim();
  if (!normalized) {
    return undefined;
  }

  const compactMatch = normalized.match(/^(\d+(?:\.\d+)?)\s*([kmb])$/i);
  if (compactMatch) {
    const amount = Number(compactMatch[1]);
    const suffix = compactMatch[2].toLowerCase();
    const multiplier =
      suffix === "k" ? 1_000 : suffix === "m" ? 1_000_000 : 1_000_000_000;
    return Math.round(amount * multiplier);
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return undefined;
  }

  return Math.round(parsed);
}

function extractReferencedTweet(
  tweet: any,
  sourceUrl: string,
): EmbedInfo["referencedTweet"] | undefined {
  const quotedTweet =
    tweet.quote || tweet.quoted_tweet || tweet.quotedTweet || tweet.qrt;
  const retweetedTweet =
    tweet.retweet ||
    tweet.retweeted_tweet ||
    tweet.retweetedTweet ||
    tweet.original_tweet;
  const referencedTweet = quotedTweet || retweetedTweet;
  if (!referencedTweet) return undefined;

  const externalCard = extractTweetExternalCard(referencedTweet);
  const media = extractTweetMedia(referencedTweet);
  const author = extractTweetAuthor(referencedTweet);
  const referencedUrl =
    referencedTweet.url ||
    referencedTweet.tweet_url ||
    referencedTweet.link ||
    buildReferencedTweetUrl(author.screenName, referencedTweet.id);

  return {
    type: quotedTweet ? "quoted" : "retweeted",
    url: referencedUrl || sourceUrl,
    rawDescription: extractTweetText(referencedTweet, externalCard),
    author: {
      name: `${author.name} (@${author.screenName})`,
      url: `https://twitter.com/${author.screenName}`,
      iconURL: author.avatar,
    },
    media: media.length > 0 ? media : undefined,
    externalCard,
    metrics: extractTweetMetrics(referencedTweet),
    timestamp: extractTweetTimestamp(referencedTweet),
  };
}

function buildReferencedTweetUrl(
  screenName?: string,
  id?: string | number,
): string | undefined {
  if (!screenName || !id) return undefined;
  return `https://twitter.com/${screenName}/status/${id}`;
}

function extractTweetText(
  tweet: any,
  externalCard?: EmbedInfo["externalCard"],
): string | undefined {
  const text = tweet.text || tweet.full_text || tweet.description;
  if (!text) return undefined;

  const referencedUrls = [
    tweet.quote?.url,
    tweet.quoted_tweet?.url,
    tweet.quotedTweet?.url,
    tweet.qrt?.url,
  ].filter(Boolean);
  const mediaUrlCandidates = collectTweetFacetUrlCandidates(tweet, "media");
  const cardUrlCandidates = externalCard
    ? collectTweetCardUrlCandidates(tweet, externalCard)
    : [];

  if (
    referencedUrls.length === 0 &&
    mediaUrlCandidates.length === 0 &&
    cardUrlCandidates.length === 0
  )
    return text;

  const filteredLines = text.split("\n").filter((line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return true;

    if (referencedUrls.some((url: string) => trimmed === url)) {
      return false;
    }

    if (
      mediaUrlCandidates.length > 0 &&
      isTweetCandidateUrlLine(trimmed, mediaUrlCandidates)
    ) {
      return false;
    }

    if (
      cardUrlCandidates.length > 0 &&
      isTweetCandidateUrlLine(trimmed, cardUrlCandidates)
    ) {
      return false;
    }

    return true;
  });

  return (
    filteredLines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim() || undefined
  );
}

function extractTweetExternalCard(
  tweet: any,
): EmbedInfo["externalCard"] | undefined {
  const card =
    tweet.card || tweet.summary_card || tweet.link_card || tweet.website_card;
  if (!card || typeof card !== "object") return undefined;

  const url = firstNonEmptyString(
    card.url,
    card.link,
    card.expanded_url,
    card.destination?.url,
  );
  const title = firstNonEmptyString(card.title, card.name);
  const description = firstNonEmptyString(card.description, card.subtitle);
  const domain = firstNonEmptyString(
    card.domain,
    card.site_name,
    getDomainLabel(url),
  );
  const imageUrl = firstNonEmptyString(
    card.image?.url,
    card.image_url,
    card.image?.src,
    card.thumbnail?.url,
    card.thumbnail_url,
  );
  const imageWidth = readPositiveNumber(
    card.image?.width,
    card.image_width,
    card.thumbnail?.width,
    card.thumbnail_width,
  );
  const imageHeight = readPositiveNumber(
    card.image?.height,
    card.image_height,
    card.thumbnail?.height,
    card.thumbnail_height,
  );

  if (!url && !title && !description && !domain && !imageUrl) {
    return undefined;
  }

  return {
    url: url || undefined,
    title: title || undefined,
    description: description || undefined,
    domain: domain || undefined,
    image: imageUrl
      ? {
          url: imageUrl,
          width: imageWidth,
          height: imageHeight,
        }
      : undefined,
  };
}

function collectTweetCardUrlCandidates(
  tweet: any,
  externalCard?: EmbedInfo["externalCard"],
): string[] {
  return [
    tweet.card?.url,
    tweet.card?.link,
    tweet.card?.expanded_url,
    externalCard?.url,
    ...collectTweetFacetUrlCandidates(tweet, "url"),
  ].filter(
    (value): value is string =>
      typeof value === "string" && value.trim().length > 0,
  );
}

function collectTweetFacetUrlCandidates(
  tweet: any,
  facetType: "url" | "media",
): string[] {
  return Array.isArray(tweet.raw_text?.facets)
    ? tweet.raw_text.facets
        .flatMap((facet: any) => {
          if (facet?.type !== facetType) return [];
          return [facet.original, facet.replacement, facet.display];
        })
        .filter(
          (value: unknown): value is string =>
            typeof value === "string" && value.trim().length > 0,
        )
    : [];
}

function isTweetCandidateUrlLine(line: string, candidates: string[]): boolean {
  if (line.includes(" ")) return false;

  const normalizedLine = normalizeComparableUrlValue(line);
  if (!normalizedLine) return false;

  return candidates.some((candidate) => {
    const normalizedCandidate = normalizeComparableUrlValue(candidate);
    return normalizedCandidate ? normalizedCandidate === normalizedLine : false;
  });
}

function normalizeComparableUrlValue(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const normalized = trimmed.replace(/^https?:\/\//i, "");
  try {
    const parsed = new URL(
      /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`,
    );
    const pathname = parsed.pathname.replace(/\/$/, "");
    return `${parsed.hostname.toLowerCase()}${pathname}${parsed.search}`.replace(
      /\/$/,
      "",
    );
  } catch {
    return normalized.replace(/\/$/, "").toLowerCase();
  }
}

function getDomainLabel(url?: string | null): string | undefined {
  if (!url) return undefined;

  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return undefined;
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
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return value;
    }

    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }
  }

  return undefined;
}

async function fetchInstagramData(url: string): Promise<EmbedInfo | null> {
  const oembedLookup = await lookupInstagramOEmbed(url).catch(() => ({
    status: 0,
    metadata: null,
  }));
  let videoData: Awaited<ReturnType<typeof resolveInstagramVideoMetadata>> =
    null;
  let videoError: Error | null = null;
  try {
    videoData = await resolveInstagramVideoMetadata(url);
  } catch (error) {
    videoError = error instanceof Error ? error : new Error(String(error));
  }
  const data = oembedLookup.metadata;

  const media = videoData?.media?.length ? videoData.media : undefined;
  const firstVideo = media?.find((entry) => entry.type === "video");
  const firstMedia = media?.[0];
  const thumbnailUrl =
    videoData?.thumbnailUrl ??
    firstVideo?.thumbnailUrl ??
    firstMedia?.url ??
    data?.thumbnailUrl;
  const thumbnailWidth =
    firstMedia?.type === "image"
      ? firstMedia.width
      : (firstVideo?.width ?? data?.thumbnailWidth);
  const thumbnailHeight =
    firstMedia?.type === "image"
      ? firstMedia.height
      : (firstVideo?.height ?? data?.thumbnailHeight);
  const authorName = data?.authorName ?? videoData?.authorName ?? undefined;
  const authorUrl = data?.authorUrl ?? videoData?.authorUrl ?? undefined;
  const authorIconUrl = videoData?.authorAvatarUrl ?? undefined;
  const authorVerified = videoData?.authorVerified ?? undefined;
  const videoDurationSeconds = videoData?.durationSeconds ?? undefined;
  const audio = videoData?.audio ?? undefined;
  const timestamp = videoData?.timestamp ?? undefined;
  const metrics =
    videoData?.commentCount !== undefined ||
    videoData?.likeCount !== undefined ||
    videoData?.viewCount !== undefined
      ? {
          comments: videoData?.commentCount ?? undefined,
          likes: videoData?.likeCount ?? undefined,
          views: videoData?.viewCount ?? undefined,
        }
      : undefined;
  const rawTitle = videoData?.title ?? data?.title;

  if (!rawTitle && !thumbnailUrl && !media?.length && !videoData?.videoUrl) {
    const secretsMissing = videoError?.message.includes(
      "session secrets are not configured",
    );
    if (!secretsMissing && isUnavailableSocialStatus(oembedLookup.status)) {
      return buildUnavailableEmbed(
        url,
        {
          name: data?.providerName || "Instagram",
          url: data?.providerUrl || "https://www.instagram.com",
        },
        { color: "#E1306C" },
      );
    }
    // oEmbed threw (status 0) or is rate limited/down: try again later.
    if (oembedLookup.status === 0 || isTransientStatus(oembedLookup.status)) {
      throw new TransientEmbedError(
        "Instagram metadata unavailable",
        oembedLookup.status,
      );
    }
    return null;
  }

  return {
    id: nextEmbedId(url),
    url,
    type: "rich",
    rawTitle,
    author: authorName
      ? {
          name: authorName,
          url: authorUrl,
          iconURL: authorIconUrl,
          isVerified: authorVerified,
        }
      : undefined,
    provider: {
      name: data?.providerName || "Instagram",
      url: data?.providerUrl || "https://www.instagram.com",
    },
    color: "#E1306C",
    thumbnail: thumbnailUrl
      ? {
          url: thumbnailUrl,
          width: thumbnailWidth,
          height: thumbnailHeight,
        }
      : undefined,
    media,
    video: videoData?.videoUrl
      ? {
          url: videoData.videoUrl,
          width: firstVideo?.width ?? 720,
          height: firstVideo?.height ?? 1280,
          kind: "direct",
          contentType: "video/mp4",
          durationSeconds: videoDurationSeconds,
        }
      : undefined,
    audio,
    timestamp,
    metrics,
    footer: {
      text: "Instagram",
    },
    fields: [],
  };
}

async function fetchTikTokDataRefreshed(
  url: string,
): Promise<EmbedInfo | null> {
  const oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`;
  const [oembedResult, proxyResult] = await Promise.allSettled([
    safeFetch(oembedUrl),
    fetchTikTokProxyLookup(url),
  ]);

  const res = oembedResult.status === "fulfilled" ? oembedResult.value : null;
  const proxyLookup =
    proxyResult.status === "fulfilled" ? proxyResult.value : null;
  const proxyData = proxyLookup?.metadata ?? null;
  // oEmbed keeps answering 200 with a generic player for a deleted post, so
  // TikTok's player API ("nil_core_data") is the signal that counts.
  if (proxyLookup?.unavailable && !proxyData) {
    return buildUnavailableEmbed(
      url,
      { name: "TikTok", url: "https://www.tiktok.com" },
      { color: "#FF0050" },
    );
  }
  if (!res?.ok && !proxyData) {
    if (res && isUnavailableSocialStatus(res.status)) {
      return buildUnavailableEmbed(
        url,
        { name: "TikTok", url: "https://www.tiktok.com" },
        { color: "#FF0050" },
      );
    }
    const oembedTransient = !res || isTransientStatus(res.status);
    if (oembedTransient && (proxyLookup?.transient ?? true)) {
      throw new TransientEmbedError("TikTok metadata unavailable", res?.status);
    }
    return null;
  }

  const data = (res?.ok ? await readJsonCapped(res, OEmbedResponse) : {}) ?? {};
  const videoIdMatch =
    data.html?.match(/data-video-id="([^"]+)"/) ||
    url.match(/(?:video|photo|player\/v1)\/(\d+)/) ||
    proxyData?.id;
  const videoId = Array.isArray(videoIdMatch)
    ? videoIdMatch[1]
    : (videoIdMatch ?? null);
  const caption = proxyData?.title || data.title;
  const authorName = data.author_name || proxyData?.authorName || "Unknown";
  const authorUrl =
    data.author_url ||
    (proxyData?.authorHandle
      ? `https://www.tiktok.com/@${proxyData.authorHandle}`
      : undefined);
  const firstVideo = proxyData?.media?.find((entry) => entry.type === "video");
  const firstMedia = proxyData?.media?.[0];
  const metrics =
    proxyData?.commentCount !== undefined ||
    proxyData?.likeCount !== undefined ||
    proxyData?.viewCount !== undefined
      ? {
          comments: proxyData?.commentCount,
          likes: proxyData?.likeCount,
          views: proxyData?.viewCount,
        }
      : undefined;
  const postType = proxyData?.postType === "slideshow" ? "slideshow" : "video";
  const slideshowThumbnailUrl = firstVideo?.thumbnailUrl;
  const thumbnailUrl =
    postType === "slideshow"
      ? slideshowThumbnailUrl || proxyData?.coverUrl || data.thumbnail_url
      : proxyData?.coverUrl ||
        data.thumbnail_url ||
        firstVideo?.thumbnailUrl ||
        firstMedia?.url;

  if (!videoId && !proxyData?.media?.length && !thumbnailUrl && !caption) {
    return null;
  }

  return {
    id: nextEmbedId(url),
    url,
    type: postType === "slideshow" ? "rich" : "video",
    rawTitle:
      caption ||
      `${postType === "slideshow" ? "TikTok slideshow" : "TikTok"} · ${authorName}`,
    rawDescription: caption || undefined,
    author:
      data.author_name || proxyData?.authorName
        ? {
            name: authorName,
            url: authorUrl,
            iconURL: proxyData?.authorAvatarUrl,
          }
        : undefined,
    provider: {
      name: "TikTok",
      url: data.provider_url || "https://www.tiktok.com",
    },
    color: "#FF0050",
    video:
      videoId && postType !== "slideshow"
        ? {
            url: `https://www.tiktok.com/player/v1/${videoId}`,
            width: firstVideo?.width ?? 325,
            height: firstVideo?.height ?? 738,
            kind: "player",
          }
        : undefined,
    thumbnail: thumbnailUrl
      ? {
          url: thumbnailUrl,
          width: data.thumbnail_width ?? 300,
          height: data.thumbnail_height ?? 400,
        }
      : undefined,
    media: proxyData?.media,
    audio: proxyData?.audio,
    timestamp: proxyData?.timestamp,
    metrics,
    footer: {
      text: "TikTok",
    },
    fields: [],
  };
}

// ── OpenGraph pages and direct media ────────────────────────────────────────

const PREVIEW_ACCEPT =
  "text/html,application/xhtml+xml;q=0.9,image/avif,image/webp,image/*;q=0.8,video/*;q=0.7,*/*;q=0.5";
const DIRECT_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
  "image/avif",
]);
const DIRECT_VIDEO_TYPES = new Set([
  "video/mp4",
  "video/webm",
  "video/quicktime",
]);
const DIRECT_MEDIA_EXTENSION =
  /\.(?:png|jpe?g|gif|webp|avif|mp4|m4v|webm|mov)$/i;
const MAX_TITLE_LENGTH = 256;
const MAX_DESCRIPTION_LENGTH = 350;

/**
 * Many sites (Reddit, for one) only serve OpenGraph tags to known
 * link-preview crawlers and answer anything else with a bot wall, so the
 * preview fetch identifies as one. The contact URL comes from config.
 */
export function getLinkPreviewUserAgent(): string {
  return getBotUserAgent().replace(
    "RalphMeetBot/1.0;",
    "RalphMeetBot/1.0; Discordbot/2.0;",
  );
}

function clipText(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
}

async function fetchOpenGraphData(url: string): Promise<EmbedInfo | null> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return null;
  }
  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    return null;
  }

  const looksLikeMedia = DIRECT_MEDIA_EXTENSION.test(parsedUrl.pathname);
  const res = await safeFetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent": getLinkPreviewUserAgent(),
      Accept: PREVIEW_ACCEPT,
      "Accept-Language": "en-US,en;q=0.8",
      // Only the header bytes are needed to size a file.
      ...(looksLikeMedia ? { Range: `bytes=0-${MEDIA_SNIFF_BYTES - 1}` } : {}),
    },
  });

  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    if (isTransientStatus(res.status)) {
      throw new TransientEmbedError(
        `Link preview fetch failed with ${res.status}`,
        res.status,
      );
    }
    return null;
  }

  const finalUrl = res.url || url;
  const contentType = (res.headers.get("content-type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();

  if (
    DIRECT_IMAGE_TYPES.has(contentType) ||
    DIRECT_VIDEO_TYPES.has(contentType)
  ) {
    const bytes = await readLeadingBytes(res.body);
    return buildDirectMediaEmbed(url, contentType, bytes);
  }

  if (!contentType.includes("html")) {
    await res.body?.cancel().catch(() => {});
    return null;
  }

  return buildOpenGraphEmbed(url, finalUrl, await readTextCapped(res));
}

/**
 * An embed for a link that points straight at an image, GIF or video file.
 * Rendered as bare media (no card), sized from the file header so the
 * message row does not jump when it loads.
 */
function buildDirectMediaEmbed(
  url: string,
  contentType: string,
  bytes: Uint8Array,
): EmbedInfo | null {
  // The page CSP only allows https media.
  const mediaUrl = resolvePreviewAssetUrl(url, url);
  if (!mediaUrl) return null;

  const isVideo = contentType.startsWith("video/");
  const dimensions = isVideo
    ? contentType === "video/webm"
      ? null
      : sniffMp4Dimensions(bytes)
    : sniffImageDimensions(bytes);
  const width = dimensions?.width;
  const height = dimensions?.height;

  if (isVideo) {
    return {
      id: nextEmbedId(url),
      url,
      type: "video",
      direct: true,
      video: {
        url: mediaUrl,
        kind: "direct",
        contentType,
        ...(width && height ? { width, height } : {}),
      },
      fields: [],
    };
  }

  return {
    id: nextEmbedId(url),
    url,
    type: "image",
    direct: true,
    thumbnail: { url: mediaUrl, ...(width && height ? { width, height } : {}) },
    media: [
      {
        type: "image",
        url: mediaUrl,
        contentType,
        ...(width && height ? { width, height } : {}),
        ...(contentType === "image/gif" ? { isGif: true } : {}),
      },
    ],
    fields: [],
  };
}

export function buildOpenGraphEmbed(
  url: string,
  finalUrl: string,
  html: string,
): EmbedInfo | null {
  const meta = parseHtmlMeta(html);
  const title = meta.first("og:title", "twitter:title") ?? meta.title;
  if (!title) return null;

  const description = meta.first(
    "og:description",
    "twitter:description",
    "description",
  );
  const ogImage = meta.first("og:image:secure_url", "og:image", "og:image:url");
  const image = resolvePreviewAssetUrl(
    ogImage ?? meta.first("twitter:image", "twitter:image:src"),
    finalUrl,
  );
  const width = ogImage
    ? readPositiveInt(meta.get("og:image:width"))
    : undefined;
  const height = ogImage
    ? readPositiveInt(meta.get("og:image:height"))
    : undefined;
  const twitterCard = meta.get("twitter:card")?.toLowerCase();
  const imageLayout: EmbedInfo["imageLayout"] = !image
    ? undefined
    : twitterCard === "summary_large_image" || twitterCard === "player"
      ? "large"
      : twitterCard === "summary"
        ? "thumbnail"
        : width && height && width >= 400 && width >= height * 1.2
          ? "large"
          : "thumbnail";

  let origin: URL;
  try {
    origin = new URL(finalUrl);
  } catch {
    origin = new URL(url);
  }
  const hostname = origin.hostname.replace(/^www\./i, "");
  const ogType = meta.get("og:type")?.toLowerCase();

  const embed: EmbedInfo = {
    id: nextEmbedId(url),
    url,
    type: ogType?.includes("video") ? "video" : "link",
    rawTitle: clipText(title, MAX_TITLE_LENGTH),
    rawDescription: description
      ? clipText(description, MAX_DESCRIPTION_LENGTH)
      : undefined,
    provider: {
      name: meta.get("og:site_name") ?? hostname,
      url: `${origin.protocol}//${origin.host}`,
    },
    fields: [],
  };

  if (image) {
    embed.thumbnail = {
      url: image,
      ...(width && height ? { width, height } : {}),
    };
    embed.imageLayout = imageLayout;
  }

  return embed;
}

/** `open.spotify.com/intl-de/track/x` -> `open.spotify.com/track/x`. */
export function normalizeSpotifyUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    parsed.pathname = parsed.pathname.replace(/^\/intl-[a-z-]+(?=\/)/i, "");
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

async function fetchSpotifyData(url: string): Promise<EmbedInfo | null> {
  const canonicalUrl = normalizeSpotifyUrl(url);
  const oembedUrl = `https://open.spotify.com/oembed?url=${encodeURIComponent(canonicalUrl)}`;
  const res = await safeFetch(oembedUrl);
  if (!res.ok) {
    if (isTransientStatus(res.status)) {
      throw new TransientEmbedError("Spotify oEmbed unavailable", res.status);
    }
    return await fetchOpenGraphData(url);
  }

  const data = await readJsonCapped(res, OEmbedResponse);
  if (!data) return null;

  return {
    id: nextEmbedId(url),
    url,
    type: "link",
    rawTitle: data.title,
    rawDescription: data.author_name
      ? `Spotify - ${data.author_name}`
      : "Spotify",
    provider: {
      name: "Spotify",
      url: "https://spotify.com/",
    },
    color: "#1DB954",
    thumbnail: data.thumbnail_url
      ? {
          url: data.thumbnail_url,
          width: data.thumbnail_width ?? 300,
          height: data.thumbnail_height ?? 300,
        }
      : undefined,
    fields: [],
  };
}
