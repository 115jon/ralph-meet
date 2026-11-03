import Constants from "expo-constants";

export interface AppConfig {
  apiBaseUrl: string;
  /** The public web app; invite and message links use it. */
  webUrl: string;
  /** The web host before the Yap rename, whose links still open here ("" if none). */
  legacyWebUrl: string;
  /** This build's URL scheme (ralphmeet, ralphmeet-preview, ralphmeet-dev). */
  scheme: string;
  kovaAuthUrl: string;
  kovaPublishableKey: string;
  /** "development" | "preview" | "production": which build this is. */
  appVariant: string;
}

// Set in app.config.ts `extra`; a missing value is a build mistake, so fail
// loudly at first read rather than sending requests to nowhere.
function readExtra(
  key: Exclude<keyof AppConfig, "scheme" | "legacyWebUrl">,
): string {
  const value: unknown = Constants.expoConfig?.extra?.[key];
  if (typeof value !== "string" || value === "") {
    throw new Error(`Missing app config: extra.${key}`);
  }
  return value;
}

function readScheme(): string {
  const scheme = Constants.expoConfig?.scheme;
  const value = Array.isArray(scheme) ? scheme[0] : scheme;
  if (!value) throw new Error("Missing app config: scheme");
  return value;
}

export const config: AppConfig = {
  apiBaseUrl: readExtra("apiBaseUrl").replace(/\/$/, ""),
  webUrl: readExtra("webUrl").replace(/\/$/, ""),
  legacyWebUrl: String(Constants.expoConfig?.extra?.legacyWebUrl ?? ""),
  scheme: readScheme(),
  kovaAuthUrl: readExtra("kovaAuthUrl").replace(/\/$/, ""),
  kovaPublishableKey: readExtra("kovaPublishableKey"),
  appVariant: readExtra("appVariant"),
};
