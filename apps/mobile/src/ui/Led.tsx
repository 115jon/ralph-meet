import { View } from "react-native";

import { useTheme, type Theme } from "@/theme";

export type LedState = "talk" | "live" | "idle" | "danger" | "off";

const COLOR: Record<LedState, keyof Theme> = {
  talk: "talk",
  live: "live",
  idle: "idle",
  danger: "dangerFill",
  off: "inkOff",
};

/** Colour only ever appears as LED state. */
export function Led({ state, size = 8 }: { state: LedState; size?: number }) {
  const theme = useTheme();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: 1,
        backgroundColor: theme[COLOR[state]],
      }}
    />
  );
}
