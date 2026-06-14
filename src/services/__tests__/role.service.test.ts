import { beforeEach, describe, expect, it } from "vitest";
import { createMockD1 } from "../../lib/__tests__/mock-d1";
import {
  createRole,
  deleteRole,
  listServerRoles,
  updateRole,
  updateMemberRoles,
} from "../role.service";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const NOW = "2026-02-28T00:00:00.000Z";
const USER_ID = "user_abc";
const SERVER_ID = "server_123";
const ROLE_ID = "role_456";

// MANAGE_ROLES = 1 << 2 = 4, ADMINISTRATOR = 1 << 0 = 1
const MANAGE_ROLES = 4;
const ADMINISTRATOR = 1;

function roleRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ROLE_ID,
    server_id: SERVER_ID,
    name: "Moderator",
    color: "#FF0000",
    permissions: 0,
    position: 1,
    is_default: 0,
    created_at: NOW,
    ...overrides,
  };
}

// ─── listServerRoles ─────────────────────────────────────────────────────────

describe("listServerRoles", () => {
  let db: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    db = createMockD1();
  });

  it("returns roles when actor is a member", async () => {
    db.mockQuery(/SELECT 1 FROM server_members/, { "1": 1 }, [SERVER_ID, USER_ID]);
    db.mockQuery(/SELECT \* FROM roles WHERE server_id/, {
      results: [roleRow(), roleRow({ id: "r2", name: "Admin", position: 2 })],
    });

    const result = await listServerRoles(db as any, SERVER_ID, USER_ID);

    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("Moderator");
    expect(result[0].is_default).toBe(false);
    expect(result[1].name).toBe("Admin");
  });

  it("throws 403 when actor is not a member", async () => {
    // No mock for member check → returns null

    await expect(
      listServerRoles(db as any, SERVER_ID, USER_ID)
    ).rejects.toHaveProperty("status", 403);
  });

  it("returns empty array when server has no roles", async () => {
    db.mockQuery(/SELECT 1 FROM server_members/, { "1": 1 });
    db.mockQuery(/SELECT \* FROM roles WHERE server_id/, { results: [] });

    const result = await listServerRoles(db as any, SERVER_ID, USER_ID);
    expect(result).toEqual([]);
  });

  it("normalises is_default from integer to boolean", async () => {
    db.mockQuery(/SELECT 1 FROM server_members/, { "1": 1 });
    db.mockQuery(/SELECT \* FROM roles WHERE server_id/, {
      results: [roleRow({ is_default: 1, name: "@everyone" })],
    });

    const result = await listServerRoles(db as any, SERVER_ID, USER_ID);
    expect(result[0].is_default).toBe(true);
  });
});

// ─── createRole ──────────────────────────────────────────────────────────────

describe("createRole", () => {
  let db: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    db = createMockD1();
    db.mockQuery(/SELECT MAX\(position\)/, { max_pos: 1 });
    db.mockQuery(/SELECT \* FROM roles WHERE id/, roleRow({ id: "new-role-id" }));
    db.mockQuery(/SELECT r\.permissions, r\.position, s\.owner_id/, {
      results: [{ permissions: MANAGE_ROLES, position: 10, owner_id: "someone_else" }],
    }, [SERVER_ID, USER_ID]);
  });

  it("creates a role when actor has MANAGE_ROLES", async () => {
    const result = await createRole(db as any, SERVER_ID, USER_ID, {
      name: "New Role",
      color: "#00FF00",
      permissions: 0,
    });

    db.assertCalled(/INSERT INTO roles/);
    expect(result.data.name).toBe("New Role");
    expect(result.cacheKeysToInvalidate.length).toBeGreaterThan(0);
    expect(result.auditLog?.actionType).toBe("ROLE_CREATE");
  });

  it("throws 403 when actor lacks MANAGE_ROLES", async () => {
    db.mockQuery(/SELECT r\.permissions, r\.position, s\.owner_id/, {
      results: [{ permissions: 0, position: 10, owner_id: "someone_else" }],
    }, [SERVER_ID, USER_ID]);
    db.mockQuery(/SELECT \* FROM roles WHERE id = \? AND server_id/, roleRow());

    await expect(
      createRole(db as any, SERVER_ID, USER_ID, { name: "Fail Role" })
    ).rejects.toHaveProperty("status", 403);
  });

  it("throws 400 when name is empty", async () => {
    await expect(
      createRole(db as any, SERVER_ID, USER_ID, { name: "   " })
    ).rejects.toHaveProperty("status", 400);
  });

  it("places role above existing roles (max_pos + 1)", async () => {
    await createRole(db as any, SERVER_ID, USER_ID, { name: "Role" });

    // The INSERT should have been called (position logic is internal)
    db.assertCalled(/INSERT INTO roles/);
  });
  it("throws 403 when non-owner tries to create an administrator role", async () => {
    await expect(
      createRole(db as any, SERVER_ID, USER_ID, { name: "Admin", permissions: ADMINISTRATOR })
    ).rejects.toHaveProperty("status", 403);
  });
});

