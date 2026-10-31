import { View } from "react-native";

import { RADIUS, useTheme } from "@/theme";

import { Led, type LedState } from "./Led";
import { Text } from "./Text";

interface AvatarProps {
  name: string;
  size?: number;
  presence?: LedState;
}

/** Square, initial only; the optional presence LED sits on the corner. */
export function Avatar({ name, size = 40, presence }: AvatarProps) {
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
      <Text variant="name" style={{ fontSize: size * 0.4 }}>
        {name.slice(0, 1).toUpperCase()}
      </Text>
      {presence ? (
        <View style={{ position: "absolute", right: -3, bottom: -3 }}>
          <Led state={presence} size={10} />
        </View>
      ) : null}
    </View>
  );
}
