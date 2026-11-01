import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo } from "react";
import { FlatList, View } from "react-native";

import { loadDms } from "@/features/dms/actions";
import { DmRow } from "@/features/dms/DmRow";
import type { DmChannel } from "@/features/dms/schema";
import { sortByActivity, useDmsStore } from "@/features/dms/store";
import { useServersStore } from "@/features/servers/store";
import { EmptyState, Header, Screen, Skeleton, Text } from "@/ui";

function DmsSkeleton() {
  return (
    <View>
      {[60, 44, 72, 52].map((width, index) => (
        <View
          key={index}
          style={{
            height: 64,
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            paddingHorizontal: 16,
          }}
        >
          <Skeleton width={40} height={40} />
          <View style={{ flex: 1, gap: 8 }}>
            <Skeleton width={96} height={12} />
            <Skeleton width={`${width}%`} height={12} />
          </View>
        </View>
      ))}
    </View>
  );
}

const keyOf = (dm: DmChannel) => dm.id;

export default function DmsScreen() {
  const router = useRouter();
  const status = useDmsStore((s) => s.status);
  const dms = useDmsStore((s) => s.dms);
  const lastMessageAt = useServersStore((s) => s.lastMessageAt);
  const sorted = useMemo(
    () => sortByActivity(dms, lastMessageAt),
    [dms, lastMessageAt],
  );

  useEffect(() => {
    void loadDms();
  }, []);

  const open = useCallback(
    (dm: DmChannel) =>
      router.push({ pathname: "/dm/[id]", params: { id: dm.id } }),
    [router],
  );
  const renderRow = useCallback(
    ({ item }: { item: DmChannel }) => <DmRow dm={item} onOpen={open} />,
    [open],
  );

  let body;
  if (dms.length === 0 && status === "loading") {
    body = <DmsSkeleton />;
  } else if (dms.length === 0 && status === "error") {
    body = (
      <EmptyState
        title="Messages did not load"
        description="Your conversations did not load. Check the connection and try again."
        action={{ label: "Try again", onPress: () => void loadDms() }}
      />
    );
  } else if (dms.length === 0) {
    body = (
      <EmptyState
        title="No conversations yet"
        description="Message a friend from the web app and the conversation shows up here."
      />
    );
  } else {
    body = (
      <FlatList
        data={sorted}
        keyExtractor={keyOf}
        renderItem={renderRow}
        ListHeaderComponent={
          <View
            style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 }}
          >
            <Text variant="silk" tone="ink3">
              Recent
            </Text>
          </View>
        }
      />
    );
  }

  return (
    <Screen scroll={false}>
      <Header title="Messages" />
      {body}
    </Screen>
  );
}
