import { cacheGet, cacheSet } from "@/lib/cache";
import { clog } from "@/lib/console-logger";
import {
  LISTEN_TOGETHER_IMPORT_LIMIT,
  LISTEN_TOGETHER_RESOLVE_TTL_SECONDS,
  LISTEN_TOGETHER_SEARCH_TTL_SECONDS,
  type ListenTogetherProvider,
  type ListenTogetherResolveCollectionMeta,
  type ListenTogetherResolveResponse,
  type ListenTogetherSearchFilter,
  type ListenTogetherSearchResponse,
  type ListenTogetherSearchResult,
  type ListenTogetherSearchTrackResult,
  type ListenTogetherSkippedItem,
  type ListenTogetherTrack,
} from "@/lib/listen-together";
import {
  browseYouTubePlaylistCatalog,
  resolveYouTubePlayback,
  searchYouTubeCatalog,
} from "@/lib/ytdlp/youtube";

const log = clog("listen-together");

let spotifyClientPromise: Promise<SpotifyClient> | null = null;

const LISTEN_TOGETHER_STREAM_CACHE_TTL_SECONDS = 120;

interface SpotifyTrackLike {
  name: string;
  artist: string;
  duration?: number;
}

interface SpotifyDetails {
  preview: {
    type: string;
    title?: string;
    artist?: string;
    image?: string;
    link?: string;
  };
  tracks: Array<{
    artist: string;
    duration?: number;
    name: string;
    uri?: string;
  }>;
}

interface SpotifyClient {
  getDetails: (url: string, opts?: RequestInit) => Promise<SpotifyDetails>;
}

interface ExtractedYouTubeUrl {
  provider: "youtube" | "youtube_music";
  videoId?: string;
  playlistId?: string;
}

interface ListenTogetherResolvedAudioStream {
  url: string;
  itag: number | null;
  mimeType: string | null;
  contentLength: number | null;
  expiresAt: number | null;
}

const localAudioStreamCache = new Map<string, {
  value: ListenTogetherResolvedAudioStream;
  expiresAt: number;
}>();

const localAudioStreamInFlight = new Map<string, Promise<ListenTogetherResolvedAudioStream>>();

function getSearchCacheKey(query: string, filter: ListenTogetherSearchFilter) {
  return `v1:listen-together:search:${filter}:${query.trim().toLowerCase()}`;
}

function getResolveCacheKey(rawUrl: string) {
  return `v1:listen-together:resolve:${rawUrl.trim()}`;
}

function getAudioStreamCacheKey(
  videoId: string,
  preferredFormat: "mp4" | "webm",
) {
  return `v1:listen-together:stream:${preferredFormat}:${videoId.trim()}`;
}

function getAudioStreamCacheTtl(expiresAt: number | null | undefined) {
  if (!expiresAt || !Number.isFinite(expiresAt)) {
    return LISTEN_TOGETHER_STREAM_CACHE_TTL_SECONDS;
  }

  const remainingSeconds = Math.floor((expiresAt - Date.now()) / 1000);
  return Math.max(15, Math.min(LISTEN_TOGETHER_STREAM_CACHE_TTL_SECONDS, remainingSeconds - 30));
}

function getLocalCachedAudioStream(cacheKey: string): ListenTogetherResolvedAudioStream | null {
  const cached = localAudioStreamCache.get(cacheKey);
  if (!cached) return null;

  if (cached.expiresAt <= Date.now()) {
    localAudioStreamCache.delete(cacheKey);
    return null;
  }

  return cached.value;
}

function setLocalCachedAudioStream(
  cacheKey: string,
  value: ListenTogetherResolvedAudioStream,
  ttlSeconds: number,
) {
  localAudioStreamCache.set(cacheKey, {
    value,
    expiresAt: Date.now() + (ttlSeconds * 1000),
  });
}

