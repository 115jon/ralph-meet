import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiError: vi.fn((message: string, status: number) =>
    Response.json({ error: message }, { status }),
  ),
  apiSuccess: vi.fn((data: unknown, status = 200) =>
    Response.json(data, { status }),
  ),
  broadcastToChannel: vi.fn(),
  broadcastToServerMembers: vi.fn(),
  getBucket: vi.fn(),
  getDB: vi.fn(),
  getEnv: vi.fn(() => ({})),
  genId: vi.fn(),
  getUserChannelPermissions: vi.fn(),
  hasPermission: vi.fn(),
  requireAuth: vi.fn(),
  requireChannelAccess: vi.fn(),
  recordR2CleanupFailure: vi.fn(),
  retryR2Cleanup: vi.fn(),
  listMessages: vi.fn(),
  refreshMessageEmbeds: vi.fn(),
  recordMessagePostprocessingJob: vi.fn(),
  scheduleMessagePostprocessing: vi.fn(),
  scheduleR2Cleanup: vi.fn(),
}));

vi.mock("@/lib/api-helpers", () => ({
  apiError: mocks.apiError,
  apiSuccess: mocks.apiSuccess,
  broadcastToChannel: mocks.broadcastToChannel,
  broadcastToServerMembers: mocks.broadcastToServerMembers,
  broadcastToUser: vi.fn(),
  genId: mocks.genId,
  getBucket: mocks.getBucket,
  getDB: mocks.getDB,
  getEnv: mocks.getEnv,
  requireAuth: mocks.requireAuth,
}));

vi.mock("@/lib/require-channel-access", () => ({
  requireChannelAccess: mocks.requireChannelAccess,
}));

vi.mock("@/lib/require-permission", () => ({
  getUserChannelPermissions: mocks.getUserChannelPermissions,
}));

vi.mock("@/lib/permissions", () => ({
  PERMISSIONS: { MANAGE_MESSAGES: 1024 },
  hasPermission: mocks.hasPermission,
}));

vi.mock("@/services/r2-cleanup.service", () => ({
  recordR2CleanupFailure: mocks.recordR2CleanupFailure,
  retryR2Cleanup: mocks.retryR2Cleanup,
}));

vi.mock("@/lib/background-tasks", () => ({
  recordMessagePostprocessingJob: mocks.recordMessagePostprocessingJob,
  scheduleMessagePostprocessing: mocks.scheduleMessagePostprocessing,
  scheduleR2Cleanup: mocks.scheduleR2Cleanup,
}));

vi.mock("@/services/message.service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/message.service")>();
  return {
    ...actual,
    createMessage: vi.fn(),
    deleteMessage: vi.fn(),
    editMessage: vi.fn(),
    generateMessageNotifications: vi.fn(),
    getDMRecipients: vi.fn(),
    listMessages: mocks.listMessages,
    refreshMessageEmbeds: mocks.refreshMessageEmbeds,
  };
});

import { DELETE, GET, PATCH, POST } from "../channels/$id/messages";

