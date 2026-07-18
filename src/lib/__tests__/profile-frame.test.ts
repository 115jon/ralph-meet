import { describe, expect, it } from "vitest";

import { getProfileFrameLayers } from "@/lib/profile-frame";

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
    ).toEqual(["back"]);
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
});
