import { beforeEach, describe, expect, it } from "vitest";
import { createMockD1 } from "../../lib/__tests__/mock-d1";
import { ServiceError } from "../../lib/service-error";
import {
  createServer,
  deleteServer,
  kickMember,
  listServerMembers,
  listUserServers,
  searchMessages,
  updateServer,
} from "../server.service";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const NOW = "2026-02-28T00:00:00.000Z";
const USER_ID = "user_abc";
const SERVER_ID = "server_123";

function serverRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SERVER_ID,
    name: "My Server",
    owner_id: USER_ID,
    icon_url: null,
    created_at: NOW,
    ...overrides,
  };
}

function memberRow(overrides: Record<string, unknown> = {}) {
  return {
    user_id: USER_ID,
    joined_at: NOW,
    username: "testuser",
    avatar_url: null,
    bio: null,
    status: "online",
    custom_status: null,
    roles_json: "[]",
    ...overrides,
  };
}

// ─── listUserServers ─────────────────────────────────────────────────────────

describe("listUserServers", () => {
  let db: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    db = createMockD1();
  });

  it("returns servers the user is a member of", async () => {
    db.mockQuery(/SELECT s\.\* FROM servers/, {
      results: [serverRow(), serverRow({ id: "s2", name: "Second" })],
    });

    const result = await listUserServers(db as any, USER_ID);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe(SERVER_ID);
    expect(result[1].name).toBe("Second");
    db.assertCalledWith(/SELECT s\.\* FROM servers/, [USER_ID]);
  });

  it("returns empty array when user has no servers", async () => {
    db.mockQuery(/SELECT s\.\* FROM servers/, { results: [] });
    const result = await listUserServers(db as any, USER_ID);
    expect(result).toEqual([]);
  });
});

// ─── createServer ────────────────────────────────────────────────────────────

describe("createServer", () => {
  let db: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    db = createMockD1();
  });

  it("creates a server with default channels, roles, and categories", async () => {
    const result = await createServer(db as any, USER_ID, {
      name: "New Server",
    });

    expect(result.name).toBe("New Server");
    expect(result.owner_id).toBe(USER_ID);
    expect(result.icon_url).toBeNull();
    expect(result.id).toBeDefined();
    expect(result.created_at).toBeDefined();

    // Should have made a batch call (server + member + roles + categories + channels)
    db.assertCalled(/INSERT INTO servers/);
    db.assertCalled(/INSERT INTO server_members/);
    db.assertCalled(/INSERT INTO roles/);
    db.assertCalled(/INSERT INTO categories/);
    db.assertCalled(/INSERT INTO channels/);
  });

  it("creates server with icon_url when provided", async () => {
    const result = await createServer(db as any, USER_ID, {
      name: "With Icon",
      icon_url: "/api/server-icons/123.png",
    });

    expect(result.icon_url).toBe("/api/server-icons/123.png");
  });

  it("trims server name", async () => {
    const result = await createServer(db as any, USER_ID, {
      name: "  Padded Name  ",
    });
    expect(result.name).toBe("Padded Name");
  });

  it("returns the expected server shape", async () => {
    const result = await createServer(db as any, USER_ID, {
      name: "Test",
    });

    expect(result).toHaveProperty("id");
    expect(result).toHaveProperty("name");
    expect(result).toHaveProperty("owner_id");
    expect(result).toHaveProperty("icon_url");
    expect(result).toHaveProperty("created_at");
  });
});

// ─── updateServer ────────────────────────────────────────────────────────────

