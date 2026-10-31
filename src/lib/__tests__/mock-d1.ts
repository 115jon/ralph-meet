/**
 * MockD1Database — test double for Cloudflare D1's prepare/bind/all/first/run API.
 *
 * Usage:
 * ```ts
 * const db = createMockD1();
 * db.mockQuery(/SELECT.*FROM servers/, { results: [{ id: "s1", name: "Test" }] });
 *
 * const service = new ServerService();
 * const result = await service.listServers(db as any, "user1");
 * db.assertCalledWith(/SELECT.*FROM servers/, ["user1"]);
 * ```
 *
 * A statement's SQL text says what it does; its bindings say to which rows.
 * `deleteChannel` deleting the server id instead of the channel id has the
 * same SQL text, so a test that only matches the text cannot fail on it.
 * `assertCalledWith` therefore compares the bindings exactly and in order
 * (values may be vitest asymmetric matchers such as `expect.any(String)`), and
 * `assertCalled` refuses INSERT, UPDATE and DELETE statements, which must
 * always be asserted with their bound values.
 */

import { expect } from "vitest";

interface D1Result {
  results?: Record<string, unknown>[];
  success?: boolean;
  meta?: Record<string, unknown>;
}

interface QueryCall {
  sql: string;
  bindings: unknown[];
  method: "all" | "first" | "run";
}

interface MockQueryRule {
  pattern: RegExp | string;
  response: D1Result | Record<string, unknown> | null;
  /** If set, only match when bindings include these values */
  bindingsMatch?: unknown[];
}

export interface MockD1 {
  prepare(sql: string): MockD1PreparedStatement;
  batch(stmts: MockD1PreparedStatement[]): Promise<D1Result[]>;

  // ── Test helpers ──────────────────────────────────────────────────────
  /** Register a mock response for queries matching a pattern */
  mockQuery(
    pattern: RegExp | string,
    response: D1Result | Record<string, unknown> | null,
    bindingsMatch?: unknown[],
  ): void;

  /** All recorded query calls */
  readonly calls: ReadonlyArray<QueryCall>;

  /**
   * Assert a read (SELECT) matching the pattern was run. Throws when the
   * match is a write: use `assertCalledWith` so the bound ids are checked too.
   */
  assertCalled(pattern: RegExp | string): void;

  /**
   * Assert one query matching the pattern ran with exactly these bindings, in
   * this order. Entries may be asymmetric matchers (`expect.any(String)`).
   */
  assertCalledWith(
    pattern: RegExp | string,
    bindings: readonly unknown[],
  ): void;

  /** Assert a query matching the pattern was NOT called */
  assertNotCalled(pattern: RegExp | string): void;

  /** Get all calls matching a pattern */
  getCalls(pattern: RegExp | string): QueryCall[];

  /** Reset all mocks and recorded calls */
  reset(): void;
}

interface MockD1PreparedStatement {
  bind(...values: unknown[]): MockD1PreparedStatement;
  all(): Promise<D1Result>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<D1Result>;

  // Internal tracking
  _sql: string;
  _bindings: unknown[];
}

function matchesPattern(sql: string, pattern: RegExp | string): boolean {
  if (typeof pattern === "string") {
    return sql.includes(pattern);
  }
  return pattern.test(sql);
}

/** Whether the bindings contain every expected value (response routing). */
function matchesBindings(actual: unknown[], expected?: unknown[]): boolean {
  if (!expected) return true;
  return expected.every((exp) => actual.includes(exp));
}

/** Exact, ordered comparison; expected entries may be asymmetric matchers. */
function bindingsEqual(
  actual: readonly unknown[],
  expected: readonly unknown[],
): boolean {
  try {
    expect(actual).toEqual(expected);
    return true;
  } catch {
    return false;
  }
}

/**
 * Matchers for bound values the service generates itself (`crypto.randomUUID()`
 * ids, `new Date().toISOString()` timestamps). Every other bound value should
 * be spelled out.
 */
export const anyId = () => expect.stringMatching(/^[0-9a-f-]{36}$/);
export const anyTimestamp = () =>
  expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

