import { useEffect } from "react";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { Led } from "./Led";

/** DESIGN's one LED language: on in 60ms, off in 220ms, opacity only. */
const ON_MS = 60;
const OFF_MS = 220;

/**
 * A talk LED that lights while `lit` (someone speaking) and fades out
 * after; at rest it is fully transparent and costs no frames.
 */
export function TalkLed({ lit, size = 8 }: { lit: boolean; size?: number }) {
  const reducedMotion = useReducedMotion();
  const opacity = useSharedValue(lit ? 1 : 0);
  useEffect(() => {
    const next = lit ? 1 : 0;
    opacity.set(
      reducedMotion
        ? next
        : withTiming(next, { duration: lit ? ON_MS : OFF_MS }),
    );
  }, [lit, opacity, reducedMotion]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={style}
    >
      <Led state="talk" size={size} />
    </Animated.View>
  );
}
