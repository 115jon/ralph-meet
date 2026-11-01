import { X } from "phosphor-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Keyboard, Pressable, TextInput, View } from "react-native";
import { FlatList } from "react-native-gesture-handler";

import { useSession } from "@/features/auth/session";
import { openDmWith } from "@/features/dms/actions";
import { sortByActivity, useDmsStore } from "@/features/dms/store";
import { loadMembers } from "@/features/members/actions";
import { useMembersStore } from "@/features/members/store";
import { presenceLedOf, usePresence } from "@/features/presence/live";
import { useServersStore } from "@/features/servers/store";
import { mediaUrl } from "@/lib/api";
import { FONT, RADIUS, useTheme } from "@/theme";
import { Avatar, Icon, Sheet, Text, useSheetScroll } from "@/ui";

import { loadFriends } from "./actions";
import { personName } from "./filters";
import { newDmSections, type PickPerson } from "./new-dm";
import { useFriendsStore } from "./store";

const ROW_HEIGHT = 56;

type Item =
  | {
      readonly type: "header";
      readonly key: string;
      readonly label: string;
      readonly count: number;
    }
  | {
      readonly type: "person";
      readonly key: string;
      readonly person: PickPerson;
      readonly line: string;
    };

/** Everyone in the loaded member lists, and which servers each shares. */
function useServerPeople(): {
  people: PickPerson[];
  where: ReadonlyMap<string, string>;
} {
  const members = useMembersStore((s) => s.members);
  const servers = useServersStore((s) => s.servers);
  return useMemo(() => {
    const people = new Map<string, PickPerson>();
    const where = new Map<string, string>();
    for (const [serverId, list] of Object.entries(members)) {
      const name = servers.find((s) => s.id === serverId)?.name;
      for (const { user } of list) {
        people.set(user.id, user);
        if (name && !where.has(user.id)) where.set(user.id, name);
      }
    }
    return { people: [...people.values()], where };
  }, [members, servers]);
}

function PersonRow({
  person,
  line,
  onPick,
}: {
  person: PickPerson;
  line: string;
  onPick: (person: PickPerson) => void;
}) {
  const theme = useTheme();
  const name = personName(person);
  const presence = usePresence(person.id, person.status);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Message ${name}`}
      onPress={() => onPick(person)}
      style={({ pressed }) => ({
        height: ROW_HEIGHT,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 16,
        backgroundColor: pressed ? theme.tint2 : "transparent",
      })}
    >
      <Avatar
        name={name}
        size={36}
        uri={mediaUrl(person.avatar_url)}
        presence={presenceLedOf(presence)}
        presenceGround={theme.ply3}
      />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="name" numberOfLines={1}>
          {name}
        </Text>
        <Text
          variant="row"
          tone="ink2"
          numberOfLines={1}
          style={{ fontSize: 12.5, lineHeight: 16 }}
        >
          {line}
        </Text>
      </View>
    </Pressable>
  );
}

function Body({ onClose }: { onClose: () => void }) {
  const theme = useTheme();
  const sheetScroll = useSheetScroll();
  const myId = useSession((s) => s.user?.id);
  const relationships = useFriendsStore((s) => s.relationships);
  const dms = useDmsStore((s) => s.dms);
  const lastMessageAt = useServersStore((s) => s.lastMessageAt);
  const { people: serverPeople, where } = useServerPeople();
  const [query, setQuery] = useState("");

  useEffect(() => {
    void loadFriends();
    // Member lists load once per session; any not loaded yet join the list.
    for (const server of useServersStore.getState().servers) {
      void loadMembers(server.id);
    }
  }, []);

  const recent = useMemo(
    () => sortByActivity(dms, lastMessageAt).map((dm) => dm.recipient),
    [dms, lastMessageAt],
  );
  const items = useMemo(() => {
    const out: Item[] = [];
    const sections = newDmSections({
      relationships,
      serverPeople,
      recent,
      myId,
      query,
    });
    for (const section of sections) {
      out.push({
        type: "header",
        key: `h:${section.key}`,
        label: section.label,
        count: section.people.length,
      });
      for (const person of section.people) {
        out.push({
          type: "person",
          key: `${section.key}:${person.id}`,
          person,
          line:
            section.key === "servers"
              ? (where.get(person.id) ?? `@${person.username}`)
              : `@${person.username}`,
        });
      }
    }
    return out;
  }, [relationships, serverPeople, recent, myId, query, where]);

  const pick = useCallback(
    (person: PickPerson) => {
      Keyboard.dismiss();
      onClose();
      void openDmWith(person.id);
    },
    [onClose],
  );

  const renderItem = useCallback(
    ({ item }: { item: Item }) =>
      item.type === "header" ? (
        <View
          accessibilityRole="header"
          style={{
            flexDirection: "row",
            paddingHorizontal: 16,
            paddingTop: 12,
            paddingBottom: 4,
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
        <PersonRow person={item.person} line={item.line} onPick={pick} />
      ),
    [pick],
  );

  return (
    <View style={{ flex: 1 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingLeft: 16,
          paddingRight: 12,
        }}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="silk" tone="ink3">
            Direct message
          </Text>
          <Text
            variant="display"
            accessibilityRole="header"
            style={{ fontSize: 22, lineHeight: 26, letterSpacing: -0.4 }}
          >
            New message
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          style={({ pressed }) => ({
            width: 40,
            height: 40,
            borderRadius: RADIUS,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: pressed ? theme.tint3 : theme.tint2,
          })}
        >
          <Icon icon={X} size={18} />
        </Pressable>
      </View>
      <View
        style={{
          marginHorizontal: 16,
          marginTop: 12,
          height: 44,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          paddingHorizontal: 12,
          borderRadius: RADIUS,
          borderWidth: 1,
          borderColor: theme.lineField,
          backgroundColor: theme.ply2,
        }}
      >
        <Text variant="silk" tone="ink3">
          To
        </Text>
        <TextInput
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="To: search friends and server members"
          placeholder="Name or username"
          placeholderTextColor={theme.ink3}
          cursorColor={theme.accentInk}
          selectionColor={theme.accentTint}
          style={{
            flex: 1,
            height: 44,
            padding: 0,
            fontFamily: FONT.body,
            fontSize: 15,
            color: theme.ink1,
          }}
        />
      </View>
      {items.length === 0 ? (
        <Text
          variant="row"
          tone="ink2"
          style={{ paddingHorizontal: 16, paddingTop: 20 }}
        >
          {query.trim()
            ? "No one you know matches that. To reach someone new, add them as a friend by username."
            : "Your friends and the people in your servers show up here."}
        </Text>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.key}
          renderItem={renderItem}
          keyboardShouldPersistTaps="handled"
          style={{ marginTop: 4 }}
          {...sheetScroll}
        />
      )}
    </View>
  );
}

/**
 * The pencil key's picker: one tap opens or creates the DM (1:1 only).
 * Friends first, then people from your servers, then recent DMs.
 */
export function NewDmSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      label="New message"
      expandable
      fill
    >
      {visible ? <Body onClose={onClose} /> : null}
    </Sheet>
  );
}
