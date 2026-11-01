import { Image, View } from "react-native";

import { RADIUS, useTheme } from "@/theme";

import { Led, type LedState } from "./Led";
import { Text } from "./Text";

interface AvatarProps {
  name: string;
  size?: number;
  /** An absolute image URL; the initial shows while it loads or without one. */
  uri?: string | null;
  presence?: LedState;
}

/** Square; the image over the initial, the optional presence LED on the corner. */
export function Avatar({ name, size = 40, uri, presence }: AvatarProps) {
  const theme = useTheme();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: RADIUS,
        backgroundColor: theme.ply4,
        borderWidth: 1,
        borderColor: theme.line,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text
        variant="name"
        // 11px floor, initials included.
        style={{ fontSize: Math.max(11, size * 0.4), lineHeight: size * 0.6 }}
      >
        {name.slice(0, 1).toUpperCase()}
      </Text>
      {uri ? (
        <Image
          source={{ uri }}
          accessibilityIgnoresInvertColors
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: size - 2,
            height: size - 2,
            borderRadius: RADIUS - 1,
          }}
        />
      ) : null}
      {presence ? (
        <View style={{ position: "absolute", right: -3, bottom: -3 }}>
          <Led state={presence} size={10} />
        </View>
      ) : null}
    </View>
  );
}