async function getSpotifyClient() {
  if (!spotifyClientPromise) {
    spotifyClientPromise = import("spotify-url-info").then((mod) => {
      const createSpotifyClient = (
        "default" in mod
          ? mod.default
          : mod
      ) as unknown as (fetchImpl: typeof fetch) => SpotifyClient;

      return createSpotifyClient(fetch);
    });
  }
  return spotifyClientPromise;
}

function normalizeText(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function textFromNode(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) {
    const joined = value
      .map((entry) => textFromNode(entry))
      .filter((entry): entry is string => !!entry)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    return joined || null;
  }

  if (!isRecord(value)) {
    return null;
  }

  if (typeof value.simpleText === "string") return value.simpleText.trim() || null;
  if (typeof value.content === "string") return value.content.trim() || null;
  if (typeof value.text === "string") return value.text.trim() || null;

  const nestedText =
    textFromNode(value.text)
    ?? textFromNode(value.title)
    ?? textFromNode(value.simpleText)
    ?? textFromNode(value.content)
    ?? textFromNode(value.dynamicTextViewModel)
    ?? textFromNode(value.accessibilityData)
    ?? textFromNode(value.accessibility)
    ?? textFromNode(value.rendererContext)
    ?? textFromNode(value.label);
  if (nestedText) {
    return nestedText;
  }

  const runs = Array.isArray(value.runs) ? value.runs : null;
  if (runs) {
    const joined = runs
      .map((run) => textFromNode(run))
      .filter((entry): entry is string => !!entry)
      .join("")
      .trim();
    if (joined) return joined;
  }

  const metadataParts = Array.isArray(value.metadataParts) ? value.metadataParts : null;
  if (metadataParts) {
    const joined = metadataParts
      .map((part) => textFromNode(part))
      .filter((entry): entry is string => !!entry)
      .join(" • ")
      .trim();
    if (joined) return joined;
  }

  return null;
}

function numberFromText(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.replace(/,/g, "").match(/(\d+)/);
  if (!match) return null;
  return Number(match[1]);
}

function chooseBestThumbnail(input: unknown): string | null {
  if (!Array.isArray(input) || input.length === 0) return null;
  const last = input[input.length - 1] as { url?: unknown };
  return typeof last?.url === "string" ? last.url : null;
}

function metadataRowsFromNode(input: unknown): string[][] {
  if (!isRecord(input) || !Array.isArray(input.metadataRows)) {
    return [];
  }

  return input.metadataRows
    .map((row) => {
      if (!isRecord(row) || !Array.isArray(row.metadataParts)) {
        return [];
      }

      return row.metadataParts
        .map((part) => textFromNode(part))
        .filter((entry): entry is string => !!entry);
    })
    .filter((row) => row.length > 0);
}

function firstMetadataText(rows: string[][], rowIndex: number, partIndex = 0) {
  return rows[rowIndex]?.[partIndex] ?? null;
}

function playlistItemCountFromRows(rows: string[][]): number | null {
  for (const row of rows) {
    for (const part of row) {
      if (!/video/i.test(part)) continue;
      const count = numberFromText(part);
      if (count !== null) return count;
    }
  }

  return null;
}

function buildYoutubeWatchUrl(videoId: string) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function buildYoutubePlaylistUrl(playlistId: string) {
  return `https://www.youtube.com/playlist?list=${playlistId}`;
}

function buildYoutubeArtworkUrl(videoId: string) {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

export function parseDurationSeconds(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parts = value.split(":").map((segment) => Number(segment));
    if (parts.every((part) => Number.isFinite(part))) {
      return parts.reduce((total, part) => (total * 60) + part, 0);
    }
  }
  return 0;
}

function parseDurationSecondsOrNull(value: unknown): number | null {
  const seconds = parseDurationSeconds(value);
  return seconds > 0 ? seconds : null;
}

