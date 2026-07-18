import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getBucket: vi.fn(),
  getDB: vi.fn(),
  requireAuth: vi.fn(),
  requireChannelAccess: vi.fn(),
}));

vi.mock("@/lib/api-helpers", () => ({
  apiError: (message: string, status: number) =>
    Response.json({ error: message }, { status }),
  getBucket: mocks.getBucket,
  getDB: mocks.getDB,
  requireAuth: mocks.requireAuth,
}));

vi.mock("@/lib/require-channel-access", () => ({
  requireChannelAccess: mocks.requireChannelAccess,
}));

import { GET } from "../attachments/$";

describe("attachment GET", () => {
  beforeEach(() => {
    mocks.getBucket.mockReset();
    mocks.getDB.mockReset();
    mocks.requireAuth.mockReset();
    mocks.requireChannelAccess.mockReset();
    mocks.requireAuth.mockResolvedValue({ userId: "user-1" });
  });

  it("rejects unauthorized channel access before reading R2", async () => {
    mocks.requireChannelAccess.mockResolvedValue(
      Response.json(
        { error: "Channel not found or access denied" },
        { status: 403 },
      ),
    );
    const bucket = { get: vi.fn() };
    mocks.getBucket.mockReturnValue(bucket);

    const response = await GET({
      request: new Request(
        "https://meet.test/api/attachments/channel-1/attachment-1/file.txt",
      ),
      params: { _splat: "channel-1/attachment-1/file.txt" },
    });

    expect(response.status).toBe(403);
    expect(bucket.get).not.toHaveBeenCalled();
    expect(mocks.requireChannelAccess).toHaveBeenCalledWith(
      "user-1",
      "channel-1",
    );
  });

  it("rejects a URL whose file key does not match the persisted attachment", async () => {
    mocks.requireChannelAccess.mockResolvedValue({ serverId: "server-1" });
    const first = vi.fn().mockResolvedValue({
      file_key: "attachments/channel-1/attachment-1/other.txt",
      filename: "file.txt",
      channel_id: "channel-1",
    });
    mocks.getDB.mockReturnValue({
      prepare: vi.fn(() => ({ bind: vi.fn(() => ({ first })) })),
    });
    const bucket = { get: vi.fn() };
    mocks.getBucket.mockReturnValue(bucket);

    const response = await GET({
      request: new Request(
        "https://meet.test/api/attachments/channel-1/attachment-1/file.txt",
      ),
      params: { _splat: "channel-1/attachment-1/file.txt" },
    });

    expect(response.status).toBe(404);
    expect(bucket.get).not.toHaveBeenCalled();
  });
});
