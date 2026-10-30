import { describe, expect, it } from "vitest";
import { remainingLabel } from "../invite-clock";

const at = Date.parse("2026-10-22T00:00:00Z");
const plus = (ms: number) => new Date(at + ms).toISOString();

describe("invite countdown label", () => {
  it("reads in minutes above an hour and seconds below", () => {
    expect(remainingLabel(plus((19 * 60 + 59) * 60_000 + 30_000), at)).toBe(
      "19h 59m",
    );
    expect(remainingLabel(plus(2 * 86_400_000 + 3 * 3_600_000), at)).toBe(
      "2d 3h",
    );
    expect(remainingLabel(plus(24 * 60_000 + 9_000), at)).toBe("24m 09s");
    expect(remainingLabel(plus(9_000), at)).toBe("9s");
  });

  it("is null once expired", () => {
    expect(remainingLabel(plus(-1), at)).toBeNull();
    expect(remainingLabel(plus(0), at)).toBeNull();
  });
});
