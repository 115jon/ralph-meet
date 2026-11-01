import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState, type ReactNode } from "react";
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
  useHasMembers,
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

/** Back steps a page left: members to the chat, the chat to the drawer. */
function useBackStepsLeft(): void {
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        const page = getHomePage();
        if (page === "members") showChat();
        else if (page === "chat") showDrawer();
        else return false;
        return true;
      });
      return () => sub.remove();
    }, []),
  );
}

/** Where the chat rests for `page`: 0 covers the drawer. */
function restOf(page: HomePage, width: number, drawerWidth: number): number {
  "worklet";
  if (page === "chat") return 0;
  return page === "members" ? -width : drawerWidth;
}

/**
 * Home's three pages, Discord style: the drawer (rail, tree or DMs, your
 * panel) underneath, the open conversation over it, and a channel's members
 * to its right. From the chat, a swipe right or the header's menu key
 * slides the chat aside to a peek; a swipe left, a tap on the peek or
 * picking a conversation slides it back. The header's members key slides
 * the chat out to the left with the members page following it in; a swipe
 * right or back returns. There is no swipe left into members: a leftward
 * drag on the chat is a message's swipe-to-reply, and Android's gesture
 * navigation claims the right edge for back. The chat stays mounted
 * throughout. Back steps a page left; from the drawer it leaves the app.
 * With no conversation open the drawer fills the screen and the rest is out
 * of reach.
 */
export function HomePager({
  drawer,
  chat,
  members,
}: {
  drawer: ReactNode;
  chat: ReactNode;
  members: ReactNode;
}) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const page = useHomePage();
  const conversation = useConversation();
  const hasChat = conversation !== null;
  const hasMembers = useHasMembers();
  // With no conversation there is nothing to peek at: the drawer is the
  // whole screen and the chat rests fully off to the right.
  const drawerWidth = hasChat ? Math.round(width * (1 - PEEK)) : width;
  // Built on first open, then kept, so going back and forth is instant.
  const [membersBuilt, setMembersBuilt] = useState(false);
  if (page === "members" && !membersBuilt) setMembersBuilt(true);

  /**
   * The chat's offset from the left edge: 0 covers the drawer, drawerWidth
   * peeks at it, -width has slid out for the members page.
   */
  const x = useSharedValue(restOf(page, width, drawerWidth));
  /** Where x is headed, so a page set by the pan does not restart its settle. */
  const target = useSharedValue(restOf(page, width, drawerWidth));
  const dragFrom = useSharedValue(0);

  // A page set from outside (a header key, back, a picked conversation, a
  // link) slides there; one the pan already settled toward is left alone.
  useEffect(() => {
    const rest = restOf(page, width, drawerWidth);
    if (page !== "chat") Keyboard.dismiss();
    if (target.get() === rest) return;
    target.set(rest);
    x.set(reducedMotion ? rest : withSpring(rest, SPRING));
  }, [page, width, drawerWidth, reducedMotion, target, x]);

  useBackStepsLeft();

  const settle = useCallback((next: HomePage) => {
    if (getHomePage() === next) return;
    selectionHaptic();
    setHomePage(next);
  }, []);

  const onChat = page === "chat";
  const onMembers = page === "members";
  // From the chat or the members page only a rightward drag moves (to the
  // drawer, or back to the chat); from the drawer only a leftward one.
  const rightward = page !== "drawer";
  const pan = usePanGesture({
    enabled: hasChat,
    // Both ends every time: the native side merges a new config into the
    // old one, so a one-sided offset would leave the other page's end set.
    activeOffsetX: rightward ? [-FAR, SLOP_X] : [-SLOP_X, FAR],
    failOffsetX: rightward ? [-SLOP_X, FAR] : [-FAR, SLOP_X],
    failOffsetY: [-SLOP_Y, SLOP_Y],
    onActivate: () => {
      "worklet";
      dragFrom.set(x.get());
      scheduleOnRN(dismissKeyboard);
    },
    onUpdate: (event) => {
      "worklet";
      // Members slides between itself and the chat, the drawer likewise.
      const fromMembers = dragFrom.get() < -width / 2;
      const low = fromMembers ? -width : 0;
      const high = fromMembers ? 0 : drawerWidth;
      const next = dragFrom.get() + event.translationX;
      x.set(Math.min(high, Math.max(low, next)));
    },
    onDeactivate: (event) => {
      "worklet";
      const v = event.velocityX;
      const from = dragFrom.get();
      // The release's own translation: the last update can trail it.
      const moved = Math.abs(event.translationX);
      let next: HomePage;
      if (from < -width / 2) {
        // A third of the way back to the chat commits, or a flick.
        const back = v > FLING || (v > -FLING && moved > width * COMMIT);
        next = back ? "chat" : "members";
      } else {
        const fromChat = from < drawerWidth / 2;
        const travelled = moved > drawerWidth * COMMIT;
        const toDrawer =
          v > FLING || (v > -FLING && (fromChat ? travelled : !travelled));
        next = toDrawer ? "drawer" : "chat";
      }
      const rest = restOf(next, width, drawerWidth);
      target.set(rest);
      x.set(
        reducedMotion ? rest : withSpring(rest, { ...SPRING, velocity: v }),
      );
      scheduleOnRN(settle, next);
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
  const membersStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.get() + width }],
  }));

  return (
    <GestureDetector gesture={pan}>
      <View style={{ flex: 1, backgroundColor: theme.ply0 }}>
        <Animated.View
          importantForAccessibility={
            page === "drawer" ? "auto" : "no-hide-descendants"
          }
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
            pointerEvents={page === "drawer" ? "auto" : "none"}
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
              disabled={page !== "drawer" || !hasChat}
              onPress={showChat}
              style={{ flex: 1 }}
            />
          </Animated.View>
        </Animated.View>
        {hasMembers && membersBuilt ? (
          <Animated.View
            importantForAccessibility={
              onMembers ? "auto" : "no-hide-descendants"
            }
            pointerEvents={onMembers ? "auto" : "none"}
            style={[
              {
                position: "absolute",
                top: 0,
                bottom: 0,
                left: 0,
                width,
                backgroundColor: theme.ply0,
                borderLeftWidth: 1,
                borderLeftColor: theme.line,
              },
              membersStyle,
            ]}
          >
            {members}
          </Animated.View>
        ) : null}
      </View>
    </GestureDetector>
  );
}
