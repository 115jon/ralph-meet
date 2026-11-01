import { useRouter } from "expo-router";
import { useCallback, useEffect } from "react";

import { loadServers, loadTree } from "@/features/servers/actions";
import {
  ChannelTree,
  ChannelTreeSkeleton,
} from "@/features/servers/ChannelTree";
import type { Channel } from "@/features/servers/schema";
import { ServerRail, ServerRailSkeleton } from "@/features/servers/ServerRail";
import {
  type LoadStatus,
  useSelectedServer,
  useServerList,
  useServerTree,
} from "@/features/servers/store";
import { channelKind } from "@/features/servers/tree";
import { joinVoiceChannel } from "@/features/voice/actions";
import { EmptyState, Header, Screen } from "@/ui";

function SelectedServerTree() {
  const router = useRouter();
  const server = useSelectedServer();
  const tree = useServerTree(server?.id ?? null);

  const openChannel = useCallback(
    (channel: Channel) => {
      if (channelKind(channel) === "voice") {
        if (!server) return;
        // Joining the channel already in the call just opens the call.
        void joinVoiceChannel({
          serverId: server.id,
          channelId: channel.id,
          channelName: channel.name,
        });
        router.push("/call");
        return;
      }
      router.push({
        pathname: "/channel/[id]",
        params: { id: channel.id, name: channel.name },
      });
    },
    [router, server],
  );

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
    <ChannelTree
      categories={tree.categories}
      channels={tree.channels}
      onOpenChannel={openChannel}
    />
  );
}

/** Before the list arrives, when it failed, or when there is none. */
function NoServers({ status }: { status: LoadStatus }) {
  if (status === "loading") {
    return (
      <>
        <ServerRailSkeleton />
        <ChannelTreeSkeleton />
      </>
    );
  }
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

export default function ServersScreen() {
  const { servers, status } = useServerList();
  const server = useSelectedServer();

  useEffect(() => {
    void loadServers();
  }, []);

  if (servers.length === 0) {
    return (
      <Screen>
        <Header title="Servers" rule="brand" />
        <NoServers status={status} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Header title={server?.name ?? "Servers"} rule="brand" />
      <ServerRail servers={servers} />
      <SelectedServerTree />
    </Screen>
  );
}