const WRITE_STATEMENT = /^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i;

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function createMockD1(): MockD1 {
  const rules: MockQueryRule[] = [];
  const calls: QueryCall[] = [];

  function findResponse(
    sql: string,
    bindings: unknown[],
  ): D1Result | Record<string, unknown> | null | undefined {
    // Search in reverse so more recently added rules take priority
    for (let i = rules.length - 1; i >= 0; i--) {
      const rule = rules[i];
      if (
        matchesPattern(sql, rule.pattern) &&
        matchesBindings(bindings, rule.bindingsMatch)
      ) {
        return rule.response;
      }
    }
    return undefined; // No matching rule
  }

  function createStatement(sql: string): MockD1PreparedStatement {
    let bindings: unknown[] = [];

    const stmt: MockD1PreparedStatement = {
      _sql: sql,
      _bindings: bindings,

      bind(...values: unknown[]) {
        bindings = values;
        stmt._bindings = values;
        return stmt;
      },

      async all(): Promise<D1Result> {
        calls.push({ sql, bindings, method: "all" });
        const response = findResponse(sql, bindings);
        if (response === undefined) {
          // Default: return empty results
          return { results: [], success: true };
        }
        if (response === null) {
          return { results: [], success: true };
        }
        // If response has a `results` key, treat as D1Result
        if ("results" in response) {
          return response as any;
        }
        // Otherwise wrap it
        return {
          results: [response as Record<string, unknown>],
          success: true,
        };
      },

      async first<T = Record<string, unknown>>(): Promise<T | null> {
        calls.push({ sql, bindings, method: "first" });
        const response = findResponse(sql, bindings);
        if (response === undefined || response === null) {
          return null;
        }
        if ("results" in response) {
          const results = (response as D1Result).results;
          return (results?.[0] as T) ?? null;
        }
        return response as any;
      },

      async run(): Promise<D1Result> {
        calls.push({ sql, bindings, method: "run" });
        const response = findResponse(sql, bindings);
        if (response && ("meta" in response || "results" in response)) {
          return response as D1Result;
        }
        return { success: true };
      },
    };

    return stmt;
  }

  return {
    prepare(sql: string) {
      return createStatement(sql);
    },

    async batch(stmts: MockD1PreparedStatement[]): Promise<D1Result[]> {
      const results: D1Result[] = [];
      for (const stmt of stmts) {
        const result = await stmt.run();
        results.push(result);
      }
      return results;
    },

    mockQuery(
      pattern: RegExp | string,
      response: D1Result | Record<string, unknown> | null,
      bindingsMatch?: unknown[],
    ) {
      rules.push({ pattern, response, bindingsMatch });
    },

    get calls() {
      return calls;
    },

    assertCalled(pattern: RegExp | string) {
      const matching = calls.filter((c) => matchesPattern(c.sql, pattern));
      if (matching.length === 0) {
        const allSqls = calls.map((c) => `  - ${c.sql}`).join("\n");
        throw new Error(
          `Expected query matching ${pattern} to have been called.\nActual queries:\n${allSqls || "  (none)"}`,
        );
      }
      const write = matching.find((c) => WRITE_STATEMENT.test(c.sql));
      if (write) {
        throw new Error(
          `assertCalled(${pattern}) matched a write (${write.sql.trim().slice(0, 60)}...). ` +
            `Assert writes with assertCalledWith(pattern, bindings) so the bound ids and values are checked.`,
        );
      }
    },

    assertCalledWith(
      pattern: RegExp | string,
      expectedBindings: readonly unknown[],
    ) {
      const matching = calls.filter((c) => matchesPattern(c.sql, pattern));
      if (!matching.some((c) => bindingsEqual(c.bindings, expectedBindings))) {
        const details = matching.length
          ? matching
              .map((c) => `  bindings: ${safeJson(c.bindings)}`)
              .join("\n")
          : "  (no matching queries found)";
        throw new Error(
          `Expected query matching ${pattern} to have been called with exactly ${safeJson(expectedBindings)}.\nMatching queries:\n${details}`,
        );
      }
    },

    assertNotCalled(pattern: RegExp | string) {
      const found = calls.some((c) => matchesPattern(c.sql, pattern));
      if (found) {
        throw new Error(
          `Expected query matching ${pattern} to NOT have been called, but it was.`,
        );
      }
    },

    getCalls(pattern: RegExp | string): QueryCall[] {
      return calls.filter((c) => matchesPattern(c.sql, pattern));
    },

    reset() {
      rules.length = 0;
      calls.length = 0;
    },
  };
}
