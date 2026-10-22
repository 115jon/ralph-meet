import { describe, expect, it } from "vitest";
import {
  artInks,
  cellResolution,
  isLightGround,
  lightPosition,
  mixHex,
  normalizeHex,
  relativeLuminance,
} from "../auth-art";

describe("auth art inks", () => {
  it("normalizes hex and rgb() and rejects the rest", () => {
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
    expect(normalizeHex("#5865F2")).toBe("#5865f2");
    expect(normalizeHex("rgb(88, 101, 242)")).toBe("#5865f2");
    expect(normalizeHex("oklch(0.62 0.21 260)")).toBeNull();
    expect(normalizeHex(undefined)).toBeNull();
  });

  it("mixes in sRGB", () => {
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mixHex("#5865f2", "#ffffff", 0)).toBe("#5865f2");
  });

  it("ramps dark grounds up into tints and light grounds down into shades", () => {
    const dark = artInks({ accent: "#5865f2", background: "#070709" });
    expect(dark[0]).toBe("#070709");
    expect(dark[3]).toBe("#5865f2");
    for (let i = 1; i < dark.length; i++) {
      expect(relativeLuminance(dark[i]!)).toBeGreaterThan(
        relativeLuminance(dark[i - 1]!),
      );
    }
    expect(isLightGround("#f2f3f5")).toBe(true);
    const light = artInks({ accent: "#5865f2", background: "#f2f3f5" });
    expect(light[0]).toBe("#f2f3f5");
    expect(light[3]).toBe("#5865f2");
    for (let i = 1; i < light.length; i++) {
      expect(relativeLuminance(light[i]!)).toBeLessThan(
        relativeLuminance(light[i - 1]!),
      );
    }
  });

  it("sizes dither cells and keeps lights in orbit", () => {
    expect(cellResolution(720)).toBe(144);
    expect(cellResolution(390)).toBe(98);
    expect(cellResolution(100)).toBe(64);
    const light = {
      cx: 0.5,
      cy: 0.5,
      ax: 0.3,
      ay: 0.26,
      wx: 0.11,
      wy: 0.13,
      phase: 4,
      r: 0.34,
      a: 0.5,
    };
    for (let t = 0; t < 600; t += 7) {
      const { x, y } = lightPosition(light, t, 100);
      expect(x).toBeGreaterThanOrEqual(20);
      expect(x).toBeLessThanOrEqual(80);
      expect(y).toBeGreaterThanOrEqual(24);
      expect(y).toBeLessThanOrEqual(76);
    }
  });
});
