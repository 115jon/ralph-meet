import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { THEME_SLOTS, type ThemeId } from "../theme-slots";

const CUSTOM: ThemeId[] = [
  "miku-dark",
  "miku-light",
  "spiderman-dark",
  "spiderman-light",
];

const publicAsset = (src: string) =>
  resolve(process.cwd(), "public", src.replace(/^\//, ""));

describe("THEME_SLOTS", () => {
  it("registers every theme id", () => {
    expect(Object.keys(THEME_SLOTS).sort()).toEqual(
      [
        "dark",
        "light",
        "miku-dark",
        "miku-light",
        "spiderman-dark",
        "spiderman-light",
      ].sort(),
    );
  });

  it("leaves the default themes without decoration", () => {
    expect(THEME_SLOTS.dark).toEqual({});
    expect(THEME_SLOTS.light).toEqual({});
  });

  it.each(CUSTOM)("%s has a mark and a banner backed by real assets", (id) => {
    const slots = THEME_SLOTS[id];
    expect(slots.mark?.src).toBeTruthy();
    expect(existsSync(publicAsset(slots.mark!.src))).toBe(true);
    expect(slots.banner).toBeDefined();
    if (slots.banner?.glyph) {
      expect(existsSync(publicAsset(slots.banner.glyph))).toBe(true);
    }
  });

  it("gives both colourways of a theme the same identity", () => {
    expect(THEME_SLOTS["miku-dark"]).toBe(THEME_SLOTS["miku-light"]);
    expect(THEME_SLOTS["spiderman-dark"]).toBe(THEME_SLOTS["spiderman-light"]);
  });
});
