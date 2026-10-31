import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  lenient,
  lenientArray,
  lenientBoolean,
  lenientCount,
  lenientNumber,
  lenientString,
  lenientStrings,
  lenientText,
  readCount,
} from "../lenient-schema";
import { looseStruct, safeParse } from "../schema";

function decode<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  input: unknown,
) {
  const result = safeParse(schema, input);
  if (!result.success) throw new Error("expected the decode to succeed");
  return result.data;
}

describe("lenient field builders", () => {
  const Payload = looseStruct({
    text: lenientText,
    raw: lenientString,
    n: lenientNumber,
    count: lenientCount,
    flag: lenientBoolean,
    tags: lenientStrings,
  });

  it("decodes well-typed fields and keeps unknown keys", () => {
    expect(
      decode(Payload, {
        text: "  hello ",
        raw: "  kept  ",
        n: -3.5,
        count: "12",
        flag: true,
        tags: ["a", " ", 3, "b"],
        extra: { nested: 1 },
      }),
    ).toEqual({
      text: "hello",
      raw: "  kept  ",
      n: -3.5,
      count: 12,
      flag: true,
      tags: ["a", "b"],
      extra: { nested: 1 },
    });
  });

  it("leaves wrong-typed and missing fields out instead of failing", () => {
    const decoded = decode(Payload, {
      text: 5,
      raw: null,
      n: "7",
      count: -1,
      flag: "yes",
      tags: "a",
    });

    expect(decoded).toEqual({});
    expect(Object.keys(decoded)).toEqual([]);
    expect(decode(Payload, {})).toEqual({});
  });

  it("keeps a false boolean and a zero count", () => {
    expect(decode(Payload, { flag: false, count: 0, n: 0 })).toEqual({
      flag: false,
      count: 0,
      n: 0,
    });
  });

  it("fails only when the root is not an object", () => {
    for (const root of [null, undefined, 3, "x", []]) {
      expect(safeParse(Payload, root).success).toBe(false);
    }
  });

  it("readCount accepts non-negative numbers and numeric strings", () => {
    expect(readCount(0)).toBe(0);
    expect(readCount("2.5")).toBe(2.5);
    for (const bad of [-1, Number.NaN, Infinity, "x", null, undefined, {}]) {
      expect(readCount(bad)).toBeUndefined();
    }
  });

  it("lenient(schema) decodes with the given schema or leaves the key out", () => {
    const S = Schema.Struct({ mode: lenient(Schema.Literals(["a", "b"])) });
    expect(decode(S, { mode: "a" })).toEqual({ mode: "a" });
    expect(decode(S, { mode: "c" })).toEqual({});
  });

  it("lenientArray drops malformed elements and keeps their siblings", () => {
    const S = Schema.Struct({
      items: lenientArray(Schema.Struct({ id: Schema.String })),
    });
    expect(
      decode(S, { items: [{ id: "a" }, null, { id: 2 }, { id: "b" }] }),
    ).toEqual({ items: [{ id: "a" }, { id: "b" }] });
    expect(decode(S, { items: "nope" })).toEqual({});
  });
});