describe("message history GET limit", () => {
  beforeEach(() => {
    mocks.apiError.mockClear();
    mocks.apiSuccess.mockClear();
    mocks.broadcastToServerMembers.mockReset();
    mocks.broadcastToChannel.mockReset();
    mocks.getBucket.mockReset();
    mocks.getDB.mockReset();
    mocks.getEnv.mockReset();
    mocks.getEnv.mockReturnValue({});
    mocks.genId.mockReset();
    mocks.genId.mockReturnValue("message-1");
    mocks.getUserChannelPermissions.mockReset();
    mocks.hasPermission.mockReset();
    mocks.requireAuth.mockReset();
    mocks.requireChannelAccess.mockReset();
    mocks.recordR2CleanupFailure.mockReset();
    mocks.retryR2Cleanup.mockReset();
    mocks.listMessages.mockReset();
    mocks.refreshMessageEmbeds.mockReset();
    mocks.scheduleMessagePostprocessing.mockReset();
    mocks.scheduleR2Cleanup.mockReset();
    mocks.requireAuth.mockResolvedValue({ userId: "user-1" });
    mocks.requireChannelAccess.mockResolvedValue({ serverId: "server-1" });
    mocks.getDB.mockReturnValue({});
    mocks.getUserChannelPermissions.mockResolvedValue(1024);
    mocks.hasPermission.mockReturnValue(true);
    mocks.retryR2Cleanup.mockResolvedValue(undefined);
    mocks.listMessages.mockResolvedValue({
      messages: [],
      hasMoreBefore: false,
      hasMoreAfter: false,
      mode: "latest",
    });
  });

  it("enqueues postprocessing after REST message creation without resolving embeds inline", async () => {
    const order: string[] = [];
    mocks.scheduleMessagePostprocessing.mockImplementation(() => {
      order.push("schedule");
    });
    mocks.broadcastToServerMembers.mockImplementation(async () => {
      order.push("broadcast");
    });
    const { createMessage } = await import("@/services/message.service");
    vi.mocked(createMessage).mockResolvedValue({
      id: "message-1",
      channel_id: "channel-1",
      author_id: "user-1",
      author: {
        id: "user-1",
        username: "author",
        display_name: null,
        avatar_url: null,
      },
      content: "https://example.test",
      reply_to_id: null,
      is_pinned: false,
      created_at: "2026-07-22T00:00:00.000Z",
      updated_at: null,
      attachments: [],
      reactions: [],
      reply_count: 0,
      content_revision: 1,
    });

    const response = await POST({
      request: new Request(
        "https://meet.test/api/channels/channel-1/messages",
        {
          method: "POST",
          body: JSON.stringify({ content: "https://example.test" }),
        },
      ),
      params: { id: "channel-1" },
    });

    expect(response.status).toBe(201);
    expect(
      mocks.scheduleMessagePostprocessing.mock.calls[0]?.slice(0, 2),
    ).toEqual([
      {},
      {
        messageId: "message-1",
        channelId: "channel-1",
        revision: 1,
        notify: true,
      },
    ]);
    expect(vi.mocked(createMessage)).toHaveBeenCalledOnce();
    expect(order).toEqual(["broadcast", "schedule"]);
  });

  it("enqueues the next content revision after a REST edit", async () => {
    const order: string[] = [];
    mocks.scheduleMessagePostprocessing.mockImplementation(() => {
      order.push("schedule");
    });
    mocks.broadcastToServerMembers.mockImplementation(async () => {
      order.push("broadcast");
    });
    const { editMessage } = await import("@/services/message.service");
    vi.mocked(editMessage).mockResolvedValue({
      id: "message-1",
      channel_id: "channel-1",
      content: "edited",
      updated_at: "2026-07-22T00:01:00.000Z",
      content_revision: 2,
    });

    const response = await PATCH({
      request: new Request(
        "https://meet.test/api/channels/channel-1/messages",
        {
          method: "PATCH",
          body: JSON.stringify({ message_id: "message-1", content: "edited" }),
        },
      ),
      params: { id: "channel-1" },
    });

    expect(response.status).toBe(200);
    expect(
      mocks.scheduleMessagePostprocessing.mock.calls[0]?.slice(0, 2),
    ).toEqual([
      {},
      {
        messageId: "message-1",
        channelId: "channel-1",
        revision: 2,
        notify: false,
      },
    ]);
    expect(order).toEqual(["broadcast", "schedule"]);
  });

  it.each([
    ["-10", 1],
    ["not-a-number", 50],
    ["101", 100],
  ])("passes a safe limit for %s", async (rawLimit, expectedLimit) => {
    const response = await GET({
      request: new Request(
        `https://meet.test/api/channels/channel-1/messages?limit=${rawLimit}`,
      ),
      params: { id: "channel-1" },
    });

    expect(response.status).toBe(200);
    expect(mocks.listMessages).toHaveBeenCalledWith(
      {},
      "channel-1",
      "user-1",
      expect.objectContaining({ limit: expectedLimit }),
    );
  });

  it("refreshes embed metadata without entering the message edit path", async () => {
    const embeds = [{ url: "https://cdn.test/video.mp4" }];
    mocks.refreshMessageEmbeds.mockResolvedValue([
      {
        id: "message-1",
        channel_id: "channel-1",
        content_revision: 3,
        embeds,
      },
    ]);

    const response = await PATCH({
      request: new Request(
        "https://meet.test/api/channels/channel-1/messages",
        {
          method: "PATCH",
          body: JSON.stringify({
            refresh_embeds: true,
            message_ids: ["message-1"],
          }),
        },
      ),
      params: { id: "channel-1" },
    });

    expect(response.status).toBe(200);
    expect(mocks.refreshMessageEmbeds).toHaveBeenCalledWith({}, "channel-1", [
      "message-1",
    ]);
    expect(mocks.broadcastToServerMembers).toHaveBeenCalledWith(
      "server-1",
      "MESSAGE_UPDATE",
      {
        id: "message-1",
        channel_id: "channel-1",
        content_revision: 3,
        embeds,
      },
    );
  });

  it("captures message attachment keys when R2 deletion fails", async () => {
    const fileKey = "attachments/channel-1/attachment-1/file.txt";
    const { deleteMessage } = await import("@/services/message.service");
    vi.mocked(deleteMessage).mockResolvedValue([fileKey]);
    const bucket = {
      delete: vi.fn().mockRejectedValue(new Error("R2 unavailable")),
    };
    mocks.getBucket.mockReturnValue(bucket);

    const response = await DELETE({
      request: new Request(
        "https://meet.test/api/channels/channel-1/messages",
        {
          method: "DELETE",
          body: JSON.stringify({ message_id: "message-1" }),
        },
      ),
      params: { id: "channel-1" },
    });

    expect(response.status).toBe(200);
    expect(bucket.delete).toHaveBeenCalledWith(fileKey);
    expect(mocks.recordR2CleanupFailure).toHaveBeenCalledWith(
      {},
      fileKey,
      expect.any(Error),
    );
    expect(mocks.scheduleR2Cleanup).toHaveBeenCalledWith(
      {},
      fileKey,
      undefined,
    );
    expect(mocks.retryR2Cleanup).not.toHaveBeenCalled();
  });

  it("schedules cleanup even when recording the outbox row fails", async () => {
    const fileKey = "attachments/channel-1/attachment-2/file.txt";
    const { deleteMessage } = await import("@/services/message.service");
    vi.mocked(deleteMessage).mockResolvedValue([fileKey]);
    mocks.getBucket.mockReturnValue({
      delete: vi.fn().mockRejectedValue(new Error("R2 unavailable")),
    });
    mocks.recordR2CleanupFailure.mockRejectedValue(new Error("D1 unavailable"));

    await DELETE({
      request: new Request(
        "https://meet.test/api/channels/channel-1/messages",
        {
          method: "DELETE",
          body: JSON.stringify({ message_id: "message-1" }),
        },
      ),
      params: { id: "channel-1" },
    });

    expect(mocks.scheduleR2Cleanup).toHaveBeenCalledWith(
      {},
      fileKey,
      undefined,
    );
  });
});
