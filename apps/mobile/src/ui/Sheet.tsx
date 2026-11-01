import type { Icon as PhosphorIcon } from "phosphor-react-native";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Pressable,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type ScrollViewProps,
} from "react-native";
import {
  GestureDetector,
  GestureHandlerRootView,
  ScrollView,
  usePanGesture,
} from "react-native-gesture-handler";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";

import { selectionHaptic } from "@/lib/haptics";
import { SHEET_TOP_RADIUS, useTheme } from "@/theme";

import { Icon } from "./Icon";
import { SheetScrollContext, useSheetScroll } from "./sheet-scroll";
import { Text } from "./Text";

/** An expandable sheet's first stop, as a share of the screen (the profile's). */
const HALF_SHARE = 0.62;
/** A flick faster than this (px/s) decides the stop on its own. */
const FLING = 900;
const OPEN = { duration: 250, easing: Easing.out(Easing.cubic) };
const CLOSE = { duration: 175, easing: Easing.out(Easing.cubic) };
const SETTLE = { duration: 200, easing: Easing.inOut(Easing.cubic) };
/** DESIGN's panel spring: critically damped, carries the finger's velocity. */
const SPRING = {
  mass: 1,
  stiffness: 360,
  damping: 38,
  overshootClamping: true,
} as const;

/** A ScrollView that hands its top edge to the sheet it sits in. */
export function SheetScrollView(props: ScrollViewProps) {
  const sheet = useSheetScroll();
  return (
    <ScrollView keyboardShouldPersistTaps="handled" {...props} {...sheet} />
  );
}

interface SheetProps {
  visible: boolean;
  onClose: () => void;
  /** Read by screen readers as the sheet's name. */
  label: string;
  children: ReactNode;
  /**
   * Long content: open no taller than the first stop (about 60% of the
   * screen) and drag up to full height. Without it the sheet sizes to its
   * content (scrolling past the screen's height) and only drags down.
   */
  expandable?: boolean;
  /**
   * The content scrolls itself (a list through `useSheetScroll`) and fills
   * the sheet, which is as tall as the screen allows. Without it the sheet
   * wraps the content in its own scroll view and fits it.
   */
  fill?: boolean;
}

/**
 * A bottom sheet: a ply-3 float with a 4px top corner and a 2px ink rule
 * over a scrim, rising in 250ms on ease-out. A React Native Modal rather
 * than Compose's ModalBottomSheet, whose shape cannot be set to the 4px
 * key corner. Drag it down to close (the scrim fades with it), or up to
 * full height when `expandable`; tap the scrim or press back to close.
 */
