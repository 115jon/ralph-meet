import { AvatarImage } from "@/components/chat/AvatarImage";
import { avatarShape } from "@/components/ui/avatar-shape";
import { apiGet, apiPost } from "@/lib/api-client";
import { clog } from "@/lib/console-logger";
import {
  convertSearchTrackToMusicTrack,
  getListenTogetherInputMode,
  type ListenTogetherEnqueueMode,
  type ListenTogetherResolveResponse,
  type ListenTogetherQueueEntry,
  type ListenTogetherSearchFilter,
  type ListenTogetherSearchResponse,
  type ListenTogetherSearchResult,
  type ListenTogetherTrack,
  describeListenTogetherError,
} from "@/lib/listen-together";
import type { SFUClient } from "@/lib/sfu-client";
import { getAuthAssetUrl } from "@/lib/platform";
import { useClientDateFormatter } from "@/lib/client-date-format";
import { cn } from "@/lib/utils";
import {
  addListenTogetherQueryHistory,
  clampListenTogetherPaneRatio,
  readListenTogetherPaneRatio,
  readListenTogetherQueryHistory,
  writeListenTogetherQueryHistory,
} from "@/lib/listen-together-local";
import { useChatStore } from "@/stores/chat-store";
import { useListenTogetherStore } from "@/stores/useListenTogetherStore";
import ContextMenu from "./ContextMenu";
import InlineEmojiText from "./InlineEmojiText";
import {
  ListenTogetherNowPlayingCard,
  ListenTogetherProgress,
} from "./ListenTogetherNowPlayingCard";
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
import { isWideViewport, useIsMobile } from "@/hooks/useMediaQuery";
import {
  formatListenTogetherDuration,
  useListenTogetherPlaybackState,
} from "./listen-together-playback";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { IconButton } from "@/components/ui/IconButton";
import { Input } from "@/components/ui/input";
import { Led, type LedState } from "@/components/ui/led";
import { Num } from "@/components/ui/num";
import { Tabs, tabId } from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  memo,
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

/**
 * Tracklist rows (J-card): title, one ink-3 line, running time right-aligned
 * in Num. Row actions are a small toolbar over the row's end, revealed on
 * hover or keyboard focus; on touch they sit in the row, always visible.
 */
const TRACK_ROW =
  "group/row relative grid items-center gap-x-3 rounded-md px-2 py-1.5 outline-none transition-colors duration-(--dur-1) ease-out pointer-fine:hover:bg-tint-1 has-focus-visible:bg-tint-1";
const ROW_TITLE = "truncate text-ui-row font-medium text-ink-1";
const ROW_META =
  "flex min-w-0 items-center gap-1.5 truncate text-ui-xs text-ink-3";
const ROW_TIME =
  "justify-self-end text-ink-3 transition-opacity duration-(--dur-1) ease-out pointer-fine:group-hover/row:opacity-0 pointer-fine:group-has-focus-visible/row:opacity-0";
const ROW_ACTIONS =
  "flex items-center gap-1 pointer-coarse:col-span-full pointer-coarse:mt-1.5 pointer-coarse:justify-end pointer-fine:pointer-events-none pointer-fine:absolute pointer-fine:inset-y-0 pointer-fine:right-1 pointer-fine:my-auto pointer-fine:h-fit pointer-fine:rounded-md pointer-fine:border pointer-fine:border-line pointer-fine:bg-ply-3 pointer-fine:p-0.5 pointer-fine:opacity-0 pointer-fine:shadow-float pointer-fine:transition-opacity pointer-fine:duration-(--dur-1) pointer-fine:ease-out pointer-fine:group-hover/row:pointer-events-auto pointer-fine:group-hover/row:opacity-100 pointer-fine:group-has-focus-visible/row:pointer-events-auto pointer-fine:group-has-focus-visible/row:opacity-100";

function TrackArt({ src, alt = "" }: { src?: string | null; alt?: string }) {
  return (
    <div className="size-8 shrink-0 overflow-hidden rounded-sm bg-tint-1">
      {src ? (
        <img src={src} alt={alt} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-ink-3">
          <Icon name="music" size="sm" />
        </div>
      )}
    </div>
  );
}

/**
 * The now-playing row's own subscription: its glyph and the lit path that
 * runs under it. The memoised row above it never re-renders for playback.
 */
