import type { D1Database } from "@cloudflare/workers-types";
import { describe, expect, it } from "vitest";

import {
  resolveChannelAccessForUsers,
  type BatchedChannelAccessDecision,
} from "../channel-access";
import { PERMISSIONS } from "../permissions";

interface ChannelRow {
  id: string;
  server_id: string | null;
  channel_type: string;
}

interface RoleFixture {
  id: string;
  permissions: number;
  is_default: number;
}

interface OverrideFixture {
  target_id: string;
  target_type: "role" | "user";
  allow: number;
  deny: number;
}

interface ServerUserFixture {
  member: boolean;
  roles: RoleFixture[];
  overrides?: OverrideFixture[];
}

interface QueryCall {
  sql: string;
  bindings: unknown[];
  method: "all" | "first";
}

interface TestPreparedStatement {
  bind(...values: unknown[]): TestPreparedStatement;
  all<T>(): Promise<{ results: T[] }>;
  first<T>(): Promise<T | null>;
}

interface TestD1Options {
  metadata: ChannelRow | null;
  failMetadata?: boolean;
  dmRecipients?: readonly string[];
  serverUsers?: ReadonlyMap<string, ServerUserFixture>;
  failChunksStartingWith?: ReadonlySet<string>;
  delayMs?: number;
}

class SequentialD1Double {
  readonly calls: QueryCall[] = [];
  maxActiveQueries = 0;

  private activeQueries = 0;
  private readonly metadata: ChannelRow | null;
  private readonly failMetadata: boolean;
  private readonly dmRecipients: ReadonlySet<string>;
  private readonly serverUsers: ReadonlyMap<string, ServerUserFixture>;
  private readonly failChunksStartingWith: ReadonlySet<string>;
  private readonly delayMs: number;

  constructor(options: TestD1Options) {
    this.metadata = options.metadata;
    this.failMetadata = options.failMetadata ?? false;
    this.dmRecipients = new Set(options.dmRecipients ?? []);
    this.serverUsers = options.serverUsers ?? new Map();
    this.failChunksStartingWith = options.failChunksStartingWith ?? new Set();
    this.delayMs = options.delayMs ?? 0;
  }

  prepare(sql: string): TestPreparedStatement {
    let bindings: unknown[] = [];
    const statement: TestPreparedStatement = {
      bind: (...values) => {
        bindings = values;
        return statement;
      },
      all: async <T>() => {
        const response = await this.execute(sql, bindings, "all");
        return response as { results: T[] };
      },
      first: async <T>() => {
        const response = await this.execute(sql, bindings, "first");
        return response as T | null;
      },
    };
    return statement;
  }

  asD1(): D1Database {
    return this as unknown as D1Database;
  }

  private async execute(
    sql: string,
    bindings: unknown[],
    method: QueryCall["method"],
  ): Promise<unknown> {
    this.calls.push({ sql, bindings: [...bindings], method });
    this.activeQueries += 1;
    this.maxActiveQueries = Math.max(this.maxActiveQueries, this.activeQueries);

    try {
      if (this.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.delayMs));
      }

      if (method === "first") {
        if (this.failMetadata) throw new Error("failed metadata");
        return this.metadata;
      }

      const firstUserId = bindings.at(
        sql.includes("FROM dm_recipients") ? 1 : 2,
      );
      if (
        typeof firstUserId === "string" &&
        this.failChunksStartingWith.has(firstUserId)
      ) {
        throw new Error(`failed chunk ${firstUserId}`);
      }

      if (sql.includes("FROM dm_recipients")) {
        const userIds = bindings.slice(1).filter(isString);
        return {
          results: userIds
            .filter((userId) => this.dmRecipients.has(userId))
            .map((user_id) => ({ user_id })),
        };
      }

      if (sql.includes("FROM server_members")) {
        const userIds = bindings.slice(2).filter(isString);
        const results: Record<string, unknown>[] = [];

        for (const userId of userIds) {
          const fixture = this.serverUsers.get(userId);
          if (!fixture?.member) continue;

          for (const role of fixture.roles) {
            const matchingOverrides = (fixture.overrides ?? []).filter(
              (override) =>
                (override.target_type === "role" &&
                  override.target_id === role.id) ||
                (override.target_type === "user" &&
                  override.target_id === userId),
            );
            const overrides =
              matchingOverrides.length > 0 ? matchingOverrides : [null];

            for (const override of overrides) {
              results.push({
                user_id: userId,
                role_id: role.id,
                role_permissions: role.permissions,
                role_position: 0,
                role_is_default: role.is_default,
                override_target_id: override?.target_id ?? null,
                override_target_type: override?.target_type ?? null,
                override_allow: override?.allow ?? null,
                override_deny: override?.deny ?? null,
              });
            }
          }
        }

        return { results };
      }

