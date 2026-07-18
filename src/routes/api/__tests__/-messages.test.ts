import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiError: vi.fn((message: string, status: number) =>
    Response.json({ error: message }, { status }),
  ),
  apiSuccess: vi.fn((data: unknown) => Response.json(data)),
  broadcastToServerMembers: vi.fn(),
  getDB: vi.fn(),
  requireAuth: vi.fn(),
  requireChannelAccess: vi.fn(),
  listMessages: vi.fn(),
  refreshMessageEmbeds: vi.fn(),
}));

vi.mock("@/lib/api-helpers", () => ({
  apiError: mocks.apiError,
  apiSuccess: mocks.apiSuccess,
  broadcastToChannel: vi.fn(),
  broadcastToServerMembers: mocks.broadcastToServerMembers,
  broadcastToUser: vi.fn(),
  genId: vi.fn(),
  getDB: mocks.getDB,
  requireAuth: mocks.requireAuth,
}));

vi.mock("@/lib/require-channel-access", () => ({
  requireChannelAccess: mocks.requireChannelAccess,
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

import { GET, PATCH } from "../channels/$id/messages";

describe("message history GET limit", () => {
  beforeEach(() => {
    mocks.apiError.mockClear();
    mocks.apiSuccess.mockClear();
    mocks.broadcastToServerMembers.mockReset();
    mocks.getDB.mockReset();
    mocks.requireAuth.mockReset();
    mocks.requireChannelAccess.mockReset();
    mocks.listMessages.mockReset();
    mocks.refreshMessageEmbeds.mockReset();
    mocks.requireAuth.mockResolvedValue({ userId: "user-1" });
    mocks.requireChannelAccess.mockResolvedValue({ serverId: "server-1" });
    mocks.getDB.mockReturnValue({});
    mocks.listMessages.mockResolvedValue({
      messages: [],
      hasMoreBefore: false,
      hasMoreAfter: false,
      mode: "latest",
    });
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
      { id: "message-1", channel_id: "channel-1", embeds },
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
      { id: "message-1", channel_id: "channel-1", embeds },
    );
  });
});