function CurrentTrackGlyph({ roomSlug }: { roomSlug?: string | null }) {
  const { isPaused } = useListenTogetherPlaybackState(roomSlug);
  return (
    <Icon
      name={isPaused ? "pause" : "play"}
      state="active"
      size="sm"
      className="text-path"
      label={isPaused ? "Paused" : "Now playing"}
    />
  );
}

function CurrentTrackProgress({ roomSlug }: { roomSlug?: string | null }) {
  const playback = useListenTogetherPlaybackState(roomSlug);
  return (
    <ListenTogetherProgress
      playback={playback}
      tone="path"
      marker
      className="col-start-3 mt-1.5"
    />
  );
}

function getRequeueTrack(track: ListenTogetherTrack): ListenTogetherTrack {
  if (track.kind !== "radio") return track;
  return {
    ...track,
    station_uuid: track.station_uuid ?? track.id,
  };
}

interface ListenTogetherQueueRowProps {
  entry: ListenTogetherQueueEntry;
  index: number;
  isCurrent: boolean;
  roomSlug?: string | null;
  sfu: SFUClient | null;
  onCommandRejected?: (message: string) => void;
  onCommandAccepted?: () => void;
}

// Stable render seam for testing memoization without adding runtime observer props.
// eslint-disable-next-line react-refresh/only-export-components
export const listenTogetherQueueRowRenderer = {
  render({
    entry,
    index,
    isCurrent,
    roomSlug,
    sfu,
    onCommandRejected,
    onCommandAccepted,
  }: ListenTogetherQueueRowProps) {
    const sendQueueCommand = (payload: Record<string, unknown>) => {
      if (!sfu || !roomSlug || sfu.voiceGW.isReady === false) {
        onCommandRejected?.(
          "Connect to the voice room before changing the queue.",
        );
        return false;
      }
      listenTogetherLog.info("Sending listen together queue command", {
        source: "listen-together-panel",
        type: payload.type,
        roomSlug,
        entryId: payload.entryId ?? null,
      });
      sfu.resumeAudioContext?.();
      const accepted = sfu.voiceGW.sendAppEvent(payload);
      if (accepted === false) {
        onCommandRejected?.("Could not update the listen together queue.");
      } else {
        onCommandAccepted?.();
      }
      return accepted;
    };

    return (
      <div
        data-queue-row={entry.entryId}
        aria-current={isCurrent ? "true" : undefined}
        className={cn(TRACK_ROW, "grid-cols-[20px_32px_minmax(0,1fr)_auto]")}
      >
        <div className="flex justify-center">
          {isCurrent ? (
            <CurrentTrackGlyph roomSlug={roomSlug} />
          ) : (
            <Num className="text-ink-3">{index + 1}</Num>
          )}
        </div>
        <TrackArt src={entry.track.artworkUrl} />
        <div className="min-w-0">
          <div className={ROW_TITLE}>{entry.track.title}</div>
          <div className={ROW_META}>
            <span className="truncate">
              {entry.track.artist || entry.track.sourceLabel}
            </span>
            <span aria-hidden="true">·</span>
            <span
              className={cn(
                "size-4 shrink-0 bg-tint-3",
                avatarShape(
                  entry.requester.avatarUrl && entry.requester.avatarDisplay,
                ),
              )}
            >
              {entry.requester.avatarUrl ? (
                <AvatarImage
                  src={getAuthAssetUrl(entry.requester.avatarUrl)}
                  alt={`${entry.requester.displayName} avatar`}
                  display={entry.requester.avatarDisplay}
                />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-ui-2xs">
                  {entry.requester.displayName.charAt(0).toUpperCase()}
                </span>
              )}
            </span>
            <InlineEmojiText
              text={entry.requester.displayName}
              className="truncate"
            />
            {entry.importBatchLabel && (
              <>
                <span aria-hidden="true">·</span>
                <span className="truncate">{entry.importBatchLabel}</span>
              </>
            )}
          </div>
        </div>
        {entry.track.kind === "music" ? (
          <Num className={ROW_TIME}>
            {formatListenTogetherDuration(entry.track.durationMs)}
          </Num>
        ) : (
          <span className={cn(ROW_TIME, "text-ui-xs")}>Radio</span>
        )}
        <div className={ROW_ACTIONS}>
          {!isCurrent && (
            <IconButton
              icon="play"
              size={28}
              onClick={() =>
                sendQueueCommand({
                  type: "listen_together.play",
                  room_slug: roomSlug,
                  entryId: entry.entryId,
                })
              }
              aria-label={`Play ${entry.track.title}`}
            />
          )}
          <IconButton
            icon="trash"
            size={28}
            variant="destructive"
            onClick={() =>
              sendQueueCommand({
                type: "listen_together.remove",
                room_slug: roomSlug,
                entryId: entry.entryId,
              })
            }
            aria-label={`Remove ${entry.track.title}`}
          />
        </div>
        {isCurrent ? <CurrentTrackProgress roomSlug={roomSlug} /> : null}
      </div>
    );
  },
};

