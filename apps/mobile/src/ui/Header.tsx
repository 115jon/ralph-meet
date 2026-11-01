import { ArrowLeft } from "phosphor-react-native";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";

import { RADIUS, useTheme } from "@/theme";

import { IconButton } from "./IconButton";
import { Text } from "./Text";

interface HeaderProps {
  title: string;
  /**
   * What closes the header: a hairline seam (default), or the 2px brand rule
   * that heads the server tree.
   */
  rule?: "line" | "brand";
  /** A stack screen: a back key before the title. */
  onBack?: () => void;
  /** One screen-wide action after the title, e.g. Activity's Mark all read. */
  action?: ReactNode;
}

/** 48px screen header: title in Bricolage, then a seam or the brand rule. */
export function Header({ title, rule = "line", onBack, action }: HeaderProps) {
  const theme = useTheme();
  return (
    <View>
      <View
        style={{
          height: 48,
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          paddingLeft: onBack ? 4 : 16,
          paddingRight: action ? 4 : 16,
          borderBottomWidth: rule === "line" ? 1 : 0,
          borderBottomColor: theme.line,
        }}
      >
        {onBack ? (
          <IconButton icon={ArrowLeft} label="Back" onPress={onBack} />
        ) : null}
        <Text
          variant="title"
          numberOfLines={1}
          accessibilityRole="header"
          style={{ flex: 1 }}
        >
          {title}
        </Text>
        {action}
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

/** A worded key for the header's action slot: 40 tall, 48 with its slop. */
export function HeaderAction({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => ({
        minHeight: 40,
        justifyContent: "center",
        paddingHorizontal: 12,
        borderRadius: RADIUS,
        backgroundColor: pressed ? theme.tint2 : "transparent",
      })}
    >
      <Text variant="control" style={{ fontSize: 14 }}>
        {label}
      </Text>
    </Pressable>
  );
}
