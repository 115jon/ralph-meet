import { List, UserPlus, Users } from "phosphor-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PickerSearch } from "@/features/chat/picker/PickerSearch";
import { showDrawer } from "@/features/conversation/store";
import { openDmWith } from "@/features/dms/actions";
import { useOnlineTest } from "@/features/presence/live";
import { PersonMenu, type MenuPerson } from "@/features/profile/PersonMenu";
import { openProfile } from "@/features/profile/store";
import { useTheme } from "@/theme";
import {
  ConfirmSheet,
  EmptyState,
  Icon,
  IconButton,
  Segmented,
  Skeleton,
  Text,
  useRefreshControl,
  type ConfirmRequest,
} from "@/ui";

import { acceptFriend, loadFriends, removeRelationship } from "./actions";
import { AddFriendSheet } from "./AddFriendSheet";
import {
  FRIEND_TAB_LABEL,
  FRIEND_TABS,
  friendBranches,
  personName,
  type FriendTab,
} from "./filters";
import {
  FRIEND_ROW_HEIGHT,
  FriendRow,
  type FriendRowActions,
} from "./FriendRow";
import { RELATIONSHIP, type Relationship } from "./schema";
import { useFriendsStore, usePendingCount } from "./store";

type Item =
  | {
      readonly type: "header";
      readonly key: string;
      readonly label: string;
      readonly count: number;
    }
  | {
      readonly type: "row";
      readonly key: string;
      readonly relationship: Relationship;
    };

const keyOf = (item: Item) => item.key;

const EMPTY: Record<FriendTab, { title: string; description: string }> = {
  online: {
    title: "No one's around",
    description: "Friends who are online show up here.",
  },
  all: {
    title: "No friends yet",
    description: "Add someone by their username with the key up top.",
  },
  pending: {
    title: "No pending requests",
    description: "Requests you send or get wait here until they're answered.",
  },
  blocked: {
    title: "No one blocked",
    description: "People you block show up here, where you can unblock them.",
  },
};

function FriendsSkeleton() {
  return (
    <View style={{ paddingTop: 12 }}>
      {[52, 40, 64].map((width, index) => (
        <View
          key={index}
          style={{
            height: FRIEND_ROW_HEIGHT,
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            paddingHorizontal: 16,
          }}
        >
          <Skeleton width={40} height={40} />
          <Skeleton width={`${width}%`} height={12} />
        </View>
      ))}
    </View>
  );
}

/**
 * Friends, in the chat's slot (the web's FriendsView): Online, All,
 * Pending and Blocked under one rail, a search, and each row's keys. The
 * header's key adds a friend by exact username.
 */
export function FriendsPage() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const status = useFriendsStore((s) => s.status);
  const relationships = useFriendsStore((s) => s.relationships);
  const pending = usePendingCount();
  const isOnline = useOnlineTest();
  const [tab, setTab] = useState<FriendTab>("online");
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [menuFor, setMenuFor] = useState<MenuPerson | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const refreshControl = useRefreshControl(loadFriends);

  useEffect(() => {
    void loadFriends();
  }, []);

  const items = useMemo(() => {
    const out: Item[] = [];
    for (const branch of friendBranches(relationships, tab, query, isOnline)) {
      if (branch.rows.length === 0) continue;
      out.push({
        type: "header",
        key: `h:${branch.key}`,
        label: branch.label,
        count: branch.rows.length,
      });
      for (const relationship of branch.rows) {
        out.push({ type: "row", key: relationship.user.id, relationship });
      }
    }
    return out;
  }, [relationships, tab, query, isOnline]);

  const actions = useMemo<FriendRowActions>(
    () => ({
      onOpen: (r) => openProfile(r.user.id, r.user),
      onLongPress: (r) => setMenuFor({ ...r.user, name: personName(r.user) }),
      onMessage: (r) => void openDmWith(r.user.id),
      onAccept: (r) => void acceptFriend(r.user),
      onRemove: (r) => {
        const name = personName(r.user);
        if (r.type === RELATIONSHIP.blocked) {
          void removeRelationship(r.user);
          return;
        }
        const incoming = r.type === RELATIONSHIP.incoming;
        setConfirm({
          kicker: name,
          title: incoming ? "Ignore request" : "Cancel request",
          body: incoming
            ? `Ignore the friend request from ${name}?`
            : `Cancel your friend request to ${name}?`,
          confirm: incoming ? "Ignore" : "Cancel request",
          onConfirm: () => void removeRelationship(r.user),
        });
      },
    }),
    [],
  );

  const renderItem = useCallback(
    ({ item }: { item: Item }) =>
      item.type === "header" ? (
        <View
          accessibilityRole="header"
          style={{
            flexDirection: "row",
            paddingHorizontal: 16,
            paddingTop: 14,
            paddingBottom: 6,
          }}
        >
          <Text variant="silk" tone="ink3" style={{ flex: 1 }}>
            {item.label}
          </Text>
          <Text variant="num" tone="ink3" style={{ fontSize: 11 }}>
            {item.count}
          </Text>
        </View>
      ) : (
        <FriendRow relationship={item.relationship} actions={actions} />
      ),
    [actions],
  );

  let body;
  if (relationships.length === 0 && status === "loading") {
    body = <FriendsSkeleton />;
  } else if (relationships.length === 0 && status === "error") {
    body = (
      <EmptyState
        title="Friends did not load"
        description="Check the connection and try again."
        action={{ label: "Try again", onPress: () => void loadFriends() }}
      />
    );
  } else if (items.length === 0) {
    body = query.trim() ? (
      <EmptyState
        title="No matches"
        description={`No one here matches "${query.trim()}".`}
      />
    ) : (
      <EmptyState {...EMPTY[tab]} />
    );
  } else {
    body = (
      <FlatList
        data={items}
        keyExtractor={keyOf}
        renderItem={renderItem}
        refreshControl={refreshControl}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
      />
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.ply0 }}>
      <View
        style={{
          paddingTop: insets.top,
          borderBottomWidth: 2,
          borderBottomColor: theme.ink1,
        }}
      >
        <View
          style={{
            height: 56,
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
            paddingHorizontal: 4,
          }}
        >
          <IconButton
            icon={List}
            label="Channels and messages"
            onPress={showDrawer}
          />
          <View
            style={{
              flex: 1,
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
            }}
          >
            <Icon icon={Users} size={18} color={theme.ink3} />
            <Text
              variant="title"
              accessibilityRole="header"
              style={{ fontSize: 18, lineHeight: 22 }}
            >
              Friends
            </Text>
          </View>
          <IconButton
            icon={UserPlus}
            label="Add friend"
            onPress={() => setAdding(true)}
          />
        </View>
      </View>
      <View style={{ paddingHorizontal: 12, paddingTop: 12, gap: 10 }}>
        <Segmented
          options={FRIEND_TABS}
          value={tab}
          onChange={setTab}
          label={(option) => FRIEND_TAB_LABEL[option]}
          note={(option) =>
            option === "pending" && pending > 0 ? String(pending) : null
          }
          accessibilityLabel="Show friends"
        />
        <View style={{ flexDirection: "row" }}>
          <PickerSearch
            value={query}
            onChange={setQuery}
            placeholder="Search friends"
            height={40}
          />
        </View>
      </View>
      {body}
      <AddFriendSheet visible={adding} onClose={() => setAdding(false)} />
      <PersonMenu
        person={menuFor}
        serverId={null}
        onClose={() => setMenuFor(null)}
        withMessage
      />
      <ConfirmSheet request={confirm} onClose={() => setConfirm(null)} />
    </View>
  );
}