export const ListenTogetherQueueRow = memo(
  (props: ListenTogetherQueueRowProps) =>
    listenTogetherQueueRowRenderer.render(props),
);

export function ListenTogetherPanel({
  sfu,
  roomSlug,
  voiceSessionId,
  serverId,
  channelId,
  localUserId,
}: ListenTogetherPanelProps) {
  // No ticking: the panel re-renders on room changes only; the progress
  // moves in CSS and the clock ticks in its own leaf.
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
  const [menuLabel, setMenuLabel] = useState<string | undefined>();
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
  const [queryHistory, setQueryHistory] = useState<string[]>([]);
  const [activeRightTab, setActiveRightTab] = useState<
    "queue" | "recently-played"
  >("queue");
  const [mobileActionResult, setMobileActionResult] =
    useState<ListenTogetherSearchResult | null>(null);
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const isMobile = useIsMobile();
  const formatDate = useClientDateFormatter();
  const [isPaneDragging, setIsPaneDragging] = useState(false);

  useEffect(() => {
    setQueryHistory(readListenTogetherQueryHistory());
    setWorkspacePaneRatio(readListenTogetherPaneRatio());
  }, [setWorkspacePaneRatio]);

  const handleQueueCommandRejected = useCallback((message: string) => {
    setResolveFeedback(message);
  }, []);
  const handleQueueCommandAccepted = useCallback(() => {
    setResolveFeedback(null);
  }, []);

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
    if (isMobile) return;
    setMobileActionsOpen(false);
  }, [isMobile]);

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
      if (!panel || !isWideViewport()) return;
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
    const accepted = sfu.voiceGW.sendAppEvent(payload);
    if (accepted === false) {
      setResolveFeedback("Could not update the queue. Please try again.");
      return false;
    }
    setResolveFeedback(null);
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
    if (isMobile) {
      setMobileActionResult(result);
      setMobileActionsOpen(true);
      return;
    }
    setMenuLabel(`Actions for ${result.title}`);
    // A keyboard press has no pointer position: open under the button.
    const anchor =
      event.type === "click" &&
      event.detail === 0 &&
      event.currentTarget instanceof Element
        ? event.currentTarget.getBoundingClientRect()
        : null;
    openMenu(
      anchor
        ? new MouseEvent("contextmenu", {
            clientX: anchor.left,
            clientY: anchor.bottom + 4,
          })
        : event,
      getListenTogetherContextMenuItems(actions, (action) => {
        void handleResultAction(result, action);
      }),
    );
  };

  const handlePaneKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!isWideViewport()) return;
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

  const roomSync: { label: string; led: LedState } = !roomSlug
    ? { label: "No room", led: "off" }
    : !sfu
      ? { label: "Connect to listen", led: "off" }
      : sfu.voiceGW.isReady === false
        ? { label: "Connecting", led: "idle" }
        : error
          ? { label: "Sync issue", led: "muted" }
          : snapshot
            ? { label: "Room synced", led: "talk" }
            : { label: "Waiting for room", led: "idle" };

  const isResolveMode = inputMode === "resolve";

  return (
    <div
      ref={panelRef}
      style={
        {
          "--listen-together-left-pane": `${workspacePaneRatio * 100}%`,
        } as React.CSSProperties
      }
      className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-3 md:p-4 lg:grid lg:grid-cols-[minmax(280px,var(--listen-together-left-pane))_9px_minmax(0,1fr)] lg:gap-3 lg:overflow-hidden"
    >
      <section
        aria-labelledby="listen-together-add-title"
        className="flex min-h-[280px] min-w-0 flex-col overflow-hidden lg:min-h-0"
      >
        <div className="flex flex-col gap-3 pb-3">
          <div className="flex items-baseline justify-between gap-3">
            <h3
              id="listen-together-add-title"
              className="text-ui-sm font-semibold text-ink-1"
            >
              Add to queue
            </h3>
            <span className="text-ui-xs text-ink-3">YouTube · Spotify</span>
          </div>
          <p className="max-w-[44ch] text-pretty text-ui-sm text-ink-2">
            Search a track or paste a link. Everyone in the room hears the same
            queue.
          </p>
          <form
            className="flex flex-col gap-2 md:flex-row"
            onSubmit={(event) => {
              event.preventDefault();
              if (!trimmedInput || !voiceSessionHeaders) return;
              if (isResolveMode) return;

              recordSearchQuery(trimmedInput);
              void runSearch(trimmedInput);
            }}
          >
            <div className="relative flex-1">
              <Icon
                name={isResolveMode ? "link" : "search"}
                size="sm"
                className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-3"
              />
              <Input
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
                aria-label="Search or paste a link"
                placeholder="Search or paste YouTube / Spotify links"
                className="pl-8 max-md:h-10"
              />
            </div>
            {!isResolveMode && (
              <Button
                type="submit"
                variant="secondary"
                loading={isSearching}
                disabled={!trimmedInput || !voiceSessionHeaders}
                className="max-md:h-10"
              >
                Search
              </Button>
            )}
          </form>
          <Tabs
            label="Search for"
            idBase="listen-together-filter"
            panelId="listen-together-results"
            items={[
              { value: "track", label: "Tracks" },
              { value: "collection", label: "Collections" },
            ]}
            value={searchFilter}
            onValueChange={setSearchFilter}
            className="h-8 border-b border-line"
          />
          {resolveFeedback && (
            <div
              role="status"
              className="rounded-md bg-tint-1 px-3 py-2 text-ui-sm text-ink-2"
            >
              {resolveFeedback}
            </div>
          )}
          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md bg-danger-tint px-3 py-2 text-ui-sm text-danger-ink"
            >
              <Icon name="warning" size="sm" className="mt-0.5 shrink-0" />
              {describeListenTogetherError(error, "update the queue")}
            </div>
          )}
        </div>

        <div
          id="listen-together-results"
          role="tabpanel"
          aria-labelledby={tabId("listen-together-filter", searchFilter)}
          className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1"
        >
          {isResolving ? (
            <EmptyState size="sm" loading title="Resolving link preview…" />
          ) : resolvedPreview ? (
            <div className="flex flex-col gap-2">
              <div
                className="flex gap-3 rounded-lg bg-tint-1 p-3"
                onDoubleClick={playResolvedPreview}
              >
                <div className="size-14 shrink-0 overflow-hidden rounded-md bg-tint-1">
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
                    <div className="flex h-full w-full items-center justify-center text-ink-3">
                      <Icon name="music" size="lg" />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className={ROW_TITLE}>
                    {resolvedPreview.collection?.title ??
                      resolvedPreview.tracks[0]?.title}
                  </div>
                  <div className="truncate text-ui-xs text-ink-3">
                    {resolvedPreview.collection
                      ? [
                          resolvedPreview.collection.subtitle,
                          `${resolvedPreview.resolvedCount} tracks`,
                        ]
                          .filter(Boolean)
                          .join(" · ")
                      : [
                          resolvedPreview.tracks[0]?.artist,
                          formatListenTogetherDuration(
                            resolvedPreview.tracks[0]?.kind === "music"
                              ? resolvedPreview.tracks[0].durationMs
                              : null,
                          ),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" onClick={playResolvedPreview}>
                      <Icon name="play" state="active" size="sm" />
                      Play now
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={queueResolvedPreview}
                    >
                      Queue
                    </Button>
                  </div>
                </div>
              </div>
              {resolvedPreview.collection &&
                resolvedPreview.tracks.length > 1 && (
                  <ol className="flex flex-col">
                    {resolvedPreview.tracks.map((track, index) => (
                      <li
                        key={`${track.id}:${index}`}
                        className={cn(
                          TRACK_ROW,
                          "grid-cols-[20px_32px_minmax(0,1fr)_auto]",
                        )}
                      >
                        <Num className="text-center text-ink-3">
                          {index + 1}
                        </Num>
                        <TrackArt
                          src={track.artworkUrl}
                          alt={`${track.title} artwork`}
                        />
                        <div className="min-w-0">
                          <div className={ROW_TITLE}>{track.title}</div>
                          <div className={ROW_META}>
                            <span className="truncate">
                              {track.artist || track.sourceLabel}
                            </span>
                          </div>
                        </div>
                        {track.kind === "music" ? (
                          <Num className="text-ink-3">
                            {formatListenTogetherDuration(track.durationMs)}
                          </Num>
                        ) : (
                          <span />
                        )}
                      </li>
                    ))}
                  </ol>
                )}
            </div>
          ) : isSearching ? (
            <EmptyState size="sm" loading title="Searching…" />
          ) : isSearchFocused && !trimmedInput && queryHistory.length > 0 ? (
            <div className="flex flex-col">
              <div className="px-2 pb-1 text-ui-xs text-ink-3">
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
                  className="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-ui-sm text-ink-1 outline-none transition-colors duration-(--dur-1) ease-out focus-visible:outline-2 focus-visible:outline-focus pointer-fine:hover:bg-tint-1 pointer-coarse:h-11"
                >
                  <Icon
                    name="search"
                    size="sm"
                    className="shrink-0 text-ink-3"
                  />
                  <span className="truncate">{query}</span>
                </button>
              ))}
            </div>
          ) : searchResults.length === 0 ? (
            deferredSearchQuery ? (
              <EmptyState
                size="sm"
                title="No results"
                description="Nothing matched that search. Try another title or artist, or paste a link."
              />
            ) : (
              <EmptyState
                size="sm"
                title="Find something to play"
                description="Search tracks or collections, or paste a YouTube or Spotify link to queue music together."
              />
            )
          ) : (
            <TooltipProvider>
              <ul className="flex flex-col">
                {searchResults.map((result, index) => {
                  const isTrack = result.kind === "track";
                  return (
                    <li
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
                        TRACK_ROW,
                        "grid-cols-[40px_minmax(0,1fr)_auto]",
                        isTrack && "select-none",
                      )}
                    >
                      <div className="size-10 shrink-0 overflow-hidden rounded-sm bg-tint-1">
                        {result.artworkUrl ? (
                          <img
                            src={result.artworkUrl}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-ink-3">
                            <Icon
                              name={isTrack ? "music" : "playlist"}
                              size="md"
                            />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className={ROW_TITLE}>{result.title}</div>
                        <div className={ROW_META}>
                          <span className="truncate">
                            {isTrack
                              ? result.artist || result.sourceLabel
                              : [result.subtitle, `${result.itemCount} items`]
                                  .filter(Boolean)
                                  .join(" · ")}
                          </span>
                        </div>
                      </div>
                      {isTrack ? (
                        <Num className={ROW_TIME}>
                          {formatListenTogetherDuration(result.durationMs)}
                        </Num>
                      ) : (
                        <span className={cn(ROW_TIME, "text-ui-xs")}>
                          Collection
                        </span>
                      )}
                      <div className={ROW_ACTIONS}>
                        {isTrack ? (
                          <>
                            <IconButton
                              icon="play"
                              iconState="active"
                              size={28}
                              tooltip="Play now"
                              aria-label={`Play ${result.title} now`}
                              onClick={() =>
                                void handleResultAction(result, "play-now")
                              }
                            />
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                enqueueTracks(
                                  [convertSearchTrackToMusicTrack(result)],
                                  "play-next",
                                )
                              }
                            >
                              Play next
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() =>
                                enqueueTracks(
                                  [convertSearchTrackToMusicTrack(result)],
                                  "append",
                                )
                              }
                            >
                              Queue
                            </Button>
                          </>
                        ) : (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() =>
                              void queueSourceUrl(result.sourceUrl)
                            }
                          >
                            Queue collection
                          </Button>
                        )}
                        <ListenTogetherResultActionTrigger
                          label={result.title}
                          onClick={(event) =>
                            presentResultActions(event, result)
                          }
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </TooltipProvider>
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
          if (!isWideViewport()) return;
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
        className="group relative hidden min-h-0 cursor-col-resize items-center justify-center rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-focus lg:flex"
      >
        <span
          aria-hidden
          className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-line"
        />
        <span
          aria-hidden
          className="relative h-8 w-1 rounded-full bg-line-strong opacity-0 transition-opacity duration-(--dur-1) ease-out group-focus-visible:opacity-100 pointer-fine:group-hover:opacity-100"
        />
      </button>

      <section
        aria-labelledby="listen-together-now-title"
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-t border-line pt-4 lg:border-t-0 lg:pt-0"
      >
        <div className="shrink-0">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h3
              id="listen-together-now-title"
              className="text-ui-sm font-semibold text-ink-1"
            >
              Now playing
            </h3>
            <span className="inline-flex items-center gap-1.5 text-ui-xs text-ink-3">
              <Led state={roomSync.led} />
              {roomSync.label}
            </span>
          </div>
          <ListenTogetherNowPlayingCard
            playback={playback}
            sfu={sfu}
            roomSlug={roomSlug}
            variant="panel"
          />
        </div>

        <div className="flex min-h-[260px] min-w-0 flex-1 flex-col pt-4">
          <Tabs
            label="Listen Together room activity"
            idBase="listen-together"
            panelId="listen-together-activity-panel"
            items={[
              {
                value: "queue",
                label: "Queue",
                adornment: (
                  <Num className="text-ink-3">
                    {snapshot?.queue?.length ?? 0}
                  </Num>
                ),
              },
              {
                value: "recently-played",
                label: "Recently played",
                adornment: (
                  <Num className="text-ink-3">
                    {snapshot?.recentlyPlayed?.length ?? 0}
                  </Num>
                ),
              },
            ]}
            value={activeRightTab}
            onValueChange={setActiveRightTab}
            className="mb-2 h-9 shrink-0 border-b border-line"
          />
          <div
            id="listen-together-activity-panel"
            role="tabpanel"
            aria-labelledby={tabId("listen-together", activeRightTab)}
            className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1"
          >
            {activeRightTab === "queue" ? (
              snapshot?.queue?.length ? (
                <ol className="flex flex-col">
                  {snapshot.queue.map((entry, index) => (
                    <li key={entry.entryId}>
                      <ListenTogetherQueueRow
                        entry={entry}
                        index={index}
                        isCurrent={entry.entryId === snapshot.currentEntryId}
                        roomSlug={roomSlug}
                        sfu={sfu}
                        onCommandRejected={handleQueueCommandRejected}
                        onCommandAccepted={handleQueueCommandAccepted}
                      />
                    </li>
                  ))}
                </ol>
              ) : (
                <EmptyState
                  size="sm"
                  title="Queue is empty"
                  description="Search or paste a link to add the first track."
                />
              )
            ) : snapshot?.recentlyPlayed?.length ? (
              <ol className="flex flex-col">
                {snapshot.recentlyPlayed.map((historyEntry) => (
                  <li
                    key={historyEntry.historyId}
                    className={cn(
                      TRACK_ROW,
                      "grid-cols-[32px_minmax(0,1fr)_auto]",
                    )}
                  >
                    <TrackArt src={historyEntry.entry.track.artworkUrl} />
                    <div className="min-w-0">
                      <div className={ROW_TITLE}>
                        {historyEntry.entry.track.title}
                      </div>
                      <div className={ROW_META}>
                        <span className="truncate">
                          {[
                            historyEntry.entry.track.artist,
                            historyEntry.entry.track.sourceLabel,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </div>
                    </div>
                    <Num className={ROW_TIME} title="Played at">
                      {formatDate(historyEntry.playedAt, {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </Num>
                    <div className={ROW_ACTIONS}>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          enqueueTracks(
                            [getRequeueTrack(historyEntry.entry.track)],
                            "append",
                          )
                        }
                      >
                        <Icon name="queueAdd" size="sm" />
                        Requeue
                      </Button>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyState
                size="sm"
                title="Nothing played yet"
                description="Tracks show up here after they finish playing in this room."
              />
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
          label={menuLabel}
        />
      )}
      {mobileActionResult && (
        <ListenTogetherMobileActionSheet
          open={mobileActionsOpen && isMobile}
          title={mobileActionResult.title}
          actions={getListenTogetherResultActions(mobileActionResult)}
          onAction={(action) => {
            void handleResultAction(mobileActionResult, action);
          }}
          onClose={() => setMobileActionsOpen(false)}
        />
      )}
    </div>
  );
}
