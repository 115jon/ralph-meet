import type { Notification as AppNotification } from "@/lib/types";

export function getUnreadNotificationIdsForMessage(
  notifications: AppNotification[],
  messageId: string,
  channelId?: string | null
): string[] {
  return notifications
    .filter((notification) => !notification.is_read)
    .filter((notification) => notification.message_id === messageId)
    .filter((notification) => channelId == null || notification.channel_id === channelId)
    .map((notification) => notification.id);
}
