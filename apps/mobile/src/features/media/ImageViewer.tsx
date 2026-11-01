import {
  DownloadSimple,
  X,
  type Icon as PhosphorIcon,
} from "phosphor-react-native";
import { useCallback, useState } from "react";
import { Modal, Pressable, useWindowDimensions, View } from "react-native";
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
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";

import { RADIUS } from "@/theme";
import { Icon, RemoteImage, Text } from "@/ui";

import { canSaveImages, saveImage } from "./save-image";
import {
  closeImage,
  useViewerGallery,
  type ViewerGallery,
  type ViewerImage,
} from "./viewer-store";

const MAX_SCALE = 5;
const SETTLE = { duration: 200, easing: Easing.out(Easing.cubic) };
/** A flick faster than this (dp/s) pages or closes on its own. */
const FLING = 700;
/** Dragged down this far, letting go closes the viewer. */
const CLOSE_AT = 120;
/** Past the first or last picture the strip drags at this fraction. */
const EDGE_RESISTANCE = 0.3;

/** Travel (dp) before a drag at rest commits to paging or closing. */
const AXIS_LOCK = 8;

type Axis = 0 | 1 | 2;
const AXIS_NONE: Axis = 0;
const AXIS_PAGE: Axis = 1;
const AXIS_CLOSE: Axis = 2;

interface PagerValues {
  /** The strip's offset: -index × width at rest. */
  readonly stripX: SharedValue<number>;
  /** How far the picture is dragged down toward closing. */
  readonly dropY: SharedValue<number>;
  readonly index: number;
  readonly count: number;
  readonly width: number;
  readonly reducedMotion: boolean;
  readonly onPage: (index: number) => void;
}

/**
 * One picture: pinch to zoom, drag while zoomed, double-tap to zoom in or
 * back. At rest, a sideways drag pages through the message's pictures and a
 * downward drag closes the viewer.
 */
function ZoomableImage({
  image,
  pager,
}: {
  image: ViewerImage;
  pager: PagerValues;
}) {
  const { stripX, dropY, index, count, width, reducedMotion, onPage } = pager;
  const scale = useSharedValue(1);
  const startScale = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const startStrip = useSharedValue(0);
  const axis = useSharedValue<Axis>(AXIS_NONE);

  const settle = (value: number) => {
    "worklet";
    return reducedMotion ? value : withTiming(value, SETTLE);
  };

  const pinch = usePinchGesture({
    onActivate: () => {
      "worklet";
      startScale.set(scale.get());
    },
    onUpdate: (event) => {
      "worklet";
      scale.set(
        Math.min(MAX_SCALE, Math.max(1, startScale.get() * event.scale)),
      );
    },
    onDeactivate: () => {
      "worklet";
      if (scale.get() <= 1.01) {
        x.set(settle(0));
        y.set(settle(0));
      }
    },
  });

  const pan = usePanGesture({
    minPointers: 1,
    maxPointers: 1,
    onActivate: () => {
      "worklet";
      startX.set(x.get());
      startY.set(y.get());
      startStrip.set(stripX.get());
      axis.set(AXIS_NONE);
    },
    onUpdate: (event) => {
      "worklet";
      if (scale.get() > 1) {
        x.set(startX.get() + event.translationX);
        y.set(startY.get() + event.translationY);
        return;
      }
      if (axis.get() === AXIS_NONE) {
        const dx = Math.abs(event.translationX);
        const dy = Math.abs(event.translationY);
        // Too little travel to tell a page from a close yet.
        if (Math.max(dx, dy) < AXIS_LOCK) return;
        axis.set(dx > dy ? AXIS_PAGE : AXIS_CLOSE);
      }
      if (axis.get() === AXIS_PAGE) {
        const tx = event.translationX;
        const beyond =
          (index === 0 && tx > 0) || (index === count - 1 && tx < 0);
        stripX.set(startStrip.get() + (beyond ? tx * EDGE_RESISTANCE : tx));
      } else {
        const ty = event.translationY;
        dropY.set(ty > 0 ? ty : ty * EDGE_RESISTANCE);
      }
    },
    onDeactivate: (event) => {
      "worklet";
      if (scale.get() > 1) return;
      // A quick flick can end before any update picked an axis.
      if (axis.get() === AXIS_NONE) {
        axis.set(
          Math.abs(event.translationX) > Math.abs(event.translationY)
            ? AXIS_PAGE
            : AXIS_CLOSE,
        );
      }
      if (axis.get() === AXIS_PAGE) {
        const tx = event.translationX;
        let next = index;
        if (
          (tx < -width / 4 || event.velocityX < -FLING) &&
          index < count - 1
        ) {
          next = index + 1;
        } else if ((tx > width / 4 || event.velocityX > FLING) && index > 0) {
          next = index - 1;
        }
        stripX.set(settle(-next * width));
        if (next !== index) scheduleOnRN(onPage, next);
      } else if (axis.get() === AXIS_CLOSE) {
        if (event.translationY > CLOSE_AT || event.velocityY > FLING) {
          // The modal fades out from where the picture was let go.
          scheduleOnRN(closeImage);
        } else {
          dropY.set(settle(0));
        }
      }
    },
  });

  const doubleTap = useTapGesture({
    numberOfTaps: 2,
    // A finger that travels is a drag: fail at once so the pan is not held
    // back until the double-tap window runs out.
    maxDistance: 10,
    onDeactivate: () => {
      "worklet";
      const zoomed = scale.get() > 1;
      scale.set(settle(zoomed ? 1 : 2.5));
      x.set(settle(0));
      y.set(settle(0));
    },
  });

  const gesture = useExclusiveGestures(
    doubleTap,
    useSimultaneousGestures(pinch, pan),
  );

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: x.get() },
      { translateY: y.get() },
      { scale: scale.get() },
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

