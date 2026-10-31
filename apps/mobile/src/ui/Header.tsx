import { View } from "react-native";

import { useTheme } from "@/theme";

import { Text } from "./Text";

interface HeaderProps {
  title: string;
  /**
   * What closes the header: a hairline seam (default), or the 2px brand rule
   * that heads the server tree.
   */
  rule?: "line" | "brand";
}

/** 48px screen header: title in Bricolage, then a seam or the brand rule. */
export function Header({ title, rule = "line" }: HeaderProps) {
  const theme = useTheme();
  return (
    <View>
      <View
        style={{
          height: 48,
          paddingHorizontal: 16,
          justifyContent: "center",
          borderBottomWidth: rule === "line" ? 1 : 0,
          borderBottomColor: theme.line,
        }}
      >
        <Text variant="title" numberOfLines={1} accessibilityRole="header">
          {title}
        </Text>
      </View>
      {rule === "brand" ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ height: 2, marginHorizontal: 16, flexDirection: "row" }}
        >
          <View style={{ flex: 3, backgroundColor: theme.brand }} />
          <View style={{ flex: 2, backgroundColor: theme.brand2 }} />
        </View>
      ) : null}
    </View>
  );
}
