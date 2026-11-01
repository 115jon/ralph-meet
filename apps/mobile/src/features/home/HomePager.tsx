import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, type ReactNode } from "react";
import {
  BackHandler,
  Keyboard,
  Pressable,
  useWindowDimensions,
  View,
} from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import {
  getHomePage,
  setHomePage,
  showChat,
  showDrawer,
  useConversation,
  useHomePage,
  type HomePage,
} from "@/features/conversation/store";
import { selectionHaptic } from "@/lib/haptics";
import { useTheme } from "@/theme";

/** How much of the chat stays in view beside the open drawer (Discord's peek). */
const PEEK = 0.16;
/** Travel before the pan claims the touch; vertical travel first lets lists scroll. */
const SLOP_X = 14;
const SLOP_Y = 12;
/** An offset no drag reaches: the unused end of a one-way range. */
const FAR = 100_000;
/** A flick faster than this (dp/s) decides the page on its own. */
const FLING = 500;
/** A drag this share of the way across changes page without a flick. */
const COMMIT = 0.35;
/** The drawer drifts this far under the chat as it closes. */
const PARALLAX = 24;
/**
 * A critically damped spring (no overshoot) that settles in about 250ms
 * and carries the finger's velocity: DESIGN's panel spring.
 */
const SPRING = {
  mass: 1,
  stiffness: 360,
  damping: 38,
  overshootClamping: true,
} as const;

/** A plain JS function: a worklet cannot hand over `Keyboard.dismiss` itself. */
function dismissKeyboard(): void {
  Keyboard.dismiss();
}

function useBackOpensDrawer(): void {
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        if (getHomePage() !== "chat") return false;
        showDrawer();
        return true;
      });
      return () => sub.remove();
    }, []),
  );
}

/**
 * Home's two pages, Discord style: the drawer (rail, tree or DMs, your
 * panel) underneath, and the open conversation over it. From the chat, a
 * swipe right or the header's menu key slides the chat aside to a peek;
 * a swipe left, a tap on the peek or picking a conversation slides it back.
 * The chat stays mounted throughout. Android back from the chat opens the
 * drawer; back from the drawer leaves the app as usual.
 */
export function HomePager({
  drawer,
  chat,
}: {
  drawer: ReactNode;
  chat: ReactNode;
}) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const page = useHomePage();
  const conversation = useConversation();
  const hasChat = conversation !== null;
  const drawerWidth = Math.round(width * (1 - PEEK));

  const restFor = useCallback(
    (next: HomePage) => (next === "chat" ? 0 : drawerWidth),
    [drawerWidth],
  );
  /** The chat's offset from the left edge: 0 covers the drawer, drawerWidth peeks. */
  const x = useSharedValue(restFor(page));
  /** Where x is headed, so a page set by the pan does not restart its settle. */
  const target = useSharedValue(restFor(page));
  const dragFrom = useSharedValue(0);

  // A page set from outside (menu key, back, a picked conversation, a link)
  // slides there; one the pan already settled toward is left alone.
  useEffect(() => {
    const rest = restFor(page);
    if (page === "drawer") Keyboard.dismiss();
    if (target.get() === rest) return;
    target.set(rest);
    x.set(reducedMotion ? rest : withSpring(rest, SPRING));
  }, [page, restFor, reducedMotion, target, x]);

  useBackOpensDrawer();

  const settle = useCallback((next: HomePage) => {
    if (getHomePage() === next) return;
    selectionHaptic();
    setHomePage(next);
  }, []);

  const onChat = page === "chat";
  const pan = usePanGesture({
    enabled: hasChat,
    // From the chat only a rightward drag opens the drawer (a leftward one
    // is a message's swipe-to-reply); from the drawer only leftward closes.
    // Both ends every time: the native side merges a new config into the
    // old one, so a one-sided offset would leave the other page's end set.
    activeOffsetX: onChat ? [-FAR, SLOP_X] : [-SLOP_X, FAR],
    failOffsetX: onChat ? [-SLOP_X, FAR] : [-FAR, SLOP_X],
    failOffsetY: [-SLOP_Y, SLOP_Y],
    onActivate: () => {
      "worklet";
      dragFrom.set(x.get());
      scheduleOnRN(dismissKeyboard);
    },
    onUpdate: (event) => {
      "worklet";
      const next = dragFrom.get() + event.translationX;
      x.set(Math.min(drawerWidth, Math.max(0, next)));
    },
    onDeactivate: (event) => {
      "worklet";
      const v = event.velocityX;
      // A third of the way from where it started commits, or a flick.
      const fromChat = dragFrom.get() < drawerWidth / 2;
      // The release's own translation: the last update can trail it.
      const travelled = Math.abs(event.translationX) > drawerWidth * COMMIT;
      const toDrawer =
        v > FLING || (v > -FLING && (fromChat ? travelled : !travelled));
      const rest = toDrawer ? drawerWidth : 0;
      target.set(rest);
      x.set(
        reducedMotion ? rest : withSpring(rest, { ...SPRING, velocity: v }),
      );
      scheduleOnRN(settle, toDrawer ? "drawer" : "chat");
    },
  });

  const chatStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.get() }],
  }));
  const scrimStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      x.get(),
      [0, drawerWidth],
      [0, 1],
      Extrapolation.CLAMP,
    ),
  }));
  const drawerStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX: interpolate(
          x.get(),
          [0, drawerWidth],
          [-PARALLAX, 0],
          Extrapolation.CLAMP,
        ),
      },
    ],
  }));

  return (
    <GestureDetector gesture={pan}>
      <View style={{ flex: 1, backgroundColor: theme.ply0 }}>
        <Animated.View
          importantForAccessibility={onChat ? "no-hide-descendants" : "auto"}
          style={[
            {
              position: "absolute",
              top: 0,
              bottom: 0,
              left: 0,
              width: drawerWidth,
            },
            drawerStyle,
          ]}
        >
          {drawer}
        </Animated.View>
        <Animated.View
          importantForAccessibility={onChat ? "auto" : "no-hide-descendants"}
          style={[
            {
              flex: 1,
              backgroundColor: theme.ply0,
              borderLeftWidth: 1,
              borderLeftColor: theme.line,
              // Drawn to the left of the chat's edge, over the drawer.
              marginLeft: -1,
              shadowColor: theme.shadow,
              shadowOffset: { width: -8, height: 0 },
              shadowOpacity: 1,
              shadowRadius: 12,
              elevation: 12,
            },
            chatStyle,
          ]}
        >
          {chat}
          <Animated.View
            pointerEvents={onChat ? "none" : "auto"}
            style={[
              {
                position: "absolute",
                top: 0,
                right: 0,
                bottom: 0,
                left: 0,
                backgroundColor: theme.scrim,
              },
              scrimStyle,
            ]}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back to the conversation"
              disabled={onChat || !hasChat}
              onPress={showChat}
              style={{ flex: 1 }}
            />
          </Animated.View>
        </Animated.View>
      </View>
    </GestureDetector>
  );
}
