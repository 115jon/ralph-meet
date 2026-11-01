import { afterEach, describe, expect, it, vi } from "vitest";

import { createMockD1 } from "@/lib/__tests__/mock-d1";
import type { FcmSendResult } from "@/server/fcm";

import {
  buildMessagePush,
  buildNativeMessagePush,
  deletePushToken,
  hasNotificationsSinceLastRead,
  sendMessagePushes,
  sendReadPushes,
  upsertPushToken,
  type MessagePush,
} from "../push.service";

const MENTION: MessagePush = {
  recipientId: "user-2",
  notificationId: "n-1",
  type: "mention",
  channelId: "chan-1",
  serverId: "srv-1",
  messageId: "msg-1",
  senderName: "Ada",
  channelName: "general",
  serverName: "Ralph",
  content: "hey   @bob\n\nlook at this",
  senderId: "user-9",
  senderAvatarUrl: "/api/avatars/user-9",
  sentAt: "2026-11-01T10:00:00.000Z",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildMessagePush", () => {
  it("names the sender and the channel, and tags per conversation", () => {
    expect(buildMessagePush(MENTION)).toEqual({
      notification: {
        title: "Ada (#general, Ralph)",
        body: "hey @bob look at this",
      },
      data: {
        type: "mention",
        channelId: "chan-1",
        messageId: "msg-1",
        notificationId: "n-1",
        tag: "channel:chan-1",
        serverId: "srv-1",
      },
      android: {
        priority: "HIGH",
        notification: { channel_id: "messages", tag: "channel:chan-1" },
      },
    });
  });

  it("titles a DM with the sender only and leaves serverId out", () => {
    const push = buildMessagePush({
      ...MENTION,
      type: "dm",
      serverId: null,
      channelName: null,
      serverName: null,
      content: "",
    });

    expect(push.notification).toEqual({
      title: "Ada",
      body: "Sent an attachment",
    });
    expect(push.data).not.toHaveProperty("serverId");
  });

  it("trims a long preview with an ellipsis", () => {
    const { body } = buildMessagePush({
      ...MENTION,
      content: "a".repeat(500),
    }).notification;

    expect(body).toHaveLength(180);
    expect(body.endsWith("…")).toBe(true);
  });
});

describe("push tokens", () => {
  it("upserts by token, re-owning it to the caller", async () => {
    const db = createMockD1();

    await upsertPushToken(db as never, "user-1", "id-1", {
      token: "tok",
      platform: "android",
      appVariant: "development",
      pushFormat: "native",
    });

    db.assertCalledWith(
      /ON CONFLICT\(token\) DO UPDATE SET\s+user_id = excluded\.user_id/,
      [
        "id-1",
        "user-1",
        "tok",
        "android",
        "development",
        "native",
        expect.any(String),
        expect.any(String),
      ],
    );
  });

  it("deletes only the caller's own token", async () => {
    const db = createMockD1();

    await deletePushToken(db as never, "user-1", "tok");

    db.assertCalledWith(
      "DELETE FROM push_tokens WHERE token = ? AND user_id = ?",
      ["tok", "user-1"],
    );
  });
});

describe("sendMessagePushes", () => {
  function senderAnswering(answer: (token: string) => FcmSendResult) {
    return { send: vi.fn(async (token: string) => answer(token)) };
  }

  it("sends to every device of the recipient and deletes dead tokens", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const db = createMockD1();
    db.mockQuery("FROM push_tokens t", {
      results: [
        { user_id: "user-2", token: "live", push_format: null },
        { user_id: "user-2", token: "dead", push_format: null },
        { user_id: "user-2", token: "flaky", push_format: null },
      ],
    });
    const sender = senderAnswering((token) => {
      if (token === "dead") return { ok: false, status: 404, staleToken: true };
      if (token === "flaky") {
        return { ok: false, status: 503, staleToken: false };
      }
      return { ok: true };
    });

    await sendMessagePushes(db as never, sender, [MENTION]);

    expect(sender.send.mock.calls.map(([token]) => token).sort()).toEqual([
      "dead",
      "flaky",
      "live",
    ]);
    db.assertCalledWith("FROM push_tokens t", ["user-2"]);
    db.assertCalledWith("DELETE FROM push_tokens WHERE token = ?", ["dead"]);
    expect(db.getCalls("DELETE FROM push_tokens")).toHaveLength(1);
  });

  it("does nothing without a sender and never throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const db = createMockD1();

    await sendMessagePushes(db as never, null, [MENTION]);
    expect(db.calls).toHaveLength(0);

    const broken = {
      prepare: () => {
        throw new Error("D1 down");
      },
    };
    await expect(
      sendMessagePushes(
        broken as never,
        senderAnswering(() => ({ ok: true })),
        [MENTION],
      ),
    ).resolves.toBeUndefined();
  });
});

