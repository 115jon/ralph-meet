import { NotePencil } from "phosphor-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, View } from "react-native";

import { openConversation } from "@/features/conversation/store";
import { loadDms } from "@/features/dms/actions";
import { DmRow } from "@/features/dms/DmRow";
import type { DmChannel } from "@/features/dms/schema";
import { sortByActivity, useDmsStore } from "@/features/dms/store";
import { FriendsEntry } from "@/features/friends/FriendsEntry";
import { NewDmSheet } from "@/features/friends/NewDmSheet";
import { usePlateClearance } from "@/features/panel/metrics";
import { refreshReadStates } from "@/features/servers/actions";
import { useServersStore } from "@/features/servers/store";
import {
  EmptyState,
  Header,
  IconButton,
  Skeleton,
  Text,
  useRefreshControl,
} from "@/ui";

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

const openDm = (dm: DmChannel) => openConversation({ kind: "dm", id: dm.id });

/** Pull-to-refresh: the list and its unread marks. */
async function refreshDms(): Promise<void> {
  await Promise.all([loadDms(), refreshReadStates()]);
}

/** The silkscreen label over the conversations, with their count. */
function SectionLabel({ count }: { count: number | null }) {
  return (
    <View
      accessibilityRole="header"
      style={{
        flexDirection: "row",
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 4,
      }}
    >
      <Text variant="silk" tone="ink3" numberOfLines={1} style={{ flex: 1 }}>
        Direct messages
      </Text>
      {count !== null ? (
        <Text variant="num" tone="ink3" style={{ fontSize: 11 }}>
          {count}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * Friends pinned on top, then direct messages, most recent first; a row
 * opens the conversation. The pencil key starts a new one.
 */
export function DmsPane() {
  const clearance = usePlateClearance();
  const status = useDmsStore((s) => s.status);
  const dms = useDmsStore((s) => s.dms);
  const lastMessageAt = useServersStore((s) => s.lastMessageAt);
  const [composing, setComposing] = useState(false);
  const sorted = useMemo(
    () => sortByActivity(dms, lastMessageAt),
    [dms, lastMessageAt],
  );

  useEffect(() => {
    void loadDms();
  }, []);

  const refreshControl = useRefreshControl(refreshDms);
  const renderRow = useCallback(
    ({ item }: { item: DmChannel }) => <DmRow dm={item} onOpen={openDm} />,
    [],
  );

  let body;
  if (dms.length === 0 && status === "loading") {
    body = (
      <>
        <FriendsEntry />
        <SectionLabel count={null} />
        <DmsSkeleton />
      </>
    );
  } else if (dms.length === 0 && status === "error") {
    body = (
      <>
        <FriendsEntry />
        <EmptyState
          title="Messages did not load"
          description="Your conversations did not load. Check the connection and try again."
          action={{ label: "Try again", onPress: () => void loadDms() }}
        />
      </>
    );
  } else if (dms.length === 0) {
    body = (
      <>
        <FriendsEntry />
        <EmptyState
          title="No conversations yet"
          description="Start one with the pencil key, or from a friend's profile."
          action={{ label: "New message", onPress: () => setComposing(true) }}
        />
      </>
    );
  } else {
    body = (
      <FlatList
        data={sorted}
        keyExtractor={keyOf}
        renderItem={renderRow}
        refreshControl={refreshControl}
        contentContainerStyle={{ paddingBottom: clearance }}
        ListHeaderComponent={
          <>
            <FriendsEntry />
            <SectionLabel count={dms.length} />
          </>
        }
      />
    );
  }

  return (
    <>
      <Header
        title="Direct messages"
        rule="brand"
        action={
          <IconButton
            icon={NotePencil}
            label="New message"
            onPress={() => setComposing(true)}
          />
        }
      />
      {body}
      <NewDmSheet visible={composing} onClose={() => setComposing(false)} />
    </>
  );
}
