import type { GridItem } from "@/components/voice/types";
import type { StreamWatchSnapshotPayload } from "@/lib/types";

export interface StreamWatcherIdentity {
  userId: string;
  name: string;
  avatar?: string | null;
  isLocal: boolean;
}

export type StreamWatcherIdsByStreamer = Record<string, string[]>;
export type StreamWatchersByStreamer = Record<string, StreamWatcherIdentity[]>;
export type PendingStreamWatchIntents = Record<string, boolean>;

export function applyStreamWatcherSnapshot(
  _current: StreamWatcherIdsByStreamer,
  snapshot: StreamWatchSnapshotPayload,
): StreamWatcherIdsByStreamer {
  const next: StreamWatcherIdsByStreamer = {};

  for (const [streamerUserId, viewerIds] of Object.entries(snapshot.watchers_by_streamer ?? {})) {
    const deduped = Array.from(new Set(viewerIds.filter((viewerId) => typeof viewerId === "string" && viewerId.length > 0)));
    if (deduped.length > 0) {
      next[streamerUserId] = deduped;
    }
  }

  return next;
}

export function getStreamWatcherActivitySound(
  previous: StreamWatcherIdsByStreamer,
  next: StreamWatcherIdsByStreamer,
  streamerUserId: string | null | undefined,
): "start" | "stop" | null {
  if (!streamerUserId) return null;

  const previousViewers = new Set(previous[streamerUserId] ?? []);
  const nextViewers = new Set(next[streamerUserId] ?? []);

  for (const viewerId of nextViewers) {
    if (!previousViewers.has(viewerId)) return "start";
  }

  for (const viewerId of previousViewers) {
    if (!nextViewers.has(viewerId)) return "stop";
  }

  return null;
}

export function buildWatchedStreamsForLocalViewer(
  watcherIdsByStreamer: StreamWatcherIdsByStreamer,
  localWatcherUserId: string | null | undefined,
): Record<string, boolean> {
  if (!localWatcherUserId) return {};

  const nextWatchedStreams: Record<string, boolean> = {};
  for (const [streamerUserId, viewerIds] of Object.entries(watcherIdsByStreamer)) {
    if (viewerIds.includes(localWatcherUserId)) {
      nextWatchedStreams[streamerUserId] = true;
    }
  }

  return nextWatchedStreams;
}

export function resolveWatchedStreamsWithPendingIntents(
  watcherIdsByStreamer: StreamWatcherIdsByStreamer,
  localWatcherUserId: string | null | undefined,
  pendingIntents: PendingStreamWatchIntents,
): {
  watchedStreams: Record<string, boolean>;
  pendingIntents: PendingStreamWatchIntents;
} {
  const authoritative = buildWatchedStreamsForLocalViewer(watcherIdsByStreamer, localWatcherUserId);
  const mergedWatchedStreams = { ...authoritative };
  const nextPendingIntents: PendingStreamWatchIntents = {};

  for (const [streamerUserId, desiredWatching] of Object.entries(pendingIntents)) {
    const authoritativeWatching = !!authoritative[streamerUserId];
    if (authoritativeWatching === desiredWatching) {
      continue;
    }

    nextPendingIntents[streamerUserId] = desiredWatching;
    if (desiredWatching) {
      mergedWatchedStreams[streamerUserId] = true;
    } else {
      delete mergedWatchedStreams[streamerUserId];
    }
  }

  return {
    watchedStreams: mergedWatchedStreams,
    pendingIntents: nextPendingIntents,
  };
}

export function buildStreamWatcherIdentities(
  watcherIdsByStreamer: StreamWatcherIdsByStreamer,
  gridItems: GridItem[],
  localUserId?: string | null,
): StreamWatchersByStreamer {
  const identitiesByUserId = new Map<string, StreamWatcherIdentity>();

  for (const item of gridItems) {
    if (identitiesByUserId.has(item.userId) && item.type === "screen") continue;
    identitiesByUserId.set(item.userId, {
      userId: item.userId,
      name: localUserId && item.userId === localUserId ? "You" : item.name.replace(/'s Stream$/, ""),
      avatar: item.avatar ?? null,
      isLocal: !!localUserId && item.userId === localUserId,
    });
  }

  const next: StreamWatchersByStreamer = {};

  for (const [streamerUserId, watcherIds] of Object.entries(watcherIdsByStreamer)) {
    const watchers = watcherIds
      .map((watcherUserId) => identitiesByUserId.get(watcherUserId) ?? {
        userId: watcherUserId,
        name: localUserId && watcherUserId === localUserId ? "You" : watcherUserId,
        avatar: null,
        isLocal: !!localUserId && watcherUserId === localUserId,
      })
      .filter((watcher, index, list) => list.findIndex((candidate) => candidate.userId === watcher.userId) === index);

    if (watchers.length > 0) {
      next[streamerUserId] = watchers;
    }
  }

  return next;
}

export function isStreamWatcherSnapshotPayload(value: unknown): value is StreamWatchSnapshotPayload {
  return !!value
    && typeof value === "object"
    && "type" in value
    && (value as { type?: unknown }).type === "stream.watch.snapshot"
    && "watchers_by_streamer" in value
    && typeof (value as { watchers_by_streamer?: unknown }).watchers_by_streamer === "object";
}
