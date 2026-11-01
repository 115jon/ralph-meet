import { ArrowDown } from "phosphor-react-native";
import {
  memo,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  FlatList,
  Platform,
  Pressable,
  View,
  type ListRenderItem,
  type ListViewToken,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  useReducedMotion,
} from "react-native-reanimated";

import { useSession } from "@/features/auth/session";
import { useServersStore } from "@/features/servers/store";
import { RADIUS, useTheme } from "@/theme";
import { EmptyState, Icon, showToast, Skeleton, Text } from "@/ui";

import {
  clearJump,
  landJump,
  loadAround,
  loadLatest,
  loadNewer,
  loadOlder,
} from "./actions";
import { DayDivider, MessageRow } from "./MessageRow";
import { PAGE_SIZE } from "./api";
import { buildRows, UNREAD_KEY, type ChatRow } from "./rows";
import { useChannelMessages, useJump, type ChatMessage } from "./store";
import { parseTimestamp } from "./time";
import { setChatCovered, setVisibleMessages } from "./visibility";

const keyOf = (row: ChatRow) => row.key;

const VIEWABILITY = { itemVisiblePercentThreshold: 10 };

/** Scrolled further than this from the newest message, the jump pill shows. */
const AWAY_FROM_PRESENT = 480;
/** How long a jumped-to message stays lit. */
const HIGHLIGHT_MS = 1800;
/** A row's rough height, for scrolling near one that is not rendered yet. */
const ROW_ESTIMATE = 72;

/** Message rows are keyed by message id; dividers by "day-…" and UNREAD_KEY. */
function onViewableItemsChanged({
  viewableItems,
}: {
  viewableItems: ListViewToken[];
}): void {
  setVisibleMessages(
    viewableItems.flatMap(({ key }) =>
      key.startsWith("day-") || key === UNREAD_KEY ? [] : [key],
    ),
  );
}

/** The top of the history: where the conversation begins. */
function ChannelStart({ title, intro }: { title: string; intro: string }) {
  return (
    <View
      style={{
        paddingHorizontal: 16,
        paddingTop: 24,
        paddingBottom: 8,
        gap: 4,
      }}
    >
      <Text variant="title">{title}</Text>
      <Text variant="body" tone="ink2">
        {intro}
      </Text>
    </View>
  );
}

/** Still message-shaped blocks while the first page loads. */
function MessagesSkeleton() {
  return (
    <View style={{ flex: 1, justifyContent: "flex-end", paddingBottom: 12 }}>
      {[78, 52, 66, 40].map((width, index) => (
        <View
          key={index}
          style={{
            flexDirection: "row",
            gap: 12,
            paddingHorizontal: 16,
            paddingTop: 16,
          }}
        >
          <Skeleton width={40} height={40} />
          <View style={{ flex: 1, gap: 8, paddingTop: 2 }}>
            <Skeleton width={96} height={12} />
            <Skeleton width={`${width}%`} height={14} />
          </View>
        </View>
      ))}
    </View>
  );
}

/** Above the first message since the user last read: an accent hairline. */
const UnreadDivider = memo(function UnreadDivider() {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="header"
      accessibilityLabel="New messages"
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingLeft: 16,
        paddingTop: 12,
        paddingBottom: 2,
      }}
    >
      <View style={{ flex: 1, height: 1, backgroundColor: theme.accentInk }} />
      <View
        style={{
          paddingHorizontal: 6,
          paddingVertical: 1,
          borderTopLeftRadius: RADIUS,
          borderBottomLeftRadius: RADIUS,
          backgroundColor: theme.accentInk,
        }}
      >
        <Text variant="silk" style={{ color: theme.ply0 }}>
          New
        </Text>
      </View>
    </View>
  );
});

const PILL_IN = FadeIn.duration(150).easing(Easing.out(Easing.cubic));
const PILL_OUT = FadeOut.duration(100);

