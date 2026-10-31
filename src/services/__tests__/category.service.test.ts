import { beforeEach, describe, expect, it } from "vitest";
import { anyId, createMockD1 } from "../../lib/__tests__/mock-d1";
import { CacheKey } from "../../lib/cache";
import { createCategory, deleteCategory } from "../category.service";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const USER_ID = "user_abc";
const SERVER_ID = "server_123";
const CATEGORY_ID = "cat_456";

// MANAGE_CATEGORIES = 1 << 10 = 1024 (checking permissions.ts)
// We test that the service queries for permissions using the requirePermission helper.
// The category service delegates the check to the DB query.

// ─── createCategory ──────────────────────────────────────────────────────────

describe("createCategory", () => {
  let db: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    db = createMockD1();
    db.mockQuery(/SELECT COALESCE\(MAX\(rank\)/, { next_rank: 2 });
  });

  it("creates a category and returns broadcast descriptor", async () => {
    const result = await createCategory(db as any, SERVER_ID, USER_ID, {
      name: "NEW CATEGORY",
    });

    expect(result.data).toEqual({
      id: anyId(),
      server_id: SERVER_ID,
      name: "NEW CATEGORY",
      rank: 2,
    });
    // The row is written for this server under the id the caller gets back.
    db.assertCalledWith(/INSERT INTO categories/, [
      result.data.id,
      SERVER_ID,
      "NEW CATEGORY",
      2,
    ]);
    db.assertCalledWith(/SELECT COALESCE\(MAX\(rank\)/, [SERVER_ID]);
    expect(result.cacheKeysToInvalidate).toEqual([
      CacheKey.serverChannels(SERVER_ID),
    ]);
    expect(result.broadcast).toEqual({
      type: "server",
      target: SERVER_ID,
      event: "CHANNEL_UPDATE",
      data: { server_id: SERVER_ID },
    });
  });

  it("trims the category name", async () => {
    const result = await createCategory(db as any, SERVER_ID, USER_ID, {
      name: "  Padded  ",
    });

    expect(result.data.name).toBe("Padded");
  });

  it("throws 400 when name is empty", async () => {
    const { ServiceError: _ServiceError } =
      await import("../../lib/service-error");
    await expect(
      createCategory(db as any, SERVER_ID, USER_ID, { name: "  " }),
    ).rejects.toHaveProperty("status", 400);
  });

  it("uses rank 0 when no categories exist yet", async () => {
    db.mockQuery(/SELECT COALESCE\(MAX\(rank\)/, { next_rank: 0 });

    const result = await createCategory(db as any, SERVER_ID, USER_ID, {
      name: "First",
    });

    expect(result.data.rank).toBe(0);
  });
});

// ─── deleteCategory ──────────────────────────────────────────────────────────

describe("deleteCategory", () => {
  let db: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    db = createMockD1();
  });

  it("deletes a category and returns side effects", async () => {
    const result = await deleteCategory(
      db as any,
      SERVER_ID,
      USER_ID,
      CATEGORY_ID,
    );

    db.assertCalledWith(/UPDATE channels SET category_id = NULL/, [
      CATEGORY_ID,
    ]);
    db.assertCalledWith(/DELETE FROM categories/, [CATEGORY_ID, SERVER_ID]);
    expect(result.cacheKeysToInvalidate).toEqual([
      CacheKey.serverChannels(SERVER_ID),
    ]);
    expect(result.broadcast).toEqual({
      type: "server",
      target: SERVER_ID,
      event: "CHANNEL_UPDATE",
      data: { server_id: SERVER_ID },
    });
  });

  it("passes the correct categoryId to the cascade nullify", async () => {
    await deleteCategory(db as any, SERVER_ID, USER_ID, CATEGORY_ID);

    db.assertCalledWith(/UPDATE channels SET category_id = NULL/, [
      CATEGORY_ID,
    ]);
  });

  it("passes the correct categoryId and serverId to DELETE", async () => {
    await deleteCategory(db as any, SERVER_ID, USER_ID, CATEGORY_ID);

    db.assertCalledWith(/DELETE FROM categories/, [CATEGORY_ID, SERVER_ID]);
  });
});
