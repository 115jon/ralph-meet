import { X } from "phosphor-react-native";
import { Modal, Pressable, View } from "react-native";
import {
  GestureDetector,
  GestureHandlerRootView,
  useExclusiveGestures,
  usePanGesture,
  usePinchGesture,
  useSimultaneousGestures,
  useTapGesture,
} from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { RADIUS } from "@/theme";
import { Icon, RemoteImage, Text } from "@/ui";

import { closeImage, useViewerImage, type ViewerImage } from "./viewer-store";

const MAX_SCALE = 5;
const SETTLE = { duration: 200 };

/** Pinch to zoom, drag while zoomed, double-tap to reset or zoom in. */
function ZoomableImage({ image }: { image: ViewerImage }) {
  const scale = useSharedValue(1);
  const startScale = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);

  const pinch = usePinchGesture({
    onActivate: () => {
      "worklet";
      startScale.value = scale.value;
    },
    onUpdate: (event) => {
      "worklet";
      scale.value = Math.min(
        MAX_SCALE,
        Math.max(1, startScale.value * event.scale),
      );
    },
    onDeactivate: () => {
      "worklet";
      if (scale.value <= 1.01) {
        x.value = withTiming(0, SETTLE);
        y.value = withTiming(0, SETTLE);
      }
    },
  });

  const pan = usePanGesture({
    minPointers: 1,
    onActivate: () => {
      "worklet";
      startX.value = x.value;
      startY.value = y.value;
    },
    onUpdate: (event) => {
      "worklet";
      if (scale.value <= 1) return;
      x.value = startX.value + event.translationX;
      y.value = startY.value + event.translationY;
    },
  });

  const doubleTap = useTapGesture({
    numberOfTaps: 2,
    onDeactivate: () => {
      "worklet";
      const zoomed = scale.value > 1;
      scale.value = withTiming(zoomed ? 1 : 2.5, SETTLE);
      x.value = withTiming(0, SETTLE);
      y.value = withTiming(0, SETTLE);
    },
  });

  const gesture = useExclusiveGestures(
    doubleTap,
    useSimultaneousGestures(pinch, pan),
  );

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: x.value },
      { translateY: y.value },
      { scale: scale.value },
    ],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[{ flex: 1 }, style]}>
        <RemoteImage
          url={image.url}
          contentFit="contain"
          animate={image.animated}
          accessibilityLabel={image.label}
          style={{ flex: 1 }}
        />
      </Animated.View>
    </GestureDetector>
  );
}

/**
 * The full-screen image viewer, mounted once at the root: black ground
 * (user media, not a ply), a close key and the file name.
 */
export function ImageViewer() {
  const image = useViewerImage();
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={image !== null}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={closeImage}
    >
      {/* A Modal is its own native root, so gestures need their own host. */}
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: "#000000" }}>
        {image ? <ZoomableImage key={image.url} image={image} /> : null}
        <View
          style={{
            position: "absolute",
            top: insets.top + 8,
            left: 8,
            right: 16,
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={closeImage}
            hitSlop={4}
            style={{
              width: 44,
              height: 44,
              borderRadius: RADIUS,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "rgba(0, 0, 0, 0.55)",
            }}
          >
            <Icon icon={X} size={22} color="#f2f2f3" />
          </Pressable>
          {image ? (
            <Text
              variant="row"
              numberOfLines={1}
              style={{ flex: 1, color: "#f2f2f3" }}
            >
              {image.label}
            </Text>
          ) : null}
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}
