
/**
 * VirtualMessageList
 *
 * Wraps react-virtuoso's `Virtuoso` to provide a Discord-style bottom-anchored
 * virtual message list. Exposed via a React ref so ChatArea can programmatically
 * scroll without prop-drilling.
 *
 * Key react-virtuoso behaviours used:
 *   - `followOutput`          – auto-scroll when user is near bottom
 *   - `firstItemIndex`        – decremented on prepend to keep viewport stable
 *   - `startReached`          – fires onLoadMore when user scrolls to top
 *   - `initialTopMostItemIndex` – starts list at the last item (bottom)
 *   - `components.Header`     – loading spinner / welcome banner above messages
 */

import type { Message } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useReducer,
  useRef,
  type ReactNode
} from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import MessageItem from "./MessageItem";

/** react-virtuoso only accepts 'auto' | 'smooth' for behavior. */
type VirtuosoScrollBehavior = "auto" | "smooth";

// ── Public ref API ─────────────────────────────────────────────────────────

export interface VirtualMessageListHandle {
  /** Scroll to the very bottom (e.g. on send). */
  scrollToBottom(behavior?: VirtuosoScrollBehavior): void;
  /** Scroll to and highlight a specific message by its ID. */
  scrollToMessageId(messageId: string): void;
}

// ── Props ──────────────────────────────────────────────────────────────────

interface Props {
  messages: Message[];
  currentUserId?: string;
  canPin: boolean;
  hasMore: boolean;
  loading: boolean;
  /** When true we are viewing an anchor context window — disable auto-scroll. */
  isDetached?: boolean;
  /** Upon mount/remount, if provided, Virtuoso will start exactly at this message. */
  initialScrollMessageId?: string | null;
  /** Rendered inside Header when !hasMore — the channel welcome banner. */
  welcomeContent?: ReactNode;
  onLoadMore: () => Promise<void> | void;
  /** Called when the user scrolls to the bottom in detached mode. */
  onLoadAfter?: () => Promise<void> | void;
  onReply: (message: Message) => void;
  onPin: (message: Message) => void;
  onUnpin: (messageId: string, skipConfirm?: boolean) => void;
  onJump: (messageId: string) => void;
  onBan?: (userId: string, username: string) => void;
  onThread?: (messageId: string) => void;
}

/**
 * Build a map of messageId → 0-based array index.
 *
 * react-virtuoso's scrollToIndex takes 0-based array indices in the range
 * [0, totalCount-1], same as initialTopMostItemIndex. The firstItemIndex
 * offset only affects the index value that is passed INTO itemContent; it
 * does NOT affect what scrollToIndex expects.
 *
 * Source: VirtuosoProps.initialTopMostItemIndex docs:
 *   "Set to a value between 0 and totalCount - 1"
 */
function buildIndexMap(messages: Message[]): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < messages.length; i++) {
    map.set(messages[i].id, i);
  }
  return map;
}

// ── Sub-component: MessageSkeleton ─────────────────────────────────────────

/** Single shimmer row — approximates a message with avatar + text lines. */
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

/** A cluster of skeletons that loosely resembles a group of chat messages. */
function SkeletonGroup() {
  return (
    <>
      <MessageSkeleton compact={false} />
      <MessageSkeleton compact />
      <MessageSkeleton compact />
    </>
  );
}

// ── Sub-component: Header ──────────────────────────────────────────────────

interface HeaderProps {
  hasMore: boolean;
  loading: boolean;
  welcomeContent?: ReactNode;
}

const ListHeader = memo(({ hasMore, loading, welcomeContent }: HeaderProps) => {
  if (!hasMore && !loading) {
    // Reached the very beginning of history — show the welcome banner
    return (
      <div className="animate-in fade-in slide-in-from-bottom-4 duration-1000">
        {welcomeContent}
      </div>
    );
  }

  if (loading) {
    // Auto-loading older messages — show shimmering skeletons
    return (
      <div className="pb-2 animate-in fade-in duration-300">
        <SkeletonGroup />
        <SkeletonGroup />
        <SkeletonGroup />
      </div>
    );
  }

  // hasMore but not loading — nothing to show (startReached will trigger soon)
  return null;
});
ListHeader.displayName = "ListHeader";

// ── Main component ─────────────────────────────────────────────────────────

