import type { Notification as AppNotification } from "@/lib/types";

export interface DesktopNotificationBadgeState {
  unreadCount: number;
  indicatorCount: number;
  hasUnread: boolean;
  showDot: boolean;
  overlayLabel: string | null;
}

export interface DesktopNotificationSyncPayload {
  count: number;
  showDot: boolean;
  tooltip: string;
}

const MAX_BADGE_COUNT = 99;

export function getDesktopNotificationBadgeState(input: {
  notifications: AppNotification[];
  unreadDmChannelIds?: Iterable<string>;
  unreadServerChannelIds?: Iterable<string>;
}): DesktopNotificationBadgeState {
  const unreadNotifications = input.notifications.filter((notification) => !notification.is_read);
  const unreadNotificationCount = unreadNotifications.length;
  const unreadDmSet = new Set(input.unreadDmChannelIds ?? []);
  const unreadServerSet = new Set(input.unreadServerChannelIds ?? []);

  const hasUnread = unreadNotificationCount > 0 || unreadDmSet.size > 0 || unreadServerSet.size > 0;
  const indicatorCount = unreadNotificationCount > 0 ? Math.min(unreadNotificationCount, MAX_BADGE_COUNT) : 0;
  const showDot = hasUnread && indicatorCount === 0;

  return {
    unreadCount: unreadNotificationCount,
    indicatorCount,
    hasUnread,
    showDot,
    overlayLabel: indicatorCount > 0 ? String(indicatorCount) : showDot ? "dot" : null,
  };
}

export function shouldNativeNotifyForMessage(input: {
  notification: AppNotification;
  activeChannelId: string | null;
  focused: boolean;
  desktopNotificationsEnabled: boolean;
}): boolean {
  if (!input.desktopNotificationsEnabled) return false;
  if (input.focused && input.notification.channel_id === input.activeChannelId) return false;
  return true;
}

export function toDesktopNotificationSyncPayload(
  badge: DesktopNotificationBadgeState,
): DesktopNotificationSyncPayload {
  return {
    count: badge.indicatorCount,
    showDot: badge.showDot,
    tooltip: badge.hasUnread
      ? badge.indicatorCount > 0
        ? `Ralph Meet - ${badge.unreadCount} unread notifications`
        : "Ralph Meet - unread activity"
      : "Ralph Meet",
  };
}
