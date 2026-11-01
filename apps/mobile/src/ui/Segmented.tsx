import { Fragment } from "react";
import { Pressable, View } from "react-native";

import { RADIUS, useTheme } from "@/theme";

import { Text } from "./Text";

interface SegmentedProps<T extends string> {
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
  label: (option: T) => string;
  /** A silkscreen readout under a cell's label, e.g. "1" pending. */
  note?: (option: T) => string | null;
  /** Read by screen readers as the group's name. */
  accessibilityLabel: string;
}

/**
 * DESIGN's segmented rail at row size: a 2px ink-1 rail, cells split by 2px
 * ink rules, the chosen cell lit in primary fill, silkscreen labels.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  note,
  accessibilityLabel,
}: SegmentedProps<T>) {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      style={{
        flexDirection: "row",
        minHeight: 36,
        borderWidth: 2,
        borderColor: theme.ink1,
        borderRadius: RADIUS,
        overflow: "hidden",
      }}
    >
      {options.map((option, index) => {
        const selected = option === value;
        const extra = note?.(option) ?? null;
        return (
          <Fragment key={option}>
            {index > 0 ? (
              <View style={{ width: 2, backgroundColor: theme.ink1 }} />
            ) : null}
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={
                extra ? `${label(option)}, ${extra}` : label(option)
              }
              onPress={() => onChange(option)}
              style={({ pressed }) => ({
                flex: 1,
                alignItems: "center",
                justifyContent: "center",
                paddingVertical: 4,
                backgroundColor: selected
                  ? theme.primaryFill
                  : pressed
                    ? theme.tint2
                    : "transparent",
              })}
            >
              <Text
                variant="silk"
                numberOfLines={1}
                style={{ color: selected ? theme.onPrimary : theme.ink2 }}
              >
                {label(option)}
              </Text>
              {extra ? (
                <Text
                  variant="num"
                  style={{
                    fontSize: 11,
                    lineHeight: 12,
                    color: selected ? theme.onPrimary : theme.ink3,
                  }}
                >
                  {extra}
                </Text>
              ) : null}
            </Pressable>
          </Fragment>
        );
      })}
    </View>
  );
}
