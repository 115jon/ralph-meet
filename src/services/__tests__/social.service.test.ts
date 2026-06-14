import { beforeEach, describe, expect, it } from "vitest";
import { createMockD1 } from "../../lib/__tests__/mock-d1";
import {
  acceptFriendRequest,
  blockUser,
  createInvite,
  getOrCreateDM,
  joinServer,
  listDMs,
  listInvites,
  listRelationships,
  removeRelationship,
  sendFriendRequest,
} from "../social.service";

const NOW = "2026-02-28T00:00:00.000Z";
const USER_ID = "user_abc";
const TARGET_ID = "user_xyz";
const SERVER_ID = "server_123";

function userRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TARGET_ID,
    username: "bob",
    avatar_url: null,
    status: "online",
    custom_status: null,
    ...overrides,
  };
}

// ─── listRelationships ───────────────────────────────────────────────────────

describe("listRelationships", () => {
  let db: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    db = createMockD1();
  });

  it("returns formatted relationships", async () => {
    db.mockQuery("FROM relationships r", {
      results: [
        {
          target_user_id: TARGET_ID,
          type: 0,
          created_at: NOW,
          username: "bob",
          avatar_url: null,
          status: "online",
          custom_status: null,
        },
      ],
    });

    const result = await listRelationships(db as any, USER_ID);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe(0);
    expect(result[0].user.username).toBe("bob");
  });
});

// ─── sendFriendRequest ───────────────────────────────────────────────────────

describe("sendFriendRequest", () => {
  let db: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    db = createMockD1();
  });

  it("creates pending outgoing/incoming relationships", async () => {
    db.mockQuery("FROM users WHERE username", userRow());
    // No existing relationship → first() returns null

    const result = await sendFriendRequest(db as any, USER_ID, "bob");

    db.assertCalled(/INSERT INTO relationships/);
    expect(result.type).toBe(3);
    expect(result.broadcasts).toHaveLength(2);
  });

  it("throws 404 when target user not found", async () => {
    await expect(
      sendFriendRequest(db as any, USER_ID, "nonexistent")
    ).rejects.toHaveProperty("status", 404);
  });

  it("throws 400 when trying to friend yourself", async () => {
    db.mockQuery("FROM users WHERE username", userRow({ id: USER_ID }));

    await expect(
      sendFriendRequest(db as any, USER_ID, "bob")
    ).rejects.toHaveProperty("status", 400);
  });

  it("throws 409 when already friends", async () => {
    db.mockQuery("FROM users WHERE username", userRow());
    db.mockQuery("FROM relationships WHERE user_id", { type: 0 });

    await expect(
      sendFriendRequest(db as any, USER_ID, "bob")
    ).rejects.toHaveProperty("status", 409);
  });

  it("auto-accepts when target already sent a request (type 2)", async () => {
    db.mockQuery("FROM users WHERE username", userRow());
    db.mockQuery("FROM relationships WHERE user_id", { type: 2 });

    const result = await sendFriendRequest(db as any, USER_ID, "bob");
    expect(result.type).toBe(0); // Friends now
    db.assertCalled(/UPDATE relationships/);
  });
});

// ─── acceptFriendRequest ────────────────────────────────────────────────────

describe("acceptFriendRequest", () => {
  let db: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    db = createMockD1();
  });

  it("accepts pending request", async () => {
    db.mockQuery("FROM relationships WHERE user_id", { "1": 1 }, [USER_ID, TARGET_ID]);

    const result = await acceptFriendRequest(db as any, USER_ID, TARGET_ID);
    expect(result.type).toBe(0);
    db.assertCalled(/UPDATE relationships/);
  });

  it("throws 404 when no pending request", async () => {
    // No mock for pending → first() returns null

    await expect(
      acceptFriendRequest(db as any, USER_ID, TARGET_ID)
    ).rejects.toHaveProperty("status", 404);
  });
});

// ─── blockUser ───────────────────────────────────────────────────────────────

describe("blockUser", () => {
  let db: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    db = createMockD1();
  });

  it("blocks user and removes reverse relationship", async () => {
    const result = await blockUser(db as any, USER_ID, TARGET_ID);
    expect(result.type).toBe(1);
    db.assertCalled(/INSERT OR REPLACE INTO relationships/);
    db.assertCalled(/DELETE FROM relationships/);
    expect(result.broadcasts).toHaveLength(2);
  });
});

// ─── removeRelationship ──────────────────────────────────────────────────────

describe("removeRelationship", () => {
  let db: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    db = createMockD1();
  });

  it("removes both sides of relationship", async () => {
    const result = await removeRelationship(db as any, USER_ID, TARGET_ID);
    db.assertCalled(/DELETE FROM relationships/);
    expect(result.broadcasts).toHaveLength(2);
  });
});

// ─── listDMs ─────────────────────────────────────────────────────────────────

describe("listDMs", () => {
  let db: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    db = createMockD1();
  });

  it("returns formatted DM list", async () => {
    db.mockQuery("FROM dm_recipients me", {
      results: [
        {
          id: "dm_1",
          name: "DM-abc-xyz",
          channel_type: "dm",
          created_at: NOW,
          other_user_id: TARGET_ID,
          other_username: "bob",
          other_avatar_url: null,
          other_status: "online",
          other_custom_status: null,
        },
      ],
    });

    const result = await listDMs(db as any, USER_ID);
    expect(result).toHaveLength(1);
    expect(result[0].channel_type).toBe("dm");
    expect(result[0].recipient.username).toBe("bob");
  });
});

