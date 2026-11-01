import { useState } from "react";
import { View } from "react-native";
import {
  GestureDetector,
  useExclusiveGestures,
  usePanGesture,
  useTapGesture,
} from "react-native-gesture-handler";
import Svg, {
  Defs,
  LinearGradient,
  Mask,
  Pattern,
  Rect,
  Stop,
} from "react-native-svg";

import { RADIUS, useTheme } from "@/theme";

import { Text } from "./Text";

const TRACK = 8;
const CAP_WIDTH = 12;
const CAP_HEIGHT = 28;
const TOUCH_HEIGHT = 44;

interface FaderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Called once the drag ends (or per screen-reader step), not per frame. */
  onCommit: (value: number) => void;
  /** Each new value while dragging, for a live preview (e.g. a volume). */
  onChange?: (value: number) => void;
  /** Values marked with a tick under the track, e.g. 100%. */
  ticks?: readonly number[];
  /** The readout beside the fader, e.g. "-29 dB". */
  format: (value: number) => string;
  accessibilityLabel: string;
}

function snap(value: number, min: number, max: number, step: number): number {
  const stepped = Math.round((value - min) / step) * step + min;
  return Math.min(max, Math.max(min, stepped));
}

/**
 * The C1 dither fader: an 8px tint-3 track whose range is a still accent
 * dither that gets denser toward the value, a 12x28 ink-1 cap with 2px
 * corners and a Martian readout. Drag or tap anywhere on the track.
 */
export function Fader({
  value,
  min,
  max,
  step = 1,
  onCommit,
  onChange,
  ticks,
  format,
  accessibilityLabel,
}: FaderProps) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const [draft, setDraftState] = useState<number | null>(null);
  const shown = draft ?? value;
  const setDraft = (next: number | null) => {
    setDraftState(next);
    if (next !== null && next !== draft) onChange?.(next);
  };

  const valueAt = (x: number) => {
    const usable = Math.max(1, width - CAP_WIDTH);
    const ratio = Math.min(1, Math.max(0, (x - CAP_WIDTH / 2) / usable));
    return snap(min + ratio * (max - min), min, max, step);
  };
  // A horizontal drag moves the cap (a vertical one is left to the scroll
  // view); a tap jumps there. Both commit once, when they end.
  const drag = usePanGesture({
    runOnJS: true,
    activeOffsetX: [-6, 6],
    failOffsetY: [-12, 12],
    onActivate: (event) => setDraft(valueAt(event.x)),
    onUpdate: (event) => setDraft(valueAt(event.x)),
    onDeactivate: (event) => {
      if (!event.canceled) onCommit(valueAt(event.x));
    },
    onFinalize: () => setDraft(null),
  });
  const tap = useTapGesture({
    runOnJS: true,
    onActivate: (event) => onCommit(valueAt(event.x)),
  });
  const gesture = useExclusiveGestures(drag, tap);

  const ratio = max === min ? 0 : (shown - min) / (max - min);
  const capLeft = ratio * Math.max(0, width - CAP_WIDTH);
  const rangeWidth = capLeft + CAP_WIDTH / 2;
  const readout = format(shown);

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      <GestureDetector gesture={gesture}>
        <View
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={accessibilityLabel}
          accessibilityValue={{ min, max, now: shown, text: readout }}
          accessibilityActions={[
            { name: "increment", label: "Increase" },
            { name: "decrement", label: "Decrease" },
          ]}
          onAccessibilityAction={(event) => {
            const delta =
              event.nativeEvent.actionName === "increment" ? step : -step;
            onCommit(snap(value + delta, min, max, step));
          }}
          onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
          style={{ flex: 1, height: TOUCH_HEIGHT, justifyContent: "center" }}
        >
          <View
            pointerEvents="none"
            style={{
              height: TRACK,
              borderRadius: RADIUS,
              backgroundColor: theme.tint3,
              overflow: "hidden",
            }}
          >
            {rangeWidth > 0 ? (
              <Svg width={rangeWidth} height={TRACK}>
                <Defs>
                  <Pattern
                    id="fader-dither"
                    width={2}
                    height={2}
                    patternUnits="userSpaceOnUse"
                  >
                    <Rect width={1} height={1} fill={theme.accentInk} />
                    <Rect
                      x={1}
                      y={1}
                      width={1}
                      height={1}
                      fill={theme.accentInk}
                    />
                  </Pattern>
                  <LinearGradient id="fader-ramp" x1="0" y1="0" x2="1" y2="0">
                    <Stop offset="0" stopColor="#ffffff" stopOpacity={0.3} />
                    <Stop offset="1" stopColor="#ffffff" stopOpacity={1} />
                  </LinearGradient>
                  <Mask id="fader-density">
                    <Rect
                      width={rangeWidth}
                      height={TRACK}
                      fill="url(#fader-ramp)"
                    />
                  </Mask>
                </Defs>
                <Rect
                  width={rangeWidth}
                  height={TRACK}
                  fill="url(#fader-dither)"
                  mask="url(#fader-density)"
                />
              </Svg>
            ) : null}
          </View>
          {width > 0
            ? ticks?.map((tick) => (
                <View
                  key={tick}
                  pointerEvents="none"
                  style={{
                    position: "absolute",
                    left:
                      ((tick - min) / (max - min)) * (width - CAP_WIDTH) +
                      CAP_WIDTH / 2 -
                      1,
                    top: (TOUCH_HEIGHT + TRACK) / 2 + 2,
                    width: 2,
                    height: 6,
                    borderRadius: 1,
                    backgroundColor: theme.lineStrong,
                  }}
                />
              ))
            : null}
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              left: capLeft,
              top: (TOUCH_HEIGHT - CAP_HEIGHT) / 2,
              width: CAP_WIDTH,
              height: CAP_HEIGHT,
              borderRadius: RADIUS,
              backgroundColor: theme.ink1,
            }}
          />
        </View>
      </GestureDetector>
      <Text
        variant="num"
        tone="ink2"
        style={{ minWidth: 52, textAlign: "right" }}
      >
        {readout}
      </Text>
    </View>
  );
}
