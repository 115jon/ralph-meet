import { View } from "react-native";

import { useTheme } from "@/theme";

import { Text } from "./Text";

/** 48px screen header: title in Bricolage, hairline seam below. */
export function Header({ title }: { title: string }) {
  const theme = useTheme();
  return (
    <View
      style={{
        height: 48,
        paddingHorizontal: 16,
        justifyContent: "center",
        borderBottomWidth: 1,
        borderBottomColor: theme.line,
      }}
    >
      <Text variant="title" numberOfLines={1}>
        {title}
      </Text>
    </View>
  );
}
