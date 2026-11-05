import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

import {
  hasServerPermission,
  isServerMember,
} from "../../src/lib/channel-access";
import { PERMISSIONS } from "../../src/lib/permissions";

// The server-scope checks VoiceRoom's soundboard makes (catalog playback of
// another member's sound needs MANAGE_SERVER; server media needs
// membership). Results match the queries VoiceRoom ran itself before.

const db = env.DB as unknown as Parameters<typeof isServerMember>[0];

async function exec(sql: string, ...bindings: unknown[]) {
  await env.DB.prepare(sql)
    .bind(...bindings)
    .run();
}

beforeAll(async () => {
  await exec(`CREATE TABLE IF NOT EXISTS server_members (
    server_id TEXT NOT NULL, user_id TEXT NOT NULL,
    PRIMARY KEY (server_id, user_id))`);
  await exec(`CREATE TABLE IF NOT EXISTS roles (
    id TEXT PRIMARY KEY, server_id TEXT NOT NULL, name TEXT NOT NULL,
    permissions INTEGER NOT NULL DEFAULT 0, position INTEGER NOT NULL DEFAULT 0,
    is_default INTEGER NOT NULL DEFAULT 0)`);
  await exec(`CREATE TABLE IF NOT EXISTS member_roles (
    server_id TEXT NOT NULL, user_id TEXT NOT NULL, role_id TEXT NOT NULL,
    PRIMARY KEY (server_id, user_id, role_id))`);
});

function ids() {
  const tag = crypto.randomUUID();
  return { server: `srv-${tag}`, other: `srv-other-${tag}`, user: `u-${tag}` };
}

async function role(id: string, serverId: string, permissions: number) {
  await exec(
    "INSERT INTO roles (id, server_id, name, permissions) VALUES (?, ?, ?, ?)",
    id,
    serverId,
    id,
    permissions,
  );
}

async function grant(serverId: string, userId: string, roleId: string) {
  await exec(
    "INSERT INTO member_roles (server_id, user_id, role_id) VALUES (?, ?, ?)",
    serverId,
    userId,
    roleId,
  );
}

/** A D1 whose every query fails. */
const brokenDb = {
  prepare() {
    throw new Error("D1 unavailable");
  },
} as unknown as typeof db;

describe("isServerMember", () => {
  it("is true for a member and false for anyone else", async () => {
    const { server, user } = ids();
    await exec(
      "INSERT INTO server_members (server_id, user_id) VALUES (?, ?)",
      server,
      user,
    );
    expect(await isServerMember(db, server, user)).toBe(true);
    expect(await isServerMember(db, server, `${user}-x`)).toBe(false);
    expect(await isServerMember(db, `${server}-x`, user)).toBe(false);
  });

  it("fails closed when D1 fails", async () => {
    expect(await isServerMember(brokenDb, "s", "u")).toBe(false);
  });
});

describe("hasServerPermission", () => {
  const MANAGE = PERMISSIONS.MANAGE_SERVER;

  it("is false for a user with no roles", async () => {
    const { server, user } = ids();
    expect(await hasServerPermission(db, server, user, MANAGE)).toBe(false);
  });

  it("is true for a role with the permission", async () => {
    const { server, user } = ids();
    await role(`r-${user}`, server, MANAGE);
    await grant(server, user, `r-${user}`);
    expect(await hasServerPermission(db, server, user, MANAGE)).toBe(true);
  });

  it("combines the user's roles", async () => {
    const { server, user } = ids();
    const want = MANAGE | PERMISSIONS.KICK_MEMBERS;
    await role(`r1-${user}`, server, MANAGE);
    await role(`r2-${user}`, server, PERMISSIONS.KICK_MEMBERS);
    await grant(server, user, `r1-${user}`);
    expect(await hasServerPermission(db, server, user, want)).toBe(false);
    await grant(server, user, `r2-${user}`);
    expect(await hasServerPermission(db, server, user, want)).toBe(true);
  });

  it("lets ADMINISTRATOR stand in for any permission", async () => {
    const { server, user } = ids();
    await role(`r-${user}`, server, PERMISSIONS.ADMINISTRATOR);
    await grant(server, user, `r-${user}`);
    expect(await hasServerPermission(db, server, user, MANAGE)).toBe(true);
  });

  it("is false for roles without the permission", async () => {
    const { server, user } = ids();
    await role(`r-${user}`, server, PERMISSIONS.SEND_MESSAGES);
    await grant(server, user, `r-${user}`);
    expect(await hasServerPermission(db, server, user, MANAGE)).toBe(false);
  });

  it("ignores a role of another server linked under this one", async () => {
    const { server, other, user } = ids();
    await role(`r-${user}`, other, MANAGE);
    await grant(server, user, `r-${user}`);
    expect(await hasServerPermission(db, server, user, MANAGE)).toBe(false);
  });

  it("counts roles in that server only", async () => {
    const { server, other, user } = ids();
    await role(`r-${user}`, other, MANAGE);
    await grant(other, user, `r-${user}`);
    expect(await hasServerPermission(db, server, user, MANAGE)).toBe(false);
    expect(await hasServerPermission(db, other, user, MANAGE)).toBe(true);
  });

  it("reads role rows alone, as VoiceRoom did (membership is checked separately)", async () => {
    const { server, user } = ids();
    await role(`r-${user}`, server, MANAGE);
    await grant(server, user, `r-${user}`);
    expect(await isServerMember(db, server, user)).toBe(false);
    expect(await hasServerPermission(db, server, user, MANAGE)).toBe(true);
  });

  it("fails closed when D1 fails", async () => {
    expect(await hasServerPermission(brokenDb, "s", "u", MANAGE)).toBe(false);
  });
});
