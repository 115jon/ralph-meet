import { beforeEach, describe, expect, it, vi } from "vitest";

// The pin route's body checks, through the real PUT handler: a body of the
// wrong type or without a message id is a 400 that never reaches the database
// or the pin service, and a valid body pins exactly the requested message.

const mocks = vi.hoisted(() => ({
  broadcastToChannel: vi.fn(),
  broadcastToServerMembers: vi.fn(),
  executeBroadcast: vi.fn(),
  first: vi.fn(),
  getDB: vi.fn(),
  pinMessage: vi.fn(),
  prepare: vi.fn(),
  requireAuth: vi.fn(),
  requirePermission: vi.fn(),
  unpinMessage: vi.fn(),
}));

vi.mock("@/lib/api-helpers", () => ({
  apiError: (message: string, status: number, code?: string) =>
    Response.json({ error: message, code }, { status }),
  apiSuccess: (data: unknown, status = 200) => Response.json(data, { status }),
  broadcastToChannel: mocks.broadcastToChannel,
  broadcastToServerMembers: mocks.broadcastToServerMembers,
  getDB: mocks.getDB,
  requireAuth: mocks.requireAuth,
}));
vi.mock("@/lib/require-channel-access", () => ({
  requireChannelAccess: vi.fn(),
}));
vi.mock("@/lib/require-permission", () => ({
  requirePermission: mocks.requirePermission,
}));
vi.mock("@/services/service-helpers", () => ({
  executeBroadcast: mocks.executeBroadcast,
}));
vi.mock("@/services/message.service", () => ({
  batchFetchAttachments: vi.fn(async () => new Map()),
  batchFetchReactions: vi.fn(async () => new Map()),
  formatMessageRow: vi.fn(),
  pinMessage: mocks.pinMessage,
  unpinMessage: mocks.unpinMessage,
}));

import { PUT } from "../channels/$id/pins";

function put(body: BodyInit) {
  return PUT({
    request: new Request("https://meet.test/api/channels/channel-1/pins", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body,
    }),
    params: { id: "channel-1" },
  });
}

describe("PUT /api/channels/:id/pins", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({ userId: "user-1" });
    mocks.requirePermission.mockResolvedValue({});
    mocks.first.mockResolvedValue({ server_id: "server-1" });
    mocks.prepare.mockReturnValue({
      bind: () => ({
        first: mocks.first,
        all: async () => ({ results: [] }),
      }),
    });
    mocks.getDB.mockReturnValue({ prepare: mocks.prepare });
    mocks.pinMessage.mockResolvedValue({});
    mocks.unpinMessage.mockResolvedValue({ broadcast: null });
  });

  it("rejects wrong-typed fields with INVALID_BODY before touching the database", async () => {
    const response = await put(
      JSON.stringify({ message_id: 123, pinned: "yes" }),
    );

    expect(response.status).toBe(400);
    expect(((await response.json()) as { code?: string }).code).toBe(
      "INVALID_BODY",
    );
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.pinMessage).not.toHaveBeenCalled();
  });

  it("rejects a body that is not an object", async () => {
    const response = await put("null");

    expect(response.status).toBe(400);
    expect(mocks.pinMessage).not.toHaveBeenCalled();
  });

  it("requires a message id", async () => {
    const response = await put(JSON.stringify({ pinned: true }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "message_id required",
    });
    expect(mocks.pinMessage).not.toHaveBeenCalled();
  });

  it("pins the requested message in the channel", async () => {
    const response = await put(
      JSON.stringify({ message_id: "message-1", pinned: true }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: "message-1",
      is_pinned: true,
    });
    expect(mocks.pinMessage).toHaveBeenCalledWith(
      expect.anything(),
      "channel-1",
      "message-1",
    );
    expect(mocks.unpinMessage).not.toHaveBeenCalled();
  });

  it("unpins the requested message when pinned is false", async () => {
    const response = await put(
      JSON.stringify({ message_id: "message-1", pinned: false }),
    );

    expect(response.status).toBe(200);
    expect(mocks.unpinMessage).toHaveBeenCalledWith(
      expect.anything(),
      "channel-1",
      "message-1",
    );
    expect(mocks.pinMessage).not.toHaveBeenCalled();
  });
});
