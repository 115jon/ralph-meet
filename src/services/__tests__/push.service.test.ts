import { afterEach, describe, expect, it, vi } from "vitest";

import { createMockD1 } from "@/lib/__tests__/mock-d1";
import type { FcmSendResult } from "@/server/fcm";

import {
  buildMessagePush,
  deletePushToken,
  sendMessagePushes,
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
    });

    db.assertCalledWith(
      /ON CONFLICT\(token\) DO UPDATE SET\s+user_id = excluded\.user_id/,
      [
        "id-1",
        "user-1",
        "tok",
        "android",
        "development",
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
    db.mockQuery("SELECT user_id, token FROM push_tokens", {
      results: [
        { user_id: "user-2", token: "live" },
        { user_id: "user-2", token: "dead" },
        { user_id: "user-2", token: "flaky" },
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
    db.assertCalledWith("SELECT user_id, token FROM push_tokens", ["user-2"]);
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
