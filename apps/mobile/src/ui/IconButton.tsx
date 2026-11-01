import type { Icon as PhosphorIcon } from "phosphor-react-native";
import { Pressable } from "react-native";

import { RADIUS, useTheme } from "@/theme";

import { Icon } from "./Icon";

interface IconButtonProps {
  icon: PhosphorIcon;
  /** Required: an icon alone says nothing to a screen reader. */
  label: string;
  onPress: () => void;
  /** Draws the glyph in its Fill weight (a key that is on). */
  active?: boolean;
  disabled?: boolean;
}

/** 40px square key holding one Phosphor glyph. */
export function IconButton({
  icon,
  label,
  onPress,
  active = false,
  disabled = false,
}: IconButtonProps) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => ({
        width: 40,
        height: 40,
        borderRadius: RADIUS,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: pressed ? theme.tint2 : "transparent",
      })}
    >
      <Icon
        icon={icon}
        active={active}
        size={22}
        color={disabled ? theme.inkOff : undefined}
      />
    </Pressable>
  );
}
