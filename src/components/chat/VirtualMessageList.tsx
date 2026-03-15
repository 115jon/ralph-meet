/**
 * VirtualMessageList
 *
 * Uses virtua's `Virtualizer` following the official Chat story pattern:
 *   - Flex container with a `flexGrow: 1` spacer pushes content to the bottom
 *   - `overflowAnchor: none` prevents browser scroll anchoring from conflicting
 *   - `shift` is enabled per-prepend (not always-on) for scroll stability
 *   - `shouldStickToBottom` tracks whether to auto-scroll on new messages
 *
 * Reference: https://github.com/inokawa/virtua/blob/main/stories/react/advanced/Chat.stories.tsx
 */

import type { Message } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  forwardRef,
  Fragment,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Virtualizer, type VirtualizerHandle } from "virtua";
import MessageItem from "./MessageItem";
import { NewMessageSeparator } from "./NewMessageSeparator";

type ScrollBehavior = "auto" | "smooth";

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
  hasMore: boolean;
  loading: boolean;
  isDetached?: boolean;
  initialScrollMessageId?: string | null;
  initialScrollAlign?: "start" | "center" | "end";
  highlightInitialScroll?: boolean;
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
  welcomeContent?: ReactNode;
}

const ListHeader = memo(({ hasMore, loading, welcomeContent }: HeaderProps) => {
  if (!hasMore && !loading) {
    return (
      <div className="animate-in fade-in slide-in-from-bottom-4 duration-1000">
        {welcomeContent}
      </div>
    );
  }
  if (loading) {
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
      hasMore,
      loading,
      isDetached = false,
      initialScrollMessageId = null,
      initialScrollAlign = "center",
      highlightInitialScroll = false,
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
      unreadSeparatorId,
    },
    ref
  ) => {
    const virtualizerRef = useRef<VirtualizerHandle>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);

    const indexMapRef = useRef<Map<string, number>>(buildIndexMap(messages));
    indexMapRef.current = buildIndexMap(messages);

    // ── Stick-to-bottom tracking (from official Chat story) ──────────────
    // This ref tracks whether we should auto-scroll when items change.
    // Updated on every scroll event using virtua's exact formula.
    const shouldStickToBottom = useRef(true);
    const prevIsAtBottomRef = useRef(true);

    // Gate to prevent loadMore from firing during initial scroll setup.
    // Enabled after the first render cycle settles via requestAnimationFrame.
    const canLoadMoreRef = useRef(false);

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
      messages.length > 0 ? messages[0].id : null
    );
    const prevLastMsgIdRef = useRef<string | null>(
      messages.length > 0 ? messages[messages.length - 1].id : null
    );
    const firstMsgId = messages.length > 0 ? messages[0].id : null;
    const lastMsgId = messages.length > 0 ? messages[messages.length - 1].id : null;
    const wasPrepend =
      prevFirstMsgIdRef.current !== null &&
      firstMsgId !== null &&
      firstMsgId !== prevFirstMsgIdRef.current &&
      lastMsgId === prevLastMsgIdRef.current; // End stayed the same = true prepend

    useLayoutEffect(() => {
      prevFirstMsgIdRef.current = firstMsgId;
      prevLastMsgIdRef.current = lastMsgId;
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
      const detachedChanged = isDetached !== prevDetachedRef.current;
      const scrollIdChanged =
        initialScrollMessageId !== prevInitialScrollIdRef.current;

      // Only remount when ENTERING detached mode (new jump target), or
      // when leaving it via "Jump to Present" (which reloads messages).
      // Forward pagination (handleLoadAfter) only changes isDetached without
      // changing scrollId, so it doesn't remount — keeps scroll position.
      const enteredDetached = isDetached && !prevDetachedRef.current;
      const leftViaJumpToPresent =
        !isDetached && prevDetachedRef.current && scrollIdChanged;

      if (
        enteredDetached ||
        leftViaJumpToPresent ||
        (scrollIdChanged &&
          initialScrollMessageId &&
          initialScrollMessageId !== "BOTTOM")
      ) {
        setMountKey((k) => k + 1);
        initialScrollDoneRef.current = false;
        canLoadMoreRef.current = false;
        shouldStickToBottom.current =
          !initialScrollMessageId || initialScrollMessageId === "BOTTOM";
      }

      prevDetachedRef.current = isDetached;
      prevInitialScrollIdRef.current = initialScrollMessageId;
    }, [isDetached, initialScrollMessageId]);

    // ── Highlight helper ───────────────────────────────────────────────────

    const highlightMessage = useCallback((messageId: string) => {
      let attempts = 0;
      const tryHighlight = () => {
        const el = document.getElementById(`message-${messageId}`);
        if (el) {
          el.classList.add("bg-indigo-500/10");
          setTimeout(() => el.classList.remove("bg-indigo-500/10"), 2000);
        } else if (attempts < 15) {
          attempts++;
          setTimeout(tryHighlight, 100);
        }
      };
      tryHighlight();
    }, []);

    // ── Stick-to-bottom: auto-scroll when items change ─────────────────────
    // ListHeader is Virtualizer child index 0, so the last message is at
    // index `messages.length` (not messages.length - 1).
    useEffect(() => {
      if (!virtualizerRef.current) return;
      if (shouldStickToBottom.current && !isDetached) {
        virtualizerRef.current.scrollToIndex(messages.length, {
          align: "end",
        });
        // Correct to actual pixel bottom after ResizeObserver measures sizes.
        // Double rAF: first frame lets ResizeObserver process, second catches
        // any remaining measurement settling.
        requestAnimationFrame(() => {
          if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollTop =
              scrollContainerRef.current.scrollHeight;
          }
          requestAnimationFrame(() => {
            if (scrollContainerRef.current) {
              scrollContainerRef.current.scrollTop =
                scrollContainerRef.current.scrollHeight;
            }
            if (!canLoadMoreRef.current) {
              canLoadMoreRef.current = true;
            }
          });
        });
      } else if (!canLoadMoreRef.current) {
        requestAnimationFrame(() => {
          canLoadMoreRef.current = true;
        });
      }
    }, [messages, isDetached]);

    // ── Initial scroll to specific message ID ──────────────────────────────
    useEffect(() => {
      if (initialScrollDoneRef.current) return;
      if (messages.length === 0) return;

      if (!initialScrollMessageId || initialScrollMessageId === "BOTTOM") {
        // The stick-to-bottom effect above handles BOTTOM.
        // shouldStickToBottom starts as true, so first render scrolls to end.
        initialScrollDoneRef.current = true;
        return;
      }

      const targetIdx = indexMapRef.current.get(initialScrollMessageId);
      if (targetIdx !== undefined) {
        shouldStickToBottom.current = false;
        let attempts = 0;
        const interval = setInterval(() => {
          attempts++;
          // +1 offset for ListHeader at index 0
          // First few attempts are instant to stabilize as sizes are measured,
          // then animate smoothly for a polished landing.
          const useSmooth = attempts > 3;
          virtualizerRef.current?.scrollToIndex(targetIdx + 1, {
            align: initialScrollAlign as "start" | "center" | "end",
            smooth: useSmooth,
          });
          if (attempts === 2 && highlightInitialScroll) highlightMessage(initialScrollMessageId);
          if (attempts > 5) {
            clearInterval(interval);
            initialScrollDoneRef.current = true;
          }
        }, 60);
        return () => clearInterval(interval);
      }
    }, [
      messages.length,
      initialScrollMessageId,
      initialScrollAlign,
      mountKey,
      highlightMessage,
    ]);

    // ── Imperative handle ────────────────────────────────────────────────

    useImperativeHandle(
      ref,
      () => ({
        scrollToBottom(behavior: ScrollBehavior = "smooth") {
          shouldStickToBottom.current = true;
          // +1 offset for ListHeader at index 0
          virtualizerRef.current?.scrollToIndex(messages.length, {
            align: "end",
            smooth: behavior === "smooth",
          });
          // For instant scroll, correct to absolute pixel bottom after measurement
          if (behavior !== "smooth") {
            requestAnimationFrame(() => {
              if (scrollContainerRef.current) {
                scrollContainerRef.current.scrollTop =
                  scrollContainerRef.current.scrollHeight;
              }
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
          // +1 offset for ListHeader at index 0
          virtualizerRef.current?.scrollToIndex(arrayIndex + 1, {
            align,
            smooth: behavior === "smooth",
          });
          if (highlight) {
            setTimeout(() => highlightMessage(messageId), 300);
          }
        },
      }),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [messages.length]
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

        // At-bottom detection with generous threshold to handle
        // size estimation drift from ResizeObserver measurements.
        // The official Chat story uses -1.5, but that's too tight when
        // items have dynamic content (images, embeds) that changes height.
        const atBottom =
          offset - scrollSize + viewportSize >= -50;

        shouldStickToBottom.current = atBottom;

        // Don't export scroll state during initial settling — intermediate
        // positions would overwrite "BOTTOM" in the parent's saved state.
        if (canLoadMoreRef.current) {
          if (atBottom !== prevIsAtBottomRef.current) {
            prevIsAtBottomRef.current = atBottom;
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

        if (onScrollRangeChange && canLoadMoreRef.current) {
          // -1 to convert Virtualizer child index to message array index
          // (ListHeader is child 0)
          const topChildIndex = virtualizerRef.current.findItemIndex(offset);
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
      ]
    );

    // ── Render ────────────────────────────────────────────────────────────

    if (messages.length === 0) {
      return (
        <div className="flex-1 overflow-hidden p-4">
          <ListHeader
            hasMore={hasMore}
            loading={loading}
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
          bufferSize={3000}
          keepMounted={keepMounted}
        >
          <ListHeader
            hasMore={hasMore}
            loading={loading}
            welcomeContent={welcomeContent}
          />

          {messages.map((msg, index) => {
            let showHeader = true;
            if (index > 0) {
              const prev = messages[index - 1];
              if (prev) {
                const hasSameAuthor = prev.author_id === msg.author_id;
                const hasNoReply = !msg.reply_to_id;
                if (hasSameAuthor && hasNoReply) {
                  const prevTime = new Date(prev.created_at).getTime();
                  const curTime = new Date(msg.created_at).getTime();
                  showHeader = curTime - prevTime > 5 * 60 * 1000;
                }
              }
            }

            const showSeparator = unreadSeparatorId === msg.id;

            return (
              <Fragment key={msg.id}>
                {showSeparator && <NewMessageSeparator />}
                <MessageItem
                  id={`message-${msg.id}`}
                  message={msg}
                  showHeader={showHeader || showSeparator}
                  currentUserId={currentUserId}
                  canPin={canPin}
                  onReply={onReply}
                  onPin={onPin}
                  onUnpin={onUnpin}
                  onJump={onJump}
                  onBan={onBan}
                  onThread={onThread}
                  onMediaPlay={() => handleMediaPlay(index)}
                />
              </Fragment>
            );
          })}
        </Virtualizer>
      </div>
    );
  }
);

VirtualMessageList.displayName = "VirtualMessageList";

export default VirtualMessageList;
