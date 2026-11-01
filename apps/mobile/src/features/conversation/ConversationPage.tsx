import { useIsFocused } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { startDmCall, takeCallBack } from "@/features/calls/actions";
import { CallConfirmSheet } from "@/features/calls/CallConfirmSheet";
import { DmCallRegion } from "@/features/calls/DmCallRegion";
import { useCallsStore, type CallPeer } from "@/features/calls/store";
import { useCallPreferences } from "@/features/preferences/call-preferences";
import { useVoiceStore } from "@/features/voice/store";
import { authorName } from "@/features/chat/authors";
import { ChatView } from "@/features/chat/ChatView";
import { loadDms } from "@/features/dms/actions";
import { useDm } from "@/features/dms/store";
import { FriendsPage } from "@/features/friends/FriendsPage";
import { loadMembers } from "@/features/members/actions";
import { useMemberAuthors } from "@/features/members/store";
import { openProfile } from "@/features/profile/store";
import { useChannel, useChannelServer } from "@/features/servers/store";
import { mediaUrl } from "@/lib/api";
import { useTheme } from "@/theme";
import { EmptyState } from "@/ui";

import {
  showDrawer,
  toggleMembers,
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
  const members = useMemberAuthors(serverId);
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
      onMembers={toggleMembers}
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

  const peer: CallPeer | null = useMemo(
    () =>
      recipient
        ? {
            id: recipient.id,
            name,
            avatarUrl: recipient.avatar_url ?? null,
          }
        : null,
    [recipient, name],
  );
  const [confirming, setConfirming] = useState(false);
  const inThisCall = useVoiceStore((s) => s.call?.channelId === id);
  const otherCall = useVoiceStore((s) =>
    s.call && s.call.channelId !== id ? s.call.channelName : null,
  );
  const ringingHere = useCallsStore((s) => s.outgoing?.channelId === id);
  const askCall = () => {
    if (!peer) return;
    // In another call it always asks: the call would drop that one.
    if (useCallPreferences.getState().skipCallConfirm && !otherCall) {
      startDmCall(id, peer);
    } else {
      setConfirming(true);
    }
  };
  // A missed call's "Call back" (row or notification) asks here too.
  const callBack = useCallsStore((s) => s.callBack === id);
  const closeConfirm = () => {
    setConfirming(false);
    takeCallBack(id);
  };

  return (
    <>
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
        // A DM's "members" are the two of you: its header opens the profile.
        onTitle={
          recipient ? () => openProfile(recipient.id, recipient) : undefined
        }
        onCall={peer ? askCall : undefined}
        callDisabled={inThisCall || ringingHere}
        banner={peer ? <DmCallRegion channelId={id} peer={peer} /> : null}
      />
      <CallConfirmSheet
        peer={confirming || callBack ? peer : null}
        leaving={otherCall}
        onCancel={closeConfirm}
        onCall={() => {
          closeConfirm();
          if (peer) startDmCall(id, peer);
        }}
      />
    </>
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
  switch (conversation.kind) {
    case "channel":
      return (
        <ChannelChat
          key={conversationKey(conversation)}
          id={conversation.id}
          hint={conversation.name}
        />
      );
    case "dm":
      return (
        <DmChat key={conversationKey(conversation)} id={conversation.id} />
      );
    case "friends":
      return <FriendsPage />;
  }
}
