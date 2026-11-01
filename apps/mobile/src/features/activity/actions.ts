import { fetchNotifications, markNotificationsRead } from "./api";
import type { Notification } from "./schema";
import { useActivityStore } from "./store";

const { getState, setState } = useActivityStore;

export async function loadActivity(): Promise<void> {
  if (getState().notifications.length === 0) setState({ status: "loading" });
  try {
    const { notifications } = await fetchNotifications();
    setState({ status: "ready", notifications });
  } catch {
    if (getState().notifications.length === 0) setState({ status: "error" });
  }
}

/** Marks rows read here at once and on the server after. */
export function markRead(ids: readonly string[]): void {
  if (ids.length === 0) return;
  noteRead(ids);
  markNotificationsRead({ ids }).catch(() => undefined);
}

export function markAllRead(): void {
  noteRead(null);
  markNotificationsRead({ all: true }).catch(() => undefined);
}

/** Opening a conversation reads what pointed at it, as the web does. */
export function markChannelRead(channelId: string): void {
  markRead(
    getState()
      .notifications.filter((n) => !n.is_read && n.channel_id === channelId)
      .map((n) => n.id),
  );
}

// ── Gateway events ─────────────────────────────────────────────────────────

export function addNotification(notification: Notification): void {
  setState((s) =>
    s.notifications.some((n) => n.id === notification.id)
      ? s
      : { notifications: [notification, ...s.notifications] },
  );
}

/** `ids` read, or every row when null. */
export function noteRead(ids: readonly string[] | null): void {
  setState((s) => ({
    notifications: s.notifications.map((n) =>
      n.is_read || (ids && !ids.includes(n.id)) ? n : { ...n, is_read: true },
    ),
  }));
}

export function clearBefore(clearedAt: string | undefined): void {
  setState((s) => ({
    notifications: clearedAt
      ? s.notifications.filter((n) => n.created_at > clearedAt)
      : [],
  }));
}
