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
import { Button, EmptyState, Header, Screen, Skeleton } from "@/ui";

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

/** Mentions and replies, newest first; opened from the panel's bell. */
export default function ActivityScreen() {
  const router = useRouter();
  const status = useActivityStore((s) => s.status);
  const notifications = useActivityStore((s) => s.notifications);
  const anyUnread = notifications.some((n) => !n.is_read);

  useEffect(() => {
    void loadActivity();
  }, []);

  const open = useCallback(
    (n: Notification) => {
      markRead([n.id]);
      if (n.server_id) {
        router.push({
          pathname: "/channel/[id]",
          params: { id: n.channel_id, name: n.channel_name ?? undefined },
        });
      } else {
        router.push({ pathname: "/dm/[id]", params: { id: n.channel_id } });
      }
    },
    [router],
  );
  const renderRow = useCallback(
    ({ item }: { item: Notification }) => (
      <ActivityRow notification={item} onOpen={open} />
    ),
    [open],
  );

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
        ListFooterComponent={
          anyUnread ? (
            <View style={{ padding: 16, alignItems: "flex-start" }}>
              <Button
                variant="ghost"
                label="Mark all read"
                onPress={markAllRead}
              />
            </View>
          ) : undefined
        }
      />
    );
  }

  return (
    <Screen scroll={false}>
      <Header title="Activity" onBack={() => router.back()} />
      {body}
    </Screen>
  );
}
