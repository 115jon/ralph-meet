import { X } from "phosphor-react-native";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { useSession } from "@/features/auth/session";
import { openProfile } from "@/features/profile/store";
import { mediaUrl } from "@/lib/api";
import { tapHaptic } from "@/lib/haptics";
import { RADIUS, useTheme } from "@/theme";
import { Avatar, Icon, Sheet, Text } from "@/ui";

import { authorName } from "./authors";
import { toggleReaction } from "./mutations";
import { emojiLabel } from "./picker/emoji-data";
import { EmojiGlyph } from "./picker/EmojiGlyph";
import type { Author, Reaction } from "./schema";
import { useChannelMessages, type ChatMessage } from "./store";

export interface ReactionsTarget {
  readonly channelId: string;
  readonly messageId: string;
  readonly emoji: string;
}

/** Everyone this conversation can name: members, authors on screen, me. */
function usePeopleIndex(
  channelId: string,
  people: readonly Author[],
): ReadonlyMap<string, Author> {
  const messages = useChannelMessages(channelId)?.messages;
  const me = useSession((s) => s.user);
  return useMemo(() => {
    const index = new Map<string, Author>();
    for (const message of messages ?? [])
      if (message.author) index.set(message.author.id, message.author);
    for (const person of people) index.set(person.id, person);
    if (me)
      index.set(me.id, {
        id: me.id,
        username: me.username,
        display_name: me.display_name,
        avatar_url: me.avatar_url,
      });
    return index;
  }, [messages, people, me]);
}

function EmojiTab({
  reaction,
  selected,
  onPress,
}: {
  reaction: Reaction;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      accessibilityLabel={`${emojiLabel(reaction.emoji)}, ${reaction.count}`}
      onPress={onPress}
      style={{
        minHeight: 44,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 4,
        marginBottom: -1,
        borderBottomWidth: 2,
        borderBottomColor: selected ? theme.ink1 : "transparent",
      }}
    >
      <EmojiGlyph value={reaction.emoji} size={18} />
      <Text
        variant="num"
        style={{ fontSize: 11, color: selected ? theme.ink1 : theme.ink3 }}
      >
        {reaction.count}
      </Text>
    </Pressable>
  );
}

function PersonRow({
  person,
  userId,
  mine,
  onRemove,
  onOpen,
}: {
  person: Author | undefined;
  userId: string;
  mine: boolean;
  onRemove: () => void;
  /** Opens their profile. */
  onOpen: () => void;
}) {
  const theme = useTheme();
  const name = person ? authorName(person) : "Unknown member";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}'s profile`}
      onPress={onOpen}
      style={({ pressed }) => ({
        minHeight: 52,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingVertical: 6,
        paddingHorizontal: 16,
        backgroundColor: pressed ? theme.tint2 : "transparent",
      })}
    >
      <Avatar name={name} size={32} uri={mediaUrl(person?.avatar_url)} />
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
          @{person?.username ?? userId.slice(0, 8)}
        </Text>
      </View>
      {mine ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Remove your reaction"
          onPress={onRemove}
          hitSlop={6}
          style={({ pressed }) => ({
            height: 36,
            paddingHorizontal: 12,
            justifyContent: "center",
            borderRadius: RADIUS,
            borderWidth: 2,
            borderColor: theme.lineStrong,
            backgroundColor: pressed ? theme.tint2 : "transparent",
          })}
        >
          <Text variant="control" style={{ fontSize: 14 }}>
            Remove
          </Text>
        </Pressable>
      ) : null}
    </Pressable>
  );
}

function Details({
  message,
  initial,
  people,
  onClose,
}: {
  message: ChatMessage;
  initial: string;
  people: ReadonlyMap<string, Author>;
  onClose: () => void;
}) {
  const theme = useTheme();
  const myId = useSession((s) => s.user?.id);
  const reactions = message.reactions ?? [];
  const [chosen, setChosen] = useState(initial);
  const selected =
    reactions.find((reaction) => reaction.emoji === chosen) ?? reactions[0];
  const total = reactions.reduce((sum, reaction) => sum + reaction.count, 0);
  if (!selected) return null;
  const users = selected.users ?? [];
  // The payload can list fewer people than the count (an older server).
  const others = Math.max(0, selected.count - users.length);

  return (
    <View>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingLeft: 16,
          paddingRight: 12,
          paddingBottom: 6,
        }}
      >
        <Text variant="silk" tone="ink3" style={{ flex: 1 }}>
          Reactions · {total}
        </Text>
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
      <View style={{ borderBottomWidth: 1, borderBottomColor: theme.line }}>
        <ScrollView
          horizontal
          accessibilityRole="tablist"
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 18, paddingHorizontal: 12 }}
        >
          {reactions.map((reaction) => (
            <EmojiTab
              key={reaction.emoji}
              reaction={reaction}
              selected={reaction === selected}
              onPress={() => setChosen(reaction.emoji)}
            />
          ))}
        </ScrollView>
      </View>
      <View style={{ paddingVertical: 4 }}>
        {users.map((userId) => (
          <PersonRow
            key={userId}
            userId={userId}
            person={people.get(userId)}
            mine={userId === myId}
            onRemove={() => {
              tapHaptic();
              void toggleReaction(message, selected.emoji);
            }}
            onOpen={() => {
              // The profile opens over the app, not over this sheet.
              onClose();
              openProfile(userId, people.get(userId));
            }}
          />
        ))}
        {others > 0 ? (
          <Text
            variant="row"
            tone="ink3"
            style={{ paddingHorizontal: 16, paddingVertical: 10 }}
          >
            and {others} {others === 1 ? "other" : "others"}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/**
 * Who reacted, from a long-press on a chip: a tab per emoji, the people
 * under it (from the message's own `users`), and Remove on your own row.
 * It follows the live message, and closes when the last reaction goes.
 */
export function ReactionsSheet({
  target,
  people,
  onClose,
}: {
  target: ReactionsTarget | null;
  people: readonly Author[];
  onClose: () => void;
}) {
  const index = usePeopleIndex(target?.channelId ?? "", people);
  const message = useChannelMessages(target?.channelId ?? "")?.messages.find(
    (entry) => entry.id === target?.messageId,
  );
  const open = target !== null && !!message?.reactions?.length;
  // The last reaction went (or the message did): let go of the target.
  useEffect(() => {
    if (target && !open) onClose();
  }, [target, open, onClose]);
  return (
    <Sheet visible={open} onClose={onClose} label="Reactions" expandable>
      {open && message && target ? (
        <Details
          key={target.messageId}
          message={message}
          initial={target.emoji}
          people={index}
          onClose={onClose}
        />
      ) : null}
    </Sheet>
  );
}
