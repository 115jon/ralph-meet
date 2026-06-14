import { describe, expect, it } from "vitest";

import { calculatePermissions, hasAnyPermission, hasPermission, PERMISSIONS } from "../permissions";

describe("permissions helpers", () => {
  it("combines role permissions with bitwise or", () => {
    expect(calculatePermissions([PERMISSIONS.MANAGE_SERVER, PERMISSIONS.MANAGE_SERVER])).toBe(PERMISSIONS.MANAGE_SERVER);
    expect(calculatePermissions([PERMISSIONS.ADMINISTRATOR, PERMISSIONS.ADMINISTRATOR])).toBe(PERMISSIONS.ADMINISTRATOR);
  });

  it("supports any-of permission checks", () => {
    const perms = PERMISSIONS.VIEW_AUDIT_LOG;
    expect(hasAnyPermission(perms, PERMISSIONS.MANAGE_SERVER | PERMISSIONS.VIEW_AUDIT_LOG)).toBe(true);
    expect(hasAnyPermission(perms, PERMISSIONS.MANAGE_SERVER | PERMISSIONS.BAN_MEMBERS)).toBe(false);
  });

  it("keeps administrator as implicit allow", () => {
    expect(hasPermission(PERMISSIONS.ADMINISTRATOR, PERMISSIONS.MANAGE_MESSAGES)).toBe(true);
    expect(hasAnyPermission(PERMISSIONS.ADMINISTRATOR, PERMISSIONS.MANAGE_SERVER | PERMISSIONS.VIEW_AUDIT_LOG)).toBe(true);
  });
});