describe("updateServer", () => {
  let db: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    db = createMockD1();
    // Default: return updated server after update
    db.mockQuery(/SELECT \* FROM servers WHERE id/, serverRow());
    // Return member list for cache invalidation
    db.mockQuery(/SELECT user_id FROM server_members/, {
      results: [{ user_id: USER_ID }],
    });
  });

  it("updates server name", async () => {
    const result = await updateServer(db as any, SERVER_ID, USER_ID, {
      name: "New Name",
    });

    db.assertCalled(/UPDATE servers SET/);
    expect(result.data).toBeDefined();
  });

  it("updates server icon_url", async () => {
    await updateServer(db as any, SERVER_ID, USER_ID, {
      icon_url: "/new-icon.png",
    });

    db.assertCalled(/UPDATE servers SET/);
  });

  it("updates invites_paused", async () => {
    await updateServer(db as any, SERVER_ID, USER_ID, {
      invites_paused: true,
    });

    db.assertCalled(/UPDATE servers SET/);
  });

  it("throws ServiceError when no changes provided", async () => {
    await expect(
      updateServer(db as any, SERVER_ID, USER_ID, {})
    ).rejects.toThrow(ServiceError);

    await expect(
      updateServer(db as any, SERVER_ID, USER_ID, {})
    ).rejects.toHaveProperty("status", 400);
  });

  it("returns cache invalidation keys", async () => {
    const result = await updateServer(db as any, SERVER_ID, USER_ID, {
      name: "Updated",
    });

    expect(result.cacheKeysToInvalidate).toBeDefined();
    expect(result.cacheKeysToInvalidate.length).toBeGreaterThan(0);
  });

  it("returns broadcast payload", async () => {
    const result = await updateServer(db as any, SERVER_ID, USER_ID, {
      name: "Updated",
    });

    expect(result.broadcast).toBeDefined();
    expect(result.broadcast!.event).toBe("GUILD_UPDATE");
  });

  it("returns audit log entry", async () => {
    const result = await updateServer(db as any, SERVER_ID, USER_ID, {
      name: "Updated",
    });

    expect(result.auditLog).toBeDefined();
    expect(result.auditLog!.actionType).toBe("SERVER_UPDATE");
  });
});

// ─── deleteServer ────────────────────────────────────────────────────────────

describe("deleteServer", () => {
  let db: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    db = createMockD1();
  });

  it("deletes server when actor is owner", async () => {
    db.mockQuery(/SELECT owner_id FROM servers/, { owner_id: USER_ID });
    db.mockQuery(/SELECT user_id FROM server_members/, {
      results: [{ user_id: USER_ID }, { user_id: "u2" }],
    });

    const result = await deleteServer(db as any, SERVER_ID, USER_ID);

    db.assertCalled(/DELETE FROM servers WHERE id/);
    expect(result.cacheKeysToInvalidate.length).toBeGreaterThan(0);
    expect(result.broadcast).toBeDefined();
    expect(result.broadcast!.event).toBe("GUILD_DELETE");
  });

  it("throws 403 when non-owner tries to delete", async () => {
    db.mockQuery(/SELECT owner_id FROM servers/, { owner_id: "other_user" });

    await expect(
      deleteServer(db as any, SERVER_ID, USER_ID)
    ).rejects.toThrow(ServiceError);

    await expect(
      deleteServer(db as any, SERVER_ID, USER_ID)
    ).rejects.toHaveProperty("status", 403);
  });

  it("throws 403 when server not found", async () => {
    await expect(
      deleteServer(db as any, "nonexistent", USER_ID)
    ).rejects.toThrow(ServiceError);
  });
});

// ─── listServerMembers ───────────────────────────────────────────────────────

describe("listServerMembers", () => {
  let db: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    db = createMockD1();
  });

  it("returns formatted member list", async () => {
    db.mockQuery("FROM server_members sm", {
      results: [
        memberRow(),
        memberRow({ user_id: "u2", username: "bob", roles_json: "[]" }),
      ],
    });

    const result = await listServerMembers(db as any, SERVER_ID);
    expect(result).toHaveLength(2);
    expect(result[0].user.id).toBe(USER_ID);
    expect(result[0].user.username).toBe("testuser");
    expect(result[0].roles).toEqual([]);
    expect(result[1].user.id).toBe("u2");
  });

  it("parses roles_json correctly", async () => {
    const rolesJson = JSON.stringify([
      {
        id: "r1",
        server_id: SERVER_ID,
        name: "Admin",
        color: "#FF0000",
        permissions: 8,
        position: 1,
        is_default: 0,
        created_at: NOW,
      },
    ]);

    db.mockQuery("FROM server_members sm", {
      results: [memberRow({ roles_json: rolesJson })],
    });

    const result = await listServerMembers(db as any, SERVER_ID);
    expect(result[0].roles).toHaveLength(1);
    expect(result[0].roles[0].name).toBe("Admin");
    expect(result[0].roles[0].is_default).toBe(false);
  });

  it("returns empty array when no members", async () => {
    db.mockQuery("FROM server_members sm", { results: [] });
    const result = await listServerMembers(db as any, SERVER_ID);
    expect(result).toEqual([]);
  });
});

// ─── searchMessages ──────────────────────────────────────────────────────────

