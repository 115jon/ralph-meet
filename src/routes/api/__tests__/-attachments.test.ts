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

  it("returns 416 for a reversed range without passing a negative R2 length", async () => {
    mocks.requireChannelAccess.mockResolvedValue({ serverId: "server-1" });
    const first = vi.fn().mockResolvedValue({
      file_key: "attachments/channel-1/attachment-1/file.txt",
      filename: "file.txt",
      channel_id: "channel-1",
    });
    mocks.getDB.mockReturnValue({
      prepare: vi.fn(() => ({ bind: vi.fn(() => ({ first })) })),
    });
    const bucket = {
      head: vi.fn().mockResolvedValue({ size: 12 }),
      get: vi.fn().mockResolvedValue({
        body: new ReadableStream(),
        size: 12,
        httpMetadata: { contentType: "text/plain" },
        writeHttpMetadata(headers: Headers) {
          headers.set("Content-Type", "text/plain");
        },
      }),
    };
    mocks.getBucket.mockReturnValue(bucket);

    const response = await GET({
      request: new Request(
        "https://meet.test/api/attachments/channel-1/attachment-1/file.txt",
        { headers: { Range: "bytes=8-3" } },
      ),
      params: { _splat: "channel-1/attachment-1/file.txt" },
    });

    expect(response.status).toBe(416);
    expect(response.headers.get("Content-Range")).toBe("bytes */12");
    expect(bucket.head).toHaveBeenCalledWith(
      "attachments/channel-1/attachment-1/file.txt",
    );
    expect(bucket.get).not.toHaveBeenCalled();
  });

  it.each(["not-a-range", "bytes=-0", "bytes=8-7", "bytes=12-12"])(
    "returns 416 without reading R2 for unsafe range %s",
    async (range) => {
      mocks.requireChannelAccess.mockResolvedValue({ serverId: "server-1" });
      const first = vi.fn().mockResolvedValue({
        file_key: "attachments/channel-1/attachment-1/file.txt",
        filename: "file.txt",
        channel_id: "channel-1",
      });
      mocks.getDB.mockReturnValue({
        prepare: vi.fn(() => ({ bind: vi.fn(() => ({ first })) })),
      });
      const bucket = {
        head: vi.fn().mockResolvedValue({ size: 12 }),
        get: vi.fn(),
      };
      mocks.getBucket.mockReturnValue(bucket);

      const response = await GET({
        request: new Request(
          "https://meet.test/api/attachments/channel-1/attachment-1/file.txt",
          { headers: { Range: range } },
        ),
        params: { _splat: "channel-1/attachment-1/file.txt" },
      });

      expect(response.status).toBe(416);
      expect(response.headers.get("Content-Range")).toBe("bytes */12");
      expect(bucket.head).toHaveBeenCalledWith(
        "attachments/channel-1/attachment-1/file.txt",
      );
      expect(bucket.get).not.toHaveBeenCalled();
    },
  );

  it("resolves a valid suffix range against object metadata", async () => {
    mocks.requireChannelAccess.mockResolvedValue({ serverId: "server-1" });
    const first = vi.fn().mockResolvedValue({
      file_key: "attachments/channel-1/attachment-1/file.txt",
      filename: "file.txt",
      channel_id: "channel-1",
    });
    mocks.getDB.mockReturnValue({
      prepare: vi.fn(() => ({ bind: vi.fn(() => ({ first })) })),
    });
    const bucket = {
      head: vi.fn().mockResolvedValue({ size: 12 }),
      get: vi.fn().mockResolvedValue({
        body: new ReadableStream(),
        size: 4,
        range: { offset: 8, length: 4 },
        httpMetadata: { contentType: "text/plain" },
        writeHttpMetadata(headers: Headers) {
          headers.set("Content-Type", "text/plain");
        },
      }),
    };
    mocks.getBucket.mockReturnValue(bucket);

    const response = await GET({
      request: new Request(
        "https://meet.test/api/attachments/channel-1/attachment-1/file.txt",
        { headers: { Range: "bytes=-4" } },
      ),
      params: { _splat: "channel-1/attachment-1/file.txt" },
    });

    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe("bytes 8-11/12");
    expect(response.headers.get("Content-Length")).toBe("4");
    expect(bucket.get).toHaveBeenCalledWith(
      "attachments/channel-1/attachment-1/file.txt",
      { range: { offset: 8, length: 4 } },
    );
  });

  it("reads only a validated in-bounds range after reading metadata", async () => {
    mocks.requireChannelAccess.mockResolvedValue({ serverId: "server-1" });
    const first = vi.fn().mockResolvedValue({
      file_key: "attachments/channel-1/attachment-1/file.txt",
      filename: "file.txt",
      channel_id: "channel-1",
    });
    mocks.getDB.mockReturnValue({
      prepare: vi.fn(() => ({ bind: vi.fn(() => ({ first })) })),
    });
    const bucket = {
      head: vi.fn().mockResolvedValue({ size: 12 }),
      get: vi.fn().mockResolvedValue({
        body: new ReadableStream(),
        size: 12,
        range: { offset: 2, length: 3 },
        httpMetadata: { contentType: "text/plain" },
        writeHttpMetadata(headers: Headers) {
          headers.set("Content-Type", "text/plain");
        },
      }),
    };
    mocks.getBucket.mockReturnValue(bucket);

    const response = await GET({
      request: new Request(
        "https://meet.test/api/attachments/channel-1/attachment-1/file.txt",
        { headers: { Range: "bytes=2-4" } },
      ),
      params: { _splat: "channel-1/attachment-1/file.txt" },
    });

    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe("bytes 2-4/12");
    expect(response.headers.get("Content-Length")).toBe("3");
    expect(bucket.get).toHaveBeenCalledWith(
      "attachments/channel-1/attachment-1/file.txt",
      { range: { offset: 2, length: 3 } },
    );
  });

  it("clamps a satisfiable overlong range to the attachment size", async () => {
    mocks.requireChannelAccess.mockResolvedValue({ serverId: "server-1" });
    const first = vi.fn().mockResolvedValue({
      file_key: "attachments/channel-1/attachment-1/file.txt",
      filename: "file.txt",
      channel_id: "channel-1",
    });
    mocks.getDB.mockReturnValue({
      prepare: vi.fn(() => ({ bind: vi.fn(() => ({ first })) })),
    });
    const bucket = {
      head: vi.fn().mockResolvedValue({ size: 12 }),
      get: vi.fn().mockResolvedValue({
        body: new ReadableStream(),
        size: 12,
        range: { offset: 0, length: 12 },
        httpMetadata: { contentType: "text/plain" },
        writeHttpMetadata(headers: Headers) {
          headers.set("Content-Type", "text/plain");
        },
      }),
    };
    mocks.getBucket.mockReturnValue(bucket);

    const response = await GET({
      request: new Request(
        "https://meet.test/api/attachments/channel-1/attachment-1/file.txt",
        { headers: { Range: "bytes=0-12" } },
      ),
      params: { _splat: "channel-1/attachment-1/file.txt" },
    });

    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe("bytes 0-11/12");
    expect(bucket.get).toHaveBeenCalledWith(
      "attachments/channel-1/attachment-1/file.txt",
      { range: { offset: 0, length: 12 } },
    );
  });
});
