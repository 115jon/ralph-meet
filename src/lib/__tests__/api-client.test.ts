import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/desktop-auth", () => ({
  clearDesktopAuthSession: vi.fn(),
  getDesktopAuthHandoffToken: vi.fn(() => null),
  getDesktopToken: vi.fn(() => null),
  getStoredKovaAuthSessionToken: vi.fn(() => "test-token"),
  refreshDesktopToken: vi.fn(),
  waitForDesktopToken: vi.fn(async () => "test-token"),
}));

vi.mock("@/lib/platform", () => ({
  apiUrl: (path: string) => `https://meet.test${path}`,
  isTauri: () => false,
}));

vi.mock("@/lib/kova-auth-config", () => ({
  KOVA_AUTH_PUBLISHABLE_KEY: null,
}));

const logger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/lib/console-logger", () => ({
  clog: () => logger,
}));

import { apiGet, apiPost, apiUpload } from "@/lib/api-client";

describe("api-client HTTP failure handling", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("throws when a JSON API response is non-2xx even without an error field", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 500, message: "HTTPError" }), {
        status: 500,
        statusText: "Internal Server Error",
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(apiPost("/api/test", { ok: true })).rejects.toMatchObject({
      message: "HTTPError",
      status: 500,
    });
  });

  it("throws for failed upload responses that only include a message field", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({ status: 500, message: "Upload exploded" }),
        {
          status: 500,
          statusText: "Internal Server Error",
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    const formData = new FormData();
    formData.append("file", new Blob(["abc"]), "test.gif");

    await expect(apiUpload("/api/upload", formData)).rejects.toMatchObject({
      message: "Upload exploded",
      status: 500,
    });
  });

  it.each([401, 404])(
    "logs an expected %i at debug, not as a console error",
    async (status) => {
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "nope" }), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      );

      await expect(apiGet(`/api/expected-${status}`)).rejects.toMatchObject({
        status,
      });
      expect(logger.error).not.toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining(`status ${status}`),
        expect.anything(),
      );
    },
  );

  it("still logs an unexpected 500 as a console error", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "boom" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(apiGet("/api/boom")).rejects.toMatchObject({ status: 500 });
    expect(logger.error).toHaveBeenCalled();
  });
});
