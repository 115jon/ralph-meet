import { useRouter } from "expo-router";
import { useCallback, useEffect } from "react";
import { FlatList, View } from "react-native";

import {
  loadActivity,
  markAllRead,
  markRead,
} from "@/features/activity/actions";
import { ActivityRow } from "@/features/activity/ActivityRow";
import type { Notification } from "@/features/activity/schema";
import { useActivityStore } from "@/features/activity/store";
import { goToConversation } from "@/features/conversation/navigation";
import {
  EmptyState,
  Header,
  HeaderAction,
  Screen,
  Skeleton,
  useRefreshControl,
} from "@/ui";

function ActivitySkeleton() {
  return (
    <View>
      {[70, 48, 62].map((width, index) => (
        <View
          key={index}
          style={{ flexDirection: "row", gap: 12, padding: 16 }}
        >
          <Skeleton width={40} height={40} />
          <View style={{ flex: 1, gap: 8 }}>
            <Skeleton width={140} height={12} />
            <Skeleton width={`${width}%`} height={12} />
          </View>
        </View>
      ))}
    </View>
  );
}

const keyOf = (n: Notification) => n.id;

function open(n: Notification): void {
  markRead([n.id]);
  goToConversation(
    n.server_id
      ? { kind: "channel", id: n.channel_id, name: n.channel_name ?? undefined }
      : { kind: "dm", id: n.channel_id },
  );
}

const renderRow = ({ item }: { item: Notification }) => (
  <ActivityRow notification={item} onOpen={open} />
);

/** Mentions and replies, newest first; opened from the panel's bell. */
export default function ActivityScreen() {
  const router = useRouter();
  const status = useActivityStore((s) => s.status);
  const notifications = useActivityStore((s) => s.notifications);
  const anyUnread = notifications.some((n) => !n.is_read);

  const refreshControl = useRefreshControl(loadActivity);
  const back = useCallback(() => router.back(), [router]);

  useEffect(() => {
    void loadActivity();
  }, []);

  let body;
  if (notifications.length === 0 && status === "loading") {
    body = <ActivitySkeleton />;
  } else if (notifications.length === 0 && status === "error") {
    body = (
      <EmptyState
        title="Activity did not load"
        description="Mentions and replies did not load. Check the connection and try again."
        action={{ label: "Try again", onPress: () => void loadActivity() }}
      />
    );
  } else if (notifications.length === 0) {
    body = (
      <EmptyState
        title="Nothing new"
        description="When someone mentions you or replies to you, it shows up here."
      />
    );
  } else {
    body = (
      <FlatList
        data={notifications}
        keyExtractor={keyOf}
        renderItem={renderRow}
        refreshControl={refreshControl}
      />
    );
  }

  return (
    <Screen scroll={false}>
      <Header
        title="Activity"
        onBack={back}
        action={
          anyUnread ? (
            <HeaderAction label="Mark all read" onPress={markAllRead} />
          ) : null
        }
      />
      {body}
    </Screen>
  );
}
