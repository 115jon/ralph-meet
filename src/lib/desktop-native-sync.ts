import {
  getDesktopNotificationBadgeState,
  toDesktopNotificationSyncPayload,
} from "@/lib/desktop-notifications";
import { isTauri } from "@/lib/platform";
import type { Notification as AppNotification } from "@/lib/types";

interface NativeSyncInput {
  notifications: AppNotification[];
  unreadDmChannelIds: Iterable<string>;
  unreadServerChannelIds: Iterable<string>;
}

export async function syncDesktopNotificationState(input: NativeSyncInput) {
  if (!isTauri() || typeof window === "undefined" || !window.__TAURI_INTERNALS__) {
    return;
  }

  const badge = getDesktopNotificationBadgeState({
    notifications: input.notifications,
    unreadDmChannelIds: input.unreadDmChannelIds,
    unreadServerChannelIds: input.unreadServerChannelIds,
  });

  const payload = toDesktopNotificationSyncPayload(badge);
  await (window.__TAURI_INTERNALS__ as any).invoke("plugin:event|emit", {
    event: "update-desktop-notification-state",
    payload: JSON.stringify(payload),
  }).catch(() => {
    /* desktop notification sync unavailable */
  });
}
