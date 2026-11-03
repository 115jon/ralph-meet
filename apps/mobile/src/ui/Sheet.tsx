import { TrueSheet, type SheetDetent } from "@lodev09/react-native-true-sheet";
import type { Icon as PhosphorIcon } from "phosphor-react-native";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type ColorValue,
  type ScrollViewProps,
} from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useReducedMotion } from "react-native-reanimated";

import { SHEET_TOP_RADIUS, useTheme } from "@/theme";

import { Icon } from "./Icon";
import {
  SheetScrollContext,
  useSheetScroll,
  type SheetScrollable,
  type SheetScrollRef,
} from "./sheet-list";
import { Text } from "./Text";

/** An expandable sheet's first stop, as a share of the screen. */
const HALF = 0.62;
/** Room the native grabber takes above the content: 10 + 3 + 8. */
const GRABBER_ROOM = 21;

/** A ScrollView wired to the sheet it sits in (see `useSheetScroll`). */
export function SheetScrollView(props: ScrollViewProps) {
  const ref = useSheetScroll();
  return (
    <ScrollView keyboardShouldPersistTaps="handled" {...props} ref={ref} />
  );
}

/*
 * Sheets present one at a time: one opening while another is still sinking
 * (a menu row that asks to confirm) waits for it, so the native stack never
 * treats the new sheet as a child of the closing one and takes it down too.
 */
