import { describe, expect, it } from "vitest";

import { toSafeSfuFailure } from "./sfu-diagnostics";

describe("toSafeSfuFailure", () => {
  it("classifies an SFU response without retaining the response body", () => {
    const diagnostic = toSafeSfuFailure({
      attempt: 1,
      operation: "POST sessions/new",
      requestId: "cf-request-123",
      status: 503,
    });

    expect(diagnostic).toEqual({
      attempt: 1,
      category: "server",
      operation: "POST sessions/new",
      requestId: "cf-request-123",
      status: 503,
    });
    expect(JSON.stringify(diagnostic)).not.toContain("secret");
  });

  it("classifies aborts and network failures without exposing error text", () => {
    expect(
      toSafeSfuFailure({
        attempt: 0,
        operation: "PUT sessions/id/tracks/close",
        status: null,
        timedOut: true,
      }),
    ).toMatchObject({ category: "timeout", status: null });
    expect(
      toSafeSfuFailure({
        attempt: 0,
        operation: "PUT sessions/id/tracks/close",
        status: null,
      }),
    ).toMatchObject({ category: "network", status: null });
  });
});
