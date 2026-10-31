import { eventDecoder } from "@/features/realtime/event-decoder";
import { onDispatch, onGatewayReady } from "@/features/realtime/gateway";

import {
  addNotification,
  clearBefore,
  loadActivity,
  noteRead,
} from "./actions";
import {
  ClearEventSchema,
  NotificationSchema,
  ReadEventSchema,
} from "./schema";

const decodeNotification = eventDecoder(NotificationSchema);
const decodeRead = eventDecoder(ReadEventSchema);
const decodeClear = eventDecoder(ClearEventSchema);

function handle(event: string, data: unknown): void {
  switch (event) {
    case "NOTIFICATION_CREATE": {
      const notification = decodeNotification(data);
      if (notification) addNotification(notification);
      return;
    }
    case "NOTIFICATIONS_READ": {
      const d = decodeRead(data);
      if (d) noteRead(d.all ? null : (d.ids ?? []));
      return;
    }
    case "NOTIFICATIONS_CLEAR": {
      const d = decodeClear(data);
      if (d) clearBefore(d.cleared_at);
      return;
    }
    default:
      return;
  }
}

/** Keeps the Activity feed live; returns the unsubscribe. */
export function startActivityEvents(): () => void {
  const offDispatch = onDispatch(handle);
  const offReady = onGatewayReady(() => void loadActivity());
  return () => {
    offDispatch();
    offReady();
  };
}