      return { results: [] };
    } finally {
      this.activeQueries -= 1;
    }
  }
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function decision(
  decisions: ReadonlyMap<string, BatchedChannelAccessDecision>,
  userId: string,
): BatchedChannelAccessDecision | undefined {
  return decisions.get(userId);
}

function serverFixtureMap(
  entries: Array<[string, ServerUserFixture]>,
): ReadonlyMap<string, ServerUserFixture> {
  return new Map(entries);
}

function viewRole(id: string, isDefault = false): RoleFixture {
  return {
    id,
    permissions: PERMISSIONS.VIEW_CHANNELS,
    is_default: isDefault ? 1 : 0,
  };
}

describe("resolveChannelAccessForUsers", () => {
  it("returns no decisions and performs no query for empty input", async () => {
    const db = new SequentialD1Double({ metadata: null });

    const decisions = await resolveChannelAccessForUsers(
      db.asD1(),
      "channel-1",
      [],
    );

    expect(decisions).toEqual(new Map());
    expect(db.calls).toHaveLength(0);
  });

  it("normalizes and deduplicates non-empty user IDs", async () => {
    const db = new SequentialD1Double({
      metadata: { id: "dm-1", server_id: null, channel_type: "dm" },
      dmRecipients: ["user-1"],
    });

    const decisions = await resolveChannelAccessForUsers(db.asD1(), "dm-1", [
      " user-1 ",
      "user-1",
      "",
      "   ",
    ]);

    expect([...decisions.keys()]).toEqual(["user-1"]);
    expect(decision(decisions, "user-1")).toEqual({
      kind: "allowed",
      permissions: null,
    });
    expect(db.calls.filter((call) => call.method === "all")).toHaveLength(1);
  });

  it("denies every user when the channel is missing", async () => {
    const db = new SequentialD1Double({ metadata: null });

    const decisions = await resolveChannelAccessForUsers(
      db.asD1(),
      "missing-channel",
      ["user-1", "user-2", "user-1"],
    );

    expect(decisions).toEqual(
      new Map([
        ["user-1", { kind: "denied", permissions: null }],
        ["user-2", { kind: "denied", permissions: null }],
      ]),
    );
    expect(db.calls).toHaveLength(1);
  });

  it("fails closed for every user when metadata lookup fails", async () => {
    const db = new SequentialD1Double({
      metadata: null,
      failMetadata: true,
    });

    const decisions = await resolveChannelAccessForUsers(
      db.asD1(),
      "channel-1",
      ["user-1", "user-2"],
    );

    expect(decisions).toEqual(
      new Map([
        ["user-1", { kind: "error" }],
        ["user-2", { kind: "error" }],
      ]),
    );
    expect(db.calls).toHaveLength(1);
  });

  it("allows DM recipients and denies non-recipients without reading server data", async () => {
    const db = new SequentialD1Double({
      metadata: { id: "dm-1", server_id: null, channel_type: "dm" },
      dmRecipients: ["user-allowed"],
      serverUsers: serverFixtureMap([
        ["user-denied", { member: true, roles: [] }],
      ]),
    });

    const decisions = await resolveChannelAccessForUsers(db.asD1(), "dm-1", [
      "user-allowed",
      "user-denied",
    ]);

    expect(decision(decisions, "user-allowed")).toEqual({
      kind: "allowed",
      permissions: null,
    });
    expect(decision(decisions, "user-denied")).toEqual({
      kind: "denied",
      permissions: null,
    });
    expect(
      db.calls.some((call) => call.sql.includes("FROM server_members")),
    ).toBe(false);
  });

  it.each([99, 100])(
    "keeps DM chunks within 100 bindings for %s users",
    async (userCount) => {
      const userIds = Array.from(
        { length: userCount },
        (_, index) => `dm-user-${index}`,
      );
      const db = new SequentialD1Double({
        metadata: { id: "dm-1", server_id: null, channel_type: "dm" },
        dmRecipients: userIds,
      });

      const decisions = await resolveChannelAccessForUsers(
        db.asD1(),
        "dm-1",
        userIds,
      );

      expect(decisions.size).toBe(userCount);
      expect(
        userIds.every(
          (userId) => decision(decisions, userId)?.kind === "allowed",
        ),
      ).toBe(true);
      const recipientCalls = db.calls.filter((call) => call.method === "all");
      expect(recipientCalls).toHaveLength(userCount === 99 ? 1 : 2);
      expect(recipientCalls.every((call) => call.bindings.length <= 100)).toBe(
        true,
      );
      expect(recipientCalls.map((call) => call.bindings.length)).toEqual(
        userCount === 99 ? [100] : [100, 2],
      );
      expect(db.maxActiveQueries).toBe(1);
    },
  );

  it("fails a DM middle chunk closed and continues to later chunks", async () => {
    const userIds = Array.from(
      { length: 297 },
      (_, index) => `dm-user-${index}`,
    );
    const db = new SequentialD1Double({
      metadata: { id: "dm-1", server_id: null, channel_type: "dm" },
      dmRecipients: userIds,
      failChunksStartingWith: new Set([userIds[99]]),
      delayMs: 1,
    });

    const decisions = await resolveChannelAccessForUsers(
      db.asD1(),
      "dm-1",
      userIds,
    );

    expect(decision(decisions, userIds[0])).toEqual({
      kind: "allowed",
      permissions: null,
    });
    expect(decision(decisions, userIds[99])).toEqual({ kind: "error" });
    expect(decision(decisions, userIds[198])).toEqual({
      kind: "allowed",
      permissions: null,
    });
    expect(db.calls.filter((call) => call.method === "all")).toHaveLength(3);
    expect(db.maxActiveQueries).toBe(1);
  });

  it.each([98, 99])(
    "keeps server chunks within 100 bindings for %s users",
    async (userCount) => {
      const userIds = Array.from(
        { length: userCount },
        (_, index) => `server-user-${index}`,
      );
      const db = new SequentialD1Double({
        metadata: {
          id: "channel-1",
          server_id: "server-1",
          channel_type: "text",
        },
        serverUsers: serverFixtureMap(
          userIds.map((userId) => [
            userId,
            { member: true, roles: [viewRole("everyone", true)] },
          ]),
        ),
      });

      const decisions = await resolveChannelAccessForUsers(
        db.asD1(),
        "channel-1",
        userIds,
      );

      expect(decisions.size).toBe(userCount);
      expect(
        userIds.every(
          (userId) => decision(decisions, userId)?.kind === "allowed",
        ),
      ).toBe(true);
      const serverCalls = db.calls.filter((call) => call.method === "all");
      expect(serverCalls).toHaveLength(userCount === 98 ? 1 : 2);
      expect(serverCalls.every((call) => call.bindings.length <= 100)).toBe(
        true,
      );
      expect(serverCalls.map((call) => call.bindings.length)).toEqual(
        userCount === 98 ? [100] : [100, 3],
      );
      expect(db.maxActiveQueries).toBe(1);
    },
  );

  it("denies non-members and members without roles", async () => {
    const db = new SequentialD1Double({
      metadata: {
        id: "channel-1",
        server_id: "server-1",
        channel_type: "text",
      },
      serverUsers: serverFixtureMap([
        ["outsider", { member: false, roles: [] }],
        ["no-role", { member: true, roles: [] }],
        ["member", { member: true, roles: [viewRole("everyone", true)] }],
      ]),
    });

    const decisions = await resolveChannelAccessForUsers(
      db.asD1(),
      "channel-1",
      ["outsider", "no-role", "member"],
    );

    expect(decision(decisions, "outsider")).toEqual({
      kind: "denied",
      permissions: null,
    });
    expect(decision(decisions, "no-role")).toEqual({
      kind: "denied",
      permissions: null,
    });
    expect(decision(decisions, "member")).toEqual({
      kind: "allowed",
      permissions: PERMISSIONS.VIEW_CHANNELS,
    });
  });

  it("allows administrator and owner-role access without an owner special case", async () => {
    const db = new SequentialD1Double({
      metadata: {
        id: "channel-1",
        server_id: "server-1",
        channel_type: "text",
      },
      serverUsers: serverFixtureMap([
        [
          "administrator",
          {
            member: true,
            roles: [
              {
                id: "admin",
                permissions: PERMISSIONS.ADMINISTRATOR,
                is_default: 0,
              },
            ],
            overrides: [
              {
                target_id: "administrator",
                target_type: "user",
                allow: 0,
                deny: PERMISSIONS.VIEW_CHANNELS,
              },
            ],
          },
        ],
        [
          "owner",
          {
            member: true,
            roles: [
              {
                id: "owner-role",
                permissions: PERMISSIONS.ADMINISTRATOR,
                is_default: 0,
              },
            ],
          },
        ],
      ]),
    });

    const decisions = await resolveChannelAccessForUsers(
      db.asD1(),
      "channel-1",
      ["administrator", "owner"],
    );

    expect(decision(decisions, "administrator")).toEqual({
      kind: "allowed",
      permissions: PERMISSIONS.ADMINISTRATOR,
    });
    expect(decision(decisions, "owner")).toEqual({
      kind: "allowed",
      permissions: PERMISSIONS.ADMINISTRATOR,
    });
    expect(db.calls.every((call) => !call.sql.includes("servers"))).toBe(true);
  });

  it("applies everyone, aggregate role, and member overrides in order", async () => {
    const db = new SequentialD1Double({
      metadata: {
        id: "channel-1",
        server_id: "server-1",
        channel_type: "text",
      },
      serverUsers: serverFixtureMap([
        [
          "precedence",
          {
            member: true,
            roles: [
              {
                id: "everyone",
                permissions: PERMISSIONS.VIEW_CHANNELS,
                is_default: 1,
              },
              { id: "role-a", permissions: 0, is_default: 0 },
              { id: "role-b", permissions: 0, is_default: 0 },
            ],
            overrides: [
              {
                target_id: "everyone",
                target_type: "role",
                allow: 0,
                deny: PERMISSIONS.VIEW_CHANNELS,
              },
              {
                target_id: "role-a",
                target_type: "role",
                allow: PERMISSIONS.VIEW_CHANNELS,
                deny: 0,
              },
              {
                target_id: "role-b",
                target_type: "role",
                allow: PERMISSIONS.SEND_MESSAGES,
                deny: PERMISSIONS.VIEW_CHANNELS,
              },
              {
                target_id: "precedence",
                target_type: "user",
                allow: PERMISSIONS.VIEW_CHANNELS,
                deny: 0,
              },
            ],
          },
        ],
        [
          "hidden",
          {
            member: true,
            roles: [viewRole("everyone", true)],
            overrides: [
              {
                target_id: "hidden",
                target_type: "user",
                allow: 0,
                deny: PERMISSIONS.VIEW_CHANNELS,
              },
            ],
          },
        ],
      ]),
    });

    const decisions = await resolveChannelAccessForUsers(
      db.asD1(),
      "channel-1",
      ["precedence", "hidden"],
    );

    expect(decision(decisions, "precedence")).toEqual({
      kind: "allowed",
      permissions: PERMISSIONS.VIEW_CHANNELS | PERMISSIONS.SEND_MESSAGES,
    });
    expect(decision(decisions, "hidden")).toEqual({
      kind: "denied",
      permissions: 0,
    });
  });

  it("fails a server chunk closed and continues to later chunks", async () => {
    const userIds = Array.from(
      { length: 197 },
      (_, index) => `server-user-${index}`,
    );
    const db = new SequentialD1Double({
      metadata: {
        id: "channel-1",
        server_id: "server-1",
        channel_type: "text",
      },
      serverUsers: serverFixtureMap(
        userIds.map((userId) => [
          userId,
          { member: true, roles: [viewRole("everyone", true)] },
        ]),
      ),
      failChunksStartingWith: new Set([userIds[98]]),
    });

    const decisions = await resolveChannelAccessForUsers(
      db.asD1(),
      "channel-1",
      userIds,
    );

    expect(decision(decisions, userIds[0])?.kind).toBe("allowed");
    expect(decision(decisions, userIds[98])).toEqual({ kind: "error" });
    expect(decision(decisions, userIds[196])?.kind).toBe("allowed");
    expect(db.calls.filter((call) => call.method === "all")).toHaveLength(3);
    expect(db.maxActiveQueries).toBe(1);
  });
});
