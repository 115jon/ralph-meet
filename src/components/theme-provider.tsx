
import { isTauri } from "@/lib/platform";
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import * as React from "react";

export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider {...props}>
      <NativeTitleBarSync />
      {children}
    </NextThemesProvider>
  );
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

    const dark = resolvedTheme === "dark";
    import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke("set_title_bar_dark_mode", { dark }))
      .catch(() => {
        // Silently ignore — command may not exist on non-Windows or older builds
      });
  }, [resolvedTheme]);

  return null;
}
