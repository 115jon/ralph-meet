import { describe, expect, it } from "vitest";
import {
  activateReturnPath,
  formatDeviceCode,
  initials,
  isCompleteDeviceCode,
  prettyPlatform,
  spelledDeviceCode,
  waitPhrase,
} from "../device-code-format";

describe("device code formatting (matches Kova's hosted page)", () => {
  it("formats codes: any case, with or without the dash, alphabet only, capped at 8", () => {
    expect(formatDeviceCode("abcdefgh")).toBe("ABCD-EFGH");
    expect(formatDeviceCode("ABCD-EFGH")).toBe("ABCD-EFGH");
    expect(formatDeviceCode(" abcd efgh ")).toBe("ABCD-EFGH");
    expect(formatDeviceCode("abc")).toBe("ABC");
    expect(formatDeviceCode("abcd")).toBe("ABCD");
    expect(formatDeviceCode("abcde")).toBe("ABCD-E");
    expect(formatDeviceCode("ABCD-EFGHJK")).toBe("ABCD-EFGH");
    // 0, O, 1 and I are not in the alphabet; they are dropped, not mapped.
    expect(formatDeviceCode("O0I1abcd")).toBe("ABCD");
    expect(formatDeviceCode(undefined)).toBe("");
    expect(formatDeviceCode(42)).toBe("");
  });

  it("knows a complete code and spells it for screen readers", () => {
    expect(isCompleteDeviceCode("ABCD-EFGH")).toBe(true);
    expect(isCompleteDeviceCode("ABCD-EFG")).toBe(false);
    expect(isCompleteDeviceCode("abcd-efgh")).toBe(false);
    expect(spelledDeviceCode("AB2D-EF3H")).toBe("A B 2 D, E F 3 H");
  });

  it("builds a same-origin, path-only return target for sign-in", () => {
    expect(activateReturnPath("abcd-efgh")).toBe("/activate?code=ABCD-EFGH");
    expect(activateReturnPath("nope")).toBe("/activate");
    expect(activateReturnPath("https://evil.example/?x=1")).toBe(
      "/activate?code=HTTP-SEVL",
    );
    // Whatever comes in, only a formatted code ever leaves, on a fixed same-origin path.
    expect(activateReturnPath("../..")).toBe("/activate");
  });

  it("rounds the wait up and prettifies platforms", () => {
    expect(waitPhrase(30)).toBe("a minute");
    expect(waitPhrase(61)).toBe("2 minutes");
    expect(waitPhrase(0)).toBeUndefined();
    expect(prettyPlatform("win32")).toBe("Windows");
    expect(prettyPlatform("darwin")).toBe("macOS");
    expect(prettyPlatform("Haiku")).toBe("Haiku");
    expect(prettyPlatform("  ")).toBeUndefined();
    expect(prettyPlatform(null)).toBeUndefined();
    expect(initials("Ada King Lovelace", "a@x")).toBe("AL");
    expect(initials("", "zed@example.com")).toBe("Z");
  });
});
