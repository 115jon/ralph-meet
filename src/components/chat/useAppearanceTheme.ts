import { apiPatch } from "@/lib/api-client";
import {
  getThemePreferenceSeed,
  isAppTheme,
  normalizeThemePreferences,
  shouldApplySyncedTheme,
  type AppTheme,
  type ThemePreferences,
} from "@/lib/theme-preferences";
import { useChatStore } from "@/stores/chat-store";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useMemo, useRef } from "react";

type UpdateOptions = {
  syncEnabled?: boolean;
  persist?: boolean;
};

type AppearanceThemeHookOptions = {
  enableBootstrap?: boolean;
};

export function useAppearanceTheme(options?: AppearanceThemeHookOptions) {
  const user = useChatStore((s) => s.user);
  const dispatch = useChatStore((s) => s.dispatch);
  const { theme, setTheme } = useTheme();
  const seededSyncRef = useRef(false);
  const enableBootstrap = options?.enableBootstrap ?? false;

  const preferences = useMemo<ThemePreferences>(
    () => normalizeThemePreferences(user),
    [user],
  );

  useEffect(() => {
    if (!enableBootstrap) return;
    if (!theme) return;
    if (!user?.id) return;

    if (shouldApplySyncedTheme(theme, preferences)) {
      setTheme(preferences.themePreference);
      return;
    }

    const seedTheme = getThemePreferenceSeed(preferences, theme);
    if (!seededSyncRef.current && seedTheme) {
      seededSyncRef.current = true;
      void apiPatch("/api/update-profile", {
        themePreference: seedTheme,
        themeSyncEnabled: true,
      }).then(() => {
        dispatch({
          type: "UPDATE_MEMBER_PROFILE",
          userId: user.id,
          theme_preference: seedTheme,
          theme_sync_enabled: true,
        });
      }).catch(() => {
        seededSyncRef.current = false;
      });
    }
  }, [dispatch, enableBootstrap, preferences, setTheme, theme, user?.id]);

  const persistAppearance = useCallback(async (nextTheme: AppTheme | null, syncEnabled: boolean) => {
    if (!user?.id) return;

    dispatch({
      type: "UPDATE_MEMBER_PROFILE",
      userId: user.id,
      theme_preference: nextTheme,
      theme_sync_enabled: syncEnabled,
    });

    try {
      await apiPatch("/api/update-profile", {
        themePreference: nextTheme,
        themeSyncEnabled: syncEnabled,
      });
    } catch {
      void useChatStore.getState().actions.loadCurrentUser();
    }
  }, [dispatch, user?.id]);

  const setAppearanceTheme = useCallback(async (nextTheme: AppTheme, options?: UpdateOptions) => {
    setTheme(nextTheme);
    const syncEnabled = options?.syncEnabled ?? preferences.themeSyncEnabled;

    if (options?.persist === false) return;

    if (!syncEnabled) return;

    await persistAppearance(nextTheme, true);
  }, [persistAppearance, preferences.themeSyncEnabled, setTheme]);

  const setThemeSyncEnabled = useCallback(async (enabled: boolean) => {
    if (enabled) {
      const nextTheme = isAppTheme(theme) ? theme : preferences.themePreference;
      await persistAppearance(nextTheme ?? null, true);
      return;
    }

    await persistAppearance(null, false);
  }, [persistAppearance, preferences.themePreference, theme]);

  return {
    theme,
    preferences,
    setAppearanceTheme,
    setThemeSyncEnabled,
  };
}
