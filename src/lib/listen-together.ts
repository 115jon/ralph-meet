export const LISTEN_TOGETHER_IMPORT_LIMIT = 100;
export const LISTEN_TOGETHER_RESOLVE_BATCH_SIZE = 20;
export const LISTEN_TOGETHER_DRIFT_TOLERANCE_MS = 750;
export const LISTEN_TOGETHER_SEARCH_TTL_SECONDS = 180;
export const LISTEN_TOGETHER_RESOLVE_TTL_SECONDS = 600;

export type ListenTogetherMusicProvider =
  | "youtube"
  | "youtube_music"
  | "spotify";
export type ListenTogetherProvider = ListenTogetherMusicProvider | "radio";
export type ListenTogetherSearchFilter = "track" | "collection";
export type ListenTogetherEnqueueMode = "append" | "play-next";

export interface ListenTogetherRequester {
  userId: string;
  displayName: string;
  avatarUrl?: string | null;
  avatarDisplay?: string | null;
}

export interface ListenTogetherMusicTrack {
  kind: "music";
  id: string;
  provider: ListenTogetherMusicProvider;
  videoId: string;
  title: string;
  artist?: string | null;
  album?: string | null;
  durationMs: number;
  artworkUrl?: string | null;
  canonicalUrl: string;
  sourceUrl?: string | null;
  sourceLabel: string;
}

export interface ListenTogetherRadioTrack {
  kind: "radio";
  id: string;
  provider: "radio";
  title: string;
  artist?: string | null;
  artworkUrl?: string | null;
  canonicalUrl: string;
  streamUrl: string;
  sourceLabel: string;
}

export type ListenTogetherTrack =
  | ListenTogetherMusicTrack
  | ListenTogetherRadioTrack;

export interface ListenTogetherSearchTrackResult {
  kind: "track";
  id: string;
  provider: ListenTogetherMusicProvider;
  videoId: string;
  title: string;
  artist?: string | null;
  album?: string | null;
  durationMs: number;
  artworkUrl?: string | null;
  canonicalUrl: string;
  sourceUrl?: string | null;
  sourceLabel: string;
}

export interface ListenTogetherSearchCollectionResult {
  kind: "collection";
  id: string;
  provider: ListenTogetherMusicProvider;
  title: string;
  subtitle?: string | null;
  itemCount: number;
  artworkUrl?: string | null;
  sourceUrl: string;
}

export type ListenTogetherSearchResult =
  | ListenTogetherSearchTrackResult
  | ListenTogetherSearchCollectionResult;

export interface ListenTogetherSearchResponse {
  filter: ListenTogetherSearchFilter;
  results: ListenTogetherSearchResult[];
  cursor: string | null;
}

export interface ListenTogetherResolveCollectionMeta {
  id: string;
  provider: ListenTogetherMusicProvider;
  title: string;
  subtitle?: string | null;
  itemCount: number;
  artworkUrl?: string | null;
  sourceUrl: string;
}

export interface ListenTogetherSkippedItem {
  title: string;
  artist?: string | null;
  reason: string;
}

export interface ListenTogetherResolveResponse {
  kind: "track" | "collection";
  tracks: ListenTogetherTrack[];
  collection: ListenTogetherResolveCollectionMeta | null;
  resolvedCount: number;
  skippedCount: number;
  skippedItems: ListenTogetherSkippedItem[];
  nextOffset?: number | null;
  totalCount?: number;
}

export interface ListenTogetherQueueEntrySeed {
  track: ListenTogetherTrack;
  requester: ListenTogetherRequester;
  importBatchId?: string | null;
  importBatchLabel?: string | null;
}

export interface ListenTogetherQueueEntry extends ListenTogetherQueueEntrySeed {
  entryId: string;
  requestedAt: number;
}

export interface ListenTogetherPersistentState {
  roomSlug: string;
  revision: number;
  paused: boolean;
  currentEntryId: string | null;
  anchorPositionMs: number;
  anchorUpdatedAt: number | null;
  lastUpdatedAt: number;
}

export interface ListenTogetherStateSnapshot extends ListenTogetherPersistentState {
  queue: ListenTogetherQueueEntry[];
  currentEntry: ListenTogetherQueueEntry | null;
  positionMs: number;
  durationMs: number | null;
}

export interface ListenTogetherStateRequestCommand {
  type: "listen_together.state.request";
  room_slug: string;
}

export interface ListenTogetherEnqueueCommand {
  type: "listen_together.enqueue";
  room_slug: string;
  mode: ListenTogetherEnqueueMode;
  entries: ListenTogetherQueueEntrySeed[];
}

export interface ListenTogetherPlayCommand {
  type: "listen_together.play";
  room_slug: string;
  entryId?: string | null;
}

export interface ListenTogetherPauseCommand {
  type: "listen_together.pause";
  room_slug: string;
  paused: boolean;
}

export interface ListenTogetherSeekCommand {
  type: "listen_together.seek";
  room_slug: string;
  positionMs: number;
}

export interface ListenTogetherSkipCommand {
  type: "listen_together.skip";
  room_slug: string;
}

export interface ListenTogetherRemoveCommand {
  type: "listen_together.remove";
  room_slug: string;
  entryId: string;
}

export interface ListenTogetherClearCommand {
  type: "listen_together.clear";
  room_slug: string;
}