let closing = 0;
const waiting = new Set<() => void>();
function whenNoneClosing(): Promise<void> {
  if (closing === 0) return Promise.resolve();
  return new Promise((resolve) => waiting.add(resolve));
}
function closingStarted() {
  closing += 1;
}
function closingEnded() {
  closing = Math.max(0, closing - 1);
  if (closing > 0) return;
  const ready = [...waiting];
  waiting.clear();
  for (const resolve of ready) resolve();
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
   * content (scrolling past the screen's height).
   */
  expandable?: boolean;
  /**
   * The content scrolls itself (one list through `useSheetScroll`) and fills
   * the sheet, which is as tall as the screen allows. Without it the sheet
   * wraps the content in its own scroll view and fits it.
   */
  fill?: boolean;
  /** The sheet's ground; ply 3 unless the content brings its own (a profile theme). */
  surface?: ColorValue;
  /** The grabber over content that starts at the very top (a banner). */
  grabberColor?: ColorValue;
  /** The content draws up to the ink rule, under the grabber (a banner). */
  flush?: boolean;
  /**
   * A tap on the scrim closes it (the default). Off, only a drag down or
   * Back does (they still call `onClose`): a ring isn't dismissed by accident.
   */
  scrimCloses?: boolean;
}

/**
 * A bottom sheet: TrueSheet's native Android BottomSheetBehavior, so drags,
 * flings, detents, the list hand-off, the keyboard and Back are the
 * platform's own. Dressed as a ply-3 float with a 4px top corner and a 2px
 * ink rule over the scrim. `visible` drives it: it presents once the content
 * has laid out (so a long one opens at its first stop), and closing by a
 * drag, the scrim or Back calls `onClose`.
 */
export function Sheet({
  visible,
  onClose,
  label,
  children,
  expandable = false,
  fill = false,
  surface,
  grabberColor,
  flush = false,
  scrimCloses = true,
}: SheetProps) {
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const { height: screen } = useWindowDimensions();
  const sheet = useRef<TrueSheet>(null);
  /** idle → presenting → open → closing → idle. */
  const phase = useRef<"idle" | "presenting" | "open" | "closing">("idle");
  const [mounted, setMounted] = useState(visible);
  /** It has started presenting (or is up): closing must animate it out. */
  const [opened, setOpened] = useState(false);
  if (visible && !mounted) setMounted(true);
  // Closed before it ever presented: nothing to animate.
  if (!visible && mounted && !opened) setMounted(false);
  // While it sinks, keep showing what it held: callers clear the content
  // (the message, the request) in the same breath as closing.
  const [shown, setShown] = useState(children);
  if (visible && shown !== children) setShown(children);
  /** A fitted sheet's content is taller than the first stop (measured once per opening). */
  const [long, setLong] = useState<boolean | null>(null);
  const scrollable = useRef<SheetScrollable | null>(null);
  const [, setScrollableTick] = useState(0);
  const ground = surface ?? theme.ply3;
  const ready = fill || long !== null;

  const scrollRef = useCallback<SheetScrollRef>((node) => {
    if (scrollable.current === node) return;
    scrollable.current = node;
    // TrueSheet resolves the list on its own updates; a list that mounts
    // later (after a load) needs one.
    setScrollableTick((tick) => tick + 1);
  }, []);

  const finish = useCallback(() => {
    if (phase.current === "idle") return;
    if (phase.current === "closing") closingEnded();
    phase.current = "idle";
    scrollable.current = null;
    setLong(null);
    setOpened(false);
    setMounted(false);
  }, []);

  useEffect(() => {
    if (!mounted) {
      // Dropped before it presented: a later opening starts over.
      if (phase.current === "presenting") phase.current = "idle";
      return;
    }
    if (visible) {
      if (!ready || phase.current !== "idle") return;
      phase.current = "presenting";
      void whenNoneClosing().then(async () => {
        if (phase.current !== "presenting") return;
        setOpened(true);
        await sheet.current?.present(0, !reducedMotion);
        if (phase.current === "presenting") phase.current = "open";
      });
      return;
    }
    if (!opened || phase.current === "closing") return;
    phase.current = "closing";
    closingStarted();
    void sheet.current?.dismiss(!reducedMotion).then(finish, finish);
  }, [mounted, visible, opened, ready, reducedMotion, finish]);

  // Unmounting mid-close (the host went away) must not hold others back.
  useEffect(
    () => () => {
      if (phase.current === "closing") closingEnded();
      phase.current = "idle";
    },
    [],
  );

  if (!mounted) return null;

  let detents: SheetDetent[];
  if (fill) detents = expandable ? [HALF, 1] : [1];
  else detents = expandable && long ? [HALF, "auto"] : ["auto"];

  return (
    <TrueSheet
      ref={sheet}
      lazy={false}
      detents={detents}
      dimColor="#000000"
      dimOpacity={theme.scrimOpacity}
      cornerRadius={SHEET_TOP_RADIUS}
      backgroundColor={ground}
      background={
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: ground,
              borderTopWidth: 2,
              borderTopColor: theme.ink1,
              borderTopLeftRadius: SHEET_TOP_RADIUS,
              borderTopRightRadius: SHEET_TOP_RADIUS,
            },
          ]}
        />
      }
      elevation={24}
      grabberOptions={{
        width: 32,
        height: 3,
        topMargin: 10,
        color: grabberColor ?? theme.lineStrong,
        adaptive: false,
      }}
      accessibilityOptions={{ paneTitle: label }}
      dismissible={scrimCloses}
      onDismissAttempt={scrimCloses ? undefined : onClose}
      scrollableRef={scrollable}
      style={fill ? { flex: 1 } : undefined}
      onDidDismiss={() => {
        // A drag, the scrim or Back closed it: tell the caller.
        const byUser = phase.current !== "closing";
        finish();
        if (byUser && visible) onClose();
      }}
    >
      <GestureHandlerRootView
        accessibilityLabel={label}
        style={[
          fill ? { flex: 1 } : null,
          { paddingTop: flush ? 2 : GRABBER_ROOM },
        ]}
      >
        <SheetScrollContext value={scrollRef}>
          {fill ? (
            <View style={{ flex: 1 }}>{shown}</View>
          ) : (
            <ScrollView
              ref={scrollRef}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: 12 }}
              onContentSizeChange={(_, height) => {
                if (long === null)
                  setLong(height + GRABBER_ROOM > screen * HALF);
              }}
            >
              {shown}
            </ScrollView>
          )}
        </SheetScrollContext>
      </GestureHandlerRootView>
    </TrueSheet>
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