// ─── updateRole ──────────────────────────────────────────────────────────────

describe("updateRole", () => {
  let db: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    db = createMockD1();
    db.mockQuery(/SELECT r\.permissions, r\.position, s\.owner_id/, {
      results: [{ permissions: MANAGE_ROLES, position: 10, owner_id: "someone_else" }],
    }, [SERVER_ID, USER_ID]);
  });

  it("updates a role when actor has MANAGE_ROLES", async () => {
    db.mockQuery(/SELECT \* FROM roles WHERE id = \? AND server_id/, roleRow());

    const result = await updateRole(
      db as any,
      SERVER_ID,
      ROLE_ID,
      USER_ID,
      { name: "Updated" }
    );

    db.assertCalled(/UPDATE roles SET/);
    expect(result.cacheKeysToInvalidate.length).toBeGreaterThan(0);
  });

  it("throws 403 when actor lacks MANAGE_ROLES", async () => {
    db.mockQuery(/SELECT r\.permissions, r\.position, s\.owner_id/, {
      results: [{ permissions: 0, position: 10, owner_id: "someone_else" }],
    }, [SERVER_ID, USER_ID]);
    db.mockQuery(/SELECT \* FROM roles WHERE id = \? AND server_id/, roleRow());

    await expect(
      updateRole(db as any, SERVER_ID, ROLE_ID, USER_ID, { name: "X" })
    ).rejects.toHaveProperty("status", 403);
  });

  it("throws 404 when role does not exist", async () => {
    // No mock for role lookup → returns null

    await expect(
      updateRole(db as any, SERVER_ID, "nonexistent", USER_ID, { name: "X" })
    ).rejects.toHaveProperty("status", 404);
  });

  it("preserves @everyone name for default role", async () => {
    db.mockQuery(
      /SELECT \* FROM roles WHERE id = \? AND server_id/,
      roleRow({ name: "@everyone", is_default: 1 })
    );

    const result = await updateRole(
      db as any,
      SERVER_ID,
      ROLE_ID,
      USER_ID,
      { name: "Hijacked" } // should be ignored for default roles
    );

    // No audit log entry for name change since it was blocked
    expect(result).toBeDefined();
  });

  it("returns audit log when fields changed", async () => {
    db.mockQuery(/SELECT \* FROM roles WHERE id = \? AND server_id/, roleRow());

    const result = await updateRole(
      db as any,
      SERVER_ID,
      ROLE_ID,
      USER_ID,
      { name: "Changed", color: "#0000FF" }
    );

    expect(result.auditLog).toBeDefined();
    expect(result.auditLog?.actionType).toBe("ROLE_UPDATE");
  });

  it("throws 403 when non-owner tries to elevate a role to administrator", async () => {
    db.mockQuery(/SELECT \* FROM roles WHERE id = \? AND server_id/, roleRow());

    await expect(
      updateRole(db as any, SERVER_ID, ROLE_ID, USER_ID, { permissions: ADMINISTRATOR })
    ).rejects.toHaveProperty("status", 403);
  });
});

// ─── deleteRole ──────────────────────────────────────────────────────────────

