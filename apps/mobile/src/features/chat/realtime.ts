import { useSession } from "@/features/auth/session";
import { eventDecoder } from "@/features/realtime/event-decoder";
import { onDispatch, onGatewayReady } from "@/features/realtime/gateway";
import { markRead, noteMessage, noteRead } from "@/features/servers/actions";

import {
  applyReaction,
  editMessage,
  loadLatest,
  receiveMessage,
  removeMessage,
  startTyping,
  stopTyping,
  type MessageEdit,
} from "./actions";
import {
  MessageEditSchema,
  MessageRefSchema,
  MessageSchema,
  ReactionEventSchema,
  TypingEventSchema,
} from "./schema";
import { useChatStore } from "./store";

const decodeMessage = eventDecoder(MessageSchema);
const decodeEdit = eventDecoder(MessageEditSchema);
const decodeRef = eventDecoder(MessageRefSchema);
const decodeReaction = eventDecoder(ReactionEventSchema);
const decodeTyping = eventDecoder(TypingEventSchema);

function myId(): string | undefined {
  return useSession.getState().user?.id;
}

function handle(event: string, data: unknown): void {
  switch (event) {
    case "MESSAGE_CREATE": {
      const message = decodeMessage(data);
      if (!message) return;
      receiveMessage(message);
      stopTyping(message.channel_id, message.author_id);
      noteMessage(message.channel_id, message.created_at);
      if (message.author_id === myId()) {
        // Sent from here or another device: never unread for its author.
        noteRead(message.channel_id, message.created_at);
      } else if (useChatStore.getState().openChannelId === message.channel_id) {
        markRead(message.channel_id);
      }
      return;
    }
    case "MESSAGE_UPDATE": {
      const edit = decodeEdit(data);
      if (!edit) return;
      const patch: MessageEdit = {};
      if (edit.content !== undefined) patch.content = edit.content;
      if (edit.updated_at !== undefined) patch.updated_at = edit.updated_at;
      if (edit.embeds !== undefined) patch.embeds = edit.embeds;
      editMessage(edit.id, patch);
      return;
    }
    case "MESSAGE_DELETE": {
      const ref = decodeRef(data);
      if (ref) removeMessage(ref.id);
      return;
    }
    case "REACTION_ADD":
    case "REACTION_REMOVE": {
      const d = decodeReaction(data);
      if (!d) return;
      const me = d.user_id === myId();
      applyReaction(
        d.message_id,
        d.emoji,
        d.user_id,
        me,
        event === "REACTION_ADD",
      );
      return;
    }
    case "TYPING_START": {
      const d = decodeTyping(data);
      if (d && d.user_id !== myId()) startTyping(d.channel_id, d.user_id);
      return;
    }
    default:
      return;
  }
}

/** Keeps the chat store live; returns the unsubscribe. */
export function startChatEvents(): () => void {
  const offDispatch = onDispatch(handle);
  // Events sent while the socket was down are gone: reload the open channel.
  const offReady = onGatewayReady(() => {
    const open = useChatStore.getState().openChannelId;
    if (open) void loadLatest(open);
  });
  return () => {
    offDispatch();
    offReady();
  };
}
