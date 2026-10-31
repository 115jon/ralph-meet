import Constants from "expo-constants";

export interface AppConfig {
  apiBaseUrl: string;
  kovaAuthUrl: string;
  kovaPublishableKey: string;
}

// Set in app.config.ts `extra`; a missing value is a build mistake, so fail
// loudly at first read rather than sending requests to nowhere.
function readExtra(key: keyof AppConfig): string {
  const value: unknown = Constants.expoConfig?.extra?.[key];
  if (typeof value !== "string" || value === "") {
    throw new Error(`Missing app config: extra.${key}`);
  }
  return value;
}

export const config: AppConfig = {
  apiBaseUrl: readExtra("apiBaseUrl").replace(/\/$/, ""),
  kovaAuthUrl: readExtra("kovaAuthUrl").replace(/\/$/, ""),
  kovaPublishableKey: readExtra("kovaPublishableKey"),
};
