import { Pressable } from "react-native";

import { RADIUS, useTheme } from "@/theme";

import { Text } from "./Text";

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: "primary" | "ghost";
}

export function Button({ label, onPress, variant = "primary" }: ButtonProps) {
  const theme = useTheme();
  const primary = variant === "primary";
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
          : pressed
            ? theme.tint2
            : "transparent",
        borderWidth: primary ? 0 : 1,
        borderColor: theme.lineStrong,
        opacity: primary && pressed ? 0.88 : 1,
      })}
    >
      <Text
        variant="control"
        style={{ color: primary ? theme.onPrimary : theme.ink1 }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
