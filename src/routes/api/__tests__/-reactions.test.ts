import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiError: vi.fn((message: string, status: number) =>
    Response.json({ error: message }, { status }),
  ),
  apiSuccess: vi.fn((data: unknown, status = 200) =>
    Response.json(data, { status }),
  ),
  addReaction: vi.fn(),
  checkRateLimit: vi.fn(),
  executeBroadcast: vi.fn(),
  getDB: vi.fn(),
  getUserChannelPermissions: vi.fn(),
  removeReaction: vi.fn(),
  requireAuth: vi.fn(),
  requireChannelAccess: vi.fn(),
}));

vi.mock("@/lib/api-helpers", () => ({
  apiError: mocks.apiError,
  apiSuccess: mocks.apiSuccess,
  getDB: mocks.getDB,
  requireAuth: mocks.requireAuth,
}));

vi.mock("@/lib/permissions", () => ({
  PERMISSIONS: {
    ADD_REACTIONS: 2048,
    MANAGE_MESSAGES: 1024,
  },
  hasPermission: (permissions: number, required: number) =>
    (permissions & required) === required,
}));

vi.mock("@/lib/rate-limit", () => ({
  RATE_LIMITS: { REACTION: "reaction" },
  checkRateLimit: mocks.checkRateLimit,
}));

vi.mock("@/lib/require-channel-access", () => ({
  requireChannelAccess: mocks.requireChannelAccess,
}));

vi.mock("@/lib/require-permission", () => ({
  getUserChannelPermissions: mocks.getUserChannelPermissions,
}));

vi.mock("@/services/message.service", () => ({
  addReaction: mocks.addReaction,
  removeReaction: mocks.removeReaction,
}));

vi.mock("@/services/service-helpers", () => ({
  executeBroadcast: mocks.executeBroadcast,
}));

import { DELETE } from "../channels/$id/reactions";

const MESSAGE_ID = "550e8400-e29b-41d4-a716-446655440000";

function request(body: Record<string, string>) {
  return new Request("https://meet.test/api/channels/channel-1/reactions", {
    method: "DELETE",
    body: JSON.stringify({ message_id: MESSAGE_ID, emoji: "✅", ...body }),
  });
}

describe("reaction removal authorization", () => {
  beforeEach(() => {
    mocks.apiError.mockClear();
    mocks.apiSuccess.mockClear();
    mocks.addReaction.mockReset();
    mocks.checkRateLimit.mockReset();
    mocks.checkRateLimit.mockReturnValue(null);
    mocks.executeBroadcast.mockReset();
    mocks.getDB.mockReset();
    mocks.getUserChannelPermissions.mockReset();
    mocks.removeReaction.mockReset();
    mocks.removeReaction.mockResolvedValue({
      broadcast: {
        type: "channel",
        target: "channel-1",
        event: "REACTION_REMOVE",
      },
    });
    mocks.requireAuth.mockReset();
    mocks.requireAuth.mockResolvedValue({ userId: "user-1" });
    mocks.requireChannelAccess.mockReset();
    mocks.requireChannelAccess.mockResolvedValue({ serverId: "server-1" });
    mocks.getUserChannelPermissions.mockResolvedValue(2048);
    mocks.getDB.mockReturnValue({});
  });

  it("allows a user to remove their own reaction with add-reactions permission", async () => {
    const response = await DELETE({
      request: request({}),
      params: { id: "channel-1" },
    });

    expect(response.status).toBe(200);
    expect(mocks.removeReaction).toHaveBeenCalledWith(
      {},
      "channel-1",
      "user-1",
      MESSAGE_ID,
      "✅",
    );
  });

  it("rejects a non-manager removing another user's reaction", async () => {
    const response = await DELETE({
      request: request({ target_user_id: "user-2" }),
      params: { id: "channel-1" },
    });

    expect(response.status).toBe(403);
    expect(mocks.removeReaction).not.toHaveBeenCalled();
  });

  it("allows a message manager to remove another user's reaction", async () => {
    mocks.getUserChannelPermissions.mockResolvedValue(1024);

    const response = await DELETE({
      request: request({ target_user_id: "user-2" }),
      params: { id: "channel-1" },
    });

    expect(response.status).toBe(200);
    expect(mocks.removeReaction).toHaveBeenCalledWith(
      {},
      "channel-1",
      "user-2",
      MESSAGE_ID,
      "✅",
    );
  });

  it("does not broadcast when the reaction service reports no deletion", async () => {
    mocks.removeReaction.mockResolvedValue({});

    const response = await DELETE({
      request: request({}),
      params: { id: "channel-1" },
    });

    expect(response.status).toBe(200);
    expect(mocks.executeBroadcast).not.toHaveBeenCalled();
  });

  it("does not allow targeting another user in a DM", async () => {
    mocks.requireChannelAccess.mockResolvedValue({ serverId: null });

    const response = await DELETE({
      request: request({ target_user_id: "user-2" }),
      params: { id: "channel-1" },
    });

    expect(response.status).toBe(403);
    expect(mocks.removeReaction).not.toHaveBeenCalled();
  });
});
