// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import {
  avoidInsetsForColumn,
  clampWidth,
  cornerForArrow,
  cornerPosition,
  nextCorner,
  projectMomentum,
  readFloatingPrefs,
  releaseVelocity,
  rubberBand,
  snapCorner,
  writeFloatingPrefs,
} from "../floating-geometry";

const phone = { width: 390, height: 844 };
const insets = { top: 64, right: 12, bottom: 12, left: 12 };
const pill = { width: 300, height: 56 };

describe("cornerPosition", () => {
  it("parks each corner inside the insets", () => {
    expect(cornerPosition("bottom-right", pill, phone, insets)).toEqual({
      x: 390 - 12 - 300,
      y: 844 - 12 - 56,
    });
    expect(cornerPosition("top-left", pill, phone, insets)).toEqual({
      x: 12,
      y: 64,
    });
  });

  it("stacks players sharing a corner away from the edge", () => {
    expect(cornerPosition("bottom-left", pill, phone, insets, 64).y).toBe(
      844 - 12 - 56 - 64,
    );
    expect(cornerPosition("top-right", pill, phone, insets, 64).y).toBe(
      64 + 64,
    );
  });

  it("keeps an oversized player on screen", () => {
    const wide = { width: 500, height: 900 };
    const point = cornerPosition("bottom-right", wide, phone, insets);
    expect(point.x).toBeGreaterThanOrEqual(12);
    expect(point.y).toBeGreaterThanOrEqual(0);
  });
});

describe("avoidInsetsForColumn", () => {
  const composer = { top: 760, bottom: 844, left: 0, right: 390 };
  const header = { top: 0, bottom: 48, left: 0, right: 390 };
  const sidebar = { top: 0, bottom: 844, left: 0, right: 312 };
  const base = { top: 64, bottom: 12 };

  it("lifts the bottom inset above the composer or tab bar", () => {
    expect(
      avoidInsetsForColumn([composer], { left: 78, right: 378 }, phone, base),
    ).toEqual({ top: 64, bottom: 844 - 760 + 8 });
  });

  it("drops the top inset below chrome in the top half", () => {
    const tall = { top: 0, bottom: 120, left: 0, right: 390 };
    expect(
      avoidInsetsForColumn([header, tall], { left: 0, right: 300 }, phone, base)
        .top,
    ).toBe(128);
  });

  it("ignores chrome in another column and full-height panels", () => {
    const dock = { top: 640, bottom: 844, left: 0, right: 312 };
    const desktop = { width: 1280, height: 844 };
    expect(
      avoidInsetsForColumn(
        [dock, sidebar],
        { left: 904, right: 1264 },
        desktop,
        base,
      ),
    ).toEqual(base);
    expect(
      avoidInsetsForColumn([dock], { left: 16, right: 376 }, desktop, base)
        .bottom,
    ).toBe(844 - 640 + 8);
  });
});

describe("snapCorner", () => {
  const size = { width: 100, height: 60 };

  it("snaps to the quadrant the player was dropped in", () => {
    expect(snapCorner({ x: 20, y: 700 }, size, { x: 0, y: 0 }, phone)).toBe(
      "bottom-left",
    );
    expect(snapCorner({ x: 260, y: 80 }, size, { x: 0, y: 0 }, phone)).toBe(
      "top-right",
    );
  });

  it("lets a flick carry it to the far corner", () => {
    // Dropped just left of centre, but flung right and up.
    expect(
      snapCorner({ x: 120, y: 500 }, size, { x: 1.2, y: -1.5 }, phone),
    ).toBe("top-right");
    // Same drop with no momentum stays put.
    expect(snapCorner({ x: 120, y: 500 }, size, { x: 0, y: 0 }, phone)).toBe(
      "bottom-left",
    );
  });

  it("projects momentum like a decelerating scroll", () => {
    expect(projectMomentum(0)).toBe(0);
    expect(projectMomentum(1)).toBeCloseTo(499, 0);
    expect(projectMomentum(-1)).toBeCloseTo(-499, 0);
  });
});

describe("releaseVelocity", () => {
  it("reads px/ms from the last 100ms of samples", () => {
    expect(
      releaseVelocity([
        { t: 0, x: 0, y: 0 },
        { t: 200, x: 10, y: 0 },
        { t: 250, x: 60, y: -50 },
        { t: 300, x: 110, y: -100 },
      ]),
    ).toEqual({ x: 1, y: -1 });
    expect(releaseVelocity([{ t: 0, x: 0, y: 0 }])).toEqual({ x: 0, y: 0 });
  });
});

describe("keyboard and tap moves", () => {
  it("maps arrows to the neighbouring corner", () => {
    expect(cornerForArrow("bottom-right", "ArrowUp")).toBe("top-right");
    expect(cornerForArrow("bottom-right", "ArrowLeft")).toBe("bottom-left");
    expect(cornerForArrow("top-left", "ArrowDown")).toBe("bottom-left");
    expect(cornerForArrow("top-left", "Enter")).toBeNull();
  });

  it("cycles corners clockwise", () => {
    expect(nextCorner("top-left")).toBe("top-right");
    expect(nextCorner("top-right")).toBe("bottom-right");
    expect(nextCorner("bottom-right")).toBe("bottom-left");
    expect(nextCorner("bottom-left")).toBe("top-left");
  });
});

describe("rubberBand and clampWidth", () => {
  it("resists past the edges without stopping dead", () => {
    expect(rubberBand(50, 0, 100)).toBe(50);
    const past = rubberBand(-200, 0, 100);
    expect(past).toBeLessThan(0);
    expect(past).toBeGreaterThan(-200);
  });

  it("clamps widths to the range", () => {
    expect(clampWidth(100, { min: 280, max: 440 })).toBe(280);
    expect(clampWidth(999, { min: 280, max: 440 })).toBe(440);
    expect(clampWidth(333.4, { min: 280, max: 440 })).toBe(333);
  });
});

describe("prefs persistence", () => {
  it("round-trips and rejects junk", () => {
    const fallback = { corner: "bottom-right" as const, minimized: false };
    writeFloatingPrefs("test", {
      corner: "top-left",
      minimized: true,
      width: 400,
    });
    expect(readFloatingPrefs("test", fallback)).toEqual({
      corner: "top-left",
      minimized: true,
      width: 400,
    });
    window.localStorage.setItem(
      "rm:floating:v1:test",
      JSON.stringify({ corner: "middle", minimized: "yes" }),
    );
    expect(readFloatingPrefs("test", fallback)).toEqual({
      ...fallback,
      width: undefined,
    });
    window.localStorage.setItem("rm:floating:v1:test", "{not json");
    expect(readFloatingPrefs("test", fallback)).toEqual(fallback);
  });
});