export function Sheet(props: SheetProps) {
  return (
    <Modal
      visible={props.visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={props.onClose}
    >
      {/* A modal is its own window: its gestures need their own root. */}
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SheetBody {...props} />
      </GestureHandlerRootView>
    </Modal>
  );
}

function SheetBody({
  onClose,
  label,
  children,
  expandable = false,
  fill = false,
}: SheetProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { height: screen } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  /** Room above the keyboard and below the status bar. */
  const [room, setRoom] = useState(screen - insets.top);
  /** The stops: `rest` it opens to, `full` its own height. */
  const [stops, setStops] = useState<{ rest: number; full: number } | null>(
    null,
  );
  const [atFull, setAtFull] = useState(false);

  /** How much of the sheet shows above its bottom edge. */
  const shown = useSharedValue(0);
  const full = useSharedValue(0);
  const rest = useSharedValue(0);
  const dragFrom = useSharedValue(0);
  const dragging = useSharedValue(false);
  const closing = useSharedValue(false);
  const scrollY = useSharedValue(0);
  /** This drag belongs to a scroll view (it began scrolled, or upward at full). */
  const scrolling = useSharedValue(false);

  const dismiss = useCallback(() => {
    if (closing.get()) return;
    closing.set(true);
    if (reducedMotion) {
      onClose();
      return;
    }
    shown.set(withTiming(0, CLOSE, () => scheduleOnRN(onClose)));
  }, [closing, reducedMotion, shown, onClose]);

  const onRoom = useCallback(
    (event: LayoutChangeEvent) =>
      setRoom(Math.round(event.nativeEvent.layout.height) - insets.top),
    [insets.top],
  );

  const onSheet = useCallback(
    (event: LayoutChangeEvent) => {
      const height = Math.round(event.nativeEvent.layout.height);
      const first = expandable
        ? Math.min(height, Math.round(screen * HALF_SHARE))
        : height;
      full.set(height);
      rest.set(first);
      setStops({ rest: first, full: height });
      if (closing.get() || dragging.get()) return;
      if (!stops) {
        shown.set(reducedMotion ? first : withTiming(first, OPEN));
        return;
      }
      // The content or the room changed: hold the stop it was at.
      const target = atFull ? height : first;
      shown.set(reducedMotion ? target : withTiming(target, SETTLE));
    },
    [
      expandable,
      screen,
      full,
      rest,
      closing,
      dragging,
      stops,
      shown,
      reducedMotion,
      atFull,
    ],
  );

  const pan = usePanGesture({
    activeOffsetY: [-8, 8],
    failOffsetX: [-24, 24],
    onActivate: (event) => {
      "worklet";
      dragFrom.set(shown.get());
      const top = shown.get() >= full.get() - 1;
      scrolling.set(
        closing.get() || (top && (scrollY.get() > 0 || event.translationY < 0)),
      );
      dragging.set(!scrolling.get());
    },
    onUpdate: (event) => {
      "worklet";
      if (scrolling.get()) return;
      shown.set(
        Math.min(full.get(), Math.max(0, dragFrom.get() - event.translationY)),
      );
    },
    onDeactivate: (event) => {
      "worklet";
      if (scrolling.get()) return;
      dragging.set(false);
      const v = event.velocityY;
      const now = shown.get();
      const first = rest.get();
      const top = full.get();
      const canExpand = top > first + 1;
      let next: number;
      if (v > FLING) next = now > first + 1 ? first : 0;
      else if (v < -FLING) next = top;
      else if (now < first * 0.5) next = 0;
      else next = canExpand && now > (first + top) / 2 ? top : first;
      if (next === 0) {
        closing.set(true);
        if (reducedMotion) {
          shown.set(0);
          scheduleOnRN(onClose);
          return;
        }
        shown.set(withTiming(0, CLOSE, () => scheduleOnRN(onClose)));
        return;
      }
      shown.set(
        reducedMotion ? next : withSpring(next, { ...SPRING, velocity: -v }),
      );
      const expanded = canExpand && next === top;
      if (expanded && dragFrom.get() < top - 1) scheduleOnRN(selectionHaptic);
      scheduleOnRN(setAtFull, expanded);
    },
  });

  const sheetStyle = useAnimatedStyle(() => ({
    // Parked below the screen, its shadow would still rim the bottom edge.
    opacity: full.get() > 0 && shown.get() > 0 ? 1 : 0,
    transform: [{ translateY: full.get() - shown.get() }],
  }));
  const scrimStyle = useAnimatedStyle(() => ({
    opacity: rest.get() > 0 ? Math.min(1, shown.get() / rest.get()) : 0,
  }));

  // Below its full stop the sheet takes the drag; the content waits.
  const scrollEnabled = atFull || (stops ? stops.rest >= stops.full : false);
  const context = useMemo(
    () => ({ gesture: pan, scrollEnabled, scrollY }),
    [pan, scrollEnabled, scrollY],
  );

  return (
    <>
      <Animated.View
        style={[
          {
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: theme.scrim,
          },
          scrimStyle,
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={dismiss}
          style={{ flex: 1 }}
        />
      </Animated.View>
      {/* An edge-to-edge modal window is never resized for the keyboard, so a
          field in the sheet (the custom status) is lifted here instead. */}
      <KeyboardAvoidingView
        behavior="padding"
        pointerEvents="box-none"
        style={{ flex: 1 }}
      >
        <View
          pointerEvents="box-none"
          onLayout={onRoom}
          style={{ flex: 1, justifyContent: "flex-end" }}
        >
          <SheetScrollContext value={context}>
            <GestureDetector gesture={pan}>
              <Animated.View
                accessibilityViewIsModal
                accessibilityLabel={label}
                onLayout={onSheet}
                style={[
                  {
                    paddingTop: 10,
                    paddingBottom: insets.bottom + 12,
                    backgroundColor: theme.ply3,
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
                  fill ? { height: room } : { maxHeight: room },
                  sheetStyle,
                ]}
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
                {fill ? (
                  <View style={{ flex: 1 }}>{children}</View>
                ) : (
                  <SheetScrollView style={{ flexGrow: 0, flexShrink: 1 }}>
                    {children}
                  </SheetScrollView>
                )}
              </Animated.View>
            </GestureDetector>
          </SheetScrollContext>
        </View>
      </KeyboardAvoidingView>
    </>
  );
}

interface SheetRowProps {
  icon: PhosphorIcon;
  label: string;
  onPress: () => void;
  /** Destructive: the row and its glyph in danger ink. */
  danger?: boolean;
}

/** A 52px action row: a 20px ink-2 glyph and a Geist 15 label. */
export function SheetRow({
  icon,
  label,
  onPress,
  danger = false,
}: SheetRowProps) {
  const theme = useTheme();
  const color = danger ? theme.dangerInk : theme.ink2;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 52,
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        paddingHorizontal: 20,
        backgroundColor: pressed ? theme.tint2 : "transparent",
      })}
    >
      <Icon icon={icon} size={20} color={color} />
      <Text
        variant="row"
        style={{ fontSize: 15, color: danger ? theme.dangerInk : theme.ink1 }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
