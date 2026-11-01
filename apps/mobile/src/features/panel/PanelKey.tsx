import type { Icon as PhosphorIcon } from "phosphor-react-native";
import { Pressable, View } from "react-native";

import { RADIUS, useTheme } from "@/theme";
import { CountChip, Icon } from "@/ui";

/**
 * ghost: bare until pressed (the "you" row's keys). rest: tint-1. off: a
 * muted or deafened key in danger ink. live: camera on, in live azure.
 * danger: Leave, the only solid fill.
 */
export type PanelKeyTone = "ghost" | "rest" | "off" | "live" | "danger";

interface PanelKeyProps {
  icon: PhosphorIcon;
  /** Required: an icon alone says nothing to a screen reader. */
  label: string;
  onPress: () => void;
  tone?: PanelKeyTone;
  /** Toggle keys report their state. */
  selected?: boolean;
  /** A count chip on the corner, e.g. unread activity. */
  count?: number;
}

/** 40px square key on the panel. */
export function PanelKey({
  icon,
  label,
  onPress,
  tone = "ghost",
  selected,
  count = 0,
}: PanelKeyProps) {
  const theme = useTheme();
  const background = {
    ghost: "transparent",
    rest: theme.tint1,
    off: theme.dangerTint,
    live: theme.liveTint,
    danger: theme.dangerFill,
  }[tone];
  const color = {
    ghost: theme.ink2,
    rest: theme.ink1,
    off: theme.dangerInk,
    live: theme.live,
    danger: theme.onDanger,
  }[tone];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={count > 0 ? `${label}, ${count} unread` : label}
      accessibilityState={selected === undefined ? undefined : { selected }}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => ({
        width: 40,
        height: 40,
        borderRadius: RADIUS,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: pressed && tone === "ghost" ? theme.tint2 : background,
        opacity: pressed && tone !== "ghost" ? 0.8 : 1,
      })}
    >
      <Icon
        icon={icon}
        active={tone === "off" || tone === "live" || tone === "danger"}
        size={22}
        color={color}
      />
      {count > 0 ? (
        <View
          pointerEvents="none"
          style={{ position: "absolute", top: 0, right: 0 }}
        >
          <CountChip count={count} />
        </View>
      ) : null}
    </Pressable>
  );
}
