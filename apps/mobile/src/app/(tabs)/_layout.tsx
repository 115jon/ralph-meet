import { Tabs } from "expo-router/js-tabs";

import { useUnreadActivityCount } from "@/features/activity/store";
import { AppBar } from "@/features/app-bar/AppBar";
import { useUnreadDmCount } from "@/features/dms/store";
import { useTheme } from "@/theme";

export default function TabsLayout() {
  const theme = useTheme();
  const unreadDms = useUnreadDmCount();
  const unreadActivity = useUnreadActivityCount();
  return (
    <Tabs
      tabBar={(props) => <AppBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: theme.ply0 },
      }}
    >
      <Tabs.Screen name="servers" options={{ title: "Servers" }} />
      <Tabs.Screen
        name="dms"
        options={{ title: "DMs", tabBarBadge: unreadDms || undefined }}
      />
      <Tabs.Screen
        name="activity"
        options={{
          title: "Activity",
          tabBarBadge: unreadActivity || undefined,
        }}
      />
      <Tabs.Screen name="you" options={{ title: "You" }} />
    </Tabs>
  );
}