function buildSpokenDurationVariants(totalSeconds: number): string[] {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return [];
  }

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];

  if (hours > 0) {
    parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
  }
  if (minutes > 0) {
    parts.push(`${minutes} minute${minutes === 1 ? "" : "s"}`);
  }
  if (seconds > 0 || parts.length === 0) {
    parts.push(`${seconds} second${seconds === 1 ? "" : "s"}`);
  }

  return [...new Set([parts.join(", "), parts.join(" ")])];
}

function sanitizeResolvedTrackTitle(title: string, durationSeconds: number | null) {
  const normalizedTitle = title.replace(/\s+/g, " ").trim();
  if (!normalizedTitle || !durationSeconds) {
    return normalizedTitle;
  }

  const lowerTitle = normalizedTitle.toLowerCase();
  for (const variant of buildSpokenDurationVariants(durationSeconds)) {
    if (!lowerTitle.endsWith(variant.toLowerCase())) continue;

    return normalizedTitle
      .slice(0, normalizedTitle.length - variant.length)
      .replace(/[\s\-–•|,:]+$/g, "")
      .trim();
  }

  return normalizedTitle;
}

export function mapYoutubeVideoNode(
  input: any,
  provider: ListenTogetherProvider = "youtube",
  sourceLabel = provider === "youtube_music" ? "YouTube Music" : "YouTube",
): ListenTogetherSearchTrackResult | null {
  const videoId = input?.video_id ?? input?.id ?? input?.content_id ?? input?.videoId ?? input?.contentId;
  const metadataRows = metadataRowsFromNode(input?.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel);
  const rawTitle =
    textFromNode(input?.title)
    ?? textFromNode(input?.metadata?.title)
    ?? textFromNode(input?.metadata?.lockupMetadataViewModel?.title);
  const durationSeconds =
    (typeof input?.duration?.seconds === "number" && Number.isFinite(input.duration.seconds)
      ? input.duration.seconds
      : null)
    ?? parseDurationSecondsOrNull(textFromNode(input?.length_text))
    ?? parseDurationSecondsOrNull(textFromNode(input?.lengthText))
    ?? parseDurationSecondsOrNull(input?.duration?.text)
    ?? parseDurationSecondsOrNull(
      textFromNode(
        input?.contentImage?.thumbnailViewModel?.overlays?.[0]?.thumbnailBottomOverlayViewModel?.badges?.[0]?.thumbnailBadgeViewModel?.text,
      ),
    );
  const title = rawTitle ? sanitizeResolvedTrackTitle(rawTitle, durationSeconds) : null;

  if (!videoId || !title || !durationSeconds || input?.is_live || input?.is_upcoming) {
    return null;
  }

  const artist =
    textFromNode(input?.author?.name)
    ?? textFromNode(input?.author)
    ?? textFromNode(input?.short_byline_text)
    ?? textFromNode(input?.long_byline_text)
    ?? textFromNode(input?.ownerText)
    ?? textFromNode(input?.shortBylineText)
    ?? textFromNode(input?.longBylineText)
    ?? firstMetadataText(metadataRows, 0)
    ?? null;

  const artworkUrl =
    chooseBestThumbnail(input?.thumbnails)
    ?? chooseBestThumbnail(input?.thumbnail?.thumbnails)
    ?? chooseBestThumbnail(input?.thumbnail?.contents)
    ?? chooseBestThumbnail(input?.thumbnail?.sources)
    ?? chooseBestThumbnail(input?.contentImage?.thumbnailViewModel?.image?.sources);

  return {
    kind: "track",
    id: `${provider}:${videoId}`,
    provider,
    videoId,
    title,
    artist,
    album: null,
    durationMs: durationSeconds * 1000,
    artworkUrl,
    canonicalUrl: buildYoutubeWatchUrl(videoId),
    sourceUrl: buildYoutubeWatchUrl(videoId),
    sourceLabel,
  };
}

