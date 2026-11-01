import { memo, useMemo } from "react";
import { Pressable, View } from "react-native";

import { useSession } from "@/features/auth/session";
import { mediaUrl } from "@/lib/api";
import { FONT, RADIUS, useTheme } from "@/theme";
import { Avatar, Led, Text } from "@/ui";

import { authorName } from "./authors";
import { CustomEmoji } from "./markdown/CustomEmoji";
import { Markdown } from "./markdown/Markdown";
import { mentionsViewer } from "./markdown/mentions-viewer";
import { parseMessage } from "./markdown/parse";
import { messageMedia } from "./media/classify";
import { MessageMedia } from "./media/MessageMedia";
import { discardSend, retrySend, toggleReaction } from "./mutations";
import type { Reaction, ReplyPreview } from "./schema";
import type { ChatMessage } from "./store";
import { formatTime } from "./time";

const AVATAR = 40;
const GUTTER = 12;

interface MessageRowProps {
  message: ChatMessage;
  sentAt: Date;
  /** A follow-up from the same author: no avatar, no name line. */
  grouped: boolean;
  onLongPress: (message: ChatMessage) => void;
}

export const MessageRow = memo(function MessageRow({
  message,
  sentAt,
  grouped,
  onLongPress,
}: MessageRowProps) {
  const theme = useTheme();
  const username = useSession((s) => s.user?.username);
  const myId = useSession((s) => s.user?.id);
  const blocks = useMemo(
    () => parseMessage(message.id, message.content ?? ""),
    [message.id, message.content],
  );
  const media = useMemo(() => messageMedia(message), [message]);
  const targetsMe = mentionsViewer(message, { id: myId, username });
  const name = authorName(message.author);

  return (
    <Pressable
      onLongPress={() => onLongPress(message)}
      delayLongPress={350}
      accessibilityHint="Long press for actions"
      style={({ pressed }) => ({
        paddingHorizontal: 16,
        paddingTop: grouped ? 2 : 12,
        paddingBottom: 2,
        backgroundColor: pressed
          ? theme.tint1
          : targetsMe
            ? theme.accentTint
            : "transparent",
      })}
    >
      {targetsMe ? (
        <View
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 2,
            backgroundColor: theme.accentInk,
          }}
        />
      ) : null}
      {message.reply_to ? <ReplyQuote reply={message.reply_to} /> : null}
      <View style={{ flexDirection: "row", gap: GUTTER }}>
        {grouped ? (
          <View style={{ width: AVATAR }} />
        ) : (
          <Avatar
            name={name}
            size={AVATAR}
            uri={mediaUrl(message.author?.avatar_url)}
          />
        )}
        <View
          style={{
            flex: 1,
            minWidth: 0,
            opacity: message.send === "sending" ? 0.56 : 1,
          }}
        >
          {grouped ? null : (
            <View
              style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}
            >
              <Text variant="name" numberOfLines={1} style={{ flexShrink: 1 }}>
                {name}
              </Text>
              <Text variant="num" tone="ink3" style={{ fontSize: 11 }}>
                {formatTime(sentAt)}
              </Text>
            </View>
          )}
          {blocks.length > 0 ? (
            <Markdown blocks={blocks} edited={!!message.updated_at} />
          ) : null}
          <MessageMedia media={media} messageId={message.id} />
          {message.reactions?.length ? (
            <Reactions message={message} reactions={message.reactions} />
          ) : null}
          {message.send === "failed" ? <FailedSend message={message} /> : null}
        </View>
      </View>
    </Pressable>
  );
});

const CUSTOM_EMOJI_TOKEN = /<a?:(\w+):[\w-]+>/g;

