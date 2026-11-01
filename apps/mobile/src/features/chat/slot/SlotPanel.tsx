import {
  createContext,
  use,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { BackHandler, View } from "react-native";
import {
  GestureDetector,
  usePanGesture,
  type PanGestureConfig,
} from "react-native-gesture-handler";
import Animated, {
  Easing,
  KeyboardState,
  useAnimatedReaction,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { SHEET_TOP_RADIUS, useTheme } from "@/theme";

import type { ComposerSlot, SlotPanelKind } from "./useComposerSlot";

const ENTER = { duration: 250, easing: Easing.out(Easing.cubic) };
const EXIT = { duration: 175, easing: Easing.out(Easing.cubic) };
const SETTLE = { duration: 200, easing: Easing.inOut(Easing.cubic) };
/** A flick faster than this (px/s) decides the drag on its own. */
const FLING = 900;
/** If the keyboard never comes (a hardware one), stop waiting for it. */
const YIELD_TIMEOUT_MS = 600;

/** The frame's drag handlers (worklets); each handle builds its own gesture. */
const DragContext = createContext<PanGestureConfig | null>(null);

function DragDetector({
  config,
  children,
}: {
  config: PanGestureConfig;
  children: ReactNode;
}) {
  // One gesture per detector: RNGH cannot attach a gesture to two views.
  const gesture = usePanGesture(config);
  return <GestureDetector gesture={gesture}>{children}</GestureDetector>;
}

/**
 * The panel's top strip: drag it up to see more, down to put the panel
 * away. Taps inside (tabs, the search field) still land.
 */
export function SlotHandle({ children }: { children: ReactNode }) {
  const config = use(DragContext);
  if (!config) return children;
  return <DragDetector config={config}>{children}</DragDetector>;
}

/**
 * A panel kept mounted but out of sight. Not display:none: Fabric's clipped
 * lists (the media grid) crash re-attaching views under a hidden parent.
 */
export function Stowed({
  shown,
  children,
}: {
  shown: boolean;
  children: ReactNode;
}) {
  return (
    <View
      pointerEvents={shown ? "auto" : "none"}
      importantForAccessibility={shown ? "auto" : "no-hide-descendants"}
      style={
        shown
          ? { flex: 1 }
          : {
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              opacity: 0,
            }
      }
    >
      {children}
    </View>
  );
}

/** The short grab bar every slot panel starts with. */
export function SlotGrabber() {
  const theme = useTheme();
  return (
    <View
      style={{
        width: 32,
        height: 3,
        borderRadius: 2,
        alignSelf: "center",
        backgroundColor: theme.lineStrong,
      }}
    />
  );
}

interface SlotPanelProps {
  slot: ComposerSlot;
  /** Each panel's content; built on its first open, then kept. */
  panels: Readonly<Record<SlotPanelKind, ReactNode>>;
  /** How each panel's surface reads. */
  surface: Readonly<Record<SlotPanelKind, "float" | "flat">>;
}

/**
 * The one frame every slot panel rises in, under the composer (ChatView
 * pads the conversation by `slot.lift`). Opened from nothing it slides up;
 * opened while the keyboard is up, or swapped for the other panel, it is
 * simply there, since the keyboard covers it as it goes. Given back to the
 * keyboard it stays until the keyboard has covered it. Drag the top strip
 * up for more room or down to close; back closes it.
 */
export function SlotPanel({ slot, panels, surface }: SlotPanelProps) {
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const { panel, leaving, keyboard, lift, rest, expanded, searchStrip, close } =
    slot;
  const [built, setBuilt] = useState<ReadonlySet<SlotPanelKind>>(
    () => new Set(),
  );
  if (panel && !built.has(panel)) setBuilt(new Set([...built, panel]));
  // The last panel shown keeps drawing while it leaves.
  const [shownKind, setShownKind] = useState<SlotPanelKind | null>(panel);
  if (panel && panel !== shownKind) setShownKind(panel);

  const height = useSharedValue(0);
  const progress = useSharedValue(0);
  const yielding = useSharedValue(false);
  const dragFrom = useSharedValue(0);
  const previous = useRef<SlotPanelKind | null>(null);

  useEffect(() => {
    const was = previous.current;
    previous.current = panel;
    if (panel) {
      yielding.set(false);
      if (was) return;
      height.set(rest.get());
      // Under a keyboard on its way down there is nothing to animate.
      const underKeyboard = keyboard.height.get() > 0;
      progress.set(underKeyboard || reducedMotion ? 1 : withTiming(1, ENTER));
      return;
    }
    if (!was) return;
    if (leaving === "keyboard") {
      yielding.set(true);
      const timer = setTimeout(() => {
        if (!yielding.get()) return;
        yielding.set(false);
        progress.set(reducedMotion ? 0 : withTiming(0, EXIT));
      }, YIELD_TIMEOUT_MS);
      return () => clearTimeout(timer);
    }
    progress.set(reducedMotion ? 0 : withTiming(0, EXIT));
  }, [
    panel,
    leaving,
    reducedMotion,
    height,
    progress,
    rest,
    keyboard,
    yielding,
  ]);

  // The panel's height on screen: its own, or tall enough to keep the
  // search strip above the keyboard while its search field is typing.
  const shown = () => {
    "worklet";
    const strip = searchStrip.get();
    const base = height.get();
    return strip > 0 ? Math.max(base, keyboard.height.get() + strip) : base;
  };

  useAnimatedReaction(
    () => shown() * progress.get(),
    (value) => {
      lift.set(value);
    },
  );

  // Handing over to the keyboard: gone the moment the keyboard covers it.
  useAnimatedReaction(
    () => {
      if (!yielding.get()) return 0;
      if (keyboard.height.get() >= shown() - 1) return 2;
      return keyboard.state.get() === KeyboardState.OPEN ? 1 : 0;
    },
    (step) => {
      if (step === 0) return;
      yielding.set(false);
      // Covered: vanish. Open but shorter (the panel was dragged up): ease
      // down onto it.
      progress.set(step === 2 || reducedMotion ? 0 : withTiming(0, EXIT));
    },
  );

  useEffect(() => {
    if (!panel) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      close();
      return true;
    });
    return () => sub.remove();
  }, [panel, close]);

  const drag: PanGestureConfig = {
    activeOffsetY: [-8, 8],
    onActivate: () => {
      "worklet";
      dragFrom.set(height.get() * progress.get());
    },
    onUpdate: (event) => {
      "worklet";
      const base = rest.get();
      const next = dragFrom.get() - event.translationY;
      if (next >= base) {
        height.set(Math.min(expanded, next));
        progress.set(1);
      } else {
        height.set(base);
        progress.set(Math.max(0, next / base));
      }
    },
    onDeactivate: (event) => {
      "worklet";
      const base = rest.get();
      const motion = reducedMotion ? { duration: 0 } : SETTLE;
      const now = height.get() * progress.get();
      if (event.velocityY > FLING || now < base * 0.6) {
        progress.set(withTiming(0, reducedMotion ? motion : EXIT));
        scheduleOnRN(close);
        return;
      }
      progress.set(withTiming(1, motion));
      const up =
        event.velocityY < -FLING ||
        (event.velocityY <= FLING && height.get() > (base + expanded) / 2);
      height.set(withTiming(up ? expanded : base, motion));
    },
  };

  const frameStyle = useAnimatedStyle(() => {
    const value = shown();
    return {
      height: value,
      // Parked below the screen, its shadow would still rim the bottom edge.
      opacity: progress.get() > 0 ? 1 : 0,
      transform: [{ translateY: value * (1 - progress.get()) }],
    };
  });

  if (built.size === 0) return null;
  const flat = shownKind ? surface[shownKind] === "flat" : false;

  return (
    <Animated.View
      importantForAccessibility={panel ? "auto" : "no-hide-descendants"}
      pointerEvents={panel ? "auto" : "none"}
      style={[
        {
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
        },
        flat
          ? {
              backgroundColor: theme.ply1,
              borderTopWidth: 1,
              borderTopColor: theme.lineStrong,
            }
          : {
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
        frameStyle,
      ]}
    >
      <DragContext value={drag}>
        {[...built].map((kind) => (
          <Stowed key={kind} shown={kind === shownKind}>
            {panels[kind]}
          </Stowed>
        ))}
      </DragContext>
    </Animated.View>
  );
}
