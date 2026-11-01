import { useEffect, useRef } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { checkMissing } from "@/features/conversation/missing";
import { ConversationPage } from "@/features/conversation/ConversationPage";
import {
  closeConversation,
  getConversation,
  revealConversation,
  useConversation,
} from "@/features/conversation/store";
import { useDmsStore } from "@/features/dms/store";
import { DmsPane } from "@/features/home/DmsPane";
import { HomePager } from "@/features/home/HomePager";
import { useHomePane } from "@/features/home/pane";
import { MembersPage } from "@/features/members/MembersPage";
import { Rail } from "@/features/home/Rail";
import { ServerPane } from "@/features/home/ServerPane";
import { YourPanel } from "@/features/panel/YourPanel";
import { loadServers } from "@/features/servers/actions";
import { useServersStore } from "@/features/servers/store";
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
 * Closes the open conversation once the loaded lists show it is gone (a
 * server left, a DM deleted). Only one the lists have listed before can go
 * missing: a just-created DM or a cold-start link is left alone until they
 * catch up. Runs on complete lists only, when their ids change.
 */
function useCloseMissingConversation(): void {
  const conversation = useConversation();
  const channelIds = useServersStore((s) => {
    const complete =
      s.status === "ready" &&
      s.servers.every((server) => s.trees[server.id]?.status === "ready");
    if (!complete) return null;
    return s.servers
      .flatMap((server) => s.trees[server.id]?.channels ?? [])
      .map((channel) => channel.id)
      .join(",");
  });
  const dmIds = useDmsStore((s) =>
    s.status === "ready" ? s.dms.map((dm) => dm.id).join(",") : null,
  );
  const seen = useRef({ key: "", seen: false });
  useEffect(() => {
    if (!conversation) return;
    const key = `${conversation.kind}:${conversation.id}`;
    if (seen.current.key !== key) seen.current = { key, seen: false };
    let ids: string | null = null;
    if (conversation.kind === "channel") ids = channelIds;
    else if (conversation.kind === "dm") ids = dmIds;
    const next = checkMissing(seen.current.seen, ids, conversation.id);
    seen.current.seen = next.seen;
    if (next.close) closeConversation();
  }, [conversation, channelIds, dmIds]);
}

/**
 * Home: the drawer, the open conversation and a channel's members as the
 * pages of one pager.
 * The call, Activity and Settings open over it as stack screens.
 */
export default function HomeScreen() {
  useEffect(() => {
    void loadServers();
    // A conversation restored from the last launch: show where it lives.
    const restored = getConversation();
    if (restored) revealConversation(restored);
  }, []);
  useCloseMissingConversation();

  return (
    <HomePager
      drawer={<HomeDrawer />}
      chat={<ConversationPage />}
      members={<MembersPage />}
    />
  );
}