/**
 * IMPORTANT: This component uses a large `firstItemIndex` starting value so
 * that prepending older messages can simply decrement it without remounting
 * items. The pattern follows the react-virtuoso "prepend items" cookbook.
 * See: https://virtuoso.dev/prepend-items/
 */
const START_INDEX = 100_000;

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
      welcomeContent,
      onLoadMore,
      onLoadAfter,
      onReply,
      onPin,
      onUnpin,
      onJump,
      onBan,
      onThread,
    },
    ref
  ) => {
    const virtuosoRef = useRef<VirtuosoHandle>(null);

    // ── firstItemIndex: true prepend-only tracking ──────────────────────
    // CRITICAL: firstItemIndex must ONLY decrement when messages are prepended
    // at the top (backward scroll / loadMore). If it were computed as
    // START_INDEX - messages.length, appending at the bottom would also
    // shrink it, causing Virtuoso to interpret forward appends as prepends.
    const [virtuosoState, dispatchVirtuoso] = useReducer(
      (state: { firstItemIndex: number; anchorKey: number }, action: any) => {
        if (typeof action === "function") {
          return { ...state, ...action(state) };
        }
        return { ...state, ...action };
      },
      {
        firstItemIndex: START_INDEX - messages.length,
        anchorKey: 0,
      }
    );
    const { firstItemIndex, anchorKey } = virtuosoState;

    const prevFirstMsgIdRef = useRef<string | undefined>(messages[0]?.id);
    const prevMsgLengthRef = useRef(messages.length);
    const prevDetachedRef = useRef(isDetached);
    const prevInitialScrollIdRef = useRef(initialScrollMessageId);

    // If detached mode changes, or the first message completely changes in detached mode,
    // we must reset the virtual index anchor to prevent Virtuoso from glitching out due to
    // massive index gaps. This effectively gives Virtuoso a clean slate.
    useEffect(() => {
      const currFirstId = messages[0]?.id;
      const prevFirstId = prevFirstMsgIdRef.current;
      const currLen = messages.length;
      const prevLen = prevMsgLengthRef.current;
      const wasDetached = prevDetachedRef.current;

      const isModeChange = isDetached !== wasDetached;
      const isFirstIdChange = currFirstId !== prevFirstId;

      if (!isModeChange && isFirstIdChange && currLen > prevLen) {
        // We prepended messages (scrolled up in live tail OR detached mode)
        // Adjust firstItemIndex to maintain stable scroll position. Do not remount.

        dispatchVirtuoso((prev: any) => ({
          firstItemIndex: prev.firstItemIndex - (currLen - prevLen)
        }));
      } else if (isModeChange || isFirstIdChange) {
        // Completely new context window. Remount Virtuoso to reset index anchor.
        dispatchVirtuoso((prev: any) => ({
          firstItemIndex: START_INDEX - currLen,
          anchorKey: prev.anchorKey + 1
        }));
      }

      prevFirstMsgIdRef.current = currFirstId;
      prevMsgLengthRef.current = currLen;
      prevDetachedRef.current = isDetached;
      prevInitialScrollIdRef.current = initialScrollMessageId;
    }, [messages, isDetached, initialScrollMessageId]);

    // Helper to highlight a message — retries until DOM element exists (Virtuoso
    // may not have rendered the item yet after a remount).
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

    // Fallback: If Virtuoso ignores intialTopMostItemIndex due to rapid remounting + array growth,
    // explicit component-driven scroll bypasses it safely.
    useLayoutEffect(() => {
      // Only fire scroll if an initialScrollId is given
      if (!initialScrollMessageId) return;
      if (messages.length === 0) return;

      const targetIdx = indexMapRef.current.get(initialScrollMessageId);
      if (targetIdx !== undefined) {
        // scrollToIndex expects 0-based array indices, NOT shifted by firstItemIndex.
        const t = setTimeout(() => {
          virtuosoRef.current?.scrollToIndex({
            index: targetIdx,
            align: "center",
            behavior: "auto"
          });
          highlightMessage(initialScrollMessageId);
        }, 250);
        return () => clearTimeout(t);
      }
    }, [messages, isDetached, initialScrollMessageId, anchorKey, highlightMessage]);

    // Build messageId → 0-based array index. Updated every render.
    // scrollToIndex expects 0-based indices, same range as initialTopMostItemIndex.
    const indexMapRef = useRef<Map<string, number>>(buildIndexMap(messages));
    indexMapRef.current = buildIndexMap(messages);

    // ── Imperative handle ────────────────────────────────────────────────

    useImperativeHandle(
      ref,
      () => ({
        scrollToBottom(behavior: VirtuosoScrollBehavior = "smooth") {
          // scrollToIndex expects 0-based array indices (0 to data.length-1).
          virtuosoRef.current?.scrollToIndex({
            index: messages.length - 1,
            align: "end",
            behavior,
          });
        },

        scrollToMessageId(messageId: string) {
          const arrayIndex = indexMapRef.current.get(messageId);
          if (arrayIndex === undefined) return;

          // scrollToIndex expects 0-based array indices (0 to data.length-1).
          virtuosoRef.current?.scrollToIndex({
            index: arrayIndex,
            align: "center",
            behavior: "smooth",
          });

          // Highlight after scroll settles (uses retry-based highlightMessage)
          setTimeout(() => highlightMessage(messageId), 300);
        },
      }),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [messages.length]
    );

    // ── Callbacks ────────────────────────────────────────────────────────

    // Stable load-more guard: prevent firing multiple requests while one is
    // already in-flight or if there's nothing more to load.
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

    // Forward-pagination guard: prevent concurrent fetches when scrolling down
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

    // followOutput: auto-scroll on new messages only when at bottom AND not in a
    // detached anchor window (where the user is viewing mid-history context).
    const handleFollowOutput = useCallback(
      (isAtBottom: boolean) => !isDetached && isAtBottom,
      [isDetached]
    );

    // ── Item renderer ────────────────────────────────────────────────────

    const itemContent = useCallback(
      (index: number, msg: Message) => {
        // When using data={messages}, Virtuoso passes the 0-based position in
        // the data array as `index`. No firstItemIndex offset needed here.
        if (!msg) return null;

        // Determine whether to show author header (grouping logic)
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

        return (
          <MessageItem
            id={`message-${msg.id}`}
            message={msg}
            showHeader={showHeader}
            currentUserId={currentUserId}
            canPin={canPin}
            onReply={onReply}
            onPin={onPin}
            onUnpin={onUnpin}
            onJump={onJump}
            onBan={onBan}
            onThread={onThread}
          />
        );
      },
      // Only recompute when message content, user, or permissions change:

      [messages, currentUserId, canPin, onReply, onPin, onUnpin, onJump, onBan, onThread]
    );

    const HeaderComponent = useCallback(
      () => (
        <ListHeader
          hasMore={hasMore}
          loading={loading}
          welcomeContent={welcomeContent}
        />
      ),
      [hasMore, loading, welcomeContent]
    );

    // ── Render ────────────────────────────────────────────────────────────

    // initialTopMostItemIndex is only evaluated when Virtuoso mounts.
    // By passing an anchorKey to Virtuoso, we force a remount on anchor hops,
    // allowing Virtuoso to instantly jump to the requested message natively.
    // initialTopMostItemIndex expects 0-based array indices (0 to data.length-1).
    const targetArrayIndex = initialScrollMessageId
      ? indexMapRef.current.get(initialScrollMessageId)
      : undefined;

    const initialTopMostItemIndex =
      targetArrayIndex !== undefined
        ? { index: targetArrayIndex, align: "center" as const }
        : { index: messages.length - 1, align: "end" as const };

    return (
      <Virtuoso
        key={anchorKey}
        ref={virtuosoRef}
        className={cn("flex-1 custom-scrollbar")}
        style={{ height: "100%" }}
        data={messages}
        computeItemKey={(index, item) => item.id}
        firstItemIndex={firstItemIndex}
        initialTopMostItemIndex={initialTopMostItemIndex}
        startReached={handleStartReached}
        endReached={onLoadAfter ? handleEndReached : undefined}
        followOutput={handleFollowOutput}
        itemContent={itemContent}
        alignToBottom={!isDetached}
        components={{ Header: HeaderComponent, Footer: () => <div className="h-6 shrink-0" /> }}
        // Render extra pixels above/below viewport for smoother scrolling
        increaseViewportBy={{ top: 400, bottom: 400 }}
        // Keep items mounted for a while to avoid flicker on fast scroll
        defaultItemHeight={56}
      />
    );
  }
);

VirtualMessageList.displayName = "VirtualMessageList";

export default VirtualMessageList;
