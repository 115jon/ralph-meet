export const APP_THEMES = [
  "light",
  "dark",
  "miku-light",
  "miku-dark",
  "spiderman-light",
  "spiderman-dark",
  "system",
] as const;

export type AppTheme = (typeof APP_THEMES)[number];

export type ThemePreferences = {
  themePreference: AppTheme | null;
  themeSyncEnabled: boolean;
};

type RawThemePreferences = {
  theme_preference?: string | null;
  theme_sync_enabled?: boolean | number | null;
};

export function isAppTheme(value: string | null | undefined): value is AppTheme {
  return typeof value === "string" && APP_THEMES.includes(value as AppTheme);
}

export function normalizeThemePreferences(raw: RawThemePreferences | null | undefined): ThemePreferences {
  const themePreference = raw?.theme_preference ?? null;
  return {
    themePreference: isAppTheme(themePreference) ? themePreference : null,
    themeSyncEnabled: raw?.theme_sync_enabled === true || raw?.theme_sync_enabled === 1,
  };
}

export function getThemePreferenceSeed(
  prefs: ThemePreferences,
  currentTheme: string | undefined,
): AppTheme | null {
  if (!prefs.themeSyncEnabled || prefs.themePreference) return null;
  return isAppTheme(currentTheme) ? currentTheme : null;
}

export function shouldApplySyncedTheme(
  currentTheme: string | undefined,
  prefs: ThemePreferences,
): prefs is ThemePreferences & { themePreference: AppTheme } {
  return !!prefs.themeSyncEnabled && !!prefs.themePreference && prefs.themePreference !== currentTheme;
}
