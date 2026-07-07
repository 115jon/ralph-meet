import { solvePlayerChallenges } from "./solver";
import type {
  PreferredPlaybackKind,
  YouTubeResolveOptions,
  YouTubeResolveResponse,
  YouTubeResolvedFormat,
} from "./types";

const YOUTUBE_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";
const YOUTUBE_WEBPAGE_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.5 Safari/605.1.15,gzip(gfe)";
const YOUTUBE_WATCH_PAGE_COOKIE_HEADER = "PREF=hl=en&tz=UTC; SOCS=CAI";

const DEFAULT_INNERTUBE_CONTEXT = {
  client: {
    clientName: "WEB",
    clientVersion: "2.20260611.01.00",
    hl: "en",
    gl: "US",
    utcOffsetMinutes: 0,
  },
};

const FALLBACK_INNERTUBE_API_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";

const FALLBACK_INNERTUBE_ATTEMPTS = [
  {
    apiKey: FALLBACK_INNERTUBE_API_KEY,
    userAgent: "com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
    context: {
      client: {
        clientName: "ANDROID_VR",
        clientVersion: "1.65.10",
        deviceMake: "Oculus",
        deviceModel: "Quest 3",
        androidSdkVersion: 32,
        userAgent: "com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
        hl: "en",
        osName: "Android",
        osVersion: "12L",
        timeZone: "UTC",
        utcOffsetMinutes: 0,
      },
    },
    clientNameHeader: "28",
    origin: "https://www.youtube.com",
  },
  {
    apiKey: FALLBACK_INNERTUBE_API_KEY,
    userAgent: "com.google.android.youtube/21.02.35 (Linux; U; Android 11) gzip",
    context: {
      client: {
        clientName: "ANDROID",
        clientVersion: "21.02.35",
        androidSdkVersion: 30,
        userAgent: "com.google.android.youtube/21.02.35 (Linux; U; Android 11) gzip",
        hl: "en",
        osName: "Android",
        osVersion: "11",
        timeZone: "UTC",
        utcOffsetMinutes: 0,
      },
    },
    clientNameHeader: "3",
    origin: "https://www.youtube.com",
  },
  {
    apiKey: FALLBACK_INNERTUBE_API_KEY,
    userAgent: "com.google.ios.youtube/21.02.3 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)",
    context: {
      client: {
        clientName: "IOS",
        clientVersion: "21.02.3",
        deviceMake: "Apple",
        deviceModel: "iPhone16,2",
        userAgent: "com.google.ios.youtube/21.02.3 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)",
        hl: "en",
        osName: "iPhone",
        osVersion: "18.3.2.22D82",
        timeZone: "UTC",
        utcOffsetMinutes: 0,
      },
    },
    clientNameHeader: "5",
    origin: "https://www.youtube.com",
  },
] as const;

interface PreparedFormatCandidate {
  url: string;
  sigChallenge: string | null;
  sigParameter: string | null;
  nChallenge: string | null;
  format: YouTubeResolvedFormat;
}

interface InnertubeRequestAttempt {
  apiKey: string;
  userAgent: string;
  context: Record<string, unknown>;
  clientVersion: string;
  clientNameHeader: string;
  visitorData: string | null;
  origin: string;
}

export type YouTubeCatalogSearchFilter = "video" | "playlist";

export interface YouTubePlaylistBrowseResult {
  header: Record<string, unknown> | null;
  items: Record<string, unknown>[];
}

const WEB_INNERTUBE_CONFIG_TTL_MS = 10 * 60 * 1000;

const YOUTUBE_SEARCH_FILTER_PARAMS: Record<YouTubeCatalogSearchFilter, string> = {
  video: "EgIQAQ%3D%3D",
  playlist: "EgIQAw%3D%3D",
};

let cachedWebInnertubeConfig:
  | {
    value: InnertubeRequestAttempt;
    expiresAt: number;
  }
  | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toStringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function deepMerge(base: Record<string, unknown>, incoming: Record<string, unknown>) {
  const merged: Record<string, unknown> = { ...base };

  for (const [key, value] of Object.entries(incoming)) {
    if (isRecord(value) && isRecord(merged[key])) {
      merged[key] = deepMerge(merged[key] as Record<string, unknown>, value);
    } else {
      merged[key] = value;
    }
  }

  return merged;
}