function mapYoutubePlaylistNode(input: any): ListenTogetherSearchResult | null {
  const playlistId =
    input?.id
    ?? input?.content_id
    ?? input?.playlist_id
    ?? input?.playlistId
    ?? input?.contentId;
  const metadataRows = metadataRowsFromNode(input?.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel);
  const title =
    textFromNode(input?.title)
    ?? textFromNode(input?.metadata?.title)
    ?? textFromNode(input?.metadata?.lockupMetadataViewModel?.title);
  const subtitle =
    textFromNode(input?.author?.name)
    ?? textFromNode(input?.metadata?.subtitle)
    ?? firstMetadataText(metadataRows, 0)
    ?? null;
  const itemCount =
    numberFromText(textFromNode(input?.video_count))
    ?? numberFromText(textFromNode(input?.video_count_short))
    ?? numberFromText(textFromNode(input?.metadata?.subtitle))
    ?? numberFromText(
      textFromNode(
        input?.contentImage?.collectionThumbnailViewModel?.primaryThumbnail?.thumbnailViewModel?.overlays?.[0]?.thumbnailOverlayBadgeViewModel?.thumbnailBadges?.[0]?.thumbnailBadgeViewModel?.text,
      ),
    )
    ?? playlistItemCountFromRows(metadataRows)
    ?? 0;

  if (!playlistId || !title) {
    return null;
  }

  return {
    kind: "collection",
    id: `youtube_playlist:${playlistId}`,
    provider: "youtube",
    title,
    subtitle,
    itemCount,
    artworkUrl:
      chooseBestThumbnail(input?.thumbnails)
      ?? chooseBestThumbnail(input?.thumbnail?.thumbnails)
      ?? chooseBestThumbnail(input?.contentImage?.collectionThumbnailViewModel?.primaryThumbnail?.thumbnailViewModel?.image?.sources),
    sourceUrl: buildYoutubePlaylistUrl(playlistId),
  };
}

export function extractYouTubeUrl(rawUrl: string): ExtractedYouTubeUrl | null {
  try {
    const parsed = new URL(rawUrl);
    const hostname = parsed.hostname.toLowerCase();
    if (
      hostname !== "youtube.com"
      && hostname !== "www.youtube.com"
      && hostname !== "m.youtube.com"
      && hostname !== "music.youtube.com"
      && hostname !== "youtu.be"
    ) {
      return null;
    }

    const provider = hostname === "music.youtube.com" ? "youtube_music" : "youtube";

    if (hostname === "youtu.be") {
      const videoId = parsed.pathname.replace(/^\/+/, "").split("/")[0];
      return videoId ? { provider, videoId } : null;
    }

    if (parsed.pathname === "/playlist") {
      const playlistId = parsed.searchParams.get("list")?.trim();
      return playlistId ? { provider, playlistId } : null;
    }

    if (parsed.pathname.startsWith("/watch")) {
      const videoId = parsed.searchParams.get("v")?.trim() ?? undefined;
      const playlistId = parsed.searchParams.get("list")?.trim() ?? undefined;
      return { provider, videoId, playlistId };
    }

    if (parsed.pathname.startsWith("/shorts/") || parsed.pathname.startsWith("/live/")) {
      const videoId = parsed.pathname.split("/")[2];
      return videoId ? { provider, videoId } : null;
    }

    return null;
  } catch {
    return null;
  }
}

function isSpotifyUrl(rawUrl: string) {
  try {
    const parsed = new URL(rawUrl);
    const hostname = parsed.hostname.toLowerCase();
    return hostname === "open.spotify.com" || hostname === "play.spotify.com";
  } catch {
    return false;
  }
}

function buildSpotifySearchQuery(track: SpotifyTrackLike) {
  return [track.artist, track.name].filter(Boolean).join(" ").trim();
}

function normalizeSpotifyDurationMs(duration: number | null | undefined): number | null {
  if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0) {
    return null;
  }

  return duration > 10_000 ? Math.round(duration) : Math.round(duration * 1000);
}

