import type { ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/theme";

interface ScreenProps {
  children: ReactNode;
  /** Set false for screens that own a virtualised list. */
  scroll?: boolean;
}

/** A stack screen inside the safe areas. The home screen owns its own layout for the panel. */
export function Screen({ children, scroll = true }: ScreenProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const padding = {
    paddingTop: insets.top,
    paddingBottom: insets.bottom,
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
