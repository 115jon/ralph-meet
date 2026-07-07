import { AvatarImage } from "@/components/chat/AvatarImage";
import { apiGet, apiPost } from "@/lib/api-client";
import {
  clampListenTogetherPosition,
  getListenTogetherInputMode,
  type ListenTogetherEnqueueMode,
  type ListenTogetherResolveResponse,
  type ListenTogetherSearchFilter,
  type ListenTogetherSearchResponse,
  type ListenTogetherSearchResult,
  type ListenTogetherTrack,
} from "@/lib/listen-together";
import { getAuthAssetUrl } from "@/lib/platform";
import type { SFUClient } from "@/lib/sfu-client";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chat-store";
import { useListenTogetherStore } from "@/stores/useListenTogetherStore";
import {
  ChevronRight,
  Headphones,
  Link2,
  Loader2,
  Pause,
  Play,
  Search,
  Trash2,
} from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

interface ListenTogetherPanelProps {
  sfu: SFUClient | null;
  roomSlug?: string | null;
  voiceSessionId?: string | null;
  serverId?: string | null;
  channelId?: string | null;
  localUserId?: string | null;
}

function formatDuration(durationMs?: number | null) {
  if (!durationMs || durationMs <= 0) return "--:--";
  const totalSeconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function buildResolveFeedback(response: ListenTogetherResolveResponse) {
  const resolvedLabel = response.resolvedCount === 1 ? "track" : "tracks";
  if (response.skippedCount <= 0) {
    return `Queued ${response.resolvedCount} ${resolvedLabel}.`;
  }
  return `Queued ${response.resolvedCount} ${resolvedLabel}, skipped ${response.skippedCount}.`;
}

export function ListenTogetherPanel({
  sfu,
  roomSlug,
  voiceSessionId,
  serverId,
  channelId,
  localUserId,
}: ListenTogetherPanelProps) {
  const snapshot = useListenTogetherStore((state) =>
    roomSlug ? state.rooms[roomSlug]?.snapshot ?? null : null,
  );
  const localVolume = useListenTogetherStore((state) =>
    roomSlug ? state.rooms[roomSlug]?.localVolume ?? 1 : 1,
  );
  const error = useListenTogetherStore((state) =>
    roomSlug ? state.rooms[roomSlug]?.error ?? null : null,
  );
  const setLocalVolume = useListenTogetherStore((state) => state.setLocalVolume);
  const currentUser = useChatStore((state) => state.user);
  const searchRequestIdRef = useRef(0);

  const [inputValue, setInputValue] = useState("");
  const [searchFilter, setSearchFilter] = useState<ListenTogetherSearchFilter>("track");
  const [searchResults, setSearchResults] = useState<ListenTogetherSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isResolving, setIsResolving] = useState(false);
  const [resolveFeedback, setResolveFeedback] = useState<string | null>(null);
  const [snapshotReceivedAtMs, setSnapshotReceivedAtMs] = useState(() => Date.now());
  const [playbackNowMs, setPlaybackNowMs] = useState(() => Date.now());

  const trimmedInput = inputValue.trim();
  const inputMode = useMemo(
    () => getListenTogetherInputMode(trimmedInput),
    [trimmedInput],
  );
  const deferredSearchQuery = useDeferredValue(inputMode === "search" ? trimmedInput : "");

  const voiceSessionHeaders = useMemo(
    () => (voiceSessionId ? { "X-Voice-Session-Id": voiceSessionId } : undefined),
    [voiceSessionId],
  );

  const requester = useMemo(
    () => ({
      userId: localUserId || currentUser?.id || "guest",
      displayName:
        currentUser?.display_name?.trim()
        || currentUser?.username
        || "You",
      avatarUrl: currentUser?.avatar_url ?? null,
      avatarDisplay: currentUser?.avatar_display ?? null,
    }),
    [currentUser?.avatar_display, currentUser?.avatar_url, currentUser?.display_name, currentUser?.id, currentUser?.username, localUserId],
  );

  useEffect(() => {
    if (!sfu || !roomSlug) return;
    sfu.voiceGW.sendAppEvent({
      type: "listen_together.state.request",
      room_slug: roomSlug,
    });
  }, [roomSlug, sfu]);

  useEffect(() => {
    setSnapshotReceivedAtMs(Date.now());
    setPlaybackNowMs(Date.now());
  }, [snapshot]);

  useEffect(() => {
    if (!snapshot?.currentEntry || snapshot.paused) return;

    const interval = window.setInterval(() => {
      setPlaybackNowMs(Date.now());
    }, 250);

    return () => {
      window.clearInterval(interval);
    };
  }, [snapshot?.currentEntry, snapshot?.paused]);

  const runSearch = async (query: string, signal?: AbortSignal) => {
    if (!roomSlug || !voiceSessionHeaders || !query) {
      if (!signal?.aborted) {
        setSearchResults([]);
        setIsSearching(false);
      }
      return;
    }

    const requestId = ++searchRequestIdRef.current;
    setIsSearching(true);

    const params = new URLSearchParams({
      q: query,
      filter: searchFilter,
      roomSlug,
    });
    if (serverId) params.set("serverId", serverId);
    if (channelId) params.set("channelId", channelId);

    try {
      const response = await apiGet<ListenTogetherSearchResponse>(
        `/api/listen-together/search?${params.toString()}`,
        {
          signal,
          headers: voiceSessionHeaders,
        },
      );

      if (!signal?.aborted && requestId === searchRequestIdRef.current) {
        setSearchResults(response.results ?? []);
      }
    } catch (fetchError) {
      if (!signal?.aborted && requestId === searchRequestIdRef.current) {
        console.error("Listen Together search failed", fetchError);
        setSearchResults([]);
      }
    } finally {
      if (!signal?.aborted && requestId === searchRequestIdRef.current) {
        setIsSearching(false);
      }
    }
  };

  useEffect(() => {
    if (!roomSlug || !voiceSessionHeaders) {
      searchRequestIdRef.current += 1;
      setSearchResults([]);
      setResolveFeedback(null);
      return;
    }

    if (!deferredSearchQuery) {
      searchRequestIdRef.current += 1;
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    const controller = new AbortController();

    const timer = window.setTimeout(() => {
      void runSearch(deferredSearchQuery, controller.signal);
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [deferredSearchQuery, roomSlug, searchFilter, voiceSessionHeaders, serverId, channelId]);

  const sendCommand = (payload: Record<string, unknown>) => {
    if (!sfu || !roomSlug) return;
    sfu.voiceGW.sendAppEvent(payload);
  };

  const enqueueTracks = (
    tracks: ListenTogetherTrack[],
    mode: ListenTogetherEnqueueMode,
    options?: {
      importBatchLabel?: string | null;
      importBatchId?: string | null;
    },
  ) => {
    if (!roomSlug || !sfu || tracks.length === 0) return;
    sendCommand({
      type: "listen_together.enqueue",
      room_slug: roomSlug,
      mode,
      entries: tracks.map((track) => ({
        track,
        requester,
        importBatchId: options?.importBatchId ?? null,
        importBatchLabel: options?.importBatchLabel ?? null,
      })),
    });
  };

  const resolveAndQueue = async (sourceUrl: string) => {
    if (!roomSlug || !voiceSessionHeaders) return;
    setIsResolving(true);
    setResolveFeedback(null);

    try {
      const response = await apiPost<ListenTogetherResolveResponse, {
        roomSlug: string;
        serverId?: string | null;
        channelId?: string | null;
        url: string;
      }>(
        "/api/listen-together/resolve",
        {
          roomSlug,
          serverId,
          channelId,
          url: sourceUrl,
        },
        {
          headers: voiceSessionHeaders,
        },
      );

      if (response.tracks.length === 0) {
        setResolveFeedback("No playable tracks were resolved from that link.");
        return;
      }

      const importBatchId = response.kind === "collection" ? crypto.randomUUID() : null;
      enqueueTracks(response.tracks, "append", {
        importBatchId,
        importBatchLabel: response.collection?.title ?? null,
      });
      setResolveFeedback(buildResolveFeedback(response));
      setInputValue("");
    } catch (resolveError) {
      setResolveFeedback(resolveError instanceof Error ? resolveError.message : "Could not resolve that link.");
    } finally {
      setIsResolving(false);
    }
  };

  const currentEntry = snapshot?.currentEntry ?? null;
  const durationMs = snapshot?.durationMs ?? currentEntry?.track.durationMs ?? 0;
  const effectiveSeekValue = snapshot
    ? clampListenTogetherPosition(
      snapshot.positionMs + (snapshot.paused ? 0 : Math.max(0, playbackNowMs - snapshotReceivedAtMs)),
      durationMs,
    )
    : 0;
  const progressMax = Math.max(1, durationMs);
  const isResolveMode = inputMode === "resolve";

  return (
    <div className="grid h-full min-h-0 overflow-hidden gap-4 p-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
      <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[24px] border border-rm-border bg-rm-bg-surface/40">
        <div className="border-b border-rm-border px-4 py-4">
          <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.18em] text-rm-text-muted">
            <Headphones className="h-4 w-4 text-primary" />
            Listen Together
          </div>
          <div className="mt-3 flex flex-col gap-3">
            <form
              className="flex flex-col gap-2 sm:flex-row"
              onSubmit={(event) => {
                event.preventDefault();
                if (!trimmedInput || !voiceSessionHeaders) return;
                if (isResolveMode) {
                  if (!isResolving) {
                    void resolveAndQueue(trimmedInput);
                  }
                  return;
                }

                void runSearch(trimmedInput);
              }}
            >
              <div className="relative flex-1">
                {isResolveMode ? (
                  <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-rm-text-muted" />
                ) : (
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-rm-text-muted" />
                )}
                <input
                  type="text"
                  value={inputValue}
                  onChange={(event) => {
                    setInputValue(event.target.value);
                    setResolveFeedback(null);
                  }}
                  placeholder="Search or paste YouTube / Spotify links"
                  className="h-11 w-full rounded-2xl border border-rm-border bg-rm-bg-elevated/40 pl-10 pr-4 text-sm text-rm-text outline-none transition placeholder:text-rm-text-muted focus:border-primary/60"
                />
              </div>
              <button
                type="submit"
                disabled={!trimmedInput || !voiceSessionHeaders || (isResolveMode ? isResolving : false)}
                className="inline-flex h-11 items-center justify-center rounded-2xl border border-primary/30 bg-primary/15 px-4 text-sm font-black text-primary transition hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isResolveMode
                  ? isResolving
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : "Resolve & Queue"
                  : isSearching
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : "Search"}
              </button>
            </form>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setSearchFilter("track")}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs font-bold transition-colors",
                  searchFilter === "track"
                    ? "border-primary/40 bg-primary/20 text-primary"
                    : "border-rm-border bg-rm-bg-hover text-rm-text-muted hover:text-rm-text",
                )}
              >
                Tracks
              </button>
              <button
                type="button"
                onClick={() => setSearchFilter("collection")}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs font-bold transition-colors",
                  searchFilter === "collection"
                    ? "border-primary/40 bg-primary/20 text-primary"
                    : "border-rm-border bg-rm-bg-hover text-rm-text-muted hover:text-rm-text",
                )}
              >
                Collections
              </button>
            </div>
            {resolveFeedback && (
              <div className="rounded-2xl border border-rm-border bg-rm-bg-hover px-3 py-2 text-xs text-rm-text-muted">
                {resolveFeedback}
              </div>
            )}
            {error && (
              <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {error.message}
              </div>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {isSearching ? (
            <div className="flex items-center justify-center py-12 text-rm-text-muted">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : searchResults.length === 0 ? (
            <div className="rounded-[22px] border border-dashed border-rm-border bg-rm-bg-hover/30 px-4 py-10 text-center text-sm text-rm-text-muted">
              {deferredSearchQuery
                ? "No results yet for that search."
                : "Search tracks or collections, or paste a YouTube or Spotify link to queue music together."}
            </div>
          ) : (
            <div className="space-y-3">
              {searchResults.map((result) => {
                const isTrack = result.kind === "track";
                return (
                  <div
                    key={result.id}
                    className="flex gap-3 rounded-[22px] border border-rm-border bg-rm-bg-hover/40 p-3"
                  >
                    <div className="h-14 w-14 shrink-0 overflow-hidden rounded-2xl bg-rm-bg-elevated/60">
                      {result.artworkUrl ? (
                        <img
                          src={result.artworkUrl}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-rm-text-muted">
                          <Headphones className="h-5 w-5" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-bold text-rm-text">{result.title}</div>
                      <div className="mt-1 truncate text-xs text-rm-text-muted">
                        {isTrack
                          ? [result.artist, formatDuration(result.durationMs)].filter(Boolean).join(" • ")
                          : [result.subtitle, `${result.itemCount} items`].filter(Boolean).join(" • ")}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {isTrack ? (
                          <>
                            <button
                              type="button"
                              onClick={() => enqueueTracks([result], "play-next")}
                              className="rounded-full border border-primary/30 bg-primary/15 px-3 py-1.5 text-xs font-bold text-primary transition hover:bg-primary/20"
                            >
                              Play Next
                            </button>
                            <button
                              type="button"
                              onClick={() => enqueueTracks([result], "append")}
                              className="rounded-full border border-rm-border bg-rm-bg-elevated/60 px-3 py-1.5 text-xs font-bold text-rm-text transition hover:bg-rm-bg-active"
                            >
                              Queue
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void resolveAndQueue(result.sourceUrl)}
                            className="rounded-full border border-primary/30 bg-primary/15 px-3 py-1.5 text-xs font-bold text-primary transition hover:bg-primary/20"
                          >
                            Queue Collection
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <section className="flex min-h-0 min-w-0 flex-col gap-4 overflow-hidden">
        <div className="min-w-0 rounded-[24px] border border-rm-border bg-rm-bg-surface/40">
          <div className="border-b border-rm-border px-4 py-3 text-[11px] font-black uppercase tracking-[0.18em] text-rm-text-muted">
            Now Playing
          </div>
          <div className="p-4">
            {currentEntry ? (
              <div className="space-y-4">
                <div className="flex gap-3">
                  <div className="h-16 w-16 shrink-0 overflow-hidden rounded-[20px] bg-rm-bg-elevated/60">
                    {currentEntry.track.artworkUrl ? (
                      <img src={currentEntry.track.artworkUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-rm-text-muted">
                        <Headphones className="h-5 w-5" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-base font-black text-rm-text">{currentEntry.track.title}</div>
                    <div className="mt-1 truncate text-sm text-rm-text-muted">
                      {[currentEntry.track.artist, currentEntry.track.album].filter(Boolean).join(" • ") || currentEntry.track.sourceLabel}
                    </div>
                    <div className="mt-3 flex items-center gap-2 text-xs text-rm-text-muted">
                      <div className="h-6 w-6 overflow-hidden rounded-full bg-rm-bg-hover">
                        {currentEntry.requester.avatarUrl ? (
                          <AvatarImage
                            src={getAuthAssetUrl(currentEntry.requester.avatarUrl)}
                            alt=""
                            display={currentEntry.requester.avatarDisplay}
                          />
                        ) : null}
                      </div>
                      <span className="truncate">Requested by {currentEntry.requester.displayName}</span>
                    </div>
                  </div>
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between text-xs text-rm-text-muted">
                    <span>{formatDuration(effectiveSeekValue)}</span>
                    <span>{formatDuration(durationMs)}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={progressMax}
                    value={Math.min(effectiveSeekValue, progressMax)}
                    onChange={(event) => {
                      if (!roomSlug) return;
                      sendCommand({
                        type: "listen_together.seek",
                        room_slug: roomSlug,
                        positionMs: Number(event.currentTarget.value),
                      });
                    }}
                    className="h-1.5 w-full cursor-pointer accent-primary"
                  />
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (!roomSlug) return;
                      sendCommand({
                        type: "listen_together.pause",
                        room_slug: roomSlug,
                        paused: !snapshot?.paused,
                      });
                    }}
                    className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/15 px-3 py-2 text-xs font-bold text-primary transition hover:bg-primary/20"
                  >
                    {snapshot?.paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                    {snapshot?.paused ? "Resume" : "Pause"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!roomSlug) return;
                      sendCommand({
                        type: "listen_together.skip",
                        room_slug: roomSlug,
                      });
                    }}
                    className="inline-flex items-center gap-2 rounded-full border border-rm-border bg-rm-bg-elevated/60 px-3 py-2 text-xs font-bold text-rm-text transition hover:bg-rm-bg-active"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                    Skip
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!roomSlug || !currentEntry) return;
                      sendCommand({
                        type: "listen_together.remove",
                        room_slug: roomSlug,
                        entryId: currentEntry.entryId,
                      });
                    }}
                    className="inline-flex items-center gap-2 rounded-full border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs font-bold text-red-300 transition hover:bg-red-500/15"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Remove
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!roomSlug) return;
                      sendCommand({
                        type: "listen_together.clear",
                        room_slug: roomSlug,
                      });
                    }}
                    className="inline-flex items-center gap-2 rounded-full border border-rm-border bg-rm-bg-hover px-3 py-2 text-xs font-bold text-rm-text-muted transition hover:text-rm-text"
                  >
                    Clear Queue
                  </button>
                </div>

                <label className="block rounded-[20px] border border-rm-border bg-rm-bg-hover/40 px-3 py-3">
                  <div className="mb-2 flex items-center justify-between text-[11px] font-black uppercase tracking-[0.16em] text-rm-text-muted">
                    <span>Your Volume</span>
                    <span>{Math.round(localVolume * 100)}%</span>
                  </div>
                  <div className="mb-2 text-[11px] text-rm-text-muted/80">
                    Local only. This changes how you hear the shared player.
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(localVolume * 100)}
                    onChange={(event) => {
                      if (!roomSlug) return;
                      setLocalVolume(roomSlug, Number(event.currentTarget.value) / 100);
                    }}
                    className="h-1.5 w-full cursor-pointer accent-primary"
                  />
                </label>
              </div>
            ) : (
              <div className="rounded-[22px] border border-dashed border-rm-border bg-rm-bg-hover/30 px-4 py-10 text-center text-sm text-rm-text-muted">
                Queue a track to start listening together.
              </div>
            )}
          </div>
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col rounded-[24px] border border-rm-border bg-rm-bg-surface/40">
          <div className="border-b border-rm-border px-4 py-3 text-[11px] font-black uppercase tracking-[0.18em] text-rm-text-muted">
            Room Queue
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {snapshot?.queue?.length ? (
              <div className="space-y-3">
                {snapshot.queue.map((entry, index) => {
                  const isCurrent = entry.entryId === snapshot.currentEntryId;
                  return (
                    <div
                      key={entry.entryId}
                      className={cn(
                        "rounded-[22px] border p-3 transition-colors",
                        isCurrent
                          ? "border-primary/30 bg-primary/10"
                          : "border-rm-border bg-rm-bg-hover/40",
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-rm-bg-elevated/70 text-xs font-black text-rm-text-muted">
                          {index + 1}
                        </div>
                        <div className="h-12 w-12 shrink-0 overflow-hidden rounded-[16px] bg-rm-bg-elevated/60">
                          {entry.track.artworkUrl ? (
                            <img src={entry.track.artworkUrl} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-rm-text-muted">
                              <Headphones className="h-4 w-4" />
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-bold text-rm-text">{entry.track.title}</div>
                          <div className="hidden">
                            {[entry.track.artist, entry.requester.displayName].filter(Boolean).join(" • ")}
                          </div>
                          <div className="mt-1 truncate text-xs text-rm-text-muted">
                            {[entry.track.artist, formatDuration(entry.track.durationMs)].filter(Boolean).join(" • ")
                              || entry.track.sourceLabel}
                          </div>
                          <div className="hidden">
                            <span className="rounded-full border border-rm-border bg-rm-bg-elevated/40 px-2 py-1">
                              {entry.track.sourceLabel}
                            </span>
                            <span className="rounded-full border border-rm-border bg-rm-bg-elevated/40 px-2 py-1">
                              {formatDuration(entry.track.durationMs)}
                            </span>
                            {entry.importBatchLabel && (
                              <span className="rounded-full border border-rm-border bg-rm-bg-elevated/40 px-2 py-1">
                                {entry.importBatchLabel}
                              </span>
                            )}
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-semibold text-rm-text-muted">
                            <div className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-rm-border bg-rm-bg-elevated/40 px-1.5 py-1">
                              <div className="h-4 w-4 overflow-hidden rounded-full bg-rm-bg-hover">
                                {entry.requester.avatarUrl ? (
                                  <AvatarImage
                                    src={getAuthAssetUrl(entry.requester.avatarUrl)}
                                    alt=""
                                    display={entry.requester.avatarDisplay}
                                  />
                                ) : (
                                  <div className="flex h-full w-full items-center justify-center text-[9px] font-black text-rm-text-muted">
                                    {entry.requester.displayName.charAt(0).toUpperCase()}
                                  </div>
                                )}
                              </div>
                              <span className="max-w-[140px] truncate">{entry.requester.displayName}</span>
                            </div>
                            <span className="rounded-full border border-rm-border bg-rm-bg-elevated/40 px-2 py-1">
                              {entry.track.sourceLabel}
                            </span>
                            {entry.importBatchLabel && (
                              <span className="rounded-full border border-rm-border bg-rm-bg-elevated/40 px-2 py-1">
                                {entry.importBatchLabel}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex shrink-0 gap-2">
                          {!isCurrent && (
                            <button
                              type="button"
                              onClick={() => {
                                if (!roomSlug) return;
                                sendCommand({
                                  type: "listen_together.play",
                                  room_slug: roomSlug,
                                  entryId: entry.entryId,
                                });
                              }}
                              className="rounded-full border border-rm-border bg-rm-bg-elevated/60 p-2 text-rm-text-muted transition hover:text-rm-text"
                              aria-label={`Play ${entry.track.title}`}
                            >
                              <Play className="h-3.5 w-3.5" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              if (!roomSlug) return;
                              sendCommand({
                                type: "listen_together.remove",
                                room_slug: roomSlug,
                                entryId: entry.entryId,
                              });
                            }}
                            className="rounded-full border border-red-500/20 bg-red-500/10 p-2 text-red-300 transition hover:bg-red-500/15"
                            aria-label={`Remove ${entry.track.title}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-[22px] border border-dashed border-rm-border bg-rm-bg-hover/30 px-4 py-10 text-center text-sm text-rm-text-muted">
                Nothing is queued yet.
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
