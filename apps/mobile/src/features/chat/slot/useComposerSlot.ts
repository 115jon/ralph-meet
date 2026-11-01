import { Schema } from "effect";
import { useCallback, useMemo, useState } from "react";
import { Keyboard, useWindowDimensions } from "react-native";
import {
  KeyboardState,
  useAnimatedKeyboard,
  useAnimatedReaction,
  useSharedValue,
  type AnimatedKeyboardInfo,
  type SharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { readPersisted, writePersisted } from "@/lib/persist";

// The space under the composer belongs to one thing at a time: the
// keyboard, the emoji and GIF panel, or the attach tray (WhatsApp, Gboard
// and Discord on Android do the same). Panels take the keyboard's own
// height, learned the last time it was up, so trading one for another never
// moves the conversation: the panel is in place before the keyboard leaves,
// and stays until the keyboard has covered it.

export type SlotPanelKind = "emoji" | "attach";

/** Before the keyboard has ever been seen: a little under half the screen. */
const FALLBACK_SHARE = 0.45;
/** Dragged up: most of the screen, leaving the header and some history. */
const EXPANDED_SHARE = 0.72;
/** Smaller than this is a hardware keyboard's strip or a floating one. */
const MIN_KEYBOARD = 160;

const STORAGE = "keyboard-height";
let knownKeyboard = readPersisted(STORAGE, Schema.Number);

function rememberKeyboard(height: number): void {
  const rounded = Math.round(height);
  if (rounded === knownKeyboard) return;
  knownKeyboard = rounded;
  writePersisted(STORAGE, rounded);
}

export interface ComposerSlot {
  readonly panel: SlotPanelKind | null;
  /**
   * How the last panel left: "slide" back down, or "keyboard" (the field
   * took focus), when it waits for the keyboard to cover it.
   */
  readonly leaving: "slide" | "keyboard";
  readonly keyboard: AnimatedKeyboardInfo;
  /** How far the slot stands above the screen's bottom edge, per frame. */
  readonly lift: SharedValue<number>;
  /** The panel's resting height: the keyboard's. */
  readonly rest: SharedValue<number>;
  readonly expanded: number;
  /**
   * While a panel's own search field has the keyboard: the strip (search
   * and one row of results) kept above it. 0 otherwise.
   */
  readonly searchStrip: SharedValue<number>;
  readonly open: (kind: SlotPanelKind) => void;
  /** The panel slides away; the slot is empty. */
  readonly close: () => void;
  /** The composer took focus: the keyboard replaces the panel. */
  readonly yieldToKeyboard: () => void;
}

export function useComposerSlot(): ComposerSlot {
  const { height: screen } = useWindowDimensions();
  const keyboard = useAnimatedKeyboard();
  const [state, setState] = useState<{
    panel: SlotPanelKind | null;
    leaving: "slide" | "keyboard";
  }>({ panel: null, leaving: "slide" });
  const lift = useSharedValue(0);
  const rest = useSharedValue(
    knownKeyboard ?? Math.round(screen * FALLBACK_SHARE),
  );
  const searchStrip = useSharedValue(0);

  // Learn the keyboard's height whenever it settles open.
  useAnimatedReaction(
    () =>
      keyboard.state.get() === KeyboardState.OPEN ? keyboard.height.get() : 0,
    (height, previous) => {
      if (height < MIN_KEYBOARD || height === previous) return;
      // A search field raising the keyboard over a panel is the same
      // keyboard; only its height changes the panel's rest, and only once
      // the panel is not on screen (no jump under the user's finger).
      if (searchStrip.get() === 0) rest.set(height);
      scheduleOnRN(rememberKeyboard, height);
    },
  );

  const open = useCallback((kind: SlotPanelKind) => {
    Keyboard.dismiss();
    setState({ panel: kind, leaving: "slide" });
  }, []);
  const close = useCallback(
    () =>
      setState((s) =>
        s.panel === null ? s : { panel: null, leaving: "slide" },
      ),
    [],
  );
  const yieldToKeyboard = useCallback(
    () =>
      setState((s) =>
        s.panel === null ? s : { panel: null, leaving: "keyboard" },
      ),
    [],
  );

  return useMemo(
    () => ({
      panel: state.panel,
      leaving: state.leaving,
      keyboard,
      lift,
      rest,
      expanded: Math.round(screen * EXPANDED_SHARE),
      searchStrip,
      open,
      close,
      yieldToKeyboard,
    }),
    [
      state,
      keyboard,
      lift,
      rest,
      screen,
      searchStrip,
      open,
      close,
      yieldToKeyboard,
    ],
  );
}
