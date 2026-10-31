import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback } from "react";
import { View } from "react-native";

import { closeChannel, openChannel } from "@/features/chat/actions";
import { ChannelHeader } from "@/features/chat/ChannelHeader";
import { ComposerStub } from "@/features/chat/ComposerStub";
import { MessageList } from "@/features/chat/MessageList";
import { useChannel, useChannelServer } from "@/features/servers/store";
import { useTheme } from "@/theme";

/** A text channel, pushed over the tabs: header, history, composer. */
export default function ChannelScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ id: string; name?: string }>();
  const id = params.id;
  const channel = useChannel(id);
  const server = useChannelServer(id);
  const name = channel?.name ?? params.name ?? "channel";

  useFocusEffect(
    useCallback(() => {
      openChannel(id);
      return () => closeChannel(id);
    }, [id]),
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.ply0 }}>
      <ChannelHeader name={name} serverName={server?.name ?? null} />
      <MessageList channelId={id} name={name} />
      <ComposerStub name={name} />
    </View>
  );
}
