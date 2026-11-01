import {
  Hash,
  Microphone,
  MicrophoneSlash,
  PhoneX,
} from "phosphor-react-native";
import { useEffect, useMemo, useState } from "react";
import { Keyboard, Pressable, View } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { authorName } from "@/features/chat/authors";
import { ChatView } from "@/features/chat/ChatView";
import type { Author } from "@/features/chat/schema";
import { useDm } from "@/features/dms/store";
import { loadMembers } from "@/features/members/actions";
import { useMemberAuthors } from "@/features/members/store";
import { mediaUrl } from "@/lib/api";
import { RADIUS, SHEET_TOP_RADIUS, useTheme } from "@/theme";
import { Avatar, Icon, Text } from "@/ui";

import { leaveCall, toggleMute } from "./actions";
import type { CallSummary } from "./store";

/** Where the drawer opens the first time in a call (of the screen's height). */
const OPEN_RATIO = 0.55;
/** Let go below this share of the half height and it closes. */
const CLOSE_RATIO = 0.6;
const FLING = 900;
const SETTLE = { duration: 220, easing: Easing.out(Easing.cubic) };

/** The drawer's last height in each call, so it reopens where it was left. */
const remembered = new Map<string, number>();

interface CallChatDrawerProps {
  open: boolean;
  onClose: () => void;
  call: CallSummary;
  /** The drawer's full height: from under the call header to the bottom. */
  maxHeight: number;
  /** The height it settled at (0 once closed), for the tiles to make room. */
  onSettle: (height: number) => void;
}

function MiniKey({
  label,
  danger = false,
  on = false,
  icon,
  onPress,
}: {
  label: string;
  danger?: boolean;
  on?: boolean;
  icon: typeof Microphone;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={danger ? undefined : { selected: on }}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 40,
        height: 40,
        borderRadius: RADIUS,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: danger
          ? theme.dangerFill
          : on
            ? theme.dangerTint
            : theme.tint1,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <Icon
        icon={icon}
        active={danger || on}
        size={20}
        color={danger ? theme.onDanger : on ? theme.dangerInk : theme.ink1}
      />
    </Pressable>
  );
}

/** The call's chat: a voice channel's own text chat, or the DM. */
function useCallChat(call: CallSummary) {
  const dm = useDm(call.channelId);
  const members = useMemberAuthors(call.serverId || null);
  useEffect(() => {
    if (call.serverId) void loadMembers(call.serverId);
  }, [call.serverId]);
  const recipient = dm?.recipient;
  const people = useMemo<readonly Author[]>(
    () => (call.peerId ? (recipient ? [recipient] : []) : members),
    [call.peerId, recipient, members],
  );
  if (call.peerId) {
    const name = recipient ? authorName(recipient) : call.channelName;
    return {
      title: name,
      people,
      avatar: { name, uri: mediaUrl(recipient?.avatar_url) },
    };
  }
  return { title: call.channelName, people, avatar: null };
}

/**
 * Chat over the call (mockup 03, A): a drawer that rises to 55% from the
 * Chat key, so a staged share stays in view above it, and drags to full
 * height or down to close. While it is up the dock steps aside; its Mute
 * and Leave ride in the drawer's header so neither is ever shown twice.
 * The keyboard takes it to full height.
 */
