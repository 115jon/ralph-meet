import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  apiGet: mocks.apiGet,
  apiPost: mocks.apiPost,
}));

import {
  CollectiblesSyncError,
  loadCollectiblesCatalog,
  resetCollectiblesCatalogClient,
  syncCollectiblesCatalogClient,
} from "@/lib/collectibles-catalog-client";

function catalog(stale: boolean) {
  return {
    version: 1,
    source: "yapper",
    syncedAt: new Date().toISOString(),
    stale,
    categories: [],
    items: [],
    counts: {},
  };
}

function httpError(status: number, message: string) {
  return Object.assign(new Error(message), { status, code: "X" });
}

beforeEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  resetCollectiblesCatalogClient();
});

describe("loadCollectiblesCatalog", () => {
  it("does not refetch a stale catalog more than once per 10 minutes", async () => {
    vi.useFakeTimers();
    mocks.apiGet.mockResolvedValue({ catalog: catalog(true) });

    await loadCollectiblesCatalog();
    await loadCollectiblesCatalog();
    expect(mocks.apiGet).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(11 * 60 * 1000);
    await loadCollectiblesCatalog();
    expect(mocks.apiGet).toHaveBeenCalledTimes(2);
  });

  it("keeps a fresh catalog for 30 minutes", async () => {
    vi.useFakeTimers();
    mocks.apiGet.mockResolvedValue({ catalog: catalog(false) });

    await loadCollectiblesCatalog();
    vi.advanceTimersByTime(20 * 60 * 1000);
    await loadCollectiblesCatalog();
    expect(mocks.apiGet).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(11 * 60 * 1000);
    await loadCollectiblesCatalog();
    expect(mocks.apiGet).toHaveBeenCalledTimes(2);
  });
});

describe("syncCollectiblesCatalogClient", () => {
  it("explains a 403 for non-admins", async () => {
    mocks.apiPost.mockRejectedValue(httpError(403, "Forbidden"));
    const error = await syncCollectiblesCatalogClient().catch((e) => e);
    expect(error).toBeInstanceOf(CollectiblesSyncError);
    expect(error.status).toBe(403);
    expect(error.message).toMatch(/Only catalog admins/);
  });

  it("passes the server's cooldown message through on 429", async () => {
    mocks.apiPost.mockRejectedValue(
      httpError(429, "The catalog synced moments ago. Try again in 240s."),
    );
    const error = await syncCollectiblesCatalogClient().catch((e) => e);
    expect(error.status).toBe(429);
    expect(error.message).toBe(
      "The catalog synced moments ago. Try again in 240s.",
    );
  });
});
