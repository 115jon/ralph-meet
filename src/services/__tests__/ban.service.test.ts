import { beforeEach, describe, expect, it } from "vitest";
import { createMockD1 } from "../../lib/__tests__/mock-d1";
import { banUser, listBans, unbanUser } from "../ban.service";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const NOW = "2026-02-28T00:00:00.000Z";
const USER_ID = "user_abc";
const TARGET_ID = "target_xyz";
const SERVER_ID = "server_123";

// BAN_MEMBERS = 1 << 6 = 64, ADMINISTRATOR = 1 << 0 = 1
const BAN_MEMBERS = 64;
const ADMINISTRATOR = 1;

function banRow(overrides: Record<string, unknown> = {}) {
  return {
    server_id: SERVER_ID,
    user_id: TARGET_ID,
    reason: null,
    banned_by: USER_ID,
    created_at: NOW,
    username: "target",
    avatar_url: null,
    banned_by_username: "actor",
    ...overrides,
  };
}

// ─── listBans ────────────────────────────────────────────────────────────────

describe("listBans", () => {
  let db: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    db = createMockD1();
  });

  it("returns ban list when actor has BAN_MEMBERS", async () => {
    db.mockQuery(/SELECT r\.permissions, r\.position/, {
      results: [{ permissions: BAN_MEMBERS, position: 1 }],
    });
    db.mockQuery(/FROM server_bans/, {
      results: [banRow(), banRow({ user_id: "u2" })],
    });

    const result = await listBans(db as any, SERVER_ID, USER_ID);

    expect(result).toHaveLength(2);
    expect(result[0].user_id).toBe(TARGET_ID);
  });

  it("throws 403 when actor lacks BAN_MEMBERS, MANAGE_SERVER and ADMINISTRATOR", async () => {
    db.mockQuery(/SELECT r\.permissions, r\.position/, {
      results: [{ permissions: 0, position: 0 }],
    });

    await expect(
      listBans(db as any, SERVER_ID, USER_ID)
    ).rejects.toHaveProperty("status", 403);
  });

  it("returns empty array when no bans", async () => {
    db.mockQuery(/SELECT r\.permissions, r\.position/, {
      results: [{ permissions: BAN_MEMBERS, position: 1 }],
    });
    db.mockQuery(/FROM server_bans/, { results: [] });

    const result = await listBans(db as any, SERVER_ID, USER_ID);
    expect(result).toEqual([]);
  });
});

// ─── banUser ─────────────────────────────────────────────────────────────────

describe("banUser", () => {
  let db: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    db = createMockD1();
  });

  it("bans a user when actor has BAN_MEMBERS and higher role", async () => {
    // Actor perms
    db.mockQuery(
      /SELECT r\.permissions, r\.position/,
      { results: [{ permissions: BAN_MEMBERS, position: 2 }] },
      [SERVER_ID, USER_ID]
    );
    // Server ownership check
    db.mockQuery(/SELECT owner_id FROM servers/, { owner_id: "someone_else" });
    // Target role position
    db.mockQuery(
      /SELECT r\.permissions, r\.position/,
      { results: [{ permissions: 0, position: 1 }] },
      [SERVER_ID, TARGET_ID]
    );

    const result = await banUser(db as any, SERVER_ID, USER_ID, {
      user_id: TARGET_ID,
      reason: "Spamming",
    });

    db.assertCalled(/INSERT OR REPLACE INTO server_bans/);
    db.assertCalled(/DELETE FROM server_members/);
    expect(result.cacheKeysToInvalidate.length).toBeGreaterThan(0);
    expect(result.broadcast.event).toBe("GUILD_MEMBER_REMOVE");
    expect(result.auditLog.actionType).toBe("MEMBER_BAN");
  });

  it("throws 400 when actor tries to ban themselves", async () => {
    db.mockQuery(
      /SELECT r\.permissions, r\.position/,
      { results: [{ permissions: BAN_MEMBERS, position: 2 }] },
      [SERVER_ID, USER_ID]
    );

    await expect(
      banUser(db as any, SERVER_ID, USER_ID, { user_id: USER_ID })
    ).rejects.toHaveProperty("status", 400);
  });

  it("throws 400 when trying to ban the server owner", async () => {
    db.mockQuery(
      /SELECT r\.permissions, r\.position/,
      { results: [{ permissions: BAN_MEMBERS, position: 2 }] },
      [SERVER_ID, USER_ID]
    );
    db.mockQuery(/SELECT owner_id FROM servers/, { owner_id: TARGET_ID });

    await expect(
      banUser(db as any, SERVER_ID, USER_ID, { user_id: TARGET_ID })
    ).rejects.toHaveProperty("status", 400);
  });

  it("throws 403 when actor lacks BAN_MEMBERS", async () => {
    db.mockQuery(
      /SELECT r\.permissions, r\.position/,
      { results: [{ permissions: 0, position: 2 }] },
      [SERVER_ID, USER_ID]
    );

    await expect(
      banUser(db as any, SERVER_ID, USER_ID, { user_id: TARGET_ID })
    ).rejects.toHaveProperty("status", 403);
  });

  it("throws 403 when target has equal or higher role", async () => {
    db.mockQuery(
      /SELECT r\.permissions, r\.position/,
      { results: [{ permissions: BAN_MEMBERS, position: 1 }] },
      [SERVER_ID, USER_ID]
    );
    db.mockQuery(/SELECT owner_id FROM servers/, { owner_id: "someone_else" });
    db.mockQuery(
      /SELECT r\.permissions, r\.position/,
      { results: [{ permissions: 0, position: 1 }] },
      [SERVER_ID, TARGET_ID]
    );

    await expect(
      banUser(db as any, SERVER_ID, USER_ID, { user_id: TARGET_ID })
    ).rejects.toHaveProperty("status", 403);
  });
});

// ─── unbanUser ───────────────────────────────────────────────────────────────

describe("unbanUser", () => {
  let db: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    db = createMockD1();
  });

  it("unbans a user when actor has BAN_MEMBERS", async () => {
    db.mockQuery(/SELECT r\.permissions, r\.position/, {
      results: [{ permissions: BAN_MEMBERS, position: 1 }],
    });

    const result = await unbanUser(db as any, SERVER_ID, USER_ID, TARGET_ID);

    db.assertCalled(/DELETE FROM server_bans/);
    expect(result.auditLog.actionType).toBe("MEMBER_UNBAN");
  });

  it("throws 403 when actor lacks BAN_MEMBERS and ADMINISTRATOR", async () => {
    db.mockQuery(/SELECT r\.permissions, r\.position/, {
      results: [{ permissions: 0, position: 0 }],
    });

    await expect(
      unbanUser(db as any, SERVER_ID, USER_ID, TARGET_ID)
    ).rejects.toHaveProperty("status", 403);
  });
});
