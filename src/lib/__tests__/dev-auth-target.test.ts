import { describe, expect, it } from "vitest";

import {
  DEV_AUTH_APPS,
  describeDevAuth,
  resolveDevAuthTarget,
  selectDevAuthKey,
} from "@/lib/dev-auth-target";

const DEV = "pk_dev_example";
const LIVE = "pk_live_example";

describe("resolveDevAuthTarget", () => {
  it("defaults to the dev app", () => {
    expect(resolveDevAuthTarget(undefined)).toBe("dev");
    expect(resolveDevAuthTarget("")).toBe("dev");
    expect(resolveDevAuthTarget("  ")).toBe("dev");
    expect(resolveDevAuthTarget("dev")).toBe("dev");
    expect(resolveDevAuthTarget("Development")).toBe("dev");
  });

  it("selects prod by name", () => {
    expect(resolveDevAuthTarget("prod")).toBe("prod");
    expect(resolveDevAuthTarget("PROD")).toBe("prod");
    expect(resolveDevAuthTarget("production")).toBe("prod");
    expect(resolveDevAuthTarget("live")).toBe("prod");
  });

  it("refuses anything else instead of guessing", () => {
    expect(() => resolveDevAuthTarget("staging")).toThrow(/RALPH_AUTH/);
    expect(() => resolveDevAuthTarget("1")).toThrow(/RALPH_AUTH/);
  });
});

describe("selectDevAuthKey", () => {
  it("returns the target's key", () => {
    expect(selectDevAuthKey("dev", { dev: DEV, prod: LIVE })).toBe(DEV);
    expect(selectDevAuthKey("prod", { dev: DEV, prod: LIVE })).toBe(LIVE);
  });

  it("fails on a missing key", () => {
    expect(() => selectDevAuthKey("dev", { prod: LIVE })).toThrow(/mobile-dev/);
    expect(() => selectDevAuthKey("prod", { dev: DEV, prod: "" })).toThrow(
      /\[vars\]/,
    );
  });

  it("fails when the key belongs to the other app", () => {
    expect(() => selectDevAuthKey("dev", { dev: LIVE })).toThrow(/pk_dev_/);
    expect(() => selectDevAuthKey("prod", { prod: DEV })).toThrow(/pk_live_/);
  });
});

describe("describeDevAuth", () => {
  it("names the app and never prints a key", () => {
    const dev = describeDevAuth("dev");
    const prod = describeDevAuth("prod");
    expect(dev).toContain(DEV_AUTH_APPS.dev.name);
    expect(dev).toContain(DEV_AUTH_APPS.dev.id);
    expect(prod).toContain(DEV_AUTH_APPS.prod.name);
    expect(`${dev}${prod}`).not.toMatch(/pk_(dev|live)_/);
  });
});
