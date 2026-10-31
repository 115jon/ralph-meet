import { Schema } from "effect";
import { describe, expect, it, vi } from "vitest";
import { looseStruct, safeParse, withDefault } from "./schema";

const loose = looseStruct({
  name: withDefault(Schema.String, ""),
  note: Schema.optional(Schema.NullOr(Schema.String)),
  anything: Schema.optional(Schema.Unknown),
  count: Schema.optional(Schema.Finite),
});

describe("looseStruct", () => {
  it("keeps keys it does not declare", () => {
    const result = safeParse(loose, {
      name: "a",
      extra: 1,
      nested: { x: true },
    });

    expect(result).toEqual({
      success: true,
      data: { name: "a", extra: 1, nested: { x: true } },
    });
  });

  it("still validates the declared keys", () => {
    expect(safeParse(loose, { name: 5 }).success).toBe(false);
    expect(safeParse(loose, { count: "1" }).success).toBe(false);
    expect(safeParse(loose, { count: Number.NaN }).success).toBe(false);
  });

  it("takes plain objects only", () => {
    for (const input of [[], null, undefined, "text", 3, true]) {
      expect(safeParse(loose, input).success, String(input)).toBe(false);
    }
  });

  it("accepts an explicitly undefined optional key", () => {
    expect(
      safeParse(loose, { note: undefined, anything: undefined }).success,
    ).toBe(true);
    expect(safeParse(loose, { note: null }).success).toBe(true);
  });

  it("does not let an own __proto__ key replace the prototype", () => {
    const result = safeParse(
      loose,
      JSON.parse('{"__proto__":{"polluted":true},"name":"z"}'),
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(Object.getPrototypeOf(result.data)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("withDefault", () => {
  it("fills a missing or undefined key", () => {
    expect(safeParse(loose, {})).toMatchObject({
      success: true,
      data: { name: "" },
    });
    expect(safeParse(loose, { name: undefined })).toMatchObject({
      success: true,
      data: { name: "" },
    });
  });

  it("rejects a present value of the wrong type, including null", () => {
    expect(safeParse(loose, { name: null }).success).toBe(false);
    expect(safeParse(loose, { name: 1 }).success).toBe(false);
  });

  it("keeps a provided value", () => {
    expect(safeParse(loose, { name: "x" })).toMatchObject({
      success: true,
      data: { name: "x" },
    });
  });

  it("works for non-string defaults", () => {
    const schema = Schema.Struct({
      pinned: withDefault(Schema.Boolean, false),
    });

    expect(safeParse(schema, {})).toEqual({
      success: true,
      data: { pinned: false },
    });
    expect(safeParse(schema, { pinned: true })).toEqual({
      success: true,
      data: { pinned: true },
    });
    expect(safeParse(schema, { pinned: "yes" }).success).toBe(false);
  });
});

describe("Schema.Struct", () => {
  it("strips undeclared keys, like the previous default object schema", () => {
    const schema = Schema.Struct({ a: Schema.String });

    expect(safeParse(schema, { a: "x", b: 1 })).toEqual({
      success: true,
      data: { a: "x" },
    });
  });
});

describe("safeParse", () => {
  const schema = Schema.Struct({
    title: Schema.String.check(
      Schema.isMinLength(1, { message: "Title is required" }),
    ),
    tags: Schema.mutable(Schema.Array(Schema.String)),
  });

  it("returns the first failure with its path and message", () => {
    expect(safeParse(schema, { title: "", tags: [] })).toEqual({
      success: false,
      issues: [{ path: ["title"], message: "Title is required" }],
    });
  });

  it("reports nested array indexes in the path", () => {
    const result = safeParse(schema, { title: "t", tags: ["a", 2] });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues[0]?.path).toEqual(["tags", 1]);
  });

  it("reports a missing key at the key's path", () => {
    const result = safeParse(schema, { tags: [] });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues[0]).toMatchObject({ path: ["title"] });
  });

  it("reports a root failure with an empty path", () => {
    expect(safeParse(schema, null)).toMatchObject({
      success: false,
      issues: [{ path: [] }],
    });
  });

  it("never copies the rejected input into the message", () => {
    const secret = "hunter2-secret-token";
    const result = safeParse(schema, { title: secret, tags: secret });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(JSON.stringify(result.issues)).not.toContain(secret);
  });

  it("runs without runtime code generation", () => {
    const real = globalThis.Function;
    const blocked = new Proxy(real, {
      construct() {
        throw new Error("code generation is blocked");
      },
      apply() {
        throw new Error("code generation is blocked");
      },
    });
    vi.stubGlobal("Function", blocked);
    try {
      // The stub must catch the constructors a code generator would call.
      expect(() => new Function("return 1")).toThrow("blocked");
      expect(() => Function("return 1")).toThrow("blocked");
      expect(safeParse(schema, { title: "t", tags: ["a"] }).success).toBe(true);
      expect(safeParse(schema, { title: "", tags: [1] }).success).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
