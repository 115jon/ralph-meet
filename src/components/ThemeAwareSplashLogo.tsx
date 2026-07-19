import splashLogo from "@/assets/splash-logo.svg";
import { APP_THEMES, isAppTheme } from "@/lib/theme-preferences";
import { useTheme } from "next-themes";

function getBootstrappedTheme(): string | undefined {
  if (typeof document !== "undefined") {
    const documentTheme = APP_THEMES.find((theme) =>
      document.documentElement.classList.contains(theme),
    );
    if (documentTheme) return documentTheme;
  }

  if (typeof window === "undefined") return undefined;

  try {
    const storedTheme = window.localStorage.getItem("theme");
    if (storedTheme === "system") {
      return window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    }
    return isAppTheme(storedTheme) ? storedTheme : undefined;
  } catch {
    return undefined;
  }
}

interface ThemeAwareSplashLogoProps {
  alt?: string;
  className?: string;
  "data-testid"?: string;
}

export function ThemeAwareSplashLogo({
  alt = "",
  className,
  "data-testid": testId,
}: ThemeAwareSplashLogoProps) {
  const { resolvedTheme, theme } = useTheme();
  const activeTheme = getBootstrappedTheme() ?? resolvedTheme ?? theme;
  const isLightTheme =
    activeTheme === "light" ||
    activeTheme === "miku-light" ||
    activeTheme === "spiderman-light";

  return (
    <img
      src={splashLogo}
      alt={alt}
      data-testid={testId}
      className={`theme-aware-splash-logo${className ? ` ${className}` : ""}`}
      style={{ filter: isLightTheme ? "brightness(0)" : undefined }}
    />
  );
}
