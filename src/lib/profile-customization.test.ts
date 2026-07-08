import { describe, expect, it } from "vitest";

import {
  normalizeDisplayColor,
  resolveProfileTheme,
  resolveReadableDisplayNameStyle,
} from "./profile-customization";

describe("resolveReadableDisplayNameStyle", () => {
  it("keeps bright styles on dark surfaces", () => {
    const style = resolveReadableDisplayNameStyle(
      {
        font: "gg-sans",
        effect: "gradient",
        primaryColor: "#FFFFFF",
        secondaryColor: "#F8FAFC",
      },
      {
        backgroundColor: "#111827",
        fallbackTextColor: "#F8FAFC",
      },
    );

    expect(style?.primaryColor).toBe("#FFFFFF");
    expect(style?.secondaryColor).toBe("#F8FAFC");
  });

  it("darkens unreadable light styles on light surfaces", () => {
    const style = resolveReadableDisplayNameStyle(
      {
        font: "gg-sans",
        effect: "gradient",
        primaryColor: "#FFFFFF",
        secondaryColor: "#FFFFFF",
      },
      {
        backgroundColor: "#FFFFFF",
        fallbackTextColor: "#1F2937",
      },
    );

    expect(style?.primaryColor).not.toBe("#FFFFFF");
    expect(style?.secondaryColor).not.toBe("#FFFFFF");
  });

  it("preserves readable blue styles on light surfaces", () => {
    const style = resolveReadableDisplayNameStyle(
      {
        font: "gg-sans",
        effect: "solid",
        primaryColor: "#2563EB",
        secondaryColor: "#1D4ED8",
      },
      {
        backgroundColor: "#FFFFFF",
        fallbackTextColor: "#1F2937",
      },
    );

    expect(style?.primaryColor).toBe("#2563EB");
    expect(style?.secondaryColor).toBe("#1D4ED8");
  });
});

describe("normalizeDisplayColor", () => {
  it("converts rgba colors into hex for contrast checks", () => {
    expect(normalizeDisplayColor("rgba(37, 99, 235, 0.85)")).toBe("#2563EB");
  });
});

describe("resolveProfileTheme", () => {
  it("returns contrast metadata for custom profile themes", () => {
    const theme = resolveProfileTheme({
      profile_accent_color: "#60A5FA",
      profile_background_color: "#EEF6FF",
      profile_banner_color: "#DBEAFE",
    });

    expect(theme.backgroundColor).toBeTruthy();
    expect(theme.textColor).toBe("#16161F");
    expect(theme.isLightSurface).toBe(true);
  });
});
