import * as SecureStore from "expo-secure-store";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useColorScheme } from "react-native";

import { ThemeContext, type ThemeContextValue } from "./theme-context";
import { THEME_IDS, THEMES, type ThemeId } from "./tokens";

const STORAGE_KEY = "ralph.theme";

function isThemeId(value: string | null): value is ThemeId {
  return THEME_IDS.some((id) => id === value);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [override, setOverrideState] = useState<ThemeId | null>(null);

  useEffect(() => {
    SecureStore.getItemAsync(STORAGE_KEY)
      .then((stored) => {
        if (isThemeId(stored)) setOverrideState(stored);
      })
      .catch(() => undefined);
  }, []);

  const setOverride = useCallback((id: ThemeId | null) => {
    setOverrideState(id);
    const write =
      id === null
        ? SecureStore.deleteItemAsync(STORAGE_KEY)
        : SecureStore.setItemAsync(STORAGE_KEY, id);
    write.catch(() => undefined);
  }, []);

  const value = useMemo<ThemeContextValue>(() => {
    const id: ThemeId = override ?? (system === "light" ? "light" : "dark");
    return { theme: THEMES[id], override, setOverride };
  }, [override, system, setOverride]);

  return <ThemeContext value={value}>{children}</ThemeContext>;
}
