import { describe, expect, it } from "vitest";
import {
  isRecord,
  orElse,
  orElseWith,
  readBoolean,
  readGuard,
  readList,
  readMap,
  readNonBlankString,
  readNumber,
  readOneOf,
  readObject,
  readStoredJson,
  readString,
  required,
} from "../persisted-guard";

describe("primitive readers", () => {
  it("accept only their own type", () => {
    expect(readBoolean(false)).toBe(false);
    expect(readBoolean("false")).toBeUndefined();
    expect(readNumber(0)).toBe(0);
    for (const bad of ["1", Number.NaN, Infinity, null, undefined]) {
      expect(readNumber(bad)).toBeUndefined();
    }
    expect(readString("")).toBe("");
    expect(readString(5)).toBeUndefined();
    expect(readNonBlankString(" a ")).toBe(" a ");
    expect(readNonBlankString("  ")).toBeUndefined();
  });

  it("readOneOf accepts listed ids and never Object.prototype names", () => {
    const read = readOneOf(["a", "b"]);
    expect(read("a")).toBe("a");
    for (const bad of ["c", "toString", "__proto__", "constructor", 1, null]) {
      expect(read(bad)).toBeUndefined();
    }
  });

  it("readGuard wraps a type guard", () => {
    const read = readGuard((value): value is 7 => value === 7);
    expect(read(7)).toBe(7);
    expect(read(8)).toBeUndefined();
  });

  it("isRecord rejects null and arrays", () => {
    expect(isRecord({})).toBe(true);
    for (const bad of [null, [], "x", 3, undefined]) {
      expect(isRecord(bad)).toBe(false);
    }
  });
});

describe("collections", () => {
  it("readList keeps the accepted elements", () => {
    expect(readList(readString)(["a", 1, "b", null])).toEqual(["a", "b"]);
    for (const bad of [{}, "a", null, undefined]) {
      expect(readList(readString)(bad)).toBeUndefined();
    }
  });

  it("readMap keeps the accepted entries and never builds a __proto__ entry", () => {
    const read = readMap(readNumber);
    const stored = JSON.parse('{"a":1,"b":"x","__proto__":2}');
    const entries = read(stored);

    expect(entries).toEqual({ a: 1 });
    expect(Object.getPrototypeOf(entries)).toBe(Object.prototype);
    for (const bad of [[], "a", null, undefined]) {
      expect(read(bad)).toBeUndefined();
    }
  });
});

describe("readObject", () => {
  interface Settings {
    name: string;
    volume: number;
    muted?: boolean;
    tags: string[];
  }

  const read = readObject<Settings>({
    name: required(readString),
    volume: orElse(readNumber, 100),
    muted: readBoolean,
    tags: orElseWith(readList(readString), () => []),
  });

  it("returns valid fields and drops keys it does not declare", () => {
    expect(
      read({ name: "n", volume: 5, muted: false, tags: ["a"], extra: 1 }),
    ).toEqual({ name: "n", volume: 5, muted: false, tags: ["a"] });
  });

  it("fills required keys with their fallback and leaves optional keys out", () => {
    const value = read({ name: "n", volume: "loud", muted: "yes", tags: 3 });

    expect(value).toEqual({ name: "n", volume: 100, tags: [] });
    expect(value).not.toHaveProperty("muted");
  });

  it("gives a fresh fallback object each time", () => {
    const first = read({ name: "a" });
    const second = read({ name: "b" });

    expect(first?.tags).not.toBe(second?.tags);
  });

  it("rejects the whole value when a required key is missing or invalid", () => {
    expect(read({ volume: 1 })).toBeUndefined();
    expect(read({ name: 5 })).toBeUndefined();
  });

  it("rejects values that are not objects", () => {
    for (const bad of [null, undefined, 3, "x", []]) {
      expect(read(bad)).toBeUndefined();
    }
  });

  it("keeps unknown keys on request, minus declared keys that are invalid", () => {
    const loose = readObject<{ id: string; size?: number }>(
      { id: required(readString), size: readNumber },
      { keepUnknown: true },
    );

    expect(loose({ id: "x", size: "big", future: { a: 1 } })).toEqual({
      id: "x",
      future: { a: 1 },
    });
  });
});

describe("readStoredJson", () => {
  it("reads parsed text", () => {
    expect(readStoredJson('["a","b"]', readList(readString))).toEqual([
      "a",
      "b",
    ]);
  });

  it("gives undefined for empty or unparseable text and for rejected values", () => {
    for (const raw of [null, undefined, "", "{oops", "null", '{"a":1}']) {
      expect(readStoredJson(raw, readList(readString))).toBeUndefined();
    }
  });
});
