import { create } from "zustand";

import type { LoadStatus } from "@/features/servers/store";

import type { Notification } from "./schema";

interface ActivityState {
  readonly status: LoadStatus;
  /** Newest first. */
  readonly notifications: readonly Notification[];
}

const INITIAL: ActivityState = { status: "loading", notifications: [] };

/** State only; the actions that change it live in ./actions. */
export const useActivityStore = create<ActivityState>()(() => INITIAL);

export function resetActivityStore(): void {
  useActivityStore.setState(INITIAL, true);
}

/** Mentions and replies count; DMs show on the DMs tab, as on the web. */
function counts(notification: Notification): boolean {
  return (
    !notification.is_read &&
    (notification.type === "mention" || notification.type === "reply")
  );
}

export function useUnreadActivityCount(): number {
  return useActivityStore((s) => s.notifications.filter(counts).length);
}

/** Unread notifications of any kind in one conversation: the DM row chip. */
export function useUnreadInChannel(channelId: string): number {
  return useActivityStore(
    (s) =>
      s.notifications.filter((n) => !n.is_read && n.channel_id === channelId)
        .length,
  );
}
