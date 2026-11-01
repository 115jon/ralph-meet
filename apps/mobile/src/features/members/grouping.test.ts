import { describe, expect, it } from "vitest";

import {
  BAN_MEMBERS,
  flattenGroups,
  groupMembers,
  hasPermission,
  KICK_MEMBERS,
  permissionsOf,
} from "./grouping";
import type { Role, ServerMember } from "./schema";

function role(name: string, position: number, extra: Partial<Role> = {}): Role {
  return { id: name, name, position, ...extra };
}

const everyone = role("@everyone", 0, { is_default: true });
const apex = role("Apex", 10, { permissions: KICK_MEMBERS });
const predator = role("Predator", 5);

function member(username: string, roles: Role[] = [everyone]): ServerMember {
  return { user: { id: username, username }, roles };
}

const members = [
  member("xminent", [everyone, predator]),
  member("jon", [everyone, apex, predator]),
  member("goat", [everyone, predator]),
  member("jm"),
  member("dre"),
  member("sammy", [everyone, predator]),
];

const online = new Set(["xminent", "jon", "goat", "jm"]);

describe("groupMembers", () => {
  const groups = groupMembers(members, (id) => online.has(id));

  it("branches online people by highest non-default role, then Online, then Offline", () => {
    expect(
      groups.map((g) => [g.name, g.members.map((m) => m.user.username)]),
    ).toEqual([
      ["Apex", ["jon"]],
      ["Predator", ["goat", "xminent"]],
      ["Online", ["jm"]],
      ["Offline", ["sammy", "dre"]],
    ]);
  });

  it("marks only the online branches online", () => {
    expect(groups.map((g) => g.online)).toEqual([true, true, true, false]);
  });

  it("leaves the input order alone", () => {
    expect(members.map((m) => m.user.username)).toEqual([
      "xminent",
      "jon",
      "goat",
      "jm",
      "dre",
      "sammy",
    ]);
  });

  it("has no Offline branch when everyone is online", () => {
    const all = groupMembers(members, () => true);
    expect(all.some((g) => g.key === "offline")).toBe(false);
  });
});

describe("flattenGroups", () => {
  it("puts a header with its count before each branch's rows", () => {
    const items = flattenGroups(groupMembers(members, (id) => online.has(id)));
    expect(items[0]).toMatchObject({ type: "header", name: "Apex", count: 1 });
    expect(items[1]).toMatchObject({ type: "member", online: true });
    expect(items.filter((i) => i.type === "header")).toHaveLength(4);
    expect(new Set(items.map((i) => i.key)).size).toBe(items.length);
  });
});

describe("permissions", () => {
  it("ORs every role's bits for the user", () => {
    const total = permissionsOf(members, "jon");
    expect(hasPermission(total, KICK_MEMBERS)).toBe(true);
    expect(hasPermission(total, BAN_MEMBERS)).toBe(false);
  });

  it("lets an administrator do anything", () => {
    const admin = [member("boss", [role("Admin", 20, { permissions: 1 })])];
    expect(hasPermission(permissionsOf(admin, "boss"), BAN_MEMBERS)).toBe(true);
  });

  it("grants nothing to someone not in the list", () => {
    expect(permissionsOf(members, "stranger")).toBe(0);
  });
});
