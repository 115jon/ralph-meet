import { Tabs } from "expo-router/js-tabs";

import { AppBar } from "@/features/app-bar/AppBar";
import { useTheme } from "@/theme";

export default function TabsLayout() {
  const theme = useTheme();
  return (
    <Tabs
      tabBar={(props) => <AppBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: theme.ply0 },
      }}
    >
      <Tabs.Screen name="servers" options={{ title: "Servers" }} />
      <Tabs.Screen name="dms" options={{ title: "DMs", tabBarBadge: 3 }} />
      <Tabs.Screen name="activity" options={{ title: "Activity" }} />
      <Tabs.Screen name="you" options={{ title: "You" }} />
    </Tabs>
  );
}