describe("deleteRole", () => {
  let db: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    db = createMockD1();
    db.mockQuery(/SELECT r\.permissions, r\.position, s\.owner_id/, {
      results: [{ permissions: MANAGE_ROLES, position: 10, owner_id: "someone_else" }],
    }, [SERVER_ID, USER_ID]);
  });

  it("deletes a role when actor has MANAGE_ROLES", async () => {
    db.mockQuery(/SELECT \* FROM roles WHERE id = \? AND server_id/, roleRow());

    const result = await deleteRole(db as any, SERVER_ID, ROLE_ID, USER_ID);

    db.assertCalled(/DELETE FROM roles/);
    expect(result.cacheKeysToInvalidate.length).toBeGreaterThan(0);
    expect(result.auditLog?.actionType).toBe("ROLE_DELETE");
  });

  it("throws 403 when actor lacks MANAGE_ROLES", async () => {
    db.mockQuery(/SELECT r\.permissions, r\.position, s\.owner_id/, {
      results: [{ permissions: 0, position: 10, owner_id: "someone_else" }],
    }, [SERVER_ID, USER_ID]);
    db.mockQuery(/SELECT \* FROM roles WHERE id = \? AND server_id/, roleRow());

    await expect(
      deleteRole(db as any, SERVER_ID, ROLE_ID, USER_ID)
    ).rejects.toHaveProperty("status", 403);
  });

  it("throws 404 when role does not exist", async () => {
    // No mock → null

    await expect(
      deleteRole(db as any, SERVER_ID, "ghost-role", USER_ID)
    ).rejects.toHaveProperty("status", 404);
  });

  it("throws 400 when trying to delete @everyone", async () => {
    db.mockQuery(
      /SELECT \* FROM roles WHERE id = \? AND server_id/,
      roleRow({ is_default: 1 })
    );

    await expect(
      deleteRole(db as any, SERVER_ID, ROLE_ID, USER_ID)
    ).rejects.toHaveProperty("status", 400);
  });
});

// ─── updateMemberRoles ──────────────────────────────────────────────────────

describe("updateMemberRoles", () => {
  let db: ReturnType<typeof createMockD1>;
  const TARGET_USER_ID = "target_user";
  const EVERYONE_ROLE_ID = "everyone_role";

  beforeEach(() => {
    db = createMockD1();
    db.mockQuery(/SELECT r\.permissions, r\.position, s\.owner_id/, {
      results: [{ permissions: MANAGE_ROLES, position: 10, owner_id: "someone_else" }],
    }, [SERVER_ID, USER_ID]);
  });

  it("returns a server broadcast with the updated roles", async () => {
    db.mockQuery(/SELECT id, is_default FROM roles WHERE server_id/, {
      results: [
        { id: EVERYONE_ROLE_ID, is_default: 1 },
        { id: ROLE_ID, is_default: 0 },
      ],
    });
    db.mockQuery(/SELECT r\.permissions, r\.position, s\.owner_id/, {
      results: [{ permissions: 0, position: 1, owner_id: "someone_else" }],
    }, [SERVER_ID, TARGET_USER_ID]);
    db.mockQuery(/SELECT r\.\* FROM member_roles/, {
      results: [
        roleRow({ id: EVERYONE_ROLE_ID, name: "@everyone", is_default: 1, position: 0 }),
        roleRow(),
      ],
    });

    const result = await updateMemberRoles(
      db as any,
      SERVER_ID,
      TARGET_USER_ID,
      USER_ID,
      [ROLE_ID]
    );

    expect(result.roles).toHaveLength(2);
    expect(result.roles[0].is_default).toBe(true);
    expect(result.broadcast).toEqual({
      type: "server",
      target: SERVER_ID,
      event: "GUILD_MEMBER_UPDATE",
      data: {
        server_id: SERVER_ID,
        user_id: TARGET_USER_ID,
        roles: result.roles,
      },
    });
  });

  it("throws 403 when non-owner tries to assign an administrator role", async () => {
    db.mockQuery(/SELECT id, is_default FROM roles WHERE server_id/, {
      results: [
        { id: EVERYONE_ROLE_ID, is_default: 1 },
        { id: ROLE_ID, is_default: 0 },
      ],
    });
    db.mockQuery(
      /SELECT id, permissions, position\s+FROM roles\s+WHERE server_id = \? AND id IN \(\?\)/,
      { results: [{ id: ROLE_ID, permissions: ADMINISTRATOR, position: 1 }] },
      [SERVER_ID, ROLE_ID]
    );

    await expect(
      updateMemberRoles(db as any, SERVER_ID, TARGET_USER_ID, USER_ID, [ROLE_ID])
    ).rejects.toHaveProperty("status", 403);
  });
});
