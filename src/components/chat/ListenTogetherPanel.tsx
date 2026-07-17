import { AvatarImage } from "@/components/chat/AvatarImage";
import { apiGet, apiPost } from "@/lib/api-client";
import { clog } from "@/lib/console-logger";
import {
  convertSearchTrackToMusicTrack,
  getListenTogetherInputMode,
  type ListenTogetherEnqueueMode,
  type ListenTogetherResolveResponse,
  type ListenTogetherSearchFilter,
  type ListenTogetherSearchResponse,
  type ListenTogetherSearchResult,
  type ListenTogetherTrack,
} from "@/lib/listen-together";
import type { SFUClient } from "@/lib/sfu-client";
import { getAuthAssetUrl } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chat-store";
import { ListenTogetherNowPlayingCard } from "./ListenTogetherNowPlayingCard";
import {
  formatListenTogetherDuration,
  useListenTogetherPlaybackState,
} from "./listen-together-playback";
import {
  Headphones,
  Link2,
  ListMusic,
  Loader2,
  Play,
  Search,
  Trash2,
} from "lucide-react";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const listenTogetherLog = clog("ListenTogether");

interface ListenTogetherPanelProps {
  sfu: SFUClient | null;
  roomSlug?: string | null;
  voiceSessionId?: string | null;
  serverId?: string | null;
  channelId?: string | null;
  localUserId?: string | null;
}

function buildResolveFeedback(resolvedCount: number, skippedCount: number) {
  const resolvedLabel = resolvedCount === 1 ? "track" : "tracks";
  if (skippedCount <= 0) {
    return `Queued ${resolvedCount} ${resolvedLabel}.`;
  }
  return `Queued ${resolvedCount} ${resolvedLabel}, skipped ${skippedCount}.`;
}

