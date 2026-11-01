import type { ReactNode } from "react";
import { Pressable, View } from "react-native";

import { RADIUS, useTheme } from "@/theme";
import { Led, SwitchKey, Text } from "@/ui";

// The rows every You panel is built from: a silkscreen section label over
// rows with a label, an optional ink-3 line under it and a trailing control.

export function Section({
  title,
  note,
  children,
}: {
  title: string;
  /** One line under the title, for what the whole section does. */
  note?: string;
  children: ReactNode;
}) {
  return (
    <View style={{ gap: 4 }}>
      <View style={{ gap: 2, paddingHorizontal: 12, marginBottom: 4 }}>
        <Text variant="silk" tone="ink3" accessibilityRole="header">
          {title}
        </Text>
        {note ? <RowNote>{note}</RowNote> : null}
      </View>
      {children}
    </View>
  );
}

function RowNote({ children }: { children: ReactNode }) {
  return (
    <Text variant="row" tone="ink3" style={{ fontSize: 13, lineHeight: 18 }}>
      {children}
    </Text>
  );
}

function RowText({
  label,
  description,
}: {
  label: string;
  description?: string;
}) {
  return (
    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
      <Text variant="row" style={{ fontSize: 15, lineHeight: 20 }}>
        {label}
      </Text>
      {description ? <RowNote>{description}</RowNote> : null}
    </View>
  );
}

interface RowProps {
  label: string;
  description?: string;
  /** A value, a button or a control at the end of the row. */
  trailing?: ReactNode;
  /** Leading slot, e.g. an LED. */
  leading?: ReactNode;
}

/** A row that only shows something. */
export function Row({ label, description, trailing, leading }: RowProps) {
  return (
    <View
      style={{
        minHeight: 56,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 12,
        paddingVertical: 8,
      }}
    >
      {leading}
      <RowText label={label} description={description} />
      {trailing}
    </View>
  );
}

/** A switch row: the whole row toggles, the LED key shows the state. */
export function ToggleRow({
  label,
  description,
  value,
  onValueChange,
}: {
  label: string;
  description?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
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
        gap: 12,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: RADIUS,
        backgroundColor: pressed ? theme.tint2 : "transparent",
      })}
    >
      <RowText label={label} description={description} />
      <SwitchKey on={value} />
    </Pressable>
  );
}

/** One choice of a radio group; the lit LED marks the chosen one. */
export function ChoiceRow({
  label,
  description,
  selected,
  onPress,
}: {
  label: string;
  description?: string;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 48,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: RADIUS,
        backgroundColor: selected || pressed ? theme.tint2 : "transparent",
      })}
    >
      <Led state={selected ? "talk" : "off"} />
      <RowText label={label} description={description} />
    </Pressable>
  );
}
