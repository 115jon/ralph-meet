import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
  requireAuth: vi.fn(),
  syncCollectiblesCatalog: vi.fn(),
  getCollectiblesCatalog: vi.fn(),
  getCollectiblesSyncStatus: vi.fn(),
}));

vi.mock("@/lib/api-helpers", () => ({
  apiError: (message: string, status = 400, code?: string) =>
    Response.json({ error: message, code }, { status }),
  apiSuccess: (data: unknown, status = 200) => Response.json(data, { status }),
  getDB: () => ({}),
  getEnv: () => mocks.env,
  requireAuth: mocks.requireAuth,
}));

vi.mock("@/lib/collectibles-catalog", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/collectibles-catalog")>();
  return {
    ...actual,
    syncCollectiblesCatalog: mocks.syncCollectiblesCatalog,
    getCollectiblesCatalog: mocks.getCollectiblesCatalog,
    getCollectiblesSyncStatus: mocks.getCollectiblesSyncStatus,
  };
});

import { GET } from "../collectibles/catalog";
import { POST } from "../collectibles/sync";

const catalog = { version: 1, items: [], categories: [] };

function post() {
  return POST({
    request: new Request("https://meet.test/api/collectibles/sync", {
      method: "POST",
    }),
  });
}

function get(query = "") {
  return GET({
    request: new Request(`https://meet.test/api/collectibles/catalog${query}`),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.env = { COLLECTIBLES_ADMIN_USER_IDS: "admin-1, admin-2" };
  mocks.requireAuth.mockResolvedValue({ userId: "admin-1" });
  mocks.getCollectiblesSyncStatus.mockResolvedValue({ consecutiveFailures: 0 });
  mocks.getCollectiblesCatalog.mockResolvedValue(catalog);
  mocks.syncCollectiblesCatalog.mockResolvedValue(catalog);
});

describe("POST /api/collectibles/sync", () => {
  it("passes through an auth failure", async () => {
    mocks.requireAuth.mockResolvedValue(new Response(null, { status: 401 }));
    expect((await post()).status).toBe(401);
    expect(mocks.syncCollectiblesCatalog).not.toHaveBeenCalled();
  });

  it("forbids users who are not catalog admins", async () => {
    mocks.requireAuth.mockResolvedValue({ userId: "someone" });
    const response = await post();
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "COLLECTIBLES_SYNC_FORBIDDEN",
    });
    expect(mocks.syncCollectiblesCatalog).not.toHaveBeenCalled();
  });

  it("forbids everyone when no admin list is configured", async () => {
    mocks.env = {};
    expect((await post()).status).toBe(403);
    expect(mocks.syncCollectiblesCatalog).not.toHaveBeenCalled();
  });

  it("rate-limits to one sync per cooldown and returns the current catalog", async () => {
    mocks.getCollectiblesSyncStatus.mockResolvedValue({
      consecutiveFailures: 0,
      lastAttemptAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const response = await post();
    expect(response.status).toBe(429);
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(200);
    await expect(response.json()).resolves.toMatchObject({
      code: "COLLECTIBLES_SYNC_COOLDOWN",
      catalog,
    });
    expect(mocks.syncCollectiblesCatalog).not.toHaveBeenCalled();
  });

  it("syncs for an admin outside the cooldown", async () => {
    const response = await post();
    expect(response.status).toBe(200);
    expect(mocks.syncCollectiblesCatalog).toHaveBeenCalledWith(
      expect.anything(),
      { trigger: "manual" },
    );
  });

  it("reports a failed sync as 503 without losing the cache", async () => {
    mocks.syncCollectiblesCatalog.mockRejectedValue(
      new Error("Yapper catalog fetch failed with 403"),
    );
    const response = await post();
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "COLLECTIBLES_SYNC_FAILED",
      error: expect.stringContaining("kept the last good one"),
    });
  });
});

describe("GET /api/collectibles/catalog", () => {
  it("ignores ?refresh=1 from non-admins", async () => {
    mocks.requireAuth.mockResolvedValue({ userId: "someone" });
    expect((await get("?refresh=1")).status).toBe(200);
    expect(mocks.getCollectiblesCatalog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ forceRefresh: false }),
    );
  });

  it("honours ?refresh=1 for admins", async () => {
    await get("?refresh=1");
    expect(mocks.getCollectiblesCatalog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ forceRefresh: true }),
    );
  });

  it("returns 503 when there is no catalog at all", async () => {
    mocks.getCollectiblesCatalog.mockRejectedValue(new Error("empty"));
    expect((await get()).status).toBe(503);
  });
});
