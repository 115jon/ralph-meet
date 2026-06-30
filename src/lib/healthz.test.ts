import { describe, expect, it } from "vitest";

import { buildHealthzPayload } from "./healthz";

describe("buildHealthzPayload", () => {
  it("returns a stable release smoke-test payload", () => {
    const payload = buildHealthzPayload(() => new Date("2026-06-30T12:00:00.000Z"));

    expect(payload).toEqual({
      ok: true,
      service: "ralph-meet",
      version: "1.14.1",
      checkedAt: "2026-06-30T12:00:00.000Z",
    });
  });
});