function parseJsonObjectAt(source: string, openingBraceIndex: number) {
  let depth = 0;
  let inString = false;
  let quote = "";
  let escaped = false;

  for (let index = openingBraceIndex; index < source.length; index += 1) {
    const character = source[index];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === "\\") {
        escaped = true;
        continue;
      }
      if (character === quote) {
        inString = false;
      }
      continue;
    }

    if (character === "\"" || character === "'") {
      inString = true;
      quote = character;
      continue;
    }

    if (character === "{") {
      depth += 1;
      continue;
    }

    if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openingBraceIndex, index + 1);
      }
    }
  }

  return null;
}

function extractJsonObjectAfter(source: string, marker: string) {
  const markerIndex = source.indexOf(marker);
  if (markerIndex === -1) return null;
  const openingBraceIndex = source.indexOf("{", markerIndex + marker.length);
  if (openingBraceIndex === -1) return null;
  return parseJsonObjectAt(source, openingBraceIndex);
}

function collectYtCfg(source: string) {
  const merged: Record<string, unknown> = {};
  const marker = "ytcfg.set(";
  let searchIndex = 0;

  while (true) {
    const markerIndex = source.indexOf(marker, searchIndex);
    if (markerIndex === -1) break;
    const openingBraceIndex = source.indexOf("{", markerIndex + marker.length);
    if (openingBraceIndex === -1) break;

    const objectText = parseJsonObjectAt(source, openingBraceIndex);
    if (!objectText) break;

    try {
      const parsed = JSON.parse(objectText) as Record<string, unknown>;
      Object.assign(merged, deepMerge(merged, parsed));
    } catch {
      // Ignore malformed ytcfg snippets and keep scanning.
    }

    searchIndex = openingBraceIndex + objectText.length;
  }

  return merged;
}

function extractInitialPlayerResponse(source: string) {
  const markers = [
    "var ytInitialPlayerResponse = ",
    "ytInitialPlayerResponse = ",
  ];

  for (const marker of markers) {
    const objectText = extractJsonObjectAfter(source, marker);
    if (!objectText) continue;
    try {
      return JSON.parse(objectText) as Record<string, unknown>;
    } catch {
      continue;
    }
  }

  return null;
}

function findStringDeep(value: unknown, key: string): string | null {
  if (!value) return null;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findStringDeep(entry, key);
      if (found) return found;
    }
    return null;
  }
  if (!isRecord(value)) return null;

  if (typeof value[key] === "string" && value[key].trim()) {
    return value[key] as string;
  }

  for (const entry of Object.values(value)) {
    const found = findStringDeep(entry, key);
    if (found) return found;
  }

  return null;
}

function firstObjectByKey(value: unknown, key: string): Record<string, unknown> | null {
  if (!value) return null;

  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = firstObjectByKey(entry, key);
      if (found) return found;
    }
    return null;
  }

  if (!isRecord(value)) return null;

  if (isRecord(value[key])) {
    return value[key] as Record<string, unknown>;
  }

  for (const entry of Object.values(value)) {
    const found = firstObjectByKey(entry, key);
    if (found) return found;
  }

  return null;
}

function findObjectsByKey(
  value: unknown,
  key: string,
  matches: Record<string, unknown>[] = [],
): Record<string, unknown>[] {
  if (!value) return matches;

  if (Array.isArray(value)) {
    for (const entry of value) {
      findObjectsByKey(entry, key, matches);
    }
    return matches;
  }

  if (!isRecord(value)) return matches;

  if (isRecord(value[key])) {
    matches.push(value[key] as Record<string, unknown>);
  }

  for (const entry of Object.values(value)) {
    findObjectsByKey(entry, key, matches);
  }

  return matches;
}

function toAbsolutePlayerUrl(input: string | null) {
  if (!input) return null;
  if (input.startsWith("http://") || input.startsWith("https://")) return input;
  if (input.startsWith("//")) return `https:${input}`;
  if (input.startsWith("/")) return `https://www.youtube.com${input}`;
  return `https://www.youtube.com/${input.replace(/^\/+/, "")}`;
}

function getMimeContainer(mimeType: string | null) {
  if (!mimeType) return null;
  return mimeType.split(";")[0]?.split("/")[1] ?? null;
}

function getMimeCodecs(mimeType: string | null) {
  if (!mimeType) return [];
  const match = mimeType.match(/codecs="([^"]+)"/i);
  if (!match?.[1]) return [];
  return match[1].split(",").map((codec) => codec.trim()).filter(Boolean);
}

