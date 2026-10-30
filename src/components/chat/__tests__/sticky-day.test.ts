import { describe, expect, it } from "vitest";
import { DAY_DIVIDER_HEIGHT_PX, isStickyDayVisible } from "../sticky-day";

const base = { startMargin: 0, rowTop: 0, rowHasDivider: true };

describe("isStickyDayVisible", () => {
  it("hides while the day's divider is at the top of the list", () => {
    expect(isStickyDayVisible({ ...base, scrollOffset: 0 })).toBe(false);
  });

  it("hides while the divider is still partly on screen", () => {
    expect(
      isStickyDayVisible({
        ...base,
        scrollOffset: DAY_DIVIDER_HEIGHT_PX - 1,
      }),
    ).toBe(false);
  });

  it("shows once the divider has scrolled above the top edge", () => {
    expect(
      isStickyDayVisible({ ...base, scrollOffset: DAY_DIVIDER_HEIGHT_PX }),
    ).toBe(true);
  });

  it("accounts for the list header above the virtualiser", () => {
    // Divider row sits below a 200px header; scrollTop 100 has not reached it.
    const args = { ...base, startMargin: 200, rowTop: 0 };
    expect(isStickyDayVisible({ ...args, scrollOffset: 0 })).toBe(false);
    expect(isStickyDayVisible({ ...args, scrollOffset: 100 })).toBe(false);
    expect(isStickyDayVisible({ ...args, scrollOffset: 231 })).toBe(false);
    expect(isStickyDayVisible({ ...args, scrollOffset: 232 })).toBe(true);
  });

  it("uses the topmost row's own offset for a mid-list day change", () => {
    const args = { ...base, rowTop: 1000 };
    expect(isStickyDayVisible({ ...args, scrollOffset: 1010 })).toBe(false);
    expect(isStickyDayVisible({ ...args, scrollOffset: 1032 })).toBe(true);
  });

  it("shows whenever the topmost row carries no divider of its own", () => {
    expect(
      isStickyDayVisible({ ...base, rowHasDivider: false, scrollOffset: 0 }),
    ).toBe(true);
  });
});
