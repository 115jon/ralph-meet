import { describe, expect, it } from "vitest";
import {
  formatClock,
  formatDayLabel,
  formatShortDate,
  localDayKey,
} from "../message-time";

function localMs(y: number, m: number, d: number, h = 12, min = 0) {
  return new Date(y, m - 1, d, h, min).getTime();
}

const TODAY = new Date(2026, 9, 22).setHours(0, 0, 0, 0);

describe("message time formatting", () => {
  it("labels days relative to the shared today reference", () => {
    expect(formatDayLabel(localMs(2026, 10, 22, 9), TODAY)).toBe("Today");
    expect(formatDayLabel(localMs(2026, 10, 21, 23, 59), TODAY)).toBe(
      "Yesterday",
    );
    expect(formatDayLabel(localMs(2026, 10, 15), TODAY)).toMatch(/October 15/);
    expect(formatDayLabel(localMs(2026, 10, 15), TODAY)).not.toMatch(/2026/);
    expect(formatDayLabel(localMs(2025, 10, 22), TODAY)).toMatch(/2025/);
  });

  it("falls back to a full day before hydration (no today reference)", () => {
    expect(formatDayLabel(localMs(2026, 10, 22), null)).toMatch(/2026/);
  });

  it("drops the day period for the gutter clock", () => {
    const clock = formatClock(localMs(2026, 10, 22, 22, 52));
    expect(clock).not.toMatch(/[AP]M/i);
    expect(clock).toMatch(/52/);
  });

  it("keeps the short date compact", () => {
    expect(formatShortDate(localMs(2026, 10, 21), TODAY)).toBe("Yesterday");
    expect(formatShortDate(localMs(2025, 1, 2), TODAY)).toMatch(/2025/);
  });

  it("keys by local calendar day", () => {
    expect(localDayKey(localMs(2026, 10, 22, 0, 1))).toBe(
      localDayKey(localMs(2026, 10, 22, 23, 59)),
    );
    expect(localDayKey("not-a-date")).toBeNull();
  });
});