// ─── getOrCreateDM ───────────────────────────────────────────────────────────

describe("getOrCreateDM", () => {
  let db: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    db = createMockD1();
  });

  it("returns existing DM when found", async () => {
    db.mockQuery("FROM users WHERE id", userRow());
    db.mockQuery("FROM dm_recipients a", { id: "dm_existing" });

    const result = await getOrCreateDM(db as any, USER_ID, TARGET_ID);
    expect(result.isNew).toBe(false);
    expect(result.dm.id).toBe("dm_existing");
  });

  it("creates new DM when none exists", async () => {
    db.mockQuery("FROM users WHERE id", userRow(), [TARGET_ID]);
    // No existing DM → default null
    // Current user for broadcast
    db.mockQuery("FROM users WHERE id", userRow({ id: USER_ID, username: "alice" }), [USER_ID]);

    const result = await getOrCreateDM(db as any, USER_ID, TARGET_ID);
    expect(result.isNew).toBe(true);
    expect(result.dm.channel_type).toBe("dm");
    db.assertCalled(/INSERT INTO channels/);
  });

  it("throws 400 when DMing yourself", async () => {
    await expect(
      getOrCreateDM(db as any, USER_ID, USER_ID)
    ).rejects.toHaveProperty("status", 400);
  });

  it("throws 404 when target user not found", async () => {
    await expect(
      getOrCreateDM(db as any, USER_ID, "nonexistent")
    ).rejects.toHaveProperty("status", 404);
  });
});

// ─── createInvite ────────────────────────────────────────────────────────────

describe("createInvite", () => {
  let db: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    db = createMockD1();
  });

  it("creates an invite", async () => {
    const result = await createInvite(db as any, SERVER_ID, USER_ID, {});

    db.assertCalled(/INSERT INTO invites/);
    expect(result.code).toBeDefined();
    expect(result.code.length).toBeGreaterThan(0);
  });

  it("creates invite with expiry", async () => {
    const result = await createInvite(db as any, SERVER_ID, USER_ID, {
      max_age: 3600,
    });

    expect(result.expires_at).not.toBeNull();
  });
});

// ─── listInvites ─────────────────────────────────────────────────────────────

describe("listInvites", () => {
  let db: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    db = createMockD1();
  });

  it("returns invite list", async () => {
    db.mockQuery("FROM invites", {
      results: [
        { code: "abc", server_id: SERVER_ID, uses: 0, max_uses: null },
      ],
    });

    const result = await listInvites(db as any, SERVER_ID, false);
    expect(result).toHaveLength(1);
  });
});

// ─── joinServer ──────────────────────────────────────────────────────────────

describe("joinServer", () => {
  let db: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    db = createMockD1();
  });

  it("joins server when invite is valid", async () => {
    db.mockQuery("FROM invites WHERE code", {
      code: "abc",
      server_id: SERVER_ID,
      channel_id: null,
      max_uses: null,
      uses: 0,
      temporary: 0,
      expires_at: null,
    });
    db.mockQuery("FROM servers WHERE id", {
      id: SERVER_ID,
      name: "Test",
      invites_paused: 0,
    });
    // Not already a member
    // Not banned
    db.mockQuery("FROM roles WHERE server_id", {
      id: "role_everyone",
      server_id: SERVER_ID,
      name: "@everyone",
      color: null,
      permissions: 0,
      position: 0,
      is_default: 1,
      created_at: NOW,
    });

    const result = await joinServer(
      db as any,
      "abc",
      USER_ID,
      "alice",
      null
    );

    expect(result.joined).toBe(true);
    db.assertCalled(/INSERT INTO server_members/);
    db.assertCalled(/INSERT INTO member_roles/);
    db.assertCalled(/UPDATE invites SET uses/);
    expect(result.cacheKeysToInvalidate.length).toBeGreaterThan(0);
    expect(result.broadcasts!.length).toBeGreaterThanOrEqual(1);
    expect((result.broadcasts?.[0].data as any).roles[0]).toMatchObject({
      id: "role_everyone",
      is_default: true,
      name: "@everyone",
    });
  });

  it("throws 404 for invalid invite code", async () => {
    await expect(
      joinServer(db as any, "bad_code", USER_ID, "alice", null)
    ).rejects.toHaveProperty("status", 404);
  });

  it("throws 403 when invites paused", async () => {
    db.mockQuery("FROM invites WHERE code", {
      code: "abc",
      server_id: SERVER_ID,
      channel_id: null,
      max_uses: null,
      uses: 0,
      temporary: 0,
      expires_at: null,
    });
    db.mockQuery("FROM servers WHERE id", {
      id: SERVER_ID,
      name: "Test",
      invites_paused: 1,
    });

    await expect(
      joinServer(db as any, "abc", USER_ID, "alice", null)
    ).rejects.toHaveProperty("status", 403);
  });

  it("returns already_member when user is already in server", async () => {
    db.mockQuery("FROM invites WHERE code", {
      code: "abc",
      server_id: SERVER_ID,
      channel_id: null,
      max_uses: null,
      uses: 0,
      temporary: 0,
      expires_at: null,
    });
    db.mockQuery("FROM servers WHERE id", {
      id: SERVER_ID,
      name: "Test",
      invites_paused: 0,
    });
    db.mockQuery("FROM server_members WHERE server_id", { "1": 1 });

    const result = await joinServer(
      db as any,
      "abc",
      USER_ID,
      "alice",
      null
    );
    expect(result.already_member).toBe(true);
  });
});
