import { Pressable } from "react-native";

import { RADIUS, useTheme } from "@/theme";

import { Text } from "./Text";

interface ButtonProps {
  label: string;
  onPress: () => void;
  /** One primary per view; danger confirms a destructive step. */
  variant?: "primary" | "ghost" | "danger";
}

export function Button({ label, onPress, variant = "primary" }: ButtonProps) {
  const theme = useTheme();
  const primary = variant === "primary";
  const danger = variant === "danger";
  const filled = primary || danger;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        height: 48,
        paddingHorizontal: 20,
        borderRadius: RADIUS,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: primary
          ? theme.primaryFill
          : danger
            ? theme.dangerFill
            : pressed
              ? theme.tint2
              : "transparent",
        borderWidth: filled ? 0 : 1,
        borderColor: theme.lineStrong,
        opacity: filled && pressed ? 0.88 : 1,
      })}
    >
      <Text
        variant="control"
        style={{
          color: primary
            ? theme.onPrimary
            : danger
              ? theme.onDanger
              : theme.ink1,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
