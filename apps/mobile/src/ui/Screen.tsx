import type { ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BAR_CLEARANCE } from "@/features/app-bar/metrics";
import { useTheme } from "@/theme";

interface ScreenProps {
  children: ReactNode;
  /** Set false for screens that own a virtualised list. */
  scroll?: boolean;
}

/** Safe areas plus bottom padding so content scrolls clear of the floating bar. */
export function Screen({ children, scroll = true }: ScreenProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const padding = {
    paddingTop: insets.top,
    paddingBottom: insets.bottom + BAR_CLEARANCE,
  };
  if (!scroll) {
    return (
      <View style={[{ flex: 1, backgroundColor: theme.ply0 }, padding]}>
        {children}
      </View>
    );
  }
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.ply0 }}
      contentContainerStyle={padding}
    >
      {children}
    </ScrollView>
  );
}
