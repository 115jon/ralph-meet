import { describe, expect, it } from "vitest";
import { describeApiError } from "../api-errors";

function httpError(status: number, message = "D1_ERROR: no such table") {
  return Object.assign(new Error(message), { status });
}

describe("describeApiError", () => {
  it("never shows the server's message", () => {
    for (const status of [400, 401, 403, 404, 409, 413, 429, 500, 503]) {
      const copy = describeApiError(httpError(status), "save the role");
      expect(copy).not.toContain("D1_ERROR");
      expect(copy).toContain("save the role");
    }
  });

  it("asks to sign in again on 401", () => {
    expect(
      describeApiError(httpError(401, "Authentication required"), "load bans"),
    ).toBe("Your session has ended. Sign in again to load bans.");
  });

  it("names a missing permission on 403", () => {
    expect(describeApiError(httpError(403), "unban members")).toBe(
      "You don't have permission to unban members.",
    );
  });

  it("points at the connection when there is no status", () => {
    expect(describeApiError(new TypeError("Failed to fetch"), "load")).toBe(
      "Unable to load. Check your connection and try again.",
    );
    expect(describeApiError("boom", "load")).toBe(
      "Unable to load. Check your connection and try again.",
    );
    expect(describeApiError(null, "load")).toBe(
      "Unable to load. Check your connection and try again.",
    );
  });

  it("separates client, rate-limit and server failures", () => {
    expect(describeApiError(httpError(409), "create the invite")).toBe(
      "Unable to create the invite. Check the details and try again.",
    );
    expect(describeApiError(httpError(429), "send")).toBe(
      "Unable to send right now. Wait a moment and try again.",
    );
    expect(describeApiError(httpError(502), "send")).toBe(
      "Unable to send. Try again in a moment.",
    );
    expect(describeApiError(httpError(404), "revoke the invite")).toBe(
      "Unable to revoke the invite. It may have been deleted.",
    );
    expect(describeApiError(httpError(413), "upload the icon")).toBe(
      "Unable to upload the icon. The file is too large.",
    );
  });
});
