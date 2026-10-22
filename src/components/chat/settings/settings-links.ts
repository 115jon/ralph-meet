/**
 * Deep links into the settings dialog.
 *
 *   openSettings({ panel: "voice", row: "echo-cancellation" });
 *   openSettings({ row: "sign-out" });          // panel is inferred
 *
 * Dispatches a window event that the mounted SettingsModal listens for, so
 * any part of the app can open settings on an exact row without owning the
 * dialog's state. Row ids come from schema.ts and are stable.
 *
 * The app has no URL route for settings, so there is no "copy link" button;
 * a settings location is { panel, row } and nothing more.
 */

import {
  getRowLocation,
  isSettingsPanelId,
  type SettingsPanelId,
} from "./schema";

export const OPEN_SETTINGS_EVENT = "ralph:open-settings";

export type SettingsLocation = {
  panel?: SettingsPanelId;
  /** A row id from schema.ts. Lands on the row and highlights it. */
  row?: string;
};

/** Tab names the dialog accepted before the Studio IA. Still accepted. */
export type LegacySettingsTab =
  | "account"
  | "profiles"
  | "shares"
  | "appearance"
  | "media"
  | "voice"
  | "camera"
  | "accessibility"
  | "text"
  | "notifications"
  | "devices"
  | "os-settings";

const LEGACY_TABS: Record<
  LegacySettingsTab,
  { panel: SettingsPanelId; row?: string }
> = {
  account: { panel: "account" },
  profiles: { panel: "account", row: "server-profiles" },
  shares: { panel: "privacy", row: "shared-messages" },
  appearance: { panel: "appearance" },
  media: { panel: "privacy", row: "media-filter" },
  text: { panel: "privacy", row: "media-filter" },
  voice: { panel: "voice" },
  camera: { panel: "voice", row: "camera-preview" },
  accessibility: { panel: "appearance", row: "reduced-motion" },
  notifications: { panel: "notifications" },
  devices: { panel: "sessions" },
  "os-settings": { panel: "desktop" },
};

export type SettingsTabInput = LegacySettingsTab | SettingsPanelId;

/**
 * Resolve a panel, row or legacy tab name to a concrete location. A row wins
 * over a mismatched panel, because the row id is the more specific request.
 */
export function resolveSettingsLocation(input: {
  tab?: SettingsTabInput | null;
  row?: string | null;
}): { panel: SettingsPanelId; row: string | null } {
  const rowLocation = input.row ? getRowLocation(input.row) : undefined;
  if (rowLocation) {
    return { panel: rowLocation.panel.id, row: input.row ?? null };
  }
  const tab = input.tab ?? "account";
  if (isSettingsPanelId(tab)) return { panel: tab, row: null };
  const legacy = LEGACY_TABS[tab as LegacySettingsTab];
  if (legacy) return { panel: legacy.panel, row: legacy.row ?? null };
  return { panel: "account", row: null };
}

export function openSettings(location: SettingsLocation = {}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<SettingsLocation>(OPEN_SETTINGS_EVENT, {
      detail: location,
    }),
  );
}