/** Scrolled up into history: back to the newest message, and how many came since. */
function JumpToPresent({
  count,
  onPress,
}: {
  count: number;
  onPress: () => void;
}) {
  const theme = useTheme();
  const label =
    count > 0 ? `${count} new · Jump to present` : "Jump to present";
  return (
    <Animated.View
      entering={PILL_IN}
      exiting={PILL_OUT}
      style={{ position: "absolute", right: 12, bottom: 12 }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          count > 0
            ? `${count} new ${count === 1 ? "message" : "messages"}. Jump to present`
            : "Jump to present"
        }
        onPress={onPress}
        style={({ pressed }) => ({
          minHeight: 40,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingLeft: 12,
          paddingRight: 14,
          borderRadius: RADIUS,
          borderWidth: 1,
          borderColor: theme.lineStrong,
          borderTopWidth: 2,
          borderTopColor: theme.ink1,
          backgroundColor: pressed ? theme.ply4 : theme.ply3,
          shadowColor: theme.shadow,
          shadowOffset: { width: 0, height: 6 },
          shadowOpacity: 1,
          shadowRadius: 10,
          elevation: 8,
        })}
      >
        <Icon icon={ArrowDown} size={16} color={theme.ink1} />
        <Text variant="silk" tone="ink1" numberOfLines={1}>
          {label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

/**
 * While scrolled away from the newest message: whether to show the jump
 * pill, and how many messages from others arrived since leaving the bottom.
 */
function usePresentTracker(
  messages: readonly ChatMessage[] | undefined,
  myId: string | undefined,
) {
  const [away, setAway] = useState(false);
  const [since, setSince] = useState<number | null>(null);
  const awayRef = useRef(false);
  const newestAt = messages?.[0]?.created_at;
  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      // Inverted: offset 0 is the newest message.
      const next = event.nativeEvent.contentOffset.y > AWAY_FROM_PRESENT;
      if (awayRef.current === next) return;
      awayRef.current = next;
      setAway(next);
      setSince(next && newestAt ? parseTimestamp(newestAt).getTime() : null);
    },
    [newestAt],
  );
  const count = useMemo(() => {
    if (!away || since === null || !messages) return 0;
    let n = 0;
    for (const message of messages) {
      if (parseTimestamp(message.created_at).getTime() <= since) break;
      if (!message.send && message.author_id !== myId) n += 1;
    }
    return n;
  }, [away, since, messages, myId]);
  return { away, count, onScroll };
}

interface MessageListProps {
  channelId: string;
  /** "#general" or a person's name, for the top of the history. */
  title: string;
  intro: string;
  /** The chat is in front; covered, nothing plays. */
  attended: boolean;
  onLongPress: (message: ChatMessage) => void;
  onReply: (message: ChatMessage) => void;
}

/**
 * A pending jump into this list: loads the message's page if it is not
 * cached, scrolls it to the middle and lights it for a moment. Gone
 * messages say so and leave the list at the present.
 */
function useJumpTo(
  channelId: string,
  messages: readonly ChatMessage[] | undefined,
  rows: readonly ChatRow[],
  ready: boolean,
  list: RefObject<FlatList<ChatRow> | null>,
  animated: boolean,
): string | null {
  const jump = useJump(channelId);
  const loading = useRef<number | null>(null);
  const lit = jump?.landed ? jump.messageId : null;

  useEffect(() => {
    if (!jump || jump.landed || !ready || !messages) return;
    const loaded = loading.current === jump.seq;
    const at = messages.findIndex((message) => message.id === jump.messageId);
    // Past the newest page, a cached message may be dropped by the reload
    // that opening the chat started; its own page keeps it.
    if (at < 0 || (at >= PAGE_SIZE && !loaded)) {
      if (loaded) return;
      loading.current = jump.seq;
      void loadAround(channelId, jump.messageId).then((found) => {
        if (found) return;
        clearJump(jump.seq);
        showToast({
          label: "Message",
          text: "That message is no longer here",
          led: "idle",
        });
      });
      return;
    }
    const index = rows.findIndex((row) => row.key === jump.messageId);
    if (index < 0) return;
    // After the rows it needs have laid out.
    requestAnimationFrame(() =>
      list.current?.scrollToIndex({ index, viewPosition: 0.5, animated }),
    );
    landJump(jump.seq);
  }, [jump, ready, messages, rows, channelId, list, animated]);

  // Lit for a moment, then the jump is done.
  const seq = jump?.landed ? jump.seq : null;
  useEffect(() => {
    if (seq === null) return;
    const timer = setTimeout(() => clearJump(seq), HIGHLIGHT_MS);
    // Leaving the chat ends it too, so it never lights up again later.
    return () => {
      clearTimeout(timer);
      clearJump(seq);
    };
  }, [seq]);

  return lit;
}

/**
 * Newest at the bottom; scrolling up pages in older messages. Opening it
 * marks where the user had read up to with a "New" line, and scrolling up
 * into history brings a pill back to the present. A jump (a link, a push)
 * may load a page from the past; scrolling down then pages newer ones in.
 */
export function MessageList({
  channelId,
  title,
  intro,
  attended,
  onLongPress,
  onReply,
}: MessageListProps) {
  const state = useChannelMessages(channelId);
  const myId = useSession((s) => s.user?.id);
  const reducedMotion = useReducedMotion();
  const list = useRef<FlatList<ChatRow>>(null);
  // Where the user had read up to when the conversation opened; opening it
  // marks it read, so this is taken once, before that lands.
  const [readAt] = useState(() => useServersStore.getState().readAt[channelId]);
  useEffect(() => setChatCovered(!attended), [attended]);
  useEffect(() => () => setVisibleMessages([]), []);
  const messages = state?.messages;
  const rows = useMemo(
    () => (messages ? buildRows(messages, { readAt, myId }) : []),
    [messages, readAt, myId],
  );
  const lit = useJumpTo(
    channelId,
    messages,
    rows,
    state?.status === "ready",
    list,
    !reducedMotion,
  );
  const renderRow: ListRenderItem<ChatRow> = useCallback(
    ({ item }) => {
      if (item.kind === "day") return <DayDivider label={item.label} />;
      if (item.kind === "unread") return <UnreadDivider />;
      return (
        <MessageRow
          message={item.message}
          sentAt={item.sentAt}
          grouped={item.grouped}
          highlighted={item.message.id === lit}
          onLongPress={onLongPress}
          onReply={onReply}
        />
      );
    },
    [onLongPress, onReply, lit],
  );
  const present = usePresentTracker(messages, myId);
  const detached = state?.hasNewer === true;
  const onEndReached = useCallback(
    () => void loadOlder(channelId),
    [channelId],
  );
  const onStartReached = useCallback(
    () => void loadNewer(channelId),
    [channelId],
  );
  const jumpToPresent = useCallback(() => {
    // Back from a jump: the present is not loaded, so load it first.
    if (detached) void loadLatest(channelId);
    list.current?.scrollToOffset({ offset: 0, animated: !reducedMotion });
  }, [reducedMotion, detached, channelId]);
  const onScrollToIndexFailed = useCallback(
    ({
      index,
      averageItemLength,
    }: {
      index: number;
      averageItemLength: number;
    }) => {
      // Not laid out yet: get close, then aim again once it is.
      list.current?.scrollToOffset({
        offset: index * (averageItemLength || ROW_ESTIMATE),
        animated: false,
      });
      setTimeout(
        () =>
          list.current?.scrollToIndex({
            index,
            viewPosition: 0.5,
            animated: !reducedMotion,
          }),
        120,
      );
    },
    [reducedMotion],
  );

  if (!state || state.status === "loading") return <MessagesSkeleton />;
  if (state.status === "error") {
    return (
      <View style={{ flex: 1, justifyContent: "flex-end" }}>
        <EmptyState
          title="Messages did not load"
          description={`Could not fetch the history of ${title}.`}
          action={{
            label: "Try again",
            onPress: () => void loadLatest(channelId),
          }}
        />
      </View>
    );
  }
  if (rows.length === 0) {
    return (
      <View style={{ flex: 1, justifyContent: "flex-end" }}>
        <ChannelStart title={title} intro={intro} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        ref={list}
        inverted
        data={rows}
        renderItem={renderRow}
        keyExtractor={keyOf}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.6}
        onStartReached={detached ? onStartReached : undefined}
        onStartReachedThreshold={0.6}
        // Newer pages land under the reader without moving what they see.
        maintainVisibleContentPosition={
          detached ? { minIndexForVisible: 0 } : undefined
        }
        onScrollToIndexFailed={onScrollToIndexFailed}
        extraData={lit}
        initialNumToRender={20}
        windowSize={11}
        contentContainerStyle={{ paddingTop: 8 }}
        keyboardShouldPersistTaps="handled"
        // "interactive" is iOS only; Android drops the keyboard on a drag.
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        viewabilityConfig={VIEWABILITY}
        onViewableItemsChanged={onViewableItemsChanged}
        onScroll={present.onScroll}
        scrollEventThrottle={100}
        ListFooterComponent={
          state.hasMore ? (
            <View style={{ paddingVertical: 16, alignItems: "center" }}>
              <Text variant="silk" tone="inkOff" numberOfLines={1}>
                {state.loadingOlder ? "Loading older" : "Scroll for older"}
              </Text>
            </View>
          ) : (
            <ChannelStart title={title} intro={intro} />
          )
        }
      />
      {present.away || detached ? (
        <JumpToPresent count={present.count} onPress={jumpToPresent} />
      ) : null}
    </View>
  );
}
