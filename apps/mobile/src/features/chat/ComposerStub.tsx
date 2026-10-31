import { PlusCircle } from "phosphor-react-native";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { RADIUS, useTheme } from "@/theme";
import { Icon, Text } from "@/ui";

/**
 * Where the composer will float. Read-only for now: drawn in ink-off with no
 * send key, so nothing on it looks tappable.
 */
export function ComposerStub({ name }: { name: string }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        paddingHorizontal: 10,
        paddingTop: 8,
        paddingBottom: insets.bottom + 12,
        backgroundColor: theme.ply0,
      }}
    >
      <View
        accessible
        accessibilityLabel={`Message #${name}. Sending arrives in the next build.`}
        accessibilityState={{ disabled: true }}
        style={{
          minHeight: 52,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          paddingHorizontal: 12,
          borderRadius: RADIUS,
          borderWidth: 1,
          borderColor: theme.line,
          backgroundColor: theme.ply1,
        }}
      >
        <Icon icon={PlusCircle} size={22} color={theme.inkOff} />
        <Text
          variant="body"
          tone="inkOff"
          numberOfLines={1}
          style={{ flex: 1 }}
        >
          Message #{name}
        </Text>
        <Text variant="silk" tone="inkOff">
          Read only
        </Text>
      </View>
    </View>
  );
}
