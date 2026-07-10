import { isDesktop, isTauri } from "@/lib/platform";
import { isDarkAppTheme, NEXT_THEME_NAMES } from "@/lib/theme-preferences";
import { useAppearanceTheme } from "@/components/chat/useAppearanceTheme";
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import * as React from "react";

const DEFAULT_THEME_PROVIDER_PROPS = {
  attribute: "class",
  defaultTheme: "dark",
  enableSystem: true,
  disableTransitionOnChange: true,
  themes: NEXT_THEME_NAMES,
} satisfies React.ComponentProps<typeof NextThemesProvider>;

export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider {...DEFAULT_THEME_PROVIDER_PROPS} {...props}>
      <ThemePreferenceBootstrap />
      <NativeTitleBarSync />
      {children}
    </NextThemesProvider>
  );
}

function ThemePreferenceBootstrap() {
  useAppearanceTheme({ enableBootstrap: true });
  return null;
}

/**
 * Syncs the resolved theme (dark/light) to the native window title bar.
 *
 * On desktop (Tauri), calls the `set_title_bar_dark_mode` Rust command
 * whenever the user switches themes via Settings or the Command Menu.
 * This uses DwmSetWindowAttribute under the hood for proper Win32
 * dark title bar rendering.
 *
 * No-op on web (non-Tauri) environments.
 */
function NativeTitleBarSync() {
  const { resolvedTheme } = useTheme();

  React.useEffect(() => {
    if (!isTauri()) return;

    const dark = isDarkAppTheme(resolvedTheme);
    if (isDesktop()) {
      import("@tauri-apps/api/core")
        .then(({ invoke }) => invoke("set_title_bar_dark_mode", { dark }))
        .catch((e) => {
          console.error("Theme set error:", e);
        });
    } else {
      // @ts-ignore
      import("tauri-plugin-status-bar-color-api")
        .then(({ setStatusBarColor }) => {
          // Sync background and text styles by providing hex value
          setStatusBarColor(dark ? "#0b0b0b" : "#ffffff");
        })
        .catch((e) => {
          console.error("Mobile status bar theme set error:", e);
        });
    }
  }, [resolvedTheme]);

  return null;
}
