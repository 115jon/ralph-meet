import { describe, expect, it } from "vitest";

import {
  buildNameplateTheme,
  getNameplateTextColors,
  shouldUseNameplateIdentityFade,
} from "./user-nameplate-presentation";

describe("getNameplateTextColors", () => {
  it("keeps collectible-derived colors when no assisted backdrop is needed", () => {
    const theme = buildNameplateTheme("clouds", "collectible-nameplate");

    expect(getNameplateTextColors(theme)).toMatchObject({
      foregroundColor: theme.foregroundColor,
      mutedForegroundColor: theme.mutedForegroundColor,
      metaColor: theme.metaColor,
      readableFallbackColor: theme.foregroundColor,
    });
  });

  it("falls back to semantic app text colors for assisted custom nameplates", () => {
    const theme = buildNameplateTheme("violet", "custom-nameplate");

    expect(getNameplateTextColors(theme, { useThemeSemanticColors: true })).toEqual({
      foregroundColor: "var(--rm-text-primary)",
      mutedForegroundColor: "var(--rm-text-muted)",
      metaColor: "var(--rm-text-secondary)",
      readableFallbackColor: "var(--rm-text-primary)",
    });
  });

  it("returns empty colors when no nameplate theme is available", () => {
    expect(getNameplateTextColors(null)).toEqual({});
  });
});

describe("shouldUseNameplateIdentityFade", () => {
  it("adds a synthetic identity fade for custom uploaded nameplates", () => {
    const theme = buildNameplateTheme("clouds", "custom-nameplate");

    expect(shouldUseNameplateIdentityFade(theme, {
      needsContrastAssist: true,
    })).toBe(true);
  });

  it("does not add a synthetic fade for collectible nameplates on light surfaces", () => {
    const theme = buildNameplateTheme("red", "collectible-nameplate");

    expect(shouldUseNameplateIdentityFade(theme, {
      needsContrastAssist: false,
    })).toBe(false);
  });

  it("does not add a synthetic fade for collectible nameplates on dark surfaces when assist is not needed", () => {
    const theme = buildNameplateTheme("red", "collectible-nameplate");

    expect(shouldUseNameplateIdentityFade(theme, {
      needsContrastAssist: false,
    })).toBe(false);
  });
});
