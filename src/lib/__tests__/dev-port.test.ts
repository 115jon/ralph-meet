import { describe, expect, it } from "vitest";

import {
  DEFAULT_WEB_DEV_PORT,
  describeBusyDevPort,
  resolveWebDevPort,
} from "@/lib/dev-port";

describe("resolveWebDevPort", () => {
  it("defaults to 5173", () => {
    expect(resolveWebDevPort(undefined)).toBe(DEFAULT_WEB_DEV_PORT);
    expect(resolveWebDevPort("")).toBe(DEFAULT_WEB_DEV_PORT);
    expect(resolveWebDevPort("  ")).toBe(DEFAULT_WEB_DEV_PORT);
  });

  it("reads a port number", () => {
    expect(resolveWebDevPort("5174")).toBe(5174);
    expect(resolveWebDevPort(" 8080 ")).toBe(8080);
  });

  it.each(["abc", "5173.5", "0", "65536", "-1"])("rejects %s", (raw) => {
    expect(() => resolveWebDevPort(raw)).toThrow(/RALPH_DEV_PORT/);
  });
});

describe("describeBusyDevPort", () => {
  it("suggests RALPH_DEV_PORT and warns about sign-in for the web server", () => {
    const message = describeBusyDevPort("web", 5173);
    expect(message).toContain("Port 5173 is already in use");
    expect(message).toContain("RALPH_DEV_PORT=5174 pnpm dev");
    expect(message).toContain("sign-in fails");
  });

  it("names the fixed port for the desktop server", () => {
    const message = describeBusyDevPort("desktop", 1420);
    expect(message).toContain("Tauri dev needs exactly 1420");
    expect(message).not.toContain("RALPH_DEV_PORT");
  });
});
