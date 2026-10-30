/**
 * VirtualMessageList
 *
 * Uses virtua's `Virtualizer` following the official Chat story pattern:
 *   - `overflowAnchor: none` prevents browser scroll anchoring from conflicting
 *   - `shift` is enabled per-prepend (not always-on) for scroll stability
 *   - `shouldStickToBottom` tracks whether to auto-scroll on true tail appends
 *
 * Reference: https://github.com/inokawa/virtua/blob/main/stories/react/advanced/Chat.stories.tsx
 */

import type { Message } from "@/lib/types";
import { cn } from "@/lib/utils";
import { debugChatScroll } from "@/lib/chat-scroll-debug";
import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Virtualizer, type VirtualizerHandle } from "virtua";
import { clog } from "@/lib/console-logger";
import MessageItem from "./MessageItem";
import { Skeleton } from "@/components/ui/skeleton";
import { useAnimateEnter } from "@/components/ui/tree";
import {
  DayDivider,
  DIVIDER_ROW,
  DividerLabel,
  NewMessageSeparator,
} from "./NewMessageSeparator";
import { setMessageListScrolling } from "./message-list-scroll";
import { estimateListItemSize } from "./message-row-height";
import { useMessageTimeFormat } from "./message-time";
import { buildMessageRows, type MessageRow } from "./message-rows";
import { isStickyDayVisible } from "./sticky-day";

const log = clog("VirtualMessageList");

type ScrollBehavior = "auto" | "smooth";

const BOTTOM_LOCK_THRESHOLD_PX = 12;
const VIRTUALIZER_BUFFER_PX = 800;
const HISTORY_FETCH_PX = 800;
/** A tail append keeps its list-enter class this long, then never again. */
const ENTERING_MS = 600;
/** Jump highlight: hold the tint, then let it fade (the row transitions it). */
const HIGHLIGHT_HOLD_MS = 1200;
const HIGHLIGHT_FADE_MS = 300;

// ── Public ref API ─────────────────────────────────────────────────────────

export interface VirtualMessageListHandle {
  scrollToBottom(behavior?: ScrollBehavior): void;
  scrollToMessageId(
    messageId: string,
    align?: "start" | "center" | "end",
    behavior?: ScrollBehavior,
    highlight?: boolean,
  ): void;
}

// ── Props ──────────────────────────────────────────────────────────────────

interface Props {
  messages: Message[];
  currentUserId?: string;
  canPin: boolean;
  canDeleteMessages?: boolean;
  hasMore: boolean;
  loading: boolean;
  isDetached?: boolean;
  initialScrollMessageId?: string | null;
  initialScrollAlign?: "start" | "center" | "end";
  initialScrollBehavior?: ScrollBehavior;
  highlightInitialScroll?: boolean;
  restoreInProgress?: boolean;
  onInitialScrollSettled?: () => void;
  welcomeContent?: ReactNode;
  onLoadMore: () => Promise<void> | void;
  onLoadAfter?: () => Promise<void> | void;
  onReply: (message: Message) => void;
  onPin: (message: Message) => void;
  onUnpin: (messageId: string, skipConfirm?: boolean) => void;
  onJump: (messageId: string) => void;
  onBan?: (userId: string, username: string) => void;
  onThread?: (messageId: string) => void;
  onAtBottom?: (isAtBottom: boolean) => void;
  onScrollRangeChange?: (startIndex: number) => void;
  onMessageVisible?: (messageId: string) => void;
  unreadSeparatorId?: string | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function buildIndexMap(messages: Message[]): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < messages.length; i++) {
    map.set(messages[i].id, i);
  }
  return map;
}

// ── Sub-components ─────────────────────────────────────────────────────────

