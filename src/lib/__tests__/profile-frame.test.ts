import { describe, expect, it } from "vitest";

import {
  getProfileFrameFootprint,
  getProfileFrameLayerStyle,
  getProfileFrameLayers,
  getProfileFrameReserveY,
  getProfileFrameSurfaceMarginStyle,
} from "@/lib/profile-frame";

type Layer = {
  id: string;
  src: string;
  type: string;
  order: "front" | "back";
  anchor: string;
  responsive: boolean;
};

const layer = (
  id: string,
  type: string,
  order: "front" | "back",
  anchor: string,
): Layer => ({
  id,
  src: `https://cdn.discordapp.com/${id}.png`,
  type,
  order,
  anchor,
  responsive: type === "rail",
});

// The Entity's real geometry (catalog sample): 1200 card, 304/212 overhang,
// 56 each side, a rail plus top and bottom staples in both orders.
function frameDisplay(layers: Layer[], overrides: Record<string, number> = {}) {
  return {
    version: 1 as const,
    collectibles: {
      profileFrame: {
        skuId: "frame-1",
        name: "Test Frame",
        innerWidth: 1200,
        overflowTop: 304,
        overflowBottom: 212,
        overflowHorizontal: 56,
        layers,
        ...overrides,
      },
    },
  };
}

const rail = layer("rail", "rail", "front", "center");
const frontTop = layer("front-top", "staple", "front", "top");
const frontBottom = layer("front-bottom", "staple", "front", "bottom");
const backTop = layer("back-top", "staple", "back", "top");
const backBottom = layer("back-bottom", "staple", "back", "bottom");
const border = layer("border", "border", "front", "center");

const entity = frameDisplay([rail, frontTop, frontBottom, backTop, backBottom]);

describe("getProfileFrameLayers", () => {
  it("returns only layers for the requested render order", () => {
    expect(getProfileFrameLayers(entity, "back").map((l) => l.id)).toEqual([
      "back-top",
      "back-bottom",
    ]);
    expect(getProfileFrameLayers(entity, "front").map((l) => l.id)).toEqual([
      "rail",
      "front-top",
      "front-bottom",
    ]);
  });

  it("returns an empty list when no frame is equipped", () => {
    expect(getProfileFrameLayers({ version: 1 }, "front")).toEqual([]);
  });

  it("normalizes an invalid zero inner width to a safe positive value", () => {
    const invalid = frameDisplay([frontTop], { innerWidth: 0 });
    expect(getProfileFrameLayers(invalid, "front")[0]).toBeDefined();
    expect(getProfileFrameFootprint(invalid)?.innerWidth).toBeGreaterThan(0);
  });
});

describe("getProfileFrameFootprint", () => {
  it("is null without a frame", () => {
    expect(getProfileFrameFootprint({ version: 1 })).toBeNull();
    expect(getProfileFrameFootprint(null)).toBeNull();
  });

  it("measures the full frame box around the card", () => {
    expect(getProfileFrameFootprint(entity)).toEqual({
      innerWidth: 1200,
      outerWidth: 1312,
      top: 304,
      bottom: 212,
      side: 56,
    });
  });

  it("only reserves the edges a layer actually reaches", () => {
    expect(getProfileFrameFootprint(frameDisplay([frontTop]))).toMatchObject({
      top: 304,
      bottom: 0,
    });
    expect(getProfileFrameFootprint(frameDisplay([frontBottom]))).toMatchObject(
      { top: 0, bottom: 212 },
    );
    // A border hugs the card, so on its own it needs no vertical room.
    expect(getProfileFrameFootprint(frameDisplay([border]))).toMatchObject({
      top: 0,
      bottom: 0,
      side: 56,
    });
    // A rail runs the whole frame height.
    expect(getProfileFrameFootprint(frameDisplay([rail]))).toMatchObject({
      top: 304,
      bottom: 212,
    });
  });
});

describe("getProfileFrameSurfaceMarginStyle", () => {
  it("insets the card by the footprint in frame-box container units", () => {
    expect(getProfileFrameSurfaceMarginStyle(entity)).toEqual({
      marginTop: `${Math.round((304 / 1312) * 100000) / 1000}cqw`,
      marginBottom: `${Math.round((212 / 1312) * 100000) / 1000}cqw`,
      marginLeft: `${Math.round((56 / 1312) * 100000) / 1000}cqw`,
      marginRight: `${Math.round((56 / 1312) * 100000) / 1000}cqw`,
    });
  });

  it("keeps the card's horizontal share at innerWidth / outerWidth", () => {
    const style = getProfileFrameSurfaceMarginStyle(entity);
    const side = Number.parseFloat(String(style.marginLeft));
    expect(100 - side * 2).toBeCloseTo((1200 / 1312) * 100, 2);
  });

  it("adds nothing without a frame", () => {
    expect(getProfileFrameSurfaceMarginStyle({ version: 1 })).toEqual({});
    expect(getProfileFrameReserveY({ version: 1 })).toBe("0px");
  });

  it("reports the vertical reserve for height caps", () => {
    expect(getProfileFrameReserveY(entity)).toBe(
      `${Math.round(((304 + 212) / 1312) * 100000) / 1000}cqw`,
    );
  });
});

describe("getProfileFrameLayerStyle", () => {
  it("pins staples to the frame box edges at their natural aspect", () => {
    expect(getProfileFrameLayerStyle(entity, frontTop)).toEqual({
      width: "100%",
      top: "0%",
    });
    expect(getProfileFrameLayerStyle(entity, frontBottom)).toEqual({
      width: "100%",
      bottom: "0%",
    });
  });

  it("stretches rails over the whole frame height, not their natural height", () => {
    expect(getProfileFrameLayerStyle(entity, rail)).toEqual({
      width: "100%",
      top: "0%",
      height: "100%",
      objectFit: "fill",
    });
  });

  it("stretches borders over the card only", () => {
    const framed = frameDisplay([border, frontTop, frontBottom]);
    const top = `${Math.round((304 / 1312) * 100000) / 1000}cqw`;
    const bottom = `${Math.round((212 / 1312) * 100000) / 1000}cqw`;
    expect(getProfileFrameLayerStyle(framed, border)).toEqual({
      width: "100%",
      top,
      height: `calc(100% - ${top} - ${bottom})`,
      objectFit: "fill",
    });
  });

  it("hides layers when the display has no frame", () => {
    expect(getProfileFrameLayerStyle({ version: 1 }, frontTop)).toEqual({
      display: "none",
    });
  });
});
