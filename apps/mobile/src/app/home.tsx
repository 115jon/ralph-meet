import { useEffect } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { DmsPane } from "@/features/home/DmsPane";
import { useHomePane } from "@/features/home/pane";
import { Rail } from "@/features/home/Rail";
import { ServerPane } from "@/features/home/ServerPane";
import { YourPanel } from "@/features/panel/YourPanel";
import { loadServers } from "@/features/servers/actions";
import { useTheme } from "@/theme";

/**
 * Home: the server rail on the left, the selected server's tree or your
 * direct messages beside it, and your panel floating over both. Chats,
 * the call, Activity and Settings open over it as stack screens.
 */
export default function HomeScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const pane = useHomePane();

  useEffect(() => {
    void loadServers();
  }, []);

  return (
    <View
      style={{ flex: 1, backgroundColor: theme.ply0, paddingTop: insets.top }}
    >
      <View style={{ flex: 1, flexDirection: "row" }}>
        <Rail />
        <View style={{ flex: 1, minWidth: 0 }}>
          {pane === "dms" ? <DmsPane /> : <ServerPane />}
        </View>
      </View>
      <YourPanel />
    </View>
  );
}