export function scoreYoutubeCandidate(candidate: ListenTogetherTrack, target: SpotifyTrackLike) {
  const targetTokens = new Set(normalizeText(`${target.artist} ${target.name}`).split(" ").filter(Boolean));
  const candidateTokens = normalizeText(`${candidate.artist ?? ""} ${candidate.title}`).split(" ").filter(Boolean);
  const tokenHits = candidateTokens.reduce(
    (count, token) => count + (targetTokens.has(token) ? 1 : 0),
    0,
  );
  const targetDurationMs = normalizeSpotifyDurationMs(target.duration);
  const durationPenalty =
    targetDurationMs === null
      ? 0
      : Math.abs(candidate.durationMs - targetDurationMs) / 1000;

  const exactTitleBoost = normalizeText(candidate.title).includes(normalizeText(target.name)) ? 8 : 0;
  const exactArtistBoost =
    candidate.artist && normalizeText(candidate.artist).includes(normalizeText(target.artist))
      ? 6
      : 0;

  return (tokenHits * 4) + exactTitleBoost + exactArtistBoost - durationPenalty;
}

async function searchYoutubeTracks(query: string, limit = 10) {
  const results = await searchYouTubeCatalog(query, "video", limit);
  return results
    .map((item) => mapYoutubeVideoNode(item, "youtube", "YouTube"))
    .filter((item): item is ListenTogetherSearchTrackResult => !!item)
    .slice(0, limit);
}

async function resolveSpotifyTrackToYoutube(
  track: SpotifyTrackLike,
  sourceUrl: string,
): Promise<ListenTogetherTrack | null> {
  const query = buildSpotifySearchQuery(track);
  if (!query) return null;
  const candidates = await searchYoutubeTracks(query, 5);
  if (candidates.length === 0) return null;

  const best = [...candidates]
    .map((candidate) => ({ candidate, score: scoreYoutubeCandidate(candidate, track) }))
    .sort((left, right) => right.score - left.score)[0];

  if (!best || best.score < 4) return null;

  return {
    ...best.candidate,
    id: `spotify:${best.candidate.videoId}`,
    provider: "spotify",
    artist: track.artist || best.candidate.artist,
    sourceUrl,
    sourceLabel: "Spotify",
  };
}

async function resolveYoutubeVideo(
  videoId: string,
  provider: "youtube" | "youtube_music",
): Promise<ListenTogetherTrack | null> {
  try {
    const resolved = await resolveYouTubePlayback(buildYoutubeWatchUrl(videoId), {
      preferredKind: "audio",
      includeFormats: false,
    });

    if (resolved.title && resolved.durationSeconds && !resolved.isLive) {
      return {
        id: `${provider}:${resolved.videoId}`,
        provider,
        videoId: resolved.videoId,
        title: sanitizeResolvedTrackTitle(resolved.title, resolved.durationSeconds),
        artist: resolved.author,
        album: null,
        durationMs: resolved.durationSeconds * 1000,
        artworkUrl: buildYoutubeArtworkUrl(resolved.videoId),
        canonicalUrl: buildYoutubeWatchUrl(resolved.videoId),
        sourceUrl: buildYoutubeWatchUrl(resolved.videoId),
        sourceLabel: provider === "youtube_music" ? "YouTube Music" : "YouTube",
        };
      }
  } catch (error) {
    log.warn("yt-dlp-backed YouTube metadata resolution failed", error);
  }

  return null;
}

function mapYoutubePlaylistHeaderToCollection(
  playlistId: string,
  header: Record<string, unknown> | null,
  tracks: ListenTogetherTrack[],
): ListenTogetherResolveCollectionMeta {
  const metadataRows = metadataRowsFromNode((header as any)?.metadata?.contentMetadataViewModel);
  const subtitleText = firstMetadataText(metadataRows, 0);

  return {
    id: `youtube_playlist:${playlistId}`,
    provider: "youtube",
    title: textFromNode((header as any)?.title) ?? "YouTube Playlist",
    subtitle: subtitleText ? subtitleText.replace(/^by\s+/i, "").trim() : null,
    itemCount: Math.min(
      LISTEN_TOGETHER_IMPORT_LIMIT,
      playlistItemCountFromRows(metadataRows) ?? tracks.length,
    ),
    artworkUrl:
      chooseBestThumbnail((header as any)?.heroImage?.contentPreviewImageViewModel?.image?.sources)
      ?? tracks[0]?.artworkUrl
      ?? null,
    sourceUrl: buildYoutubePlaylistUrl(playlistId),
  };
}

