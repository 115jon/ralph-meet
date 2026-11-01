import { useLocalSearchParams } from "expo-router";
import { useEffect, useMemo } from "react";

import { authorName } from "@/features/chat/authors";
import { ChatView } from "@/features/chat/ChatView";
import { loadDms } from "@/features/dms/actions";
import { useDm } from "@/features/dms/store";
import { mediaUrl } from "@/lib/api";

/** A direct message, pushed over the tabs; the same ChatView as a channel. */
export default function DmScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const dm = useDm(id);
  const recipient = dm?.recipient;
  const name = recipient ? authorName(recipient) : "Direct message";
  const people = useMemo(() => (recipient ? [recipient] : []), [recipient]);

  // Opened from Activity before the list loaded: fetch it for the header.
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
    />
  );
}
