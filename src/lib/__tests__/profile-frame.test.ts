import { describe, expect, it } from "vitest";

import {
  getProfileFrameLayerStyle,
  getProfileFrameLayers,
  getProfileFramePreviewScale,
  getProfileFramePreviewTransform,
  getProfileFrameSurfaceInsetStyle,
} from "@/lib/profile-frame";

const display = {
  version: 1 as const,
  collectibles: {
    profileFrame: {
      skuId: "frame-1",
      name: "Test Frame",
      innerWidth: 100,
      overflowTop: 20,
      overflowBottom: 20,
      overflowHorizontal: 10,
      layers: [
        {
          id: "back",
          src: "https://cdn.discordapp.com/back.png",
          type: "rail",
          order: "back" as const,
          anchor: "top",
          responsive: true,
        },
        {
          id: "rail",
          src: "https://cdn.discordapp.com/rail.png",
          type: "border",
          order: "back" as const,
          anchor: "center",
          responsive: true,
        },
        {
          id: "front",
          src: "https://cdn.discordapp.com/front.png",
          type: "staple",
          order: "front" as const,
          anchor: "bottom",
          responsive: false,
        },
      ],
    },
  },
};

describe("getProfileFrameLayers", () => {
  it("returns only layers for the requested render order", () => {
    expect(
      getProfileFrameLayers(display, "back").map((layer) => layer.id),
    ).toEqual(["back", "rail"]);
    expect(
      getProfileFrameLayers(display, "front").map((layer) => layer.id),
    ).toEqual(["front"]);
  });

  it("returns an empty list when no frame is equipped", () => {
    expect(getProfileFrameLayers({ version: 1 }, "front")).toEqual([]);
  });

  it("normalizes an invalid zero inner width to a safe positive value", () => {
    const invalid = {
      ...display,
      collectibles: {
        profileFrame: {
          ...display.collectibles.profileFrame,
          innerWidth: 0,
        },
      },
    };

    expect(getProfileFrameLayers(invalid, "front")[0]).toBeDefined();
  });

  it("keeps border rails inside the surface bounds", () => {
    const rail = display.collectibles.profileFrame.layers[1];

    expect(getProfileFrameLayerStyle(display, rail)).toMatchObject({
      height: "100%",
      objectFit: "fill",
      top: "0%",
    });
  });

  it("fits staple layers to a full-screen surface when requested", () => {
    const staple = display.collectibles.profileFrame.layers[2];

    expect(
      getProfileFrameLayerStyle(display, staple, { fitToSurface: true }),
    ).toMatchObject({
      bottom: "0%",
    });

    const border = display.collectibles.profileFrame.layers[1];
    expect(
      getProfileFrameLayerStyle(display, border, { fitToSurface: true }),
    ).toMatchObject({
      height: "calc(100% - 20cqw - 20cqw)",
      top: "20cqw",
    });
  });

  it("returns the inset needed to place a surface inside the frame", () => {
    expect(getProfileFrameSurfaceInsetStyle(display)).toEqual({
      top: "20cqw",
      bottom: "20cqw",
    });
  });
});

describe("getProfileFramePreviewScale", () => {
  it("fits the frame footprint to the profile surface without enlarging it", () => {
    expect(getProfileFramePreviewScale(display)).toBeCloseTo(0.83, 2);
    expect(getProfileFramePreviewScale({ version: 1 })).toBe(1);
  });

  it("only counts vertical overflow for layers that can render outside the surface", () => {
    const borderOnlyDisplay = {
      ...display,
      collectibles: {
        profileFrame: {
          ...display.collectibles.profileFrame,
          layers: [display.collectibles.profileFrame.layers[1]],
        },
      },
    };

    expect(getProfileFramePreviewScale(borderOnlyDisplay)).toBeCloseTo(
      1 / 1.2,
      3,
    );
  });

  it("anchors asymmetric overflow around the rendered frame bounds", () => {
    const topOnlyDisplay = {
      ...display,
      collectibles: {
        profileFrame: {
          ...display.collectibles.profileFrame,
          layers: [display.collectibles.profileFrame.layers[0]],
        },
      },
    };

    expect(getProfileFramePreviewTransform(topOnlyDisplay)).toMatchObject({
      transformOrigin: "50% 100%",
    });
  });
});
