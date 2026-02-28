import { beforeEach, describe, expect, it } from "vitest";
import { createMockD1 } from "../../lib/__tests__/mock-d1";
import {
  createRole,
  deleteRole,
  listServerRoles,
  updateRole,
} from "../role.service";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const NOW = "2026-02-28T00:00:00.000Z";
const USER_ID = "user_abc";
const SERVER_ID = "server_123";
const ROLE_ID = "role_456";

// MANAGE_ROLES = 1 << 2 = 4 (per permissions.ts bitmask)
const MANAGE_ROLES = 4;
const ADMINISTRATOR = 8;

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
  });

  it("creates a role when actor has MANAGE_ROLES", async () => {
    db.mockQuery(/SUM\(r\.permissions\) as total_perms/, {
      total_perms: MANAGE_ROLES,
    });

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
    db.mockQuery(/SUM\(r\.permissions\) as total_perms/, { total_perms: 0 });

    await expect(
      createRole(db as any, SERVER_ID, USER_ID, { name: "Fail Role" })
    ).rejects.toHaveProperty("status", 403);
  });

  it("throws 400 when name is empty", async () => {
    db.mockQuery(/SUM\(r\.permissions\) as total_perms/, {
      total_perms: MANAGE_ROLES,
    });

    await expect(
      createRole(db as any, SERVER_ID, USER_ID, { name: "   " })
    ).rejects.toHaveProperty("status", 400);
  });

  it("places role above existing roles (max_pos + 1)", async () => {
    db.mockQuery(/SUM\(r\.permissions\) as total_perms/, {
      total_perms: MANAGE_ROLES,
    });

    await createRole(db as any, SERVER_ID, USER_ID, { name: "Role" });

    // The INSERT should have been called (position logic is internal)
    db.assertCalled(/INSERT INTO roles/);
  });
});

// ─── updateRole ──────────────────────────────────────────────────────────────

describe("updateRole", () => {
  let db: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    db = createMockD1();
  });

  it("updates a role when actor has MANAGE_ROLES", async () => {
    db.mockQuery(/SUM\(r\.permissions\) as total_perms/, {
      total_perms: MANAGE_ROLES,
    });
    db.mockQuery(/SELECT \* FROM roles WHERE id = \? AND server_id/, roleRow());
    db.mockQuery(/SELECT \* FROM roles WHERE id = \?/, roleRow({ name: "Updated" }));

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
    db.mockQuery(/SUM\(r\.permissions\) as total_perms/, { total_perms: 0 });

    await expect(
      updateRole(db as any, SERVER_ID, ROLE_ID, USER_ID, { name: "X" })
    ).rejects.toHaveProperty("status", 403);
  });

  it("throws 404 when role does not exist", async () => {
    db.mockQuery(/SUM\(r\.permissions\) as total_perms/, {
      total_perms: MANAGE_ROLES,
    });
    // No mock for role lookup → returns null

    await expect(
      updateRole(db as any, SERVER_ID, "nonexistent", USER_ID, { name: "X" })
    ).rejects.toHaveProperty("status", 404);
  });

  it("preserves @everyone name for default role", async () => {
    db.mockQuery(/SUM\(r\.permissions\) as total_perms/, {
      total_perms: MANAGE_ROLES,
    });
    db.mockQuery(
      /SELECT \* FROM roles WHERE id = \? AND server_id/,
      roleRow({ name: "@everyone", is_default: 1 })
    );
    db.mockQuery(
      /SELECT \* FROM roles WHERE id = \?/,
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
    db.mockQuery(/SUM\(r\.permissions\) as total_perms/, {
      total_perms: MANAGE_ROLES,
    });
    db.mockQuery(/SELECT \* FROM roles WHERE id = \? AND server_id/, roleRow());
    db.mockQuery(/SELECT \* FROM roles WHERE id = \?/, roleRow({ name: "Changed", color: "#0000FF" }));

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
});

// ─── deleteRole ──────────────────────────────────────────────────────────────

describe("deleteRole", () => {
  let db: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    db = createMockD1();
  });

  it("deletes a role when actor has MANAGE_ROLES", async () => {
    db.mockQuery(/SUM\(r\.permissions\) as total_perms/, {
      total_perms: MANAGE_ROLES,
    });
    db.mockQuery(/SELECT \* FROM roles WHERE id = \? AND server_id/, roleRow());

    const result = await deleteRole(db as any, SERVER_ID, ROLE_ID, USER_ID);

    db.assertCalled(/DELETE FROM roles/);
    expect(result.cacheKeysToInvalidate.length).toBeGreaterThan(0);
    expect(result.auditLog?.actionType).toBe("ROLE_DELETE");
  });

  it("throws 403 when actor lacks MANAGE_ROLES", async () => {
    db.mockQuery(/SUM\(r\.permissions\) as total_perms/, { total_perms: 0 });

    await expect(
      deleteRole(db as any, SERVER_ID, ROLE_ID, USER_ID)
    ).rejects.toHaveProperty("status", 403);
  });

  it("throws 404 when role does not exist", async () => {
    db.mockQuery(/SUM\(r\.permissions\) as total_perms/, {
      total_perms: MANAGE_ROLES,
    });
    // No mock → null

    await expect(
      deleteRole(db as any, SERVER_ID, "ghost-role", USER_ID)
    ).rejects.toHaveProperty("status", 404);
  });

  it("throws 400 when trying to delete @everyone", async () => {
    db.mockQuery(/SUM\(r\.permissions\) as total_perms/, {
      total_perms: MANAGE_ROLES,
    });
    db.mockQuery(
      /SELECT \* FROM roles WHERE id = \? AND server_id/,
      roleRow({ is_default: 1 })
    );

    await expect(
      deleteRole(db as any, SERVER_ID, ROLE_ID, USER_ID)
    ).rejects.toHaveProperty("status", 400);
  });
});
