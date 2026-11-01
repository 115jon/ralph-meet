import { memo } from "react";
import { Pressable, View } from "react-native";

import { authorName } from "@/features/chat/authors";
import { formatListTime, parseTimestamp } from "@/features/chat/time";
import { mediaUrl } from "@/lib/api";
import { FONT, useTheme } from "@/theme";
import { Avatar, Text } from "@/ui";

import type { Notification } from "./schema";

function verbFor(type: string): string {
  switch (type) {
    case "mention":
      return "mentioned you";
    case "reply":
      return "replied to you";
    case "dm":
      return "sent you a message";
    default:
      return "pinged you";
  }
}

function where(n: Notification): string {
  if (!n.server_id) return "Direct message";
  const channel = n.channel_name ? `#${n.channel_name}` : "a channel";
  return n.server_name ? `${channel} · ${n.server_name}` : channel;
}

/** Who did what, where, and the snippet; unread rows carry the ink pill. */
export const ActivityRow = memo(function ActivityRow({
  notification: n,
  onOpen,
}: {
  notification: Notification;
  onOpen: (n: Notification) => void;
}) {
  const theme = useTheme();
  const name = authorName(n.from_user);
  const verb = verbFor(n.type);
  const unread = !n.is_read;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name} ${verb} in ${where(n)}${unread ? ", unread" : ""}`}
      onPress={() => onOpen(n)}
      style={({ pressed }) => ({
        flexDirection: "row",
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: theme.line,
        backgroundColor: pressed ? theme.tint2 : "transparent",
      })}
    >
      {unread ? (
        <View
          style={{
            position: "absolute",
            left: 0,
            top: 20,
            width: 2,
            height: 16,
            backgroundColor: theme.ink1,
          }}
        />
      ) : null}
      <Avatar name={name} uri={mediaUrl(n.from_user.avatar_url)} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
          <Text
            variant="row"
            tone={unread ? "ink1" : "ink2"}
            numberOfLines={1}
            style={{ flex: 1, fontFamily: unread ? FONT.rowStrong : FONT.row }}
          >
            <Text variant="name" tone={unread ? "ink1" : "ink2"}>
              {name}
            </Text>{" "}
            {verb}
          </Text>
          <Text variant="num" tone="ink3" style={{ fontSize: 11 }}>
            {formatListTime(parseTimestamp(n.created_at))}
          </Text>
        </View>
        {n.content?.trim() ? (
          <Text
            variant="body"
            tone={unread ? "ink1" : "ink2"}
            numberOfLines={2}
            style={{ fontSize: 14, lineHeight: 20 }}
          >
            {n.content.trim()}
          </Text>
        ) : null}
        <Text
          variant="num"
          tone="ink3"
          numberOfLines={1}
          style={{ fontSize: 11, lineHeight: 14 }}
        >
          {where(n)}
        </Text>
      </View>
    </Pressable>
  );
});
