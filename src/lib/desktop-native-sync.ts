// ── Native notification state ───────────────────────────────────────────────
// Turns the chat's unread state into the host's tray badge, and messages into
// native toasts. The host decides what that means: the desktop adapter draws
// the badge (only on change) and shows toasts; the web host does nothing.

import type { NotificationOptions } from "@tauri-apps/plugin-notification";
import {
  getDesktopNotificationBadgeState,
  toDesktopNotificationSyncPayload,
} from "@/lib/desktop-notifications";
import { getHost, MESSAGE_ACTION_TYPE_ID } from "@/lib/host";
import { useDesktopSettingsStore } from "@/stores/useDesktopSettingsStore";
import { clog } from "@/lib/console-logger";
import type { Notification as AppNotification } from "@/lib/types";

const log = clog("DesktopNotifications");

/** The action type id native toasts use for reply / mark read. */
export const MOBILE_ACTION_TYPE_ID = MESSAGE_ACTION_TYPE_ID;

interface NativeSyncInput {
  notifications: AppNotification[];
  unreadDmChannelIds: Iterable<string>;
  unreadServerChannelIds: Iterable<string>;
}

export async function syncDesktopNotificationState(input: NativeSyncInput) {
  const host = getHost();
  if (host.kind !== "desktop") return;

  if (!useDesktopSettingsStore.getState().desktopNotifications) {
    log.info("Clearing native desktop notification state");
    await host.notifications
      .setBadge({ count: 0, showDot: false, tooltip: "Ralph Meet" })
      .catch(() => {
        /* desktop badge clear unavailable */
      });
    return;
  }

  const payload = toDesktopNotificationSyncPayload(
    getDesktopNotificationBadgeState({
      notifications: input.notifications,
      unreadDmChannelIds: input.unreadDmChannelIds,
      unreadServerChannelIds: input.unreadServerChannelIds,
    }),
  );
  log.info("Syncing native desktop notification state", payload);
  await host.notifications.setBadge(payload).catch(() => {
    /* desktop notification sync unavailable */
  });
}

export async function showNativeDesktopToast(input: NotificationOptions) {
  await getHost().notifications.showToast(input);
}
