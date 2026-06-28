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
import { NewMessageSeparator } from "./NewMessageSeparator";

const log = clog("VirtualMessageList");

type ScrollBehavior = "auto" | "smooth";

const BOTTOM_LOCK_THRESHOLD_PX = 12;

// ── Public ref API ─────────────────────────────────────────────────────────

export interface VirtualMessageListHandle {
  scrollToBottom(behavior?: ScrollBehavior): void;
  scrollToMessageId(
    messageId: string,
    align?: "start" | "center" | "end",
    behavior?: ScrollBehavior,
    highlight?: boolean
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

interface MessageRow {
  message: Message;
  arrayIndex: number;
  showHeader: boolean;
  showSeparator: boolean;
}

function buildMessageRows(messages: Message[], unreadSeparatorId?: string | null): MessageRow[] {
  return messages.map((message, index) => {
    let showHeader = true;
    if (index > 0) {
      const prev = messages[index - 1];
      if (prev) {
        const hasSameAuthor = prev.author_id === message.author_id;
        const hasNoReply = !message.reply_to_id;
        if (hasSameAuthor && hasNoReply) {
          const prevTime = new Date(prev.created_at).getTime();
          const curTime = new Date(message.created_at).getTime();
          showHeader = curTime - prevTime > 5 * 60 * 1000;
        }
      }
    }

    const showSeparator = unreadSeparatorId === message.id;

    return {
      message,
      arrayIndex: index,
      showHeader: showHeader || showSeparator,
      showSeparator,
    };
  });
}

// ── Sub-components ─────────────────────────────────────────────────────────

function MessageSkeleton({ compact = false }: { compact?: boolean }) {
  return (
    <div className={cn("flex gap-4 px-4", compact ? "py-0.5" : "pt-4 pb-1")}>
      {!compact && (
        <div className="mt-0.5 h-10 w-10 shrink-0 animate-pulse rounded-full bg-rm-bg-hover" />
      )}
      {compact && <div className="w-10 shrink-0" />}
      <div className="flex flex-1 flex-col gap-2 justify-center">
        {!compact && (
          <div className="flex items-center gap-3">
            <div className="h-3.5 w-24 animate-pulse rounded bg-rm-bg-hover" />
            <div className="h-3 w-16 animate-pulse rounded bg-rm-bg-hover opacity-50" />
          </div>
        )}
        <div
          className="h-3.5 animate-pulse rounded bg-rm-bg-hover"
          style={{ width: `${compact ? 45 : 65}%` }}
        />
        {!compact && (
          <div className="h-3.5 w-2/5 animate-pulse rounded bg-rm-bg-hover" />
        )}
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

const ListHeader = memo(({ hasMore, loading, hasMessages, welcomeContent }: HeaderProps) => {
  if (!hasMore && !loading) {
    return (
      <div className="animate-in fade-in slide-in-from-bottom-4 duration-1000">
        {welcomeContent}
      </div>
    );
  }
  if (loading && !hasMessages) {
    return (
      <div className="pb-2 animate-in fade-in duration-300">
        <SkeletonGroup />
        <SkeletonGroup />
        <SkeletonGroup />
      </div>
    );
  }
  return null;
});
ListHeader.displayName = "ListHeader";

// ── Main component ─────────────────────────────────────────────────────────

const VirtualMessageList = forwardRef<VirtualMessageListHandle, Props>(
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
    ref
  ) => {
    const safeMessages = useMemo(() => (Array.isArray(messages) ? messages : []), [messages]);
    const messageRows = useMemo(
      () => buildMessageRows(safeMessages, unreadSeparatorId),
      [safeMessages, unreadSeparatorId]
    );
    const messageIndexMap = useMemo(() => buildIndexMap(safeMessages), [safeMessages]);

    if (import.meta.env.DEV && !Array.isArray(messages)) {
      log.warn("Expected messages array", {
        receivedType: typeof messages,
        value: messages,
      });
    }

    const virtualizerRef = useRef<VirtualizerHandle>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);

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
    const [keepMounted, setKeepMounted] = useState<number[]>([]);
    const handleMediaPlay = useCallback((index: number) => {
      // +1 offset for ListHeader at index 0
      const vIndex = index + 1;
      setKeepMounted((prev) => {
        if (!prev.includes(vIndex)) return [...prev, vIndex];
        return prev;
      });
    }, []);

    // ── Prepend tracking ─────────────────────────────────────────────────
    // Detect prepends at render time by comparing first AND last message IDs.
    // A true prepend: first message changed, last message stayed the same
    // (items were added at the start, end is unchanged).
    // A full replacement (e.g. Jump to Present): both first AND last change.
    // We must NOT set shift=true for full replacements.
    const prevFirstMsgIdRef = useRef<string | null>(
      safeMessages.length > 0 ? safeMessages[0].id : null
    );
    const prevLastMsgIdRef = useRef<string | null>(
      safeMessages.length > 0 ? safeMessages[safeMessages.length - 1].id : null
    );
    const prevMessageCountRef = useRef(safeMessages.length);
    const firstMsgId = safeMessages.length > 0 ? safeMessages[0].id : null;
    const lastMsgId = safeMessages.length > 0 ? safeMessages[safeMessages.length - 1].id : null;
    const lastMessage = safeMessages.length > 0 ? safeMessages[safeMessages.length - 1] : null;
    const wasPrepend =
      prevFirstMsgIdRef.current !== null &&
      firstMsgId !== null &&
      firstMsgId !== prevFirstMsgIdRef.current &&
      lastMsgId === prevLastMsgIdRef.current; // End stayed the same = true prepend
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

    useEffect(() => {
      // Clear keepMounted if we are jumping far away
      setKeepMounted([]);
      const scrollIdChanged =
        initialScrollMessageId !== prevInitialScrollIdRef.current;

      // Only remount when ENTERING detached mode (new jump target), or
      // when leaving it via "Jump to Present" (which reloads messages).
      // Forward pagination (handleLoadAfter) only changes isDetached without
      // changing scrollId, so it doesn't remount — keeps scroll position.
      const enteredDetached = isDetached && !prevDetachedRef.current;
      const leftViaJumpToPresent =
        !isDetached && prevDetachedRef.current && scrollIdChanged;

      debugChatScroll("restore context", {
        isDetached,
        previousDetached: prevDetachedRef.current,
        initialScrollMessageId,
        previousInitialScrollMessageId: prevInitialScrollIdRef.current,
        scrollIdChanged,
        enteredDetached,
        leftViaJumpToPresent,
      });

      if (
        enteredDetached ||
        leftViaJumpToPresent ||
        (scrollIdChanged &&
          initialScrollMessageId &&
          initialScrollMessageId !== "BOTTOM")
      ) {
        scrollRunIdRef.current += 1;
        setMountKey((k) => k + 1);
        initialScrollDoneRef.current = false;
        restoreSettledRef.current = false;
        canLoadMoreRef.current = false;
        shouldStickToBottom.current =
          !initialScrollMessageId || initialScrollMessageId === "BOTTOM";
      }

      prevDetachedRef.current = isDetached;
      prevInitialScrollIdRef.current = initialScrollMessageId;
    }, [isDetached, initialScrollMessageId]);

    useEffect(() => {
    return () => {
        scrollRunIdRef.current += 1;
      };
    }, []);

    // ── Highlight helper ───────────────────────────────────────────────────

    const highlightMessage = useCallback((messageId: string) => {
      let attempts = 0;
      const tryHighlight = () => {
        const el = document.getElementById(`message-${messageId}`);
        if (el) {
          el.classList.add("bg-rm-accent/10");
          setTimeout(() => el.classList.remove("bg-rm-accent/10"), 2000);
        } else if (attempts < 15) {
          attempts++;
          setTimeout(tryHighlight, 100);
        }
      };
      tryHighlight();
    }, []);

    const scrollToBottomIndex = useCallback(
      (smooth = false) => {
        virtualizerRef.current?.scrollToIndex(safeMessages.length, {
          align: "end",
          smooth,
        });
      },
      [safeMessages.length]
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
        }
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
        const totalAttempts = preserveAnimation ? 3 : behavior === "smooth" ? 6 : 3;

        const runAttempt = (attempt: number) => {
          if (scrollRunIdRef.current !== runId) return;
          const shouldScrollNow = !preserveAnimation || attempt === totalAttempts;
          const useSmooth = behavior === "smooth" && attempt === totalAttempts;
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
          if (highlight && highlightMessageId && attempt === Math.min(2, totalAttempts)) {
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
      [highlightMessage]
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
      } else if (!isDetached && didAppendToEnd && (shouldStickToBottom.current || didAppendOwnMessage)) {
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
        scrollToVirtualIndex(targetIdx + 1, {
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
          highlight = true
        ) {
          const arrayIndex = indexMapRef.current.get(messageId);
          if (arrayIndex === undefined) return;
          shouldStickToBottom.current = false;
          scrollToVirtualIndex(arrayIndex + 1, {
            align,
            behavior,
            preserveAnimation: behavior === "smooth",
            highlight,
            highlightMessageId: messageId,
          });
        },
      }),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [safeMessages.length, scrollToBottomIndex, scrollToVirtualIndex]
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

    // ── Scroll event handler (from official Chat story) ──────────────────
    const handleScroll = useCallback(
      (offset: number) => {
        if (!virtualizerRef.current) return;

        const { scrollSize, viewportSize } = virtualizerRef.current;

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

        // Trigger loadMore well before reaching the absolute top (800px buffer)
        // so the fetch starts while the user is still scrolling. canLoadMoreRef
        // prevents loading during initial setup.
        if (offset < 800 && hasMore && canLoadMoreRef.current) {
          handleStartReached();
        }

        // Bottom reached for loading after (detached mode) — trigger early
        const distanceFromBottom = scrollSize - offset - viewportSize;
        if (distanceFromBottom <= 800 && onLoadAfter && canLoadMoreRef.current) {
          handleEndReached();
        }

        if (onScrollRangeChange && canLoadMoreRef.current && !restoreInProgress) {
          // -1 to convert Virtualizer child index to message array index
          // (ListHeader is child 0)
          const topChildIndex = virtualizerRef.current.findItemIndex(offset);
          debugChatScroll("range changed", {
            offset,
            scrollSize,
            viewportSize,
            topChildIndex,
            startIndex: Math.max(0, topChildIndex - 1),
          });
          onScrollRangeChange(Math.max(0, topChildIndex - 1));
        }
      },
      [
        onAtBottom,
        hasMore,
        handleStartReached,
        onLoadAfter,
        handleEndReached,
        onScrollRangeChange,
        restoreInProgress,
      ]
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

    return (
      <div
        key={mountKey}
        ref={scrollContainerRef}
        className={cn("flex-1 custom-scrollbar")}
        style={{
          overflowY: "auto",
          height: "100%",
          // Opt out of browser's scroll anchoring — it conflicts with
          // virtua's own scroll anchoring via the shift prop.
          overflowAnchor: "none",
        }}
      >
        <Virtualizer
          ref={virtualizerRef}
          scrollRef={scrollContainerRef}
          shift={wasPrepend}
          onScroll={handleScroll}
          bufferSize={1200}
          keepMounted={keepMounted}
        >
          <ListHeader
            hasMore={hasMore}
            loading={loading}
            hasMessages={safeMessages.length > 0}
            welcomeContent={welcomeContent}
          />

          {messageRows.map(({ message: msg, arrayIndex, showHeader, showSeparator }) => {
            return (
              <div key={msg.id}>
                {showSeparator && <NewMessageSeparator />}
                <MessageItem
                  id={`message-${msg.id}`}
                  message={msg}
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
                  onMediaPlay={() => handleMediaPlay(arrayIndex)}
                  onVisible={onMessageVisible ? () => onMessageVisible(msg.id) : undefined}
                  onHeightChange={handleHeightChange}
                />
              </div>
            );
          })}
        </Virtualizer>
      </div>
    );
  }
);

VirtualMessageList.displayName = "VirtualMessageList";

export default VirtualMessageList;