export type ListenTogetherCommand =
  | ListenTogetherStateRequestCommand
  | ListenTogetherEnqueueCommand
  | ListenTogetherPlayCommand
  | ListenTogetherPauseCommand
  | ListenTogetherSeekCommand
  | ListenTogetherSkipCommand
  | ListenTogetherRemoveCommand
  | ListenTogetherClearCommand;

export interface ListenTogetherSnapshotEvent {
  type: "listen_together.snapshot";
  room_slug: string;
  snapshot: ListenTogetherStateSnapshot;
}

export interface ListenTogetherQueueUpdatedEvent {
  type: "listen_together.queue.updated";
  room_slug: string;
  snapshot: ListenTogetherStateSnapshot;
}

export interface ListenTogetherPlaybackUpdatedEvent {
  type: "listen_together.playback.updated";
  room_slug: string;
  snapshot: ListenTogetherStateSnapshot;
}

export interface ListenTogetherErrorEvent {
  type: "listen_together.error";
  room_slug: string;
  code: string;
  message: string;
}

export type ListenTogetherEvent =
  | ListenTogetherSnapshotEvent
  | ListenTogetherQueueUpdatedEvent
  | ListenTogetherPlaybackUpdatedEvent
  | ListenTogetherErrorEvent;

export function createListenTogetherState(
  roomSlug: string,
  now = Date.now(),
): ListenTogetherPersistentState {
  return {
    roomSlug,
    revision: 0,
    paused: true,
    currentEntryId: null,
    anchorPositionMs: 0,
    anchorUpdatedAt: now,
    lastUpdatedAt: now,
  };
}

export function clampListenTogetherPosition(
  positionMs: number,
  durationMs?: number | null,
): number {
  const min = Math.max(0, Math.floor(positionMs || 0));
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs)) {
    return min;
  }
  return Math.min(min, Math.max(0, Math.floor(durationMs)));
}

export function getListenTogetherCurrentEntry(
  queue: ListenTogetherQueueEntry[],
  currentEntryId: string | null,
): ListenTogetherQueueEntry | null {
  if (!currentEntryId) return null;
  return queue.find((entry) => entry.entryId === currentEntryId) ?? null;
}

export function getListenTogetherTrackDuration(
  track: ListenTogetherTrack,
): number | null {
  return track.kind === "music" ? track.durationMs : null;
}

export function convertSearchTrackToMusicTrack(
  searchTrack: ListenTogetherSearchTrackResult,
): ListenTogetherMusicTrack {
  return {
    kind: "music",
    id: searchTrack.id,
    provider: searchTrack.provider,
    videoId: searchTrack.videoId,
    title: searchTrack.title,
    artist: searchTrack.artist,
    album: searchTrack.album,
    durationMs: searchTrack.durationMs,
    artworkUrl: searchTrack.artworkUrl,
    canonicalUrl: searchTrack.canonicalUrl,
    sourceUrl: searchTrack.sourceUrl,
    sourceLabel: searchTrack.sourceLabel,
  };
}

export function getListenTogetherPositionMs(
  state: Pick<
    ListenTogetherPersistentState,
    "paused" | "anchorPositionMs" | "anchorUpdatedAt"
  >,
  durationMs?: number | null,
  now = Date.now(),
): number {
  if (state.paused || !state.anchorUpdatedAt) {
    return clampListenTogetherPosition(state.anchorPositionMs, durationMs);
  }
  return clampListenTogetherPosition(
    state.anchorPositionMs + Math.max(0, now - state.anchorUpdatedAt),
    durationMs,
  );
}

export function buildListenTogetherSnapshot(
  state: ListenTogetherPersistentState,
  queue: ListenTogetherQueueEntry[],
  now = Date.now(),
): ListenTogetherStateSnapshot {
  const currentEntry = getListenTogetherCurrentEntry(
    queue,
    state.currentEntryId,
  );
  const durationMs = currentEntry
    ? getListenTogetherTrackDuration(currentEntry.track)
    : null;
  return {
    ...state,
    queue,
    currentEntry,
    durationMs,
    positionMs: getListenTogetherPositionMs(state, durationMs, now),
  };
}

export function getListenTogetherStreamPath(
  videoId: string,
  roomSlug?: string | null,
): string {
  const params = new URLSearchParams({ videoId });
  if (roomSlug) params.set("roomSlug", roomSlug);
  return `/api/listen-together/stream?${params.toString()}`;
}

export function isValidListenTogetherVideoId(videoId: string): boolean {
  return /^[\w-]{6,20}$/.test(videoId);
}

export function isListenTogetherResolvableUrl(input: string): boolean {
  try {
    const parsed = new URL(input.trim());
    const hostname = parsed.hostname.toLowerCase();
    return (
      hostname === "youtube.com" ||
      hostname === "www.youtube.com" ||
      hostname === "m.youtube.com" ||
      hostname === "music.youtube.com" ||
      hostname === "youtu.be" ||
      hostname === "open.spotify.com" ||
      hostname === "play.spotify.com"
    );
  } catch {
    return false;
  }
}

export function getListenTogetherInputMode(
  input: string,
): "empty" | "search" | "resolve" {
  const trimmed = input.trim();
  if (!trimmed) return "empty";
  return isListenTogetherResolvableUrl(trimmed) ? "resolve" : "search";
}
