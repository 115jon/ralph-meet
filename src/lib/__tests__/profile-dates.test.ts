import { describe, expect, it } from "vitest";

import { formatProfileReferenceDate } from "../profile-dates";

describe("profile dates", () => {
  it("uses a deterministic locale and time zone", () => {
    expect(formatProfileReferenceDate("2024-03-05T23:30:00.000Z")).toBe(
      "Mar 5, 2024",
    );
  });

  it("returns null for invalid values", () => {
    expect(formatProfileReferenceDate("not-a-date")).toBeNull();
  });
});
