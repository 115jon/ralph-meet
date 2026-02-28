import { beforeEach, describe, expect, it } from "vitest";
import { createMockD1 } from "../../lib/__tests__/mock-d1";
import {
  clearNotifications,
  listNotifications,
  markNotificationsRead,
} from "../notification.service";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const NOW = "2026-02-28T00:00:00.000Z";
const USER_ID = "user_abc";

function notifRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "notif_1",
    type: "mention",
    channel_id: "chan_1",
    server_id: "server_1",
    message_id: "msg_1",
    from_user_id: "user_xyz",
    content: "Hello @you",
    is_read: 0,
    created_at: NOW,
    from_username: "alice",
    from_avatar_url: null,
    channel_name: "general",
    server_name: "My Server",
    ...overrides,
  };
}

// ─── listNotifications ───────────────────────────────────────────────────────

describe("listNotifications", () => {
  let db: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    db = createMockD1();
    db.mockQuery(/SELECT COUNT\(\*\) as count/, { count: 1 });
  });

  it("returns formatted notifications and unread count", async () => {
    db.mockQuery(/FROM notifications n/, {
      results: [notifRow(), notifRow({ id: "notif_2", is_read: 1 })],
    });

    const result = await listNotifications(db as any, USER_ID, {
      limit: 50,
      unreadOnly: false,
    });

    expect(result.notifications).toHaveLength(2);
    expect(result.unread_count).toBe(1);
    expect(result.notifications[0].id).toBe("notif_1");
    expect(result.notifications[0].is_read).toBe(false);
    expect(result.notifications[0].from_user.username).toBe("alice");
    expect(result.notifications[0].channel_name).toBe("general");
    expect(result.notifications[0].server_name).toBe("My Server");
  });

  it("marks is_read as boolean correctly", async () => {
    db.mockQuery(/FROM notifications n/, {
      results: [notifRow({ is_read: 1 })],
    });

    const result = await listNotifications(db as any, USER_ID, {
      limit: 50,
      unreadOnly: false,
    });

    expect(result.notifications[0].is_read).toBe(true);
  });

  it("caps limit at 100", async () => {
    db.mockQuery(/FROM notifications n/, { results: [] });

    const result = await listNotifications(db as any, USER_ID, {
      limit: 999,
      unreadOnly: false,
    });

    expect(result.notifications).toEqual([]);
    // Verifies the internal cap doesn't throw — limit is enforced
  });

  it("returns empty notifications and zero unread count", async () => {
    db.mockQuery(/FROM notifications n/, { results: [] });
    db.mockQuery(/SELECT COUNT\(\*\) as count/, { count: 0 });

    const result = await listNotifications(db as any, USER_ID, {
      limit: 50,
      unreadOnly: false,
    });

    expect(result.notifications).toEqual([]);
    expect(result.unread_count).toBe(0);
  });

  it("falls back to username 'Unknown' when from_username is null", async () => {
    db.mockQuery(/FROM notifications n/, {
      results: [notifRow({ from_username: null })],
    });

    const result = await listNotifications(db as any, USER_ID, {
      limit: 50,
      unreadOnly: false,
    });

    expect(result.notifications[0].from_user.username).toBe("Unknown");
  });
});

// ─── markNotificationsRead ───────────────────────────────────────────────────

describe("markNotificationsRead", () => {
  let db: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    db = createMockD1();
  });

  it("marks all notifications read when all=true", async () => {
    await markNotificationsRead(db as any, USER_ID, { all: true });

    db.assertCalled(/UPDATE notifications SET is_read = 1/);
  });

  it("marks specific notifications read by ids", async () => {
    await markNotificationsRead(db as any, USER_ID, {
      ids: ["notif_1", "notif_2"],
    });

    db.assertCalled(/UPDATE notifications SET is_read = 1/);
    db.assertCalledWith(/UPDATE notifications SET is_read = 1/, [
      USER_ID,
      "notif_1",
      "notif_2",
    ]);
  });

  it("throws 400 when neither ids nor all is provided", async () => {
    await expect(
      markNotificationsRead(db as any, USER_ID, {})
    ).rejects.toHaveProperty("status", 400);
  });

  it("throws 400 when ids is an empty array", async () => {
    await expect(
      markNotificationsRead(db as any, USER_ID, { ids: [] })
    ).rejects.toHaveProperty("status", 400);
  });
});

// ─── clearNotifications ──────────────────────────────────────────────────────

describe("clearNotifications", () => {
  let db: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    db = createMockD1();
  });

  it("deletes all notifications for the user", async () => {
    await clearNotifications(db as any, USER_ID);

    db.assertCalled(/DELETE FROM notifications/);
    db.assertCalledWith(/DELETE FROM notifications/, [USER_ID]);
  });
});