describe("buildNativeMessagePush", () => {
  it("is data-only with the native contract for a channel mention", () => {
    const message = buildNativeMessagePush(MENTION);

    expect(message).not.toHaveProperty("notification");
    expect(message.android).toEqual({ priority: "HIGH", ttl: "86400s" });
    expect(message.data).toEqual({
      ralph: "2",
      kind: "message",
      type: "mention",
      channelId: "chan-1",
      messageId: "msg-1",
      notificationId: "n-1",
      serverId: "srv-1",
      tag: "channel:chan-1",
      senderId: "user-9",
      senderName: "Ada",
      senderAvatar: "/api/avatars/user-9",
      conversation: "#general",
      serverName: "Ralph",
      preview: "hey @bob look at this",
      sentAt: "2026-11-01T10:00:00.000Z",
    });
  });

  it("leaves out server, conversation and avatar for a DM without one", () => {
    const { data } = buildNativeMessagePush({
      ...MENTION,
      type: "dm",
      serverId: null,
      channelName: null,
      serverName: null,
      senderAvatarUrl: null,
      content: "",
    });

    expect(data.type).toBe("dm");
    expect(data.preview).toBe("Sent an attachment");
    for (const key of [
      "serverId",
      "conversation",
      "serverName",
      "senderAvatar",
    ]) {
      expect(data).not.toHaveProperty(key);
    }
  });
});

describe("sendMessagePushes formats", () => {
  it("sends native tokens data-only and legacy tokens the system push", async () => {
    const db = createMockD1();
    db.mockQuery("FROM push_tokens t", {
      results: [
        { user_id: "user-2", token: "new", push_format: "native" },
        { user_id: "user-2", token: "old", push_format: null },
      ],
    });
    const send = vi.fn(async (): Promise<FcmSendResult> => ({ ok: true }));

    await sendMessagePushes(db as never, { send }, [MENTION]);

    expect(send).toHaveBeenCalledWith("new", buildNativeMessagePush(MENTION));
    expect(send).toHaveBeenCalledWith("old", buildMessagePush(MENTION));
  });

  it("asks only for recipients who are not on Do Not Disturb", async () => {
    const db = createMockD1();
    const send = vi.fn(async (): Promise<FcmSendResult> => ({ ok: true }));

    await sendMessagePushes(db as never, { send }, [MENTION]);

    // A DND user's tokens are filtered out in SQL, so none come back.
    expect(send).not.toHaveBeenCalled();
    const [call] = db.getCalls("FROM push_tokens t");
    expect(call.sql).toMatch(/COALESCE\(u\.status, 'online'\) != 'dnd'/);
  });
});

describe("sendReadPushes", () => {
  const ok = async (): Promise<FcmSendResult> => ({ ok: true });

  it("sends a data-only read push to native tokens only", async () => {
    const db = createMockD1();
    db.mockQuery("FROM push_tokens", { results: [{ token: "new" }] });
    const send = vi.fn(ok);

    await sendReadPushes(
      db as never,
      { send },
      "read-user-1",
      "chan-1",
      "2026-11-01T10:00:00.000Z",
      1_000,
    );

    db.assertCalledWith(/push_format = 'native'/, ["read-user-1"]);
    expect(send).toHaveBeenCalledWith("new", {
      data: {
        ralph: "2",
        kind: "read",
        channelId: "chan-1",
        readAt: "2026-11-01T10:00:00.000Z",
      },
      android: { priority: "NORMAL", ttl: "3600s" },
    });
  });

  it("sends once per user and channel per 10 seconds", async () => {
    const db = createMockD1();
    db.mockQuery("FROM push_tokens", { results: [{ token: "new" }] });
    const send = vi.fn(ok);
    const read = (channel: string, at: number) =>
      sendReadPushes(db as never, { send }, "read-user-2", channel, "t", at);

    await read("chan-1", 50_000);
    await read("chan-1", 59_999);
    await read("chan-2", 59_999);
    await read("chan-1", 60_000);

    expect(send).toHaveBeenCalledTimes(3);
  });

  it("deletes dead tokens and never throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const db = createMockD1();
    db.mockQuery("FROM push_tokens", { results: [{ token: "dead" }] });

    await sendReadPushes(
      db as never,
      { send: async () => ({ ok: false, status: 404, staleToken: true }) },
      "read-user-3",
      "chan-1",
      "t",
      1_000,
    );
    db.assertCalledWith("DELETE FROM push_tokens WHERE token = ?", ["dead"]);

    const broken = {
      prepare: () => {
        throw new Error("D1 down");
      },
    };
    await expect(
      sendReadPushes(
        broken as never,
        { send: ok },
        "read-user-4",
        "chan-1",
        "t",
        1_000,
      ),
    ).resolves.toBeUndefined();
    await expect(
      sendReadPushes(db as never, null, "u", "c", "t"),
    ).resolves.toBeUndefined();
  });
});

describe("hasNotificationsSinceLastRead", () => {
  it("compares with julianday, so both timestamp formats work", async () => {
    const db = createMockD1();
    db.mockQuery("FROM notifications", { found: 1 });

    await expect(
      hasNotificationsSinceLastRead(db as never, "user-1", "chan-1"),
    ).resolves.toBe(true);

    db.assertCalledWith(/julianday\(created_at\) > COALESCE/, [
      "user-1",
      "chan-1",
      "user-1",
      "chan-1",
    ]);
  });

  it("is false when nothing is newer than the last read", async () => {
    const db = createMockD1();
    db.mockQuery("FROM notifications", null);

    await expect(
      hasNotificationsSinceLastRead(db as never, "user-1", "chan-1"),
    ).resolves.toBe(false);
  });
});
