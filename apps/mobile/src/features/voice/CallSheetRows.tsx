import type { Icon as PhosphorIcon } from "phosphor-react-native";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";

import { RADIUS, useTheme } from "@/theme";
import { Icon, SwitchKey, Text } from "@/ui";

// Rows shared by the call's sheets (a person, call settings).

/** A thin rule between a sheet's groups. */
export function SheetSeam() {
  const theme = useTheme();
  return (
    <View
      style={{
        height: 1,
        marginVertical: 6,
        marginHorizontal: 16,
        backgroundColor: theme.line,
      }}
    />
  );
}

/** A sheet's title row: a Bricolage title and an optional trailing key. */
export function SheetTitle({
  title,
  trailing,
}: {
  title: string;
  trailing?: ReactNode;
}) {
  return (
    <View
      style={{
        minHeight: 44,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingLeft: 16,
        paddingRight: 8,
        marginBottom: 4,
      }}
    >
      <Text
        variant="title"
        accessibilityRole="header"
        numberOfLines={1}
        style={{ flex: 1, fontSize: 20, lineHeight: 26 }}
      >
        {title}
      </Text>
      {trailing}
    </View>
  );
}

interface SheetToggleRowProps {
  icon: PhosphorIcon;
  label: string;
  description?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}

/** A switch row with a leading glyph: the whole row toggles. */
export function SheetToggleRow({
  icon,
  label,
  description,
  value,
  onValueChange,
}: SheetToggleRowProps) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={label}
      accessibilityHint={description}
      onPress={() => onValueChange(!value)}
      style={({ pressed }) => ({
        minHeight: 56,
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        paddingHorizontal: 20,
        paddingVertical: 8,
        borderRadius: RADIUS,
        backgroundColor: pressed ? theme.tint2 : "transparent",
      })}
    >
      <Icon icon={icon} size={20} color={theme.ink2} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text variant="row" style={{ fontSize: 15, lineHeight: 20 }}>
          {label}
        </Text>
        {description ? (
          <Text
            variant="row"
            tone="ink3"
            style={{ fontSize: 13, lineHeight: 18 }}
          >
            {description}
          </Text>
        ) : null}
      </View>
      <SwitchKey on={value} />
    </Pressable>
  );
}
