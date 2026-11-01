import { ArrowsIn, Monitor } from "phosphor-react-native";
import { lazy, Suspense, useEffect, useState } from "react";
import { Pressable, View, type LayoutChangeEvent } from "react-native";
import {
  GestureDetector,
  useCompetingGestures,
  useExclusiveGestures,
  useLongPressGesture,
  usePanGesture,
  usePinchGesture,
  useSimultaneousGestures,
  useTapGesture,
} from "react-native-gesture-handler";
import Animated, {
  Easing,
  useAnimatedReaction,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { RADIUS, useTheme } from "@/theme";
import { Icon, Led, Text } from "@/ui";

import {
  type CallTile,
  useIsSelf,
  useIsSpeaking,
  useParticipant,
  useTileMirrored,
  useTileStream,
} from "./store";

const VideoView = lazy(() => import("./VideoView"));

const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2;
const SETTLE = { duration: 200, easing: Easing.out(Easing.cubic) };
/** The readout and minimap fade this long after the last touch. */
const HINT_LINGER_MS = 1500;
const MAP_WIDTH = 56;

interface ZoomableVideoProps {
  tile: CallTile;
  /** A tap at fit: unstage (portrait) or show the controls (landscape). */
  onTap: () => void;
  onLongPress?: (tile: CallTile) => void;
  /** Full bleed (landscape): no frame, no plate. */
  bare?: boolean;
}

/**
 * A staged video you can read: a screen share (or a camera) pinches to 1–4×,
 * drags to pan, and double-taps to 2× or back to fit. While zoomed a readout
 * and a minimap show, fading 1.5 s after the last touch, and Fit resets. A
 * tap on a zoomed video does nothing (use Fit first), so reading never
 * unstages it by accident.
 */
export function ZoomableVideo({
  tile,
  onTap,
  onLongPress,
  bare = false,
}: ZoomableVideoProps) {
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const stream = useTileStream(tile);
  const mirrored = useTileMirrored(tile);
  const participant = useParticipant(tile.participantId);
  const self = useIsSelf(tile.participantId);
  const screen = tile.kind === "screen";
  const ringed = useIsSpeaking(tile.participantId) && !screen;
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [zoomLabel, setZoomLabel] = useState<string | null>(null);

  const scale = useSharedValue(1);
  const startScale = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const width = useSharedValue(0);
  const height = useSharedValue(0);
  const hint = useSharedValue(0);

  const onLayout = (event: LayoutChangeEvent) => {
    const { width: w, height: h } = event.nativeEvent.layout;
    width.set(w);
    height.set(h);
    setSize({ width: w, height: h });
  };

  const animate = (to: number) => {
    "worklet";
    return reducedMotion ? to : withTiming(to, SETTLE);
  };

  /** Keeps the picture covering the frame at scale `s`. */
  const clamp = (value: number, s: number, extent: number) => {
    "worklet";
    const limit = ((s - 1) * extent) / 2;
    return Math.min(limit, Math.max(-limit, value));
  };

  const touched = () => {
    "worklet";
    hint.set(1);
  };

  const released = () => {
    "worklet";
    hint.set(
      reducedMotion
        ? hint.get()
        : withDelay(HINT_LINGER_MS, withTiming(0, { duration: 250 })),
    );
  };

  const zoomTo = (s: number) => {
    "worklet";
    scale.set(animate(s));
    x.set(animate(0));
    y.set(animate(0));
  };

  const pinch = usePinchGesture({
    onActivate: () => {
      "worklet";
      startScale.set(scale.get());
      startX.set(x.get());
      startY.set(y.get());
      touched();
    },
    onUpdate: (event) => {
      "worklet";
      const s = Math.min(
        MAX_SCALE,
        Math.max(1, startScale.get() * event.scale),
      );
      scale.set(s);
      x.set(clamp(x.get(), s, width.get()));
      y.set(clamp(y.get(), s, height.get()));
    },
    onDeactivate: () => {
      "worklet";
      if (scale.get() < 1.05) zoomTo(1);
      released();
    },
  });

  const pan = usePanGesture({
    minPointers: 1,
    maxPointers: 2,
    onActivate: () => {
      "worklet";
      startX.set(x.get());
      startY.set(y.get());
      touched();
    },
    onUpdate: (event) => {
      "worklet";
      const s = scale.get();
      if (s <= 1) return;
      x.set(clamp(startX.get() + event.translationX, s, width.get()));
      y.set(clamp(startY.get() + event.translationY, s, height.get()));
    },
    onDeactivate: () => {
      "worklet";
      released();
    },
  });

  const doubleTap = useTapGesture({
    numberOfTaps: 2,
    maxDistance: 10,
    onActivate: () => {
      "worklet";
      touched();
      zoomTo(scale.get() > 1 ? 1 : DOUBLE_TAP_SCALE);
      released();
    },
  });

  const singleTap = useTapGesture({
    maxDistance: 10,
    onActivate: () => {
      "worklet";
      if (scale.get() <= 1) scheduleOnRN(onTap);
    },
  });

  const longPress = useLongPressGesture({
    minDuration: 400,
    onActivate: () => {
      "worklet";
      if (onLongPress && scale.get() <= 1) scheduleOnRN(onLongPress, tile);
    },
  });

  const gesture = useCompetingGestures(
    useSimultaneousGestures(pinch, pan),
    useExclusiveGestures(doubleTap, singleTap),
    longPress,
  );

  // The readout follows the scale in steps of 0.1, off at fit.
  useAnimatedReaction(
    () => Math.round(scale.get() * 10) / 10,
    (next, previous) => {
      if (next === previous) return;
      scheduleOnRN(setZoomLabel, next > 1 ? `${next.toFixed(1)}×` : null);
    },
  );

  // A different share or tile starts at fit.
  useEffect(() => {
    scale.set(1);
    x.set(0);
    y.set(0);
  }, [tile.key, scale, x, y]);

  const picture = useAnimatedStyle(() => ({
    transform: [
      { translateX: x.get() },
      { translateY: y.get() },
      { scale: scale.get() },
    ],
  }));
  const hintStyle = useAnimatedStyle(() => ({ opacity: hint.get() }));
  const mapAspect = size.width > 0 ? size.height / size.width : 9 / 16;
  const viewport = useAnimatedStyle(() => {
    const s = scale.get();
    const w = width.get() || 1;
    const h = height.get() || 1;
    const mapHeight = MAP_WIDTH * (h / w);
    return {
      width: MAP_WIDTH / s,
      height: mapHeight / s,
      left: MAP_WIDTH * (0.5 - 1 / (2 * s) - x.get() / (s * w)),
      top: mapHeight * (0.5 - 1 / (2 * s) - y.get() / (s * h)),
    };
  });

  const name = participant
    ? self
      ? `${participant.name} (you)`
      : participant.name
    : "Someone";

  return (
    <View
      onLayout={onLayout}
      accessibilityLabel={screen ? `${name}'s screen` : `${name}'s camera`}
      accessibilityHint="Pinch to zoom. Double-tap for 2× or to fit."
      style={{
        flex: 1,
        borderRadius: bare ? 0 : RADIUS,
        borderWidth: bare ? 0 : ringed ? 2 : 1,
        borderColor: ringed ? theme.talk : theme.line,
        backgroundColor: theme.ply0,
        overflow: "hidden",
      }}
    >
      <GestureDetector gesture={gesture}>
        <View style={{ flex: 1 }}>
          <Animated.View style={[{ flex: 1 }, picture]}>
            {stream ? (
              <Suspense fallback={null}>
                <VideoView
                  streamURL={stream}
                  fit={screen ? "contain" : "cover"}
                  mirror={mirrored}
                />
              </Suspense>
            ) : null}
          </Animated.View>
        </View>
      </GestureDetector>
      {zoomLabel ? (
        <>
          <Animated.View
            pointerEvents="none"
            style={[
              {
                position: "absolute",
                top: 8,
                left: 8,
                height: 24,
                paddingHorizontal: 8,
                borderRadius: RADIUS,
                justifyContent: "center",
                backgroundColor: theme.ply4,
              },
              hintStyle,
            ]}
          >
            <Text variant="num" tone="ink1">
              {zoomLabel}
            </Text>
          </Animated.View>
          <Animated.View
            pointerEvents="none"
            style={[
              {
                position: "absolute",
                top: 8,
                right: 8,
                width: MAP_WIDTH,
                height: MAP_WIDTH * mapAspect,
                borderRadius: RADIUS,
                borderWidth: 1,
                borderColor: theme.lineStrong,
                backgroundColor: "rgba(0, 0, 0, 0.6)",
                overflow: "hidden",
              },
              hintStyle,
            ]}
          >
            <Animated.View
              style={[
                {
                  position: "absolute",
                  borderWidth: 1,
                  borderColor: theme.ink1,
                  borderRadius: 1,
                },
                viewport,
              ]}
            />
          </Animated.View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Fit the share to the screen"
            onPress={() => zoomTo(1)}
            style={({ pressed }) => ({
              position: "absolute",
              right: 8,
              bottom: 8,
              height: 36,
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              paddingHorizontal: 12,
              borderRadius: RADIUS,
              backgroundColor: pressed
                ? "rgba(0, 0, 0, 0.8)"
                : "rgba(0, 0, 0, 0.6)",
            })}
          >
            <Icon icon={ArrowsIn} size={18} color="#f2f2f3" />
            <Text variant="control" style={{ color: "#f2f2f3" }}>
              Fit
            </Text>
          </Pressable>
        </>
      ) : null}
      {bare ? null : (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: 8,
            bottom: 8,
            height: 24,
            maxWidth: "60%",
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            paddingHorizontal: 8,
            borderRadius: RADIUS,
            backgroundColor: theme.ply4,
          }}
        >
          {screen ? (
            <Icon icon={Monitor} size={14} color={theme.ink2} />
          ) : (
            <Led state={ringed ? "talk" : "off"} />
          )}
          <Text
            variant="name"
            numberOfLines={1}
            style={{ fontSize: 12, lineHeight: 16, flexShrink: 1 }}
          >
            {name}
          </Text>
        </View>
      )}
    </View>
  );
}
