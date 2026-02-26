import { beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "./logger";

describe("logger", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("outputs structured JSON with correct fields", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => { });
    logger.info("test message", { userId: "u1" });

    expect(spy).toHaveBeenCalledOnce();
    const output = JSON.parse(spy.mock.calls[0][0]);
    expect(output.level).toBe("info");
    expect(output.message).toBe("test message");
    expect(output.userId).toBe("u1");
    expect(output.timestamp).toBeDefined();
    // Verify timestamp is valid ISO 8601
    expect(new Date(output.timestamp).toISOString()).toBe(output.timestamp);
  });

  it("logs at all levels", () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => { });
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => { });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => { });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => { });

    logger.debug("debug msg");
    logger.info("info msg");
    logger.warn("warn msg");
    logger.error("error msg");

    // Debug may or may not fire depending on MIN_LEVEL
    expect(infoSpy).toHaveBeenCalledOnce();
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(errorSpy).toHaveBeenCalledOnce();
  });

  it("security() logs with event field", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => { });
    logger.security("rate_limit_exceeded", { ip: "1.2.3.4" });

    const output = JSON.parse(spy.mock.calls[0][0]);
    expect(output.level).toBe("warn");
    expect(output.event).toBe("rate_limit_exceeded");
    expect(output.ip).toBe("1.2.3.4");
  });

  it("request() logs with method, path, status", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => { });
    logger.request("GET", "/api/servers", 200, 42);

    const output = JSON.parse(spy.mock.calls[0][0]);
    expect(output.method).toBe("GET");
    expect(output.path).toBe("/api/servers");
    expect(output.status_code).toBe(200);
    expect(output.duration_ms).toBe(42);
  });
});
