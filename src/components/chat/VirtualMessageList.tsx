"use client";

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
  useImperativeHandle,
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
  /** Rendered inside Header when !hasMore — the channel welcome banner. */
  welcomeContent?: ReactNode;
  onLoadMore: () => Promise<void> | void;
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
      welcomeContent,
      onLoadMore,
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

    // firstItemIndex: large offset decremented as older pages prepend,
    // keeping existing items' absolute virtual indices stable.
    const firstItemIndex = START_INDEX - messages.length;

    // Build messageId → 0-based array index. Updated every render.
    // scrollToIndex expects 0-based indices, same range as initialTopMostItemIndex.
    const indexMapRef = useRef<Map<string, number>>(buildIndexMap(messages));
    indexMapRef.current = buildIndexMap(messages);

    // ── Imperative handle ────────────────────────────────────────────────

    useImperativeHandle(
      ref,
      () => ({
        scrollToBottom(behavior: VirtuosoScrollBehavior = "smooth") {
          // scrollToIndex uses 0-based array indices (0..messages.length-1)
          virtuosoRef.current?.scrollToIndex({
            index: messages.length - 1,
            align: "end",
            behavior,
          });
        },

        scrollToMessageId(messageId: string) {
          const index = indexMapRef.current.get(messageId);
          if (index === undefined) return;

          // index is 0-based array position — correct for scrollToIndex
          virtuosoRef.current?.scrollToIndex({
            index,
            align: "center",
            behavior: "smooth",
          });

          // Highlight after scroll settles
          setTimeout(() => {
            const el = document.getElementById(`message-${messageId}`);
            if (!el) return;
            el.classList.add("bg-indigo-500/10");
            setTimeout(() => el.classList.remove("bg-indigo-500/10"), 2000);
          }, 300);
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

    // followOutput: auto-scroll on new messages only when at bottom AND not in a
    // detached anchor window (where the user is viewing mid-history context).
    const handleFollowOutput = useCallback(
      (isAtBottom: boolean) => !isDetached && isAtBottom,
      [isDetached]
    );

    // ── Item renderer ────────────────────────────────────────────────────

    const itemContent = useCallback(
      (index: number, msg: Message) => {
        // index is the 0-based position in the data array (react-virtuoso
        // adds firstItemIndex internally for rendering, but passes the
        // absolute virtual index here). We derive array position from it.
        const arrayIndex = index - firstItemIndex;
        if (!msg) return null;

        // Determine whether to show author header (grouping logic)
        let showHeader = true;
        if (arrayIndex > 0) {
          const prev = messages[arrayIndex - 1];
          const hasSameAuthor = prev.author_id === msg.author_id;
          const hasNoReply = !msg.reply_to_id;
          if (hasSameAuthor && hasNoReply) {
            const prevTime = new Date(prev.created_at).getTime();
            const curTime = new Date(msg.created_at).getTime();
            showHeader = curTime - prevTime > 5 * 60 * 1000;
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
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [messages, currentUserId, canPin, onReply, onPin, onUnpin, onJump, onBan, onThread, firstItemIndex]
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

    if (messages.length === 0 && !loading) {
      return null;
    }

    return (
      <Virtuoso
        ref={virtuosoRef}
        className={cn("flex-1 custom-scrollbar")}
        style={{ height: "100%" }}
        data={messages}
        firstItemIndex={firstItemIndex}
        initialTopMostItemIndex={messages.length - 1}
        startReached={handleStartReached}
        followOutput={handleFollowOutput}
        itemContent={itemContent}
        components={{ Header: HeaderComponent }}
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
