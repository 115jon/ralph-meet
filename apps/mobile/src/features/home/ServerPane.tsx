import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ScrollView } from "react-native";

import { openConversation } from "@/features/conversation/store";
import { usePlateClearance } from "@/features/panel/metrics";
import {
  loadServers,
  loadTree,
  refreshReadStates,
} from "@/features/servers/actions";
import {
  ChannelTree,
  ChannelTreeSkeleton,
} from "@/features/servers/ChannelTree";
import type { Channel } from "@/features/servers/schema";
import {
  useSelectedServer,
  useServerList,
  useServerTree,
  useServersStore,
} from "@/features/servers/store";
import { channelKind } from "@/features/servers/tree";
import { joinVoiceChannel, type JoinTarget } from "@/features/voice/actions";
import { useVoiceStore } from "@/features/voice/store";
import { VoiceSwitchSheet } from "@/features/voice/VoiceSwitchSheet";
import { EmptyState, Header, useRefreshControl } from "@/ui";

function SelectedServerTree() {
  const router = useRouter();
  const server = useSelectedServer();
  const tree = useServerTree(server?.id ?? null);
  const [switchTo, setSwitchTo] = useState<JoinTarget | null>(null);
  const call = useVoiceStore((s) => s.call);
  const callServer = useServersStore(
    (s) => s.servers.find((x) => x.id === call?.serverId)?.name,
  );
  const currentPlace = call
    ? callServer
      ? `${call.channelName} in ${callServer}`
      : call.channelName
    : "";
  const targetPlace = switchTo
    ? `${switchTo.channelName} in ${server?.name ?? "this server"}`
    : "";

  const join = useCallback(
    (target: JoinTarget) => {
      setSwitchTo(null);
      void joinVoiceChannel(target);
      router.push("/call");
    },
    [router],
  );

  const openChannel = useCallback(
    (channel: Channel) => {
      if (channelKind(channel) !== "voice") {
        openConversation({
          kind: "channel",
          id: channel.id,
          name: channel.name,
        });
        return;
      }
      if (!server) return;
      const call = useVoiceStore.getState().call;
      // The channel already in the call just opens the call.
      if (call?.channelId === channel.id) {
        router.push("/call");
        return;
      }
      const target = {
        serverId: server.id,
        channelId: channel.id,
        channelName: channel.name,
      };
      // A mis-tap must not drop a call that has run all evening: ask first.
      if (call) setSwitchTo(target);
      else join(target);
    },
    [router, server, join],
  );
  const cancelSwitch = useCallback(() => setSwitchTo(null), []);

  if (!server || !tree || tree.status === "loading") {
    return <ChannelTreeSkeleton />;
  }
  if (tree.status === "error") {
    return (
      <EmptyState
        title="Channels did not load"
        description={`Could not fetch the channels in ${server.name}.`}
        action={{ label: "Try again", onPress: () => void loadTree(server.id) }}
      />
    );
  }
  if (tree.channels.length === 0) {
    return (
      <EmptyState
        title="No channels yet"
        description="There are no channels here you can see."
      />
    );
  }
  return (
    <>
      <ChannelTree
        categories={tree.categories}
        channels={tree.channels}
        onOpenChannel={openChannel}
      />
      <VoiceSwitchSheet
        target={switchTo}
        currentPlace={currentPlace}
        targetPlace={targetPlace}
        onCancel={cancelSwitch}
        onSwitch={join}
      />
    </>
  );
}

/** The list failed, or there is none: said in the pane, the rail stays. */
function NoServers() {
  const { status } = useServerList();
  if (status === "loading") return <ChannelTreeSkeleton />;
  if (status === "error") {
    return (
      <EmptyState
        title="Ralph is out of reach"
        description="Your servers did not load. Check the connection and try again."
        action={{ label: "Try again", onPress: () => void loadServers() }}
      />
    );
  }
  return (
    <EmptyState
      title="No servers yet"
      description="Join or create a server on the web and it shows up here."
    />
  );
}

/** Pull-to-refresh: the server list, the shown tree and every unread mark. */
async function refreshServers(): Promise<void> {
  const selectedId = useServersStore.getState().selectedId;
  await Promise.all([
    loadServers(),
    selectedId ? loadTree(selectedId) : null,
    refreshReadStates(),
  ]);
}

/** The selected server: its name over the brand rule, then its channel tree. */
export function ServerPane() {
  const { servers } = useServerList();
  const server = useSelectedServer();
  const clearance = usePlateClearance();
  const refreshControl = useRefreshControl(refreshServers);
  return (
    <>
      <Header title={server?.name ?? "Servers"} rule="brand" />
      <ScrollView
        refreshControl={refreshControl}
        contentContainerStyle={{ paddingBottom: clearance }}
      >
        {servers.length === 0 ? <NoServers /> : <SelectedServerTree />}
      </ScrollView>
    </>
  );
}
