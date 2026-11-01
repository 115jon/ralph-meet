import { memo } from "react";
import { Pressable, View } from "react-native";

import { useUnreadInChannel } from "@/features/activity/store";
import { useSession } from "@/features/auth/session";
import { useIsCurrentConversation } from "@/features/conversation/store";
import { authorName } from "@/features/chat/authors";
import type { Message } from "@/features/chat/schema";
import { formatListTime, parseTimestamp } from "@/features/chat/time";
import { useIsUnread, useServersStore } from "@/features/servers/store";
import { mediaUrl } from "@/lib/api";
import { FONT, useTheme } from "@/theme";
import { Avatar, CountChip, Text } from "@/ui";

import { presenceLed } from "./presence";
import type { DmChannel } from "./schema";
import { useDmPreview } from "./store";

function previewText(
  message: Message | null,
  myId: string | undefined,
  fallback: string,
): string {
  if (!message) return fallback;
  const text =
    message.content?.trim() ||
    (message.attachments?.length ? "Sent an attachment" : "Sent a message");
  return message.author_id === myId ? `You: ${text}` : text;
}

/** 64px: avatar with presence, name over the last line, time and count. */
export const DmRow = memo(function DmRow({
  dm,
  onOpen,
}: {
  dm: DmChannel;
  onOpen: (dm: DmChannel) => void;
}) {
  const theme = useTheme();
  const myId = useSession((s) => s.user?.id);
  const preview = useDmPreview(dm.id);
  const unread = useIsUnread(dm.id);
  const count = useUnreadInChannel(dm.id);
  const lastAt = useServersStore((s) => s.lastMessageAt[dm.id]);
  const selected = useIsCurrentConversation(dm.id);
  const name = authorName(dm.recipient);
  const stamp = preview?.created_at ?? lastAt;
  const line = previewText(
    preview,
    myId,
    dm.recipient.custom_status?.trim() || `@${dm.recipient.username}`,
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}${unread ? ", unread" : ""}: ${line}`}
      accessibilityState={{ selected }}
      onPress={() => onOpen(dm)}
      style={({ pressed }) => ({
        minHeight: 64,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 16,
        backgroundColor: pressed || selected ? theme.tint2 : "transparent",
      })}
    >
      {unread ? (
        <View
          style={{
            position: "absolute",
            left: 0,
            top: 24,
            width: 2,
            height: 16,
            backgroundColor: theme.ink1,
          }}
        />
      ) : null}
      <Avatar
        name={name}
        uri={mediaUrl(dm.recipient.avatar_url)}
        presence={presenceLed(dm.recipient.status)}
      />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="name" numberOfLines={1}>
          {name}
        </Text>
        <Text
          variant="body"
          tone={unread ? "ink1" : "ink2"}
          numberOfLines={1}
          style={{
            fontSize: 13,
            lineHeight: 18,
            fontFamily: unread ? FONT.rowStrong : FONT.body,
          }}
        >
          {line}
        </Text>
      </View>
      <View style={{ alignItems: "flex-end", gap: 4 }}>
        {stamp ? (
          <Text
            variant="num"
            tone={unread ? "ink1" : "ink3"}
            style={{ fontSize: 11 }}
          >
            {formatListTime(parseTimestamp(stamp))}
          </Text>
        ) : null}
        <CountChip count={count} />
      </View>
    </Pressable>
  );
});
