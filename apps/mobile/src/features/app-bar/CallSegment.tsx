import { MicrophoneSlash, Microphone } from "phosphor-react-native";
import { useEffect } from "react";
import { Pressable, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { RADIUS, useTheme } from "@/theme";
import { Icon, Led, Text } from "@/ui";

import { useCallSegmentActions, type CallSegmentState } from "./call-segment";

const ENTER_MS = 200;

/** Leading segment of the bar while in a call: LED, channel, status, mute key. */
export function CallSegment({ call }: { call: CallSegmentState }) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const { toggleMute } = useCallSegmentActions();
  const progress = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(1, {
      duration: reduceMotion ? 0 : ENTER_MS,
      easing: Easing.out(Easing.cubic),
    });
  }, [progress, reduceMotion]);

  // Opacity and translate only; never layout.
  const animated = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateX: (1 - progress.value) * -12 }],
  }));

  return (
    <Animated.View
      style={[
        {
          flex: 1,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          paddingLeft: 12,
          paddingRight: 6,
        },
        animated,
      ]}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Led state="talk" />
          <Text
            variant="silk"
            numberOfLines={1}
            style={{ color: theme.talk, flexShrink: 1 }}
          >
            {call.channel}
          </Text>
        </View>
        <Text
          variant="name"
          numberOfLines={1}
          style={{ fontSize: 13, lineHeight: 17 }}
        >
          {call.status}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={call.muted ? "Unmute" : "Mute"}
        accessibilityState={{ selected: call.muted }}
        onPress={toggleMute}
        style={{
          width: 40,
          height: 40,
          borderRadius: RADIUS,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: call.muted ? theme.dangerTint : theme.tint1,
        }}
      >
        <Icon
          icon={call.muted ? MicrophoneSlash : Microphone}
          active={call.muted}
          size={22}
          color={call.muted ? theme.dangerInk : theme.ink1}
        />
      </Pressable>
    </Animated.View>
  );
}
