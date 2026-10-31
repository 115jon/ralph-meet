import { createContext, useContext } from "react";

import type { Theme, ThemeId } from "./tokens";

export interface ThemeContextValue {
  theme: Theme;
  /** Persisted override, or null to follow the system light/dark setting. */
  override: ThemeId | null;
  setOverride: (id: ThemeId | null) => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

function useThemeContext(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside ThemeProvider");
  return value;
}

/** Resolved theme tokens. Never branch on `theme.id`; read roles. */
export function useTheme(): Theme {
  return useThemeContext().theme;
}

export function useThemeOverride() {
  const { override, setOverride } = useThemeContext();
  return { override, setOverride };
}