export function ListenTogetherPanel({
  sfu,
  roomSlug,
  voiceSessionId,
  serverId,
  channelId,
  localUserId,
}: ListenTogetherPanelProps) {
  const playback = useListenTogetherPlaybackState(roomSlug);
  const { error, snapshot } = playback;
  const currentUser = useChatStore((state) => state.user);
  const searchRequestIdRef = useRef(0);

  const [inputValue, setInputValue] = useState("");
  const [searchFilter, setSearchFilter] =
    useState<ListenTogetherSearchFilter>("track");
  const [searchResults, setSearchResults] = useState<
    ListenTogetherSearchResult[]
  >([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isResolving, setIsResolving] = useState(false);
  const [resolveFeedback, setResolveFeedback] = useState<string | null>(null);

  const trimmedInput = inputValue.trim();
  const inputMode = useMemo(
    () => getListenTogetherInputMode(trimmedInput),
    [trimmedInput],
  );
  const deferredSearchQuery = useDeferredValue(
    inputMode === "search" ? trimmedInput : "",
  );

  const voiceSessionHeaders = useMemo(
    () =>
      voiceSessionId ? { "X-Voice-Session-Id": voiceSessionId } : undefined,
    [voiceSessionId],
  );

  const requester = useMemo(
    () => ({
      userId: localUserId || currentUser?.id || "guest",
      displayName:
        currentUser?.display_name?.trim() || currentUser?.username || "You",
      avatarUrl: currentUser?.avatar_url ?? null,
      avatarDisplay: currentUser?.avatar_display ?? null,
    }),
    [
      currentUser?.avatar_display,
      currentUser?.avatar_url,
      currentUser?.display_name,
      currentUser?.id,
      currentUser?.username,
      localUserId,
    ],
  );

  useEffect(() => {
    if (!sfu || !roomSlug) return;
    sfu.voiceGW.sendAppEvent({
      type: "listen_together.state.request",
      room_slug: roomSlug,
    });
  }, [roomSlug, sfu]);

  const runSearch = useCallback(
    async (query: string, signal?: AbortSignal) => {
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
    },
    [channelId, roomSlug, searchFilter, serverId, voiceSessionHeaders],
  );

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
  }, [deferredSearchQuery, roomSlug, runSearch, voiceSessionHeaders]);

  const sendCommand = (payload: Record<string, unknown>) => {
    if (!sfu || !roomSlug) return;
    listenTogetherLog.info("Sending listen together control", {
      source: "listen-together-panel",
      type: payload.type,
      roomSlug,
      paused: payload.paused ?? null,
      entryId: payload.entryId ?? null,
    });
    sfu.resumeAudioContext?.();
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
      let offset = 0;
      let resolvedCount = 0;
      let skippedCount = 0;
      let importBatchId: string | null = null;
      let importBatchLabel: string | null = null;
      let queuedAnyTrack = false;

      while (true) {
        const response = await apiPost<
          ListenTogetherResolveResponse,
          {
            roomSlug: string;
            serverId?: string | null;
            channelId?: string | null;
            url: string;
            offset: number;
          }
        >(
          "/api/listen-together/resolve",
          {
            roomSlug,
            serverId,
            channelId,
            url: sourceUrl,
            offset,
          },
          {
            headers: voiceSessionHeaders,
          },
        );

        if (response.kind === "collection" && !importBatchId) {
          importBatchId = crypto.randomUUID();
          importBatchLabel = response.collection?.title ?? null;
        }

        if (response.tracks.length > 0) {
          enqueueTracks(response.tracks, "append", {
            importBatchId,
            importBatchLabel,
          });
          queuedAnyTrack = true;
        }

        resolvedCount += response.resolvedCount;
        skippedCount += response.skippedCount;

        const nextOffset = response.nextOffset ?? null;
        if (response.kind !== "collection" || nextOffset === null) break;
        if (nextOffset <= offset) {
          throw new Error("Resolver returned an invalid collection cursor.");
        }
        offset = nextOffset;
      }

      if (!queuedAnyTrack) {
        setResolveFeedback("No playable tracks were resolved from that link.");
        return;
      }

      setResolveFeedback(buildResolveFeedback(resolvedCount, skippedCount));
      setInputValue("");
    } catch (resolveError) {
      setResolveFeedback(
        resolveError instanceof Error
          ? resolveError.message
          : "Could not resolve that link.",
      );
    } finally {
      setIsResolving(false);
    }
  };

  const isResolveMode = inputMode === "resolve";

  return (
    <div className="grid h-full min-h-0 gap-4 overflow-hidden p-4 lg:grid-cols-[minmax(300px,0.82fr)_minmax(0,1.18fr)]">
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
                disabled={
                  !trimmedInput ||
                  !voiceSessionHeaders ||
                  (isResolveMode ? isResolving : false)
                }
                className="inline-flex h-11 items-center justify-center rounded-2xl border border-primary/30 bg-primary/15 px-4 text-sm font-black text-primary transition hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isResolveMode ? (
                  isResolving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Resolve & Queue"
                  )
                ) : isSearching ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Search"
                )}
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
                      <div className="truncate text-sm font-bold text-rm-text">
                        {result.title}
                      </div>
                      <div className="mt-1 truncate text-xs text-rm-text-muted">
                        {isTrack
                          ? [
                              result.artist,
                              formatListenTogetherDuration(result.durationMs),
                            ]
                              .filter(Boolean)
                              .join(" • ")
                          : [result.subtitle, `${result.itemCount} items`]
                              .filter(Boolean)
                              .join(" • ")}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {isTrack ? (
                          <>
                            <button
                              type="button"
                              onClick={() =>
                                enqueueTracks(
                                  [convertSearchTrackToMusicTrack(result)],
                                  "play-next",
                                )
                              }
                              className="rounded-full border border-primary/30 bg-primary/15 px-3 py-1.5 text-xs font-bold text-primary transition hover:bg-primary/20"
                            >
                              Play Next
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                enqueueTracks(
                                  [convertSearchTrackToMusicTrack(result)],
                                  "append",
                                )
                              }
                              className="rounded-full border border-rm-border bg-rm-bg-elevated/60 px-3 py-1.5 text-xs font-bold text-rm-text transition hover:bg-rm-bg-active"
                            >
                              Queue
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() =>
                              void resolveAndQueue(result.sourceUrl)
                            }
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

      <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-t border-rm-border pt-4 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
        <div className="shrink-0 border-b border-rm-border pb-4">
          <div className="mb-3 flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.18em] text-rm-text-muted">
            <Headphones className="h-4 w-4 text-primary" />
            Now Playing
          </div>
          <ListenTogetherNowPlayingCard
            playback={playback}
            sfu={sfu}
            roomSlug={roomSlug}
            variant="panel"
          />
        </div>

        <div className="flex min-h-[320px] min-w-0 flex-1 flex-col pt-4">
          <div className="flex shrink-0 items-center justify-between gap-3 pb-3">
            <div className="flex min-w-0 items-center gap-2 text-[11px] font-black uppercase tracking-[0.18em] text-rm-text-muted">
              <ListMusic className="h-4 w-4 text-primary" />
              <span>Room Queue</span>
            </div>
            <span className="shrink-0 text-xs tabular-nums text-rm-text-muted">
              {snapshot?.queue?.length ?? 0} tracks
            </span>
          </div>
          <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto pr-1">
            {snapshot?.queue?.length ? (
              <div className="divide-y divide-rm-border/70">
                {snapshot.queue.map((entry, index) => {
                  const isCurrent = entry.entryId === snapshot.currentEntryId;
                  return (
                    <div
                      key={entry.entryId}
                      className={cn(
                        "grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-3 px-2 py-3 transition-colors",
                        isCurrent
                          ? "rounded-xl bg-primary/10"
                          : "hover:bg-rm-bg-hover/45",
                      )}
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center text-xs font-black tabular-nums text-rm-text-muted">
                        {isCurrent ? (
                          <span className="h-2 w-2 rounded-full bg-primary" />
                        ) : (
                          index + 1
                        )}
                      </div>
                      <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-rm-bg-elevated/60">
                        {entry.track.artworkUrl ? (
                          <img
                            src={entry.track.artworkUrl}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-rm-text-muted">
                            <Headphones className="h-4 w-4" />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-bold text-rm-text">
                          {entry.track.title}
                        </div>
                        <div className="mt-1 flex min-w-0 items-center gap-2 truncate text-xs text-rm-text-muted">
                          <span className="truncate">
                            {entry.track.artist || entry.track.sourceLabel}
                          </span>
                          <span aria-hidden="true">•</span>
                          <span className="shrink-0">
                            {entry.track.sourceLabel}
                          </span>
                          {entry.track.kind === "music" && (
                            <>
                              <span aria-hidden="true">•</span>
                              <span className="shrink-0 tabular-nums">
                                {formatListenTogetherDuration(
                                  entry.track.durationMs,
                                )}
                              </span>
                            </>
                          )}
                        </div>
                        <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-rm-text-muted/75">
                          <div className="h-4 w-4 shrink-0 overflow-hidden rounded-full bg-rm-bg-hover">
                            {entry.requester.avatarUrl ? (
                              <AvatarImage
                                src={getAuthAssetUrl(entry.requester.avatarUrl)}
                                alt={`${entry.requester.displayName} avatar`}
                                display={entry.requester.avatarDisplay}
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-[8px] font-black text-rm-text-muted">
                                {entry.requester.displayName
                                  .charAt(0)
                                  .toUpperCase()}
                              </div>
                            )}
                          </div>
                          <span className="truncate">
                            {entry.requester.displayName}
                          </span>
                          {entry.importBatchLabel && (
                            <>
                              <span aria-hidden="true">•</span>
                              <span className="truncate">
                                {entry.importBatchLabel}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-1">
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
                            className="rounded-lg p-2 text-rm-text-muted transition hover:bg-rm-bg-active hover:text-rm-text"
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
                          className="rounded-lg p-2 text-rm-text-muted transition hover:bg-red-500/10 hover:text-red-300"
                          aria-label={`Remove ${entry.track.title}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
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
