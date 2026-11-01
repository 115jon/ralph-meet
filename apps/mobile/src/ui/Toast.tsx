import { View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BAR_CLEARANCE, BAR_INSET_X } from "@/features/app-bar/metrics";
import { RADIUS, useTheme } from "@/theme";

import { Led } from "./Led";
import { Text } from "./Text";
import { useToast } from "./toast-store";

/**
 * The one toast host, mounted at the root: a ply-3 plate under a 2px ink
 * rule, clear of the floating app bar. It fades in once and out once.
 */
export function ToastHost() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  // The host stays mounted so a leaving toast can play its exit.
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: BAR_INSET_X,
        right: BAR_INSET_X,
        bottom: insets.bottom + BAR_CLEARANCE - 8,
      }}
    >
      {toast ? (
        <Animated.View
          key={toast.id}
          entering={FadeIn.duration(160)}
          exiting={FadeOut.duration(160)}
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            minHeight: 52,
            paddingHorizontal: 16,
            paddingVertical: 10,
            borderRadius: RADIUS,
            backgroundColor: theme.ply3,
            borderWidth: 1,
            borderColor: theme.lineStrong,
            borderTopWidth: 2,
            borderTopColor: theme.ink1,
            shadowColor: theme.shadow,
            shadowOffset: { width: 0, height: 8 },
            shadowOpacity: 1,
            shadowRadius: 12,
            elevation: 12,
          }}
        >
          <Led state={toast.led} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="silk" tone="ink3">
              {toast.label}
            </Text>
            <Text variant="row">{toast.text}</Text>
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
}
