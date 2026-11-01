import { useIsFocused } from "expo-router";
import { useEffect, useMemo } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { loadMembers } from "@/features/chat/actions";
import { authorName } from "@/features/chat/authors";
import { ChatView } from "@/features/chat/ChatView";
import { useMembers } from "@/features/chat/store";
import { loadDms } from "@/features/dms/actions";
import { useDm } from "@/features/dms/store";
import { useChannel, useChannelServer } from "@/features/servers/store";
import { mediaUrl } from "@/lib/api";
import { useTheme } from "@/theme";
import { EmptyState } from "@/ui";

import {
  showDrawer,
  useConversation,
  useHomePage,
  type Conversation,
} from "./store";

/** The chat page is in front: home focused and the drawer closed. */
function useAttended(): boolean {
  const focused = useIsFocused();
  const page = useHomePage();
  return focused && page === "chat";
}

/** A server text channel. */
function ChannelChat({ id, hint }: { id: string; hint?: string }) {
  const channel = useChannel(id);
  const server = useChannelServer(id);
  const serverId = server?.id ?? null;
  const members = useMembers(serverId);
  const name = channel?.name ?? hint ?? "channel";
  const attended = useAttended();

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
      attended={attended}
      onOpenDrawer={showDrawer}
    />
  );
}

/** A direct message: the same ChatView as a channel. */
function DmChat({ id }: { id: string }) {
  const dm = useDm(id);
  const recipient = dm?.recipient;
  const name = recipient ? authorName(recipient) : "Direct message";
  const people = useMemo(() => (recipient ? [recipient] : []), [recipient]);
  const attended = useAttended();

  // Opened from a push or Activity before the list loaded: fetch it for the header.
  useEffect(() => {
    if (!dm) void loadDms();
  }, [dm]);

  return (
    <ChatView
      channelId={id}
      title={name}
      subtitle={recipient ? `@${recipient.username}` : "Direct message"}
      avatar={
        recipient ? { name, uri: mediaUrl(recipient.avatar_url) } : undefined
      }
      placeholder={`Message ${name}`}
      intro={`This is the start of your conversation with ${name}.`}
      people={people}
      attended={attended}
      onOpenDrawer={showDrawer}
    />
  );
}

/** Nothing open yet (a first launch): what the peek beside the drawer shows. */
function NoConversation() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        flex: 1,
        paddingTop: insets.top,
        justifyContent: "center",
        backgroundColor: theme.ply0,
      }}
    >
      <EmptyState
        title="Pick a conversation"
        description="Open a channel or a direct message from the list."
      />
    </View>
  );
}

function conversationKey(conversation: Conversation): string {
  return `${conversation.kind}:${conversation.id}`;
}

/**
 * The pager's chat page: the open conversation, remounted only when it
 * changes, so peeking at the drawer and coming back keeps it as it was.
 */
export function ConversationPage() {
  const conversation = useConversation();
  if (!conversation) return <NoConversation />;
  return conversation.kind === "channel" ? (
    <ChannelChat
      key={conversationKey(conversation)}
      id={conversation.id}
      hint={conversation.name}
    />
  ) : (
    <DmChat key={conversationKey(conversation)} id={conversation.id} />
  );
}
