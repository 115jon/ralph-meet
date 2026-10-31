import { eventDecoder } from "@/features/realtime/event-decoder";
import { onDispatch, onGatewayReady } from "@/features/realtime/gateway";
import { markRead, noteMessage } from "@/features/servers/actions";

import {
  deleteMessage,
  editMessage,
  loadLatest,
  receiveMessage,
  type MessageEdit,
} from "./actions";
import { MessageEditSchema, MessageRefSchema, MessageSchema } from "./schema";
import { useChatStore } from "./store";

const decodeMessage = eventDecoder(MessageSchema);
const decodeEdit = eventDecoder(MessageEditSchema);
const decodeRef = eventDecoder(MessageRefSchema);

function handle(event: string, data: unknown): void {
  switch (event) {
    case "MESSAGE_CREATE": {
      const message = decodeMessage(data);
      if (!message) return;
      receiveMessage(message);
      noteMessage(message.channel_id, message.created_at);
      if (useChatStore.getState().openChannelId === message.channel_id) {
        markRead(message.channel_id);
      }
      return;
    }
    case "MESSAGE_UPDATE": {
      const edit = decodeEdit(data);
      if (!edit) return;
      const patch: MessageEdit = {};
      if (edit.content !== undefined) patch.content = edit.content;
      if (edit.embeds !== undefined) patch.embeds = edit.embeds;
      editMessage(edit.id, patch);
      return;
    }
    case "MESSAGE_DELETE": {
      const ref = decodeRef(data);
      if (ref) deleteMessage(ref.id);
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
