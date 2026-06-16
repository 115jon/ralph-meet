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

export interface UnreadChannelState {
  unreadDmChannelIds: string[];
  unreadServerChannelIds: string[];
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
  return shouldNativeNotifyForChannelActivity({
    channelId: input.notification.channel_id,
    activeChannelId: input.activeChannelId,
    focused: input.focused,
    desktopNotificationsEnabled: input.desktopNotificationsEnabled,
  });
}

export function shouldNativeNotifyForChannelActivity(input: {
  channelId: string;
  activeChannelId: string | null;
  focused: boolean;
  desktopNotificationsEnabled: boolean;
}): boolean {
  if (!input.desktopNotificationsEnabled) return false;
  if (input.focused && input.channelId === input.activeChannelId) return false;
  return true;
}

export function getUnreadChannelState(input: {
  lastMessageAt: Record<string, string>;
  readStates: Record<string, string>;
  dmChannelIds: Iterable<string>;
}): UnreadChannelState {
  const unreadDmChannelIds: string[] = [];
  const unreadServerChannelIds: string[] = [];
  const dmChannelIdSet = new Set(input.dmChannelIds);

  for (const [channelId, lastMessageTimestamp] of Object.entries(input.lastMessageAt)) {
    if (!lastMessageTimestamp) continue;
    const lastReadTimestamp = input.readStates[channelId];
    if (lastReadTimestamp && lastMessageTimestamp <= lastReadTimestamp) continue;

    if (dmChannelIdSet.has(channelId)) {
      unreadDmChannelIds.push(channelId);
    } else {
      unreadServerChannelIds.push(channelId);
    }
  }

  return { unreadDmChannelIds, unreadServerChannelIds };
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