export function CallChatDrawer({
  open,
  onClose,
  call,
  maxHeight,
  onSettle,
}: CallChatDrawerProps) {
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const chat = useCallChat(call);
  const height = useSharedValue(0);
  const start = useSharedValue(0);
  const [mounted, setMounted] = useState(open);
  // Opening mounts at once; closing unmounts once the drawer has sunk.
  if (open && !mounted) setMounted(true);
  const half = Math.round(maxHeight * OPEN_RATIO);
  const key = call.channelId;

  const settle = (to: number) => {
    "worklet";
    return reducedMotion ? to : withTiming(to, SETTLE);
  };

  // Opening rises to where it was left; closing sinks, then unmounts.
  useEffect(() => {
    if (open) {
      const to = Math.min(maxHeight, remembered.get(key) ?? half);
      height.set(reducedMotion ? to : withTiming(to, SETTLE));
      onSettle(to);
      return;
    }
    onSettle(0);
    height.set(
      withTiming(0, reducedMotion ? { duration: 0 } : SETTLE, (finished) => {
        if (finished) scheduleOnRN(setMounted, false);
      }),
    );
  }, [open, maxHeight, half, key, reducedMotion, height, onSettle]);

  // The keyboard needs the room: full height while it is up.
  useEffect(() => {
    if (!open) return;
    const show = Keyboard.addListener("keyboardDidShow", () => {
      height.set(reducedMotion ? maxHeight : withTiming(maxHeight, SETTLE));
      onSettle(maxHeight);
    });
    return () => show.remove();
  }, [open, maxHeight, reducedMotion, height, onSettle]);

  const snapTo = (to: number) => {
    if (to === 0) {
      remembered.delete(key);
      onClose();
      return;
    }
    remembered.set(key, to);
    onSettle(to);
  };

  const drag = usePanGesture({
    activeOffsetY: [-6, 6],
    onActivate: () => {
      "worklet";
      start.set(height.get());
    },
    onUpdate: (event) => {
      "worklet";
      height.set(
        Math.min(maxHeight, Math.max(0, start.get() - event.translationY)),
      );
    },
    onDeactivate: (event) => {
      "worklet";
      const now = height.get();
      let to: number;
      if (event.velocityY > FLING || now < half * CLOSE_RATIO) to = 0;
      else if (event.velocityY < -FLING) to = maxHeight;
      else
        to =
          Math.abs(now - half) < Math.abs(now - maxHeight) ? half : maxHeight;
      if (to > 0) height.set(settle(to));
      scheduleOnRN(snapTo, to);
    },
  });

  const style = useAnimatedStyle(() => ({ height: height.get() }));

  if (!mounted) return null;

  const header = (
    <GestureDetector gesture={drag}>
      <View
        accessible={false}
        style={{ paddingTop: 8, paddingBottom: 6, paddingHorizontal: 12 }}
      >
        <View
          style={{
            width: 32,
            height: 3,
            borderRadius: 2,
            alignSelf: "center",
            marginBottom: 8,
            backgroundColor: theme.lineStrong,
          }}
        />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {chat.avatar ? (
            <Avatar name={chat.avatar.name} size={24} uri={chat.avatar.uri} />
          ) : (
            <Icon icon={Hash} size={18} color={theme.ink3} />
          )}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text
              variant="name"
              numberOfLines={1}
              accessibilityRole="header"
              style={{ fontSize: 15, lineHeight: 20 }}
            >
              {chat.title}
            </Text>
            <Text variant="silk" tone="ink3" numberOfLines={1}>
              {call.peerId ? "Direct message" : "Voice chat"}
            </Text>
          </View>
          <MiniKey
            label={call.muted ? "Unmute" : "Mute"}
            icon={call.muted ? MicrophoneSlash : Microphone}
            on={call.muted}
            onPress={toggleMute}
          />
          <MiniKey
            label="Leave the call"
            icon={PhoneX}
            danger
            onPress={leaveCall}
          />
        </View>
      </View>
    </GestureDetector>
  );

  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          overflow: "hidden",
          backgroundColor: theme.ply0,
          borderTopWidth: 2,
          borderTopColor: theme.ink1,
          borderTopLeftRadius: SHEET_TOP_RADIUS,
          borderTopRightRadius: SHEET_TOP_RADIUS,
          shadowColor: theme.shadow,
          shadowOffset: { width: 0, height: -12 },
          shadowOpacity: 1,
          shadowRadius: 32,
          elevation: 24,
        },
        style,
      ]}
    >
      <View style={{ flex: 1 }}>
        <ChatView
          channelId={call.channelId}
          title={call.peerId ? chat.title : `#${chat.title}`}
          subtitle={call.peerId ? "Direct message" : "Voice chat"}
          placeholder={`Message ${chat.title}`}
          intro={
            call.peerId
              ? `This is the start of your messages with ${chat.title}.`
              : `This is the start of ${chat.title}'s chat.`
          }
          people={chat.people}
          attended={open}
          header={header}
        />
      </View>
    </Animated.View>
  );
}