async function resolveYoutubePlaylist(
  playlistId: string,
): Promise<ListenTogetherResolveResponse> {
  const playlist = await browseYouTubePlaylistCatalog(playlistId, LISTEN_TOGETHER_IMPORT_LIMIT);
  const tracks = playlist.items
    .map((item) => mapYoutubeVideoNode(item, "youtube", "YouTube"))
    .filter((item): item is ListenTogetherSearchTrackResult => !!item)
    .slice(0, LISTEN_TOGETHER_IMPORT_LIMIT);
  const collection = mapYoutubePlaylistHeaderToCollection(playlistId, playlist.header, tracks);

  return {
    kind: "collection",
    tracks,
    collection,
    resolvedCount: tracks.length,
    skippedCount: 0,
    skippedItems: [],
  };
}

async function resolveSpotifyUrl(rawUrl: string): Promise<ListenTogetherResolveResponse> {
  const spotify = await getSpotifyClient();
  const details = await spotify.getDetails(rawUrl);
  const sourceType = details.preview.type;
  const sourceTracks = details.tracks.slice(0, LISTEN_TOGETHER_IMPORT_LIMIT);
  const skippedItems: ListenTogetherSkippedItem[] = [];
  const resolvedTracks: ListenTogetherTrack[] = [];

  for (const track of sourceTracks) {
    try {
      const resolved = await resolveSpotifyTrackToYoutube(
        { name: track.name, artist: track.artist, duration: track.duration },
        rawUrl,
      );
      if (resolved) {
        resolvedTracks.push(resolved);
      } else {
        skippedItems.push({
          title: track.name,
          artist: track.artist,
          reason: "No close YouTube match found",
        });
      }
    } catch (error) {
      log.warn("spotify track resolution failed", error);
      skippedItems.push({
        title: track.name,
        artist: track.artist,
        reason: "Track resolution failed",
      });
    }
  }

  if (sourceType === "track") {
    return {
      kind: "track",
      tracks: resolvedTracks.slice(0, 1),
      collection: null,
      resolvedCount: resolvedTracks.length,
      skippedCount: skippedItems.length,
      skippedItems,
    };
  }

  return {
    kind: "collection",
    tracks: resolvedTracks,
    collection: {
      id: `${sourceType}:${normalizeText(details.preview.title)}`,
      provider: "spotify",
      title: details.preview.title ?? "Spotify Collection",
      subtitle: details.preview.artist,
      itemCount: sourceTracks.length,
      artworkUrl: details.preview.image ?? null,
      sourceUrl: rawUrl,
    },
    resolvedCount: resolvedTracks.length,
    skippedCount: skippedItems.length,
    skippedItems,
  };
}

export async function searchListenTogether(
  query: string,
  filter: ListenTogetherSearchFilter,
): Promise<ListenTogetherSearchResponse> {
  const trimmed = query.trim();
  if (!trimmed) {
    return { filter, results: [], cursor: null };
  }

  const cacheKey = getSearchCacheKey(trimmed, filter);
  const cached = await cacheGet<ListenTogetherSearchResponse>(cacheKey);
  if (cached) return cached;

  try {
    let results: ListenTogetherSearchResult[] = [];

    if (filter === "collection") {
      const collections = await searchYouTubeCatalog(trimmed, "playlist", 10);
      results = collections
        .map((playlist) => mapYoutubePlaylistNode(playlist))
        .filter((item): item is ListenTogetherSearchResult => !!item)
        .slice(0, 10);
    } else {
      results = (await searchYoutubeTracks(trimmed, 12)).slice(0, 12);
    }

    const response: ListenTogetherSearchResponse = {
      filter,
      results,
      cursor: null,
    };

    cacheSet(cacheKey, response, LISTEN_TOGETHER_SEARCH_TTL_SECONDS).catch(() => {});
    return response;
  } catch (error) {
    log.warn("listen-together search failed", {
      query: trimmed,
      filter,
      error,
    });

    return {
      filter,
      results: [],
      cursor: null,
    };
  }
}