function getStreamFormats(playerResponse: Record<string, unknown>) {
  const streamingData = isRecord(playerResponse.streamingData)
    ? playerResponse.streamingData
    : null;
  if (!streamingData) return [];

  const formats = Array.isArray(streamingData.formats) ? streamingData.formats : [];
  const adaptiveFormats = Array.isArray(streamingData.adaptiveFormats) ? streamingData.adaptiveFormats : [];
  return [...formats, ...adaptiveFormats].filter(isRecord);
}

function prepareFormatCandidate(input: Record<string, unknown>): PreparedFormatCandidate | null {
  const signatureCipher = toStringValue(input.signatureCipher);
  const cipherParams = signatureCipher ? new URLSearchParams(signatureCipher) : null;
  const baseUrl = toStringValue(input.url) ?? cipherParams?.get("url") ?? null;
  if (!baseUrl) return null;

  const parsedUrl = new URL(baseUrl);
  const mimeType = toStringValue(input.mimeType);
  const container = getMimeContainer(mimeType);
  const codecs = getMimeCodecs(mimeType);
  const hasAudio = !!input.audioQuality || mimeType?.startsWith("audio/") || !!input.audioChannels;
  const hasVideo = !!input.qualityLabel || mimeType?.startsWith("video/") || (!!input.width && !!input.height);

  return {
    url: parsedUrl.toString(),
    sigChallenge: cipherParams?.get("s") ?? null,
    sigParameter: cipherParams?.get("sp") ?? "signature",
    nChallenge: parsedUrl.searchParams.get("n") ?? null,
    format: {
      itag: toNumber(input.itag),
      url: parsedUrl.toString(),
      mimeType,
      container,
      codecs,
      bitrate: toNumber(input.bitrate),
      contentLength: toNumber(input.contentLength),
      width: toNumber(input.width),
      height: toNumber(input.height),
      fps: toNumber(input.fps),
      qualityLabel: toStringValue(input.qualityLabel),
      audioSampleRate: toNumber(input.audioSampleRate),
      audioChannels: toNumber(input.audioChannels),
      hasAudio,
      hasVideo,
      projectionType: toStringValue(input.projectionType),
      expiresAt: toNumber(parsedUrl.searchParams.get("expire")) ? Number(parsedUrl.searchParams.get("expire")) * 1000 : null,
    },
  };
}

function scoreFormat(
  format: YouTubeResolvedFormat,
  preferredKind: PreferredPlaybackKind,
  preferredContainer?: "mp4" | "webm",
) {
  let score = 0;

  if (preferredContainer && format.container === preferredContainer) {
    score += 120;
  }

  if (preferredKind === "audio") {
    if (!format.hasAudio) return -1;
    score += format.hasVideo ? 40 : 140;
    score += Math.floor((format.bitrate ?? 0) / 1000);
    score += format.audioSampleRate ? Math.floor(format.audioSampleRate / 1000) : 0;
    return score;
  }

  if (preferredKind === "muxed") {
    if (!(format.hasAudio && format.hasVideo)) return -1;
    score += 180;
    score += (format.height ?? 0) * 4;
    score += Math.floor((format.bitrate ?? 0) / 1000);
    return score;
  }

  if (preferredKind === "video") {
    if (!format.hasVideo) return -1;
    score += format.hasAudio ? 90 : 60;
    score += (format.height ?? 0) * 4;
    score += Math.floor((format.bitrate ?? 0) / 1000);
    score += format.fps ?? 0;
    return score;
  }

  score += format.hasVideo ? 100 : 0;
  score += format.hasAudio ? 100 : 0;
  score += (format.height ?? 0) * 3;
  score += Math.floor((format.bitrate ?? 0) / 1000);
  return score;
}

export function pickPreferredFormat(
  formats: YouTubeResolvedFormat[],
  preferredKind: PreferredPlaybackKind,
  preferredContainer?: "mp4" | "webm",
) {
  return [...formats]
    .map((format) => ({
      format,
      score: scoreFormat(format, preferredKind, preferredContainer),
    }))
    .filter((entry) => entry.score >= 0)
    .sort((left, right) => right.score - left.score)[0]?.format ?? null;
}

