import splashLogo from "@/assets/splash-logo.svg";

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
  return (
    <img
      src={splashLogo}
      alt={alt}
      data-testid={testId}
      className={`theme-aware-splash-logo${className ? ` ${className}` : ""}`}
    />
  );
}