export async function resolveListenTogetherUrl(
  rawUrl: string,
): Promise<ListenTogetherResolveResponse> {
  const trimmed = rawUrl.trim();
  const cacheKey = getResolveCacheKey(trimmed);
  const cached = await cacheGet<ListenTogetherResolveResponse>(cacheKey);
  if (cached) return cached;

  let response: ListenTogetherResolveResponse;
  const youtubeUrl = extractYouTubeUrl(trimmed);

  if (youtubeUrl?.videoId) {
    const track = await resolveYoutubeVideo(youtubeUrl.videoId, youtubeUrl.provider);
    response = {
      kind: "track",
      tracks: track ? [track] : [],
      collection: null,
      resolvedCount: track ? 1 : 0,
      skippedCount: track ? 0 : 1,
      skippedItems: track ? [] : [{ title: trimmed, reason: "Could not resolve YouTube video" }],
    };
  } else if (youtubeUrl?.playlistId) {
    response = await resolveYoutubePlaylist(youtubeUrl.playlistId);
  } else if (isSpotifyUrl(trimmed)) {
    response = await resolveSpotifyUrl(trimmed);
  } else {
    throw new Error("Only YouTube and Spotify URLs are supported");
  }

  cacheSet(cacheKey, response, LISTEN_TOGETHER_RESOLVE_TTL_SECONDS).catch(() => {});
  return response;
}

export async function resolveListenTogetherAudioStream(
  videoId: string,
  preferredFormat: "mp4" | "webm" = "mp4",
  options?: {
    forceRefresh?: boolean;
  },
) {
  const cacheKey = getAudioStreamCacheKey(videoId, preferredFormat);
  const forceRefresh = options?.forceRefresh === true;

  if (!forceRefresh) {
    const localCached = getLocalCachedAudioStream(cacheKey);
    if (localCached?.url) {
      return localCached;
    }

    const cached = await cacheGet<ListenTogetherResolvedAudioStream>(cacheKey);
    if (cached?.url) {
      const ttlSeconds = getAudioStreamCacheTtl(cached.expiresAt);
      setLocalCachedAudioStream(cacheKey, cached, ttlSeconds);
      return cached;
    }

    const inFlight = localAudioStreamInFlight.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }
  }

  const resolution = (async () => {
    try {
      const resolved = await resolveYouTubePlayback(videoId, {
        preferredKind: "audio",
        preferredContainer: preferredFormat,
        includeFormats: true,
      });

      if (resolved.selectedFormat?.url) {
        const response: ListenTogetherResolvedAudioStream = {
          url: resolved.selectedFormat.url,
          itag: resolved.selectedFormat.itag,
          mimeType: resolved.selectedFormat.mimeType,
          contentLength: resolved.selectedFormat.contentLength,
          expiresAt: resolved.selectedFormat.expiresAt,
        };
        const ttlSeconds = getAudioStreamCacheTtl(resolved.selectedFormat.expiresAt);
        setLocalCachedAudioStream(cacheKey, response, ttlSeconds);
        cacheSet(cacheKey, response, ttlSeconds).catch(() => {});
        return response;
      }
    } catch (error) {
      log.warn("yt-dlp-backed YouTube audio resolution failed", error);
    }

    throw new Error("Could not resolve a playable direct audio stream");
  })();

  localAudioStreamInFlight.set(cacheKey, resolution);

  try {
    return await resolution;
  } finally {
    localAudioStreamInFlight.delete(cacheKey);
  }
}
