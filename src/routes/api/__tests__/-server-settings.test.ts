import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiSuccess: vi.fn((data: unknown) => Response.json(data)),
  deleteServer: vi.fn(),
  executeBroadcast: vi.fn(),
  executeInvalidation: vi.fn(),
  getBucket: vi.fn(),
  getDB: vi.fn(),
  recordR2CleanupFailure: vi.fn(),
  requireAuth: vi.fn(),
  retryR2Cleanup: vi.fn(),
}));

vi.mock("@/lib/api-helpers", () => ({
  apiSuccess: mocks.apiSuccess,
  getBucket: mocks.getBucket,
  getDB: mocks.getDB,
  requireAuth: mocks.requireAuth,
}));

vi.mock("@/services/server.service", () => ({
  deleteServer: mocks.deleteServer,
  updateServer: vi.fn(),
}));

vi.mock("@/services/service-helpers", () => ({
  executeAuditLog: vi.fn(),
  executeBroadcast: mocks.executeBroadcast,
  executeInvalidation: mocks.executeInvalidation,
}));

vi.mock("@/services/r2-cleanup.service", () => ({
  recordR2CleanupFailure: mocks.recordR2CleanupFailure,
  retryR2Cleanup: mocks.retryR2Cleanup,
}));

import { DELETE } from "../servers/$id/settings";

describe("server deletion cleanup", () => {
  beforeEach(() => {
    mocks.apiSuccess.mockClear();
    mocks.deleteServer.mockReset();
    mocks.executeBroadcast.mockReset();
    mocks.executeInvalidation.mockReset();
    mocks.getBucket.mockReset();
    mocks.getDB.mockReset();
    mocks.recordR2CleanupFailure.mockReset();
    mocks.requireAuth.mockReset();
    mocks.retryR2Cleanup.mockReset();
    mocks.requireAuth.mockResolvedValue({ userId: "owner-1" });
    mocks.getDB.mockReturnValue({});
    mocks.retryR2Cleanup.mockResolvedValue(undefined);
    mocks.deleteServer.mockResolvedValue({
      soundboardFileKeys: ["attachments/channel-1/sound-1/file.mp3"],
      cacheKeysToInvalidate: [],
      broadcasts: [],
    });
  });

  it("queues a server sound key when deletion fails after the D1 cascade", async () => {
    const fileKey = "attachments/channel-1/sound-1/file.mp3";
    const bucket = {
      delete: vi.fn().mockRejectedValue(new Error("R2 unavailable")),
    };
    mocks.getBucket.mockReturnValue(bucket);

    const response = await DELETE({
      request: new Request("https://meet.test/api/servers/server-1/settings", {
        method: "DELETE",
      }),
      params: { id: "server-1" },
    });

    expect(response.status).toBe(200);
    expect(bucket.delete).toHaveBeenCalledWith(fileKey);
    expect(mocks.recordR2CleanupFailure).toHaveBeenCalledWith(
      {},
      fileKey,
      expect.any(Error),
    );
  });
});
