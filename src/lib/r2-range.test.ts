import { describe, expect, it } from "vitest";
import {
  getR2ObjectRangeBounds,
  resolveR2ByteRangeHeader,
  toR2GetOptions,
} from "./r2-range";

describe("R2 byte ranges", () => {
  it("clamps an overlong satisfiable explicit range to the object size", () => {
    expect(resolveR2ByteRangeHeader("bytes=2-999", 12)).toEqual({
      requested: true,
      invalid: false,
      range: { offset: 2, length: 10 },
      offset: 2,
      length: 10,
    });
  });

  it("clamps an overlong range that starts at zero", () => {
    expect(resolveR2ByteRangeHeader("bytes=0-12", 12)).toEqual({
      requested: true,
      invalid: false,
      range: { offset: 0, length: 12 },
      offset: 0,
      length: 12,
    });
  });

  it("constructs only narrowed R2 range options", () => {
    expect(toR2GetOptions({ offset: 2, length: 10 })).toEqual({
      range: { offset: 2, length: 10 },
    });
    expect(toR2GetOptions({ offset: 2 })).toEqual({
      range: { offset: 2 },
    });
    expect(toR2GetOptions({ suffix: 10 })).toEqual({
      range: { suffix: 10 },
    });
    expect(toR2GetOptions(undefined)).toBeUndefined();
  });

  it("narrows R2 object ranges before reading their bounds", () => {
    expect(getR2ObjectRangeBounds({ offset: 2, length: 10 })).toEqual({
      offset: 2,
      length: 10,
    });
    expect(getR2ObjectRangeBounds({ offset: 2 })).toEqual({ offset: 2 });
    expect(getR2ObjectRangeBounds({ suffix: 10 })).toEqual({});
  });
});
