import { useEffect } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ConversationPage } from "@/features/conversation/ConversationPage";
import {
  getConversation,
  revealConversation,
} from "@/features/conversation/store";
import { DmsPane } from "@/features/home/DmsPane";
import { HomePager } from "@/features/home/HomePager";
import { useHomePane } from "@/features/home/pane";
import { Rail } from "@/features/home/Rail";
import { ServerPane } from "@/features/home/ServerPane";
import { YourPanel } from "@/features/panel/YourPanel";
import { loadServers } from "@/features/servers/actions";
import { useTheme } from "@/theme";

/**
 * The drawer page: the server rail, the selected server's tree or your
 * direct messages beside it, and your panel floating over both.
 */
function HomeDrawer() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const pane = useHomePane();
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

/**
 * Home: the drawer and the open conversation as two pages of one pager.
 * The call, Activity and Settings open over it as stack screens.
 */
export default function HomeScreen() {
  useEffect(() => {
    void loadServers();
    // A conversation restored from the last launch: show where it lives.
    const restored = getConversation();
    if (restored) revealConversation(restored);
  }, []);

  return <HomePager drawer={<HomeDrawer />} chat={<ConversationPage />} />;
}
