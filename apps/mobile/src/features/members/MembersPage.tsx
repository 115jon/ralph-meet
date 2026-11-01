import { ArrowLeft } from "phosphor-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { authorName } from "@/features/chat/authors";
import { useTypingIds } from "@/features/chat/store";
import { showChat, useConversation } from "@/features/conversation/store";
import { useOnlineTest } from "@/features/presence/live";
import { PersonMenu, type MenuPerson } from "@/features/profile/PersonMenu";
import { openProfile } from "@/features/profile/store";
import {
  useChannel,
  useChannelServer,
  useServersStore,
  useServerTree,
} from "@/features/servers/store";
import { useTheme } from "@/theme";
import { EmptyState, IconButton, Skeleton, Text } from "@/ui";

import { loadMembers } from "./actions";
import { flattenGroups, groupMembers, type MemberListItem } from "./grouping";
import {
  MEMBER_HEADER_HEIGHT,
  MEMBER_ROW_HEIGHT,
  MemberHeader,
  MemberRow,
} from "./MemberRow";
import type { ServerMember } from "./schema";
import { useMembersLoaded, useServerMembers } from "./store";

const keyOf = (item: MemberListItem) => item.key;
const heightOf = (item: MemberListItem) =>
  item.type === "header" ? MEMBER_HEADER_HEIGHT : MEMBER_ROW_HEIGHT;

/** userId → the name of the voice channel they are in, within this server. */
function useVoiceChannels(
  serverId: string | null,
): ReadonlyMap<string, string> {
  const tree = useServerTree(serverId);
  const voice = useServersStore((s) => s.voice);
  return useMemo(() => {
    const where = new Map<string, string>();
    for (const channel of tree?.channels ?? []) {
      for (const member of voice[channel.id] ?? []) {
        where.set(member.user_id, channel.name);
      }
    }
    return where;
  }, [tree, voice]);
}

function MembersSkeleton() {
  return (
    <View style={{ paddingTop: 12 }}>
      {[44, 68, 52, 60, 40].map((width, index) => (
        <View
          key={index}
          style={{
            height: MEMBER_ROW_HEIGHT,
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            paddingHorizontal: 16,
          }}
        >
          <Skeleton width={32} height={32} />
          <Skeleton width={`${width}%`} height={12} />
        </View>
      ))}
    </View>
  );
}

function toMenuPerson(member: ServerMember): MenuPerson {
  return { ...member.user, name: authorName(member.user) };
}

/**
 * The pager's third page: the open channel's server members in the web's
 * branches (highest hoisted role, Online, Offline), with presence, what
 * each is doing, and a talk LED while they speak. Virtualised: rows have
 * fixed heights, so the list knows every offset up front.
 */
export function MembersPage() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const conversation = useConversation();
  const channelId = conversation?.kind === "channel" ? conversation.id : "";
  const channel = useChannel(channelId);
  const server = useChannelServer(channelId);
  const serverId = server?.id ?? null;
  const members = useServerMembers(serverId);
  const loaded = useMembersLoaded(serverId);
  const isOnline = useOnlineTest();
  const typingIds = useTypingIds(channelId);
  const voiceChannels = useVoiceChannels(serverId);
  const [menuFor, setMenuFor] = useState<MenuPerson | null>(null);

  useEffect(() => {
    if (serverId) void loadMembers(serverId);
  }, [serverId]);

  const items = useMemo(
    () => flattenGroups(groupMembers(members, isOnline)),
    [members, isOnline],
  );
  const offsets = useMemo(
    () =>
      items.reduce<number[]>((starts, item, index) => {
        const previous = items[index - 1];
        const last = starts[index - 1] ?? 0;
        starts.push(previous ? last + heightOf(previous) : 0);
        return starts;
      }, []),
    [items],
  );
  const getItemLayout = useCallback(
    (data: ArrayLike<MemberListItem> | null | undefined, index: number) => {
      const item = data?.[index];
      return {
        length: item ? heightOf(item) : MEMBER_ROW_HEIGHT,
        offset: offsets[index] ?? 0,
        index,
      };
    },
    [offsets],
  );

  const open = useCallback(
    (member: ServerMember) => openProfile(member.user.id, member.user),
    [],
  );
  const longPress = useCallback(
    (member: ServerMember) => setMenuFor(toMenuPerson(member)),
    [],
  );
  const renderItem = useCallback(
    ({ item }: { item: MemberListItem }) =>
      item.type === "header" ? (
        <MemberHeader name={item.name} count={item.count} />
      ) : (
        <MemberRow
          member={item.member}
          online={item.online}
          typing={typingIds.includes(item.member.user.id)}
          voiceChannel={voiceChannels.get(item.member.user.id) ?? null}
          onPress={open}
          onLongPress={longPress}
        />
      ),
    [typingIds, voiceChannels, open, longPress],
  );

  let body;
  if (!loaded && members.length === 0) {
    body = <MembersSkeleton />;
  } else if (members.length === 0) {
    body = (
      <EmptyState
        title="No one here yet"
        description="Members show up here once the list loads."
        action={
          serverId
            ? {
                label: "Try again",
                onPress: () => void loadMembers(serverId, { force: true }),
              }
            : undefined
        }
      />
    );
  } else {
    body = (
      <FlatList
        data={items}
        keyExtractor={keyOf}
        renderItem={renderItem}
        getItemLayout={getItemLayout}
        extraData={renderItem}
        initialNumToRender={16}
        windowSize={7}
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
            paddingLeft: 4,
            paddingRight: 16,
          }}
        >
          <IconButton
            icon={ArrowLeft}
            label="Back to the conversation"
            onPress={showChat}
          />
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text
              variant="title"
              accessibilityRole="header"
              numberOfLines={1}
              style={{ fontSize: 18, lineHeight: 22 }}
            >
              Members
            </Text>
            <Text
              variant="num"
              tone="ink3"
              numberOfLines={1}
              style={{ fontSize: 11, lineHeight: 14 }}
            >
              {channel ? `#${channel.name}` : "Channel"}
              {server ? ` · ${server.name}` : ""}
            </Text>
          </View>
          {loaded ? (
            <Text variant="num" tone="ink3" style={{ fontSize: 11 }}>
              {members.length}
            </Text>
          ) : null}
        </View>
      </View>
      {body}
      <PersonMenu
        person={menuFor}
        serverId={serverId}
        onClose={() => setMenuFor(null)}
        withMessage
      />
    </View>
  );
}
