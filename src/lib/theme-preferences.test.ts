import {
  getThemePreferenceSeed,
  normalizeThemePreferences,
  shouldApplySyncedTheme,
  type AppTheme,
} from "@/lib/theme-preferences";
import { describe, expect, it } from "vitest";

describe("theme preference helpers", () => {
  it("normalizes stored sync settings and rejects unsupported themes", () => {
    expect(
      normalizeThemePreferences({
        theme_preference: "miku-dark",
        theme_sync_enabled: 1,
      }),
    ).toEqual({
      themePreference: "miku-dark",
      themeSyncEnabled: true,
    });

    expect(
      normalizeThemePreferences({
        theme_preference: "not-a-real-theme",
        theme_sync_enabled: 0,
      }),
    ).toEqual({
      themePreference: null,
      themeSyncEnabled: false,
    });
  });

  it("seeds the synced theme from the current local theme when sync is enabled without a saved preference", () => {
    expect(
      getThemePreferenceSeed({
        themePreference: null,
        themeSyncEnabled: true,
      }, "spiderman-dark"),
    ).toBe("spiderman-dark");

    expect(
      getThemePreferenceSeed({
        themePreference: null,
        themeSyncEnabled: true,
      }, "unknown-theme"),
    ).toBeNull();

    expect(
      getThemePreferenceSeed({
        themePreference: "dark",
        themeSyncEnabled: true,
      }, "light"),
    ).toBeNull();
  });

  it("only applies the synced theme when sync is enabled and the saved theme differs", () => {
    const savedTheme: AppTheme = "miku-light";

    expect(shouldApplySyncedTheme("dark", {
      themePreference: savedTheme,
      themeSyncEnabled: true,
    })).toBe(true);

    expect(shouldApplySyncedTheme(savedTheme, {
      themePreference: savedTheme,
      themeSyncEnabled: true,
    })).toBe(false);

    expect(shouldApplySyncedTheme("dark", {
      themePreference: savedTheme,
      themeSyncEnabled: false,
    })).toBe(false);
  });
});
