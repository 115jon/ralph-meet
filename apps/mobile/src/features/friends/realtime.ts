import { eventDecoder } from "@/features/realtime/event-decoder";
import { onDispatch, onGatewayReady } from "@/features/realtime/gateway";

import { dropRelationship, loadFriends, upsertRelationship } from "./actions";
import { RelationshipRemoveEvent, RelationshipSchema } from "./schema";

const decodeAdd = eventDecoder(RelationshipSchema);
const decodeRemove = eventDecoder(RelationshipRemoveEvent);

function handle(event: string, data: unknown): void {
  switch (event) {
    // A request in either direction, an accept, or a block.
    case "RELATIONSHIP_ADD": {
      const d = decodeAdd(data);
      if (d) upsertRelationship(d);
      return;
    }
    // Removed, ignored, cancelled, unblocked, or they blocked you.
    case "RELATIONSHIP_REMOVE": {
      const d = decodeRemove(data);
      if (d) dropRelationship(d.user_id);
      return;
    }
    default:
      return;
  }
}

/** Keeps friends and requests live; returns the unsubscribe. */
export function startFriendEvents(): () => void {
  const offDispatch = onDispatch(handle);
  // The first Ready loads the list (the pending count); later ones catch up.
  const offReady = onGatewayReady(() => void loadFriends());
  return () => {
    offDispatch();
    offReady();
  };
}