describe("searchMessages", () => {
  let db: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    db = createMockD1();
  });

  it("returns formatted search results with pagination", async () => {
    db.mockQuery("FROM messages m", {
      results: [
        {
          id: "m1",
          channel_id: "c1",
          author_id: USER_ID,
          content: "hello world",
          created_at: NOW,
          is_pinned: 0,
          author_username: "testuser",
          author_avatar_url: null,
          channel_name: "general",
        },
      ],
    });
    db.mockQuery(/SELECT COUNT/, { total: 1 });

    const result = await searchMessages(db as any, SERVER_ID, "hello", 25, 0);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content).toBe("hello world");
    expect(result.messages[0].author.username).toBe("testuser");
    expect(result.messages[0].is_pinned).toBe(false);
    expect(result.total).toBe(1);
    expect(result.limit).toBe(25);
    expect(result.offset).toBe(0);
  });

  it("passes LIKE query with wildcards", async () => {
    db.mockQuery("FROM messages m", { results: [] });
    db.mockQuery(/SELECT COUNT/, { total: 0 });

    await searchMessages(db as any, SERVER_ID, "test", 25, 0);

    db.assertCalledWith("FROM messages m", [SERVER_ID, "%test%"]);
  });

  it("caps limit at 50", async () => {
    db.mockQuery("FROM messages m", { results: [] });
    db.mockQuery(/SELECT COUNT/, { total: 0 });

    const result = await searchMessages(db as any, SERVER_ID, "test", 200, 0);
    expect(result.limit).toBe(50);
  });
});

// ─── kickMember ──────────────────────────────────────────────────────────────

describe("kickMember", () => {
  let db: ReturnType<typeof createMockD1>;
  // KICK_MEMBERS = 1 << 5 = 32
  const KICK_MEMBERS = 32;

  beforeEach(() => {
    db = createMockD1();
  });

  it("kicks target when actor has permission and higher role", async () => {
    // Actor has KICK_MEMBERS (32) and top role position 2
    db.mockQuery(
      "SUM(r.permissions) as total_perms, MAX(r.position) as max_position",
      { total_perms: KICK_MEMBERS, max_position: 2 },
      [SERVER_ID, USER_ID]
    );
    // Target exists as member
    db.mockQuery(
      /SELECT 1 FROM server_members/,
      { "1": 1 },
      [SERVER_ID, "target_user"]
    );
    // Target has lower role
    db.mockQuery(
      "MAX(r.position) as max_position",
      { max_position: 1 },
      [SERVER_ID, "target_user"]
    );

    const result = await kickMember(
      db as any,
      SERVER_ID,
      USER_ID,
      "target_user"
    );

    expect(result.kicked).toBe(true);
    expect(result.cacheKeysToInvalidate.length).toBeGreaterThan(0);
    expect(result.broadcast).toBeDefined();
    expect(result.broadcast!.event).toBe("GUILD_MEMBER_REMOVE");
    expect(result.auditLog).toBeDefined();
    db.assertCalled(/DELETE FROM server_members/);
  });

  it("throws 403 when actor lacks KICK_MEMBERS", async () => {
    db.mockQuery(
      "SUM(r.permissions) as total_perms, MAX(r.position) as max_position",
      { total_perms: 0, max_position: 2 },
      [SERVER_ID, USER_ID]
    );

    await expect(
      kickMember(db as any, SERVER_ID, USER_ID, "target_user")
    ).rejects.toHaveProperty("status", 403);
  });

  it("throws 404 when target is not a member", async () => {
    // Actor has permissions
    db.mockQuery(
      "SUM(r.permissions) as total_perms, MAX(r.position) as max_position",
      { total_perms: KICK_MEMBERS, max_position: 2 },
      [SERVER_ID, USER_ID]
    );
    // Target not found — no mock for SELECT 1 FROM server_members → returns null

    await expect(
      kickMember(db as any, SERVER_ID, USER_ID, "target_user")
    ).rejects.toHaveProperty("status", 404);
  });

  it("throws 403 when target has equal or higher role", async () => {
    db.mockQuery(
      "SUM(r.permissions) as total_perms, MAX(r.position) as max_position",
      { total_perms: KICK_MEMBERS, max_position: 1 },
      [SERVER_ID, USER_ID]
    );
    db.mockQuery(
      /SELECT 1 FROM server_members/,
      { "1": 1 },
      [SERVER_ID, "target_user"]
    );
    db.mockQuery(
      "MAX(r.position) as max_position",
      { max_position: 1 },
      [SERVER_ID, "target_user"]
    );

    await expect(
      kickMember(db as any, SERVER_ID, USER_ID, "target_user")
    ).rejects.toHaveProperty("status", 403);
  });
});
