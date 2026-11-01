import { useEffect } from "react";
import { View } from "react-native";
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { RADIUS, useTheme } from "@/theme";

const WIDTH = 56;
const HEIGHT = 28;
const THUMB = 24;
const INSET = (HEIGHT - THUMB) / 2;
const TRAVEL = WIDTH - THUMB - INSET * 2;

/**
 * The C1 LED switch's key, drawn only: the row around it owns the press and
 * the switch semantics. Off is a tint-3 track with an ink-2 thumb; on fades
 * primary-fill in, the on-primary thumb slides across and a talk LED lights
 * in the track. 150ms, still at rest.
 */
export function SwitchKey({ on }: { on: boolean }) {
  const theme = useTheme();
  const progress = useSharedValue(on ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(on ? 1 : 0, {
      duration: 150,
      easing: Easing.out(Easing.cubic),
    });
  }, [on, progress]);

  const fill = useAnimatedStyle(() => ({ opacity: progress.value }));
  const thumb = useAnimatedStyle(() => ({
    transform: [{ translateX: progress.value * TRAVEL }],
    backgroundColor: interpolateColor(
      progress.value,
      [0, 1],
      [theme.ink2, theme.onPrimary],
    ),
  }));

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: WIDTH,
        height: HEIGHT,
        borderRadius: RADIUS,
        backgroundColor: theme.tint3,
        overflow: "hidden",
      }}
    >
      <Animated.View
        style={[
          {
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: theme.primaryFill,
            justifyContent: "center",
            paddingLeft: 10,
          },
          fill,
        ]}
      >
        <View
          style={{
            width: 8,
            height: 8,
            borderRadius: 1,
            backgroundColor: theme.talk,
          }}
        />
      </Animated.View>
      <Animated.View
        style={[
          {
            position: "absolute",
            top: INSET,
            left: INSET,
            width: THUMB,
            height: THUMB,
            borderRadius: RADIUS,
            shadowColor: theme.shadow,
            shadowOffset: { width: 0, height: 1 },
            shadowOpacity: 1,
            shadowRadius: 2,
            elevation: 1,
          },
          thumb,
        ]}
      />
    </View>
  );
}
