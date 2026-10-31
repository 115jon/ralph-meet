import { useCallback, useEffect, useMemo } from "react";
import {
  FlatList,
  View,
  type ListRenderItem,
  type ListViewToken,
} from "react-native";

import { EmptyState, Skeleton, Text } from "@/ui";

import { loadLatest, loadOlder } from "./actions";
import { DayDivider, MessageRow } from "./MessageRow";
import { buildRows, type ChatRow } from "./rows";
import { useChannelMessages, type ChatMessage } from "./store";
import { setVisibleMessages } from "./visibility";

const keyOf = (row: ChatRow) => row.key;

const VIEWABILITY = { itemVisiblePercentThreshold: 10 };

/** Message rows are keyed by message id; day dividers by "day-…". */
function onViewableItemsChanged({
  viewableItems,
}: {
  viewableItems: ListViewToken[];
}): void {
  setVisibleMessages(
    viewableItems.flatMap(({ key }) => (key.startsWith("day-") ? [] : [key])),
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

interface MessageListProps {
  channelId: string;
  /** "#general" or a person's name, for the top of the history. */
  title: string;
  intro: string;
  onLongPress: (message: ChatMessage) => void;
}

/** Newest at the bottom; scrolling up pages in older messages. */
export function MessageList({
  channelId,
  title,
  intro,
  onLongPress,
}: MessageListProps) {
  const state = useChannelMessages(channelId);
  const renderRow: ListRenderItem<ChatRow> = useCallback(
    ({ item }) =>
      item.kind === "day" ? (
        <DayDivider label={item.label} />
      ) : (
        <MessageRow
          message={item.message}
          sentAt={item.sentAt}
          grouped={item.grouped}
          onLongPress={onLongPress}
        />
      ),
    [onLongPress],
  );
  // Nothing plays once the list is gone.
  useEffect(() => () => setVisibleMessages([]), []);
  const messages = state?.messages;
  const rows = useMemo(() => (messages ? buildRows(messages) : []), [messages]);
  const onEndReached = useCallback(
    () => void loadOlder(channelId),
    [channelId],
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
    <FlatList
      inverted
      data={rows}
      renderItem={renderRow}
      keyExtractor={keyOf}
      onEndReached={onEndReached}
      onEndReachedThreshold={0.6}
      initialNumToRender={20}
      windowSize={11}
      contentContainerStyle={{ paddingTop: 8 }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      viewabilityConfig={VIEWABILITY}
      onViewableItemsChanged={onViewableItemsChanged}
      ListFooterComponent={
        state.hasMore ? (
          <View style={{ paddingVertical: 16, alignItems: "center" }}>
            <Text variant="silk" tone="inkOff">
              {state.loadingOlder ? "Loading older" : "Scroll for older"}
            </Text>
          </View>
        ) : (
          <ChannelStart title={title} intro={intro} />
        )
      }
    />
  );
}
