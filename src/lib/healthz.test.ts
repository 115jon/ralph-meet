import { describe, expect, it } from "vitest";

import packageJson from "../../package.json";
import { buildHealthzPayload } from "./healthz";

describe("buildHealthzPayload", () => {
  it("returns a stable release smoke-test payload", () => {
    const payload = buildHealthzPayload(
      () => new Date("2026-06-30T12:00:00.000Z"),
    );

    expect(payload).toEqual({
      ok: true,
      service: "ralph-meet",
      version: packageJson.version,
      checkedAt: "2026-06-30T12:00:00.000Z",
    });
  });
});
