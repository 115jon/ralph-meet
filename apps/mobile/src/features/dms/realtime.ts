import { Schema } from "effect";

import { MessageSchema } from "@/features/chat/schema";
import { eventDecoder } from "@/features/realtime/event-decoder";
import { onDispatch, onGatewayReady } from "@/features/realtime/gateway";

import {
  loadDms,
  notePreview,
  refreshPreviewFor,
  setPresence,
} from "./actions";
import { PresenceEventSchema } from "./schema";

const decodeMessage = eventDecoder(MessageSchema);
const decodeRef = eventDecoder(Schema.Struct({ id: Schema.String }));
const decodePresence = eventDecoder(PresenceEventSchema);

function handle(event: string, data: unknown): void {
  switch (event) {
    case "MESSAGE_CREATE": {
      const message = decodeMessage(data);
      if (message) notePreview(message);
      return;
    }
    case "MESSAGE_UPDATE":
    case "MESSAGE_DELETE": {
      const ref = decodeRef(data);
      if (ref) refreshPreviewFor(ref.id);
      return;
    }
    case "DM_CHANNEL_CREATE":
      void loadDms();
      return;
    case "PRESENCE_UPDATE": {
      const d = decodePresence(data);
      if (d) setPresence(d.user_id, d.status);
      return;
    }
    default:
      return;
  }
}

/** Keeps the DM list live; returns the unsubscribe. */
export function startDmEvents(): () => void {
  const offDispatch = onDispatch(handle);
  // The first Ready loads the list (for the tab badge); later ones catch up.
  const offReady = onGatewayReady(() => void loadDms());
  return () => {
    offDispatch();
    offReady();
  };
}
