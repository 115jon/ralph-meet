import type { DimensionValue } from "react-native";
import { View } from "react-native";

import { RADIUS, useTheme } from "@/theme";

interface SkeletonProps {
  width: DimensionValue;
  height: number;
}

/** A still tint-1 block standing in for content. It never shimmers. */
export function Skeleton({ width, height }: SkeletonProps) {
  const theme = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width,
        height,
        borderRadius: RADIUS,
        backgroundColor: theme.tint1,
      }}
    />
  );
}
