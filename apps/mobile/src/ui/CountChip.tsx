import { View } from "react-native";

import { FONT, RADIUS, useTheme } from "@/theme";

import { Text } from "./Text";

export function CountChip({ count }: { count: number }) {
  const theme = useTheme();
  if (count <= 0) return null;
  return (
    <View
      style={{
        minWidth: 18,
        height: 18,
        paddingHorizontal: 4,
        borderRadius: RADIUS,
        backgroundColor: theme.badge,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text
        variant="num"
        style={{
          fontFamily: FONT.silkStrong,
          fontSize: 11,
          lineHeight: 14,
          color: theme.onBadge,
        }}
      >
        {count > 99 ? "99+" : count}
      </Text>
    </View>
  );
}
