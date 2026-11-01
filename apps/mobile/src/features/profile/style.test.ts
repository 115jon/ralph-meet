import { describe, expect, it } from "vitest";

import { contrast, normalizeHex, readableOn } from "./color";
import {
  effectLayers,
  nameLook,
  parseCollectibles,
  parseDisplayNameStyle,
  profileColors,
  roleColor,
} from "./style";

const DARK = {
  ply3: "#1b1b1f",
  ply2: "#141417",
  ink1: "#f2f2f3",
  ink2: "#b4b4ba",
};

describe("color", () => {
  it("normalizes short and bare hex", () => {
    expect(normalizeHex("abc")).toBe("#AABBCC");
    expect(normalizeHex("#a5adff")).toBe("#A5ADFF");
    expect(normalizeHex("rgb(1,2,3)")).toBeNull();
  });

  it("keeps a colour that already reads and nudges one that does not", () => {
    expect(readableOn("#F8FAFC", "#000000", 4.5)).toBe("#F8FAFC");
    const fixed = readableOn("#111111", "#000000", 4.5);
    expect(contrast(fixed, "#000000")).toBeGreaterThanOrEqual(4.5);
  });
});

describe("parseDisplayNameStyle", () => {
  const style = {
    font: "tempo",
    effect: "neon",
    primaryColor: "#fb7185",
    secondaryColor: "#38bdf8",
  };

  it("reads the JSON string member rows carry and the profile's object", () => {
    expect(parseDisplayNameStyle(JSON.stringify(style))?.primaryColor).toBe(
      "#FB7185",
    );
    expect(parseDisplayNameStyle(style)?.effect).toBe("neon");
  });

  it("ignores anything it does not understand", () => {
    expect(parseDisplayNameStyle("{nope")).toBeNull();
    expect(parseDisplayNameStyle({ ...style, effect: "sparkle" })).toBeNull();
    expect(parseDisplayNameStyle(null)).toBeNull();
  });

  it("gives neon a glow and keeps the name readable", () => {
    const parsed = parseDisplayNameStyle(style);
    if (!parsed) throw new Error("style did not parse");
    const look = nameLook(parsed, "#1b1b1f");
    expect(look.textShadowRadius).toBeGreaterThan(0);
    expect(contrast(look.color, "#1b1b1f")).toBeGreaterThanOrEqual(3);
  });
});

describe("roleColor", () => {
  it("skips an unset (black) role colour and lifts a dark one", () => {
    expect(roleColor("#000000", "#000000")).toBeNull();
    expect(roleColor(null, "#000000")).toBeNull();
    const lifted = roleColor("#2b2a6e", "#000000");
    expect(lifted && contrast(lifted, "#000000")).toBeGreaterThanOrEqual(4.5);
  });
});

describe("profileColors", () => {
  it("uses the app's float for the server's default pair", () => {
    const colors = profileColors(
      { profile_accent_color: "#5865F2", profile_background_color: "#161A22" },
      DARK,
    );
    expect(colors).toMatchObject({
      surface: DARK.ply3,
      custom: false,
      banner: DARK.ply2,
    });
  });

  it("tints with a custom background only where ink still reads", () => {
    const dark = profileColors(
      { profile_accent_color: "#F472B6", profile_background_color: "#2B1030" },
      DARK,
    );
    expect(dark.custom).toBe(true);
    expect(contrast(DARK.ink1, dark.surface)).toBeGreaterThanOrEqual(4.5);
    const light = profileColors(
      { profile_accent_color: "#F472B6", profile_background_color: "#FFFFFF" },
      DARK,
    );
    expect(contrast(DARK.ink1, light.surface)).toBeGreaterThanOrEqual(4.5);
  });

  it("fills a missing banner with the banner colour", () => {
    expect(
      profileColors({ profile_banner_color: "#123456" }, DARK).banner,
    ).toBe("#123456");
  });
});

describe("collectibles", () => {
  it("reads a decoration and an effect, in paint order", () => {
    const parsed = parseCollectibles({
      version: 1,
      collectibles: {
        avatarDecoration: {
          skuId: "1",
          name: "Ring",
          asset: "a",
          imageUrl: "https://cdn/x.png",
        },
        profileEffect: {
          skuId: "2",
          name: "Sparkle",
          effectUrls: [],
          effects: [
            { src: "b.png", zIndex: 2, duration: 1200 },
            { src: "a.png", zIndex: 1, start: 200, duration: 3000 },
          ],
        },
      },
    });
    expect(parsed?.avatarDecoration?.imageUrl).toBe("https://cdn/x.png");
    const effect = parsed?.profileEffect;
    if (!effect) throw new Error("no effect");
    expect(effectLayers(effect)).toEqual([
      { src: "a.png", start: 200, duration: 3000 },
      { src: "b.png", start: 0, duration: 1200 },
    ]);
  });

  it("is null without collectibles", () => {
    expect(parseCollectibles(null)).toBeNull();
    expect(parseCollectibles({ version: 1 })).toBeNull();
  });
});
