import { describe, expect, it } from "vitest";
import {
  activateReturnPath,
  deviceCodeFromReturnPath,
  formatDeviceCode,
  initials,
  isCompleteDeviceCode,
  prettyPlatform,
  releaseFailedPath,
  spelledDeviceCode,
  switchAccountSignInUrl,
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

describe("Not you? destinations", () => {
  it("signs in and returns to the formatted code, encoded, path-only", () => {
    expect(switchAccountSignInUrl("abcd efgh")).toBe(
      "/sign-in?redirect_url=%2Factivate%3Fcode%3DABCD-EFGH",
    );
    const url = new URL(switchAccountSignInUrl("ABCD-EFGH"), "https://x.test");
    expect(url.searchParams.get("redirect_url")).toBe(
      "/activate?code=ABCD-EFGH",
    );
    // Anything that isn't a code collapses to the bare page.
    expect(switchAccountSignInUrl("//10.0.0.1/")).toBe(
      "/sign-in?redirect_url=%2Factivate",
    );
  });

  it("marks a failed release on the activate page", () => {
    expect(releaseFailedPath("abcdefgh")).toBe(
      "/activate?code=ABCD-EFGH&release=failed",
    );
    expect(releaseFailedPath("")).toBe("/activate?release=failed");
  });
});

describe("deviceCodeFromReturnPath (sign-in context)", () => {
  it("reads the waiting code back out of an /activate return path", () => {
    expect(deviceCodeFromReturnPath(activateReturnPath("abcdefgh"))).toBe(
      "ABCD-EFGH",
    );
  });

  it("returns an empty code for /activate without a complete code", () => {
    expect(deviceCodeFromReturnPath("/activate")).toBe("");
    expect(deviceCodeFromReturnPath("/activate?code=AB")).toBe("");
  });

  it("returns null for anything that is not a same-origin /activate", () => {
    expect(deviceCodeFromReturnPath(undefined)).toBeNull();
    expect(deviceCodeFromReturnPath("/chat")).toBeNull();
    expect(deviceCodeFromReturnPath("/activated?code=ABCD-EFGH")).toBeNull();
    expect(
      deviceCodeFromReturnPath("https://evil.example/activate?code=ABCD-EFGH"),
    ).toBeNull();
    expect(
      deviceCodeFromReturnPath("//evil.example/activate?code=ABCD-EFGH"),
    ).toBeNull();
  });
});
