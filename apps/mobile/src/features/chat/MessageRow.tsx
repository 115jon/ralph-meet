import { ArrowBendUpLeft } from "phosphor-react-native";
import { memo, useCallback, useMemo } from "react";
import { Pressable, View } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { useSession } from "@/features/auth/session";
import { mediaUrl } from "@/lib/api";
import { tapHaptic } from "@/lib/haptics";
import { FONT, RADIUS, useTheme } from "@/theme";
import { Avatar, Icon, Led, Text } from "@/ui";

import { authorName } from "./authors";
import { LONG_PRESS_MS, MessageLongPress } from "./long-press";
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

/** Pulled this far left, letting go replies; past it the row drags heavier. */
const REPLY_AT = 64;
const MAX_PULL = 96;
/** Leftward travel before the swipe claims the touch (the pager takes rightward). */
const SWIPE_SLOP = 16;
const SNAP_BACK = { duration: 200, easing: Easing.out(Easing.cubic) };

/**
 * Swipe a message left to reply, as on Discord: a reply arrow fades in
 * behind it, a light knock says it is armed, and letting go sets the
 * composer to reply. Rightward drags belong to the pager.
 */
function useSwipeToReply(enabled: boolean, onReply: () => void) {
  const reducedMotion = useReducedMotion();
  const offset = useSharedValue(0);
  const armed = useSharedValue(false);
  const gesture = usePanGesture({
    enabled,
    activeOffsetX: -SWIPE_SLOP,
    failOffsetX: SWIPE_SLOP,
    failOffsetY: [-10, 10],
    onUpdate: (event) => {
      "worklet";
      const pull = Math.max(0, -event.translationX);
      const eased =
        pull <= REPLY_AT ? pull : REPLY_AT + (pull - REPLY_AT) * 0.35;
      offset.set(-Math.min(MAX_PULL, eased));
      const nowArmed = pull >= REPLY_AT;
      if (nowArmed !== armed.get()) {
        armed.set(nowArmed);
        if (nowArmed) scheduleOnRN(tapHaptic);
      }
    },
    onDeactivate: () => {
      "worklet";
      if (armed.get()) scheduleOnRN(onReply);
    },
    onFinalize: () => {
      "worklet";
      armed.set(false);
      offset.set(reducedMotion ? 0 : withTiming(0, SNAP_BACK));
    },
  });
  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.get() }],
  }));
  const arrowStyle = useAnimatedStyle(() => {
    const pull = -offset.get();
    const shown = interpolate(
      pull,
      [SWIPE_SLOP, REPLY_AT],
      [0, 1],
      Extrapolation.CLAMP,
    );
    return { opacity: shown, transform: [{ scale: 0.6 + 0.4 * shown }] };
  });
  return { gesture, rowStyle, arrowStyle };
}

/** Screen readers reach the swipe and the sheet as actions. */
const ROW_ACTIONS = [
  { name: "reply", label: "Reply" },
  { name: "longpress", label: "Message actions" },
];

interface MessageRowProps {
  message: ChatMessage;
  sentAt: Date;
  /** A follow-up from the same author: no avatar, no name line. */
  grouped: boolean;
  onLongPress: (message: ChatMessage) => void;
  onReply: (message: ChatMessage) => void;
}

export const MessageRow = memo(function MessageRow({
  message,
  sentAt,
  grouped,
  onLongPress,
  onReply,
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
  const openActions = useCallback(
    () => onLongPress(message),
    [onLongPress, message],
  );
  const reply = useCallback(() => onReply(message), [onReply, message]);
  const swipe = useSwipeToReply(!message.send, reply);

  return (
    <MessageLongPress value={openActions}>
      <View>
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: "absolute",
              top: 0,
              bottom: 0,
              right: 20,
              justifyContent: "center",
            },
            swipe.arrowStyle,
          ]}
        >
          <Icon icon={ArrowBendUpLeft} size={20} color={theme.ink2} />
        </Animated.View>
        <GestureDetector gesture={swipe.gesture}>
          <Animated.View style={swipe.rowStyle}>
            <Pressable
              onLongPress={openActions}
              delayLongPress={LONG_PRESS_MS}
              accessibilityHint="Long press for actions, swipe left to reply"
              accessibilityActions={message.send ? undefined : ROW_ACTIONS}
              onAccessibilityAction={(event) => {
                if (event.nativeEvent.actionName === "reply") reply();
                else openActions();
              }}
              style={({ pressed }) => ({
                paddingHorizontal: 16,
                paddingTop: grouped ? 2 : 12,
                paddingBottom: 2,
                backgroundColor: pressed
                  ? theme.tint1
                  : targetsMe
                    ? theme.accentTint
                    : theme.ply0,
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
              {message.reply_to ? (
                <ReplyQuote reply={message.reply_to} />
              ) : null}
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
                      style={{
                        flexDirection: "row",
                        alignItems: "baseline",
                        gap: 8,
                      }}
                    >
                      <Text
                        variant="name"
                        numberOfLines={1}
                        style={{ flexShrink: 1 }}
                      >
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
                    <Reactions
                      message={message}
                      reactions={message.reactions}
                    />
                  ) : null}
                  {message.send === "failed" ? (
                    <FailedSend message={message} />
                  ) : null}
                </View>
              </View>
            </Pressable>
          </Animated.View>
        </GestureDetector>
      </View>
    </MessageLongPress>
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
        minHeight: 20,
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
          onPress={() => {
            tapHaptic();
            void toggleReaction(message, reaction.emoji);
          }}
          // 32 tall and 8 more above and below: a 48dp target. Neighbours
          // sit 6 apart, so 3 a side never overlaps.
          hitSlop={{ top: 8, bottom: 8, left: 3, right: 3 }}
          style={({ pressed }) => ({
            minHeight: 32,
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
      hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
      style={({ pressed }) => ({
        minHeight: 32,
        minWidth: 48,
        alignItems: "center",
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