function MessageSkeleton({ compact = false }: { compact?: boolean }) {
  // Static placeholders on the row metrics (avatar 40, 20px author line,
  // 22px body lines): nothing pulses while history loads.
  return (
    <div
      className={cn("flex gap-3 pr-6 pl-4", compact ? "py-0.5" : "mt-4 py-0.5")}
    >
      {compact ? (
        <div className="w-10 shrink-0" />
      ) : (
        <Skeleton className="size-10 shrink-0 rounded-avatar" />
      )}
      <div className="flex flex-1 flex-col justify-center gap-2">
        {!compact && (
          <div className="flex h-5 items-center gap-2">
            <Skeleton className="h-3 w-24 rounded-xs" />
            <Skeleton className="h-2.5 w-10 rounded-xs" />
          </div>
        )}
        <div className="flex h-5.5 items-center">
          <Skeleton
            className="h-3 rounded-xs"
            style={{ width: `${compact ? 45 : 65}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function SkeletonGroup() {
  return (
    <>
      <MessageSkeleton compact={false} />
      <MessageSkeleton compact />
      <MessageSkeleton compact />
    </>
  );
}

interface HeaderProps {
  hasMore: boolean;
  loading: boolean;
  hasMessages: boolean;
  welcomeContent?: ReactNode;
}

const ListHeader = memo(
  ({ hasMore, loading, hasMessages, welcomeContent }: HeaderProps) => {
    if (!hasMore && !loading) {
      return <div>{welcomeContent}</div>;
    }
    if (loading && !hasMessages) {
      return (
        <div className="pb-2">
          <SkeletonGroup />
          <SkeletonGroup />
          <SkeletonGroup />
        </div>
      );
    }
    return null;
  },
);
ListHeader.displayName = "ListHeader";

interface VirtualMessageRowProps {
  message: Message;
  showHeader: boolean;
  showSeparator: boolean;
  /** Day divider label above this row ("Today", "Thursday, October 22"). */
  dayLabel?: string;
  /** A fresh tail append: enters with list-enter once. */
  entering?: boolean;
  currentUserId?: string;
  canPin: boolean;
  canDeleteMessages: boolean;
  onReply: (message: Message) => void;
  onPin: (message: Message) => void;
  onUnpin: (messageId: string, skipConfirm?: boolean) => void;
  onJump: (messageId: string) => void;
  onBan?: (userId: string, username: string) => void;
  onThread?: (messageId: string) => void;
  onMediaPlay: (messageId: string) => void;
  onMediaStop: (messageId: string) => void;
  onMessageVisible?: (messageId: string) => void;
  onHeightChange: () => void;
}

const VirtualMessageRow = memo(function VirtualMessageRow({
  message,
  showHeader,
  showSeparator,
  dayLabel,
  entering = false,
  currentUserId,
  canPin,
  canDeleteMessages,
  onReply,
  onPin,
  onUnpin,
  onJump,
  onBan,
  onThread,
  onMediaPlay,
  onMediaStop,
  onMessageVisible,
  onHeightChange,
}: VirtualMessageRowProps) {
  const handleMediaPlay = useCallback(
    () => onMediaPlay(message.id),
    [message.id, onMediaPlay],
  );
  const handleMediaStop = useCallback(
    () => onMediaStop(message.id),
    [message.id, onMediaStop],
  );
  const handleVisible = useCallback(
    () => onMessageVisible?.(message.id),
    [message.id, onMessageVisible],
  );

  // No min-height: the estimate only seeds the virtualizer's itemSize, so a
  // row is exactly as tall as what it renders (no gap under short embeds).
  return (
    <div
      style={{ contain: "layout" }}
      className={entering ? "rm-list-enter" : undefined}
    >
      {dayLabel && <DayDivider label={dayLabel} iso={message.created_at} />}
      {showSeparator && <NewMessageSeparator />}
      <MessageItem
        id={`message-${message.id}`}
        message={message}
        showHeader={showHeader}
        currentUserId={currentUserId}
        canPin={canPin}
        canDeleteMessages={canDeleteMessages}
        onReply={onReply}
        onPin={onPin}
        onUnpin={onUnpin}
        onJump={onJump}
        onBan={onBan}
        onThread={onThread}
        onMediaPlay={handleMediaPlay}
        onMediaStop={handleMediaStop}
        onVisible={onMessageVisible ? handleVisible : undefined}
        onHeightChange={onHeightChange}
      />
    </div>
  );
});

VirtualMessageRow.displayName = "VirtualMessageRow";

// ── Main component ─────────────────────────────────────────────────────────

const VirtualMessageList = memo(
  forwardRef<VirtualMessageListHandle, Props>(
    (
      {
        messages,
        currentUserId,
        canPin,
        canDeleteMessages = false,
        hasMore,
        loading,
        isDetached = false,
        initialScrollMessageId = null,
        initialScrollAlign = "center",
        initialScrollBehavior = "auto",
        highlightInitialScroll = false,
        restoreInProgress = false,
        onInitialScrollSettled,
        welcomeContent,
        onLoadMore,
        onLoadAfter,
        onReply,
        onPin,
        onUnpin,
        onJump,
        onBan,
        onThread,
        onAtBottom,
        onScrollRangeChange,
        onMessageVisible,
        unreadSeparatorId,
      },
      ref,
    ) => {
      const safeMessages = useMemo(
        () => (Array.isArray(messages) ? messages : []),
        [messages],
      );
      const showLeadingDivider = !hasMore;
      const messageRows = useMemo(
        () =>
          buildMessageRows(safeMessages, unreadSeparatorId, showLeadingDivider),
        [safeMessages, unreadSeparatorId, showLeadingDivider],
      );
      const { dayLabel: formatDayLabel } = useMessageTimeFormat();
      // List-enter for tail appends only, never on first paint or history.
      const animateEnter = useAnimateEnter();
      const [stickyDay, setStickyDay] = useState<{
        key: string;
        iso: string;
        visible: boolean;
      } | null>(null);
      // Seed for rows virtua hasn't measured; computed once per mount so the
      // virtualizer's estimate doesn't change under it.
      const [itemSize] = useState(() => estimateListItemSize(messageRows));
      const [startMargin, setStartMargin] = useState(0);
      const headerRef = useRef<HTMLDivElement>(null);
      const showLeadingHeader = !hasMore && !loading;

      useLayoutEffect(() => {
        const el = headerRef.current;
        if (!el) {
          setStartMargin(0);
          return;
        }
        const update = () => setStartMargin(el.offsetHeight);
        update();
        if (typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver(update);
        observer.observe(el);
        return () => observer.disconnect();
      }, [showLeadingHeader, welcomeContent]);
      const messageIndexMap = useMemo(
        () => buildIndexMap(safeMessages),
        [safeMessages],
      );

      if (import.meta.env.DEV && !Array.isArray(messages)) {
        log.warn("Expected messages array", {
          receivedType: typeof messages,
          value: messages,
        });
      }

      const virtualizerRef = useRef<VirtualizerHandle>(null);
      const scrollContainerRef = useRef<HTMLDivElement>(null);
      const lastReportedStartIndexRef = useRef<number | null>(null);
      const isUserScrollingRef = useRef(false);
      const pendingStartReachedRef = useRef(false);
      const pendingEndReachedRef = useRef(false);

      const indexMapRef = useRef<Map<string, number>>(messageIndexMap);
      indexMapRef.current = messageIndexMap;

      // ── Stick-to-bottom tracking (from official Chat story) ──────────────
      // This ref tracks whether we should auto-scroll when items change.
      // Updated on every scroll event using virtua's exact formula.
      const shouldStickToBottom = useRef(true);
      const prevIsAtBottomRef = useRef(true);
      const restoreSettledRef = useRef(false);
      const scrollPendingRef = useRef(false);
      const scrollRunIdRef = useRef(0);

      // Gate to prevent loadMore from firing during initial scroll setup.
      // Enabled after the first render cycle settles via requestAnimationFrame.
      const canLoadMoreRef = useRef(false);

      const finishInitialRestore = useCallback(() => {
        if (restoreSettledRef.current) return;
        restoreSettledRef.current = true;
        onInitialScrollSettled?.();
      }, [onInitialScrollSettled]);

      // ── Track which indices should always stick around (e.g. playing media) ──
      const [activeMediaMessageIds, setActiveMediaMessageIds] = useState<
        string[]
      >([]);
      const activeMediaCountsRef = useRef(new Map<string, number>());
      const mediaContextKey = `${isDetached ? "detached" : "attached"}:${initialScrollMessageId ?? ""}`;
      const activeMediaContextRef = useRef(mediaContextKey);
      if (activeMediaContextRef.current !== mediaContextKey) {
        activeMediaContextRef.current = mediaContextKey;
        activeMediaCountsRef.current.clear();
        setActiveMediaMessageIds([]);
      }
      const keepMounted = useMemo(
        () =>
          activeMediaMessageIds.flatMap((messageId) => {
            const index = messageIndexMap.get(messageId);
            return index === undefined ? [] : [index];
          }),
        [activeMediaMessageIds, messageIndexMap],
      );
      const handleMediaPlay = useCallback((messageId: string) => {
        activeMediaCountsRef.current.set(
          messageId,
          (activeMediaCountsRef.current.get(messageId) ?? 0) + 1,
        );
        setActiveMediaMessageIds((prev) => {
          if (!prev.includes(messageId)) return [...prev, messageId];
          return prev;
        });
      }, []);
      const handleMediaStop = useCallback((messageId: string) => {
        const nextCount = Math.max(
          0,
          (activeMediaCountsRef.current.get(messageId) ?? 0) - 1,
        );
        if (nextCount === 0) activeMediaCountsRef.current.delete(messageId);
        else activeMediaCountsRef.current.set(messageId, nextCount);
        if (nextCount > 0) return;

        setActiveMediaMessageIds((prev) =>
          prev.filter((activeMessageId) => activeMessageId !== messageId),
        );
      }, []);

      // ── Prepend tracking ─────────────────────────────────────────────────
      // Detect prepends at render time by comparing first AND last message IDs.
      // A true prepend: first message changed, last message stayed the same
      // (items were added at the start, end is unchanged).
      // A full replacement (e.g. Jump to present): both first AND last change.
      // We must NOT set shift=true for full replacements.
      const prevFirstMsgIdRef = useRef<string | null>(
        safeMessages.length > 0 ? safeMessages[0].id : null,
      );
      const prevLastMsgIdRef = useRef<string | null>(
        safeMessages.length > 0
          ? safeMessages[safeMessages.length - 1].id
          : null,
      );
      const prevMessageCountRef = useRef(safeMessages.length);
      const firstMsgId = safeMessages.length > 0 ? safeMessages[0].id : null;
      const lastMsgId =
        safeMessages.length > 0
          ? safeMessages[safeMessages.length - 1].id
          : null;
      const lastMessage =
        safeMessages.length > 0 ? safeMessages[safeMessages.length - 1] : null;
      const wasPrepend =
        prevFirstMsgIdRef.current !== null &&
        firstMsgId !== null &&
        firstMsgId !== prevFirstMsgIdRef.current &&
        lastMsgId === prevLastMsgIdRef.current; // End stayed the same = true prepend
      if (wasPrepend) {
        lastReportedStartIndexRef.current = null;
      }
      const didAppendToEnd =
        prevFirstMsgIdRef.current !== null &&
        firstMsgId !== null &&
        firstMsgId === prevFirstMsgIdRef.current &&
        lastMsgId !== null &&
        lastMsgId !== prevLastMsgIdRef.current &&
        safeMessages.length > prevMessageCountRef.current;
      const didAppendOwnMessage =
        didAppendToEnd &&
        lastMessage?.author_id !== undefined &&
        lastMessage.author_id === currentUserId;

      // The tail message that just arrived (not a prepend, not the echo
      // replacing an optimistic row): it gets list-enter for one mount.
      const [enteringId, setEnteringId] = useState<string | null>(null);
      if (didAppendToEnd && lastMsgId !== null && lastMsgId !== enteringId) {
        setEnteringId(lastMsgId);
      }
      useEffect(() => {
        if (!enteringId) return;
        const timer = setTimeout(() => setEnteringId(null), ENTERING_MS);
        return () => clearTimeout(timer);
      }, [enteringId]);

      useLayoutEffect(() => {
        prevFirstMsgIdRef.current = firstMsgId;
        prevLastMsgIdRef.current = lastMsgId;
        prevMessageCountRef.current = safeMessages.length;
      });

      // Track whether initial scroll has been done
      const initialScrollDoneRef = useRef(false);

      // Key to force remount on context changes
      const [mountKey, setMountKey] = useState(0);
      const prevDetachedRef = useRef(isDetached);
      const prevInitialScrollIdRef = useRef(initialScrollMessageId);
      const previousDetached = prevDetachedRef.current;
      const previousInitialScrollMessageId = prevInitialScrollIdRef.current;
      const scrollIdChanged =
        initialScrollMessageId !== previousInitialScrollMessageId;
      const enteredDetached = isDetached && !previousDetached;
      const leftViaJumpToPresent =
        !isDetached && previousDetached && scrollIdChanged;
      const hasNonBottomScrollTarget =
        scrollIdChanged &&
        initialScrollMessageId !== null &&
        initialScrollMessageId !== "" &&
        initialScrollMessageId !== "BOTTOM";
      const shouldRemount =
        enteredDetached || leftViaJumpToPresent || hasNonBottomScrollTarget;

      // Apply restore-context changes before commit so the list never renders
      // with media pins or scroll state from the previous message context.
      if (shouldRemount) {
        scrollRunIdRef.current += 1;
        lastReportedStartIndexRef.current = null;
        isUserScrollingRef.current = false;
        pendingStartReachedRef.current = false;
        pendingEndReachedRef.current = false;
        setMessageListScrolling(false);
        setMountKey((k) => k + 1);
        initialScrollDoneRef.current = false;
        restoreSettledRef.current = false;
        canLoadMoreRef.current = false;
        shouldStickToBottom.current =
          !initialScrollMessageId || initialScrollMessageId === "BOTTOM";
      }

      prevDetachedRef.current = isDetached;
      prevInitialScrollIdRef.current = initialScrollMessageId;

      useEffect(() => {
        const activeMediaCounts = activeMediaCountsRef.current;
        return () => {
          scrollRunIdRef.current += 1;
          activeMediaCounts.clear();
          setMessageListScrolling(false);
        };
      }, []);

      // ── Highlight helper ───────────────────────────────────────────────────

      const highlightMessage = useCallback((messageId: string) => {
        let attempts = 0;
        const tryHighlight = () => {
          const el = document.getElementById(`message-${messageId}`);
          if (el) {
            // The row owns the look: `data-highlight=on` tints at once,
            // `off` lets the tint fade, then the attribute goes.
            el.dataset.highlight = "on";
            setTimeout(() => {
              el.dataset.highlight = "off";
              setTimeout(() => {
                if (el.dataset.highlight === "off") {
                  delete el.dataset.highlight;
                }
              }, HIGHLIGHT_FADE_MS);
            }, HIGHLIGHT_HOLD_MS);
          } else if (attempts < 15) {
            attempts++;
            setTimeout(tryHighlight, 100);
          }
        };
        tryHighlight();
      }, []);

      const scrollToBottomIndex = useCallback(
        (smooth = false) => {
          virtualizerRef.current?.scrollToIndex(
            Math.max(0, safeMessages.length - 1),
            {
              align: "end",
              smooth,
            },
          );
        },
        [safeMessages.length],
      );

      const scrollToVirtualIndex = useCallback(
        (
          targetIndex: number,
          options: {
            align: "start" | "center" | "end";
            behavior?: ScrollBehavior;
            preserveAnimation?: boolean;
            highlight?: boolean;
            highlightMessageId?: string;
            onSettled?: () => void;
          },
        ) => {
          const {
            align,
            behavior = "smooth",
            preserveAnimation = false,
            highlight = false,
            highlightMessageId,
            onSettled,
          } = options;
          const runId = ++scrollRunIdRef.current;
          const totalAttempts = preserveAnimation
            ? 3
            : behavior === "smooth"
              ? 6
              : 3;

          const runAttempt = (attempt: number) => {
            if (scrollRunIdRef.current !== runId) return;
            const shouldScrollNow =
              !preserveAnimation || attempt === totalAttempts;
            const useSmooth =
              behavior === "smooth" && attempt === totalAttempts;
            if (shouldScrollNow) {
              virtualizerRef.current?.scrollToIndex(targetIndex, {
                align,
                smooth: useSmooth,
              });
            }
            debugChatScroll("programmatic scroll attempt", {
              targetIndex,
              align,
              behavior,
              preserveAnimation,
              attempt,
              totalAttempts,
              scrolled: shouldScrollNow,
              smooth: useSmooth,
              scrollTop: scrollContainerRef.current?.scrollTop ?? null,
              scrollHeight: scrollContainerRef.current?.scrollHeight ?? null,
            });
            if (
              highlight &&
              highlightMessageId &&
              attempt === Math.min(2, totalAttempts)
            ) {
              highlightMessage(highlightMessageId);
            }
            if (attempt >= totalAttempts) {
              if (onSettled) {
                requestAnimationFrame(() => {
                  if (scrollRunIdRef.current !== runId) return;
                  requestAnimationFrame(() => {
                    if (scrollRunIdRef.current !== runId) return;
                    onSettled();
                  });
                });
              }
              return;
            }
            requestAnimationFrame(() => {
              if (scrollRunIdRef.current !== runId) return;
              requestAnimationFrame(() => {
                runAttempt(attempt + 1);
              });
            });
          };

          runAttempt(1);
        },
        [highlightMessage],
      );

      const handleHeightChange = useCallback(() => {
        if (shouldStickToBottom.current && !scrollPendingRef.current) {
          scrollPendingRef.current = true;
          requestAnimationFrame(() => {
            scrollPendingRef.current = false;
            scrollToBottomIndex();
          });
        }
      }, [scrollToBottomIndex]);

      // ── Stick-to-bottom: auto-scroll when items change ─────────────────────
      // ListHeader is Virtualizer child index 0, so the last message is at
      // index `messages.length` (not messages.length - 1).
      useEffect(() => {
        if (!virtualizerRef.current) return;
        const shouldRestoreInitialBottom =
          !canLoadMoreRef.current &&
          shouldStickToBottom.current &&
          !isDetached &&
          (!initialScrollMessageId || initialScrollMessageId === "BOTTOM");

        if (shouldRestoreInitialBottom) {
          debugChatScroll("stick to bottom", {
            messageCount: messages.length,
            safeMessageCount: safeMessages.length,
            scrollHeight: scrollContainerRef.current?.scrollHeight ?? null,
            scrollTop: scrollContainerRef.current?.scrollTop ?? null,
          });
          scrollToBottomIndex();
          // Re-run bottom alignment while ResizeObserver settles dynamic rows.
          requestAnimationFrame(() => {
            scrollToBottomIndex();
            requestAnimationFrame(() => {
              scrollToBottomIndex();
              if (!canLoadMoreRef.current) {
                canLoadMoreRef.current = true;
              }
              debugChatScroll("initial restore settled at bottom", {
                messageCount: messages.length,
                safeMessageCount: safeMessages.length,
                scrollHeight: scrollContainerRef.current?.scrollHeight ?? null,
                scrollTop: scrollContainerRef.current?.scrollTop ?? null,
              });
              finishInitialRestore();
            });
          });
        } else if (!canLoadMoreRef.current) {
          requestAnimationFrame(() => {
            canLoadMoreRef.current = true;
            debugChatScroll("initial restore settled without bottom stick", {
              messageCount: messages.length,
              safeMessageCount: safeMessages.length,
              isDetached,
              scrollHeight: scrollContainerRef.current?.scrollHeight ?? null,
              scrollTop: scrollContainerRef.current?.scrollTop ?? null,
            });
            finishInitialRestore();
          });
        } else if (
          !isDetached &&
          didAppendToEnd &&
          (shouldStickToBottom.current || didAppendOwnMessage)
        ) {
          if (didAppendOwnMessage) {
            shouldStickToBottom.current = true;
          }
          debugChatScroll("stick to bottom on tail append", {
            messageCount: messages.length,
            safeMessageCount: safeMessages.length,
            didAppendOwnMessage,
            scrollHeight: scrollContainerRef.current?.scrollHeight ?? null,
            scrollTop: scrollContainerRef.current?.scrollTop ?? null,
          });
          scrollToBottomIndex();
        }
      }, [
        currentUserId,
        didAppendOwnMessage,
        didAppendToEnd,
        finishInitialRestore,
        initialScrollMessageId,
        isDetached,
        messages.length,
        safeMessages.length,
        scrollToBottomIndex,
      ]);

      // ── Initial scroll to specific message ID ──────────────────────────────
      useEffect(() => {
        if (initialScrollDoneRef.current) return;
        if (safeMessages.length === 0) return;

        if (!initialScrollMessageId || initialScrollMessageId === "BOTTOM") {
          // The stick-to-bottom effect above handles BOTTOM.
          // shouldStickToBottom starts as true, so first render scrolls to end.
          debugChatScroll("initial scroll target is bottom", {
            messageCount: messages.length,
            safeMessageCount: safeMessages.length,
            initialScrollMessageId,
          });
          initialScrollDoneRef.current = true;
          return;
        }

        const targetIdx = indexMapRef.current.get(initialScrollMessageId);
        if (targetIdx !== undefined) {
          debugChatScroll("initial scroll target found", {
            messageId: initialScrollMessageId,
            targetIdx,
            align: initialScrollAlign,
            messageCount: messages.length,
            safeMessageCount: safeMessages.length,
          });
          shouldStickToBottom.current = false;
          scrollToVirtualIndex(targetIdx, {
            align: initialScrollAlign as "start" | "center" | "end",
            behavior: initialScrollBehavior,
            preserveAnimation: initialScrollBehavior === "smooth",
            highlight: highlightInitialScroll,
            highlightMessageId: initialScrollMessageId,
            onSettled: () => {
              initialScrollDoneRef.current = true;
              finishInitialRestore();
            },
          });
        }
      }, [
        safeMessages.length,
        messages.length,
        initialScrollMessageId,
        initialScrollAlign,
        initialScrollBehavior,
        highlightInitialScroll,
        mountKey,
        finishInitialRestore,
        scrollToVirtualIndex,
      ]);

      // ── Imperative handle ────────────────────────────────────────────────

      useImperativeHandle(
        ref,
        () => ({
          scrollToBottom(behavior: ScrollBehavior = "smooth") {
            scrollRunIdRef.current += 1;
            shouldStickToBottom.current = true;
            scrollToBottomIndex(behavior === "smooth");
            // Re-run once after measurement settles for dynamic-height rows.
            if (behavior !== "smooth") {
              requestAnimationFrame(() => {
                scrollToBottomIndex(false);
              });
            }
          },

          scrollToMessageId(
            messageId: string,
            align: "start" | "center" | "end" = "center",
            behavior: ScrollBehavior = "smooth",
            highlight = true,
          ) {
            const arrayIndex = indexMapRef.current.get(messageId);
            if (arrayIndex === undefined) return;
            shouldStickToBottom.current = false;
            scrollToVirtualIndex(arrayIndex, {
              align,
              behavior,
              preserveAnimation: behavior === "smooth",
              highlight,
              highlightMessageId: messageId,
            });
          },
        }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [safeMessages.length, scrollToBottomIndex, scrollToVirtualIndex],
      );

      // ── Load-more guards ─────────────────────────────────────────────────

      const loadingRef = useRef(false);
      const handleStartReached = useCallback(async () => {
        if (!hasMore || loadingRef.current) return;
        loadingRef.current = true;
        try {
          await onLoadMore();
        } finally {
          loadingRef.current = false;
        }
      }, [hasMore, onLoadMore]);

      const loadingAfterRef = useRef(false);
      const handleEndReached = useCallback(async () => {
        if (!onLoadAfter || loadingAfterRef.current) return;
        loadingAfterRef.current = true;
        try {
          await onLoadAfter();
        } finally {
          loadingAfterRef.current = false;
        }
      }, [onLoadAfter]);

      const setScrollingVisualState = useCallback((scrolling: boolean) => {
        isUserScrollingRef.current = scrolling;
        setMessageListScrolling(scrolling);
        scrollContainerRef.current?.classList.toggle("is-scrolling", scrolling);
      }, []);

      // ── Scroll event handler (from official Chat story) ──────────────────
      // ── Sticky day label ─────────────────────────────────────────────────
      // The day of the topmost row, pinned under the header, hidden while
      // that day's own divider is still on screen. State changes only when
      // the day (or visibility) changes, not per scroll frame.
      const rowsRef = useRef(messageRows);
      useLayoutEffect(() => {
        rowsRef.current = messageRows;
      }, [messageRows]);
      const startMarginRef = useRef(startMargin);
      useLayoutEffect(() => {
        startMarginRef.current = startMargin;
      }, [startMargin]);
      const updateStickyDay = useCallback((offset: number) => {
        const handle = virtualizerRef.current;
        if (!handle || typeof handle.findItemIndex !== "function") return;
        const rows = rowsRef.current;
        if (rows.length === 0) return;
        const index = Math.min(
          rows.length - 1,
          Math.max(0, handle.findItemIndex(offset)),
        );
        const row = rows[index];
        if (!row?.dayKey) return;
        const visible = isStickyDayVisible({
          scrollOffset: offset,
          startMargin: startMarginRef.current,
          rowTop:
            typeof handle.getItemOffset === "function"
              ? handle.getItemOffset(index)
              : 0,
          rowHasDivider: !!row.showDayDivider,
        });
        const iso = row.message.created_at;
        setStickyDay((current) =>
          current?.key === row.dayKey && current.visible === visible
            ? current
            : { key: row.dayKey as string, iso, visible },
        );
      }, []);

      const handleScroll = useCallback(
        (offset: number) => {
          if (!virtualizerRef.current) return;

          const { scrollSize, viewportSize } = virtualizerRef.current;

          if (!isUserScrollingRef.current) {
            setScrollingVisualState(true);
          }

          updateStickyDay(offset);

          const actualDistanceFromBottom = scrollContainerRef.current
            ? scrollContainerRef.current.scrollHeight -
              scrollContainerRef.current.scrollTop -
              scrollContainerRef.current.clientHeight
            : scrollSize - offset - viewportSize;
          const atBottom = actualDistanceFromBottom <= BOTTOM_LOCK_THRESHOLD_PX;

          shouldStickToBottom.current = atBottom;

          // Don't export scroll state during initial settling — intermediate
          // positions would overwrite "BOTTOM" in the parent's saved state.
          if (canLoadMoreRef.current) {
            if (atBottom !== prevIsAtBottomRef.current) {
              prevIsAtBottomRef.current = atBottom;
              debugChatScroll("at bottom changed", {
                atBottom,
                offset,
                scrollSize,
                viewportSize,
                distanceFromBottom: actualDistanceFromBottom,
              });
              onAtBottom?.(atBottom);
            }
          }

          pendingStartReachedRef.current =
            offset < HISTORY_FETCH_PX && hasMore && canLoadMoreRef.current;
          const distanceFromBottom = scrollSize - offset - viewportSize;
          pendingEndReachedRef.current =
            distanceFromBottom <= HISTORY_FETCH_PX &&
            !!onLoadAfter &&
            canLoadMoreRef.current;

          if (
            onScrollRangeChange &&
            canLoadMoreRef.current &&
            !restoreInProgress
          ) {
            const topChildIndex = virtualizerRef.current.findItemIndex(offset);
            const startIndex = Math.max(0, topChildIndex);
            if (startIndex !== lastReportedStartIndexRef.current) {
              lastReportedStartIndexRef.current = startIndex;
              debugChatScroll("range changed", {
                offset,
                scrollSize,
                viewportSize,
                topChildIndex,
                startIndex,
              });
            }
          }
        },
        [
          hasMore,
          onAtBottom,
          onLoadAfter,
          onScrollRangeChange,
          restoreInProgress,
          setScrollingVisualState,
          updateStickyDay,
        ],
      );

      const handleScrollEnd = useCallback(() => {
        setScrollingVisualState(false);

        if (pendingStartReachedRef.current) {
          pendingStartReachedRef.current = false;
          void handleStartReached();
        }
        if (pendingEndReachedRef.current) {
          pendingEndReachedRef.current = false;
          void handleEndReached();
        }

        if (
          onScrollRangeChange &&
          canLoadMoreRef.current &&
          !restoreInProgress &&
          lastReportedStartIndexRef.current != null
        ) {
          onScrollRangeChange(lastReportedStartIndexRef.current);
        }
      }, [
        handleEndReached,
        handleStartReached,
        onScrollRangeChange,
        restoreInProgress,
        setScrollingVisualState,
      ]);

      const renderVirtualItem = useCallback(
        (row: MessageRow) => (
          <VirtualMessageRow
            key={row.message.id}
            message={row.message}
            showHeader={row.showHeader}
            showSeparator={row.showSeparator}
            dayLabel={
              row.showDayDivider
                ? formatDayLabel(row.message.created_at)
                : undefined
            }
            entering={animateEnter && row.message.id === enteringId}
            currentUserId={currentUserId}
            canPin={canPin}
            canDeleteMessages={canDeleteMessages}
            onReply={onReply}
            onPin={onPin}
            onUnpin={onUnpin}
            onJump={onJump}
            onBan={onBan}
            onThread={onThread}
            onMediaPlay={handleMediaPlay}
            onMediaStop={handleMediaStop}
            onMessageVisible={onMessageVisible}
            onHeightChange={handleHeightChange}
          />
        ),
        [
          animateEnter,
          canDeleteMessages,
          canPin,
          currentUserId,
          enteringId,
          formatDayLabel,
          handleHeightChange,
          handleMediaPlay,
          handleMediaStop,
          onBan,
          onJump,
          onMessageVisible,
          onPin,
          onReply,
          onThread,
          onUnpin,
        ],
      );

      // ── Render ────────────────────────────────────────────────────────────

      if (safeMessages.length === 0) {
        return (
          <div className="flex-1 overflow-hidden p-4">
            <ListHeader
              hasMore={hasMore}
              loading={loading}
              hasMessages={false}
              welcomeContent={welcomeContent}
            />
          </div>
        );
      }

      const stickyLabel = stickyDay ? formatDayLabel(stickyDay.iso) : null;

      return (
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div
            key={mountKey}
            ref={scrollContainerRef}
            data-animate-enter={animateEnter || undefined}
            className={cn(
              "flex-1 overscroll-contain custom-scrollbar pb-2",
              "[&.is-scrolling>*]:pointer-events-none",
            )}
            style={{
              overflowY: "auto",
              height: "100%",
              // Opt out of browser's scroll anchoring — it conflicts with
              // virtua's own scroll anchoring via the shift prop.
              overflowAnchor: "none",
            }}
          >
            {showLeadingHeader && (
              <div ref={headerRef}>
                <ListHeader
                  hasMore={hasMore}
                  loading={loading}
                  hasMessages
                  welcomeContent={welcomeContent}
                />
              </div>
            )}
            <Virtualizer
              ref={virtualizerRef}
              data={messageRows}
              startMargin={startMargin}
              scrollRef={scrollContainerRef}
              shift={wasPrepend}
              onScroll={handleScroll}
              onScrollEnd={handleScrollEnd}
              bufferSize={VIRTUALIZER_BUFFER_PX}
              itemSize={itemSize}
              keepMounted={keepMounted}
            >
              {renderVirtualItem}
            </Virtualizer>
          </div>
          {stickyLabel && (
            <div
              aria-hidden
              data-visible={stickyDay?.visible ? "true" : "false"}
              className={cn(
                DIVIDER_ROW,
                "pointer-events-none absolute inset-x-0 top-0 z-10 h-7 border-b border-line bg-ply-0",
                // Opacity-only crossfade with the inline divider; never layout.
                "transition-opacity duration-100 ease-out motion-reduce:transition-none",
                stickyDay?.visible ? "opacity-100" : "opacity-0",
              )}
            >
              <DividerLabel>{stickyLabel}</DividerLabel>
            </div>
          )}
        </div>
      );
    },
  ),
);

VirtualMessageList.displayName = "VirtualMessageList";

export default VirtualMessageList;
