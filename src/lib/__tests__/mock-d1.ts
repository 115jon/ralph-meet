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
 */

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
    bindingsMatch?: unknown[]
  ): void;

  /** All recorded query calls */
  readonly calls: ReadonlyArray<QueryCall>;

  /** Assert a query matching the pattern was called */
  assertCalled(pattern: RegExp | string): void;

  /** Assert a query matching the pattern was called with specific bindings */
  assertCalledWith(pattern: RegExp | string, bindings: unknown[]): void;

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

function matchesBindings(actual: unknown[], expected?: unknown[]): boolean {
  if (!expected) return true;
  return expected.every((exp) => actual.includes(exp));
}

export function createMockD1(): MockD1 {
  const rules: MockQueryRule[] = [];
  const calls: QueryCall[] = [];

  function findResponse(
    sql: string,
    bindings: unknown[]
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
        return { results: [response as Record<string, unknown>], success: true };
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
      bindingsMatch?: unknown[]
    ) {
      rules.push({ pattern, response, bindingsMatch });
    },

    get calls() {
      return calls;
    },

    assertCalled(pattern: RegExp | string) {
      const found = calls.some((c) => matchesPattern(c.sql, pattern));
      if (!found) {
        const allSqls = calls.map((c) => `  - ${c.sql}`).join("\n");
        throw new Error(
          `Expected query matching ${pattern} to have been called.\nActual queries:\n${allSqls || "  (none)"}`
        );
      }
    },

    assertCalledWith(pattern: RegExp | string, expectedBindings: unknown[]) {
      const found = calls.some(
        (c) =>
          matchesPattern(c.sql, pattern) &&
          matchesBindings(c.bindings, expectedBindings)
      );
      if (!found) {
        const matching = calls.filter((c) => matchesPattern(c.sql, pattern));
        const details = matching.length
          ? matching
            .map((c) => `  bindings: ${JSON.stringify(c.bindings)}`)
            .join("\n")
          : "  (no matching queries found)";
        throw new Error(
          `Expected query matching ${pattern} to have been called with bindings including ${JSON.stringify(expectedBindings)}.\nMatching queries:\n${details}`
        );
      }
    },

    assertNotCalled(pattern: RegExp | string) {
      const found = calls.some((c) => matchesPattern(c.sql, pattern));
      if (found) {
        throw new Error(
          `Expected query matching ${pattern} to NOT have been called, but it was.`
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