function sanitizeInnertubeContext(ytcfg: Record<string, unknown>) {
  const rawContext = ytcfg.INNERTUBE_CONTEXT;
  if (!isRecord(rawContext)) return DEFAULT_INNERTUBE_CONTEXT;

  const client = isRecord(rawContext.client) ? rawContext.client : {};
  return {
    ...rawContext,
    client: {
      ...DEFAULT_INNERTUBE_CONTEXT.client,
      ...client,
    },
  };
}

function splitCombinedSetCookieHeader(headerValue: string) {
  return headerValue
    .split(/,(?=[^;,=\s]+=[^;,]+)/g)
    .map((value) => value.trim())
    .filter(Boolean);
}

function extractCookieHeaderFromResponse(response: Response) {
  const cookieValues =
    typeof (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie === "function"
      ? (response.headers as Headers & { getSetCookie: () => string[] }).getSetCookie()
      : (() => {
        const combined = response.headers.get("set-cookie");
        return combined ? splitCombinedSetCookieHeader(combined) : [];
      })();

  const cookieMap = new Map<string, string>();

  for (const cookieValue of cookieValues) {
    const pair = cookieValue.split(";")[0]?.trim();
    if (!pair) continue;
    const separatorIndex = pair.indexOf("=");
    if (separatorIndex === -1) continue;
    cookieMap.set(pair.slice(0, separatorIndex), pair);
  }

  return [...cookieMap.values()].join("; ") || null;
}

function mergeCookieHeaders(...headers: Array<string | null | undefined>) {
  const cookieMap = new Map<string, string>();

  for (const header of headers) {
    if (!header) continue;
    for (const pair of header.split(/;\s*/g).filter(Boolean)) {
      const separatorIndex = pair.indexOf("=");
      if (separatorIndex === -1) continue;
      cookieMap.set(pair.slice(0, separatorIndex), pair);
    }
  }

  return [...cookieMap.values()].join("; ") || null;
}

async function fetchWatchPage(videoId: string) {
  const watchUrl = new URL("https://www.youtube.com/watch");
  watchUrl.searchParams.set("v", videoId);
  watchUrl.searchParams.set("bpctr", "9999999999");
  watchUrl.searchParams.set("has_verified", "1");

  const response = await fetch(watchUrl, {
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-us,en;q=0.5",
      Cookie: YOUTUBE_WATCH_PAGE_COOKIE_HEADER,
      "Sec-Fetch-Mode": "navigate",
      "User-Agent": YOUTUBE_WEBPAGE_USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error(`YouTube watch page request failed (${response.status})`);
  }

  return {
    html: await response.text(),
    cookieHeader: mergeCookieHeaders(
      YOUTUBE_WATCH_PAGE_COOKIE_HEADER,
      extractCookieHeaderFromResponse(response),
    ),
  };
}

async function fetchWebInnertubeConfig(forceRefresh = false): Promise<InnertubeRequestAttempt> {
  if (!forceRefresh && cachedWebInnertubeConfig && cachedWebInnertubeConfig.expiresAt > Date.now()) {
    return cachedWebInnertubeConfig.value;
  }

  const response = await fetch("https://www.youtube.com/?hl=en", {
    headers: {
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": YOUTUBE_USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error(`YouTube home page request failed (${response.status})`);
  }

  const html = await response.text();
  const ytcfg = collectYtCfg(html);
  const context = sanitizeInnertubeContext(ytcfg);
  const config: InnertubeRequestAttempt = {
    apiKey: findStringDeep(ytcfg, "INNERTUBE_API_KEY") ?? FALLBACK_INNERTUBE_API_KEY,
    userAgent: YOUTUBE_USER_AGENT,
    context,
    clientVersion:
      findStringDeep(ytcfg, "INNERTUBE_CLIENT_VERSION")
      ?? findStringDeep(context, "clientVersion")
      ?? DEFAULT_INNERTUBE_CONTEXT.client.clientVersion,
    clientNameHeader: String(toNumber(ytcfg.INNERTUBE_CONTEXT_CLIENT_NAME) ?? 1),
    visitorData: findStringDeep(ytcfg, "VISITOR_DATA"),
    origin: "https://www.youtube.com",
  };

  cachedWebInnertubeConfig = {
    value: config,
    expiresAt: Date.now() + WEB_INNERTUBE_CONFIG_TTL_MS,
  };

  return config;
}

async function postWebInnertubeRequest(
  endpoint: "search" | "browse",
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const attempts: InnertubeRequestAttempt[] = [];
  const liveConfig = await fetchWebInnertubeConfig().catch(() => null);

  if (liveConfig) {
    attempts.push(liveConfig);
  }

  attempts.push({
    apiKey: FALLBACK_INNERTUBE_API_KEY,
    userAgent: YOUTUBE_USER_AGENT,
    context: DEFAULT_INNERTUBE_CONTEXT,
    clientVersion: DEFAULT_INNERTUBE_CONTEXT.client.clientVersion,
    clientNameHeader: "1",
    visitorData: null,
    origin: "https://www.youtube.com",
  });

  let lastError: unknown = null;

  for (const attempt of attempts) {
    try {
      const headers = new Headers({
        "Content-Type": "application/json",
        "Origin": attempt.origin,
        "User-Agent": attempt.userAgent,
        "X-YouTube-Client-Name": attempt.clientNameHeader,
        "X-YouTube-Client-Version": attempt.clientVersion,
      });

      if (attempt.visitorData) {
        headers.set("X-Goog-Visitor-Id", attempt.visitorData);
      }

      const response = await fetch(`https://www.youtube.com/youtubei/v1/${endpoint}?key=${encodeURIComponent(attempt.apiKey)}`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          context: attempt.context,
          ...body,
        }),
      });

      if (!response.ok) {
        lastError = new Error(`YouTube ${endpoint} request failed (${response.status})`);
        continue;
      }

      return await response.json() as Record<string, unknown>;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error(`YouTube ${endpoint} request failed`);
}

async function fetchPlayerResponseFromInnertube(
  videoId: string,
  ytcfg: Record<string, unknown>,
  cookieHeader: string | null,
) {
  const apiKey = findStringDeep(ytcfg, "INNERTUBE_API_KEY");
  const context = sanitizeInnertubeContext(ytcfg);
  const clientVersion =
    findStringDeep(context, "clientVersion")
    ?? DEFAULT_INNERTUBE_CONTEXT.client.clientVersion;
  const clientNameHeader = String(toNumber(ytcfg.INNERTUBE_CONTEXT_CLIENT_NAME) ?? 1);
  const visitorData = findStringDeep(ytcfg, "VISITOR_DATA");
  const sts = toNumber(findStringDeep(ytcfg, "STS"));
  const attempts: InnertubeRequestAttempt[] = [];

  if (apiKey) {
    attempts.push({
      apiKey,
      userAgent: YOUTUBE_USER_AGENT,
      context,
      clientVersion,
      clientNameHeader,
      visitorData,
      origin: "https://www.youtube.com",
    });
  }

  for (const attempt of FALLBACK_INNERTUBE_ATTEMPTS) {
    attempts.push({
      ...attempt,
      clientVersion: attempt.context.client.clientVersion,
      visitorData,
    });
  }

  let lastSuccessfulPayload: Record<string, unknown> | null = null;

  for (const attempt of attempts) {
    const headers = new Headers({
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-us,en;q=0.5",
      "Content-Type": "application/json",
      "Origin": attempt.origin,
      "Sec-Fetch-Mode": "navigate",
      "User-Agent": attempt.userAgent,
      "X-YouTube-Client-Name": attempt.clientNameHeader,
      "X-YouTube-Client-Version": attempt.clientVersion,
    });

    if (cookieHeader) {
      headers.set("Cookie", cookieHeader);
    }

    if (attempt.visitorData) {
      headers.set("X-Goog-Visitor-Id", attempt.visitorData);
    }

    const body: Record<string, unknown> = {
      context: attempt.context,
      videoId,
      contentCheckOk: true,
      racyCheckOk: true,
      playbackContext: {
        contentPlaybackContext: {
          html5Preference: "HTML5_PREF_WANTS",
        },
      },
    };

    if (sts) {
      const playbackContext = body.playbackContext as Record<string, unknown>;
      const contentPlaybackContext = playbackContext.contentPlaybackContext as Record<string, unknown>;
      contentPlaybackContext.signatureTimestamp = sts;
    }

    const response = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${encodeURIComponent(attempt.apiKey)}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      continue;
    }

    const payload = await response.json() as Record<string, unknown>;
    lastSuccessfulPayload = payload;

    if (hasPlayableFormats(payload)) {
      return payload;
    }
  }

  return lastSuccessfulPayload;
}

async function fetchPlayerCode(playerUrl: string) {
  const response = await fetch(playerUrl, {
    headers: {
      "User-Agent": YOUTUBE_USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error(`YouTube player script request failed (${response.status})`);
  }

  return response.text();
}

function dedupeFormats(formats: YouTubeResolvedFormat[]) {
  const seen = new Set<string>();
  const deduped: YouTubeResolvedFormat[] = [];

  for (const format of formats) {
    const key = `${format.itag ?? "no-itag"}:${format.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(format);
  }

  return deduped;
}

function resolveVideoMeta(playerResponse: Record<string, unknown>) {
  const videoDetails = isRecord(playerResponse.videoDetails)
    ? playerResponse.videoDetails
    : null;

  return {
    title: toStringValue(videoDetails?.title),
    author: toStringValue(videoDetails?.author),
    durationSeconds: toNumber(videoDetails?.lengthSeconds),
    isLive: videoDetails?.isLiveContent === true,
  };
}

function hasPlayableFormats(playerResponse: Record<string, unknown>) {
  return getStreamFormats(playerResponse).length > 0;
}

function getPlayerUrlFromYtCfg(ytcfg: Record<string, unknown>, html: string) {
  const fromConfig = toAbsolutePlayerUrl(
    findStringDeep(ytcfg, "PLAYER_JS_URL") ?? findStringDeep(ytcfg, "jsUrl"),
  );

  if (fromConfig) return fromConfig;

  const regexMatch = html.match(/"jsUrl":"([^"]+)"/);
  return toAbsolutePlayerUrl(regexMatch?.[1] ? regexMatch[1].replace(/\\u0026/g, "&") : null);
}

export async function searchYouTubeCatalog(
  query: string,
  filter: YouTubeCatalogSearchFilter,
  limit = 12,
): Promise<Record<string, unknown>[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const payload = await postWebInnertubeRequest("search", {
    query: trimmed,
    params: YOUTUBE_SEARCH_FILTER_PARAMS[filter],
  });

  const nodes =
    filter === "video"
      ? findObjectsByKey(payload, "videoRenderer")
      : [
        ...findObjectsByKey(payload, "lockupViewModel")
          .filter((node) => node.contentType === "LOCKUP_CONTENT_TYPE_PLAYLIST"),
        ...findObjectsByKey(payload, "playlistRenderer"),
      ];

  const deduped: Record<string, unknown>[] = [];
  const seen = new Set<string>();

  for (const node of nodes) {
    const key =
      toStringValue(node.contentId)
      ?? toStringValue(node.playlistId)
      ?? toStringValue(node.videoId);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(node);
    if (deduped.length >= limit) break;
  }

  return deduped;
}

export async function browseYouTubePlaylistCatalog(
  playlistId: string,
  limit = 100,
): Promise<YouTubePlaylistBrowseResult> {
  const trimmed = playlistId.trim();
  if (!trimmed) {
    return {
      header: null,
      items: [],
    };
  }

  const payload = await postWebInnertubeRequest("browse", {
    browseId: `VL${trimmed}`,
  });

  const header = firstObjectByKey(payload, "pageHeaderViewModel");
  const deduped: Record<string, unknown>[] = [];
  const seen = new Set<string>();

  for (const node of findObjectsByKey(payload, "lockupViewModel")) {
    if (node.contentType !== "LOCKUP_CONTENT_TYPE_VIDEO") continue;
    const key = toStringValue(node.contentId);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(node);
    if (deduped.length >= limit) break;
  }

  return {
    header,
    items: deduped,
  };
}

export function extractYouTubeVideoId(input: string) {
  const trimmed = input.trim();
  if (/^[\w-]{6,20}$/.test(trimmed)) return trimmed;

  try {
    const url = new URL(trimmed);
    const hostname = url.hostname.toLowerCase();

    if (hostname === "youtu.be") {
      const candidate = url.pathname.replace(/^\/+/, "").split("/")[0] ?? "";
      return /^[\w-]{6,20}$/.test(candidate) ? candidate : null;
    }

    if (
      hostname === "youtube.com"
      || hostname === "www.youtube.com"
      || hostname === "m.youtube.com"
      || hostname === "music.youtube.com"
    ) {
      if (url.pathname === "/watch") {
        const candidate = url.searchParams.get("v")?.trim() ?? "";
        return /^[\w-]{6,20}$/.test(candidate) ? candidate : null;
      }

      if (url.pathname.startsWith("/shorts/") || url.pathname.startsWith("/live/")) {
        const candidate = url.pathname.split("/")[2] ?? "";
        return /^[\w-]{6,20}$/.test(candidate) ? candidate : null;
      }

      if (url.pathname.startsWith("/embed/")) {
        const candidate = url.pathname.split("/")[2] ?? "";
        return /^[\w-]{6,20}$/.test(candidate) ? candidate : null;
      }
    }

    return null;
  } catch {
    return null;
  }
}

export async function resolveYouTubePlayback(
  sourceUrl: string,
  options: YouTubeResolveOptions = {},
): Promise<YouTubeResolveResponse> {
  const videoId = extractYouTubeVideoId(sourceUrl);
  if (!videoId) {
    throw new Error("Only YouTube video URLs and IDs are supported");
  }

  const preferredKind = options.preferredKind ?? "audio";
  const preferredContainer = options.preferredContainer;

  const [watchPage, upstream] = await Promise.all([
    fetchWatchPage(videoId),
    import("./upstream"),
  ]);
  const solverBundle = await upstream.loadActiveSolverBundle();
  const html = watchPage.html;

  const ytcfg = collectYtCfg(html);
  const initialPlayerResponse = extractInitialPlayerResponse(html);
  const innertubePlayerResponse = await fetchPlayerResponseFromInnertube(videoId, ytcfg, watchPage.cookieHeader).catch(() => null);
  const playerResponse =
    (innertubePlayerResponse && hasPlayableFormats(innertubePlayerResponse) ? innertubePlayerResponse : null)
    ?? (initialPlayerResponse && hasPlayableFormats(initialPlayerResponse) ? initialPlayerResponse : null);

  if (!playerResponse) {
    throw new Error("Could not extract YouTube streaming data from the watch page or Innertube");
  }

  const playerUrl = getPlayerUrlFromYtCfg(ytcfg, html);
  const candidates = getStreamFormats(playerResponse)
    .map((format) => prepareFormatCandidate(format))
    .filter((format): format is PreparedFormatCandidate => !!format);

  if (candidates.length === 0) {
    throw new Error("YouTube returned no playable formats");
  }

  const sigChallenges = [...new Set(candidates.map((candidate) => candidate.sigChallenge).filter((value): value is string => !!value))];
  const nChallenges = [...new Set(candidates.map((candidate) => candidate.nChallenge).filter((value): value is string => !!value))];

  let solvedChallenges = {
    n: {} as Record<string, string | null>,
    sig: {} as Record<string, string | null>,
  };

  if ((sigChallenges.length > 0 || nChallenges.length > 0) && playerUrl) {
    const playerCode = await fetchPlayerCode(playerUrl);
    solvedChallenges = solvePlayerChallenges(solverBundle, playerCode, {
      n: nChallenges,
      sig: sigChallenges,
    });
  }

  const resolvedFormats = dedupeFormats(candidates.map((candidate) => {
    const url = new URL(candidate.url);

    if (candidate.sigChallenge) {
      const solvedSig = solvedChallenges.sig[candidate.sigChallenge];
      if (!solvedSig) {
        throw new Error("yt-dlp solver could not decode a YouTube signature challenge");
      }
      url.searchParams.set(candidate.sigParameter ?? "signature", solvedSig);
    }

    if (candidate.nChallenge) {
      const solvedN = solvedChallenges.n[candidate.nChallenge];
      if (!solvedN) {
        throw new Error("yt-dlp solver could not decode a YouTube n challenge");
      }
      url.searchParams.set("n", solvedN);
    }

    return {
      ...candidate.format,
      url: url.toString(),
      expiresAt: toNumber(url.searchParams.get("expire")) ? Number(url.searchParams.get("expire")) * 1000 : candidate.format.expiresAt,
    };
  }));

  const selectedFormat = pickPreferredFormat(resolvedFormats, preferredKind, preferredContainer);
  const meta = resolveVideoMeta(playerResponse);

  return {
    sourceUrl,
    videoId,
    title: meta.title,
    author: meta.author,
    durationSeconds: meta.durationSeconds,
    isLive: meta.isLive,
    playerUrl,
    selectedFormat,
    formats: options.includeFormats === false ? [] : resolvedFormats,
    activeSolver: {
      version: solverBundle.version,
      source: solverBundle.source,
    },
  };
}
