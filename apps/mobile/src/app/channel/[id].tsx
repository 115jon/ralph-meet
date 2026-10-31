import { useLocalSearchParams } from "expo-router";
import { useEffect } from "react";

import { loadMembers } from "@/features/chat/actions";
import { ChatView } from "@/features/chat/ChatView";
import { useMembers } from "@/features/chat/store";
import { useChannel, useChannelServer } from "@/features/servers/store";

/** A server text channel, pushed over the tabs. */
export default function ChannelScreen() {
  const params = useLocalSearchParams<{ id: string; name?: string }>();
  const id = params.id;
  const channel = useChannel(id);
  const server = useChannelServer(id);
  const serverId = server?.id ?? null;
  const members = useMembers(serverId);
  const name = channel?.name ?? params.name ?? "channel";

  useEffect(() => {
    if (serverId) void loadMembers(serverId);
  }, [serverId]);

  return (
    <ChatView
      channelId={id}
      title={`#${name}`}
      subtitle={server?.name ?? "Channel"}
      placeholder={`Message #${name}`}
      intro={`This is the start of #${name}.`}
      people={members}
    />
  );
}