/** The quoted header line of a reply: who and the first line of what. */
function ReplyQuote({ reply }: { reply: ReplyPreview }) {
  const theme = useTheme();
  const text =
    reply.content?.trim().replace(CUSTOM_EMOJI_TOKEN, ":$1:") ||
    (reply.attachment_count ? "Attachment" : "Original message");
  return (
    <View
      accessible
      accessibilityLabel={`Reply to ${authorName(reply.author)}: ${text}`}
      style={{
        flexDirection: "row",
        alignItems: "center",
        height: 20,
        marginBottom: 2,
      }}
    >
      {/* An elbow from the avatar's centre up to the quoted line. */}
      <View
        style={{
          width: AVATAR / 2 + GUTTER - 4,
          height: 9,
          marginLeft: AVATAR / 2 - 1,
          marginTop: 11,
          marginRight: 4,
          borderLeftWidth: 2,
          borderTopWidth: 2,
          borderColor: theme.guide,
          borderTopLeftRadius: RADIUS,
        }}
      />
      <Text
        variant="row"
        tone="ink2"
        numberOfLines={1}
        style={{
          fontFamily: FONT.rowStrong,
          fontSize: 13,
          lineHeight: 18,
          maxWidth: "40%",
          marginRight: 6,
        }}
      >
        {authorName(reply.author)}
      </Text>
      <Text
        variant="body"
        tone="ink3"
        numberOfLines={1}
        style={{ flex: 1, fontSize: 13, lineHeight: 18 }}
      >
        {text}
      </Text>
    </View>
  );
}

/** Count chips; the user's own reaction sits on the accent tint. */
function Reactions({
  message,
  reactions,
}: {
  message: ChatMessage;
  reactions: readonly Reaction[];
}) {
  const theme = useTheme();
  return (
    <View
      style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 }}
    >
      {reactions.map((reaction) => (
        <Pressable
          key={reaction.emoji}
          accessibilityRole="button"
          accessibilityState={{ selected: reaction.me }}
          accessibilityLabel={`${reaction.emoji.replace(CUSTOM_EMOJI_TOKEN, ":$1:")}, ${reaction.count}${reaction.me ? ", yours" : ""}`}
          disabled={!!message.send}
          onPress={() => void toggleReaction(message, reaction.emoji)}
          hitSlop={4}
          style={({ pressed }) => ({
            height: 28,
            minWidth: 44,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            paddingHorizontal: 8,
            borderRadius: RADIUS,
            borderWidth: 1,
            borderColor: reaction.me ? theme.accentInk : theme.lineStrong,
            backgroundColor: reaction.me
              ? theme.accentTint
              : pressed
                ? theme.tint2
                : "transparent",
          })}
        >
          <ReactionEmoji emoji={reaction.emoji} />
          <Text
            variant="num"
            style={{
              fontSize: 11,
              color: reaction.me ? theme.accentInk : theme.ink2,
            }}
          >
            {reaction.count}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const REACTION_TEXT = { fontSize: 15, lineHeight: 20 } as const;

/** Unicode as text; a server emoji, `<:name:id>`, as its image. */
function ReactionEmoji({ emoji }: { emoji: string }) {
  const theme = useTheme();
  const custom = /^<a?:(\w+):([\w-]+)>$/.exec(emoji);
  if (custom?.[1] && custom[2]) {
    return (
      <CustomEmoji
        name={custom[1]}
        id={custom[2]}
        size={18}
        fallbackStyle={{ ...REACTION_TEXT, color: theme.ink1 }}
      />
    );
  }
  return <Text style={REACTION_TEXT}>{emoji}</Text>;
}

/** "Not sent" with Retry and Delete, under a send that failed. */
function FailedSend({ message }: { message: ChatMessage }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        marginTop: 4,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Led state="danger" size={6} />
        <Text variant="silk" tone="ink2" numberOfLines={1}>
          Not sent
        </Text>
      </View>
      <TextKey label="Retry" onPress={() => retrySend(message)} />
      <TextKey label="Delete" onPress={() => discardSend(message)} />
    </View>
  );
}

function TextKey({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => ({
        height: 28,
        paddingHorizontal: 8,
        justifyContent: "center",
        borderRadius: RADIUS,
        backgroundColor: pressed ? theme.tint2 : "transparent",
      })}
    >
      <Text variant="control" style={{ fontSize: 13 }}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Hairlines either side of the day in silkscreen. */
export const DayDivider = memo(function DayDivider({
  label,
}: {
  label: string;
}) {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="header"
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingHorizontal: 16,
        paddingTop: 16,
        paddingBottom: 4,
      }}
    >
      <View style={{ flex: 1, height: 1, backgroundColor: theme.line }} />
      <Text variant="silk" tone="ink3" numberOfLines={1}>
        {label}
      </Text>
      <View style={{ flex: 1, height: 1, backgroundColor: theme.line }} />
    </View>
  );
});
