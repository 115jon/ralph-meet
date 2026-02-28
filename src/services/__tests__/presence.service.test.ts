import { beforeEach, describe, expect, it } from "vitest";
import { createMockD1 } from "../../lib/__tests__/mock-d1";
import { getPresence, updatePresence } from "../presence.service";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const USER_ID = "user_abc";

// ─── getPresence ─────────────────────────────────────────────────────────────

describe("getPresence", () => {
  let db: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    db = createMockD1();
  });

  it("returns status and custom_status from DB", async () => {
    db.mockQuery(/SELECT status, custom_status FROM users/, {
      status: "idle",
      custom_status: "Working on stuff",
    });

    const result = await getPresence(db as any, USER_ID);

    expect(result.status).toBe("idle");
    expect(result.custom_status).toBe("Working on stuff");
  });

  it("defaults to 'online' and null when user not found", async () => {
    // No mock → null by default

    const result = await getPresence(db as any, USER_ID);

    expect(result.status).toBe("online");
    expect(result.custom_status).toBeNull();
  });

  it("defaults custom_status to null when DB returns null", async () => {
    db.mockQuery(/SELECT status, custom_status FROM users/, {
      status: "dnd",
      custom_status: null,
    });

    const result = await getPresence(db as any, USER_ID);

    expect(result.status).toBe("dnd");
    expect(result.custom_status).toBeNull();
  });
});

// ─── updatePresence ──────────────────────────────────────────────────────────

describe("updatePresence", () => {
  let db: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    db = createMockD1();
  });

  it("updates presence and returns broadcast descriptor", async () => {
    const result = await updatePresence(db as any, USER_ID, {
      status: "idle",
      custom_status: "Afk",
    });

    db.assertCalled(/UPDATE users SET status/);
    expect(result.status).toBe("idle");
    expect(result.custom_status).toBe("Afk");
    expect(result.broadcast.event).toBe("PRESENCE_UPDATE");
    expect(result.broadcast.data).toMatchObject({
      user_id: USER_ID,
      status: "idle",
      custom_status: "Afk",
    });
  });

  it("accepts all valid status values", async () => {
    const statuses = ["online", "idle", "dnd", "offline"] as const;

    for (const status of statuses) {
      const result = await updatePresence(db as any, USER_ID, { status });
      expect(result.status).toBe(status);
    }
  });

  it("throws 400 for invalid status value", async () => {
    await expect(
      updatePresence(db as any, USER_ID, { status: "invisible" as any })
    ).rejects.toHaveProperty("status", 400);
  });

  it("stores null for custom_status when not provided", async () => {
    const result = await updatePresence(db as any, USER_ID, {
      status: "online",
    });

    expect(result.custom_status).toBeNull();
    db.assertCalled(/UPDATE users SET status/);
  });

  it("returns broadcast type 'all'", async () => {
    const result = await updatePresence(db as any, USER_ID, {
      status: "online",
    });

    expect(result.broadcast.type).toBe("all");
  });
});
