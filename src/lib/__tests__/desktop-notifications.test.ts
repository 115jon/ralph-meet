import type { Notification as AppNotification } from "@/lib/types";
import {
  getDesktopNotificationBadgeState,
  shouldNativeNotifyForMessage,
  toDesktopNotificationSyncPayload,
} from "@/lib/desktop-notifications";
import { describe, expect, it } from "vitest";

function makeNotification(overrides: Partial<AppNotification> = {}): AppNotification {
  return {
    id: "notif-1",
    type: "mention",
    channel_id: "channel-1",
    server_id: "server-1",
    message_id: "message-1",
    from_user: { id: "user-2", username: "alice" },
    content: "hello",
    is_read: false,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("getDesktopNotificationBadgeState", () => {
  it("uses unread notifications as the numeric badge count", () => {
    const state = getDesktopNotificationBadgeState({
      notifications: [makeNotification(), makeNotification({ id: "notif-2", type: "dm" })],
    });

    expect(state.unreadCount).toBe(2);
    expect(state.indicatorCount).toBe(2);
    expect(state.showDot).toBe(false);
    expect(state.overlayLabel).toBe("2");
  });

  it("caps numeric badges at 99", () => {
    const notifications = Array.from({ length: 120 }, (_, index) =>
      makeNotification({ id: `notif-${index}` }),
    );

    const state = getDesktopNotificationBadgeState({ notifications });

    expect(state.unreadCount).toBe(120);
    expect(state.indicatorCount).toBe(99);
    expect(state.overlayLabel).toBe("99");
  });

  it("falls back to a dot when read-state unread exists without a notification inbox entry", () => {
    const state = getDesktopNotificationBadgeState({
      notifications: [],
      unreadServerChannelIds: ["channel-1"],
    });

    expect(state.unreadCount).toBe(0);
    expect(state.hasUnread).toBe(true);
    expect(state.showDot).toBe(true);
    expect(state.overlayLabel).toBe("dot");
  });

  it("returns a clear state when nothing is unread", () => {
    const state = getDesktopNotificationBadgeState({
      notifications: [makeNotification({ is_read: true })],
      unreadDmChannelIds: [],
      unreadServerChannelIds: [],
    });

    expect(state.hasUnread).toBe(false);
    expect(state.indicatorCount).toBe(0);
    expect(state.showDot).toBe(false);
    expect(state.overlayLabel).toBeNull();
  });
});

describe("shouldNativeNotifyForMessage", () => {
  it("does not notify when desktop notifications are disabled", () => {
    expect(
      shouldNativeNotifyForMessage({
        notification: makeNotification(),
        activeChannelId: "channel-1",
        focused: false,
        desktopNotificationsEnabled: false,
      }),
    ).toBe(false);
  });

  it("does not notify for the focused active channel", () => {
    expect(
      shouldNativeNotifyForMessage({
        notification: makeNotification(),
        activeChannelId: "channel-1",
        focused: true,
        desktopNotificationsEnabled: true,
      }),
    ).toBe(false);
  });

  it("still notifies for background channels even while focused", () => {
    expect(
      shouldNativeNotifyForMessage({
        notification: makeNotification(),
        activeChannelId: "channel-2",
        focused: true,
        desktopNotificationsEnabled: true,
      }),
    ).toBe(true);
  });

  it("notifies when the app is unfocused", () => {
    expect(
      shouldNativeNotifyForMessage({
        notification: makeNotification(),
        activeChannelId: "channel-1",
        focused: false,
        desktopNotificationsEnabled: true,
      }),
    ).toBe(true);
  });
});

describe("toDesktopNotificationSyncPayload", () => {
  it("maps numeric badge state to a native sync payload", () => {
    const payload = toDesktopNotificationSyncPayload(
      getDesktopNotificationBadgeState({ notifications: [makeNotification(), makeNotification({ id: "notif-2" })] }),
    );

    expect(payload).toEqual({
      count: 2,
      showDot: false,
      tooltip: "Ralph Meet - 2 unread notifications",
    });
  });

  it("maps dot-only unread state to a native sync payload", () => {
    const payload = toDesktopNotificationSyncPayload(
      getDesktopNotificationBadgeState({ notifications: [], unreadDmChannelIds: ["dm-1"] }),
    );

    expect(payload).toEqual({
      count: 0,
      showDot: true,
      tooltip: "Ralph Meet - unread activity",
    });
  });

  it("maps an empty state to a clear payload", () => {
    const payload = toDesktopNotificationSyncPayload(
      getDesktopNotificationBadgeState({ notifications: [] }),
    );

    expect(payload).toEqual({
      count: 0,
      showDot: false,
      tooltip: "Ralph Meet",
    });
  });
});
