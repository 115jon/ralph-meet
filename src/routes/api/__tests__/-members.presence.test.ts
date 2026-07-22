import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiError: vi.fn((message: string, status: number) =>
    Response.json({ error: message }, { status }),
  ),
  apiSuccess: vi.fn((data: unknown) => Response.json(data)),
  cacheFetch: vi.fn(),
  getDB: vi.fn(),
  listServerMembers: vi.fn(),
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/api-helpers", () => ({
  apiError: mocks.apiError,
  apiSuccess: mocks.apiSuccess,
  getDB: mocks.getDB,
  requireAuth: mocks.requireAuth,
}));

vi.mock("@/lib/cache", () => ({
  CacheKey: { serverMembers: (serverId: string) => `members:${serverId}` },
  CacheTTL: { SERVER_MEMBERS: 120 },
  cacheFetch: mocks.cacheFetch,
}));

vi.mock("@/services/server.service", () => ({
  listServerMembers: mocks.listServerMembers,
}));

import { GET } from "../servers/$id/members";

function createDb(overlay: Promise<{ results: Record<string, unknown>[] }>) {
  const membership = {
    first: vi.fn().mockResolvedValue({ ok: 1 }),
  };
  const overlayStatement = {
    all: vi.fn(() => overlay),
  };
  const db = {
    prepare: vi.fn((sql: string) =>
      sql.includes("SELECT 1")
        ? { bind: vi.fn(() => membership) }
        : { bind: vi.fn(() => overlayStatement) },
    ),
  };
  return db;
}

describe("server member presence freshness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({ userId: "viewer-1" });
    mocks.cacheFetch.mockResolvedValue([
      {
        joined_at: "now",
        roles: [],
        user: {
          id: "member-1",
          username: "member",
          status: "online",
          custom_status: "stale",
        },
      },
    ]);
  });

  it("overlays current status and custom status from D1 on cached members", async () => {
    mocks.getDB.mockReturnValue(
      createDb(
        Promise.resolve({
          results: [
            {
              user_id: "member-1",
              status: "idle",
              custom_status: "fresh",
            },
          ],
        }),
      ),
    );

    const response = await GET({
      request: new Request("https://meet.test/api/servers/server-1/members"),
      params: { id: "server-1" },
    });

    await expect(response.json()).resolves.toMatchObject({
      0: { user: { status: "idle", custom_status: "fresh" } },
    });
  });

  it("returns an error when the fresh presence overlay fails", async () => {
    mocks.getDB.mockReturnValue(
      createDb(Promise.reject(new Error("D1 unavailable"))),
    );

    const response = await GET({
      request: new Request("https://meet.test/api/servers/server-1/members"),
      params: { id: "server-1" },
    });

    expect(response.status).toBe(500);
    expect(mocks.apiError).toHaveBeenCalledWith(
      "Failed to load member presence",
      500,
    );
  });
});