/** A 44dp key on the dark ground, 52 with its slop. */
function ViewerKey({
  icon,
  label,
  onPress,
}: {
  icon: PhosphorIcon;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: RADIUS,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: pressed
          ? "rgba(255, 255, 255, 0.16)"
          : "rgba(0, 0, 0, 0.55)",
      })}
    >
      <Icon icon={icon} size={22} color="#f2f2f3" />
    </Pressable>
  );
}

function Gallery({ gallery }: { gallery: ViewerGallery }) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const { images } = gallery;
  const [index, setIndex] = useState(gallery.index);
  const stripX = useSharedValue(-gallery.index * width);
  const dropY = useSharedValue(0);
  const image = images[index] ?? images[0];
  const onPage = useCallback((next: number) => setIndex(next), []);
  const pager = {
    stripX,
    dropY,
    index,
    count: images.length,
    width,
    reducedMotion,
    onPage,
  };

  const groundStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      Math.abs(dropY.get()),
      [0, height / 2],
      [1, 0],
      Extrapolation.CLAMP,
    ),
  }));
  const stripStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: stripX.get() },
      { translateY: dropY.get() },
      {
        scale: interpolate(
          Math.abs(dropY.get()),
          [0, height],
          [1, 0.85],
          Extrapolation.CLAMP,
        ),
      },
    ],
  }));

  return (
    <>
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: "absolute",
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            backgroundColor: "#000000",
          },
          groundStyle,
        ]}
      />
      <Animated.View
        style={[
          { flex: 1, flexDirection: "row", width: width * images.length },
          stripStyle,
        ]}
      >
        {images.map((item, i) => (
          <View key={item.url} style={{ width, height: "100%" }}>
            {/* Only the picture on screen and its neighbours are drawn. */}
            {Math.abs(i - index) <= 1 ? (
              <ZoomableImage image={item} pager={{ ...pager, index: i }} />
            ) : null}
          </View>
        ))}
      </Animated.View>
      <View
        style={{
          position: "absolute",
          top: insets.top + 8,
          left: 8,
          right: 8,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
        }}
      >
        <ViewerKey icon={X} label="Close" onPress={closeImage} />
        <View style={{ flex: 1, minWidth: 0 }}>
          {image ? (
            <Text variant="row" numberOfLines={1} style={{ color: "#f2f2f3" }}>
              {image.label}
            </Text>
          ) : null}
          {images.length > 1 ? (
            <Text variant="num" style={{ fontSize: 11, color: "#b4b4b8" }}>
              {`${index + 1} / ${images.length}`}
            </Text>
          ) : null}
        </View>
        {canSaveImages && image ? (
          <ViewerKey
            icon={DownloadSimple}
            label="Save to gallery"
            onPress={() => void saveImage(image.url, image.label)}
          />
        ) : null}
      </View>
    </>
  );
}

/**
 * The full-screen image viewer, mounted once at the root: black ground
 * (user media, not a ply), a close key, the file name and a save key.
 * Swipe sideways through the message's pictures; drag down to close.
 */
export function ImageViewer() {
  const gallery = useViewerGallery();
  return (
    <Modal
      visible={gallery !== null}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={closeImage}
    >
      {/* A Modal is its own native root, so gestures need their own host. */}
      <GestureHandlerRootView style={{ flex: 1 }}>
        {gallery ? (
          <Gallery
            key={`${gallery.index}:${gallery.images.map((i) => i.url).join("|")}`}
            gallery={gallery}
          />
        ) : null}
      </GestureHandlerRootView>
    </Modal>
  );
}
