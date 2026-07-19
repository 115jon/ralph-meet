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
import {
  addListenTogetherQueryHistory,
  clampListenTogetherPaneRatio,
  readListenTogetherQueryHistory,
  writeListenTogetherQueryHistory,
} from "@/lib/listen-together-local";
import { useChatStore } from "@/stores/chat-store";
import { useListenTogetherStore } from "@/stores/useListenTogetherStore";
import ContextMenu from "./ContextMenu";
import { ListenTogetherNowPlayingCard } from "./ListenTogetherNowPlayingCard";
import {
  getListenTogetherContextMenuItems,
  getListenTogetherResultActions,
  getListenTogetherResultUrl,
  type ListenTogetherResultActionId,
} from "./ListenTogetherResultActionModel";
import {
  ListenTogetherMobileActionSheet,
  ListenTogetherResultActionTrigger,
} from "./ListenTogetherResultActions";
import { useContextMenu } from "@/hooks/useContextMenu";
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

function getRequeueTrack(track: ListenTogetherTrack): ListenTogetherTrack {
  if (track.kind !== "radio") return track;
  return {
    ...track,
    station_uuid: track.station_uuid ?? track.id,
  };
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
  const resolveRequestIdRef = useRef(0);
  const queueRequestIdRef = useRef(0);
  const queueAbortControllerRef = useRef<AbortController | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const paneRatioRef = useRef(0.38);
  const { menu, openMenu, closeMenu, shouldRender, isClosing } =
    useContextMenu();
  const workspacePaneRatio = useListenTogetherStore(
    (state) => state.workspacePaneRatio,
  );
  const setWorkspacePaneRatio = useListenTogetherStore(
    (state) => state.setWorkspacePaneRatio,
  );
  const persistWorkspacePaneRatio = useListenTogetherStore(
    (state) => state.persistWorkspacePaneRatio,
  );

  const [inputValue, setInputValue] = useState("");
  const [searchFilter, setSearchFilter] =
    useState<ListenTogetherSearchFilter>("track");
  const [searchResults, setSearchResults] = useState<
    ListenTogetherSearchResult[]
  >([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isResolving, setIsResolving] = useState(false);
  const [resolveFeedback, setResolveFeedback] = useState<string | null>(null);
  const [resolvedPreview, setResolvedPreview] =
    useState<ListenTogetherResolveResponse | null>(null);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [queryHistory, setQueryHistory] = useState<string[]>(() =>
    readListenTogetherQueryHistory(),
  );
  const [activeRightTab, setActiveRightTab] = useState<
    "queue" | "recently-played"
  >("queue");
  const [mobileActionResult, setMobileActionResult] =
    useState<ListenTogetherSearchResult | null>(null);
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(min-width: 1024px)").matches
      : false,
  );
  const [isPaneDragging, setIsPaneDragging] = useState(false);

  paneRatioRef.current = workspacePaneRatio;

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
    if (typeof window.matchMedia !== "function") return;
    const mediaQuery = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsDesktop(mediaQuery.matches);
    update();
    mediaQuery.addEventListener?.("change", update);
    return () => mediaQuery.removeEventListener?.("change", update);
  }, []);

  useEffect(() => {
    if (!isDesktop) return;
    setMobileActionResult(null);
  }, [isDesktop]);

  useEffect(() => {
    queueRequestIdRef.current += 1;
    queueAbortControllerRef.current?.abort();
    queueAbortControllerRef.current = null;
    setIsResolving(false);

    return () => {
      queueRequestIdRef.current += 1;
      queueAbortControllerRef.current?.abort();
      queueAbortControllerRef.current = null;
    };
  }, [roomSlug, voiceSessionHeaders]);

  useEffect(() => {
    if (!isPaneDragging) return;

    const handlePointerMove = (event: PointerEvent) => {
      const panel = panelRef.current;
      if (!panel || window.innerWidth < 1024) return;
      const bounds = panel.getBoundingClientRect();
      const nextRatio = clampListenTogetherPaneRatio(
        (event.clientX - bounds.left) / bounds.width,
      );
      paneRatioRef.current = nextRatio;
      setWorkspacePaneRatio(nextRatio);
    };
    const handlePointerUp = () => {
      setIsPaneDragging(false);
      persistWorkspacePaneRatio(paneRatioRef.current);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      persistWorkspacePaneRatio(paneRatioRef.current);
    };
  }, [isPaneDragging, persistWorkspacePaneRatio, setWorkspacePaneRatio]);

  useEffect(() => {
    if (!roomSlug) return;
    const handleShortcut = (event: KeyboardEvent) => {
      if (
        !(event.ctrlKey || event.metaKey) ||
        event.key.toLowerCase() !== "l"
      ) {
        return;
      }
      event.preventDefault();
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [roomSlug]);

  const recordSearchQuery = (query: string) => {
    const nextHistory = addListenTogetherQueryHistory(queryHistory, query);
    if (nextHistory.join("\u0000") === queryHistory.join("\u0000")) return;
    setQueryHistory(nextHistory);
    writeListenTogetherQueryHistory(nextHistory);
  };

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
      setResolvedPreview(null);
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

  const resolveUrl = useCallback(
    async (sourceUrl: string, signal?: AbortSignal) => {
      if (!roomSlug || !voiceSessionHeaders || !sourceUrl) return null;

      let offset = 0;
      let collection: ListenTogetherResolveResponse["collection"] = null;
      const tracksById = new Map<string, ListenTogetherTrack>();
      const skippedItems: ListenTogetherResolveResponse["skippedItems"] = [];
      let resolvedCount = 0;
      let skippedCount = 0;
      let kind: ListenTogetherResolveResponse["kind"] = "track";
      let totalCount: number | undefined;

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
            signal,
            headers: voiceSessionHeaders,
          },
        );

        kind = response.kind;
        collection ??= response.collection;
        for (const track of response.tracks) {
          tracksById.set(track.id, track);
        }
        skippedItems.push(...response.skippedItems);
        resolvedCount += response.resolvedCount;
        skippedCount += response.skippedCount;
        totalCount = response.totalCount ?? totalCount;

        const nextOffset = response.nextOffset ?? null;
        if (response.kind !== "collection" || nextOffset === null) break;
        if (nextOffset <= offset) {
          throw new Error("Resolver returned an invalid collection cursor.");
        }
        offset = nextOffset;
      }

      return {
        kind,
        tracks: [...tracksById.values()],
        collection,
        resolvedCount,
        skippedCount,
        skippedItems,
        nextOffset: null,
        totalCount,
      } satisfies ListenTogetherResolveResponse;
    },
    [channelId, roomSlug, serverId, voiceSessionHeaders],
  );

  const resolveUrlPreview = useCallback(
    async (sourceUrl: string, signal?: AbortSignal) => {
      if (!roomSlug || !voiceSessionHeaders || !sourceUrl) return;

      const requestId = ++resolveRequestIdRef.current;
      setIsResolving(true);
      setResolveFeedback(null);
      setResolvedPreview(null);

      try {
        const response = await resolveUrl(sourceUrl, signal);
        if (!response) return;

        if (signal?.aborted || requestId !== resolveRequestIdRef.current) {
          return;
        }

        if (response.tracks.length === 0) {
          setResolveFeedback(
            "No playable tracks were resolved from that link.",
          );
          return;
        }

        setResolvedPreview(response);
      } catch (resolveError) {
        if (!signal?.aborted && requestId === resolveRequestIdRef.current) {
          setResolveFeedback(
            resolveError instanceof Error
              ? resolveError.message
              : "Could not resolve that link.",
          );
        }
      } finally {
        if (!signal?.aborted && requestId === resolveRequestIdRef.current) {
          setIsResolving(false);
        }
      }
    },
    [resolveUrl, roomSlug, voiceSessionHeaders],
  );

  useEffect(() => {
    if (!roomSlug || !voiceSessionHeaders || inputMode !== "resolve") {
      resolveRequestIdRef.current += 1;
      setIsResolving(false);
      setResolvedPreview(null);
      return;
    }

    const controller = new AbortController();
    void resolveUrlPreview(trimmedInput, controller.signal);

    return () => {
      controller.abort();
    };
  }, [
    inputMode,
    resolveUrlPreview,
    roomSlug,
    trimmedInput,
    voiceSessionHeaders,
  ]);

  const sendCommand = (payload: Record<string, unknown>) => {
    if (!sfu || !roomSlug || sfu.voiceGW.isReady === false) {
      setResolveFeedback(
        "Connect to the voice room before changing the queue.",
      );
      return false;
    }
    listenTogetherLog.info("Sending listen together control", {
      source: "listen-together-panel",
      type: payload.type,
      roomSlug,
      paused: payload.paused ?? null,
      entryId: payload.entryId ?? null,
    });
    sfu.resumeAudioContext?.();
    sfu.voiceGW.sendAppEvent(payload);
    return true;
  };

  const enqueueTracks = (
    tracks: ListenTogetherTrack[],
    mode: ListenTogetherEnqueueMode,
    options?: {
      importBatchLabel?: string | null;
      importBatchId?: string | null;
    },
  ) => {
    if (tracks.length === 0) return false;
    if (!roomSlug || !sfu) {
      setResolveFeedback("Connect to the voice room before adding music.");
      return false;
    }
    return sendCommand({
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

  const queueResolvedPreview = () => {
    if (!resolvedPreview || resolvedPreview.tracks.length === 0) return;

    if (
      !enqueueTracks(resolvedPreview.tracks, "append", {
        importBatchId:
          resolvedPreview.kind === "collection" ? crypto.randomUUID() : null,
        importBatchLabel: resolvedPreview.collection?.title ?? null,
      })
    )
      return;
    setResolveFeedback(
      buildResolveFeedback(
        resolvedPreview.resolvedCount,
        resolvedPreview.skippedCount,
      ),
    );
    setResolvedPreview(null);
    setInputValue("");
  };

  const playResolvedPreview = () => {
    if (!resolvedPreview || resolvedPreview.tracks.length === 0) return;
    if (
      !enqueueTracks(resolvedPreview.tracks, "play-now", {
        importBatchId:
          resolvedPreview.kind === "collection" ? crypto.randomUUID() : null,
        importBatchLabel: resolvedPreview.collection?.title ?? null,
      })
    )
      return;
    setResolveFeedback(
      buildResolveFeedback(
        resolvedPreview.resolvedCount,
        resolvedPreview.skippedCount,
      ),
    );
    setResolvedPreview(null);
    setInputValue("");
  };

  const queueSourceUrl = async (sourceUrl: string) => {
    if (!roomSlug || !voiceSessionHeaders) return;

    queueRequestIdRef.current += 1;
    const requestId = queueRequestIdRef.current;
    queueAbortControllerRef.current?.abort();
    const controller = new AbortController();
    queueAbortControllerRef.current = controller;
    setIsResolving(true);
    setResolveFeedback(null);

    try {
      const response = await resolveUrl(sourceUrl, controller.signal);
      if (
        !response ||
        controller.signal.aborted ||
        requestId !== queueRequestIdRef.current
      ) {
        return;
      }
      if (response.tracks.length === 0) {
        setResolveFeedback("No playable tracks were resolved from that link.");
        return;
      }

      if (
        !enqueueTracks(response.tracks, "append", {
          importBatchId:
            response.kind === "collection" ? crypto.randomUUID() : null,
          importBatchLabel: response.collection?.title ?? null,
        })
      )
        return;
      setResolveFeedback(
        buildResolveFeedback(response.resolvedCount, response.skippedCount),
      );
      setInputValue("");
    } catch (resolveError) {
      if (
        !controller.signal.aborted &&
        requestId === queueRequestIdRef.current
      ) {
        setResolveFeedback(
          resolveError instanceof Error
            ? resolveError.message
            : "Could not resolve that link.",
        );
      }
    } finally {
      if (requestId === queueRequestIdRef.current) {
        queueAbortControllerRef.current = null;
        setIsResolving(false);
      }
    }
  };

  const handleResultAction = async (
    result: ListenTogetherSearchResult,
    action: ListenTogetherResultActionId,
  ) => {
    if (inputMode === "search") recordSearchQuery(trimmedInput);
    if (result.kind === "track") {
      const track = convertSearchTrackToMusicTrack(result);
      if (
        action === "play-now" ||
        action === "play-next" ||
        action === "append"
      ) {
        enqueueTracks(
          [track],
          action === "play-now"
            ? "play-now"
            : action === "play-next"
              ? "play-next"
              : "append",
        );
        return;
      }
    }

    if (action === "queue-collection" && result.kind === "collection") {
      await queueSourceUrl(result.sourceUrl);
      return;
    }

    const sourceUrl = getListenTogetherResultUrl(result);
    if (action === "open-source") {
      const opened = window.open(sourceUrl, "_blank", "noopener,noreferrer");
      if (!opened) setResolveFeedback("Allow pop-ups to open the source URL.");
      return;
    }

    if (action === "copy-url") {
      try {
        await navigator.clipboard.writeText(sourceUrl);
        setResolveFeedback("Source URL copied.");
      } catch {
        setResolveFeedback("Could not copy the source URL in this context.");
      }
    }
  };

  const presentResultActions = (
    event: React.MouseEvent,
    result: ListenTogetherSearchResult,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const actions = getListenTogetherResultActions(result);
    if (!isDesktop) {
      setMobileActionResult(result);
      return;
    }
    openMenu(
      event,
      getListenTogetherContextMenuItems(actions, (action) => {
        void handleResultAction(result, action);
      }),
    );
  };

  const handlePaneKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (window.innerWidth < 1024) return;
    let nextRatio: number | null = null;
    if (event.key === "ArrowLeft") nextRatio = workspacePaneRatio - 0.02;
    if (event.key === "ArrowRight") nextRatio = workspacePaneRatio + 0.02;
    if (event.key === "Home") nextRatio = 0.28;
    if (event.key === "End") nextRatio = 0.52;
    if (nextRatio === null) return;
    event.preventDefault();
    const clamped = clampListenTogetherPaneRatio(nextRatio);
    paneRatioRef.current = clamped;
    persistWorkspacePaneRatio(clamped);
  };

  const handleActivityTabKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
  ) => {
    const tabs: Array<"queue" | "recently-played"> = [
      "queue",
      "recently-played",
    ];
    const currentIndex = tabs.indexOf(activeRightTab);
    const nextIndex =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? (currentIndex + 1) % tabs.length
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? (currentIndex - 1 + tabs.length) % tabs.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? tabs.length - 1
              : -1;
    if (nextIndex < 0) return;
    event.preventDefault();
    setActiveRightTab(tabs[nextIndex]);
    document.getElementById(`listen-together-${tabs[nextIndex]}-tab`)?.focus();
  };

  const roomSyncLabel = !roomSlug
    ? "No room"
    : !sfu
      ? "Connect to listen"
      : sfu.voiceGW.isReady === false
        ? "Connecting"
        : error
          ? "Sync issue"
          : snapshot
            ? "Room synced"
            : "Waiting for room";

  const isResolveMode = inputMode === "resolve";

  return (
    <div
      ref={panelRef}
      style={
        {
          "--listen-together-left-pane": `${workspacePaneRatio * 100}%`,
        } as React.CSSProperties
      }
      className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3 sm:gap-4 sm:p-4 lg:grid lg:grid-cols-[minmax(280px,var(--listen-together-left-pane))_8px_minmax(0,1fr)] lg:overflow-hidden"
    >
      <section className="flex min-h-[280px] min-w-0 flex-col overflow-hidden rounded-[26px] border border-rm-border bg-rm-bg-surface/35 lg:min-h-0">
        <div className="border-b border-rm-border px-4 py-4 sm:px-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.18em] text-rm-text-muted">
              <Headphones className="h-4 w-4 text-primary" />
              Add to queue
            </div>
            <span className="text-[11px] text-rm-text-muted">
              YouTube · Spotify
            </span>
          </div>
          <p className="mt-2 max-w-[32ch] text-xs leading-relaxed text-rm-text-muted">
            Search a track or paste a link. Everyone in the room hears the same
            queue.
          </p>
          <div className="mt-4 flex flex-col gap-3">
            <form
              className="flex flex-col gap-2 sm:flex-row"
              onSubmit={(event) => {
                event.preventDefault();
                if (!trimmedInput || !voiceSessionHeaders) return;
                if (isResolveMode) return;

                recordSearchQuery(trimmedInput);
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
                  ref={searchInputRef}
                  type="text"
                  value={inputValue}
                  onFocus={() => setIsSearchFocused(true)}
                  onBlur={() => {
                    window.setTimeout(() => {
                      if (document.activeElement !== searchInputRef.current) {
                        setIsSearchFocused(false);
                      }
                    }, 0);
                  }}
                  onChange={(event) => {
                    setInputValue(event.target.value);
                    setResolveFeedback(null);
                  }}
                  placeholder="Search or paste YouTube / Spotify links"
                  className="h-11 w-full rounded-2xl border border-rm-border bg-rm-bg-elevated/40 pl-10 pr-4 text-base text-rm-text outline-none transition-[border-color,box-shadow] placeholder:text-rm-text-muted focus:border-primary/60 focus:ring-2 focus:ring-primary/15 sm:text-sm"
                />
              </div>
              {!isResolveMode && (
                <button
                  type="submit"
                  disabled={!trimmedInput || !voiceSessionHeaders}
                  className="inline-flex h-11 items-center justify-center rounded-2xl border border-primary/30 bg-primary/15 px-4 text-sm font-black text-primary transition-transform hover:bg-primary/20 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isSearching ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Search"
                  )}
                </button>
              )}
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

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          {isResolving ? (
            <div className="flex flex-col items-center justify-center gap-3 py-12 text-rm-text-muted">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Resolving link preview...</span>
            </div>
          ) : resolvedPreview ? (
            <div className="space-y-3">
              <div
                className="flex cursor-pointer gap-3 rounded-[22px] border border-primary/25 bg-primary/10 p-3 shadow-[0_12px_30px_oklch(0_0_0_/_0.12)] transition-colors hover:border-primary/45 hover:bg-primary/15"
                title="Double-click to play now"
                onDoubleClick={playResolvedPreview}
              >
                <div className="h-14 w-14 shrink-0 overflow-hidden rounded-2xl bg-rm-bg-elevated/60 outline outline-1 outline-black/10 dark:outline-white/10">
                  {resolvedPreview.collection?.artworkUrl ||
                  resolvedPreview.tracks[0]?.artworkUrl ? (
                    <img
                      src={
                        resolvedPreview.collection?.artworkUrl ??
                        resolvedPreview.tracks[0]?.artworkUrl ??
                        ""
                      }
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
                    {resolvedPreview.collection?.title ??
                      resolvedPreview.tracks[0]?.title}
                  </div>
                  <div className="mt-1 truncate text-xs text-rm-text-muted">
                    {resolvedPreview.collection
                      ? [
                          resolvedPreview.collection.subtitle,
                          `${resolvedPreview.resolvedCount} tracks`,
                        ]
                          .filter(Boolean)
                          .join(" • ")
                      : [
                          resolvedPreview.tracks[0]?.artist,
                          formatListenTogetherDuration(
                            resolvedPreview.tracks[0]?.kind === "music"
                              ? resolvedPreview.tracks[0].durationMs
                              : null,
                          ),
                        ]
                          .filter(Boolean)
                          .join(" • ")}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={queueResolvedPreview}
                      className="rounded-full border border-primary/30 bg-primary/15 px-3 py-1.5 text-xs font-bold text-primary transition-transform hover:bg-primary/20 active:scale-[0.96]"
                    >
                      Queue
                    </button>
                  </div>
                </div>
              </div>
              {resolvedPreview.collection &&
                resolvedPreview.tracks.length > 1 && (
                  <div className="space-y-2">
                    {resolvedPreview.tracks.map((track, index) => (
                      <div
                        key={`${track.id}:${index}`}
                        className="flex items-center gap-3 rounded-2xl border border-rm-border bg-rm-bg-hover/30 px-3 py-2"
                      >
                        <div className="h-10 w-10 shrink-0 overflow-hidden rounded-xl bg-rm-bg-elevated/60">
                          {track.artworkUrl ? (
                            <img
                              src={track.artworkUrl}
                              alt={`${track.title} artwork`}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-rm-text-muted">
                              <Headphones className="h-4 w-4" />
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-bold text-rm-text">
                            {track.title}
                          </div>
                          <div className="truncate text-[11px] text-rm-text-muted">
                            {track.artist || track.sourceLabel}
                          </div>
                        </div>
                        {track.kind === "music" && (
                          <span className="shrink-0 text-[11px] tabular-nums text-rm-text-muted">
                            {formatListenTogetherDuration(track.durationMs)}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
            </div>
          ) : isSearching ? (
            <div className="flex items-center justify-center py-12 text-rm-text-muted">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : isSearchFocused && !trimmedInput && queryHistory.length > 0 ? (
            <div className="space-y-2">
              <div className="px-1 text-[11px] font-black uppercase tracking-[0.16em] text-rm-text-muted">
                Recent searches
              </div>
              {queryHistory.map((query) => (
                <button
                  key={query}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setInputValue(query);
                    setIsSearchFocused(true);
                    void runSearch(query);
                  }}
                  className="flex min-h-11 w-full items-center gap-3 rounded-2xl border border-rm-border bg-rm-bg-hover/35 px-3 text-left text-sm text-rm-text transition-colors hover:bg-rm-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <Search className="h-4 w-4 shrink-0 text-rm-text-muted" />
                  <span className="truncate">{query}</span>
                </button>
              ))}
            </div>
          ) : searchResults.length === 0 ? (
            <div className="rounded-[22px] border border-dashed border-rm-border bg-rm-bg-hover/30 px-4 py-10 text-center text-sm text-rm-text-muted">
              {deferredSearchQuery
                ? "No results yet for that search."
                : "Search tracks or collections, or paste a YouTube or Spotify link to queue music together."}
            </div>
          ) : (
            <div className="space-y-3">
              {searchResults.map((result, index) => {
                const isTrack = result.kind === "track";
                return (
                  <div
                    key={`${result.kind}:${result.id}:${index}`}
                    onContextMenu={(event) =>
                      presentResultActions(event, result)
                    }
                    onDoubleClick={
                      isTrack
                        ? (event) => {
                            if (
                              event.target instanceof HTMLElement &&
                              event.target.closest("button")
                            ) {
                              return;
                            }
                            void handleResultAction(result, "play-now");
                          }
                        : undefined
                    }
                    className={cn(
                      "flex gap-3 rounded-[22px] border border-rm-border bg-rm-bg-hover/40 p-3 transition-colors",
                      isTrack &&
                        "cursor-pointer select-none hover:border-primary/25 hover:bg-rm-bg-active/55",
                    )}
                    title={isTrack ? "Double-click to play now" : undefined}
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
                            <ListenTogetherResultActionTrigger
                              label={result.title}
                              onClick={(event) =>
                                presentResultActions(event, result)
                              }
                            />
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() =>
                                void queueSourceUrl(result.sourceUrl)
                              }
                              className="rounded-full border border-primary/30 bg-primary/15 px-3 py-1.5 text-xs font-bold text-primary transition hover:bg-primary/20"
                            >
                              Queue Collection
                            </button>
                            <ListenTogetherResultActionTrigger
                              label={result.title}
                              onClick={(event) =>
                                presentResultActions(event, result)
                              }
                            />
                          </>
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

      <button
        type="button"
        role="separator"
        aria-label="Resize Listen Together panes"
        aria-orientation="vertical"
        aria-valuemin={28}
        aria-valuemax={52}
        aria-valuenow={Math.round(workspacePaneRatio * 100)}
        onPointerDown={(event) => {
          if (window.innerWidth < 1024) return;
          event.preventDefault();
          setIsPaneDragging(true);
          event.currentTarget.setPointerCapture?.(event.pointerId);
        }}
        onPointerCancel={() => {
          setIsPaneDragging(false);
          persistWorkspacePaneRatio(paneRatioRef.current);
        }}
        onLostPointerCapture={() => {
          setIsPaneDragging(false);
          persistWorkspacePaneRatio(paneRatioRef.current);
        }}
        onKeyDown={handlePaneKeyDown}
        className="group relative hidden min-h-0 cursor-col-resize items-center justify-center rounded-full outline-none lg:flex"
      >
        <span className="h-16 w-1 rounded-full bg-rm-border transition-colors group-hover:bg-primary/60 group-focus-visible:bg-primary" />
      </button>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-t border-rm-border pt-4 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
        <div className="shrink-0 rounded-[26px] border border-rm-border bg-rm-bg-surface/35 p-4 sm:p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.18em] text-rm-text-muted">
              <Headphones className="h-4 w-4 text-primary" />
              Now playing
            </div>
            <span className="inline-flex items-center gap-1.5 text-[11px] text-rm-text-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              {roomSyncLabel}
            </span>
          </div>
          <ListenTogetherNowPlayingCard
            playback={playback}
            sfu={sfu}
            roomSlug={roomSlug}
            variant="panel"
          />
        </div>

        <div className="flex min-h-[260px] min-w-0 flex-1 flex-col pt-4 sm:pt-5">
          <div className="flex shrink-0 items-center justify-between gap-3 pb-3">
            <div
              role="tablist"
              aria-label="Listen Together room activity"
              className="flex min-w-0 items-center gap-1 rounded-2xl bg-rm-bg-hover/55 p-1"
            >
              <button
                type="button"
                role="tab"
                id="listen-together-queue-tab"
                aria-selected={activeRightTab === "queue"}
                aria-controls="listen-together-activity-panel"
                tabIndex={activeRightTab === "queue" ? 0 : -1}
                onKeyDown={handleActivityTabKeyDown}
                onClick={() => setActiveRightTab("queue")}
                className={cn(
                  "inline-flex min-h-9 items-center gap-1.5 rounded-xl px-3 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                  activeRightTab === "queue"
                    ? "bg-rm-bg-surface text-rm-text shadow-sm"
                    : "text-rm-text-muted hover:text-rm-text",
                )}
              >
                <ListMusic className="h-3.5 w-3.5" />
                Queue
                <span className="tabular-nums text-[10px] text-rm-text-muted">
                  {snapshot?.queue?.length ?? 0}
                </span>
              </button>
              <button
                type="button"
                role="tab"
                id="listen-together-recently-played-tab"
                aria-selected={activeRightTab === "recently-played"}
                aria-controls="listen-together-activity-panel"
                tabIndex={activeRightTab === "recently-played" ? 0 : -1}
                onKeyDown={handleActivityTabKeyDown}
                onClick={() => setActiveRightTab("recently-played")}
                className={cn(
                  "inline-flex min-h-9 items-center gap-1.5 rounded-xl px-3 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                  activeRightTab === "recently-played"
                    ? "bg-rm-bg-surface text-rm-text shadow-sm"
                    : "text-rm-text-muted hover:text-rm-text",
                )}
              >
                Recently played
                <span className="tabular-nums text-[10px] text-rm-text-muted">
                  {snapshot?.recentlyPlayed?.length ?? 0}
                </span>
              </button>
            </div>
          </div>
          <div
            id="listen-together-activity-panel"
            role="tabpanel"
            aria-labelledby={
              activeRightTab === "queue"
                ? "listen-together-queue-tab"
                : "listen-together-recently-played-tab"
            }
            className="custom-scrollbar min-h-0 flex-1 overflow-y-auto pr-1"
          >
            {activeRightTab === "queue" ? (
              snapshot?.queue?.length ? (
                <div className="divide-y divide-rm-border/70">
                  {snapshot.queue.map((entry, index) => {
                    const isCurrent = entry.entryId === snapshot.currentEntryId;
                    return (
                      <div
                        key={entry.entryId}
                        className={cn(
                          "grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-2 px-2 py-2.5 transition-colors sm:gap-3 sm:py-3",
                          isCurrent
                            ? "rounded-2xl bg-primary/10"
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
                        <div className="h-10 w-10 shrink-0 overflow-hidden rounded-xl bg-rm-bg-elevated/60 ring-1 ring-white/5 sm:h-11 sm:w-11">
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
                          <div className="truncate text-[13px] font-bold text-rm-text sm:text-sm">
                            {entry.track.title}
                          </div>
                          <div className="mt-1 flex min-w-0 items-center gap-1.5 truncate text-[11px] text-rm-text-muted sm:gap-2 sm:text-xs">
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
                          <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[10px] text-rm-text-muted/75 sm:text-[11px]">
                            <div className="h-4 w-4 shrink-0 overflow-hidden rounded-full bg-rm-bg-hover">
                              {entry.requester.avatarUrl ? (
                                <AvatarImage
                                  src={getAuthAssetUrl(
                                    entry.requester.avatarUrl,
                                  )}
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
                              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-rm-text-muted transition-colors hover:bg-rm-bg-active hover:text-rm-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
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
                            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-rm-text-muted transition-colors hover:bg-red-500/10 hover:text-red-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/30"
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
              )
            ) : snapshot?.recentlyPlayed?.length ? (
              <div className="space-y-2">
                {snapshot.recentlyPlayed.map((historyEntry) => (
                  <div
                    key={historyEntry.historyId}
                    className="flex items-center gap-3 rounded-2xl border border-rm-border bg-rm-bg-hover/35 p-3"
                  >
                    <div className="h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-rm-bg-elevated/60">
                      {historyEntry.entry.track.artworkUrl ? (
                        <img
                          src={historyEntry.entry.track.artworkUrl}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-rm-text-muted">
                          <Headphones className="h-4 w-4" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-bold text-rm-text">
                        {historyEntry.entry.track.title}
                      </div>
                      <div className="mt-1 truncate text-xs text-rm-text-muted">
                        {[
                          historyEntry.entry.track.artist,
                          historyEntry.entry.track.sourceLabel,
                        ]
                          .filter(Boolean)
                          .join(" • ")}
                      </div>
                      <div className="mt-1 truncate text-[11px] text-rm-text-muted/75">
                        Played{" "}
                        {new Date(historyEntry.playedAt).toLocaleTimeString()}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        enqueueTracks(
                          [getRequeueTrack(historyEntry.entry.track)],
                          "append",
                        )
                      }
                      className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-rm-border bg-rm-bg-elevated/60 px-3 text-xs font-bold text-rm-text transition-colors hover:bg-rm-bg-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    >
                      <ListMusic className="h-3.5 w-3.5" />
                      Requeue
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-[22px] border border-dashed border-rm-border bg-rm-bg-hover/30 px-4 py-10 text-center text-sm text-rm-text-muted">
                Nothing has played in this room yet.
              </div>
            )}
          </div>
        </div>
      </section>

      {shouldRender && menu.isOpen && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menu.items}
          topContent={menu.topContent}
          onClose={closeMenu}
          isClosing={isClosing}
        />
      )}
      {mobileActionResult && (
        <ListenTogetherMobileActionSheet
          title={mobileActionResult.title}
          actions={getListenTogetherResultActions(mobileActionResult)}
          onAction={(action) => {
            void handleResultAction(mobileActionResult, action);
          }}
          onClose={() => setMobileActionResult(null)}
        />
      )}
    </div>
  );
}
