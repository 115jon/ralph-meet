import { formatCallDuration } from "@ralph/protocol";
import { useEffect, useState, type ReactNode } from "react";
import { View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { RADIUS, useTheme } from "@/theme";
import { Text } from "@/ui";

/**
 * The talk-green ring around a ringing avatar: the one loop Talk Tree
 * allows, mounted only while it rings. With reduced motion it is a still
 * 2px ring.
 */
export function RingPulse({
  size,
  ringing,
  children,
}: {
  /** The avatar's side. */
  size: number;
  ringing: boolean;
  children: ReactNode;
}) {
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const progress = useSharedValue(0);

  useEffect(() => {
    if (!ringing || reducedMotion) return;
    progress.value = 0;
    progress.value = withRepeat(
      withTiming(1, { duration: 1400, easing: Easing.out(Easing.cubic) }),
      -1,
      false,
    );
    return () => cancelAnimation(progress);
  }, [ringing, reducedMotion, progress]);

  const pulse = useAnimatedStyle(() => ({
    opacity: 0.7 * (1 - progress.value),
    transform: [{ scale: 1 + 0.22 * progress.value }],
  }));

  const ring = size + 12;
  return (
    <View
      style={{
        width: ring,
        height: ring,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {ringing ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            width: ring,
            height: ring,
            borderRadius: RADIUS,
            borderWidth: 2,
            borderColor: theme.talk,
            opacity: reducedMotion ? 1 : 0.35,
          }}
        />
      ) : null}
      {ringing && !reducedMotion ? (
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: "absolute",
              width: ring,
              height: ring,
              borderRadius: RADIUS,
              borderWidth: 2,
              borderColor: theme.talk,
            },
            pulse,
          ]}
        />
      ) : null}
      {children}
    </View>
  );
}

/** A clock from `since`, ticking in its own leaf so nothing else re-renders. */
export function CallClock({ since, color }: { since: number; color?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <Text variant="num" style={color ? { color } : undefined}>
      {formatCallDuration(Math.floor((now - since) / 1000))}
    </Text>
  );
}
