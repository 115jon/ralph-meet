import type { Icon as PhosphorIcon } from "phosphor-react-native";
import { Pressable } from "react-native";

import { RADIUS, useTheme } from "@/theme";

import { Icon } from "./Icon";

interface IconButtonProps {
  icon: PhosphorIcon;
  /** Required: an icon alone says nothing to a screen reader. */
  label: string;
  onPress: () => void;
}

/** 40px square key holding one Phosphor glyph. */
export function IconButton({ icon, label, onPress }: IconButtonProps) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
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
      <Icon icon={icon} size={22} />
    </Pressable>
  );
}
