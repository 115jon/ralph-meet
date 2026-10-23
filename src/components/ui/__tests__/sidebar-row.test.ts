import { describe, expect, it } from "vitest";

import {
  PHONE_ROW,
  SIDEBAR_CATEGORY,
  SIDEBAR_ICON_SLOT,
  SIDEBAR_LIST,
  SIDEBAR_UNREAD_PILL,
  sidebarRowClass,
} from "../sidebar-row";

const classes = (value: string) => value.split(/\s+/).filter(Boolean);

describe("sidebar row recipe (design-system 12.3)", () => {
  it("is a 32px row that grows to 44px on coarse pointers", () => {
    const row = classes(sidebarRowClass());
    expect(row).toEqual(
      expect.arrayContaining([
        "h-8",
        "pointer-coarse:min-h-11",
        "px-2",
        "gap-2.5",
        "rounded-md",
        "text-ui-base",
        "font-medium",
      ]),
    );
  });

  it("selects with a tint and hovers only on fine pointers", () => {
    const selected = classes(sidebarRowClass({ selected: true }));
    expect(selected).toContain("bg-rm-tint-2");
    expect(selected).not.toContain("pointer-fine:hover:bg-rm-tint-1");

    const idle = classes(sidebarRowClass());
    expect(idle).toContain("pointer-fine:hover:bg-rm-tint-1");
    expect(idle.some((c) => c.startsWith("hover:"))).toBe(false);
  });

  it("never uses the legacy hover/active tokens (red in spiderman)", () => {
    for (const options of [{}, { selected: true }, { unread: true }]) {
      expect(sidebarRowClass(options)).not.toMatch(/bg-rm-bg-(active|hover)/);
    }
  });

  it("marks unread with weight, but not on the selected row", () => {
    expect(classes(sidebarRowClass({ unread: true }))).toContain(
      "font-semibold",
    );
    expect(
      classes(sidebarRowClass({ unread: true, selected: true })),
    ).not.toContain("font-semibold");
  });

  it("swaps to the 40px step for avatar rows", () => {
    const tall = classes(sidebarRowClass({ tall: true }));
    expect(tall).toContain("h-10");
    expect(tall).not.toContain("h-8");
  });

  it("keeps a fixed 20px icon slot and a 2px edge pill", () => {
    expect(classes(SIDEBAR_ICON_SLOT)).toEqual(
      expect.arrayContaining(["size-5", "shrink-0"]),
    );
    expect(classes(SIDEBAR_UNREAD_PILL)).toEqual(
      expect.arrayContaining(["w-0.5", "-left-2", "absolute"]),
    );
  });

  it("insets the list and category on the 12.3 values", () => {
    expect(classes(SIDEBAR_LIST)).toEqual(
      expect.arrayContaining(["px-2", "py-2"]),
    );
    expect(classes(SIDEBAR_CATEGORY)).toEqual(
      expect.arrayContaining(["px-2", "pt-4", "pb-1", "uppercase"]),
    );
  });

  it("gives phone rows 48px and the 16px edge (12.4)", () => {
    expect(classes(PHONE_ROW)).toEqual(
      expect.arrayContaining(["min-h-12", "px-4", "gap-3"]),
    );
  });
});
