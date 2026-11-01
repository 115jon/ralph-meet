import type { Icon as PhosphorIcon } from "phosphor-react-native";
import { Pressable } from "react-native";

import { RADIUS, useTheme } from "@/theme";

import { Icon } from "./Icon";

interface SquareKeyProps {
  icon: PhosphorIcon;
  /** Required: an icon alone says nothing to a screen reader. */
  label: string;
  onPress: () => void;
  /**
   * tint: a row's quiet key (tint-1). primary: the one light key (Accept).
   * outline: a 2px line-strong edge (a sheet's trailing key).
   */
  tone?: "tint" | "primary" | "outline";
  size?: 40 | 48;
  disabled?: boolean;
}

/** A square key holding one glyph, for row actions and sheet footers. */
export function SquareKey({
  icon,
  label,
  onPress,
  tone = "tint",
  size = 40,
  disabled = false,
}: SquareKeyProps) {
  const theme = useTheme();
  const primary = tone === "primary";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => ({
        width: size,
        height: size,
        borderRadius: RADIUS,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: tone === "outline" ? 2 : 0,
        borderColor: theme.lineStrong,
        backgroundColor: primary
          ? theme.primaryFill
          : pressed
            ? theme.tint3
            : tone === "tint"
              ? theme.tint1
              : "transparent",
        opacity: primary && pressed ? 0.88 : disabled ? 0.45 : 1,
      })}
    >
      <Icon
        icon={icon}
        size={size === 48 ? 20 : 18}
        color={primary ? theme.onPrimary : theme.ink1}
      />
    </Pressable>
  );
}
