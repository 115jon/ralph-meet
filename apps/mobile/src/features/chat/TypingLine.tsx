import { useMemo } from "react";
import { View } from "react-native";

import { Led, Text } from "@/ui";

import { authorName } from "./authors";
import type { Author } from "./schema";
import { useChannelMessages, useTypingIds } from "./store";

function sentence(names: readonly string[]): string {
  const [first, second] = names;
  if (!first) return "";
  if (names.length === 1) return `${first} is typing`;
  if (names.length === 2) return `${first} and ${second} are typing`;
  return "Several people are typing";
}

/**
 * "kai is typing" under the history, beside a still unlit LED. Always
 * takes its line, so the list never jumps when someone starts typing.
 */
export function TypingLine({
  channelId,
  people,
}: {
  channelId: string;
  /** Who the channel knows by id: members, or the other side of a DM. */
  people: readonly Author[];
}) {
  const ids = useTypingIds(channelId);
  const messages = useChannelMessages(channelId)?.messages;
  const text = useMemo(() => {
    if (ids.length === 0) return "";
    const names = ids.map((id) => {
      const person =
        people.find((p) => p.id === id) ??
        messages?.find((m) => m.author_id === id)?.author;
      return person ? authorName(person) : "Someone";
    });
    return sentence(names);
  }, [ids, people, messages]);

  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        height: 20,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 16,
      }}
    >
      {text ? (
        <>
          <Led state="off" size={6} />
          <Text
            variant="body"
            tone="ink3"
            numberOfLines={1}
            style={{ flex: 1, fontSize: 12, lineHeight: 16 }}
          >
            {text}…
          </Text>
        </>
      ) : null}
    </View>
  );
}
